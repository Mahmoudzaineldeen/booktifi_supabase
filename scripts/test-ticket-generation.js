#!/usr/bin/env node

/**
 * Test Ticket Generation with Tenant Branding
 * 
 * Creates a test booking and verifies ticket generation uses tenant branding
 */

const API_URL = 'http://localhost:3001/api';

async function login(email, password) {
  const response = await fetch(`${API_URL}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Login failed');
  return data;
}

async function updateLandingPageSettings(token, settings) {
  const response = await fetch(`${API_URL}/query`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({
      table: 'tenants',
      data: { landing_page_settings: settings },
      where: { id: settings.tenant_id },
    }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to update settings');
  return result;
}

async function createTestBooking(token, bookingData) {
  const response = await fetch(`${API_URL}/bookings/create`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(bookingData),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Failed to create booking');
  return result;
}

async function main() {
  console.log('🧪 Testing Ticket Generation with Tenant Branding...\n');

  try {
    // Login as service provider
    console.log('1️⃣  Logging in as service provider...');
    const sp = await login('mahmoudnzaineldeen@gmail.com', '111111');
    const token = sp.session.access_token;
    const tenantId = sp.tenant.id;
    const tenantSlug = sp.tenant.slug;
    console.log(`✅ Logged in. Tenant: ${sp.tenant.name} (${tenantSlug})\n`);

    // Set custom branding colors
    console.log('2️⃣  Setting custom branding colors...');
    const customSettings = {
      tenant_id: tenantId,
      primary_color: '#FF5733', // Custom orange
      secondary_color: '#33C3F0', // Custom light blue
      hero_title: 'Test Service',
      hero_title_ar: 'خدمة اختبار',
    };

    // Update tenant settings
    const { data: tenant } = await fetch(
      `${API_URL}/query?table=tenants&select=id,landing_page_settings&where=${encodeURIComponent(JSON.stringify({ id: tenantId }))}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()).then(d => d.data?.[0]);

    if (tenant) {
      const currentSettings = tenant.landing_page_settings || {};
      const updatedSettings = {
        ...currentSettings,
        ...customSettings,
      };

      const updateResult = await fetch(`${API_URL}/update/tenants`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          data: { landing_page_settings: updatedSettings },
          where: { id: tenantId },
        }),
      }).then(r => r.json());

      if (updateResult.error) {
        console.log(`   ⚠️  Could not update settings: ${updateResult.error}`);
        console.log('   Using default colors for testing.\n');
      } else {
        console.log(`✅ Custom colors set:`);
        console.log(`   Primary: ${customSettings.primary_color}`);
        console.log(`   Secondary: ${customSettings.secondary_color}\n`);
      }
    }

    // Get services and slots
    console.log('3️⃣  Getting available services and slots...');
    const services = await fetch(
      `${API_URL}/query?table=services&select=id,name&where=${encodeURIComponent(JSON.stringify({ tenant_id: tenantId, is_active: true }))}&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()).then(d => d.data || []);

    if (services.length === 0) {
      console.error('❌ No services found. Please create a service first.');
      process.exit(1);
    }

    const service = services[0];
    console.log(`✅ Found service: ${service.name}\n`);

    // Get shifts for this service
    const shifts = await fetch(
      `${API_URL}/query?table=shifts&select=id&where=${encodeURIComponent(JSON.stringify({ service_id: service.id, is_active: true }))}&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()).then(d => d.data || []);

    if (shifts.length === 0) {
      console.error('❌ No shifts found for this service. Please create a shift first.');
      process.exit(1);
    }

    const shift = shifts[0];

    // Get available slots
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];

    const slots = await fetch(
      `${API_URL}/query?table=slots&select=id,start_time&where=${encodeURIComponent(JSON.stringify({ shift_id: shift.id, slot_date: dateStr, is_available: true }))}&limit=1`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    ).then(r => r.json()).then(d => d.data || []);

    if (slots.length === 0) {
      console.error('❌ No available slots found. Please generate slots first.');
      process.exit(1);
    }

    const slot = slots[0];
    console.log(`✅ Found available slot: ${dateStr} at ${slot.start_time}\n`);

    // Acquire lock
    console.log('4️⃣  Acquiring booking lock...');
    const lockResponse = await fetch(`${API_URL}/bookings/lock`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        slot_id: slot.id,
        reserved_capacity: 1,
      }),
    });

    const lockData = await lockResponse.json();
    if (!lockResponse.ok) {
      throw new Error(lockData.error || 'Failed to acquire lock');
    }
    console.log(`✅ Lock acquired: ${lockData.lock_id}\n`);

    // Create booking
    console.log('5️⃣  Creating test booking...');
    const booking = await createTestBooking(token, {
      slot_id: slot.id,
      service_id: service.id,
      tenant_id: tenantId,
      customer_name: 'Test Customer',
      customer_phone: '+201032560826',
      customer_email: 'test@example.com',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: 100.00,
      lock_id: lockData.lock_id,
      session_id: lockData.session_id,
      language: 'en',
    });

    console.log(`✅ Booking created: ${booking.id || booking.booking?.id}\n`);

    console.log('='.repeat(60));
    console.log('📊 TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`✅ Booking ID: ${booking.id || booking.booking?.id}`);
    console.log(`✅ Ticket should be generated with tenant branding`);
    console.log(`\n📝 Check server logs for:`);
    console.log(`   - PDF generation messages`);
    console.log(`   - Color extraction from landing_page_settings`);
    console.log(`   - WhatsApp/Email delivery status`);
    console.log(`\n📧 Ticket should be sent to:`);
    console.log(`   - WhatsApp: +201032560826`);
    console.log(`   - Email: test@example.com`);
    console.log(`\n🎨 Ticket should use:`);
    console.log(`   - Primary Color: ${customSettings.primary_color} (if set)`);
    console.log(`   - Secondary Color: ${customSettings.secondary_color} (if set)`);
    console.log(`   - Default colors if custom colors not set`);
    console.log('\n✅ Test complete! Check server logs and email/WhatsApp for ticket.\n');
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    process.exit(1);
  }
}

main();
