import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, '');
const SCREENSHOT_BUCKET = 'support-ticket-screenshots';
const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024; // 5MB decoded

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        tenant_id?: string | null;
        branch_id?: string | null;
      };
    }
  }
}

/** Authenticate any valid JWT and set req.user */
function authenticateJWT(req: express.Request, res: express.Response, next: express.NextFunction) {
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
      tenant_id: decoded.tenant_id ?? null,
      branch_id: decoded.branch_id ?? null,
    };
    next();
  } catch (e: any) {
    if (e.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token has expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/** Solution owner only */
function requireSolutionOwner(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.user?.role !== 'solution_owner') {
    return res.status(403).json({ error: 'Access denied. Only Solution Owner can perform this action.' });
  }
  next();
}

/** Get current user's branch name (for ticket form display). Path is literal to avoid conflict with /:id or /by-tenant/:id. */
router.get('/current-user-branch', authenticateJWT, async (req, res) => {
  try {
    const branch_id = req.user!.branch_id;
    if (!branch_id) {
      return res.json({ branch_id: null, branch_name: null });
    }
    const { data: branch, error } = await supabase
      .from('branches')
      .select('id, name')
      .eq('id', branch_id)
      .maybeSingle();
    if (error) throw error;
    res.json({
      branch_id: branch?.id ?? null,
      branch_name: branch?.name ?? null,
    });
  } catch (err: any) {
    console.error('Support tickets current-user-branch error:', err);
    res.status(500).json({ error: err.message || 'Failed to load branch' });
  }
});

/** Upload screenshot for a ticket — returns URL to pass to POST / */
router.post('/upload-screenshot', authenticateJWT, async (req, res) => {
  try {
    if (req.user!.role === 'solution_owner') {
      return res.status(403).json({ error: 'Solution Owner cannot create support tickets.' });
    }
    if (['customer', 'customer_admin'].includes(req.user!.role || '')) {
      return res.status(403).json({ error: 'Customers cannot upload screenshots for tickets.' });
    }
    const tenant_id = req.user!.tenant_id;
    if (!tenant_id) {
      return res.status(400).json({ error: 'No tenant associated with your account.' });
    }
    const { base64, filename } = req.body;
    if (!base64 || typeof base64 !== 'string') {
      return res.status(400).json({ error: 'base64 image data is required.' });
    }
    const buffer = Buffer.from(base64, 'base64');
    if (buffer.length > MAX_SCREENSHOT_BYTES) {
      return res.status(400).json({ error: 'Screenshot is too large. Maximum size is 5MB.' });
    }
    const ext = (typeof filename === 'string' ? filename.split('.').pop() : 'png')?.toLowerCase() || 'png';
    const contentType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : 'image/png';
    const safeName = (typeof filename === 'string' ? filename.replace(/[^a-zA-Z0-9._-]/g, '_') : 'screenshot') || 'screenshot';
    const path = `${tenant_id}/${req.user!.id}/${Date.now()}-${safeName}`;

    const { data: buckets } = await supabase.storage.listBuckets();
    if (!buckets?.some((b: any) => b.name === SCREENSHOT_BUCKET)) {
      const { error: bucketErr } = await supabase.storage.createBucket(SCREENSHOT_BUCKET, { public: true });
      if (bucketErr) console.warn('Support ticket screenshot bucket create:', bucketErr.message);
    }

    const { error: uploadError } = await supabase.storage
      .from(SCREENSHOT_BUCKET)
      .upload(path, buffer, { contentType, upsert: false });

    if (uploadError) {
      console.error('Support ticket screenshot upload error:', uploadError);
      return res.status(500).json({ error: uploadError.message || 'Failed to upload screenshot' });
    }

    const url = `${SUPABASE_URL}/storage/v1/object/public/${SCREENSHOT_BUCKET}/${path}`;
    res.json({ url });
  } catch (err: any) {
    console.error('Support ticket upload screenshot error:', err);
    res.status(500).json({ error: err.message || 'Failed to upload screenshot' });
  }
});

/** Create ticket — all roles except Solution Owner */
router.post('/', authenticateJWT, async (req, res) => {
  try {
    if (req.user!.role === 'solution_owner') {
      return res.status(403).json({ error: 'Solution Owner cannot create support tickets.' });
    }
    if (['customer', 'customer_admin'].includes(req.user!.role || '')) {
      return res.status(403).json({ error: 'Customers cannot create support tickets.' });
    }
    const tenant_id = req.user!.tenant_id;
    if (!tenant_id) {
      return res.status(400).json({ error: 'No tenant associated with your account.' });
    }
    const { title, description, screenshot_url } = req.body;
    if (!title || typeof title !== 'string' || !title.trim()) {
      return res.status(400).json({ error: 'Title is required.' });
    }
    if (!description || typeof description !== 'string' || !description.trim()) {
      return res.status(400).json({ error: 'Problem description is required.' });
    }
    const screenshotUrl = typeof screenshot_url === 'string' && screenshot_url.trim() ? screenshot_url.trim() : null;

    const { data, error } = await supabase
      .from('support_tickets')
      .insert({
        tenant_id,
        branch_id: req.user!.branch_id || null,
        created_by_user_id: req.user!.id,
        role: req.user!.role || 'employee',
        title: title.trim(),
        description: description.trim(),
        status: 'open',
        screenshot_url: screenshotUrl,
      })
      .select('id, tenant_id, branch_id, created_by_user_id, role, title, status, created_at')
      .single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err: any) {
    console.error('Support ticket create error:', err);
    res.status(500).json({ error: err.message || 'Failed to create ticket' });
  }
});

/** Overview for Solution Owner: tenants with ticket counts */
router.get('/overview', authenticateJWT, requireSolutionOwner, async (req, res) => {
  try {
    const { data: tickets, error } = await supabase
      .from('support_tickets')
      .select('id, tenant_id, status');

    if (error) throw error;

    const byTenant: Record<string, { open: number; in_progress: number; resolved: number }> = {};
    for (const t of tickets || []) {
      const tid = t.tenant_id;
      if (!byTenant[tid]) byTenant[tid] = { open: 0, in_progress: 0, resolved: 0 };
      if (t.status === 'open') byTenant[tid].open++;
      else if (t.status === 'in_progress') byTenant[tid].in_progress++;
      else byTenant[tid].resolved++;
    }

    const tenantIds = Object.keys(byTenant);
    if (tenantIds.length === 0) {
      return res.json({ tenants: [], countsByTenant: {} });
    }

    const { data: tenants, error: tenantsError } = await supabase
      .from('tenants')
      .select('id, name, name_ar, slug')
      .in('id', tenantIds);

    if (tenantsError) throw tenantsError;

    const list = (tenants || []).map((t: any) => ({
      id: t.id,
      name: t.name,
      name_ar: t.name_ar,
      slug: t.slug,
      open: byTenant[t.id]?.open ?? 0,
      in_progress: byTenant[t.id]?.in_progress ?? 0,
      resolved: byTenant[t.id]?.resolved ?? 0,
    }));
    res.json({ tenants: list, countsByTenant: byTenant });
  } catch (err: any) {
    console.error('Support tickets overview error:', err);
    res.status(500).json({ error: err.message || 'Failed to load overview' });
  }
});

/** Tickets for one tenant — Solution Owner only */
router.get('/by-tenant/:tenantId', authenticateJWT, requireSolutionOwner, async (req, res) => {
  try {
    const { tenantId } = req.params;
    if (!tenantId) return res.status(400).json({ error: 'tenantId required' });

    const { data: tickets, error } = await supabase
      .from('support_tickets')
      .select(`
        id, tenant_id, branch_id, created_by_user_id, role, title, description, status, created_at, updated_at, updated_by, screenshot_url
      `)
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    const userIds = [...new Set((tickets || []).map((t: any) => t.created_by_user_id).filter(Boolean))];
    const branchIds = [...new Set((tickets || []).map((t: any) => t.branch_id).filter(Boolean))];

    let users: any[] = [];
    let branches: any[] = [];
    if (userIds.length > 0) {
      const { data: u } = await supabase.from('users').select('id, full_name, full_name_ar, email').in('id', userIds);
      users = u || [];
    }
    if (branchIds.length > 0) {
      const { data: b } = await supabase.from('branches').select('id, name').in('id', branchIds);
      branches = b || [];
    }

    const userMap = Object.fromEntries(users.map((u: any) => [u.id, u]));
    const branchMap = Object.fromEntries(branches.map((b: any) => [b.id, b]));

    const list = (tickets || []).map((t: any) => ({
      ...t,
      created_by_name: userMap[t.created_by_user_id]?.full_name || userMap[t.created_by_user_id]?.full_name_ar || '—',
      created_by_email: userMap[t.created_by_user_id]?.email ?? null,
      branch_name: t.branch_id ? (branchMap[t.branch_id]?.name || '—') : '—',
    }));
    res.json({ tickets: list });
  } catch (err: any) {
    console.error('Support tickets by-tenant error:', err);
    res.status(500).json({ error: err.message || 'Failed to load tickets' });
  }
});

/** Update ticket status — Solution Owner only. When status is 'resolved', the ticket is deleted. */
router.patch('/:id/status', authenticateJWT, requireSolutionOwner, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const allowed = ['open', 'in_progress', 'resolved'];
    if (!status || !allowed.includes(status)) {
      return res.status(400).json({ error: 'Valid status required: open, in_progress, resolved' });
    }

    if (status === 'resolved') {
      const { error: deleteError } = await supabase
        .from('support_tickets')
        .delete()
        .eq('id', id);

      if (deleteError) throw deleteError;
      return res.json({ id, deleted: true });
    }

    const { data, error } = await supabase
      .from('support_tickets')
      .update({
        status,
        updated_at: new Date().toISOString(),
        updated_by: req.user!.id,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Ticket not found' });
    res.json(data);
  } catch (err: any) {
    console.error('Support ticket status update error:', err);
    res.status(500).json({ error: err.message || 'Failed to update status' });
  }
});

export { router as supportTicketRoutes };
