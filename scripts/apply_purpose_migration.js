import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import dotenv from 'dotenv';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: path.join(__dirname, '..', 'server', '.env') });

async function applyMigration() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
  });

  try {
    await client.connect();
    console.log('✅ Connected to database');

    // Read migration file
    const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20251201000001_add_purpose_to_otp_requests.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('\n📝 Applying migration: add_purpose_to_otp_requests');
    console.log('================================================\n');

    // Execute migration
    await client.query(migrationSQL);

    console.log('✅ Migration applied successfully!');
    console.log('\n📊 Verifying migration...');

    // Verify the column exists
    const result = await client.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'otp_requests' AND column_name = 'purpose'
    `);

    if (result.rows.length > 0) {
      console.log('✅ Column "purpose" exists:');
      console.log(`   Type: ${result.rows[0].data_type}`);
      console.log(`   Default: ${result.rows[0].column_default}`);
    } else {
      console.log('❌ Column "purpose" not found');
    }

    // Check indexes
    const indexResult = await client.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'otp_requests' AND indexname LIKE '%purpose%'
    `);

    if (indexResult.rows.length > 0) {
      console.log('\n✅ Indexes created:');
      indexResult.rows.forEach(row => {
        console.log(`   - ${row.indexname}`);
      });
    }

    console.log('\n✅ Migration completed successfully!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.message.includes('already exists')) {
      console.log('ℹ️  Column may already exist. This is safe to ignore.');
    } else {
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

applyMigration();

