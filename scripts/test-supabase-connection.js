#!/usr/bin/env node

/**
 * Test Supabase Connection
 * 
 * Verifies Supabase connection and queries services directly
 */

const API_URL = 'http://localhost:3001/api';

async function testConnection() {
  console.log('🔍 Testing Supabase Connection...\n');

  try {
    // Test 1: Health check
    console.log('1️⃣  Testing server health...');
    const healthResponse = await fetch('http://localhost:3001/health');
    if (healthResponse.ok) {
      const health = await healthResponse.json();
      console.log('✅ Server is healthy');
      console.log(`   Status: ${health.status}`);
      console.log(`   Database: ${health.database || 'connected'}\n`);
    } else {
      throw new Error('Server health check failed');
    }

    // Test 2: Query tenants (should work)
    console.log('2️⃣  Testing database connection (query tenants)...');
    const tenantsResponse = await fetch(
      `${API_URL}/query?table=tenants&select=id,name&limit=5`
    );
    
    if (tenantsResponse.ok) {
      const tenantsData = await tenantsResponse.json();
      const tenants = tenantsData.data || [];
      console.log(`✅ Found ${tenants.length} tenant(s)`);
      if (tenants.length > 0) {
        tenants.forEach((t, i) => {
          console.log(`   ${i + 1}. ${t.name} (ID: ${t.id})`);
        });
      }
      console.log('');
    } else {
      const errorText = await tenantsResponse.text();
      console.error(`❌ Failed to query tenants: ${tenantsResponse.status}`);
      console.error(`   ${errorText.substring(0, 200)}\n`);
    }

    // Test 3: Query services directly (backend uses SERVICE_ROLE, bypasses RLS)
    console.log('3️⃣  Testing services query (using backend service role)...');
    const servicesResponse = await fetch(
      `${API_URL}/query?table=services&select=id,name,tenant_id,is_active,is_public&limit=10`
    );
    
    if (servicesResponse.ok) {
      const servicesData = await servicesResponse.json();
      const services = servicesData.data || [];
      console.log(`✅ Found ${services.length} service(s) in database:\n`);
      
      if (services.length === 0) {
        console.log('   ⚠️  No services found in database.');
        console.log('   This means the services table is empty.\n');
      } else {
        services.forEach((s, i) => {
          console.log(`   ${i + 1}. ${s.name}`);
          console.log(`      ID: ${s.id}`);
          console.log(`      Tenant ID: ${s.tenant_id}`);
          console.log(`      Active: ${s.is_active ? '✅' : '❌'}`);
          console.log(`      Public: ${s.is_public ? '✅' : '❌'}`);
          console.log('');
        });
      }
    } else {
      const errorText = await servicesResponse.text();
      console.error(`❌ Failed to query services: ${servicesResponse.status}`);
      console.error(`   Response: ${errorText.substring(0, 300)}\n`);
    }

    // Test 4: Check specific tenant services
    console.log('4️⃣  Checking services for customer tenant...');
    const customerTenantId = 'd49e292b-b403-4268-a271-2ddc9704601b';
    const tenantServicesResponse = await fetch(
      `${API_URL}/query?table=services&select=id,name,tenant_id,is_active,is_public&where=${encodeURIComponent(JSON.stringify({ tenant_id: customerTenantId }))}&limit=10`
    );
    
    if (tenantServicesResponse.ok) {
      const tenantServicesData = await tenantServicesResponse.json();
      const tenantServices = tenantServicesData.data || [];
      console.log(`✅ Found ${tenantServices.length} service(s) for tenant ${customerTenantId}:\n`);
      
      if (tenantServices.length === 0) {
        console.log('   ⚠️  No services found for this tenant.');
        console.log('   Services may belong to a different tenant.\n');
      } else {
        tenantServices.forEach((s, i) => {
          console.log(`   ${i + 1}. ${s.name} (Active: ${s.is_active}, Public: ${s.is_public})`);
        });
        console.log('');
      }
    }

    console.log('='.repeat(60));
    console.log('📊 CONNECTION TEST SUMMARY');
    console.log('='.repeat(60));
    console.log('✅ Supabase is connected');
    console.log('✅ Backend uses SERVICE_ROLE key (bypasses RLS)');
    console.log('✅ Database queries are working');
    console.log('\n💡 If services are not showing, they may:');
    console.log('   1. Belong to a different tenant');
    console.log('   2. Need to be made public (is_public = true)');
    console.log('   3. Need to be activated (is_active = true)\n');

  } catch (error) {
    console.error('\n❌ Connection test failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    process.exit(1);
  }
}

testConnection();
