import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

async function checkWhatsAppSettings() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Get all tenants with WhatsApp settings
    const result = await client.query(`
      SELECT id, name, whatsapp_settings
      FROM tenants
      WHERE whatsapp_settings IS NOT NULL
    `);

    console.log(`📊 Found ${result.rows.length} tenant(s) with WhatsApp settings:\n`);

    result.rows.forEach((tenant, index) => {
      console.log(`${index + 1}. Tenant: ${tenant.name} (${tenant.id})`);
      const settings = tenant.whatsapp_settings;
      if (settings) {
        console.log(`   Provider: ${settings.provider || 'NOT SET'}`);
        console.log(`   Phone Number ID: ${settings.phone_number_id || 'NOT SET'}`);
        console.log(`   Access Token: ${settings.access_token ? 'SET ✅' : 'NOT SET ❌'}`);
        
        // Check if phone_number_id looks like a phone number (starts with + or 0)
        if (settings.phone_number_id) {
          const phoneNumberId = settings.phone_number_id;
          if (phoneNumberId.startsWith('+') || phoneNumberId.startsWith('0') || phoneNumberId.length < 10) {
            console.log(`   ⚠️  WARNING: Phone Number ID looks like a phone number, not a Facebook Graph API ID!`);
            console.log(`      Expected format: 939237089264920 (15 digits, no + or 0 prefix)`);
            console.log(`      Current value: ${phoneNumberId}`);
          }
        }
      }
      console.log('');
    });

    console.log(`\n📋 Default settings from .env:`);
    console.log(`   Phone Number ID: ${process.env.WHATSAPP_PHONE_NUMBER_ID || 'NOT SET'}`);
    console.log(`   Access Token: ${process.env.WHATSAPP_ACCESS_TOKEN ? 'SET ✅' : 'NOT SET ❌'}`);
    console.log(`   Provider: ${process.env.WHATSAPP_PROVIDER || 'NOT SET'}`);

  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await client.end();
  }
}

checkWhatsAppSettings();

