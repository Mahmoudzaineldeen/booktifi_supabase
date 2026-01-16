#!/usr/bin/env node

/**
 * Check and Fix WhatsApp Settings for Tenant
 * 
 * Checks current WhatsApp settings and provides instructions to fix
 */

const API_URL = 'http://localhost:3001/api';
const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';
const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';

async function main() {
  console.log('\n' + '='.repeat(70));
  console.log('CHECK AND FIX WHATSAPP SETTINGS');
  console.log('='.repeat(70) + '\n');
  
  // Check server
  try {
    await fetch('http://localhost:3001/health');
    console.log('✓ Server is running\n');
  } catch (error) {
    console.error('❌ Server not running\n');
    process.exit(1);
  }
  
  // Login
  console.log('Step 1: Logging in...');
  let token = null;
  try {
    const res = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: '111111' }),
    });
    const data = await res.json();
    if (res.ok && data.session) {
      token = data.session.access_token;
      console.log('✓ Logged in\n');
    } else {
      console.error('✗ Login failed\n');
      process.exit(1);
    }
  } catch (error) {
    console.error('✗ Login error\n');
    process.exit(1);
  }
  
  // Check WhatsApp settings
  console.log('Step 2: Checking WhatsApp settings...\n');
  try {
    const res = await fetch(`${API_URL}/tenants/whatsapp-settings`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    
    const data = await res.json();
    
    if (res.ok) {
      const settings = data.whatsapp_settings;
      
      if (!settings) {
        console.log('❌ WhatsApp settings not configured\n');
        console.log('='.repeat(70));
        console.log('HOW TO FIX');
        console.log('='.repeat(70));
        console.log('');
        console.log('Option 1: Configure via UI (Recommended)');
        console.log('  1. Login as tenant admin');
        console.log('  2. Go to Settings page');
        console.log('  3. Navigate to WhatsApp Settings section');
        console.log('  4. Enter your WhatsApp configuration:');
        console.log('     - Provider: meta (or twilio, wati)');
        console.log('     - Phone Number ID: (from Meta Business)');
        console.log('     - Access Token: (from Meta Business)');
        console.log('     - API URL: (if using WATI)');
        console.log('     - API Key: (if using WATI)');
        console.log('  5. Save settings');
        console.log('');
        console.log('Option 2: Update via API');
        console.log('  Use PUT /api/tenants/whatsapp-settings endpoint');
        console.log('  with your WhatsApp configuration');
        console.log('');
        console.log('='.repeat(70));
        console.log('REQUIRED SETTINGS FOR META PROVIDER');
        console.log('='.repeat(70));
        console.log('');
        console.log('  provider: "meta"');
        console.log('  phone_number_id: "your_phone_number_id"');
        console.log('  access_token: "your_access_token"');
        console.log('');
        console.log('Get these from:');
        console.log('  https://business.facebook.com/settings/system-users');
        console.log('  or Meta Business Dashboard');
        console.log('');
      } else {
        console.log('✅ WhatsApp settings found:\n');
        console.log(`  Provider: ${settings.provider || 'NOT SET ❌'}`);
        console.log(`  Phone Number ID: ${settings.phone_number_id ? 'SET ✅' : 'NOT SET ❌'}`);
        console.log(`  Access Token: ${settings.access_token ? 'SET ✅' : 'NOT SET ❌'}`);
        console.log(`  API URL: ${settings.api_url || 'N/A'}`);
        console.log(`  API Key: ${settings.api_key ? 'SET ✅' : 'NOT SET ❌'}`);
        console.log('');
        
        // Check if required fields are set
        if (!settings.provider) {
          console.log('⚠️  Provider is not set - WhatsApp will not work');
        }
        
        if (settings.provider === 'meta') {
          if (!settings.phone_number_id || !settings.access_token) {
            console.log('⚠️  Missing required fields for Meta provider:');
            if (!settings.phone_number_id) console.log('     - phone_number_id');
            if (!settings.access_token) console.log('     - access_token');
          } else {
            console.log('✅ All required fields are set for Meta provider');
          }
        }
        console.log('');
      }
    } else {
      console.error(`❌ Error: ${data.error || 'Unknown error'}\n`);
    }
  } catch (error) {
    console.error(`❌ Error checking settings: ${error.message}\n`);
  }
  
  console.log('='.repeat(70));
  console.log('NEXT STEPS');
  console.log('='.repeat(70));
  console.log('');
  console.log('1. Configure WhatsApp settings via UI or API');
  console.log('2. Test by creating a booking');
  console.log('3. Check server console for ticket generation logs');
  console.log('4. Verify ticket is received via WhatsApp');
  console.log('');
}

main().catch(err => {
  console.error('\nFatal error:', err.message);
  process.exit(1);
});
