#!/usr/bin/env node

/**
 * Check Services Directly
 * 
 * Uses backend to query services directly (bypasses RLS via service role)
 */

const API_URL = 'http://localhost:3001/api';

async function main() {
  console.log('🔍 Checking services in database...\n');

  try {
    // Query ALL services (no filter) - backend uses SERVICE_ROLE
    console.log('Querying all services (no authentication, backend uses service role)...');
    const response = await fetch(
      `${API_URL}/query?table=services&select=id,name,is_active,is_public,tenant_id&limit=20`
    );

    if (!response.ok) {
      const text = await response.text();
      console.error(`❌ Query failed: ${response.status}`);
      console.error(`   Response: ${text.substring(0, 300)}`);
      process.exit(1);
    }

    const data = await response.json();
    const services = data.data || [];

    console.log(`\n✅ Found ${services.length} service(s) in database:\n`);

    if (services.length === 0) {
      console.log('   No services found in database.');
      console.log('   Please create services first.\n');
      process.exit(0);
    }

    services.forEach((s, i) => {
      console.log(`${i + 1}. ${s.name}`);
      console.log(`   ID: ${s.id}`);
      console.log(`   Tenant ID: ${s.tenant_id}`);
      console.log(`   Active: ${s.is_active ? '✅' : '❌'}`);
      console.log(`   Public: ${s.is_public ? '✅' : '❌'}`);
      console.log('');
    });

    // Check customer tenant
    console.log('\n📋 Customer tenant ID: d49e292b-b403-4268-a271-2ddc9704601b\n');

    const customerTenantServices = services.filter(s => s.tenant_id === 'd49e292b-b403-4268-a271-2ddc9704601b');
    
    if (customerTenantServices.length > 0) {
      console.log(`✅ Found ${customerTenantServices.length} service(s) for customer tenant:\n`);
      customerTenantServices.forEach((s, i) => {
        console.log(`${i + 1}. ${s.name} (Active: ${s.is_active}, Public: ${s.is_public})`);
      });
      console.log('\n💡 If services are not active/public, they need to be updated.');
    } else {
      console.log('⚠️  No services found for customer tenant ID.');
      console.log('   Services exist but belong to different tenant(s).\n');
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

main();
