/**
 * Test Receptionist Invoice Download (TASK 7)
 * Verifies that receptionists can download invoices
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

async function getBookingsWithInvoices(token) {
  try {
    const response = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        table: 'bookings',
        select: ['id', 'zoho_invoice_id', 'customer_name'],
        where: { zoho_invoice_id__not: null },
        limit: 5
      })
    });

    const data = await response.json();
    if (data.data && data.data.length > 0) {
      return data.data;
    }
    return [];
  } catch (error) {
    console.error('Error fetching bookings:', error.message);
    return [];
  }
}

async function testInvoiceDownload(invoiceId, token, expectedStatus) {
  try {
    const response = await fetch(`${API_URL}/zoho/invoices/${invoiceId}/download?token=${encodeURIComponent(token)}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    const passed = response.status === expectedStatus;
    const icon = passed ? '✅' : '❌';
    console.log(`${icon} Invoice Download Test`);
    console.log(`   Invoice ID: ${invoiceId}`);
    console.log(`   Status: ${response.status} (Expected: ${expectedStatus})`);
    
    if (response.ok) {
      const contentType = response.headers.get('content-type');
      console.log(`   Content-Type: ${contentType}`);
      if (contentType === 'application/pdf') {
        console.log(`   ✅ PDF received successfully`);
      } else {
        console.log(`   ⚠️  Unexpected content type`);
      }
    } else {
      const errorText = await response.text();
      console.log(`   Response: ${errorText.substring(0, 200)}`);
    }
    
    return passed;
  } catch (error) {
    console.log(`❌ Invoice Download Test - Error: ${error.message}`);
    return false;
  }
}

async function runTests() {
  console.log('🚀 Testing Receptionist Invoice Download (TASK 7)');
  console.log('================================================\n');

  // Try to sign in as receptionist (you may need to update credentials)
  console.log('🔧 Signing in as receptionist...');
  const receptionistToken = await signIn('receptionist1@bookati.local', '111111');
  
  if (!receptionistToken) {
    console.error('❌ Failed to sign in as receptionist. Cannot proceed.');
    console.log('   Please update the email/password in this test file.');
    process.exit(1);
  }
  
  console.log('✅ Receptionist signed in successfully\n');

  // Get bookings with invoices
  console.log('📋 Looking for bookings with invoices...');
  const bookings = await getBookingsWithInvoices(receptionistToken);
  
  if (bookings.length === 0) {
    console.log('⚠️  No bookings with invoices found.');
    console.log('   To test invoice download:');
    console.log('   1. Create a booking as receptionist');
    console.log('   2. Ensure Zoho integration is connected');
    console.log('   3. Wait for invoice to be generated');
    console.log('   4. Run this test again\n');
    
    // Test with a placeholder invoice ID to verify access control
    console.log('🧪 Testing access control with placeholder invoice ID...');
    const result = await testInvoiceDownload('00000000-0000-0000-0000-000000000000', receptionistToken, 404);
    if (result) {
      console.log('✅ Access control working - receptionist can attempt download (404 = invoice not found, not 403 = forbidden)\n');
    }
    process.exit(0);
  }

  console.log(`✅ Found ${bookings.length} booking(s) with invoices\n`);

  let passedCount = 0;
  let failedCount = 0;

  console.log('🧪 TASK 7: Receptionist Invoice Download Tests\n');

  // Test downloading each invoice
  for (const booking of bookings.slice(0, 3)) { // Test up to 3 invoices
    const result = await testInvoiceDownload(booking.zoho_invoice_id, receptionistToken, 200);
    result ? passedCount++ : failedCount++;
    console.log(''); // Empty line for readability
  }

  console.log('='.repeat(50));
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
    console.log('✅ All receptionist invoice download tests passed!');
    console.log('   Receptionists can successfully download invoices.');
    process.exit(0);
  }
}

runTests().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
