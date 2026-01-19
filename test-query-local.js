/**
 * Test Query Endpoint Locally
 * Tests the /query endpoint with array select parameter
 */

const API_URL = 'http://localhost:3001/api';

async function testQueryWithArray() {
  console.log('🧪 Testing /query endpoint with array select parameter...\n');

  // First, sign in to get a token
  console.log('1. Signing in...');
  const signinResponse = await fetch(`${API_URL}/auth/signin`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: 'mahmoudnzaineldeen@gmail.com',
      password: '111111',
      forCustomer: false,
    }),
  });

  if (!signinResponse.ok) {
    const error = await signinResponse.json();
    console.error('❌ Sign in failed:', error);
    return;
  }

  const signinData = await signinResponse.json();
  const token = signinData.session?.access_token;

  if (!token) {
    console.error('❌ No token received');
    return;
  }

  console.log('✅ Signed in successfully\n');

  // Test 1: Query with array select
  console.log('2. Testing query with array select: ["id"]');
  try {
    const queryResponse = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        table: 'services',
        select: ['id'],
        where: { tenant_id: signinData.user?.tenant_id },
        limit: 1,
      }),
    });

    const queryData = await queryResponse.json();

    if (!queryResponse.ok) {
      console.error('❌ Query failed:', queryData);
      console.error('   Status:', queryResponse.status);
      return;
    }

    console.log('✅ Query successful!');
    console.log('   Response:', JSON.stringify(queryData, null, 2));
  } catch (error) {
    console.error('❌ Query error:', error.message);
    return;
  }

  // Test 2: Query with string select (backward compatibility)
  console.log('\n3. Testing query with string select: "id"');
  try {
    const queryResponse = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        table: 'services',
        select: 'id',
        where: { tenant_id: signinData.user?.tenant_id },
        limit: 1,
      }),
    });

    const queryData = await queryResponse.json();

    if (!queryResponse.ok) {
      console.error('❌ Query failed:', queryData);
      return;
    }

    console.log('✅ Query successful!');
    console.log('   Response:', JSON.stringify(queryData, null, 2));
  } catch (error) {
    console.error('❌ Query error:', error.message);
    return;
  }

  // Test 3: Query with multiple columns in array
  console.log('\n4. Testing query with array select: ["id", "name"]');
  try {
    const queryResponse = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        table: 'services',
        select: ['id', 'name'],
        where: { tenant_id: signinData.user?.tenant_id },
        limit: 1,
      }),
    });

    const queryData = await queryResponse.json();

    if (!queryResponse.ok) {
      console.error('❌ Query failed:', queryData);
      return;
    }

    console.log('✅ Query successful!');
    console.log('   Response:', JSON.stringify(queryData, null, 2));
  } catch (error) {
    console.error('❌ Query error:', error.message);
    return;
  }

  console.log('\n✅ All tests completed!');
}

// Run tests
testQueryWithArray().catch(console.error);
