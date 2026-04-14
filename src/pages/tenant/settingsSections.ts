/** URL segments for `/admin/settings/:section` (no hash navigation). */
export const SETTINGS_SECTION_SLUGS = [
  'account',
  'scheduling',
  'logos',
  'app-manager',
  'whatsapp',
  'integrations',
] as const;

/** Primary horizontal tabs on the settings page (order). */
export const SETTINGS_TOP_NAV_SLUGS = ['account', 'app-manager'] as const;

/** Secondary row: operations & branding (sidebar also lists these). */
export const SETTINGS_MORE_NAV_SLUGS = ['scheduling', 'logos'] as const;

export type AppManagerTab = 'smtp' | 'whatsapp' | 'invoices';

export function normalizeAppManagerTab(tab: string | null): AppManagerTab {
  if (tab === 'whatsapp' || tab === 'invoices') return tab;
  return 'smtp';
}

export type SettingsSectionSlug = (typeof SETTINGS_SECTION_SLUGS)[number];

export function isValidSettingsSection(
  section: string | undefined,
  role: string | undefined
): section is SettingsSectionSlug {
  if (!section) return false;
  if (!SETTINGS_SECTION_SLUGS.includes(section as SettingsSectionSlug)) return false;
  return true;
}
