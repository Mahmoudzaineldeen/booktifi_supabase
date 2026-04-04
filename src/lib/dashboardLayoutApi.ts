import { getApiUrl } from './apiUrl';
import { getAuthHeaders } from './apiClient';
import {
  DashboardLayoutConfig,
  getDefaultDashboardLayoutConfig,
  sanitizeDashboardLayoutConfig,
} from './dashboardWidgets';

type LayoutApiResponse = {
  layout_config?: DashboardLayoutConfig;
  source?: 'saved' | 'default';
  profile_key?: string;
};

export type DashboardProfile = {
  key: string;
  name: string;
  predefined: boolean;
};

export async function getDashboardProfiles(): Promise<DashboardProfile[]> {
  const response = await fetch(`${getApiUrl()}/dashboard/profiles`, {
    headers: getAuthHeaders(),
  });
  const json = (await response.json()) as { profiles?: DashboardProfile[]; error?: string };
  if (!response.ok) {
    throw new Error(json?.error || 'Failed to load dashboard profiles');
  }
  return Array.isArray(json?.profiles) ? json.profiles : [];
}

export async function getDashboardLayout(
  profileKey = 'default'
): Promise<{ layout: DashboardLayoutConfig; source: 'saved' | 'default'; profileKey: string }> {
  const qs = new URLSearchParams({ profile_key: profileKey });
  const response = await fetch(`${getApiUrl()}/dashboard/layout?${qs.toString()}`, {
    headers: getAuthHeaders(),
  });
  const json = (await response.json()) as LayoutApiResponse & { error?: string };
  if (!response.ok) {
    throw new Error(json?.error || 'Failed to load dashboard layout');
  }
  return {
    layout: sanitizeDashboardLayoutConfig(json?.layout_config ?? getDefaultDashboardLayoutConfig()),
    source: json?.source === 'saved' ? 'saved' : 'default',
    profileKey: String(json?.profile_key || profileKey),
  };
}

export async function saveDashboardLayout(
  layoutConfig: DashboardLayoutConfig,
  profileKey = 'default',
  profileName?: string
): Promise<DashboardLayoutConfig> {
  const response = await fetch(`${getApiUrl()}/dashboard/layout`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout_config: layoutConfig, profile_key: profileKey, profile_name: profileName }),
  });
  const json = (await response.json()) as LayoutApiResponse & { error?: string };
  if (!response.ok) {
    throw new Error(json?.error || 'Failed to save dashboard layout');
  }
  return sanitizeDashboardLayoutConfig(json?.layout_config ?? layoutConfig);
}

export async function resetDashboardLayout(profileKey = 'default'): Promise<DashboardLayoutConfig> {
  const response = await fetch(`${getApiUrl()}/dashboard/layout/reset`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile_key: profileKey }),
  });
  const json = (await response.json()) as LayoutApiResponse & { error?: string };
  if (!response.ok) {
    throw new Error(json?.error || 'Failed to reset dashboard layout');
  }
  return sanitizeDashboardLayoutConfig(json?.layout_config ?? getDefaultDashboardLayoutConfig());
}
