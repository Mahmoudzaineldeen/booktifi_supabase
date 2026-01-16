#!/usr/bin/env node

/**
 * Test Tenant Insert
 * 
 * Tests inserting a tenant to see what error occurs
 */

const API_URL = 'http://localhost:3001/api';

async function testTenantInsert() {
  console.log('🧪 Testing Tenant Insert...\n');

  try {
    // Test data
    const testTenant = {
      name: 'Test Business',
      name_ar: 'شركة اختبار',
      industry: 'Technology',
      contact_email: 'test@example.com',
      contact_phone: '+201032560826',
    };

    console.log('Attempting to insert tenant with data:');
    console.log(JSON.stringify(testTenant, null, 2));
    console.log('');

    const response = await fetch(`${API_URL}/insert/tenants`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data: testTenant,
        returning: '*',
      }),
    });

    const result = await response.json();

    if (response.ok) {
      console.log('✅ Tenant inserted successfully!');
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.error('❌ Insert failed:');
      console.error(`   Status: ${response.status}`);
      console.error(`   Error: ${result.error || 'Unknown error'}`);
      console.error(`   Full response:`, JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }
}

testTenantInsert();
