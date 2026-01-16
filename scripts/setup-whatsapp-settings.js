#!/usr/bin/env node

/**
 * Setup Test WhatsApp Settings
 * 
 * Adds test WhatsApp settings to the tenant for testing purposes
 */

const API_URL = 'http://localhost:3001/api';

async function login(email, password) {
  const response = await fetch(`${API_URL}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Login failed');
  return data;
}

async function updateWhatsAppSettings(token, settings) {
  const response = await fetch(`${API_URL}/tenants/whatsapp-settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(settings),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to update WhatsApp settings');
  return result;
}

async function main() {
  console.log('🔧 Setting up test WhatsApp settings...\n');

  try {
    // Login as service provider
    console.log('1️⃣  Logging in as service provider...');
    const sp = await login('mahmoudnzaineldeen@gmail.com', '111111');
    const token = sp.session.access_token;
    console.log(`✅ Logged in. Tenant: ${sp.tenant.name}\n`);

    // Set test WhatsApp settings (using a test provider)
    console.log('2️⃣  Configuring test WhatsApp settings...');
    const testSettings = {
      provider: 'meta', // or 'twilio', 'wati'
      // For testing, we'll use placeholder values
      // In production, these would be real credentials
      phone_number_id: 'TEST_PHONE_NUMBER_ID',
      access_token: 'TEST_ACCESS_TOKEN',
      api_url: 'https://graph.facebook.com/v18.0',
    };

    const result = await updateWhatsAppSettings(token, testSettings);
    console.log('✅ WhatsApp settings configured');
    console.log('   Provider:', testSettings.provider);
    console.log('   Note: These are test settings. Real WhatsApp messages will not be sent.\n');

    console.log('='.repeat(60));
    console.log('📊 SUMMARY');
    console.log('='.repeat(60));
    console.log('✅ WhatsApp settings added to tenant');
    console.log('⚠️  These are test settings - real messages will not be sent');
    console.log('   To enable real WhatsApp delivery, configure real credentials in Settings.\n');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
