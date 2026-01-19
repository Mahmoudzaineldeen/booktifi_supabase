/**
 * Test Query Endpoint - Railway Backend
 * Tests the /query endpoint with array select parameter against Railway production
 */

const API_URL = 'https://booktifisupabase-production.up.railway.app/api';

async function testQueryWithArray() {
  console.log('🧪 Testing /query endpoint with array select parameter...\n');
  console.log(`📍 Testing against: ${API_URL}\n`);

  // First, check if backend is accessible
  console.log('0. Checking backend health...');
  try {
    const healthUrl = API_URL.replace('/api', '');
    const healthResponse = await fetch(`${healthUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(10000), // 10 second timeout
    });
    
    if (healthResponse.ok) {
      console.log('✅ Backend is accessible\n');
    } else {
      console.warn('⚠️  Backend health check returned:', healthResponse.status);
    }
  } catch (error) {
    console.error('❌ Backend health check failed:', error.message);
    console.error('   This might indicate the backend is down or unreachable.\n');
    return;
  }

  // First, sign in to get a token
  console.log('1. Signing in...');
  try {
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
      signal: AbortSignal.timeout(15000), // 15 second timeout
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

    console.log('✅ Signed in successfully');
    console.log(`   User ID: ${signinData.user?.id}`);
    console.log(`   Tenant ID: ${signinData.user?.tenant_id}\n`);
  } catch (error) {
    console.error('❌ Sign in error:', error.message);
    if (error.name === 'AbortError') {
      console.error('   Request timed out. The backend might be slow or unreachable.');
    }
    return;
  }

  const signinData = await signinResponse.json();
  const token = signinData.session?.access_token;

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
      signal: AbortSignal.timeout(30000), // 30 second timeout
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
      signal: AbortSignal.timeout(30000), // 30 second timeout
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
      signal: AbortSignal.timeout(30000), // 30 second timeout
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
