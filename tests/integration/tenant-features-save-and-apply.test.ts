/**
 * Integration tests for Tenant Features (management/features) save and apply.
 * Ensures that changing settings (employees, packages, landing page, scheduling mode, assignment mode)
 * persists and can be read back. Run with backend available: npm run test:integration
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createTestTenant, cleanupTestData } from '../utils/test-helpers';
import { db } from '../../src/lib/db';

describe('Tenant Features save and apply', () => {
  let tenantId: string;

  beforeAll(async () => {
    const tenant = await createTestTenant('Features Test Tenant', 'features-test-tenant');
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await db.from('tenant_features').delete().eq('tenant_id', tenantId);
    await cleanupTestData(tenantId);
  });

  it('persists employees_enabled when saved', async () => {
    const { error: updateErr } = await db
      .from('tenant_features')
      .update({ employees_enabled: false })
      .eq('tenant_id', tenantId);

    expect(updateErr).toBeNull();

    const { data: row, error: readErr } = await db
      .from('tenant_features')
      .select('employees_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    expect(readErr).toBeNull();
    expect(row).toBeDefined();
    expect(row?.employees_enabled).toBe(false);

    await db.from('tenant_features').update({ employees_enabled: true }).eq('tenant_id', tenantId);
  });

  it('persists packages_enabled when saved', async () => {
    const { error: updateErr } = await db
      .from('tenant_features')
      .update({ packages_enabled: false })
      .eq('tenant_id', tenantId);

    expect(updateErr).toBeNull();

    const { data: row, error: readErr } = await db
      .from('tenant_features')
      .select('packages_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    expect(readErr).toBeNull();
    expect(row).toBeDefined();
    expect(row?.packages_enabled).toBe(false);

    await db.from('tenant_features').update({ packages_enabled: true }).eq('tenant_id', tenantId);
  });

  it('persists landing_page_enabled when saved', async () => {
    const { error: updateErr } = await db
      .from('tenant_features')
      .update({ landing_page_enabled: false })
      .eq('tenant_id', tenantId);

    expect(updateErr).toBeNull();

    const { data: row, error: readErr } = await db
      .from('tenant_features')
      .select('landing_page_enabled')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    expect(readErr).toBeNull();
    expect(row).toBeDefined();
    expect(row?.landing_page_enabled).toBe(false);

    await db.from('tenant_features').update({ landing_page_enabled: true }).eq('tenant_id', tenantId);
  });

  it('persists scheduling_mode when saved', async () => {
    const { error: updateErr } = await db
      .from('tenant_features')
      .update({ scheduling_mode: 'employee_based' })
      .eq('tenant_id', tenantId);

    expect(updateErr).toBeNull();

    const { data: row, error: readErr } = await db
      .from('tenant_features')
      .select('scheduling_mode')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    expect(readErr).toBeNull();
    expect(row).toBeDefined();
    expect((row as any)?.scheduling_mode).toBe('employee_based');

    await db.from('tenant_features').update({ scheduling_mode: 'service_slot_based' }).eq('tenant_id', tenantId);
  });

  it('persists employee_assignment_mode when saved', async () => {
    const { error: updateErr } = await db
      .from('tenant_features')
      .update({ employee_assignment_mode: 'manual' })
      .eq('tenant_id', tenantId);

    expect(updateErr).toBeNull();

    const { data: row, error: readErr } = await db
      .from('tenant_features')
      .select('employee_assignment_mode')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    expect(readErr).toBeNull();
    expect(row).toBeDefined();
    expect((row as any)?.employee_assignment_mode).toBe('manual');

    await db.from('tenant_features').update({ employee_assignment_mode: 'both' }).eq('tenant_id', tenantId);
  });

  it('upserts tenant_features when no row exists (save still applies)', async () => {
    await db.from('tenant_features').delete().eq('tenant_id', tenantId);

    const { error: updateErr } = await db
      .from('tenant_features')
      .update({
        employees_enabled: true,
        packages_enabled: false,
        landing_page_enabled: true,
        scheduling_mode: 'service_slot_based',
        employee_assignment_mode: 'automatic',
      })
      .eq('tenant_id', tenantId);

    expect(updateErr).toBeNull();

    const { data: row, error: readErr } = await db
      .from('tenant_features')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    expect(readErr).toBeNull();
    expect(row).toBeDefined();
    expect(row?.packages_enabled).toBe(false);
    expect((row as any)?.scheduling_mode).toBe('service_slot_based');
  });
});
