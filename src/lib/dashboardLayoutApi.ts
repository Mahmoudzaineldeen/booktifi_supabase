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
};

export async function getDashboardLayout(): Promise<{ layout: DashboardLayoutConfig; source: 'saved' | 'default' }> {
  const response = await fetch(`${getApiUrl()}/dashboard/layout`, {
    headers: getAuthHeaders(),
  });
  const json = (await response.json()) as LayoutApiResponse & { error?: string };
  if (!response.ok) {
    throw new Error(json?.error || 'Failed to load dashboard layout');
  }
  return {
    layout: sanitizeDashboardLayoutConfig(json?.layout_config ?? getDefaultDashboardLayoutConfig()),
    source: json?.source === 'saved' ? 'saved' : 'default',
  };
}

export async function saveDashboardLayout(layoutConfig: DashboardLayoutConfig): Promise<DashboardLayoutConfig> {
  const response = await fetch(`${getApiUrl()}/dashboard/layout`, {
    method: 'POST',
    headers: { ...getAuthHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ layout_config: layoutConfig }),
  });
  const json = (await response.json()) as LayoutApiResponse & { error?: string };
  if (!response.ok) {
    throw new Error(json?.error || 'Failed to save dashboard layout');
  }
  return sanitizeDashboardLayoutConfig(json?.layout_config ?? layoutConfig);
}

export async function resetDashboardLayout(): Promise<DashboardLayoutConfig> {
  const response = await fetch(`${getApiUrl()}/dashboard/layout/reset`, {
    method: 'POST',
    headers: getAuthHeaders(),
  });
  const json = (await response.json()) as LayoutApiResponse & { error?: string };
  if (!response.ok) {
    throw new Error(json?.error || 'Failed to reset dashboard layout');
  }
  return sanitizeDashboardLayoutConfig(json?.layout_config ?? getDefaultDashboardLayoutConfig());
}
