import { supabase } from '../db';
import { zohoService } from '../services/zohoService';

interface QueueJob {
  id: string;
  job_type: string;
  status: string;
  payload: {
    booking_id: string;
    tenant_id: string;
    attempt: number;
  };
  attempts: number;
  created_at: Date;
}

const MAX_RETRIES = 3;
const INITIAL_DELAY = 1000; // 1 second
const MAX_DELAY = 60000; // 60 seconds

/**
 * Calculate exponential backoff delay
 */
function calculateDelay(attempt: number): number {
  const delay = Math.min(INITIAL_DELAY * Math.pow(2, attempt), MAX_DELAY);
  return delay;
}

/**
 * Process a single Zoho receipt job
 */
async function processReceiptJob(job: QueueJob): Promise<{ success: boolean; error?: string }> {
  const { booking_id, tenant_id, attempt } = job.payload;

  console.log(`[ZohoReceiptWorker] Processing job ${job.id} for booking ${booking_id} (attempt ${attempt + 1}/${MAX_RETRIES})`);

  try {
    // Check if booking exists and get invoice-related fields
    // Use maybeSingle to avoid throwing error if booking doesn't exist
    const { data: booking, error: bookingError } = await supabase
      .from('bookings')
      .select('zoho_invoice_id, payment_status, paid_quantity, package_covered_quantity, total_price')
      .eq('id', booking_id)
      .maybeSingle();

    // Handle missing booking gracefully (booking may have been deleted)
    if (bookingError || !booking) {
      console.warn(`[ZohoReceiptWorker] ⚠️ Booking ${booking_id} not found - marking job as failed (booking may have been deleted)`);
      await supabase
        .from('queue_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
      return { success: false, error: `Booking ${booking_id} not found (may have been deleted)` };
    }

    // Skip if invoice already created
    if (booking.zoho_invoice_id) {
      console.log(`[ZohoReceiptWorker] Invoice already exists for booking ${booking_id}, marking job as completed`);
      await supabase
        .from('queue_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
      return { success: true };
    }

    // ============================================================================
    // STRICT BILLING RULE: Invoice ONLY when real money is owed
    // ============================================================================
    // Check if booking should have an invoice:
    // 1. paid_quantity > 0 (has paid portion)
    // 2. total_price > 0 (money is owed)
    // ============================================================================
    const paidQty = booking.paid_quantity ?? (booking.package_covered_quantity !== undefined 
      ? (booking.package_covered_quantity === 0 ? 1 : 0) // Fallback: if package_covered exists and is 0, assume all paid
      : 1); // Fallback: if fields don't exist, assume paid (backward compatibility)
    const totalPrice = parseFloat(booking.total_price?.toString() || '0');
    
    // Skip if booking shouldn't have an invoice (strict billing rule)
    if (paidQty <= 0 || totalPrice <= 0) {
      console.log(`[ZohoReceiptWorker] ⚠️ Booking ${booking_id} should NOT have invoice (strict billing rule)`);
      console.log(`[ZohoReceiptWorker]    paid_quantity: ${paidQty} (must be > 0)`);
      console.log(`[ZohoReceiptWorker]    total_price: ${totalPrice} (must be > 0)`);
      console.log(`[ZohoReceiptWorker]    → Marking job as completed (no invoice needed)`);
      await supabase
        .from('queue_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
      return { success: true, error: 'Booking fully covered by package - no invoice needed' };
    }

    // Skip if payment status is not paid (for backward compatibility)
    if (booking.payment_status !== 'paid' && booking.payment_status !== 'unpaid') {
      console.log(`[ZohoReceiptWorker] Booking ${booking_id} payment status is ${booking.payment_status}, skipping`);
      await supabase
        .from('queue_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
      return { success: false, error: `Payment status is ${booking.payment_status}, not paid` };
    }

    // Generate receipt
    const result = await zohoService.generateReceipt(booking_id);

    if (result.success) {
      // Mark job as completed
      await supabase
        .from('queue_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
      console.log(`[ZohoReceiptWorker] ✅ Successfully generated receipt for booking ${booking_id}`);
      return { success: true };
    } else {
      throw new Error(result.error || 'Unknown error');
    }
  } catch (error: any) {
    console.error(`[ZohoReceiptWorker] Error processing job ${job.id}:`, error.message);

    // Don't retry if booking doesn't exist (booking was deleted)
    if (error.message?.includes('not found') || error.message?.includes('Booking')) {
      console.warn(`[ZohoReceiptWorker] ⚠️ Booking not found - marking job as failed (no retry)`);
      await supabase
        .from('queue_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
      return { success: false, error: error.message };
    }

    const nextAttempt = attempt + 1;

    if (nextAttempt >= MAX_RETRIES) {
      // Max retries reached, mark as failed
      await supabase
        .from('queue_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job.id);
      console.error(`[ZohoReceiptWorker] ❌ Job ${job.id} failed after ${MAX_RETRIES} attempts`);
      return { success: false, error: error.message };
    } else {
      // Schedule retry with exponential backoff
      const delay = calculateDelay(nextAttempt);
      const retryAt = new Date(Date.now() + delay);

      // Update payload with new attempt count
      const updatedPayload = { ...job.payload, attempt: nextAttempt };

      await supabase
        .from('queue_jobs')
        .update({
          status: 'pending',
          attempts: nextAttempt,
          payload: updatedPayload
        })
        .eq('id', job.id);

      console.log(`[ZohoReceiptWorker] ⏳ Scheduling retry ${nextAttempt + 1}/${MAX_RETRIES} for job ${job.id} in ${delay}ms`);
      return { success: false, error: error.message };
    }
  }
}

/**
 * Process pending Zoho receipt jobs
 */
export async function processZohoReceiptJobs(): Promise<void> {
  try {
    // Calculate the time threshold (5 minutes ago)
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();

    // Get pending jobs that are ready to process (not recently started)
    const { data: jobs, error: jobsError } = await supabase
      .from('queue_jobs')
      .select('*')
      .eq('job_type', 'zoho_receipt')
      .eq('status', 'pending')
      .or(`started_at.is.null,started_at.lt.${fiveMinutesAgo}`)
      .order('created_at', { ascending: true })
      .limit(10);

    if (jobsError) {
      throw jobsError;
    }

    if (!jobs || jobs.length === 0) {
      return; // No jobs to process
    }

    console.log(`[ZohoReceiptWorker] Found ${jobs.length} pending Zoho receipt jobs`);

    // Clean up orphaned jobs for deleted bookings (jobs older than 1 hour)
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const oldJobs = jobs.filter((job: QueueJob) => {
      const createdAt = new Date(job.created_at);
      return createdAt < oneHourAgo;
    });

    if (oldJobs.length > 0) {
      console.log(`[ZohoReceiptWorker] 🧹 Checking ${oldJobs.length} old job(s) for deleted bookings...`);
      for (const oldJob of oldJobs) {
        // Check if booking still exists
        const { data: booking } = await supabase
          .from('bookings')
          .select('id')
          .eq('id', oldJob.payload.booking_id)
          .maybeSingle();

        if (!booking) {
          console.log(`[ZohoReceiptWorker] 🗑️ Marking orphaned job ${oldJob.id} as failed (booking ${oldJob.payload.booking_id} deleted)`);
          await supabase
            .from('queue_jobs')
            .update({
              status: 'failed',
              completed_at: new Date().toISOString()
            })
            .eq('id', oldJob.id);
        }
      }
    }

    // Process jobs in parallel (but limit concurrency)
    const processingPromises = jobs.map(async (job: QueueJob) => {
      // Mark as processing
      await supabase
        .from('queue_jobs')
        .update({
          status: 'processing',
          started_at: new Date().toISOString()
        })
        .eq('id', job.id);

      // Process the job
      return processReceiptJob(job);
    });

    await Promise.allSettled(processingPromises);
  } catch (error: any) {
    console.error('[ZohoReceiptWorker] Error processing jobs:', error);
  }
}

/**
 * Start the Zoho receipt worker
 * This should be called periodically (e.g., every 30 seconds)
 */
export function startZohoReceiptWorker(intervalMs: number = 30000): NodeJS.Timeout {
  console.log(`[ZohoReceiptWorker] Starting worker with ${intervalMs}ms interval`);

  // Process immediately on start
  processZohoReceiptJobs().catch(console.error);

  // Then process periodically
  return setInterval(() => {
    processZohoReceiptJobs().catch(console.error);
  }, intervalMs);
}

/**
 * Stop the Zoho receipt worker
 */
export function stopZohoReceiptWorker(intervalId: NodeJS.Timeout): void {
  clearInterval(intervalId);
  console.log('[ZohoReceiptWorker] Worker stopped');
}

