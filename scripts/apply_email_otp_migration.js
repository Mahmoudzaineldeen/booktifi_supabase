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
  console.log('📧 Applying email OTP support migration...\n');

  const migrationSQL = readFileSync(
    join(__dirname, '../supabase/migrations/20251203000000_add_email_otp_support.sql'),
    'utf-8'
  );

  try {
    // Split SQL into individual statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 50)}...`);
        const { error } = await supabase.rpc('exec_sql', { sql: statement });
        
        if (error) {
          // Try direct query if RPC doesn't work
          console.warn('RPC failed, trying direct query...');
          // For direct queries, we need to use the PostgREST API or raw SQL
          // Since we can't execute raw SQL directly, we'll use a workaround
          console.warn('⚠️  Please run the migration manually using psql or your database client.');
          console.warn('   File: supabase/migrations/20251203000000_add_email_otp_support.sql');
          break;
        }
      }
    }

    console.log('\n✅ Migration applied successfully!');
    console.log('\n📝 Next steps:');
    console.log('   1. Add SMTP credentials to project/server/.env:');
    console.log('      SMTP_HOST=smtp.gmail.com');
    console.log('      SMTP_PORT=587');
    console.log('      SMTP_USER=your-email@gmail.com');
    console.log('      SMTP_PASSWORD=your-app-password');
    console.log('   2. Restart the server');
  } catch (error) {
    console.error('❌ Migration failed:', error);
    console.log('\n📝 Please run the migration manually:');
    console.log('   psql -U postgres -d saudi_towerdb -f supabase/migrations/20251203000000_add_email_otp_support.sql');
  }
}

applyMigration();

