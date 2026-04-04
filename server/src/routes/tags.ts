import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';
import { getPermissionsForUser, PERMISSION_IDS } from '../permissions.js';
import { resolveUserFromDb } from '../middleware/resolveUserFromDb.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';
type TagTimeType = 'fixed' | 'multiplier';

function normalizeTagTimeInput(rawType: unknown, rawValue: unknown): { timeType: TagTimeType; timeValue: number } {
  const type = String(rawType || 'fixed').trim().toLowerCase() === 'multiplier' ? 'multiplier' : 'fixed';
  const parsedValue = rawValue !== undefined && rawValue !== null && String(rawValue).trim() !== ''
    ? Number(rawValue)
    : (type === 'multiplier' ? 1 : 0);
  const safeValue = Number.isFinite(parsedValue) ? parsedValue : (type === 'multiplier' ? 1 : 0);
  return { timeType: type, timeValue: safeValue };
}

function validateTagTimeInput(timeType: TagTimeType, timeValue: number): string | null {
  if (timeType === 'fixed') {
    if (timeValue < 0) return 'time_value must be a non-negative number for fixed type';
    return null;
  }
  if (timeValue < 1) return 'time_value must be at least 1 for multiplier type';
  return null;
}

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

const authFresh = [authMiddleware, resolveUserFromDb];

async function getPerms(req: express.Request): Promise<string[]> {
  return getPermissionsForUser(supabase, req.user?.role_id, req.user?.role || '');
}

function requireTenant(req: express.Request, res: express.Response): string | null {
  const tid = req.user?.tenant_id;
  if (!tid) {
    res.status(403).json({ error: 'Tenant context required' });
    return null;
  }
  return tid;
}

/** Anonymous: tags for a public service (booking widget) */
router.get('/public/by-service/:serviceId', async (req, res) => {
  try {
    const tenantId = String(req.query.tenant_id || '').trim();
    const serviceId = req.params.serviceId;
    if (!tenantId) return res.status(400).json({ error: 'tenant_id query parameter is required' });

    const { data: svc, error: svcErr } = await supabase
      .from('services')
      .select('id, tenant_id, is_public, is_active')
      .eq('id', serviceId)
      .maybeSingle();

    if (svcErr || !svc || String(svc.tenant_id) !== tenantId || !svc.is_public || !svc.is_active) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const { data: rows } = await supabase.from('service_tag_assignments').select('tag_id').eq('service_id', serviceId);
    let tagIds = (rows || []).map((r: any) => r.tag_id);

    if (tagIds.length === 0) {
      const { data: def } = await supabase
        .from('service_pricing_tags')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_default', true)
        .maybeSingle();
      if (def?.id) tagIds = [def.id];
    }

    if (tagIds.length === 0) return res.json({ tags: [] });

    const { data: tags } = await supabase
      .from('service_pricing_tags')
      .select('id, name, description, is_default')
      .in('id', tagIds)
      .eq('tenant_id', tenantId)
      .order('is_default', { ascending: false })
      .order('name');

    const { data: fees } = await supabase.from('tag_fees').select('*').in('tag_id', tagIds);
    const feeMap: Record<string, any> = {};
    for (const f of fees || []) feeMap[(f as any).tag_id] = f;

    res.json({
      tags: (tags || []).map((t: any) => ({
        ...t,
        fee_value: t.is_default ? 0 : Number(feeMap[t.id]?.fee_value ?? 0),
        fee_name: feeMap[t.id]?.fee_name ?? null,
        time_type: t.is_default ? 'fixed' : (feeMap[t.id]?.time_type ?? 'fixed'),
        time_value: t.is_default ? 0 : Number(feeMap[t.id]?.time_value ?? 0),
      })),
    });
  } catch (e: any) {
    console.error('Public tags by service error', e);
    res.status(500).json({ error: e.message || 'Failed to load tags' });
  }
});

/** List tags for tenant (admin UI) */
router.get('/', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    const allowed =
      perms.includes(PERMISSION_IDS.MANAGE_TAGS) ||
      perms.includes(PERMISSION_IDS.VIEW_TAGS) ||
      perms.includes(PERMISSION_IDS.ASSIGN_TAGS_TO_SERVICES) ||
      perms.includes(PERMISSION_IDS.MANAGE_SERVICES);
    if (!allowed) return res.status(403).json({ error: 'Insufficient permissions' });

    const { data: tags, error } = await supabase
      .from('service_pricing_tags')
      .select('id, name, description, is_default, created_at')
      .eq('tenant_id', tenantId)
      .order('is_default', { ascending: false })
      .order('name');

    if (error) throw error;

    const tagIds = (tags || []).map((t: any) => t.id);
    let feesByTag: Record<string, any> = {};
    if (tagIds.length) {
      const { data: fees } = await supabase.from('tag_fees').select('*').in('tag_id', tagIds);
      for (const f of fees || []) feesByTag[(f as any).tag_id] = f;
    }

    res.json({
      tags: (tags || []).map((t: any) => ({
        ...t,
        fee: feesByTag[t.id] || null,
      })),
    });
  } catch (e: any) {
    console.error('List tags error', e);
    res.status(500).json({ error: e.message || 'Failed to list tags' });
  }
});

/** Tags available for a service (booking UI) */
router.get('/by-service/:serviceId', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    const canRead =
      perms.includes(PERMISSION_IDS.CREATE_BOOKING) ||
      perms.includes(PERMISSION_IDS.EDIT_BOOKING) ||
      perms.includes(PERMISSION_IDS.MANAGE_BOOKINGS) ||
      perms.includes(PERMISSION_IDS.MANAGE_TAGS) ||
      perms.includes(PERMISSION_IDS.VIEW_TAGS) ||
      perms.includes(PERMISSION_IDS.ASSIGN_TAGS_TO_SERVICES) ||
      perms.includes(PERMISSION_IDS.MANAGE_SERVICES);
    if (!canRead) return res.status(403).json({ error: 'Insufficient permissions' });

    const serviceId = req.params.serviceId;
    const { data: svc } = await supabase.from('services').select('id, tenant_id').eq('id', serviceId).maybeSingle();
    if (!svc || String(svc.tenant_id) !== String(tenantId)) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const { data: rows } = await supabase.from('service_tag_assignments').select('tag_id').eq('service_id', serviceId);
    let tagIds = (rows || []).map((r: any) => r.tag_id);

    if (tagIds.length === 0) {
      const { data: def } = await supabase
        .from('service_pricing_tags')
        .select('id')
        .eq('tenant_id', tenantId)
        .eq('is_default', true)
        .maybeSingle();
      if (def?.id) tagIds = [def.id];
    }

    if (tagIds.length === 0) {
      return res.json({ tags: [] });
    }

    const { data: tags } = await supabase
      .from('service_pricing_tags')
      .select('id, name, description, is_default')
      .in('id', tagIds)
      .eq('tenant_id', tenantId)
      .order('is_default', { ascending: false })
      .order('name');

    const { data: fees } = await supabase.from('tag_fees').select('*').in('tag_id', tagIds);
    const feeMap: Record<string, any> = {};
    for (const f of fees || []) feeMap[(f as any).tag_id] = f;

    res.json({
      tags: (tags || []).map((t: any) => ({
        ...t,
        fee_value: t.is_default ? 0 : Number(feeMap[t.id]?.fee_value ?? 0),
        fee_name: feeMap[t.id]?.fee_name ?? null,
        time_type: t.is_default ? 'fixed' : (feeMap[t.id]?.time_type ?? 'fixed'),
        time_value: t.is_default ? 0 : Number(feeMap[t.id]?.time_value ?? 0),
      })),
    });
  } catch (e: any) {
    console.error('Tags by service error', e);
    res.status(500).json({ error: e.message || 'Failed to load tags' });
  }
});

/** Tag IDs linked to a service (for service edit form) */
router.get('/services/:serviceId', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    if (
      !perms.includes(PERMISSION_IDS.ASSIGN_TAGS_TO_SERVICES) &&
      !perms.includes(PERMISSION_IDS.MANAGE_SERVICES) &&
      !perms.includes(PERMISSION_IDS.MANAGE_TAGS)
    ) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const serviceId = req.params.serviceId;
    const { data: svc } = await supabase.from('services').select('tenant_id').eq('id', serviceId).maybeSingle();
    if (!svc || String(svc.tenant_id) !== String(tenantId)) {
      return res.status(404).json({ error: 'Service not found' });
    }
    const { data: rows } = await supabase.from('service_tag_assignments').select('tag_id').eq('service_id', serviceId);
    res.json({ tag_ids: (rows || []).map((r: any) => r.tag_id) });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load assignments' });
  }
});

router.post('/', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    if (!perms.includes(PERMISSION_IDS.MANAGE_TAGS)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const name = String(req.body.name || '').trim();
    const description = req.body.description != null ? String(req.body.description).trim() : null;
    if (!name) return res.status(400).json({ error: 'name is required' });
    if (name.toLowerCase() === 'default') {
      return res.status(400).json({ error: 'Reserved tag name' });
    }

    const { data: created, error } = await supabase
      .from('service_pricing_tags')
      .insert({
        tenant_id: tenantId,
        name,
        description,
        is_default: false,
        updated_at: new Date().toISOString(),
      })
      .select('id, name, description, is_default, created_at')
      .single();

    if (error) {
      if (error.code === '23505') return res.status(409).json({ error: 'A tag with this name already exists' });
      throw error;
    }

    const feeRaw = req.body.fee_value;
    const feeParsed =
      feeRaw !== undefined && feeRaw !== null && String(feeRaw).trim() !== '' ? Number(feeRaw) : null;
    const { timeType, timeValue } = normalizeTagTimeInput(req.body.time_type, req.body.time_value);
    const timeValidationError = validateTagTimeInput(timeType, timeValue);
    if (timeValidationError) {
      await supabase.from('service_pricing_tags').delete().eq('id', created.id).eq('tenant_id', tenantId);
      return res.status(400).json({ error: timeValidationError });
    }
    const shouldPersistFeeRow =
      (feeParsed !== null && Number.isFinite(feeParsed) && feeParsed >= 0) ||
      timeType !== 'fixed' ||
      timeValue !== 0 ||
      req.body.fee_name != null ||
      req.body.fee_description != null;
    if (shouldPersistFeeRow) {
      const fee_name = req.body.fee_name != null ? String(req.body.fee_name).trim() : null;
      const fee_description =
        req.body.fee_description != null ? String(req.body.fee_description).trim() : null;
      const safeFeeValue = feeParsed !== null && Number.isFinite(feeParsed) && feeParsed >= 0 ? feeParsed : 0;
      const { error: feeErr } = await supabase.from('tag_fees').insert({
        tag_id: created.id,
        fee_name,
        fee_value: safeFeeValue,
        description: fee_description || null,
        time_type: timeType,
        time_value: timeValue,
      });
      if (feeErr) {
        await supabase.from('service_pricing_tags').delete().eq('id', created.id).eq('tenant_id', tenantId);
        return res.status(500).json({ error: feeErr.message || 'Failed to save tag fee' });
      }
    }

    res.status(201).json({ tag: created });
  } catch (e: any) {
    console.error('Create tag error', e);
    res.status(500).json({ error: e.message || 'Failed to create tag' });
  }
});

router.patch('/:id', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    if (!perms.includes(PERMISSION_IDS.MANAGE_TAGS)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const id = req.params.id;
    const { data: existing } = await supabase
      .from('service_pricing_tags')
      .select('id, is_default')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Tag not found' });
    if (existing.is_default) {
      if (req.body.name != null || req.body.description !== undefined) {
        const patch: any = { updated_at: new Date().toISOString() };
        if (req.body.description !== undefined) patch.description = req.body.description == null ? null : String(req.body.description).trim();
        await supabase.from('service_pricing_tags').update(patch).eq('id', id);
      }
      return res.json({ ok: true });
    }

    const patch: any = { updated_at: new Date().toISOString() };
    if (req.body.name != null) patch.name = String(req.body.name).trim();
    if (req.body.description !== undefined) patch.description = req.body.description == null ? null : String(req.body.description).trim();
    if (!patch.name && req.body.name !== undefined && !String(req.body.name || '').trim()) {
      return res.status(400).json({ error: 'name cannot be empty' });
    }

    const { error } = await supabase.from('service_pricing_tags').update(patch).eq('id', id).eq('tenant_id', tenantId);
    if (error) throw error;
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update tag' });
  }
});

router.delete('/:id', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    if (!perms.includes(PERMISSION_IDS.MANAGE_TAGS)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const id = req.params.id;
    const { error } = await supabase.from('service_pricing_tags').delete().eq('id', id).eq('tenant_id', tenantId);
    if (error) {
      if (error.message?.includes('default')) return res.status(400).json({ error: 'Cannot delete the default tag' });
      throw error;
    }
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to delete tag' });
  }
});

/** Upsert single fee row for tag (not allowed for default — DB trigger) */
router.put('/:id/fee', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    if (!perms.includes(PERMISSION_IDS.MANAGE_TAGS)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const id = req.params.id;
    const { data: tag } = await supabase
      .from('service_pricing_tags')
      .select('id, is_default')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    if (tag.is_default) return res.status(400).json({ error: 'Cannot add a fee to the default tag' });

    const fee_name = req.body.fee_name != null ? String(req.body.fee_name).trim() : null;
    const fee_value = Number(req.body.fee_value);
    const description = req.body.description != null ? String(req.body.description).trim() : null;
    if (!Number.isFinite(fee_value) || fee_value < 0) {
      return res.status(400).json({ error: 'fee_value must be a non-negative number' });
    }
    const { timeType, timeValue } = normalizeTagTimeInput(req.body.time_type, req.body.time_value);
    const timeValidationError = validateTagTimeInput(timeType, timeValue);
    if (timeValidationError) {
      return res.status(400).json({ error: timeValidationError });
    }

    const { error } = await supabase.from('tag_fees').upsert(
      {
        tag_id: id,
        fee_name,
        fee_value,
        description,
        time_type: timeType,
        time_value: timeValue,
      },
      { onConflict: 'tag_id' }
    );
    if (error) throw error;
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to save fee' });
  }
});

router.delete('/:id/fee', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    if (!perms.includes(PERMISSION_IDS.MANAGE_TAGS)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const id = req.params.id;
    const { data: tag } = await supabase
      .from('service_pricing_tags')
      .select('id')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (!tag) return res.status(404).json({ error: 'Tag not found' });
    await supabase.from('tag_fees').delete().eq('tag_id', id);
    res.json({ ok: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to remove fee' });
  }
});

/** Replace all tag assignments for a service */
router.put('/services/:serviceId/assignments', authFresh, async (req, res) => {
  try {
    const tenantId = requireTenant(req, res);
    if (!tenantId) return;
    const perms = await getPerms(req);
    if (
      !perms.includes(PERMISSION_IDS.ASSIGN_TAGS_TO_SERVICES) &&
      !perms.includes(PERMISSION_IDS.MANAGE_SERVICES)
    ) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    const serviceId = req.params.serviceId;
    const { data: svc } = await supabase.from('services').select('tenant_id').eq('id', serviceId).maybeSingle();
    if (!svc || String(svc.tenant_id) !== String(tenantId)) {
      return res.status(404).json({ error: 'Service not found' });
    }

    const tag_ids: unknown = req.body.tag_ids;
    if (!Array.isArray(tag_ids)) return res.status(400).json({ error: 'tag_ids array required' });
    const ids = [...new Set(tag_ids.map((x) => String(x)).filter(Boolean))];

    const { data: defaultTag } = await supabase
      .from('service_pricing_tags')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_default', true)
      .maybeSingle();
    const defaultId = defaultTag?.id as string | undefined;
    if (!defaultId) return res.status(500).json({ error: 'Default tag missing for tenant' });

    const finalIds = new Set(ids);
    finalIds.add(defaultId);

    const { data: validTags } = await supabase
      .from('service_pricing_tags')
      .select('id')
      .eq('tenant_id', tenantId)
      .in('id', [...finalIds]);
    const valid = new Set((validTags || []).map((t: any) => t.id));
    for (const tid of finalIds) {
      if (!valid.has(tid)) return res.status(400).json({ error: `Invalid tag_id: ${tid}` });
    }

    await supabase.from('service_tag_assignments').delete().eq('service_id', serviceId);
    const rows = [...finalIds].map((tag_id) => ({ service_id: serviceId, tag_id }));
    const { error: insErr } = await supabase.from('service_tag_assignments').insert(rows);
    if (insErr) throw insErr;
    res.json({ ok: true, tag_ids: [...finalIds] });
  } catch (e: any) {
    console.error('Assign tags error', e);
    res.status(500).json({ error: e.message || 'Failed to save assignments' });
  }
});

export { router as tagRoutes };
