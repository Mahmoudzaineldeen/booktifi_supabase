import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';
import { getPermissionsForUser, PERMISSION_IDS } from '../permissions';
import { resolveUserFromDb } from '../middleware/resolveUserFromDb';
import {
  LANDING_SECTION_TYPES,
  type LandingSectionType,
  normalizeSections,
  sanitizeSection,
  validateSection,
  defaultSectionContent,
} from '../lib/landingSections';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization required' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
      role_id: decoded.role_id ?? null,
      branch_id: decoded.branch_id ?? null,
    };
    next();
  } catch (e: any) {
    if (e.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token has expired' });
    return res.status(401).json({ error: 'Invalid token' });
  }
}

const authWithFreshUser = [authMiddleware, resolveUserFromDb];

async function requireLandingBuilderPermission(req: express.Request, res: express.Response): Promise<boolean> {
  const user = (req as any).user || {};
  const permissions = await getPermissionsForUser(supabase, user.role_id ?? null, user.role || '');
  if (!permissions.includes(PERMISSION_IDS.CUSTOMIZE_DASHBOARD) && user.role !== 'solution_owner') {
    res.status(403).json({ error: 'Insufficient permissions' });
    return false;
  }
  return true;
}

function canAccessTenant(req: express.Request, tenantId: string): boolean {
  const user = (req as any).user || {};
  if (user.role === 'solution_owner') return true;
  return !!tenantId && tenantId === user.tenant_id;
}

function createDefaultSections() {
  return LANDING_SECTION_TYPES.map((type, index) => ({
    type,
    order_index: index,
    is_visible: true,
    content: defaultSectionContent(type),
  }));
}

// Public projection for rendering by slug.
router.get('/page/:tenantSlug', async (req, res) => {
  try {
    const tenantSlug = String(req.params.tenantSlug || '').trim();
    if (!tenantSlug) return res.status(400).json({ error: 'tenantSlug is required' });

    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, slug, is_active')
      .eq('slug', tenantSlug)
      .maybeSingle();

    if (tenantError) throw tenantError;
    if (!tenant || tenant.is_active === false) {
      return res.status(404).json({ error: 'Tenant not found' });
    }

    const { data: page, error: pageError } = await supabase
      .from('landing_pages')
      .select('id, tenant_id, name, is_active')
      .eq('tenant_id', tenant.id)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pageError) throw pageError;
    if (!page) return res.json({ page: null });

    const { data: sectionsRows, error: sectionsError } = await supabase
      .from('landing_page_sections')
      .select('id, page_id, type, order_index, is_visible, content')
      .eq('page_id', page.id)
      .order('order_index', { ascending: true });

    if (sectionsError) throw sectionsError;

    const sections = normalizeSections(sectionsRows || []).map((section, idx) => ({
      id: section.id,
      type: section.type,
      order_index: Number.isFinite(section.order_index) ? section.order_index : idx,
      is_visible: section.is_visible !== false,
      content: sanitizeSection(section.type, section.content),
    }));

    return res.json({
      page: {
        id: page.id,
        tenant_id: page.tenant_id,
        name: page.name,
        is_active: page.is_active,
        sections,
      },
    });
  } catch (e: any) {
    console.error('Public landing page load error:', e);
    return res.status(500).json({ error: e.message || 'Failed to load landing page' });
  }
});

// Admin full editable payload by tenant id.
router.get('/admin/page/:tenantId', authWithFreshUser, async (req, res) => {
  try {
    if (!(await requireLandingBuilderPermission(req, res))) return;
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    if (!canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Tenant access denied' });

    let { data: page, error: pageError } = await supabase
      .from('landing_pages')
      .select('id, tenant_id, name, is_active')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pageError) throw pageError;

    if (!page) {
      const { data: createdPage, error: createError } = await supabase
        .from('landing_pages')
        .insert({ tenant_id: tenantId, name: 'Main Landing Page', is_active: true })
        .select('id, tenant_id, name, is_active')
        .single();
      if (createError) throw createError;
      page = createdPage;

      const defaults = createDefaultSections().map((section) => ({
        ...section,
        page_id: page.id,
      }));
      const { error: seedError } = await supabase.from('landing_page_sections').insert(defaults);
      if (seedError) throw seedError;
    }

    const { data: rows, error: sectionsError } = await supabase
      .from('landing_page_sections')
      .select('id, page_id, type, order_index, is_visible, content')
      .eq('page_id', page.id)
      .order('order_index', { ascending: true });
    if (sectionsError) throw sectionsError;

    const sections = normalizeSections(rows || []).map((section, idx) => ({
      id: section.id,
      type: section.type,
      order_index: Number.isFinite(section.order_index) ? section.order_index : idx,
      is_visible: section.is_visible !== false,
      content: sanitizeSection(section.type, section.content),
    }));

    return res.json({
      page: {
        id: page.id,
        tenant_id: page.tenant_id,
        name: page.name,
        is_active: page.is_active,
        sections,
      },
    });
  } catch (e: any) {
    console.error('Admin landing page load error:', e);
    return res.status(500).json({ error: e.message || 'Failed to load builder page' });
  }
});

// Save full page sections atomically (replace model).
router.put('/admin/page/:tenantId', authWithFreshUser, async (req, res) => {
  try {
    if (!(await requireLandingBuilderPermission(req, res))) return;
    const tenantId = String(req.params.tenantId || '').trim();
    if (!tenantId) return res.status(400).json({ error: 'tenantId is required' });
    if (!canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Tenant access denied' });

    const incomingSections = normalizeSections(req.body?.sections || []);
    if (incomingSections.length === 0) {
      return res.status(400).json({ error: 'At least one section is required' });
    }

    const validationErrors: string[] = [];
    for (const section of incomingSections) {
      if (!LANDING_SECTION_TYPES.includes(section.type)) {
        validationErrors.push(`Unsupported section type: ${section.type}`);
        continue;
      }
      const sectionErrors = validateSection(section.type, section.content || {});
      validationErrors.push(...sectionErrors.map((msg) => `${section.type}: ${msg}`));
    }

    const maxPayloadBytes = 1024 * 1024 * 2; // 2MB guard
    const payloadSize = Buffer.byteLength(JSON.stringify(incomingSections), 'utf8');
    if (payloadSize > maxPayloadBytes) {
      validationErrors.push('Section payload is too large.');
    }

    if (validationErrors.length > 0) {
      return res.status(400).json({ error: 'Validation failed', details: validationErrors });
    }

    const pageName = typeof req.body?.name === 'string' && req.body.name.trim()
      ? req.body.name.trim().slice(0, 120)
      : 'Main Landing Page';

    let { data: page, error: pageError } = await supabase
      .from('landing_pages')
      .select('id, tenant_id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('updated_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (pageError) throw pageError;

    if (!page) {
      const { data: createdPage, error: createError } = await supabase
        .from('landing_pages')
        .insert({ tenant_id: tenantId, name: pageName, is_active: true })
        .select('id, tenant_id')
        .single();
      if (createError) throw createError;
      page = createdPage;
    } else {
      const { error: updatePageError } = await supabase
        .from('landing_pages')
        .update({ name: pageName })
        .eq('id', page.id);
      if (updatePageError) throw updatePageError;
    }

    const normalizedToInsert = incomingSections.map((section, index) => ({
      page_id: page.id,
      type: section.type,
      order_index: index,
      is_visible: section.is_visible !== false,
      content: sanitizeSection(section.type, section.content),
    }));

    const { error: deleteError } = await supabase
      .from('landing_page_sections')
      .delete()
      .eq('page_id', page.id);
    if (deleteError) throw deleteError;

    const { data: inserted, error: insertError } = await supabase
      .from('landing_page_sections')
      .insert(normalizedToInsert)
      .select('id, page_id, type, order_index, is_visible, content')
      .order('order_index', { ascending: true });
    if (insertError) throw insertError;

    return res.json({
      ok: true,
      page: {
        id: page.id,
        tenant_id: page.tenant_id,
        name: pageName,
        sections: (inserted || []).map((section: any) => ({
          ...section,
          content: sanitizeSection(section.type as LandingSectionType, section.content),
        })),
      },
    });
  } catch (e: any) {
    console.error('Save landing page error:', e);
    return res.status(500).json({ error: e.message || 'Failed to save builder page' });
  }
});

// Duplicate section and return updated ordered list.
router.post('/admin/section/duplicate', authWithFreshUser, async (req, res) => {
  try {
    if (!(await requireLandingBuilderPermission(req, res))) return;
    const sectionId = String(req.body?.sectionId || '').trim();
    const pageId = String(req.body?.pageId || '').trim();
    const tenantId = String(req.body?.tenantId || '').trim();
    if (!sectionId || !pageId || !tenantId) {
      return res.status(400).json({ error: 'sectionId, pageId and tenantId are required' });
    }
    if (!canAccessTenant(req, tenantId)) return res.status(403).json({ error: 'Tenant access denied' });

    const { data: source, error: sourceError } = await supabase
      .from('landing_page_sections')
      .select('id, page_id, type, order_index, is_visible, content')
      .eq('id', sectionId)
      .eq('page_id', pageId)
      .maybeSingle();
    if (sourceError) throw sourceError;
    if (!source) return res.status(404).json({ error: 'Section not found' });

    const { data: page, error: pageError } = await supabase
      .from('landing_pages')
      .select('id, tenant_id')
      .eq('id', pageId)
      .eq('tenant_id', tenantId)
      .maybeSingle();
    if (pageError) throw pageError;
    if (!page) return res.status(404).json({ error: 'Page not found' });

    const { data: sectionsBefore, error: listError } = await supabase
      .from('landing_page_sections')
      .select('id, page_id, type, order_index, is_visible, content')
      .eq('page_id', pageId)
      .order('order_index', { ascending: true });
    if (listError) throw listError;

    const cloned = (sectionsBefore || []).map((row: any) => ({ ...row }));
    const index = cloned.findIndex((row) => row.id === sectionId);
    if (index < 0) return res.status(404).json({ error: 'Section not found' });

    cloned.splice(index + 1, 0, {
      id: `dup-${Date.now()}`,
      page_id: pageId,
      type: source.type,
      order_index: source.order_index + 1,
      is_visible: source.is_visible,
      content: sanitizeSection(source.type as LandingSectionType, source.content),
    });

    const normalized = cloned.map((row, idx) => ({
      page_id: pageId,
      type: row.type,
      order_index: idx,
      is_visible: row.is_visible !== false,
      content: sanitizeSection(row.type as LandingSectionType, row.content),
    }));

    const { error: deleteError } = await supabase.from('landing_page_sections').delete().eq('page_id', pageId);
    if (deleteError) throw deleteError;

    const { data: inserted, error: insertError } = await supabase
      .from('landing_page_sections')
      .insert(normalized)
      .select('id, page_id, type, order_index, is_visible, content')
      .order('order_index', { ascending: true });
    if (insertError) throw insertError;

    return res.json({ ok: true, sections: inserted || [] });
  } catch (e: any) {
    console.error('Duplicate landing section error:', e);
    return res.status(500).json({ error: e.message || 'Failed to duplicate section' });
  }
});

export { router as landingBuilderRoutes };
