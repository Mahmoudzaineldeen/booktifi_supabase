import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';
import { getPermissionsForUser, PERMISSION_IDS } from '../permissions.js';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/** Decode JWT and set req.user (id, email, role, tenant_id, branch_id, role_id) */
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

/** Require one of the given permissions; use after authMiddleware. */
function requirePermission(...permissionIds: string[]) {
  return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    const permissions = await getPermissionsForUser(
      supabase,
      req.user.role_id,
      req.user.role || ''
    );
    const hasAny = permissionIds.some((p) => permissions.includes(p));
    if (hasAny) return next();
    return res.status(403).json({ error: 'Insufficient permissions', required: permissionIds });
  };
}

/** Require manage_roles permission or solution_owner/tenant_admin (for create/update/disable/delete role). */
function requireManageRoles(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (req.user.role === 'solution_owner' || req.user.role === 'tenant_admin') {
    next();
    return;
  }
  getPermissionsForUser(supabase, req.user.role_id, req.user.role || '')
    .then((permissions) => {
      if (permissions.includes(PERMISSION_IDS.MANAGE_ROLES)) next();
      else res.status(403).json({ error: 'Insufficient permissions to manage roles' });
    })
    .catch(() => res.status(403).json({ error: 'Insufficient permissions to manage roles' }));
}

// ----- Permissions registry (public for authenticated users) -----
router.get('/permissions', authMiddleware, async (_req, res) => {
  try {
    const { data, error } = await supabase
      .from('permissions')
      .select('id, name, description, category')
      .order('category')
      .order('id');
    if (error) throw error;
    res.json({ permissions: data ?? [] });
  } catch (e: any) {
    console.error('List permissions error:', e);
    res.status(500).json({ error: e.message || 'Failed to list permissions' });
  }
});

// ----- Current user's permissions (for frontend) -----
router.get('/permissions/me', authMiddleware, async (req, res) => {
  try {
    const permissions = await getPermissionsForUser(
      supabase,
      req.user!.role_id,
      req.user!.role || ''
    );
    res.json({ permissions });
  } catch (e: any) {
    console.error('Get my permissions error:', e);
    res.status(500).json({ error: e.message || 'Failed to get permissions' });
  }
});

// ----- List roles (built-in + tenant-specific for tenant_id) -----
router.get('/', authMiddleware, async (req, res) => {
  try {
    const tenantId = (req.query.tenant_id as string) || req.user!.tenant_id;
    // Solution owner can list any tenant's roles; others only their tenant
    if (req.user!.role !== 'solution_owner' && tenantId && tenantId !== req.user!.tenant_id) {
      return res.status(403).json({ error: 'Cannot list roles for another tenant' });
    }
    let query = supabase
      .from('roles')
      .select('id, tenant_id, name, description, category, is_active, created_at')
      .order('is_active', { ascending: false })
      .order('name');
    if (tenantId) {
      query = query.or(`tenant_id.is.null,tenant_id.eq.${tenantId}`);
    } else {
      query = query.is('tenant_id', null);
    }
    const { data: roles, error } = await query;
    if (error) throw error;
    res.json({ roles: roles ?? [] });
  } catch (e: any) {
    console.error('List roles error:', e);
    res.status(500).json({ error: e.message || 'Failed to list roles' });
  }
});

// ----- Get single role with permission IDs -----
router.get('/:id', authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: role, error: roleError } = await supabase
      .from('roles')
      .select('id, tenant_id, name, description, category, is_active, created_at')
      .eq('id', id)
      .maybeSingle();
    if (roleError || !role) return res.status(404).json({ error: 'Role not found' });
    const { data: perms } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', id);
    res.json({ ...role, permission_ids: (perms ?? []).map((p: any) => p.permission_id) });
  } catch (e: any) {
    console.error('Get role error:', e);
    res.status(500).json({ error: e.message || 'Failed to get role' });
  }
});

// ----- Create role (tenant_id from body or current user's tenant) -----
router.post('/', authMiddleware, requireManageRoles, async (req, res) => {
  try {
    const { name, description, category, permission_ids, tenant_id } = req.body;
    if (!name || !category) {
      return res.status(400).json({ error: 'name and category are required' });
    }
    if (!['admin', 'employee'].includes(category)) {
      return res.status(400).json({ error: 'category must be admin or employee' });
    }
    const tenantId = tenant_id || req.user!.tenant_id;
    if (req.user!.role !== 'solution_owner' && tenantId !== req.user!.tenant_id) {
      return res.status(403).json({ error: 'Cannot create role for another tenant' });
    }
    const { data: role, error: insertError } = await supabase
      .from('roles')
      .insert({
        tenant_id: tenantId || null,
        name: name.trim(),
        description: description?.trim() || null,
        category,
        is_active: true,
      })
      .select('id, tenant_id, name, description, category, is_active, created_at')
      .single();
    if (insertError) {
      if (insertError.code === '23505') return res.status(400).json({ error: 'A role with this name already exists' });
      throw insertError;
    }
    const ids = Array.isArray(permission_ids) ? permission_ids : [];
    if (ids.length > 0) {
      await supabase.from('role_permissions').insert(
        ids.map((pid: string) => ({ role_id: role.id, permission_id: pid }))
      );
    }
    const { data: perms } = await supabase
      .from('role_permissions')
      .select('permission_id')
      .eq('role_id', role.id);
    res.status(201).json({ ...role, permission_ids: (perms ?? []).map((p: any) => p.permission_id) });
  } catch (e: any) {
    console.error('Create role error:', e);
    res.status(500).json({ error: e.message || 'Failed to create role' });
  }
});

// ----- Update role -----
router.put('/:id', authMiddleware, requireManageRoles, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, category, permission_ids, is_active } = req.body;
    const { data: existing, error: fetchError } = await supabase
      .from('roles')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchError || !existing) return res.status(404).json({ error: 'Role not found' });
    if (req.user!.role !== 'solution_owner' && existing.tenant_id !== req.user!.tenant_id) {
      return res.status(403).json({ error: 'Cannot edit this role' });
    }
    const updates: any = {};
    if (name !== undefined) updates.name = name.trim();
    if (description !== undefined) updates.description = description?.trim() || null;
    if (category !== undefined) {
      if (!['admin', 'employee'].includes(category)) return res.status(400).json({ error: 'category must be admin or employee' });
      updates.category = category;
    }
    if (is_active !== undefined) updates.is_active = !!is_active;
    updates.updated_at = new Date().toISOString();
    if (Object.keys(updates).length > 1) {
      const { error: updateError } = await supabase.from('roles').update(updates).eq('id', id);
      if (updateError) throw updateError;
    }
    if (Array.isArray(permission_ids)) {
      await supabase.from('role_permissions').delete().eq('role_id', id);
      if (permission_ids.length > 0) {
        await supabase.from('role_permissions').insert(
          permission_ids.map((pid: string) => ({ role_id: id, permission_id: pid }))
        );
      }
    }
    const { data: role } = await supabase.from('roles').select('*').eq('id', id).single();
    const { data: perms } = await supabase.from('role_permissions').select('permission_id').eq('role_id', id);
    res.json({ ...role, permission_ids: (perms ?? []).map((p: any) => p.permission_id) });
  } catch (e: any) {
    console.error('Update role error:', e);
    res.status(500).json({ error: e.message || 'Failed to update role' });
  }
});

// ----- Disable role -----
router.post('/:id/disable', authMiddleware, requireManageRoles, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing, error: fetchError } = await supabase
      .from('roles')
      .select('id, tenant_id, name')
      .eq('id', id)
      .maybeSingle();
    if (fetchError || !existing) return res.status(404).json({ error: 'Role not found' });
    if (req.user!.role !== 'solution_owner' && existing.tenant_id !== req.user!.tenant_id) {
      return res.status(403).json({ error: 'Cannot disable this role' });
    }
    const { data: usersWithRole } = await supabase.from('users').select('id').eq('role_id', id);
    const count = usersWithRole?.length ?? 0;
    const { error: updateError } = await supabase
      .from('roles')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', id);
    if (updateError) throw updateError;
    if (count > 0) {
      await supabase.from('users').update({ is_active: false }).eq('role_id', id);
    }
    res.json({ ok: true, message: 'Role disabled. Users with this role have been deactivated.', affected_users: count });
  } catch (e: any) {
    console.error('Disable role error:', e);
    res.status(500).json({ error: e.message || 'Failed to disable role' });
  }
});

// ----- Delete role (only if no users assigned) -----
router.delete('/:id', authMiddleware, requireManageRoles, async (req, res) => {
  try {
    const { id } = req.params;
    const { data: existing, error: fetchError } = await supabase
      .from('roles')
      .select('id, tenant_id')
      .eq('id', id)
      .maybeSingle();
    if (fetchError || !existing) return res.status(404).json({ error: 'Role not found' });
    if (req.user!.role !== 'solution_owner' && existing.tenant_id !== req.user!.tenant_id) {
      return res.status(403).json({ error: 'Cannot delete this role' });
    }
    const { data: usersWithRole } = await supabase.from('users').select('id').eq('role_id', id).limit(1);
    if (usersWithRole && usersWithRole.length > 0) {
      return res.status(400).json({ error: 'Cannot delete role while users are assigned. Remove or reassign users first.' });
    }
    await supabase.from('role_permissions').delete().eq('role_id', id);
    await supabase.from('roles').delete().eq('id', id);
    res.json({ ok: true });
  } catch (e: any) {
    console.error('Delete role error:', e);
    res.status(500).json({ error: e.message || 'Failed to delete role' });
  }
});

export { router as roleRoutes };
export { requirePermission };
