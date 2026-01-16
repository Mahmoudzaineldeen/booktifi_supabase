/**
 * Script to update WhatsApp access token in database
 */

import pg from 'pg';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const { Pool } = pg;

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// New access token
const NEW_ACCESS_TOKEN = 'EAAL1SdkJ7ysBQHPKM93mN9ZAYImF3pY1mvPm7t4bPcj1tZCCzAnvXMJL1FgaMmhG2ZCmXOYs5CQ5S80Xf8xTp0iZATFOWF11LZBDlhLUhFegyZBkzUcaLvktdM0u5yTapcKc1embUkedtvyTZB7yDw8sqIPuJjcBAcky8ZBC4m4D2e1OSaichxEpNwLTZC9mQhVMzogZDZD';

async function updateWhatsAppToken() {
  console.log('\n📱 ============================================');
  console.log('📱 Updating WhatsApp Access Token');
  console.log('📱 ============================================\n');

  try {
    // Get all tenants
    const tenantsResult = await pool.query('SELECT id, name, whatsapp_settings FROM tenants');

    console.log(`Found ${tenantsResult.rows.length} tenant(s)\n`);

    for (const tenant of tenantsResult.rows) {
      let whatsappSettings = tenant.whatsapp_settings || {};
      
      // Ensure provider is set
      if (!whatsappSettings.provider) {
        whatsappSettings.provider = 'meta';
      }

      // Update access token
      whatsappSettings.access_token = NEW_ACCESS_TOKEN;
      
      // If phone_number_id is not set or looks like a phone number, use the one from .env
      if (!whatsappSettings.phone_number_id || 
          whatsappSettings.phone_number_id.startsWith('+') || 
          whatsappSettings.phone_number_id.startsWith('0')) {
        if (process.env.WHATSAPP_PHONE_NUMBER_ID) {
          whatsappSettings.phone_number_id = process.env.WHATSAPP_PHONE_NUMBER_ID;
          console.log(`   Updated phone_number_id for tenant ${tenant.name}`);
        }
      }

      // Update tenant
      await pool.query(
        'UPDATE tenants SET whatsapp_settings = $1 WHERE id = $2',
        [whatsappSettings, tenant.id]
      );

      console.log(`✅ Updated tenant: ${tenant.name} (${tenant.id})`);
      console.log(`   Provider: ${whatsappSettings.provider}`);
      console.log(`   Phone Number ID: ${whatsappSettings.phone_number_id || 'NOT SET'}`);
      console.log(`   Access Token: SET ✅`);
      console.log('');
    }

    // Also update .env file if possible
    console.log('📝 Note: Also update WHATSAPP_ACCESS_TOKEN in server/.env file:');
    console.log(`   WHATSAPP_ACCESS_TOKEN=${NEW_ACCESS_TOKEN}`);
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

updateWhatsAppToken();

