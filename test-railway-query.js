/**
 * Test Query Endpoint - Railway Backend
 * Direct test of the query endpoint fix
 */

const API_URL = 'https://booktifisupabase-production.up.railway.app/api';

async function testQueryEndpoint() {
  console.log('🧪 Testing /query endpoint on Railway backend...\n');
  console.log(`📍 URL: ${API_URL}\n`);

  // Step 1: Health check
  console.log('Step 1: Health check...');
  try {
    const healthResponse = await fetch('https://booktifisupabase-production.up.railway.app/health', {
      method: 'GET',
      signal: AbortSignal.timeout(10000),
    });
    
    if (healthResponse.ok) {
      const healthData = await healthResponse.text();
      console.log('✅ Backend is healthy:', healthData);
    } else {
      console.warn('⚠️  Health check status:', healthResponse.status);
    }
  } catch (error) {
    console.error('❌ Health check failed:', error.message);
    return;
  }

  // Step 2: Sign in (with longer timeout for Railway cold starts)
  console.log('\nStep 2: Signing in...');
  let token, tenantId;
  
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
      signal: AbortSignal.timeout(60000), // 60 second timeout for Railway
    });

    if (!signinResponse.ok) {
      const error = await signinResponse.json();
      console.error('❌ Sign in failed:', error);
      return;
    }

    const signinData = await signinResponse.json();
    token = signinData.session?.access_token;
    tenantId = signinData.user?.tenant_id;

    if (!token) {
      console.error('❌ No token received');
      return;
    }

    console.log('✅ Signed in successfully');
    console.log(`   Tenant ID: ${tenantId}`);
  } catch (error) {
    console.error('❌ Sign in error:', error.message);
    if (error.name === 'AbortError') {
      console.error('   Request timed out after 60 seconds.');
      console.error('   Railway might be cold-starting. Try again in a moment.');
    }
    return;
  }

  // Step 3: Test query with array select
  console.log('\nStep 3: Testing query with array select: ["id"]');
  try {
    const queryBody = {
      table: 'services',
      select: ['id'],
      where: { tenant_id: tenantId },
      limit: 1,
    };
    
    console.log('   Request body:', JSON.stringify(queryBody, null, 2));
    
    const queryResponse = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(queryBody),
      signal: AbortSignal.timeout(60000), // 60 second timeout
    });

    let queryData;
    try {
      queryData = await queryResponse.json();
    } catch (parseError) {
      const text = await queryResponse.text();
      console.error('❌ Failed to parse response as JSON');
      console.error('   Status:', queryResponse.status);
      console.error('   Response text:', text);
      return;
    }

    if (!queryResponse.ok) {
      console.error('❌ Query failed!');
      console.error('   Status:', queryResponse.status);
      console.error('   Error:', JSON.stringify(queryData, null, 2));
      
      // Check if it's the select.trim error
      if (queryData.error && (queryData.error.includes('trim') || queryData.error.includes('is not a function'))) {
        console.error('\n❌❌❌ THE FIX IS NOT DEPLOYED YET! ❌❌❌');
        console.error('   The error indicates the old code is still running.');
        console.error('   Railway needs to deploy the latest code from GitHub.');
        console.error('   Check Railway dashboard for deployment status.');
      }
      return;
    }

    console.log('✅ Query successful!');
    console.log('   Response:', JSON.stringify(queryData, null, 2));
    console.log('\n✅✅✅ THE FIX IS WORKING! ✅✅✅');
  } catch (error) {
    console.error('❌ Query error:', error.message);
    if (error.cause) {
      console.error('   Cause:', error.cause);
    }
    if (error.name === 'AbortError') {
      console.error('   Request timed out after 60 seconds.');
    }
    return;
  }

  // Step 4: Test query with string select (backward compatibility)
  console.log('\nStep 4: Testing query with string select: "id"');
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
        where: { tenant_id: tenantId },
        limit: 1,
      }),
      signal: AbortSignal.timeout(30000),
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

  // Step 5: Test query with multiple columns
  console.log('\nStep 5: Testing query with array select: ["id", "name"]');
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
        where: { tenant_id: tenantId },
        limit: 1,
      }),
      signal: AbortSignal.timeout(30000),
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

  console.log('\n✅✅✅ All tests completed successfully! ✅✅✅');
  console.log('   The fix is deployed and working on Railway!');
}

// Run tests
testQueryEndpoint().catch(console.error);
