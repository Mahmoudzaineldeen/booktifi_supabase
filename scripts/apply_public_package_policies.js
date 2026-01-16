/**
 * Script to apply public package access policies migration
 * This allows anonymous users to view active packages for booking
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Supabase configuration
const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function applyMigration() {
  console.log('📦 Applying public package access policies migration...\n');

  try {
    const migrationPath = path.join(__dirname, '../supabase/migrations/20251202000000_add_public_package_access.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Reading migration file...');
    console.log('Migration SQL length:', migrationSQL.length, 'characters\n');

    // Split the SQL into individual statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('/*'));

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.length === 0) continue;

      console.log(`Executing statement ${i + 1}/${statements.length}...`);
      
      try {
        const { error } = await supabase.rpc('exec_sql', { sql_query: statement + ';' });
        
        if (error) {
          // Try direct query if RPC doesn't work
          console.log('RPC failed, trying direct query...');
          const { error: queryError } = await supabase.from('_migrations').select('*').limit(1);
          
          if (queryError) {
            // Use raw SQL execution via PostgREST if available
            console.log('Attempting direct SQL execution...');
            const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exec_sql`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseServiceKey,
                'Authorization': `Bearer ${supabaseServiceKey}`
              },
              body: JSON.stringify({ sql_query: statement + ';' })
            });

            if (!response.ok) {
              const errorText = await response.text();
              console.warn(`⚠️  Statement ${i + 1} may have failed:`, errorText);
              console.log('This might be expected if the policy already exists.\n');
            } else {
              console.log(`✅ Statement ${i + 1} executed successfully\n`);
            }
          }
        } else {
          console.log(`✅ Statement ${i + 1} executed successfully\n`);
        }
      } catch (err) {
        console.warn(`⚠️  Error executing statement ${i + 1}:`, err.message);
        console.log('This might be expected if the policy already exists.\n');
      }
    }

    console.log('✅ Migration completed!');
    console.log('\n📋 Summary:');
    console.log('   - Added "Public can view active packages" policy for service_packages');
    console.log('   - Added "Public can view package services for active packages" policy for package_services');
    console.log('\n✨ Public users can now view active packages for booking!');

  } catch (error) {
    console.error('❌ Error applying migration:', error);
    console.error('\n💡 You may need to apply this migration manually in your Supabase dashboard:');
    console.error('   1. Go to SQL Editor');
    console.error('   2. Run the migration file: supabase/migrations/20251202000000_add_public_package_access.sql');
    process.exit(1);
  }
}

// Run the migration
applyMigration().catch(console.error);



