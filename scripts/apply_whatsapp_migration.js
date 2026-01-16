import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { Client } = pg;

const client = new Client({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'bookati',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

async function applyMigration() {
  try {
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
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

applyMigration();

