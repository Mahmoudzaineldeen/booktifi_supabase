/**
 * Check if package_subscriptions table has invoice columns
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables are required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function checkSchema() {
  console.log('🔍 Checking package_subscriptions table schema...\n');
  
  // Try to query the columns directly
  const { data, error } = await supabase
    .from('package_subscriptions')
    .select('id, zoho_invoice_id, payment_status')
    .limit(1);
  
  if (error) {
    if (error.message?.includes('zoho_invoice_id') || error.message?.includes('payment_status')) {
      console.log('❌ Migration NOT applied - columns missing:');
      if (error.message.includes('zoho_invoice_id')) {
        console.log('   - zoho_invoice_id column not found');
      }
      if (error.message.includes('payment_status')) {
        console.log('   - payment_status column not found');
      }
      console.log('\n💡 Solution: Run migration 20260131000006_add_package_invoice_fields.sql');
      process.exit(1);
    } else {
      console.error('❌ Error checking schema:', error);
      process.exit(1);
    }
  } else {
    console.log('✅ Migration applied - columns exist:');
    console.log('   - zoho_invoice_id ✓');
    console.log('   - payment_status ✓');
    
    // Check if there are any subscriptions
    const { count } = await supabase
      .from('package_subscriptions')
      .select('*', { count: 'exact', head: true });
    
    console.log(`\n📊 Total subscriptions: ${count || 0}`);
    
    // Check how many have invoices
    const { count: withInvoices } = await supabase
      .from('package_subscriptions')
      .select('*', { count: 'exact', head: true })
      .not('zoho_invoice_id', 'is', null);
    
    console.log(`📊 Subscriptions with invoices: ${withInvoices || 0}`);
    console.log(`📊 Subscriptions without invoices: ${(count || 0) - (withInvoices || 0)}`);
  }
}

checkSchema().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
