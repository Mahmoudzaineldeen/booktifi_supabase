import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        tenant_id?: string;
        branch_id?: string | null;
      };
    }
  }
}

const ADMIN_ROLES = ['tenant_admin', 'solution_owner'];
const ROLES_CAN_READ_OWN_BRANCH_SERVICES = ['receptionist', 'cashier', 'coordinator'];

/** Resolve current user from DB after JWT verify so permissions use DB (no stale token 403). */
async function resolveUserFromDb(userId: string): Promise<{ id: string; email?: string; role: string; tenant_id: string | null; branch_id: string | null } | null> {
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, role, tenant_id, branch_id, is_active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !user || user.is_active === false) return null;
  return {
    id: user.id,
    email: user.email ?? undefined,
    role: user.role ?? 'employee',
    tenant_id: user.tenant_id ?? null,
    branch_id: user.branch_id ?? null,
  };
}

function authenticateAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  (async () => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization required' });
      }
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
      const userId = decoded?.id;
      if (!userId) return res.status(401).json({ error: 'Invalid token' });

      const user = await resolveUserFromDb(userId);
      if (!user) return res.status(401).json({ error: 'User not found or inactive' });

      if (!user.tenant_id && user.role !== 'solution_owner') {
        return res.status(403).json({ error: 'Tenant required' });
      }
      if (!ADMIN_ROLES.includes(user.role)) {
        return res.status(403).json({ error: 'Only tenant admin can manage branches' });
      }
      req.user = {
        id: user.id,
        email: user.email,
        role: user.role,
        tenant_id: user.tenant_id,
        branch_id: user.branch_id,
      };
      next();
    } catch (e) {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  })();
}

/** Allow admin to read any branch services; receptionist/cashier/coordinator only their own branch. Uses DB for role/branch. */
function authenticateBranchServicesRead(req: express.Request, res: express.Response, next: express.NextFunction) {
  (async () => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Authorization required' });
      }
      const decoded = jwt.verify(authHeader.slice(7), JWT_SECRET) as any;
      const userId = decoded?.id;
      if (!userId) return res.status(401).json({ error: 'Invalid token' });

      const user = await resolveUserFromDb(userId);
      if (!user) return res.status(401).json({ error: 'User not found or inactive' });

      if (!user.tenant_id && user.role !== 'solution_owner') {
        return res.status(403).json({ error: 'Tenant required' });
      }
      const branchIdParam = req.params.id;
      if (ADMIN_ROLES.includes(user.role)) {
        req.user = { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, branch_id: user.branch_id };
        return next();
      }
      if (ROLES_CAN_READ_OWN_BRANCH_SERVICES.includes(user.role) && branchIdParam && user.branch_id === branchIdParam) {
        req.user = { id: user.id, email: user.email, role: user.role, tenant_id: user.tenant_id, branch_id: user.branch_id };
        return next();
      }
      return res.status(403).json({ error: 'Access denied to branch services' });
    } catch (e) {
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  })();
}

/** List branches for the tenant (admin only). */
router.get('/', authenticateAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    if (!tenantId && req.user!.role !== 'solution_owner') {
      return res.status(400).json({ error: 'Tenant required' });
    }

    let query = supabase
      .from('branches')
      .select('id, name, location, created_at')
      .order('created_at', { ascending: true });

    if (tenantId) query = query.eq('tenant_id', tenantId);

    const { data, error } = await query;
    if (error) throw error;
    res.json({ data: data || [] });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to list branches' });
  }
});

/** Create branch (admin only). */
router.post('/', authenticateAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    if (!tenantId && req.user!.role !== 'solution_owner') {
      return res.status(400).json({ error: 'Tenant required' });
    }
    const { name, location } = req.body;
    if (!name || !String(name).trim()) {
      return res.status(400).json({ error: 'Branch name is required' });
    }

    const { data: branch, error } = await supabase
      .from('branches')
      .insert({
        tenant_id: tenantId,
        name: String(name).trim(),
        location: location ? String(location).trim() : null,
      })
      .select()
      .single();

    if (error) throw error;
    res.status(201).json({ data: branch });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to create branch' });
  }
});

/** Get branch IDs assigned to a service (for service form). */
router.get('/by-service/:serviceId/branches', authenticateAdmin, async (req, res) => {
  try {
    const serviceId = req.params.serviceId;
    const tenantId = req.user!.tenant_id;
    if (!serviceId) return res.status(400).json({ error: 'Service ID required' });

    const { data: service } = await supabase.from('services').select('id, tenant_id').eq('id', serviceId).maybeSingle();
    if (!service) return res.status(404).json({ error: 'Service not found' });
    if (tenantId && service.tenant_id !== tenantId) return res.status(403).json({ error: 'Access denied' });

    const { data: rows } = await supabase.from('service_branches').select('branch_id').eq('service_id', serviceId);
    const branch_ids = (rows || []).map((r: { branch_id: string }) => r.branch_id);
    res.json({ data: { branch_ids } });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load service branches' });
  }
});

/** Set branch assignments for a service. Body: { branch_ids: string[] } */
router.put('/by-service/:serviceId/branches', authenticateAdmin, async (req, res) => {
  try {
    const serviceId = req.params.serviceId;
    const tenantId = req.user!.tenant_id;
    const { branch_ids } = req.body;
    const ids = Array.isArray(branch_ids) ? branch_ids.filter((id: any) => id && String(id).trim()) : [];
    if (!serviceId) return res.status(400).json({ error: 'Service ID required' });
    if (ids.length === 0) return res.status(400).json({ error: 'At least one branch must be assigned to the service' });

    const { data: service } = await supabase.from('services').select('id, tenant_id').eq('id', serviceId).maybeSingle();
    if (!service) return res.status(404).json({ error: 'Service not found' });
    if (tenantId && service.tenant_id !== tenantId) return res.status(403).json({ error: 'Access denied' });

    // Ensure all branch_ids belong to the service's tenant
    const tenantIdToCheck = service.tenant_id || tenantId;
    if (ids.length > 0 && tenantIdToCheck) {
      const { data: branchRows } = await supabase.from('branches').select('id').in('id', ids).eq('tenant_id', tenantIdToCheck);
      const validIds = (branchRows || []).map((b: { id: string }) => b.id);
      const invalid = ids.filter((id: string) => !validIds.includes(id));
      if (invalid.length > 0) {
        return res.status(400).json({ error: 'Some branches are invalid or do not belong to your tenant', invalid });
      }
    }

    await supabase.from('service_branches').delete().eq('service_id', serviceId);
    if (ids.length > 0) {
      const rows = ids.map((branch_id: string) => ({ service_id: serviceId, branch_id }));
      const { error: insErr } = await supabase.from('service_branches').insert(rows);
      if (insErr) throw insErr;
    }
    res.json({ success: true, assigned_count: ids.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update service branches' });
  }
});

/** Branch detail: assigned services, packages, employees, receptionists, cashiers, income summary. */
router.get('/:id', authenticateAdmin, async (req, res) => {
  try {
    const branchId = req.params.id;
    const tenantId = req.user!.tenant_id;

    const { data: branch, error: branchError } = await supabase
      .from('branches')
      .select('id, tenant_id, name, location, created_at, updated_at')
      .eq('id', branchId)
      .maybeSingle();

    if (branchError) {
      return res.status(500).json({ error: 'Failed to load branch', details: branchError.message });
    }
    if (!branch) {
      return res.status(404).json({ error: 'Branch not found' });
    }
    if (tenantId && branch.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Access denied to this branch' });
    }

    const [servicesRes, packagesRes, employeesRes, receptionistsRes, cashiersRes, incomeBookings, incomeSubs] = await Promise.all([
      supabase.from('service_branches').select('service_id, services(id, name, name_ar)').eq('branch_id', branchId),
      supabase.from('package_branches').select('package_id, service_packages(id, name, name_ar)').eq('branch_id', branchId),
      supabase.from('users').select('id, full_name, full_name_ar, email, username').eq('branch_id', branchId).eq('role', 'employee'),
      supabase.from('users').select('id, full_name, full_name_ar, email, username').eq('branch_id', branchId).eq('role', 'receptionist'),
      supabase.from('users').select('id, full_name, full_name_ar, email, username').eq('branch_id', branchId).eq('role', 'cashier'),
      supabase.from('bookings').select('total_price, status, payment_status').eq('branch_id', branchId),
      supabase.from('package_subscriptions').select('id, service_packages(total_price)').eq('branch_id', branchId).eq('payment_status', 'paid'),
    ]);

    const assignedServices = (servicesRes.data || []).map((r: any) => ({
      id: r.services?.id ?? r.service_id,
      name: r.services?.name ?? '',
      name_ar: r.services?.name_ar ?? '',
    }));
    const assignedPackages = (packagesRes.data || []).map((r: any) => ({
      id: r.service_packages?.id ?? r.package_id,
      name: r.service_packages?.name ?? '',
      name_ar: r.service_packages?.name_ar ?? '',
    }));
    const employees = employeesRes.data || [];
    const receptionists = receptionistsRes.data || [];
    const cashiers = cashiersRes.data || [];

    let incomeFromBookings = 0;
    const paidStatuses = ['paid', 'paid_manual', 'awaiting_payment'];
    (incomeBookings.data || []).forEach((b: any) => {
      if (paidStatuses.includes(b.payment_status) && ['confirmed', 'checked_in', 'completed'].includes(b.status)) {
        incomeFromBookings += Number(b.total_price) || 0;
      }
    });
    let incomeFromSubscriptions = 0;
    (incomeSubs.data || []).forEach((s: any) => {
      incomeFromSubscriptions += Number(s.service_packages?.total_price) || 0;
    });

    res.json({
      data: {
        ...branch,
        is_active: branch.is_active ?? true,
        assigned_services: assignedServices,
        assigned_packages: assignedPackages,
        assigned_employees: employees,
        assigned_receptionists: receptionists,
        assigned_cashiers: cashiers,
        income_summary: {
          from_bookings: incomeFromBookings,
          from_subscriptions: incomeFromSubscriptions,
          total: incomeFromBookings + incomeFromSubscriptions,
        },
      },
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load branch detail' });
  }
});

/** Update branch (name, location, is_active). */
router.patch('/:id', authenticateAdmin, async (req, res) => {
  try {
    const branchId = req.params.id;
    const tenantId = req.user!.tenant_id;
    const { name, location, is_active } = req.body;

    const { data: existing } = await supabase.from('branches').select('id, tenant_id').eq('id', branchId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Branch not found' });
    if (tenantId && existing.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const updates: Record<string, any> = { updated_at: new Date().toISOString() };
    if (name !== undefined) updates.name = String(name).trim();
    if (location !== undefined) updates.location = location == null ? null : String(location).trim();
    if (typeof is_active === 'boolean') updates.is_active = is_active;

    const { data: branch, error } = await supabase.from('branches').update(updates).eq('id', branchId).select().single();
    if (error) throw error;

    // When branch is deactivated, deactivate all employees, receptionists, and cashiers assigned to this branch
    if (is_active === false) {
      const { error: usersErr } = await supabase
        .from('users')
        .update({ is_active: false })
        .eq('branch_id', branchId)
        .in('role', ['employee', 'receptionist', 'cashier', 'coordinator']);
      if (usersErr) {
        return res.status(500).json({ error: 'Branch updated but failed to deactivate branch staff', details: usersErr.message });
      }
    }

    res.json({ data: branch });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update branch' });
  }
});

/** Delete branch (admin only). Removes service_branches/package_branches; sets branch_id to null on bookings, subscriptions, users. */
router.delete('/:id', authenticateAdmin, async (req, res) => {
  try {
    const branchId = req.params.id;
    const tenantId = req.user!.tenant_id;

    const { data: existing } = await supabase.from('branches').select('id, tenant_id').eq('id', branchId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Branch not found' });
    if (tenantId && existing.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await supabase.from('service_branches').delete().eq('branch_id', branchId);
    await supabase.from('package_branches').delete().eq('branch_id', branchId);
    await supabase.from('bookings').update({ branch_id: null }).eq('branch_id', branchId);
    await supabase.from('package_subscriptions').update({ branch_id: null }).eq('branch_id', branchId);
    await supabase.from('users').update({ branch_id: null }).eq('branch_id', branchId);
    const { error: delErr } = await supabase.from('branches').delete().eq('id', branchId);
    if (delErr) throw delErr;
    res.json({ success: true, message: 'Branch deleted' });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to delete branch' });
  }
});

/** Get services assigned to this branch (admin: any branch; receptionist/cashier/coordinator: own branch only).
 * Returns full service details + offers so reception page can use this without querying services table (avoids RLS). */
router.get('/:id/services', authenticateBranchServicesRead, async (req, res) => {
  try {
    const branchId = req.params.id;
    const tenantId = req.user!.tenant_id;

    const { data: branch } = await supabase.from('branches').select('id, tenant_id').eq('id', branchId).maybeSingle();
    if (!branch) return res.status(404).json({ error: 'Branch not found' });
    if (tenantId && branch.tenant_id !== tenantId) return res.status(403).json({ error: 'Access denied' });

    const { data: rows } = await supabase
      .from('service_branches')
      .select('service_id')
      .eq('branch_id', branchId);

    const serviceIds = [...new Set((rows || []).map((r: any) => r.service_id).filter(Boolean))];
    if (serviceIds.length === 0) {
      return res.json({ data: [] });
    }

    const { data: servicesData, error: servicesErr } = await supabase
      .from('services')
      .select('id, name, name_ar, base_price, original_price, discount_percentage, capacity_per_slot, capacity_mode')
      .in('id', serviceIds)
      .eq('tenant_id', branch.tenant_id)
      .eq('is_active', true)
      .order('name');

    if (servicesErr) throw servicesErr;
    const services = servicesData || [];

    const { data: offersData } = await supabase
      .from('service_offers')
      .select('id, service_id, name, name_ar, price, original_price, discount_percentage, is_active')
      .in('service_id', serviceIds)
      .eq('is_active', true)
      .order('name');

    const offersByService = new Map<string, any[]>();
    (offersData || []).forEach((o: any) => {
      if (!offersByService.has(o.service_id)) offersByService.set(o.service_id, []);
      offersByService.get(o.service_id)!.push(o);
    });

    const servicesWithOffers = services.map((s: any) => ({
      ...s,
      offers: offersByService.get(s.id) || [],
    }));

    res.json({ data: servicesWithOffers });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to load services' });
  }
});

/** Replace assigned services for this branch. Body: { service_ids: string[] } */
router.put('/:id/services', authenticateAdmin, async (req, res) => {
  try {
    const branchId = req.params.id;
    const tenantId = req.user!.tenant_id;
    const { service_ids } = req.body;
    const ids = Array.isArray(service_ids) ? service_ids.filter((id: any) => id && String(id).trim()) : [];

    const { data: existing } = await supabase.from('branches').select('id, tenant_id').eq('id', branchId).maybeSingle();
    if (!existing) return res.status(404).json({ error: 'Branch not found' });
    if (tenantId && existing.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await supabase.from('service_branches').delete().eq('branch_id', branchId);

    if (ids.length > 0) {
      const rows = ids.map((service_id: string) => ({ branch_id: branchId, service_id }));
      const { error: insErr } = await supabase.from('service_branches').insert(rows);
      if (insErr) throw insErr;
    }

    res.json({ success: true, assigned_count: ids.length });
  } catch (e: any) {
    res.status(500).json({ error: e.message || 'Failed to update assigned services' });
  }
});

export { router as branchRoutes };
