import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';
import { getPermissionsForUser, PERMISSION_IDS } from '../permissions.js';
import { resolveUserFromDb } from '../middleware/resolveUserFromDb.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const DASHBOARD_LAYOUT_KEY = 'tenant_admin_home';
const DASHBOARD_LAYOUT_VERSION = 1;

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
    byId.set(cast.id as WidgetId, {
      id: cast.id as WidgetId,
      x: Number.isFinite(cast.x) ? Number(cast.x) : 0,
      y: Number.isFinite(cast.y) ? Number(cast.y) : 0,
      w: Number.isFinite(cast.w) ? Math.max(1, Math.min(12, Number(cast.w))) : 4,
      h: Number.isFinite(cast.h) ? Math.max(1, Math.min(12, Number(cast.h))) : 2,
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

router.get('/layout', authWithFreshUser, async (req, res) => {
  try {
    if (!req.user?.id || !req.user?.tenant_id) return res.status(403).json({ error: 'Tenant context required' });
    if (!(await requireCustomizeDashboard(req, res))) return;

    const { data, error } = await supabase
      .from('user_dashboard_layouts')
      .select('layout_config')
      .eq('tenant_id', req.user.tenant_id)
      .eq('user_id', req.user.id)
      .eq('layout_key', DASHBOARD_LAYOUT_KEY)
      .maybeSingle();

    if (error) throw error;

    if (!data?.layout_config) {
      return res.json({ layout_config: DEFAULT_LAYOUT_CONFIG, source: 'default' });
    }

    return res.json({
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

    const sanitized = sanitizeLayoutConfig(req.body?.layout_config);
    const { error } = await supabase.from('user_dashboard_layouts').upsert(
      {
        tenant_id: req.user.tenant_id,
        user_id: req.user.id,
        layout_key: DASHBOARD_LAYOUT_KEY,
        layout_config: sanitized as any,
      },
      { onConflict: 'tenant_id,user_id,layout_key' }
    );
    if (error) throw error;

    return res.json({ ok: true, layout_config: sanitized });
  } catch (e: any) {
    console.error('Save dashboard layout error:', e);
    res.status(500).json({ error: e.message || 'Failed to save dashboard layout' });
  }
});

router.post('/layout/reset', authWithFreshUser, async (req, res) => {
  try {
    if (!req.user?.id || !req.user?.tenant_id) return res.status(403).json({ error: 'Tenant context required' });
    if (!(await requireCustomizeDashboard(req, res))) return;

    const { error } = await supabase
      .from('user_dashboard_layouts')
      .delete()
      .eq('tenant_id', req.user.tenant_id)
      .eq('user_id', req.user.id)
      .eq('layout_key', DASHBOARD_LAYOUT_KEY);
    if (error) throw error;

    return res.json({ ok: true, layout_config: DEFAULT_LAYOUT_CONFIG });
  } catch (e: any) {
    console.error('Reset dashboard layout error:', e);
    res.status(500).json({ error: e.message || 'Failed to reset dashboard layout' });
  }
});

export { router as dashboardRoutes };
