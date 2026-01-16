#!/usr/bin/env node

/**
 * Check WhatsApp OTP Configuration
 * 
 * This script checks:
 * 1. If WhatsApp settings are configured for tenants
 * 2. If users have phone numbers
 * 3. When OTPs will be sent via WhatsApp
 */

const API_URL = 'http://localhost:3001/api';

async function checkWhatsAppOTPConfig() {
  console.log('🔍 Checking WhatsApp OTP Configuration...\n');

  try {
    // Check server
    try {
      console.log('Checking server status...');
      const healthCheck = await fetch('http://localhost:3001/health');
      const healthData = await healthCheck.json();
      if (!healthCheck.ok) {
        console.error('❌ Server is not healthy!');
        console.error('   Response:', healthData);
        process.exit(1);
      }
      console.log('✅ Server is running\n');
    } catch (error) {
      console.error('❌ Cannot connect to server!');
      console.error('   Error:', error.message);
      console.error('   Please start the server: cd server && npm run dev');
      process.exit(1);
    }

    // Get all tenants
    console.log('📋 Checking Tenants...\n');
    const tenantsResponse = await fetch(`${API_URL}/query?table=tenants&select=id,name,whatsapp_settings&limit=10`);
    const tenants = await tenantsResponse.json();
    const tenantsArray = Array.isArray(tenants) ? tenants : (tenants.data || []);

    if (tenantsArray.length === 0) {
      console.log('⚠️  No tenants found\n');
    } else {
      tenantsArray.forEach((tenant, i) => {
        console.log(`${i + 1}. Tenant: ${tenant.name} (${tenant.id})`);
        
        if (tenant.whatsapp_settings) {
          const ws = tenant.whatsapp_settings;
          console.log(`   ✅ WhatsApp Settings Configured:`);
          console.log(`      Provider: ${ws.provider || 'NOT SET ❌'}`);
          
          if (ws.provider === 'meta') {
            console.log(`      Phone Number ID: ${ws.phone_number_id ? ws.phone_number_id : 'NOT SET ❌'}`);
            console.log(`      Access Token: ${ws.access_token ? 'SET ✅' : 'NOT SET ❌'}`);
          } else if (ws.provider === 'twilio') {
            console.log(`      Account SID: ${ws.account_sid ? 'SET ✅' : 'NOT SET ❌'}`);
            console.log(`      Auth Token: ${ws.auth_token ? 'SET ✅' : 'NOT SET ❌'}`);
            console.log(`      From: ${ws.from || 'NOT SET ❌'}`);
          } else if (ws.provider === 'wati') {
            console.log(`      API URL: ${ws.api_url || 'NOT SET ❌'}`);
            console.log(`      API Key: ${ws.api_key ? 'SET ✅' : 'NOT SET ❌'}`);
          }
          
          // Check if configuration is complete
          let isComplete = false;
          if (ws.provider === 'meta' && ws.phone_number_id && ws.access_token) {
            isComplete = true;
          } else if (ws.provider === 'twilio' && ws.account_sid && ws.auth_token && ws.from) {
            isComplete = true;
          } else if (ws.provider === 'wati' && ws.api_url && ws.api_key) {
            isComplete = true;
          }
          
          if (isComplete) {
            console.log(`      Status: ✅ READY - OTPs will be sent via WhatsApp`);
          } else {
            console.log(`      Status: ⚠️  INCOMPLETE - Missing required fields`);
          }
        } else {
          console.log(`   ❌ WhatsApp Settings NOT Configured`);
          console.log(`      OTPs will NOT be sent via WhatsApp for this tenant`);
          console.log(`      Configure in: Tenant Settings → WhatsApp Settings`);
        }
        console.log('');
      });
    }

    // Check users with phone numbers
    console.log('📱 Checking Users with Phone Numbers...\n');
    const usersResponse = await fetch(
      `${API_URL}/query?table=users&select=id,email,phone,role,tenant_id&limit=20`
    );
    const users = await usersResponse.json();
    const usersArray = Array.isArray(users) ? users : (users.data || []);
    
    const usersWithPhone = usersArray.filter(u => u.phone && u.phone.trim() !== '');
    const usersWithoutPhone = usersArray.filter(u => !u.phone || u.phone.trim() === '');

    console.log(`Total users checked: ${usersArray.length}`);
    console.log(`Users with phone: ${usersWithPhone.length} ✅`);
    console.log(`Users without phone: ${usersWithoutPhone.length} ⚠️\n`);

    if (usersWithPhone.length > 0) {
      console.log('Users who CAN receive WhatsApp OTPs:');
      usersWithPhone.slice(0, 5).forEach((user, i) => {
        console.log(`   ${i + 1}. ${user.email || user.id}`);
        console.log(`      Phone: ${user.phone}`);
        console.log(`      Role: ${user.role}`);
        console.log(`      Tenant: ${user.tenant_id || 'N/A'}`);
        console.log('');
      });
      if (usersWithPhone.length > 5) {
        console.log(`   ... and ${usersWithPhone.length - 5} more\n`);
      }
    }

    if (usersWithoutPhone.length > 0) {
      console.log('Users who CANNOT receive WhatsApp OTPs (no phone):');
      usersWithoutPhone.slice(0, 5).forEach((user, i) => {
        console.log(`   ${i + 1}. ${user.email || user.id}`);
        console.log(`      Role: ${user.role}`);
        console.log('');
      });
      if (usersWithoutPhone.length > 5) {
        console.log(`   ... and ${usersWithoutPhone.length - 5} more\n`);
      }
    }

    // Summary
    console.log('📊 Summary:\n');
    console.log('OTPs are AUTOMATICALLY sent via WhatsApp when:');
    console.log('  1. ✅ User enters their PHONE NUMBER (auto-detected by frontend)');
    console.log('  2. ✅ User has a phone number stored in their account');
    console.log('  3. ✅ Tenant has WhatsApp settings configured');
    console.log('  4. ✅ WhatsApp provider credentials are valid\n');
    console.log('OR manually when method="whatsapp" is explicitly set\n');

    console.log('If WhatsApp fails, the system will:');
    console.log('  → Automatically fallback to email (if user has email)\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

checkWhatsAppOTPConfig();
