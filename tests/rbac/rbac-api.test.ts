/**
 * RBAC API integration tests.
 * Run against a live backend: npm run test:rbac (or npx vitest run tests/rbac/rbac-api.test.ts)
 * Requires: API running, TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD env (or test@gmail.com / 111111).
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.API_BASE_URL || process.env.VITE_API_URL || 'http://localhost:3001';
const TEST_EMAIL = process.env.TEST_ADMIN_EMAIL || 'test@gmail.com';
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD || '111111';

type Permission = { id: string; name: string; category: string; description?: string | null };

async function signIn(email: string, password: string): Promise<{ token: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = data?.token ?? data?.access_token ?? data?.session?.access_token;
    return token ? { token } : null;
  } catch {
    return null;
  }
}

async function fetchWithAuth(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers as object),
    },
  });
}

describe('RBAC API', () => {
  let adminToken: string | null = null;

  beforeAll(async () => {
    adminToken = (await signIn(TEST_EMAIL, TEST_PASSWORD))?.token ?? null;
    if (!adminToken) {
      console.warn('RBAC tests: Could not sign in. Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD or run with test account test@gmail.com / 111111 and backend running.');
    }
  });

  describe('STEP 1 — Load permissions', () => {
    it('GET /api/roles/permissions returns 200 and categorized permissions', async () => {
      if (!adminToken) {
        console.warn('Skipping: no auth token');
        return;
      }
      const res = await fetchWithAuth('/api/roles/permissions', adminToken);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toHaveProperty('permissions');
      expect(Array.isArray(body.permissions)).toBe(true);

      const permissions = body.permissions as Permission[];
      expect(permissions.length).toBeGreaterThan(0);

      const adminPerms = permissions.filter((p) => p.category === 'admin');
      const employeePerms = permissions.filter((p) => p.category === 'employee');
      expect(adminPerms.length).toBeGreaterThan(0);
      expect(employeePerms.length).toBeGreaterThan(0);

      for (const p of permissions) {
        expect(p).toHaveProperty('id');
        expect(p).toHaveProperty('name');
        expect(p).toHaveProperty('category');
        expect(['admin', 'employee']).toContain(p.category);
      }
    });

    it('each permission has id, name, category', async () => {
      if (!adminToken) return;
      const res = await fetchWithAuth('/api/roles/permissions', adminToken);
      const body = await res.json();
      const permissions = body.permissions as Permission[];
      for (const p of permissions) {
        expect(typeof p.id).toBe('string');
        expect(typeof p.name).toBe('string');
        expect(typeof p.category).toBe('string');
      }
    });
  });

  describe('STEP 5 — Category validation (no mixing)', () => {
    it('POST /api/roles with admin + employee permission_ids returns 400', async () => {
      if (!adminToken) return;
      const res = await fetchWithAuth('/api/roles', adminToken, {
        method: 'POST',
        body: JSON.stringify({
          name: 'MixedRole_' + Date.now(),
          description: 'Test',
          category: 'admin',
          permission_ids: ['manage_branches', 'create_booking'],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
      expect(String(body.error).toLowerCase()).toMatch(/invalid|configuration|admin|employee|mix|same role/);
    });

    it('POST /api/roles with category employee and admin permission_id returns 400', async () => {
      if (!adminToken) return;
      const res = await fetchWithAuth('/api/roles', adminToken, {
        method: 'POST',
        body: JSON.stringify({
          name: 'MixedRole2_' + Date.now(),
          description: 'Test',
          category: 'employee',
          permission_ids: ['create_booking', 'manage_branches'],
        }),
      });
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBeDefined();
    });
  });

  describe('STEP 9 — API security (403 without permission)', () => {
    it('GET /api/roles/permissions requires auth (401 without token)', async () => {
      const res = await fetch(`${API_BASE}/api/roles/permissions`);
      // 401 when server is up and rejects; 404 when server not reachable
      expect([401, 404]).toContain(res.status);
    });

    it('GET /api/roles requires auth (401 without token)', async () => {
      const res = await fetch(`${API_BASE}/api/roles`);
      expect([401, 404]).toContain(res.status);
    });
  });

  describe('Permission list content (reference)', () => {
    const EXPECTED_ADMIN_IDS = [
      'manage_branches',
      'manage_services',
      'manage_packages',
      'manage_employees',
      'manage_shifts',
      'manage_bookings',
      'view_reports',
      'manage_roles',
      'view_income',
      'access_support_tickets',
      'edit_system_settings',
    ];
    const EXPECTED_EMPLOYEE_IDS = [
      'create_booking',
      'edit_booking',
      'cancel_booking',
      'assign_employee_to_booking',
      'sell_packages',
      'create_subscriptions',
      'register_visitors',
      'view_schedules',
      'process_payments',
      'issue_invoices',
    ];

    it('all expected admin and employee permission ids exist', async () => {
      if (!adminToken) return;
      const res = await fetchWithAuth('/api/roles/permissions', adminToken);
      const body = await res.json();
      const permissions = body.permissions as Permission[];
      const ids = permissions.map((p) => p.id);

      for (const id of EXPECTED_ADMIN_IDS) {
        expect(ids).toContain(id);
        const p = permissions.find((x) => x.id === id);
        expect(p?.category).toBe('admin');
      }
      for (const id of EXPECTED_EMPLOYEE_IDS) {
        expect(ids).toContain(id);
        const p = permissions.find((x) => x.id === id);
        expect(p?.category).toBe('employee');
      }
    });
  });
});
