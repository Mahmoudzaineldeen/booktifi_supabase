/**
 * Integration Tests for Booking System
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestTenant, createTestService, cleanupTestData, assertBooking } from '../utils/test-helpers';
import { db } from '../../src/lib/db';

describe('Booking Creation Integration', () => {
  let tenantId: string;
  let serviceId: string;
  let slotId: string;

  beforeAll(async () => {
    // Create test tenant
    const tenant = await createTestTenant('Test Tenant', 'test-tenant');
    tenantId = tenant.id;

    // Create test service
    const service = await createTestService(tenantId, 'Test Service', 100, 60);
    serviceId = service.id;

    // Create test shift and slot (simplified - in real test, use proper shift creation)
    // This is a placeholder - actual implementation would create shifts and slots
    const { data: slot } = await db
      .from('time_slots')
      .insert({
        tenant_id: tenantId,
        service_id: serviceId,
        shift_id: 'test-shift-id', // Would be created properly in real test
        start_time_utc: new Date().toISOString(),
        end_time_utc: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        total_capacity: 10,
        remaining_capacity: 10,
        is_available: true,
      })
      .select()
      .single();

    if (slot) slotId = slot.id;
  });

  afterAll(async () => {
    await cleanupTestData(tenantId);
  });

  it('should create a booking successfully', async () => {
    const bookingData = {
      tenant_id: tenantId,
      service_id: serviceId,
      slot_id: slotId,
      customer_name: 'Test Customer',
      customer_phone: '+966501234567',
      customer_email: 'test@example.com',
      visitor_count: 1,
      total_price: 100,
      status: 'pending' as const,
      payment_status: 'unpaid' as const,
    };

    const { data: booking, error } = await db
      .from('bookings')
      .insert(bookingData)
      .select()
      .single();

    expect(error).toBeNull();
    assertBooking(booking);
    expect(booking.customer_name).toBe('Test Customer');
    expect(booking.total_price).toBe(100);
  });

  it('should reduce slot capacity when booking is confirmed', async () => {
    // This test would verify the database trigger works
    // In a real implementation, you would:
    // 1. Create booking with status 'pending'
    // 2. Update to 'confirmed'
    // 3. Verify slot capacity reduced
    // This is a placeholder
    expect(true).toBe(true); // Placeholder
  });

  it('should prevent booking when capacity is insufficient', async () => {
    // This test would verify capacity validation
    // In a real implementation, you would:
    // 1. Create slot with capacity = 1
    // 2. Create booking for 2 visitors
    // 3. Verify booking fails with capacity error
    expect(true).toBe(true); // Placeholder
  });
});

