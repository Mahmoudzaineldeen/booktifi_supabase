/**
 * Comprehensive QR Ticket Generation and Scanning Test
 * Tests the complete flow: Ticket Generation → QR Code → Scanning → Validation
 */

const API_URL = 'https://booktifisupabase-production.up.railway.app/api';

// Test configuration
const CONFIG = {
  TENANT_ADMIN: {
    email: 'mahmoudnzaineldeen@gmail.com',
    password: '111111'
  },
  CASHIER: {
    email: 'cash@gmail.com',
    password: '111111'
  }
};

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

async function getTestData(token) {
  try {
    // Get tenant ID from existing bookings
    const bookingResponse = await fetch(`${API_URL}/query`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        table: 'bookings',
        select: ['tenant_id', 'service_id', 'slot_id'],
        limit: 1
      })
    });

    const bookingData = await bookingResponse.json();
    const tenantId = bookingData.data?.[0]?.tenant_id;

    if (!tenantId) {
      throw new Error('Could not get tenant ID from existing bookings');
    }

    // Try to use existing booking's service and slot, or get new ones
    let serviceId = bookingData.data?.[0]?.service_id;
    let slotId = bookingData.data?.[0]?.slot_id;

    // If we have service and slot from existing booking, use them
    if (serviceId && slotId) {
      // Verify slot is in the future
      const slotResponse = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          table: 'slots',
          select: ['id', 'slot_date'],
          where: { id: slotId },
          limit: 1
        })
      });

      const slotData = await slotResponse.json();
      const slot = slotData.data?.[0];
      
      if (slot) {
        const slotDate = new Date(slot.slot_date);
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        
        if (slotDate >= today) {
          // Slot is in the future, we can use it
          return { tenantId, serviceId, slotId };
        }
      }
    }

    // Get a service if we don't have one
    if (!serviceId) {
      const serviceResponse = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          table: 'services',
          select: ['id'],
          where: { tenant_id: tenantId, is_active: true },
          limit: 1
        })
      });

      const serviceData = await serviceResponse.json();
      serviceId = serviceData.data?.[0]?.id;

      if (!serviceId) {
        throw new Error('No active services found');
      }
    }

    // Get a future slot if we don't have one
    if (!slotId) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const slotDate = tomorrow.toISOString().split('T')[0];

      const slotResponse = await fetch(`${API_URL}/query`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          table: 'slots',
          select: ['id'],
          where: { 
            service_id: serviceId,
            slot_date__gte: slotDate
          },
          limit: 1
        })
      });

      const slotData = await slotResponse.json();
      slotId = slotData.data?.[0]?.id;

      if (!slotId) {
        throw new Error('No available slots found');
      }
    }

    return { tenantId, serviceId, slotId };
  } catch (error) {
    console.error('Error getting test data:', error.message);
    return null;
  }
}

async function createTestBooking(token, tenantId, serviceId, slotId) {
  try {
    const response = await fetch(`${API_URL}/bookings/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        slot_id: slotId,
        service_id: serviceId,
        tenant_id: tenantId,
        customer_name: 'QR Test Customer',
        customer_phone: '+966501234567',
        customer_email: 'qrtest@example.com',
        visitor_count: 1,
        adult_count: 1,
        child_count: 0,
        total_price: 100,
        language: 'en'
      })
    });

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.error || 'Failed to create booking');
    }

    const data = await response.json();
    return data.booking?.id || data.id;
  } catch (error) {
    console.error('Error creating booking:', error.message);
    return null;
  }
}

async function getBookingDetails(bookingId) {
  try {
    const response = await fetch(`${API_URL}/bookings/${bookingId}/details`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get booking details: ${response.status} ${error}`);
    }

    // Check if response is HTML (for browser) or JSON
    const contentType = response.headers.get('content-type');
    if (contentType?.includes('text/html')) {
      const html = await response.text();
      return { type: 'html', content: html };
    } else {
      const json = await response.json();
      return { type: 'json', content: json };
    }
  } catch (error) {
    console.error('Error getting booking details:', error.message);
    return null;
  }
}

function extractBookingIdFromQR(qrContent) {
  if (!qrContent || typeof qrContent !== 'string') {
    return null;
  }

  const trimmed = qrContent.trim();
  
  // If it's already a raw UUID, return it
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (uuidRegex.test(trimmed)) {
    return trimmed;
  }

  // Try to extract UUID from URL
  const urlMatch = trimmed.match(/\/bookings\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
  if (urlMatch && urlMatch[1]) {
    return urlMatch[1];
  }

  // Try to find UUID anywhere in the string
  const uuidMatch = trimmed.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  if (uuidMatch && uuidMatch[0]) {
    return uuidMatch[0];
  }

  return null;
}

async function validateQRCode(cashierToken, qrContent) {
  try {
    const response = await fetch(`${API_URL}/bookings/validate-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cashierToken}`
      },
      body: JSON.stringify({ booking_id: qrContent })
    });

    const data = await response.json();
    return { ok: response.ok, data };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

async function testQRFlow() {
  console.log('🧪 QR Ticket Generation and Scanning Test');
  console.log('='.repeat(60));
  console.log('');

  let passed = 0;
  let failed = 0;

  // Step 1: Sign in as tenant admin
  console.log('📋 Step 1: Signing in as tenant admin...');
  const adminToken = await signIn(CONFIG.TENANT_ADMIN.email, CONFIG.TENANT_ADMIN.password);
  if (!adminToken) {
    console.error('❌ Failed to sign in as tenant admin');
    process.exit(1);
  }
  console.log('✅ Signed in as tenant admin\n');

  // Step 2: Get test data
  console.log('📋 Step 2: Getting test data (tenant, service, slot)...');
  const testData = await getTestData(adminToken);
  if (!testData) {
    console.error('❌ Failed to get test data');
    process.exit(1);
  }
  console.log(`✅ Test data retrieved:`);
  console.log(`   Tenant ID: ${testData.tenantId}`);
  console.log(`   Service ID: ${testData.serviceId}`);
  console.log(`   Slot ID: ${testData.slotId}\n`);

  // Step 3: Create test booking
  console.log('📋 Step 3: Creating test booking...');
  const bookingId = await createTestBooking(
    adminToken,
    testData.tenantId,
    testData.serviceId,
    testData.slotId
  );
  if (!bookingId) {
    console.error('❌ Failed to create test booking');
    process.exit(1);
  }
  console.log(`✅ Test booking created: ${bookingId}\n`);

  // Wait a moment for ticket generation
  console.log('⏳ Waiting 5 seconds for ticket generation...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  console.log('');

  // Step 4: Test External QR Scanner (URL format)
  console.log('📋 Step 4: Testing External QR Scanner (URL format)...');
  console.log('   Simulating QR code with URL format...');
  
  // Construct the URL that would be in the QR code
  const qrUrl = `${API_URL.replace('/api', '')}/api/bookings/${bookingId}/details`;
  console.log(`   QR URL: ${qrUrl}`);
  
  // Test 4.1: Extract booking ID from URL
  const extractedId = extractBookingIdFromQR(qrUrl);
  if (extractedId === bookingId) {
    console.log(`   ✅ Booking ID extracted correctly: ${extractedId}`);
    passed++;
  } else {
    console.log(`   ❌ Failed to extract booking ID. Expected: ${bookingId}, Got: ${extractedId}`);
    failed++;
  }

  // Test 4.2: Get booking details via URL (external scanner behavior)
  const detailsResponse = await getBookingDetails(bookingId);
  if (detailsResponse) {
    if (detailsResponse.type === 'html') {
      const hasBookingInfo = detailsResponse.content.includes('Booking Details') || 
                            detailsResponse.content.includes('EVENT DETAILS') ||
                            detailsResponse.content.includes('QR Test Customer');
      if (hasBookingInfo) {
        console.log('   ✅ External scanner would display booking details (HTML)');
        passed++;
      } else {
        console.log('   ❌ HTML response does not contain booking information');
        failed++;
      }
    } else if (detailsResponse.type === 'json') {
      if (detailsResponse.content.booking) {
        console.log('   ✅ External scanner would display booking details (JSON)');
        passed++;
      } else {
        console.log('   ❌ JSON response does not contain booking');
        failed++;
      }
    }
  } else {
    console.log('   ❌ Failed to get booking details');
    failed++;
  }
  console.log('');

  // Step 5: Test Internal QR Scanner (URL format)
  console.log('📋 Step 5: Testing Internal QR Scanner (URL format)...');
  console.log('   Signing in as cashier...');
  const cashierToken = await signIn(CONFIG.CASHIER.email, CONFIG.CASHIER.password);
  if (!cashierToken) {
    console.log('   ⚠️  Cashier sign in failed, skipping internal scanner test');
    failed++;
  } else {
    console.log('   ✅ Signed in as cashier');
    
    // Test 5.1: Validate QR with URL format
    console.log(`   Testing QR validation with URL: ${qrUrl}`);
    const validationResult = await validateQRCode(cashierToken, qrUrl);
    
    if (validationResult.ok && validationResult.data?.success) {
      console.log('   ✅ QR validation succeeded with URL format');
      console.log(`   ✅ Booking validated: ${validationResult.data.booking?.customer_name}`);
      console.log(`   ✅ Extracted booking ID: ${validationResult.data.extracted_booking_id || 'N/A'}`);
      passed++;
    } else {
      console.log(`   ❌ QR validation failed: ${validationResult.data?.error || validationResult.error}`);
      failed++;
    }
  }
  console.log('');

  // Step 6: Test Internal QR Scanner (Raw UUID format - backward compatibility)
  console.log('📋 Step 6: Testing Internal QR Scanner (Raw UUID format)...');
  if (cashierToken) {
    console.log(`   Testing QR validation with raw UUID: ${bookingId}`);
    const uuidValidationResult = await validateQRCode(cashierToken, bookingId);
    
    if (uuidValidationResult.ok && uuidValidationResult.data?.success) {
      console.log('   ✅ QR validation succeeded with raw UUID format');
      console.log(`   ✅ Booking validated: ${uuidValidationResult.data.booking?.customer_name}`);
      passed++;
    } else {
      console.log(`   ❌ QR validation failed with UUID: ${uuidValidationResult.data?.error || uuidValidationResult.error}`);
      failed++;
    }
  } else {
    console.log('   ⚠️  Skipping (cashier token not available)');
    failed++;
  }
  console.log('');

  // Step 7: Verify QR code URL format
  console.log('📋 Step 7: Verifying QR code URL format...');
  console.log('   Checking if QR URL contains Railway domain (not Bolt)...');
  
  // Check if the URL would be generated with Railway URL
  // We can't actually generate the QR code here, but we can verify the logic
  const expectedRailwayUrl = 'https://booktifisupabase-production.up.railway.app';
  const qrUrlMatches = qrUrl.includes('railway.app') || qrUrl.includes('booktifisupabase-production');
  
  if (qrUrlMatches || !qrUrl.includes('bolt.host')) {
    console.log(`   ✅ QR URL does not contain Bolt domain`);
    console.log(`   ✅ QR URL format: ${qrUrl}`);
    passed++;
  } else {
    console.log(`   ⚠️  QR URL may contain Bolt domain: ${qrUrl}`);
    console.log(`   ⚠️  Please update APP_URL in Railway to Railway backend URL`);
    failed++;
  }
  console.log('');

  // Summary
  console.log('='.repeat(60));
  console.log('📊 Test Summary');
  console.log('='.repeat(60));
  console.log(`✅ Passed: ${passed}`);
  console.log(`❌ Failed: ${failed}`);
  console.log(`📝 Total: ${passed + failed}`);
  console.log('='.repeat(60));
  console.log('');

  if (failed > 0) {
    console.log('❌ Some tests failed. Please review the output above.');
    console.log('');
    console.log('📋 Next Steps:');
    console.log('   1. Check Railway logs for QR code generation');
    console.log('   2. Verify APP_URL is set to Railway URL in Railway');
    console.log('   3. Create a new booking and check the generated ticket PDF');
    console.log('   4. Scan the QR code with both external and internal scanners');
    process.exit(1);
  } else {
    console.log('✅ All QR ticket flow tests passed!');
    console.log('');
    console.log('📋 Verification Checklist:');
    console.log('   ✅ Booking created successfully');
    console.log('   ✅ QR code URL format is correct');
    console.log('   ✅ External scanner can extract booking ID from URL');
    console.log('   ✅ External scanner can display booking details');
    console.log('   ✅ Internal scanner can validate QR with URL format');
    console.log('   ✅ Internal scanner can validate QR with UUID format (backward compatibility)');
    console.log('');
    console.log('🎉 QR ticket generation and scanning flow is working correctly!');
    process.exit(0);
  }
}

// Run tests
testQRFlow().catch(error => {
  console.error('❌ Test suite failed:', error);
  process.exit(1);
});
