import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

async function fixWhatsAppPhoneNumberId() {
  const client = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:1111@localhost:5432/saudi_towerdb',
  });

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    const correctPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const correctAccessToken = process.env.WHATSAPP_ACCESS_TOKEN;

    if (!correctPhoneNumberId) {
      console.error('❌ WHATSAPP_PHONE_NUMBER_ID not set in .env');
      process.exit(1);
    }

    console.log(`📝 Fixing WhatsApp settings in database...`);
    console.log(`   Correct Phone Number ID: ${correctPhoneNumberId}\n`);

    // Get all tenants with WhatsApp settings
    const result = await client.query(`
      SELECT id, name, whatsapp_settings
      FROM tenants
      WHERE whatsapp_settings IS NOT NULL
    `);

    for (const tenant of result.rows) {
      const settings = tenant.whatsapp_settings;
      if (settings && settings.phone_number_id) {
        const currentPhoneNumberId = settings.phone_number_id;
        
        // Check if it looks like a phone number (starts with + or 0, or too short)
        if (currentPhoneNumberId.startsWith('+') || currentPhoneNumberId.startsWith('0') || currentPhoneNumberId.length < 10) {
          console.log(`⚠️  Fixing tenant: ${tenant.name}`);
          console.log(`   Current Phone Number ID: ${currentPhoneNumberId} (WRONG - looks like phone number)`);
          
          // Update with correct Phone Number ID
          const updatedSettings = {
            ...settings,
            phone_number_id: correctPhoneNumberId,
          };
          
          // Also update access token if it's not set or looks wrong
          if (!settings.access_token && correctAccessToken) {
            updatedSettings.access_token = correctAccessToken;
            console.log(`   Also updating Access Token`);
          }
          
          await client.query(
            'UPDATE tenants SET whatsapp_settings = $1 WHERE id = $2',
            [updatedSettings, tenant.id]
          );
          
          console.log(`   ✅ Updated Phone Number ID to: ${correctPhoneNumberId}`);
          console.log('');
        } else {
          console.log(`✅ Tenant ${tenant.name} has correct Phone Number ID: ${currentPhoneNumberId}`);
        }
      }
    }

    console.log('✅ Done!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

fixWhatsAppPhoneNumberId();

