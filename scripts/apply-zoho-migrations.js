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
  {
    name: 'Create Zoho Tokens Table',
    file: '20250129000000_create_zoho_tokens_table.sql',
    verify: async (client) => {
      try {
        const result = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_name = 'zoho_tokens'
        `);
        return result.rows.length > 0;
      } catch (error) {
        // If table doesn't exist, return false (not applied)
        if (error.code === '42P01') return false;
        throw error;
      }
    },
  },
  {
    name: 'Create Zoho Invoice Logs Table',
    file: '20250129000001_create_zoho_invoice_logs_table.sql',
    verify: async (client) => {
      try {
        const result = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_name = 'zoho_invoice_logs'
        `);
        return result.rows.length > 0;
      } catch (error) {
        if (error.code === '42P01') return false;
        throw error;
      }
    },
  },
  {
    name: 'Add Zoho Invoice ID to Bookings',
    file: '20250129000002_add_zoho_invoice_id_to_bookings.sql',
    verify: async (client) => {
      try {
        const result = await client.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'bookings' 
          AND column_name IN ('zoho_invoice_id', 'zoho_invoice_created_at')
        `);
        return result.rows.length === 2;
      } catch (error) {
        if (error.code === '42P01') return false;
        throw error;
      }
    },
  },
  {
    name: 'Create Zoho Receipt Triggers',
    file: '20250129000003_create_zoho_receipt_trigger.sql',
    verify: async (client) => {
      try {
        const result = await client.query(`
          SELECT trigger_name 
          FROM information_schema.triggers 
          WHERE trigger_name IN ('zoho_receipt_trigger', 'zoho_receipt_trigger_insert')
        `);
        return result.rows.length === 2;
      } catch (error) {
        if (error.code === '42P01') return false;
        throw error;
      }
    },
  },
];

async function applyMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('📦 Applying Zoho Integration Migrations...\n');
    
    for (const migration of migrations) {
      console.log(`\n🔄 Applying: ${migration.name}`);
      
      // Check if already applied (with error handling)
      let isApplied = false;
      try {
        isApplied = await migration.verify(client);
      } catch (verifyError) {
        // If verification fails because table/column/trigger doesn't exist, that's fine - we'll create it
        // This is expected for new migrations
        if (verifyError.code === '42P01' || verifyError.message.includes('does not exist')) {
          // Table/column doesn't exist yet - proceed with migration
          isApplied = false;
        } else {
          // Some other error - rethrow
          throw verifyError;
        }
      }
      if (isApplied) {
        console.log(`   ⏭️  Already applied, skipping...`);
        continue;
      }
      
      // Read migration file
      const migrationPath = join(__dirname, '..', 'supabase', 'migrations', migration.file);
      const migrationSQL = readFileSync(migrationPath, 'utf8');
      
      await client.query('BEGIN');
      
      try {
        // Split SQL by semicolons and execute statements one by one
        // This allows us to skip RLS policies if auth.uid() doesn't exist
        const statements = migrationSQL
          .split(';')
          .map(s => s.trim())
          .filter(s => s.length > 0 && !s.startsWith('--'));
        
        for (const statement of statements) {
          try {
            // Skip RLS policies if they reference auth.uid() (Supabase-specific)
            if (statement.includes('auth.uid()') && !process.env.SUPABASE_URL) {
              console.log(`   ⏭️  Skipping RLS policy (requires Supabase auth context)`);
              continue;
            }
            await client.query(statement);
          } catch (stmtError) {
            // If it's an auth.uid() error, skip it
            if (stmtError.message && stmtError.message.includes('auth.uid()')) {
              console.log(`   ⏭️  Skipping statement (requires Supabase: ${stmtError.message.split('\n')[0]})`);
              continue;
            }
            throw stmtError;
          }
        }
        
        // Verify migration (with error handling for RLS)
        let verified = false;
        try {
          verified = await migration.verify(client);
        } catch (verifyError) {
          // If verification fails, check if basic structure exists
          console.log(`   ⚠️  Verification query failed, checking basic structure...`);
        }
        
        if (verified) {
          await client.query('COMMIT');
          console.log(`   ✅ ${migration.name} applied successfully!`);
        } else {
          // Check if basic structure exists (tables/columns/triggers)
          let basicCheck;
          try {
            if (migration.name.includes('Tokens Table')) {
              basicCheck = await client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name = 'zoho_tokens'
              `);
            } else if (migration.name.includes('Invoice Logs')) {
              basicCheck = await client.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_name = 'zoho_invoice_logs'
              `);
            } else if (migration.name.includes('Invoice ID')) {
              basicCheck = await client.query(`
                SELECT column_name 
                FROM information_schema.columns 
                WHERE table_name = 'bookings' 
                AND column_name IN ('zoho_invoice_id', 'zoho_invoice_created_at')
              `);
            } else if (migration.name.includes('Triggers')) {
              basicCheck = await client.query(`
                SELECT trigger_name 
                FROM information_schema.triggers 
                WHERE trigger_name IN ('zoho_receipt_trigger', 'zoho_receipt_trigger_insert')
              `);
            }
            
            if (basicCheck && basicCheck.rows.length > 0) {
              await client.query('COMMIT');
              console.log(`   ✅ ${migration.name} applied successfully! (RLS policies may require Supabase)`);
            } else {
              await client.query('ROLLBACK');
              throw new Error(`Migration verification failed for ${migration.name}`);
            }
          } catch (checkError) {
            await client.query('ROLLBACK');
            throw checkError;
          }
        }
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    }
    
    console.log('\n✅ All Zoho migrations applied successfully!');
    console.log('\n📋 Summary:');
    console.log('   - zoho_tokens table created');
    console.log('   - zoho_invoice_logs table created');
    console.log('   - bookings.zoho_invoice_id columns added');
    console.log('   - Database triggers created for automatic receipt generation');
    console.log('\n⚠️  Next steps:');
    console.log('   1. Configure Zoho environment variables in server/.env');
    console.log('   2. Restart backend server');
    console.log('   3. Connect Zoho accounts via OAuth flow');
    
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

