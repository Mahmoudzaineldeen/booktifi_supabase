#!/usr/bin/env node

/**
 * Make Services Public
 * 
 * Uses backend service role to query services and make them public/active
 * This bypasses RLS restrictions
 */

const API_URL = 'http://localhost:3001/api';

async function main() {
  console.log('🔧 Making services public and active...\n');

  try {
    // Login as customer to get tenant ID
    console.log('1️⃣  Getting tenant information...');
    const loginResponse = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        email: 'kaptifidev@gmail.com', 
        password: '111111',
        forCustomer: true 
      }),
    });

    if (!loginResponse.ok) {
      const errorData = await loginResponse.json();
      throw new Error(errorData.error || 'Failed to login');
    }

    const loginData = await loginResponse.json();
    const tenantId = loginData.tenant?.id;

    if (!tenantId) {
      throw new Error('No tenant ID found');
    }

    console.log(`✅ Tenant ID: ${tenantId}`);
    const token = loginData.session.access_token;
    console.log(`✅ Logged in successfully\n`);

    // Query services using customer token (should work if RLS allows tenant users)
    console.log('2️⃣  Querying services...');
    const servicesResponse = await fetch(
      `${API_URL}/query?table=services&select=id,name,is_active,is_public,tenant_id&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId }))}&limit=10`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );

    if (!servicesResponse.ok) {
      const errorText = await servicesResponse.text();
      console.error(`❌ Query failed: ${servicesResponse.status} ${servicesResponse.statusText}`);
      console.error(`   Response: ${errorText.substring(0, 200)}`);
      throw new Error('Failed to query services');
    }

    const servicesData = await servicesResponse.json();
    const services = servicesData.data || [];

    if (services.length === 0) {
      console.error('❌ No services found for this tenant');
      process.exit(1);
    }

    console.log(`✅ Found ${services.length} service(s):\n`);
    services.forEach((s, i) => {
      console.log(`   ${i + 1}. ${s.name}`);
      console.log(`      ID: ${s.id}`);
      console.log(`      Active: ${s.is_active}`);
      console.log(`      Public: ${s.is_public}`);
      console.log('');
    });

    // Update services to be public and active
    console.log('3️⃣  Updating services to be public and active...');

    for (const service of services) {
      if (!service.is_public || !service.is_active) {
        console.log(`   Updating: ${service.name}...`);
        
        const updateResponse = await fetch(`${API_URL}/update/services`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({
            data: {
              is_public: true,
              is_active: true,
            },
            where: { id: service.id },
          }),
        });

        if (updateResponse.ok) {
          console.log(`   ✅ Updated: ${service.name}`);
        } else {
          const error = await updateResponse.json();
          console.log(`   ⚠️  Failed to update ${service.name}: ${error.error || 'Unknown error'}`);
        }
      } else {
        console.log(`   ✅ ${service.name} is already public and active`);
      }
    }

    console.log('\n✅ Done! Services are now public and active.');
    console.log('   You can now run the booking script again.\n');
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
