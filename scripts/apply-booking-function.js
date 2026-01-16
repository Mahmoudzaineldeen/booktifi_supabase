#!/usr/bin/env node

/**
 * Apply create_booking_with_lock function to database
 */

const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', 'server', '.env') });
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function applyFunction() {
  console.log('📝 Reading SQL function file...\n');
  
  const sqlPath = path.join(__dirname, '..', 'database', 'create_booking_with_lock_function.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');
  
  console.log('🔧 Applying function to database...\n');
  console.log('⚠️  Note: Supabase JS client does not support direct SQL execution.');
  console.log('   Please apply this SQL manually via Supabase SQL Editor:\n');
  console.log('   1. Go to: https://supabase.com/dashboard');
  console.log('   2. Select your project');
  console.log('   3. Go to SQL Editor');
  console.log('   4. Copy and paste the SQL from: database/create_booking_with_lock_function.sql\n');
  
  console.log('📋 SQL to apply:');
  console.log('='.repeat(60));
  console.log(sql);
  console.log('='.repeat(60));
  
  // Try to use query endpoint if available
  try {
    // Split SQL into individual statements
    const statements = sql.split(';').filter(s => s.trim().length > 0);
    
    for (const statement of statements) {
      if (statement.trim()) {
        // Try using the query API
        const { data, error } = await supabase.rpc('exec', { 
          sql: statement.trim() + ';' 
        });
        
        if (error) {
          console.log(`\n⚠️  Could not execute via API: ${error.message}`);
          console.log('   This is expected - please use Supabase SQL Editor instead.\n');
          break;
        }
      }
    }
  } catch (err) {
    console.log('\n✅ Instructions provided above. Please apply manually.\n');
  }
}

applyFunction().catch(console.error);
