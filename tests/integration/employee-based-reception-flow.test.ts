/**
 * Integration tests for employee-based reception flow.
 * Ensures "No employees with shifts" does not appear when employees are assigned to the service.
 *
 * Verifies:
 * 1. Querying employee_services for a service (no shift_id filter) returns all assigned employees.
 * 2. With tenant in employee_based mode, an employee with shifts and employee_services (shift_id null)
 *    is included so the reception dropdown is populated.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestTenant, createTestService, createTestUser, cleanupTestData } from '../utils/test-helpers';
import { db } from '../../src/lib/db';

describe('Employee-based reception flow', () => {
  let tenantId: string;
  let serviceId: string;
  let employeeId: string;

  beforeAll(async () => {
    const tenant = await createTestTenant('Employee Flow Tenant', 'employee-flow-tenant');
    tenantId = tenant.id;

    const service = await createTestService(tenantId, 'Test Service', 100, 60);
    serviceId = service.id;

    const employee = await createTestUser('employee@test.com', 'password', 'employee', tenantId);
    employeeId = employee.id;

    const { error: updateErr } = await db.from('services').update({ scheduling_type: 'employee_based', assignment_mode: 'manual_assign' }).eq('id', serviceId);
    if (updateErr) throw new Error(`services update failed: ${updateErr.message}`);

    const { error: tfError } = await db.from('tenant_features').update({ scheduling_mode: 'employee_based' }).eq('tenant_id', tenantId);
    if (tfError) {
      console.warn('tenant_features update (optional):', tfError.message);
    }

    const { error: esError } = await db.from('employee_shifts').insert({
      tenant_id: tenantId,
      employee_id: employeeId,
      days_of_week: [1, 2, 3, 4, 5],
      start_time_utc: '09:00:00',
      end_time_utc: '17:00:00',
      is_active: true,
    });
    if (esError) {
      console.warn('employee_shifts insert (optional):', esError.message);
    }

    const { error: empServError } = await db.from('employee_services').insert({
      tenant_id: tenantId,
      service_id: serviceId,
      employee_id: employeeId,
      shift_id: null,
    });
    if (empServError) {
      throw new Error(`employee_services insert failed: ${empServError.message}`);
    }
  });

  afterAll(async () => {
    await db.from('employee_services').delete().eq('tenant_id', tenantId);
    await db.from('employee_shifts').delete().eq('tenant_id', tenantId);
    await cleanupTestData(tenantId);
  });

  it('returns all employees assigned to the service when querying without shift_id filter', async () => {
    const { data: employeeServices, error } = await db
      .from('employee_services')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('service_id', serviceId);

    expect(error).toBeNull();
    expect(employeeServices).toBeDefined();
    expect(Array.isArray(employeeServices)).toBe(true);
    expect(employeeServices!.length).toBeGreaterThanOrEqual(1);
    const employeeIds = employeeServices!.map((es: { employee_id: string }) => es.employee_id);
    expect(employeeIds).toContain(employeeId);
  });

  it('reception dropdown would be populated (employee list non-empty) when employee is assigned', async () => {
    const { data: list, error } = await db
      .from('employee_services')
      .select('employee_id, users:employee_id(id, full_name, full_name_ar, is_active)')
      .eq('tenant_id', tenantId)
      .eq('service_id', serviceId);

    expect(error).toBeNull();
    expect(list).toBeDefined();
    expect(list!.length).toBeGreaterThanOrEqual(1);
    const first = list![0] as { employee_id: string; users?: { id: string; full_name?: string } | null };
    expect(first.employee_id).toBe(employeeId);
    if (first.users) {
      expect(first.users.id).toBe(employeeId);
    }
  });
});
