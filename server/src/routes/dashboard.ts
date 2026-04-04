import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';
import { getPermissionsForUser, PERMISSION_IDS } from '../permissions.js';
import { resolveUserFromDb } from '../middleware/resolveUserFromDb.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DASHBOARD_LAYOUT_KEY = 'tenant_admin_home';
const DASHBOARD_LAYOUT_VERSION = 1;
const LAYOUT_KEY_SEPARATOR = '::';
const PREDEFINED_PROFILE_KEYS = ['default', 'analytics', 'operations'] as const;
type ProfileKey = (typeof PREDEFINED_PROFILE_KEYS)[number] | string;

const ALLOWED_WIDGET_IDS = [
  'totalBookings',
  'bookingRevenue',
  'paidBookings',
  'unpaidBookings',
  'packageSubscriptions',
  'packageRevenue',
  'completedBookings',
  'averageBookingValue',
  'totalRevenueCombined',
  'revenueByService',
  'serviceBookingComparison',
  'servicePerformanceRevenue',
  'bookingsByService',
  'upcomingBookings',
  'pastBookings',
] as const;

type WidgetId = (typeof ALLOWED_WIDGET_IDS)[number];
type LayoutItem = { id: WidgetId; x: number; y: number; w: number; h: number; visible: boolean };
type LayoutConfig = { version: number; widgets: LayoutItem[] };
const WIDGET_MIN_HEIGHT_ROWS: Partial<Record<WidgetId, number>> = {};

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  version: DASHBOARD_LAYOUT_VERSION,
  widgets: [
    { id: 'totalBookings', x: 0, y: 0, w: 4, h: 2, visible: true },
    { id: 'bookingRevenue', x: 4, y: 0, w: 4, h: 2, visible: true },
    { id: 'paidBookings', x: 8, y: 0, w: 4, h: 2, visible: true },
    { id: 'unpaidBookings', x: 0, y: 2, w: 4, h: 2, visible: true },
    { id: 'packageSubscriptions', x: 4, y: 2, w: 4, h: 2, visible: true },
    { id: 'packageRevenue', x: 8, y: 2, w: 4, h: 2, visible: true },
    { id: 'completedBookings', x: 0, y: 4, w: 6, h: 2, visible: true },
    { id: 'averageBookingValue', x: 6, y: 4, w: 6, h: 2, visible: true },
    { id: 'totalRevenueCombined', x: 0, y: 6, w: 12, h: 1, visible: true },
    { id: 'revenueByService', x: 0, y: 7, w: 12, h: 4, visible: true },
    { id: 'serviceBookingComparison', x: 0, y: 11, w: 12, h: 4, visible: true },
    { id: 'servicePerformanceRevenue', x: 0, y: 15, w: 12, h: 4, visible: true },
    { id: 'bookingsByService', x: 0, y: 19, w: 12, h: 4, visible: true },
    { id: 'upcomingBookings', x: 0, y: 23, w: 12, h: 5, visible: true },
    { id: 'pastBookings', x: 0, y: 28, w: 12, h: 5, visible: true },
  ],
};

const ANALYTICS_LAYOUT_CONFIG: LayoutConfig = {
  version: DASHBOARD_LAYOUT_VERSION,
  widgets: [
    { id: 'bookingRevenue', x: 0, y: 0, w: 6, h: 2, visible: true },
    { id: 'totalRevenueCombined', x: 6, y: 0, w: 6, h: 2, visible: true },
    { id: 'revenueByService', x: 0, y: 2, w: 12, h: 4, visible: true },
    { id: 'servicePerformanceRevenue', x: 0, y: 6, w: 12, h: 4, visible: true },
    { id: 'serviceBookingComparison', x: 0, y: 10, w: 12, h: 4, visible: true },
    { id: 'bookingsByService', x: 0, y: 14, w: 12, h: 4, visible: true },
    { id: 'totalBookings', x: 0, y: 18, w: 4, h: 2, visible: true },
    { id: 'paidBookings', x: 4, y: 18, w: 4, h: 2, visible: true },
    { id: 'unpaidBookings', x: 8, y: 18, w: 4, h: 2, visible: true },
    { id: 'averageBookingValue', x: 0, y: 20, w: 6, h: 2, visible: true },
    { id: 'completedBookings', x: 6, y: 20, w: 6, h: 2, visible: true },
    { id: 'packageRevenue', x: 0, y: 22, w: 6, h: 2, visible: true },
    { id: 'packageSubscriptions', x: 6, y: 22, w: 6, h: 2, visible: true },
    { id: 'upcomingBookings', x: 0, y: 24, w: 12, h: 5, visible: false },
    { id: 'pastBookings', x: 0, y: 29, w: 12, h: 5, visible: false },
  ],
};

const OPERATIONS_LAYOUT_CONFIG: LayoutConfig = {
  version: DASHBOARD_LAYOUT_VERSION,
  widgets: [
    { id: 'upcomingBookings', x: 0, y: 0, w: 12, h: 5, visible: true },
    { id: 'pastBookings', x: 0, y: 5, w: 12, h: 5, visible: true },
    { id: 'totalBookings', x: 0, y: 10, w: 4, h: 2, visible: true },
    { id: 'paidBookings', x: 4, y: 10, w: 4, h: 2, visible: true },
    { id: 'unpaidBookings', x: 8, y: 10, w: 4, h: 2, visible: true },
    { id: 'completedBookings', x: 0, y: 12, w: 6, h: 2, visible: true },
    { id: 'averageBookingValue', x: 6, y: 12, w: 6, h: 2, visible: true },
    { id: 'bookingRevenue', x: 0, y: 14, w: 6, h: 2, visible: true },
    { id: 'totalRevenueCombined', x: 6, y: 14, w: 6, h: 2, visible: true },
    { id: 'packageSubscriptions', x: 0, y: 16, w: 6, h: 2, visible: true },
    { id: 'packageRevenue', x: 6, y: 16, w: 6, h: 2, visible: true },
    { id: 'bookingsByService', x: 0, y: 18, w: 12, h: 4, visible: true },
    { id: 'serviceBookingComparison', x: 0, y: 22, w: 12, h: 4, visible: true },
    { id: 'revenueByService', x: 0, y: 26, w: 12, h: 4, visible: false },
    { id: 'servicePerformanceRevenue', x: 0, y: 30, w: 12, h: 4, visible: false },
  ],
};

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
      branch_id: decoded.branch_id ?? null,
      role_id: decoded.role_id ?? null,
    };
    next();
  } catch (e: any) {
    if (e.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token has expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

const authWithFreshUser = [authMiddleware, resolveUserFromDb];

async function requireCustomizeDashboard(req: express.Request, res: express.Response): Promise<boolean> {
  const perms = await getPermissionsForUser(supabase, req.user?.role_id, req.user?.role || '');
  if (!perms.includes(PERMISSION_IDS.CUSTOMIZE_DASHBOARD)) {
    res.status(403).json({ error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

function sanitizeLayoutConfig(input: unknown): LayoutConfig {
  if (!input || typeof input !== 'object') return DEFAULT_LAYOUT_CONFIG;
  const rawWidgets = Array.isArray((input as any).widgets) ? (input as any).widgets : [];
  const byId = new Map<WidgetId, LayoutItem>();

  for (const item of rawWidgets) {
    if (!item || typeof item !== 'object') continue;
    const cast = item as Partial<LayoutItem>;
    if (!cast.id || !ALLOWED_WIDGET_IDS.includes(cast.id as WidgetId)) continue;
    const width = Number.isFinite(cast.w) ? Math.max(1, Math.min(12, Number(cast.w))) : 4;
    const minHeight = WIDGET_MIN_HEIGHT_ROWS[cast.id as WidgetId] ?? 1;
    const height = Number.isFinite(cast.h) ? Math.max(minHeight, Math.min(12, Number(cast.h))) : Math.max(minHeight, 2);
    const x = Number.isFinite(cast.x) ? Math.max(0, Math.min(12 - width, Number(cast.x))) : 0;
    const y = Number.isFinite(cast.y) ? Math.max(0, Number(cast.y)) : 0;
    byId.set(cast.id as WidgetId, {
      id: cast.id as WidgetId,
      x,
      y,
      w: width,
      h: height,
      visible: cast.visible !== false,
    });
  }

  const widgets = DEFAULT_LAYOUT_CONFIG.widgets.map((def) => {
    const found = byId.get(def.id);
    return {
      id: def.id,
      x: found?.x ?? def.x,
      y: found?.y ?? def.y,
      w: found?.w ?? def.w,
      h: found?.h ?? def.h,
      visible: found?.visible ?? true,
    };
  });

  return { version: DASHBOARD_LAYOUT_VERSION, widgets };
}

function getProfileKey(raw: unknown): ProfileKey {
  const text = String(raw || 'default').trim().toLowerCase();
  if (!text) return 'default';
  const sanitized = text.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-').slice(0, 60);
  return sanitized || 'default';
}

function toStorageLayoutKey(profileKey: string): string {
  if (profileKey === 'default') return DASHBOARD_LAYOUT_KEY;
  return `${DASHBOARD_LAYOUT_KEY}${LAYOUT_KEY_SEPARATOR}${profileKey}`;
}

function extractProfileKey(layoutKey: string): string | null {
  if (!layoutKey) return null;
  if (layoutKey === DASHBOARD_LAYOUT_KEY) return 'default';
  const prefix = `${DASHBOARD_LAYOUT_KEY}${LAYOUT_KEY_SEPARATOR}`;
  if (!layoutKey.startsWith(prefix)) return null;
  return layoutKey.slice(prefix.length) || null;
}

function getPredefinedProfileDefaults(profileKey: string): LayoutConfig {
  if (profileKey === 'analytics') return ANALYTICS_LAYOUT_CONFIG;
  if (profileKey === 'operations') return OPERATIONS_LAYOUT_CONFIG;
  return DEFAULT_LAYOUT_CONFIG;
}

function getPredefinedProfileName(profileKey: string): string {
  if (profileKey === 'analytics') return 'Analytics Focus';
  if (profileKey === 'operations') return 'Operations Focus';
  return 'Default';
}

router.get('/profiles', authWithFreshUser, async (req, res) => {
  try {
    if (!req.user?.id || !req.user?.tenant_id) return res.status(403).json({ error: 'Tenant context required' });
    if (!(await requireCustomizeDashboard(req, res))) return;

    const { data, error } = await supabase
      .from('user_dashboard_layouts')
      .select('layout_key, layout_config')
      .eq('tenant_id', req.user.tenant_id)
      .eq('user_id', req.user.id);
    if (error) throw error;

    const customProfiles = (data || [])
      .map((row: any) => {
        const profileKey = extractProfileKey(String(row.layout_key || ''));
        if (!profileKey || PREDEFINED_PROFILE_KEYS.includes(profileKey as any)) return null;
        const profileName =
          row.layout_config?.meta?.profile_name ||
          row.layout_config?.profile_name ||
          profileKey.replace(/[-_]/g, ' ');
        return { key: profileKey, name: String(profileName), predefined: false };
      })
      .filter(Boolean) as Array<{ key: string; name: string; predefined: boolean }>;

    const predefinedProfiles = PREDEFINED_PROFILE_KEYS.map((key) => ({
      key,
      name: getPredefinedProfileName(key),
      predefined: true,
    }));

    return res.json({ profiles: [...predefinedProfiles, ...customProfiles] });
  } catch (e: any) {
    console.error('Get dashboard profiles error:', e);
    res.status(500).json({ error: e.message || 'Failed to load dashboard profiles' });
  }
});

router.get('/layout', authWithFreshUser, async (req, res) => {
  try {
    if (!req.user?.id || !req.user?.tenant_id) return res.status(403).json({ error: 'Tenant context required' });
    if (!(await requireCustomizeDashboard(req, res))) return;
    const profileKey = getProfileKey(req.query.profile_key);
    const storageLayoutKey = toStorageLayoutKey(profileKey);

    const { data, error } = await supabase
      .from('user_dashboard_layouts')
      .select('layout_config')
      .eq('tenant_id', req.user.tenant_id)
      .eq('user_id', req.user.id)
      .eq('layout_key', storageLayoutKey)
      .maybeSingle();

    if (error) throw error;

    // Backward-compat: old single-key default layout record
    if (!data?.layout_config && profileKey === 'default') {
      const { data: legacyData } = await supabase
        .from('user_dashboard_layouts')
        .select('layout_config')
        .eq('tenant_id', req.user.tenant_id)
        .eq('user_id', req.user.id)
        .eq('layout_key', DASHBOARD_LAYOUT_KEY)
        .maybeSingle();
      if (legacyData?.layout_config) {
        return res.json({
          profile_key: profileKey,
          layout_config: sanitizeLayoutConfig(legacyData.layout_config),
          source: 'saved',
        });
      }
    }

    if (!data?.layout_config) {
      return res.json({
        profile_key: profileKey,
        layout_config: getPredefinedProfileDefaults(profileKey),
        source: 'default',
      });
    }

    return res.json({
      profile_key: profileKey,
      layout_config: sanitizeLayoutConfig(data.layout_config),
      source: 'saved',
    });
  } catch (e: any) {
    console.error('Get dashboard layout error:', e);
    res.status(500).json({ error: e.message || 'Failed to load dashboard layout' });
  }
});

router.post('/layout', authWithFreshUser, async (req, res) => {
  try {
    if (!req.user?.id || !req.user?.tenant_id) return res.status(403).json({ error: 'Tenant context required' });
    if (!(await requireCustomizeDashboard(req, res))) return;
    const profileKey = getProfileKey(req.body?.profile_key);
    const storageLayoutKey = toStorageLayoutKey(profileKey);
    const profileNameRaw = String(req.body?.profile_name || '').trim();
    const profileName = profileNameRaw.slice(0, 80);

    const sanitized = sanitizeLayoutConfig(req.body?.layout_config);
    const { error } = await supabase.from('user_dashboard_layouts').upsert(
      {
        tenant_id: req.user.tenant_id,
        user_id: req.user.id,
        layout_key: storageLayoutKey,
        layout_config: {
          ...sanitized,
          meta: {
            profile_name: profileName || (PREDEFINED_PROFILE_KEYS.includes(profileKey as any) ? getPredefinedProfileName(profileKey) : profileKey),
            profile_key: profileKey,
          },
        } as any,
      },
      { onConflict: 'tenant_id,user_id,layout_key' }
    );
    if (error) throw error;

    return res.json({ ok: true, profile_key: profileKey, layout_config: sanitized });
  } catch (e: any) {
    console.error('Save dashboard layout error:', e);
    res.status(500).json({ error: e.message || 'Failed to save dashboard layout' });
  }
});

router.post('/layout/reset', authWithFreshUser, async (req, res) => {
  try {
    if (!req.user?.id || !req.user?.tenant_id) return res.status(403).json({ error: 'Tenant context required' });
    if (!(await requireCustomizeDashboard(req, res))) return;
    const profileKey = getProfileKey(req.body?.profile_key);
    const storageLayoutKey = toStorageLayoutKey(profileKey);

    const { error } = await supabase
      .from('user_dashboard_layouts')
      .delete()
      .eq('tenant_id', req.user.tenant_id)
      .eq('user_id', req.user.id)
      .eq('layout_key', storageLayoutKey);
    if (error) throw error;

    return res.json({
      ok: true,
      profile_key: profileKey,
      layout_config: getPredefinedProfileDefaults(profileKey),
    });
  } catch (e: any) {
    console.error('Reset dashboard layout error:', e);
    res.status(500).json({ error: e.message || 'Failed to reset dashboard layout' });
  }
});

export { router as dashboardRoutes };
