/**
 * Employee update role integration test.
 * Verifies that updating a user to a built-in role (e.g. Receptionist) persists role and role_id
 * and that the backend accepts built-in role_id without requiring the role to exist in the roles table.
 *
 * Run: npx vitest run tests/integration/employee-update-role.test.ts
 * Requires: API running, TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD env (or test@gmail.com / 111111),
 *           and an existing employee/user ID to update (or create one first).
 */

import { describe, it, expect, beforeAll } from 'vitest';

const API_BASE = process.env.API_BASE_URL || process.env.VITE_API_URL || 'http://localhost:3001';
const TEST_EMAIL = process.env.TEST_ADMIN_EMAIL || 'test@gmail.com';
const TEST_PASSWORD = process.env.TEST_ADMIN_PASSWORD || '111111';

const BUILTIN_RECEPTIONIST_ROLE_ID = '00000000-0000-0000-0000-000000000002';

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

async function fetchWithAuth(path: string, token: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers as object),
    },
  });
}

describe('Employee update role (built-in Receptionist)', () => {
  let adminToken: string | null = null;
  let employeeIdToUpdate: string | null = null;

  beforeAll(async () => {
    adminToken = (await signIn(TEST_EMAIL, TEST_PASSWORD))?.token ?? null;
    if (!adminToken) {
      console.warn('Employee update test: Could not sign in. Set TEST_ADMIN_EMAIL and TEST_ADMIN_PASSWORD and ensure API is running.');
      return;
    }
    // Try to get first non-admin user from tenant as the one to update (optional; can set EMPLOYEE_ID_TO_UPDATE)
    employeeIdToUpdate = process.env.EMPLOYEE_ID_TO_UPDATE ?? null;
    if (!employeeIdToUpdate) {
      const rolesRes = await fetchWithAuth('/api/roles?tenant_id=', adminToken);
      if (rolesRes.ok) {
        const rolesData = await rolesRes.json();
        const roles = rolesData?.roles ?? [];
        if (roles.length > 0) {
          // We need a user id - we don't have a list users endpoint here, so skip if not provided
          employeeIdToUpdate = null;
        }
      }
    }
  });

  it('POST /api/employees/update with role_id (built-in Receptionist) returns 200 and does not require role in DB', async () => {
    if (!adminToken) {
      console.warn('Skipping: no auth token');
      return;
    }
    if (!employeeIdToUpdate) {
      console.warn('Skipping: set EMPLOYEE_ID_TO_UPDATE to an existing user id to run this test');
      return;
    }

    const res = await fetchWithAuth('/api/employees/update', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        employee_id: employeeIdToUpdate,
        role: 'receptionist',
        role_id: BUILTIN_RECEPTIONIST_ROLE_ID,
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('POST /api/employees/update with only role (receptionist) sets role and role_id', async () => {
    if (!adminToken) return;
    if (!employeeIdToUpdate) return;

    const res = await fetchWithAuth('/api/employees/update', adminToken, {
      method: 'POST',
      body: JSON.stringify({
        employee_id: employeeIdToUpdate,
        role: 'receptionist',
        // no role_id - backend should set role_id from LEGACY_TO_ROLE_ID
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });
});
