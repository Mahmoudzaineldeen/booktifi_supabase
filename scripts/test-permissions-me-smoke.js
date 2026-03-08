#!/usr/bin/env node

/**
 * Smoke test: sign in and GET /roles/permissions/me.
 * Verifies that the API returns permissions based on the user's role_id (no manage_roles needed).
 * Run: node scripts/test-permissions-me-smoke.js
 */

const API_BASE = process.env.API_BASE_URL || process.env.VITE_API_URL || 'http://localhost:3001';
const API = API_BASE.replace(/\/$/, '') + (API_BASE.includes('/api') ? '' : '/api');
const EMAIL = process.env.TEST_EMAIL || 'test@gmail.com';
const PASSWORD = process.env.TEST_PASSWORD || '111111';

async function main() {
  console.log('=== Smoke test: GET /roles/permissions/me ===\n');
  console.log('API:', API, '| User:', EMAIL);

  let res = await fetch(`${API}/auth/signin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) {
    console.error('Sign in failed:', res.status, await res.text());
    process.exit(1);
  }
  const data = await res.json();
  const token = data?.session?.access_token || data?.token || data?.access_token;
  const user = data?.user;
  if (!token || !user?.id) {
    console.error('No token or user in response');
    process.exit(1);
  }
  console.log('Signed in. role:', user.role, '| role_id:', user.role_id || '(null)');

  res = await fetch(`${API}/roles/permissions/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error('GET /roles/permissions/me failed:', res.status, await res.text());
    process.exit(1);
  }
  const body = await res.json();
  const perms = body.permissions || [];
  if (!Array.isArray(perms)) {
    console.error('permissions is not an array:', body);
    process.exit(1);
  }
  console.log('Permissions count:', perms.length);
  console.log('Sample:', perms.slice(0, 6).join(', ') + (perms.length > 6 ? '...' : ''));
  console.log('\nOK: permissions/me returns role-based permissions.');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
