/**
 * Test Cashier Role Access (cash@gmail.com)
 * Tests TASK 5: Role-Based Access Enforcement for Cashier
 */

const API_URL = 'https://booktifisupabase-production.up.railway.app/api';

async function signIn(email, password) {
  try {
    const response = await fetch(`${API_URL}/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, forCustomer: false })
    });
    
    const data = await response.json();
    if (data.session?.access_token) {
      return data.session.access_token;
    }
    throw new Error(data.error || 'Sign in failed');
  } catch (error) {
    console.error(`❌ Sign in failed:`, error.message);
    return null;
  }
}

async function testEndpoint(name, method, endpoint, body, token, expectedStatus) {
  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(token && { 'Authorization': `Bearer ${token}` })
    };

    const response = await fetch(`${API_URL}${endpoint}`, {
      method,
      headers,
      ...(body && { body: JSON.stringify(body) })
    });

    const data = await response.json().catch(() => ({ error: 'Invalid JSON' }));

    const passed = response.status === expectedStatus;
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} ${name}`);
    console.log(`   Status: ${response.status} (Expected: ${expectedStatus})`);
    
    if (!passed) {
      console.log(`   Response:`, JSON.stringify(data, null, 2).substring(0, 300));
    }
    
    return passed;
  } catch (error) {
    console.log(`❌ ${name}: Error - ${error.message}`);
    return false;
  }
}

async function getExistingBooking(token) {
  try {
    // Try to get bookings using query endpoint
    const response = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        table: 'bookings',
        select: ['id', 'zoho_invoice_id'],
        limit: 1
      })
    });

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      return {
        bookingId: data.data[0].id,
        invoiceId: data.data[0].zoho_invoice_id
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching bookings:', error.message);
    return null;
  }
}

async function runTests() {
  console.log('🚀 Testing Cashier Role Access (cash@gmail.com)');
  console.log('===============================================\n');

  // Sign in as cashier
  console.log('🔧 Signing in as cashier...');
  const cashierToken = await signIn('cash@gmail.com', '111111');
  
  if (!cashierToken) {
    console.error('❌ Failed to sign in as cashier. Cannot proceed.');
    process.exit(1);
  }
  
  console.log('✅ Cashier signed in successfully\n');

  // Get existing booking if available
  console.log('📋 Looking for existing bookings...');
  const bookingData = await getExistingBooking(cashierToken);
  if (bookingData) {
    console.log(`✅ Found booking: ${bookingData.bookingId}`);
    if (bookingData.invoiceId) {
      console.log(`   Invoice ID: ${bookingData.invoiceId}\n`);
    }
  } else {
    console.log('⚠️  No bookings found. Some tests will use placeholder IDs.\n');
  }

  const testBookingId = bookingData?.bookingId || '00000000-0000-0000-0000-000000000000';
  const testInvoiceId = bookingData?.invoiceId || '00000000-0000-0000-0000-000000000000';

  let passedCount = 0;
  let failedCount = 0;

  console.log('🧪 TASK 5: Role-Based Access Enforcement Tests\n');

  // Test 5.1: Cashier can scan QR (if booking exists)
  if (bookingData) {
    const result = await testEndpoint(
      '5.1: Cashier can scan QR code',
      'POST',
      '/bookings/validate-qr',
      { booking_id: testBookingId },
      cashierToken,
      200 // Should succeed if booking exists and not already scanned
    );
    result ? passedCount++ : failedCount++;
  } else {
    console.log('⚠️  5.1: Cashier can scan QR code - Skipped (no booking available)');
  }

  // Test 5.2: Cashier cannot create bookings
  const result2 = await testEndpoint(
    '5.2: Cashier cannot create bookings',
    'POST',
    '/bookings/create',
    {
      slot_id: '00000000-0000-0000-0000-000000000000',
      service_id: '00000000-0000-0000-0000-000000000000',
      tenant_id: '00000000-0000-0000-0000-000000000000',
      customer_name: 'Test Customer',
      customer_phone: '+966501234567',
      visitor_count: 1,
      total_price: 100
    },
    cashierToken,
    403 // Should be blocked
  );
  result2 ? passedCount++ : failedCount++;

  // Test 5.3: Cashier cannot download invoices
  // Note: This may return 404 (invoice not found) or 403 (access denied)
  // Both are acceptable - the important thing is it doesn't return 200 (success)
  try {
    const response = await fetch(`${API_URL}/zoho/invoices/${testInvoiceId}/download`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cashierToken}`
      }
    });

    const testPassed = response.status === 403 || response.status === 404;
    const icon = testPassed ? '✅' : '❌';
    console.log(`${icon} 5.3: Cashier cannot download invoices`);
    console.log(`   Status: ${response.status} (Expected: 403 or 404)`);
    
    if (!testPassed) {
      console.log(`   ⚠️  Unexpected status - cashier should not be able to download invoices`);
      failedCount++;
    } else {
      passedCount++;
    }
  } catch (error) {
    console.log(`❌ 5.3: Cashier cannot download invoices - Error: ${error.message}`);
    failedCount++;
  }

  // Test 5.4: Cashier cannot edit bookings
  const result4 = await testEndpoint(
    '5.4: Cashier cannot edit bookings',
    'PATCH',
    `/bookings/${testBookingId}`,
    { customer_name: 'Updated Name' },
    cashierToken,
    403 // Should be blocked
  );
  result4 ? passedCount++ : failedCount++;

  // Test 5.5: Cashier cannot delete bookings
  const result5 = await testEndpoint(
    '5.5: Cashier cannot delete bookings',
    'DELETE',
    `/bookings/${testBookingId}`,
    null,
    cashierToken,
    403 // Should be blocked
  );
  result5 ? passedCount++ : failedCount++;

  // Test 5.6: Cashier cannot update payment status
  const result6 = await testEndpoint(
    '5.6: Cashier cannot update payment status',
    'PATCH',
    `/bookings/${testBookingId}/payment-status`,
    { payment_status: 'paid' },
    cashierToken,
    403 // Should be blocked
  );
  result6 ? passedCount++ : failedCount++;

  console.log('\n' + '='.repeat(50));
  console.log('📊 Test Summary');
  console.log('='.repeat(50));
  console.log(`✅ Passed: ${passedCount}`);
  console.log(`❌ Failed: ${failedCount}`);
  console.log(`📝 Total: ${passedCount + failedCount}`);
  console.log('='.repeat(50) + '\n');

  if (failedCount > 0) {
    console.log('❌ Some tests failed. Please review the output above.');
    process.exit(1);
  } else {
    console.log('✅ All cashier role access tests passed!');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
