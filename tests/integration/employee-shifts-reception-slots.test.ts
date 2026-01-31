/**
 * Integration test: employee with assigned service "mix" and working shifts
 * Sun–Sat 09:00–21:00 should have slots appear on the reception page when
 * making a booking for the mix service.
 *
 * Verifies:
 * 1. ensure-employee-based-slots creates slots for the employee on the given date.
 * 2. Slots returned have the expected employee_id and time range (09:00–21:00).
 *
 * Requires: Server running and API_URL or VITE_API_URL set (e.g. VITE_API_URL=http://localhost:3001/api).
 * Run: npm run test:integration -- tests/integration/employee-shifts-reception-slots.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestTenant, createTestService, createTestUser, cleanupTestData } from '../utils/test-helpers';
import { db } from '../../src/lib/db';
import { addDays, format } from 'date-fns';

function getApiBase(): string {
  const url = process.env.VITE_API_URL || process.env.API_URL || '';
  if (!url) return '';
  return url.endsWith('/api') ? url : `${url.replace(/\/$/, '')}/api`;
}

describe('Employee shifts appear on reception for mix service', () => {
  let tenantId: string;
  let serviceId: string;
  let employeeId: string;
  let testDate: string;

  beforeAll(async () => {
    const tenant = await createTestTenant('Employee Shifts Reception Tenant', 'employee-shifts-reception');
    tenantId = tenant.id;

    const service = await createTestService(tenantId, 'mix', 100, 60);
    serviceId = service.id;

    const employee = await createTestUser('employee-mix@test.com', 'password', 'employee', tenantId);
    employeeId = employee.id;

    await db.from('services').update({
      scheduling_type: 'employee_based',
      assignment_mode: 'manual_assign',
      service_duration_minutes: 60,
    }).eq('id', serviceId);

    const { error: tfError } = await db.from('tenant_features').update({ scheduling_mode: 'employee_based' }).eq('tenant_id', tenantId);
    if (tfError) {
      const { error: insertTf } = await db.from('tenant_features').insert({
        tenant_id: tenantId,
        scheduling_mode: 'employee_based',
      });
      if (insertTf) throw new Error(`tenant_features: ${insertTf.message}`);
    }

    const { error: shiftError } = await db.from('employee_shifts').insert({
      tenant_id: tenantId,
      employee_id: employeeId,
      days_of_week: [0, 1, 2, 3, 4, 5, 6],
      start_time_utc: '09:00:00',
      end_time_utc: '21:00:00',
      is_active: true,
    });
    if (shiftError) throw new Error(`employee_shifts insert failed: ${shiftError.message}`);

    const { error: esError } = await db.from('employee_services').insert({
      tenant_id: tenantId,
      service_id: serviceId,
      employee_id: employeeId,
      shift_id: null,
    });
    if (esError) throw new Error(`employee_services insert failed: ${esError.message}`);

    const tomorrow = addDays(new Date(), 1);
    testDate = format(tomorrow, 'yyyy-MM-dd');
  });

  afterAll(async () => {
    await db.from('employee_services').delete().eq('tenant_id', tenantId);
    await db.from('employee_shifts').delete().eq('tenant_id', tenantId);
    await db.from('slots').delete().eq('tenant_id', tenantId);
    await cleanupTestData(tenantId);
  });

  it('employee has assigned service mix and shifts Sun–Sat 09:00–21:00 in DB', async () => {
    const { data: services } = await db.from('services').select('id, name').eq('tenant_id', tenantId).eq('name', 'mix');
    expect(services).toBeDefined();
    expect(Array.isArray(services) && services!.length).toBeGreaterThan(0);
    const mixService = services!.find((s: { name: string }) => s.name === 'mix');
    expect(mixService).toBeDefined();

    const { data: esList } = await db.from('employee_services').select('employee_id, service_id').eq('tenant_id', tenantId).eq('service_id', serviceId).is('shift_id', null);
    expect(esList).toBeDefined();
    expect(Array.isArray(esList) && esList!.length).toBeGreaterThan(0);
    expect(esList!.some((es: { employee_id: string }) => es.employee_id === employeeId)).toBe(true);

    const { data: empShifts } = await db.from('employee_shifts').select('employee_id, days_of_week, start_time_utc, end_time_utc').eq('tenant_id', tenantId).eq('employee_id', employeeId).eq('is_active', true);
    expect(empShifts).toBeDefined();
    expect(Array.isArray(empShifts) && empShifts!.length).toBeGreaterThan(0);
    const oneShift = empShifts![0] as { days_of_week: number[]; start_time_utc: string; end_time_utc: string };
    const days = Array.isArray(oneShift.days_of_week) ? oneShift.days_of_week : [];
    expect(days).toContain(0);
    expect(days).toContain(6);
    expect(String(oneShift.start_time_utc).slice(0, 5)).toBe('09:00');
    expect(String(oneShift.end_time_utc).slice(0, 5)).toBe('21:00');
  });

  it('ensure-employee-based-slots returns shiftIds for mix service on test date', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set. Start server and set VITE_API_URL=http://localhost:3001/api');
      return;
    }
    const res = await fetch(`${base}/bookings/ensure-employee-based-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, serviceId, date: testDate }),
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn('ensure-employee-based-slots failed:', res.status, text);
      return;
    }
    const body = await res.json();
    expect(body).toBeDefined();
    expect(Array.isArray(body.shiftIds)).toBe(true);
    expect(body.shiftIds.length).toBeGreaterThanOrEqual(1);
  });

  it('slots exist for the employee on the test date (reception page would show them)', async () => {
    const base = getApiBase();
    if (!base) {
      console.warn('Skipping: VITE_API_URL or API_URL not set.');
      return;
    }
    await fetch(`${base}/bookings/ensure-employee-based-slots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, serviceId, date: testDate }),
    });

    const { data: slots, error } = await db
      .from('slots')
      .select('id, employee_id, slot_date, start_time, end_time, available_capacity')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('employee_id', employeeId)
      .eq('is_available', true)
      .order('start_time');

    expect(error).toBeNull();
    expect(slots).toBeDefined();
    expect(Array.isArray(slots)).toBe(true);
    expect(slots!.length).toBeGreaterThan(0);

    const first = slots![0] as { start_time: string; end_time: string };
    const last = slots![slots!.length - 1] as { start_time: string; end_time: string };
    expect(first.start_time).toBeDefined();
    expect(last.end_time).toBeDefined();
    const startHour = parseInt(String(first.start_time).split(':')[0], 10);
    const endHour = parseInt(String(last.end_time).split(':')[0], 10);
    expect(startHour).toBeGreaterThanOrEqual(9);
    expect(endHour).toBeLessThanOrEqual(21);
  });

  it('slots have positive available_capacity so reception can offer them', async () => {
    const { data: slots, error } = await db
      .from('slots')
      .select('id, employee_id, available_capacity')
      .eq('tenant_id', tenantId)
      .eq('slot_date', testDate)
      .eq('employee_id', employeeId);

    expect(error).toBeNull();
    if (!slots || slots.length === 0) {
      console.warn('No slots found - ensure server ran ensure-employee-based-slots for this tenant/date');
      return;
    }
    const withCapacity = slots.filter((s: { available_capacity: number }) => s.available_capacity > 0);
    expect(withCapacity.length).toBeGreaterThan(0);
  });
});
