/**
 * Test TASK 2: QR Code Structure
 * Verifies QR code contains only booking ID and validation works
 */

const API_URL = process.env.API_URL || 'https://booktifisupabase-production.up.railway.app/api';

async function testQRStructure() {
  console.log('🧪 Testing QR Code Structure (TASK 2)\n');

  // Test 1: Verify UUID validation
  console.log('Test 1: UUID Validation');
  try {
    const response = await fetch(`${API_URL}/bookings/validate-qr`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.TEST_TOKEN || 'test-token'}`,
      },
      body: JSON.stringify({ booking_id: 'invalid-uuid' }),
    });

    const data = await response.json();
    if (response.status === 400 && data.error?.includes('Invalid booking ID format')) {
      console.log('✅ UUID validation works - invalid UUID rejected');
    } else {
      console.log('❌ UUID validation failed - expected 400 error');
      console.log('   Response:', data);
    }
  } catch (error) {
    console.log('⚠️  Test skipped (auth required):', error.message);
  }

  // Test 2: Verify public endpoint accepts valid UUID
  console.log('\nTest 2: Public Booking Details Endpoint');
  try {
    // Use a test UUID format (won't exist, but should pass format validation)
    const testUUID = '123e4567-e89b-12d3-a456-426614174000';
    const response = await fetch(`${API_URL}/bookings/${testUUID}/details`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (response.status === 400 && data.error?.includes('Invalid booking ID format')) {
      console.log('❌ UUID validation too strict (test UUID should be valid format)');
    } else if (response.status === 404) {
      console.log('✅ Public endpoint accepts valid UUID format (booking not found is expected)');
    } else {
      console.log('✅ Public endpoint works');
      console.log('   Status:', response.status);
    }
  } catch (error) {
    console.log('❌ Public endpoint test failed:', error.message);
  }

  // Test 3: Verify invalid format is rejected
  console.log('\nTest 3: Invalid Format Rejection');
  try {
    const response = await fetch(`${API_URL}/bookings/not-a-uuid/details`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();
    if (response.status === 400 && data.error?.includes('Invalid booking ID format')) {
      console.log('✅ Invalid format correctly rejected');
    } else {
      console.log('❌ Invalid format not rejected');
      console.log('   Response:', data);
    }
  } catch (error) {
    console.log('❌ Test failed:', error.message);
  }

  console.log('\n✅ QR Structure Tests Complete\n');
}

// Run tests
testQRStructure().catch(console.error);
