import { supabase } from '../db';
import { logger } from '../utils/logger';

const CLEANUP_INTERVAL = 60000; // Run every 60 seconds
const LOCK_EXPIRY_SECONDS = 120; // 2 minutes

let cleanupInterval: NodeJS.Timeout | null = null;

export function startLockCleanup() {
  if (cleanupInterval) {
    return; // Already running
  }

  logger.info('Starting booking lock cleanup job', undefined, {
    interval: CLEANUP_INTERVAL,
    expirySeconds: LOCK_EXPIRY_SECONDS,
  });

  // Run immediately on start
  cleanupExpiredLocks();

  // Then run periodically
  cleanupInterval = setInterval(() => {
    cleanupExpiredLocks();
  }, CLEANUP_INTERVAL);
}

export function stopLockCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('Stopped booking lock cleanup job');
  }
}

async function cleanupExpiredLocks() {
  try {
    const now = new Date().toISOString();

    // First get the locks that will be deleted for logging
    const { data: locksToDelete, error: selectError } = await supabase
      .from('booking_locks')
      .select('id, slot_id, reserved_by_session_id')
      .lte('lock_expires_at', now);

    if (selectError) {
      throw selectError;
    }

    // Delete the expired locks
    const { error: deleteError } = await supabase
      .from('booking_locks')
      .delete()
      .lte('lock_expires_at', now);

    if (deleteError) {
      throw deleteError;
    }

    if (locksToDelete && locksToDelete.length > 0) {
      logger.info('Cleaned up expired booking locks', undefined, {
        count: locksToDelete.length,
        locks: locksToDelete,
      });
    }
  } catch (error: any) {
    logger.error('Error cleaning up expired locks', error);
  }
}



