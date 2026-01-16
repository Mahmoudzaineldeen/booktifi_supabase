#!/usr/bin/env node

/**
 * Debug Tenant Insert
 * 
 * Tests tenant insert with detailed error logging
 */

const API_URL = 'http://localhost:3001/api';

async function testTenantInsert() {
  console.log('🔍 Debugging Tenant Insert...\n');

  // Test with minimal required fields
  const testTenant = {
    name: 'Debug Test Business',
    name_ar: 'شركة اختبار',
    industry: 'Technology',
  };

  console.log('Test 1: Insert with minimal fields (name, name_ar, industry)');
  console.log('Data:', JSON.stringify(testTenant, null, 2));
  console.log('');

  try {
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

    console.log(`Response Status: ${response.status}`);
    console.log(`Response Headers:`, Object.fromEntries(response.headers.entries()));
    console.log('Response Body:', JSON.stringify(result, null, 2));

    if (response.ok) {
      console.log('\n✅ Insert successful!');
      console.log('Tenant ID:', result.id);
      console.log('Slug:', result.slug);
    } else {
      console.error('\n❌ Insert failed!');
      console.error('Error:', result.error);
    }
  } catch (error) {
    console.error('\n❌ Request failed:', error.message);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('Check server terminal for detailed error logs');
  console.log('Look for lines starting with: [Insert] ❌');
  console.log('='.repeat(60));
}

testTenantInsert();
