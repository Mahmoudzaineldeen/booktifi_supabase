import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Pool } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
});

const migrations = [
  '20250129000000_create_zoho_tokens_table.sql',
  '20250129000001_create_zoho_invoice_logs_table.sql',
  '20250129000002_add_zoho_invoice_id_to_bookings.sql',
  '20250129000003_create_zoho_receipt_trigger.sql',
];

async function applyMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('📦 Applying Zoho Integration Migrations...\n');
    
    for (const migrationFile of migrations) {
      console.log(`\n🔄 Applying: ${migrationFile}`);
      
      const migrationPath = join(__dirname, '..', 'supabase', 'migrations', migrationFile);
      const migrationSQL = readFileSync(migrationPath, 'utf8');
      
      // Split by semicolons and execute each statement
      const statements = migrationSQL
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));
      
      await client.query('BEGIN');
      
      try {
        for (const statement of statements) {
          // Skip RLS policies that use auth.uid() (Supabase-specific)
          if (statement.includes('auth.uid()')) {
            console.log('   ⏭️  Skipping RLS policy (requires Supabase auth context)');
            continue;
          }
          
          try {
            await client.query(statement);
          } catch (stmtError) {
            // If it's an auth.uid() error, skip it
            if (stmtError.message && stmtError.message.includes('auth.uid()')) {
              console.log('   ⏭️  Skipping statement (requires Supabase)');
              continue;
            }
            // If it's a "already exists" error, that's OK
            if (stmtError.code === '42P07' || stmtError.code === '42710') {
              console.log('   ℹ️  Already exists, skipping...');
              continue;
            }
            throw stmtError;
          }
        }
        
        await client.query('COMMIT');
        console.log(`   ✅ ${migrationFile} applied successfully!`);
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    
    console.log('\n✅ All Zoho migrations applied successfully!');
    
  } catch (error) {
    console.error('\n❌ Error applying migrations:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

applyMigrations().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

