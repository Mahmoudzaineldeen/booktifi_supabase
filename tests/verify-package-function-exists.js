/**
 * Quick verification: Check if resolveCustomerServiceCapacity function exists
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function verifyFunction() {
  console.log('🔍 Verifying resolveCustomerServiceCapacity function...\n');
  
  // Method 1: Direct SQL query
  try {
    const { data, error } = await supabase
      .rpc('pg_get_function_identity_arguments', {
        function_oid: null // This won't work, but let's try a different approach
      });
    
    // Instead, query pg_proc directly
    const { data: functions, error: funcError } = await supabase
      .from('pg_proc')
      .select('proname, pg_get_function_arguments(oid)')
      .eq('proname', 'resolveCustomerServiceCapacity');
    
    if (!funcError && functions && functions.length > 0) {
      console.log('✅ Function found via pg_proc query');
      console.log('   Functions:', functions);
    } else {
      console.log('⚠️  Function not found via pg_proc query');
    }
  } catch (err) {
    console.log('⚠️  Could not query pg_proc:', err.message);
  }
  
  // Method 2: Try calling the function with test data
  try {
    // Get a test customer and service
    const { data: customers, error: custError } = await supabase
      .from('customers')
      .select('id')
      .limit(1)
      .maybeSingle();
    
    const { data: services, error: servError } = await supabase
      .from('services')
      .select('id')
      .limit(1)
      .maybeSingle();
    
    if (custError || servError || !customers || !services) {
      console.log('⚠️  Could not get test data');
      return;
    }
    
    console.log(`\n🧪 Testing function call with:`);
    console.log(`   Customer ID: ${customers.id}`);
    console.log(`   Service ID: ${services.id}`);
    
    const { data: result, error: rpcError } = await supabase
      .rpc('resolveCustomerServiceCapacity', {
        p_customer_id: customers.id,
        p_service_id: services.id
      });
    
    if (rpcError) {
      console.log(`\n❌ Function call failed:`);
      console.log(`   Error: ${rpcError.message}`);
      console.log(`   Code: ${rpcError.code}`);
      console.log(`   Details: ${rpcError.details}`);
      console.log(`   Hint: ${rpcError.hint}`);
      
      if (rpcError.message.includes('Could not find the function')) {
        console.log(`\n🔧 ACTION REQUIRED:`);
        console.log(`   1. Verify migration 20260130000000_redesign_package_capacity_system.sql was applied`);
        console.log(`   2. Check Supabase dashboard → Database → Functions`);
        console.log(`   3. If missing, run: supabase migration up`);
      }
    } else {
      console.log(`\n✅ Function call succeeded!`);
      console.log(`   Result:`, result);
    }
  } catch (err) {
    console.log(`\n❌ Exception:`, err.message);
  }
}

verifyFunction();
