/**
 * Authenticated API client: uses DB base URL and auth token.
 * On 401, refreshes the token and retries the request once (no hardcoded bypass).
 */
import { getApiUrl } from './apiUrl';
import { db } from './db';

export function getAuthHeaders(): HeadersInit {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * Fetch with auth. On 401, tries to refresh the token and retries the request once.
 * Use this for API routes that require auth (e.g. /branches) to avoid 401/403 from expired tokens.
 */
export async function apiFetch(
  path: string,
  init?: RequestInit
): Promise<Response> {
  const baseUrl = getApiUrl().replace(/\/$/, '');
  const url = path.startsWith('http') ? path : `${baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
  const headers = new Headers(init?.headers ?? {});
  if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('auth_token') : null;
  if (token) headers.set('Authorization', `Bearer ${token}`);

  let res = await fetch(url, { ...init, headers });

  if (res.status === 401) {
    const refreshed = await db.auth.refreshSession();
    if (!refreshed.error && refreshed.data?.access_token && typeof localStorage !== 'undefined') {
      const newToken = localStorage.getItem('auth_token');
      if (newToken) {
        headers.set('Authorization', `Bearer ${newToken}`);
        res = await fetch(url, { ...init, headers });
      }
    }
  }

  return res;
}
