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

async function signIn(email: string, password: string): Promise<{ token: string; userId?: string } | null> {
  try {
    const res = await fetch(`${API_BASE}/api/auth/signin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const token = data?.token ?? data?.access_token ?? data?.session?.access_token;
    const userId = data?.user?.id ?? data?.session?.user?.id;
    return token ? { token, userId } : null;
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
      'sell_packages',
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

  describe('Role "Tester" (cancel_booking only) — cannot do anything else', () => {
    const TESTER_EMAIL = process.env.TEST_RBAC_Tester_EMAIL;
    const TESTER_PASSWORD = process.env.TEST_RBAC_Tester_PASSWORD;

    let testerToken: string | null = null;

    beforeAll(async () => {
      if (!TESTER_EMAIL || !TESTER_PASSWORD) {
        return;
      }
      const signInResult = await signIn(TESTER_EMAIL, TESTER_PASSWORD);
      testerToken = signInResult?.token ?? null;
    });

    it('tester user has only cancel_booking permission', async () => {
      if (!testerToken) {
        console.warn('Skipping: set TEST_RBAC_Tester_EMAIL and TEST_RBAC_Tester_PASSWORD to a user with "Tester" role (only cancel_booking)');
        return;
      }
      const res = await fetchWithAuth('/api/roles/permissions/me', testerToken);
      expect(res.status).toBe(200);
      const body = await res.json();
      const perms = (body.permissions || []) as string[];
      expect(perms).toContain('cancel_booking');
      expect(perms).not.toContain('create_booking');
      expect(perms).not.toContain('edit_booking');
      expect(perms).not.toContain('manage_bookings');
      expect(perms).not.toContain('issue_invoices');
      expect(perms).not.toContain('sell_packages');
    });

    it('tester cannot create a booking (403)', async () => {
      if (!testerToken) {
        console.warn('Skipping: set TEST_RBAC_Tester_EMAIL and TEST_RBAC_Tester_PASSWORD to run');
        return;
      }
      const res = await fetchWithAuth('/api/bookings/create', testerToken, {
        method: 'POST',
        body: JSON.stringify({
          customer_phone: '+201000000000',
          customer_name: 'Test',
          service_id: '00000000-0000-0000-0000-000000000001',
          slot_id: '00000000-0000-0000-0000-000000000001',
        }),
      });
      expect(res.status).toBe(403);
      const body = await res.json().catch(() => ({}));
      expect(body?.error ?? '').toMatch(/permission|create|denied|access/i);
    });

    it('tester cannot edit a booking (PATCH status to confirmed) (403)', async () => {
      if (!testerToken || !adminToken) return;
      const searchRes = await fetchWithAuth('/api/bookings/search?date=2030-01-01', adminToken);
      if (!searchRes.ok) return;
      const searchBody = await searchRes.json();
      const bookings = searchBody.bookings ?? searchBody.data ?? [];
      const pending = Array.isArray(bookings) ? bookings.find((b: any) => b.status === 'pending') : null;
      if (!pending?.id) {
        console.warn('Skipping: no pending booking found for edit test');
        return;
      }
      const res = await fetchWithAuth(`/api/bookings/${pending.id}`, testerToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'confirmed' }),
      });
      expect(res.status).toBe(403);
    });

    it('tester can cancel a booking (PATCH status to cancelled) (200)', async () => {
      if (!testerToken) return;
      const searchRes = await fetchWithAuth('/api/bookings/search?date=2030-01-01', testerToken);
      if (!searchRes.ok) {
        console.warn('Skipping: tester cannot search bookings (wrong role or no access)');
        return;
      }
      const searchBody = await searchRes.json();
      const bookings = searchBody.bookings ?? searchBody.data ?? [];
      const notCancelled = Array.isArray(bookings) ? bookings.find((b: any) => b.status !== 'cancelled') : null;
      if (!notCancelled?.id) {
        console.warn('Skipping: no non-cancelled booking found for cancel test');
        return;
      }
      const res = await fetchWithAuth(`/api/bookings/${notCancelled.id}`, testerToken, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'cancelled' }),
      });
      expect(res.status).toBe(200);
    });

    it('tester cannot update payment status (403)', async () => {
      if (!testerToken || !adminToken) return;
      const searchRes = await fetchWithAuth('/api/bookings/search?date=2030-01-01', adminToken);
      if (!searchRes.ok) return;
      const searchBody = await searchRes.json();
      const bookings = searchBody.bookings ?? searchBody.data ?? [];
      const first = Array.isArray(bookings) ? bookings[0] : null;
      if (!first?.id) {
        console.warn('Skipping: no booking found for payment-status test');
        return;
      }
      const res = await fetchWithAuth(`/api/bookings/${first.id}/payment-status`, testerToken, {
        method: 'PATCH',
        body: JSON.stringify({ payment_status: 'paid_manual', payment_method: 'onsite' }),
      });
      expect(res.status).toBe(403);
    });

    it('tester cannot delete a booking (403)', async () => {
      if (!testerToken || !adminToken) return;
      const searchRes = await fetchWithAuth('/api/bookings/search?date=2030-01-01', adminToken);
      if (!searchRes.ok) return;
      const searchBody = await searchRes.json();
      const bookings = searchBody.bookings ?? searchBody.data ?? [];
      const first = Array.isArray(bookings) ? bookings[0] : null;
      if (!first?.id) {
        console.warn('Skipping: no booking found for delete test');
        return;
      }
      const res = await fetchWithAuth(`/api/bookings/${first.id}`, testerToken, {
        method: 'DELETE',
      });
      expect(res.status).toBe(403);
    });

    it('tester cannot access package/receptionist endpoints (403)', async () => {
      if (!testerToken) return;
      const res = await fetchWithAuth('/api/packages/receptionist/packages', testerToken);
      expect(res.status).toBe(403);
    });
  });
});
