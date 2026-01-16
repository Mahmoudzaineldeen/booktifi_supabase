import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../server/.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function applyMigration() {
  console.log('📧 Applying SMTP settings migration...\n');

  const migrationSQL = readFileSync(
    join(__dirname, '../supabase/migrations/20251203000001_add_smtp_settings_to_tenants.sql'),
    'utf-8'
  );

  try {
    // Extract the DO block SQL
    const sql = migrationSQL
      .split('DO $$')[1]
      .split('END $$;')[0]
      .trim();

    // For Supabase, we need to use RPC or direct query
    // Since we can't execute DO blocks directly, let's use a simpler approach
    console.log('Checking if smtp_settings column exists...');
    
    // Check if column exists
    const { data: checkData, error: checkError } = await supabase
      .rpc('exec_sql', { 
        sql: `SELECT 1 FROM information_schema.columns WHERE table_name = 'tenants' AND column_name = 'smtp_settings'` 
      })
      .catch(() => ({ data: null, error: { message: 'RPC not available' } }));

    if (checkError && !checkError.message.includes('RPC not available')) {
      console.warn('⚠️  Could not check column existence via RPC. Trying direct approach...');
    }

    // Try direct SQL execution via query endpoint
    console.log('Attempting to add smtp_settings column...');
    
    // Use a simpler SQL that works with Supabase
    const addColumnSQL = `
      ALTER TABLE tenants 
      ADD COLUMN IF NOT EXISTS smtp_settings jsonb DEFAULT NULL;
    `;

    // Since Supabase client doesn't support raw SQL directly, 
    // we'll provide instructions for manual execution
    console.log('\n✅ Migration SQL prepared:');
    console.log('─'.repeat(60));
    console.log(addColumnSQL);
    console.log('─'.repeat(60));
    console.log('\n📝 Please run this SQL manually:');
    console.log('   1. Open Supabase Dashboard → SQL Editor');
    console.log('   2. Copy and paste the SQL above');
    console.log('   3. Click "Run"');
    console.log('\n   OR use psql:');
    console.log(`   psql -U postgres -d saudi_towerdb -f ${join(__dirname, '../supabase/migrations/20251203000001_add_smtp_settings_to_tenants.sql')}`);
    
    // Try to execute via a workaround - check if we can use the query API
    try {
      // This won't work with Supabase client, but we'll try
      console.log('\n⚠️  Direct SQL execution not available via Supabase client.');
      console.log('   Please use one of the methods above.\n');
    } catch (err) {
      console.error('❌ Error:', err.message);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('\n📝 Please run the migration manually:');
    console.log(`   psql -U postgres -d saudi_towerdb -f ${join(__dirname, '../supabase/migrations/20251203000001_add_smtp_settings_to_tenants.sql')}`);
  }
}

applyMigration();

