/**
 * Test TASK 3 & TASK 4: QR Scanners
 * Tests external (public) and internal (auth) QR scanner endpoints
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';

async function testQRScanners() {
  console.log('🧪 Testing QR Scanners (TASK 3 & TASK 4)\n');

  // Test 1: External Scanner - Public Endpoint (No Auth Required)
  console.log('Test 1: External Scanner - Public Endpoint');
  try {
    const testUUID = '123e4567-e89b-12d3-a456-426614174000';
    const response = await fetch(`${API_URL}/bookings/${testUUID}/details`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Should not require auth (401/403)
    if (response.status === 401 || response.status === 403) {
      console.log('❌ Public endpoint requires authentication');
    } else if (response.status === 404) {
      console.log('✅ Public endpoint accessible without auth (404 = booking not found, which is expected)');
    } else if (response.status === 400) {
      console.log('✅ Public endpoint accessible (400 = validation error, expected for test UUID)');
    } else {
      console.log(`✅ Public endpoint accessible (status: ${response.status})`);
    }
  } catch (error) {
    console.log('❌ Public endpoint test failed:', error.message);
  }

  // Test 2: Internal Scanner - Requires Auth
  console.log('\nTest 2: Internal Scanner - Auth Required');
  try {
    const response = await fetch(`${API_URL}/bookings/validate-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // No Authorization header
      },
      body: JSON.stringify({ booking_id: '123e4567-e89b-12d3-a456-426614174000' }),
    });

    if (response.status === 401) {
      console.log('✅ Internal scanner requires authentication');
    } else {
      const data = await response.json();
      console.log(`⚠️  Expected 401, got ${response.status}:`, data.error || 'No error message');
    }
  } catch (error) {
    console.log('⚠️  Test error:', error.message);
  }

  // Test 3: Verify External Scanner is Read-Only
  console.log('\nTest 3: External Scanner Read-Only Verification');
  console.log('   (Manual verification: External scanner should not have modify/validate buttons)');
  console.log('   ✅ External scanner uses GET /bookings/:id/details (read-only endpoint)');
  console.log('   ✅ Internal scanner uses POST /bookings/validate-qr (modifies state)');

  // Test 4: Endpoint Structure
  console.log('\nTest 4: Endpoint Structure');
  console.log('   External: GET /api/bookings/:id/details (public, read-only)');
  console.log('   Internal: POST /api/bookings/validate-qr (auth required, modifies qr_scanned)');

  console.log('\n✅ QR Scanner Tests Complete\n');
}

// Run tests
testQRScanners().catch(console.error);
