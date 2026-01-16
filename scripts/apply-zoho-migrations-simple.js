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

async function applyMigrations() {
  const client = await pool.connect();
  
  try {
    console.log('📦 Applying Zoho Integration Migrations...\n');
    
    await client.query('BEGIN');
    
    // Migration 1: Create zoho_tokens table
    console.log('🔄 Creating zoho_tokens table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS zoho_tokens (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
        access_token text NOT NULL,
        refresh_token text NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz DEFAULT now() NOT NULL,
        updated_at timestamptz DEFAULT now() NOT NULL,
        UNIQUE(tenant_id)
      );
    `);
    
    await client.query('CREATE INDEX IF NOT EXISTS idx_zoho_tokens_tenant_id ON zoho_tokens(tenant_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_zoho_tokens_expires_at ON zoho_tokens(expires_at);');
    
    // Skip RLS for now (requires Supabase auth context)
    console.log('   ⏭️  Skipping RLS policies (requires Supabase auth context)');
    
    // Create updated_at trigger function
    await client.query(`
      CREATE OR REPLACE FUNCTION update_zoho_tokens_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = now();
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    await client.query(`
      DROP TRIGGER IF EXISTS zoho_tokens_updated_at ON zoho_tokens;
      CREATE TRIGGER zoho_tokens_updated_at
        BEFORE UPDATE ON zoho_tokens
        FOR EACH ROW
        EXECUTE FUNCTION update_zoho_tokens_updated_at();
    `);
    
    console.log('   ✅ zoho_tokens table created');
    
    // Migration 2: Create zoho_invoice_logs table
    console.log('\n🔄 Creating zoho_invoice_logs table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS zoho_invoice_logs (
        id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE,
        tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
        zoho_invoice_id text,
        status text NOT NULL CHECK (status IN ('success', 'failed', 'pending')),
        error_message text,
        request_payload jsonb,
        response_payload jsonb,
        created_at timestamptz DEFAULT now() NOT NULL
      );
    `);
    
    await client.query('CREATE INDEX IF NOT EXISTS idx_zoho_invoice_logs_booking_id ON zoho_invoice_logs(booking_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_zoho_invoice_logs_tenant_id ON zoho_invoice_logs(tenant_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_zoho_invoice_logs_status ON zoho_invoice_logs(status);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_zoho_invoice_logs_created_at ON zoho_invoice_logs(created_at);');
    
    console.log('   ⏭️  Skipping RLS policies (requires Supabase auth context)');
    console.log('   ✅ zoho_invoice_logs table created');
    
    // Migration 3: Add columns to bookings
    console.log('\n🔄 Adding Zoho columns to bookings table...');
    await client.query(`
      ALTER TABLE bookings 
      ADD COLUMN IF NOT EXISTS zoho_invoice_id text,
      ADD COLUMN IF NOT EXISTS zoho_invoice_created_at timestamptz;
    `);
    
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_bookings_zoho_invoice_id 
      ON bookings(zoho_invoice_id) 
      WHERE zoho_invoice_id IS NOT NULL;
    `);
    
    console.log('   ✅ Columns added to bookings table');
    
    // Migration 4: Create triggers
    console.log('\n🔄 Creating Zoho receipt triggers...');
    
    await client.query(`
      CREATE OR REPLACE FUNCTION trigger_zoho_receipt_on_payment()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid') THEN
          IF NEW.zoho_invoice_id IS NULL THEN
            INSERT INTO queue_jobs (job_type, payload, status)
            VALUES (
              'zoho_receipt',
              jsonb_build_object(
                'booking_id', NEW.id,
                'tenant_id', NEW.tenant_id,
                'attempt', 0
              ),
              'pending'
            );
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    await client.query(`
      DROP TRIGGER IF EXISTS zoho_receipt_trigger ON bookings;
      CREATE TRIGGER zoho_receipt_trigger
      AFTER UPDATE OF payment_status ON bookings
      FOR EACH ROW
      WHEN (NEW.payment_status = 'paid' AND (OLD.payment_status IS NULL OR OLD.payment_status != 'paid'))
      EXECUTE FUNCTION trigger_zoho_receipt_on_payment();
    `);
    
    await client.query(`
      CREATE OR REPLACE FUNCTION trigger_zoho_receipt_on_insert()
      RETURNS TRIGGER AS $$
      BEGIN
        IF NEW.payment_status = 'paid' AND NEW.zoho_invoice_id IS NULL THEN
          INSERT INTO queue_jobs (job_type, payload, status)
          VALUES (
            'zoho_receipt',
            jsonb_build_object(
              'booking_id', NEW.id,
              'tenant_id', NEW.tenant_id,
              'attempt', 0
            ),
            'pending'
          );
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    
    await client.query(`
      DROP TRIGGER IF EXISTS zoho_receipt_trigger_insert ON bookings;
      CREATE TRIGGER zoho_receipt_trigger_insert
      AFTER INSERT ON bookings
      FOR EACH ROW
      WHEN (NEW.payment_status = 'paid')
      EXECUTE FUNCTION trigger_zoho_receipt_on_insert();
    `);
    
    console.log('   ✅ Triggers created');
    
    await client.query('COMMIT');
    
    console.log('\n✅ All Zoho migrations applied successfully!');
    console.log('\n📋 Summary:');
    console.log('   - zoho_tokens table created');
    console.log('   - zoho_invoice_logs table created');
    console.log('   - bookings.zoho_invoice_id columns added');
    console.log('   - Database triggers created');
    console.log('\n⚠️  Note: RLS policies skipped (require Supabase auth context)');
    console.log('   They can be added later if using Supabase');
    
  } catch (error) {
    await client.query('ROLLBACK');
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

