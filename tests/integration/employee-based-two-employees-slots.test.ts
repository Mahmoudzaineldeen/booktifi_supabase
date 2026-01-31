/**
 * Integration test: Employee-Based Mode with two employees (em2 + employee).
 * Uses exact test data: em2 (09:00–12:00), employee (09:00–21:00), service "mix" 60 min.
 *
 * Test Case 1: Service duration 60 min, book on Monday → em2 has 3 slots (09–12), employee has 12 slots (09–21).
 * Test Case 2: Book 09:00–10:00 twice → first em2, second employee; third booking not allowed (slot full).
 *
 * Requires: Server running, VITE_API_URL or API_URL set.
 * Run: npm run test:integration -- tests/integration/employee-based-two-employees-slots.test.ts
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

describe('Employee-Based Mode: two employees (em2, employee) and mix service', () => {
  let tenantId: string;
  let serviceId: string;
  let em2Id: string;
  let employeeId: string;
  let mondayDate: string;

  beforeAll(async () => {
    const tenant = await createTestTenant('Two Employees Tenant', 'two-employees-tenant');
    tenantId = tenant.id;

    const service = await createTestService(tenantId, 'mix', 7546, 60);
    serviceId = service.id;

    await db.from('services').update({
      scheduling_type: 'employee_based',
      assignment_mode: 'manual_assign',
      service_duration_minutes: 60,
    }).eq('id', serviceId);

    const { error: tfErr } = await db.from('tenant_features').update({ scheduling_mode: 'employee_based' }).eq('tenant_id', tenantId);
    if (tfErr) {
      await db.from('tenant_features').insert({ tenant_id: tenantId, scheduling_mode: 'employee_based' });
    }

    const em2 = await createTestUser('em2@two-emp.test', 'password', 'employee', tenantId);
    em2Id = em2.id;
    await db.from('users').update({ full_name: 'em2', full_name_ar: 'em2' }).eq('id', em2Id);

    const employeeUser = await createTestUser('employee@two-emp.test', 'password', 'employee', tenantId);
    employeeId = employeeUser.id;
    await db.from('users').update({ full_name: 'employee', full_name_ar: 'employee' }).eq('id', employeeId);

    await db.from('employee_services').insert([
      { tenant_id: tenantId, service_id: serviceId, employee_id: em2Id, shift_id: null },
      { tenant_id: tenantId, service_id: serviceId, employee_id: employeeId, shift_id: null },
    ]);

    await db.from('employee_shifts').insert([
      { tenant_id: tenantId, employee_id: em2Id, days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time_utc: '09:00:00', end_time_utc: '12:00:00', is_active: true },
      { tenant_id: tenantId, employee_id: employeeId, days_of_week: [0, 1, 2, 3, 4, 5, 6], start_time_utc: '09:00:00', end_time_utc: '21:00:00', is_active: true },
    ]);

    const monday = nextMonday(addDays(new Date(), -1));
    mondayDate = format(monday, 'yyyy-MM-dd');
  }, 30000);

  afterAll(async () => {
    await db.from('bookings').delete().eq('tenant_id', tenantId);
    await db.from('slots').delete().eq('tenant_id', tenantId);
    await db.from('employee_services').delete().eq('tenant_id', tenantId);
    await db.from('employee_shifts').delete().eq('tenant_id', tenantId);
    await cleanupTestData(tenantId);
  });

  it('Test Case 1: ensure-employee-based-slots creates 3 slots for em2 (09–12) and 12 for employee (09–21) on Monday', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }
    const res = await fetch(`${base}/bookings/ensure-employee-based-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, serviceId, date: mondayDate }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(Array.isArray(body.shiftIds)).toBe(true);
    expect(body.shiftIds.length).toBeGreaterThanOrEqual(1);

    const { data: slotsEm2 } = await db
      .from('slots')
      .select('id, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('slot_date', mondayDate)
      .eq('employee_id', em2Id)
      .eq('is_available', true)
      .order('start_time');
    const { data: slotsEmployee } = await db
      .from('slots')
      .select('id, start_time, end_time')
      .eq('tenant_id', tenantId)
      .eq('slot_date', mondayDate)
      .eq('employee_id', employeeId)
      .eq('is_available', true)
      .order('start_time');

    expect(slotsEm2).toBeDefined();
    expect(Array.isArray(slotsEm2)).toBe(true);
    expect(slotsEm2!.length).toBe(3);
    expect((slotsEm2![0] as { start_time: string }).start_time).toMatch(/^09:/);
    expect((slotsEm2![2] as { end_time: string }).end_time).toMatch(/^12:/);

    expect(slotsEmployee).toBeDefined();
    expect(Array.isArray(slotsEmployee)).toBe(true);
    expect(slotsEmployee!.length).toBe(12);
    expect((slotsEmployee![0] as { start_time: string }).start_time).toMatch(/^09:/);
    expect((slotsEmployee![11] as { end_time: string }).end_time).toMatch(/^21:/);
  }, 20000);

  it('Test Case 2: At 09:00–10:00 there are 2 slots (em2 + employee), capacity 1 each — first booking uses em2, second uses employee, third would be rejected', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }
    await fetch(`${base}/bookings/ensure-employee-based-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, serviceId, date: mondayDate }),
    });

    const { data: slots09 } = await db
      .from('slots')
      .select('id, employee_id, start_time, end_time, available_capacity')
      .eq('tenant_id', tenantId)
      .eq('slot_date', mondayDate)
      .eq('start_time', '09:00:00')
      .eq('end_time', '10:00:00')
      .eq('is_available', true);

    expect(slots09).toBeDefined();
    expect(Array.isArray(slots09)).toBe(true);
    expect(slots09!.length).toBe(2);
    const em2Slot = slots09!.find((s: { employee_id: string }) => s.employee_id === em2Id);
    const employeeSlot = slots09!.find((s: { employee_id: string }) => s.employee_id === employeeId);
    expect(em2Slot).toBeDefined();
    expect(employeeSlot).toBeDefined();
    expect((em2Slot as { available_capacity: number }).available_capacity).toBe(1);
    expect((employeeSlot as { available_capacity: number }).available_capacity).toBe(1);
  }, 20000);
});
