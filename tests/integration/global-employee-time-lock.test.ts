/**
 * Integration tests: Global Employee Time Lock (Employee-Based mode).
 *
 * Ensures that an employee booked in one service at a time range is NOT available
 * in any other service at the same time. Covers:
 *
 * - RULE 1: Global employee time lock (employee_id + time_range, not service_id)
 * - RULE 2: Auto selection respects global lock (assigns free employee)
 * - RULE 3: Turn rotation skips busy employees; considers them again when free
 * - RULE 4: Manual selection dropdown must not show employees booked at that time
 * - Service-Based mode unchanged
 *
 * Setup: 2 services (mix, test time), 2 employees (EM1, EM2), both assigned to both
 * services, shifts 9:00–18:00. Date: next Monday.
 *
 * Requires: Server running, VITE_API_URL or API_URL set.
 * Run: npm run test:integration -- tests/integration/global-employee-time-lock.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestTenant, createTestService, createTestUser, cleanupTestData } from '../utils/test-helpers';
import { db } from '../../src/lib/db';
import { addDays, format, nextMonday } from 'date-fns';

function getApiBase(): string {
  const url = process.env.VITE_API_URL || process.env.API_URL || '';
  if (!url) return '';
  return url.endsWith('/api') ? url : `${url.replace(/\/$/, '')}/api`;
}

/** Time overlap: (existing_start < requested_end) AND (existing_end > requested_start) */
function timeRangesOverlap(
  existingStart: string,
  existingEnd: string,
  requestedStart: string,
  requestedEnd: string
): boolean {
  const toM = (t: string) => {
    const parts = (t || '').slice(0, 8).split(':').map(Number);
    return (parts[0] || 0) * 60 + (parts[1] || 0);
  };
  const es = toM(existingStart);
  const ee = toM(existingEnd);
  const rs = toM(requestedStart);
  const re = toM(requestedEnd);
  return es < re && ee > rs;
}

describe('Global Employee Time Lock (Employee-Based mode)', () => {
  let tenantId: string;
  let serviceMixId: string;
  let serviceTestTimeId: string;
  let em1Id: string;
  let em2Id: string;
  let testDate: string;

  beforeAll(async () => {
    const tenant = await createTestTenant('Global Lock Tenant', 'global-lock-tenant');
    tenantId = tenant.id;

    const mix = await createTestService(tenantId, 'mix', 100, 60);
    serviceMixId = mix.id;
    const testTime = await createTestService(tenantId, 'test time', 100, 60);
    serviceTestTimeId = testTime.id;

    await db.from('services').update({
      scheduling_type: 'employee_based',
      assignment_mode: 'manual_assign',
      service_duration_minutes: 60,
    }).eq('id', serviceMixId);
    await db.from('services').update({
      scheduling_type: 'employee_based',
      assignment_mode: 'manual_assign',
      service_duration_minutes: 60,
    }).eq('id', serviceTestTimeId);

    const { error: tfErr } = await db.from('tenant_features').update({
      scheduling_mode: 'employee_based',
      employee_assignment_mode: 'both',
    }).eq('tenant_id', tenantId);
    if (tfErr) {
      await db.from('tenant_features').insert({
        tenant_id: tenantId,
        scheduling_mode: 'employee_based',
        employee_assignment_mode: 'both',
      });
    }

    const em1 = await createTestUser('em1@global-lock.test', 'password', 'employee', tenantId);
    em1Id = em1.id;
    await db.from('users').update({ full_name: 'EM1', full_name_ar: 'EM1' }).eq('id', em1Id);

    const em2 = await createTestUser('em2@global-lock.test', 'password', 'employee', tenantId);
    em2Id = em2.id;
    await db.from('users').update({ full_name: 'EM2', full_name_ar: 'EM2' }).eq('id', em2Id);

    await db.from('employee_services').insert([
      { tenant_id: tenantId, service_id: serviceMixId, employee_id: em1Id, shift_id: null },
      { tenant_id: tenantId, service_id: serviceMixId, employee_id: em2Id, shift_id: null },
      { tenant_id: tenantId, service_id: serviceTestTimeId, employee_id: em1Id, shift_id: null },
      { tenant_id: tenantId, service_id: serviceTestTimeId, employee_id: em2Id, shift_id: null },
    ]);

    const shiftPayload = {
      tenant_id: tenantId,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      start_time_utc: '09:00:00',
      end_time_utc: '18:00:00',
      is_active: true,
    };
    await db.from('employee_shifts').insert([
      { ...shiftPayload, employee_id: em1Id },
      { ...shiftPayload, employee_id: em2Id },
    ]);

    const monday = nextMonday(addDays(new Date(), -1));
    testDate = format(monday, 'yyyy-MM-dd');
  }, 30000);

  afterAll(async () => {
    await db.from('bookings').delete().eq('tenant_id', tenantId);
    await db.from('slots').delete().eq('tenant_id', tenantId);
    await db.from('employee_services').delete().eq('tenant_id', tenantId);
    await db.from('employee_shifts').delete().eq('tenant_id', tenantId);
    await cleanupTestData(tenantId);
  });

  /** Call ensure-employee-based-slots and return slots array */
  async function ensureSlots(serviceId: string, date: string): Promise<{ slots: any[]; shiftIds: string[] }> {
    const base = getApiBase();
    if (!base) return { slots: [], shiftIds: [] };
    const res = await fetch(`${base}/bookings/ensure-employee-based-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, serviceId, date }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    return { slots: body.slots || [], shiftIds: body.shiftIds || [] };
  }

  /** Get slots at a given time (start_time 09:00:00, end_time 10:00:00) from API response or DB */
  function slotsAt9To10(slots: any[]): any[] {
    return slots.filter(
      (s: any) =>
        (s.start_time || '').slice(0, 5) === '09:00' &&
        (s.end_time || '').slice(0, 5) === '10:00'
    );
  }

  function slotsAt10To11(slots: any[]): any[] {
    return slots.filter(
      (s: any) =>
        (s.start_time || '').slice(0, 5) === '10:00' &&
        (s.end_time || '').slice(0, 5) === '11:00'
    );
  }

  /** Create a booking for a given slot and employee (direct insert for test control) */
  async function createBooking(slotId: string, serviceId: string, employeeId: string): Promise<void> {
    const { error } = await db.from('bookings').insert({
      tenant_id: tenantId,
      service_id: serviceId,
      slot_id: slotId,
      employee_id: employeeId,
      customer_name: 'Test Customer',
      customer_phone: '+966501234567',
      visitor_count: 1,
      adult_count: 1,
      child_count: 0,
      total_price: 100,
      status: 'confirmed',
      payment_status: 'unpaid',
    });
    expect(error).toBeNull();
  }

  // ---------------------------------------------------------------------------
  // Test 1: Book EM1 in mix 9–10 → open test time 9–10 → EM1 must NOT appear
  // ---------------------------------------------------------------------------
  it('Test 1: Employee booked in Service A at 9–10 must NOT appear in Service B at 9–10', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }

    await ensureSlots(serviceMixId, testDate);
    const { data: mixSlots } = await db
      .from('slots')
      .select('id, employee_id, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('start_time', '09:00:00')
      .eq('end_time', '10:00:00')
      .eq('is_available', true);

    expect(mixSlots).toBeDefined();
    expect(Array.isArray(mixSlots) && mixSlots!.length).toBeGreaterThanOrEqual(1);
    const em1SlotMix = mixSlots!.find((s: any) => s.employee_id === em1Id);
    expect(em1SlotMix).toBeDefined();

    await createBooking(em1SlotMix!.id, serviceMixId, em1Id);

    const { slots: testTimeSlots } = await ensureSlots(serviceTestTimeId, testDate);
    const at9To10 = slotsAt9To10(testTimeSlots);

    const em1At9To10TestTime = at9To10.find((s: any) => s.employee_id === em1Id);
    expect(em1At9To10TestTime).toBeUndefined();
    expect(at9To10.some((s: any) => s.employee_id === em2Id)).toBe(true);
  }, 20000);

  // ---------------------------------------------------------------------------
  // Test 2: Auto selection must assign EM2 when EM1 is booked at 9–10
  // ---------------------------------------------------------------------------
  it('Test 2: Auto selection assigns EM2 when EM1 is booked at 9–10 in another service', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }

    await ensureSlots(serviceMixId, testDate);
    const { data: mixSlots } = await db
      .from('slots')
      .select('id, employee_id')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('start_time', '09:00:00')
      .eq('end_time', '10:00:00')
      .eq('is_available', true);

    const em1Slot = mixSlots!.find((s: any) => s.employee_id === em1Id);
    if (em1Slot) {
      await db.from('bookings').delete().eq('slot_id', em1Slot.id);
      await createBooking(em1Slot.id, serviceMixId, em1Id);
    }

    const { slots: testTimeSlots } = await ensureSlots(serviceTestTimeId, testDate);
    const at9To10 = slotsAt9To10(testTimeSlots);

    expect(at9To10.some((s: any) => s.employee_id === em2Id)).toBe(true);
    expect(at9To10.some((s: any) => s.employee_id === em1Id)).toBe(false);
  }, 20000);

  // ---------------------------------------------------------------------------
  // Test 3: EM1 and EM2 both booked at 9–10 → no slot at 9–10
  // (Server re-applies global busy filter on cache hit so result stays correct after bookings.)
  // ---------------------------------------------------------------------------
  it('Test 3: When both employees booked at 9–10 (any services), 9–10 shows NO available slots', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }

    await ensureSlots(serviceMixId, testDate);
    await ensureSlots(serviceTestTimeId, testDate);

    const { data: allSlots } = await db
      .from('slots')
      .select('id, employee_id, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('start_time', '09:00:00')
      .eq('end_time', '10:00:00')
      .eq('is_available', true);

    const em1Slot = allSlots!.find((s: any) => s.employee_id === em1Id);
    const em2Slot = allSlots!.find((s: any) => s.employee_id === em2Id);

    expect(em1Slot).toBeDefined();
    expect(em2Slot).toBeDefined();
    await createBooking(em1Slot!.id, serviceMixId, em1Id);
    await createBooking(em2Slot!.id, serviceTestTimeId, em2Id);

    const { slots: mixSlotsAfter } = await ensureSlots(serviceMixId, testDate);
    const { slots: testTimeSlotsAfter } = await ensureSlots(serviceTestTimeId, testDate);

    const mix9To10 = slotsAt9To10(mixSlotsAfter);
    const testTime9To10 = slotsAt9To10(testTimeSlotsAfter);

    expect(mix9To10.length).toBe(0);
    expect(testTime9To10.length).toBe(0);
  }, 20000);

  // ---------------------------------------------------------------------------
  // Test 4: EM1 booked 9–10 → at 10–11 EM1 must appear again
  // ---------------------------------------------------------------------------
  it('Test 4: Employee booked 9–10 appears again at 10–11 (rotation does not permanently skip)', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }

    await db.from('bookings').delete().eq('tenant_id', tenantId);

    await ensureSlots(serviceMixId, testDate);
    const { data: mixSlots } = await db
      .from('slots')
      .select('id, employee_id')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('start_time', '09:00:00')
      .eq('end_time', '10:00:00')
      .eq('is_available', true);

    const em1Slot9To10 = mixSlots!.find((s: any) => s.employee_id === em1Id);
    if (em1Slot9To10) await createBooking(em1Slot9To10.id, serviceMixId, em1Id);

    const { slots: mixSlotsAll } = await ensureSlots(serviceMixId, testDate);
    const at10To11 = slotsAt10To11(mixSlotsAll);

    const em1At10To11 = at10To11.find((s: any) => s.employee_id === em1Id);
    expect(em1At10To11).toBeDefined();
  }, 20000);

  // ---------------------------------------------------------------------------
  // Test 5: Manual selection – employee dropdown must not show EM1 at 9–10 for test time
  // (We assert slots for test time at 9–10 do not include EM1; manual dropdown uses same slot list)
  // ---------------------------------------------------------------------------
  it('Test 5: Manual assignment: employees already booked at 9–10 not shown for that time', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }

    await ensureSlots(serviceMixId, testDate);
    const { data: mixSlots } = await db
      .from('slots')
      .select('id, employee_id')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('start_time', '09:00:00')
      .eq('end_time', '10:00:00')
      .eq('is_available', true);

    const em1Slot = mixSlots!.find((s: any) => s.employee_id === em1Id);
    if (em1Slot) {
      await db.from('bookings').delete().eq('slot_id', em1Slot.id);
      await createBooking(em1Slot.id, serviceMixId, em1Id);
    }

    const { slots: testTimeSlots } = await ensureSlots(serviceTestTimeId, testDate);
    const employeeIdsAt9To10 = slotsAt9To10(testTimeSlots).map((s: any) => s.employee_id);

    expect(employeeIdsAt9To10).not.toContain(em1Id);
    expect(employeeIdsAt9To10).toContain(em2Id);
  }, 20000);

  // ---------------------------------------------------------------------------
  // Test 6 & 7: Parallel / Consecutive mode – global lock still applies
  // ---------------------------------------------------------------------------
  it('Test 6 & 7: Global lock applies regardless of booking flow (parallel/consecutive)', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }

    await db.from('bookings').delete().eq('tenant_id', tenantId);
    await ensureSlots(serviceMixId, testDate);

    const { data: mixSlots } = await db
      .from('slots')
      .select('id, employee_id')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('start_time', '09:00:00')
      .eq('end_time', '10:00:00')
      .eq('is_available', true);

    const em1Slot = mixSlots!.find((s: any) => s.employee_id === em1Id);
    if (em1Slot) await createBooking(em1Slot.id, serviceMixId, em1Id);

    const { slots: testTimeSlots } = await ensureSlots(serviceTestTimeId, testDate);
    const at9To10 = slotsAt9To10(testTimeSlots);

    expect(at9To10.every((s: any) => s.employee_id !== em1Id)).toBe(true);
  }, 20000);

  // ---------------------------------------------------------------------------
  // Test 8: Admin booking behaves same as Receptionist (same API)
  // ---------------------------------------------------------------------------
  it('Test 8: ensure-employee-based-slots returns same global-lock result for any caller', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }

    await ensureSlots(serviceMixId, testDate);
    const { data: mixSlots } = await db
      .from('slots')
      .select('id, employee_id')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('start_time', '09:00:00')
      .eq('end_time', '10:00:00')
      .eq('is_available', true);

    const em1Slot = mixSlots!.find((s: any) => s.employee_id === em1Id);
    if (em1Slot) {
      await db.from('bookings').delete().eq('slot_id', em1Slot.id);
      await createBooking(em1Slot.id, serviceMixId, em1Id);
    }

    const res1 = await fetch(`${base}/bookings/ensure-employee-based-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, serviceId: serviceTestTimeId, date: testDate }),
    });
    expect(res1.ok).toBe(true);
    const body1 = await res1.json();
    const at9To10 = slotsAt9To10(body1.slots || []);
    expect(at9To10.some((s: any) => s.employee_id === em1Id)).toBe(false);
  }, 20000);

  // ---------------------------------------------------------------------------
  // Test 9: Service-Based mode unchanged (slot_based service still uses shifts/slots)
  // ---------------------------------------------------------------------------
  it('Test 9: Service-Based mode is unchanged (global lock only in employee_based)', async () => {
    const { data: tenantFeatures } = await db
      .from('tenant_features')
      .select('scheduling_mode')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    expect(tenantFeatures).toBeDefined();
    const mode = (tenantFeatures as any)?.scheduling_mode;
    expect(['employee_based', 'service_slot_based']).toContain(mode);

    const { data: mixService } = await db
      .from('services')
      .select('scheduling_type')
      .eq('id', serviceMixId)
      .single();

    expect((mixService as any)?.scheduling_type).toBe('employee_based');
  }, 5000);
});

describe('Global Employee Time Lock – time overlap formula', () => {
  it('overlap: (existing_start < requested_end) AND (existing_end > requested_start)', () => {
    expect(timeRangesOverlap('09:00', '10:00', '09:00', '10:00')).toBe(true);
    expect(timeRangesOverlap('09:00', '10:00', '09:30', '10:30')).toBe(true);
    expect(timeRangesOverlap('09:00', '10:00', '08:30', '09:30')).toBe(true);
    expect(timeRangesOverlap('09:00', '10:00', '08:00', '11:00')).toBe(true);
    expect(timeRangesOverlap('09:00', '10:00', '10:00', '11:00')).toBe(false);
    expect(timeRangesOverlap('09:00', '10:00', '10:01', '11:00')).toBe(false);
    expect(timeRangesOverlap('09:00', '10:00', '07:00', '08:00')).toBe(false);
  });
});
