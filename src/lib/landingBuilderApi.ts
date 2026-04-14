import { getApiUrl } from './apiUrl';
import type { LandingPageData, LandingSection } from './landingSections';
import { normalizeSections } from './landingSections';

const API_URL = getApiUrl();

async function readJson(response: Response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = body?.error || body?.message || `HTTP ${response.status}`;
    throw new Error(message);
  }
  return body;
}

function getToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem('auth_token');
}

export async function fetchAdminLandingPage(tenantId: string): Promise<LandingPageData> {
  const token = getToken();
  const response = await fetch(`${API_URL}/landing-builder/admin/page/${encodeURIComponent(tenantId)}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
  const data = await readJson(response);
  const page = data?.page;
  return {
    id: String(page?.id || ''),
    tenant_id: String(page?.tenant_id || tenantId),
    name: String(page?.name || 'Main Landing Page'),
    is_active: page?.is_active !== false,
    sections: normalizeSections(page?.sections || []),
  };
}

export async function saveAdminLandingPage(tenantId: string, payload: { name: string; sections: LandingSection[] }): Promise<LandingPageData> {
  const token = getToken();
  const response = await fetch(`${API_URL}/landing-builder/admin/page/${encodeURIComponent(tenantId)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  const data = await readJson(response);
  const page = data?.page;
  return {
    id: String(page?.id || ''),
    tenant_id: String(page?.tenant_id || tenantId),
    name: String(page?.name || payload.name || 'Main Landing Page'),
    is_active: true,
    sections: normalizeSections(page?.sections || payload.sections || []),
  };
}

export async function duplicateAdminLandingSection(input: { tenantId: string; pageId: string; sectionId: string }): Promise<LandingSection[]> {
  const token = getToken();
  const response = await fetch(`${API_URL}/landing-builder/admin/section/duplicate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(input),
  });
  const data = await readJson(response);
  return normalizeSections(data?.sections || []);
}

export async function fetchPublicLandingPage(tenantSlug: string): Promise<LandingPageData | null> {
  const response = await fetch(`${API_URL}/landing-builder/page/${encodeURIComponent(tenantSlug)}`);
  const data = await readJson(response);
  if (!data?.page) return null;
  const page = data.page;
  return {
    id: String(page.id || ''),
    tenant_id: String(page.tenant_id || ''),
    name: String(page.name || 'Main Landing Page'),
    is_active: page.is_active !== false,
    sections: normalizeSections(page.sections || []),
  };
}
