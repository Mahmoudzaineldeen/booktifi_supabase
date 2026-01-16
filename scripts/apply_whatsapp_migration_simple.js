import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from server directory
dotenv.config({ path: join(dirname(fileURLToPath(import.meta.url)), '..', 'server', '.env') });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Client } = pg;

// Use DATABASE_URL from .env
const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  console.error('❌ DATABASE_URL not found in .env file');
  console.error('   Please set DATABASE_URL in project/server/.env');
  process.exit(1);
}

const client = new Client({
  connectionString: databaseUrl,
  ssl: databaseUrl.includes('localhost') ? false : {
    rejectUnauthorized: false
  }
});

async function applyMigration() {
  try {
    console.log('🔌 Connecting to database...');
    await client.connect();
    console.log('✅ Connected to database');

    // Read migration file
    const migrationPath = join(__dirname, '..', 'supabase', 'migrations', '20251201000000_add_whatsapp_settings_to_tenants.sql');
    const migrationSQL = readFileSync(migrationPath, 'utf-8');

    console.log('📝 Applying migration: add_whatsapp_settings_to_tenants');
    await client.query(migrationSQL);

    console.log('✅ Migration applied successfully!');
    console.log('   WhatsApp settings column added to tenants table');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.message.includes('already exists')) {
      console.log('   Column may already exist. This is okay.');
    } else {
      console.error('   Full error:', error);
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

applyMigration();

