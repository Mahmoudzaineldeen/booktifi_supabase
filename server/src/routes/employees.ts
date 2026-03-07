import express from 'express';
import { supabase } from '../db';
import bcrypt from 'bcryptjs';
import { invalidateEmployeeAvailabilityForTenant } from '../utils/employeeAvailabilityCache';

const router = express.Router();

/** Built-in role_id -> legacy user_role enum (for backward compatibility) */
const ROLE_ID_TO_LEGACY: Record<string, string> = {
  '00000000-0000-0000-0000-000000000001': 'tenant_admin',
  '00000000-0000-0000-0000-000000000002': 'receptionist',
  '00000000-0000-0000-0000-000000000003': 'cashier',
  '00000000-0000-0000-0000-000000000004': 'coordinator',
  '00000000-0000-0000-0000-000000000005': 'employee',
  '00000000-0000-0000-0000-000000000006': 'admin_user',
  '00000000-0000-0000-0000-000000000007': 'customer_admin',
};

/** Legacy roles allowed for admin-category roles (Admin, Manager, Supervisor-style) */
const LEGACY_ADMIN_ROLES = ['tenant_admin', 'admin_user', 'customer_admin', 'solution_owner'];

/** Legacy roles allowed for employee-category roles (Receptionist, Cashier, Operational) */
const LEGACY_EMPLOYEE_ROLES = ['receptionist', 'cashier', 'coordinator', 'employee'];

function legacyRoleFromRoleId(roleId: string): string {
  return ROLE_ID_TO_LEGACY[roleId] ?? 'employee';
}

function isBuiltInRoleId(roleId: string): boolean {
  return roleId in ROLE_ID_TO_LEGACY;
}

// Create employee
router.post('/create', async (req, res) => {
  try {
    const {
      username,
      password,
      full_name,
      full_name_ar,
      email,
      phone,
      role,
      role_id,
      tenant_id,
      branch_id,
      service_shift_assignments,
      employee_shifts: employeeShiftsBody,
    } = req.body;

    if (!username || !password || !full_name || !tenant_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    let resolvedRole = role;
    let resolvedRoleId = role_id ?? null;
    if (role_id) {
      const { data: roleRow, error: roleErr } = await supabase
        .from('roles')
        .select('id, name, category, is_active')
        .eq('id', role_id)
        .maybeSingle();
      if (roleErr || !roleRow || !roleRow.is_active) {
        return res.status(400).json({ error: 'Invalid or inactive role.' });
      }
      if (roleRow.tenant_id && roleRow.tenant_id !== tenant_id) {
        return res.status(400).json({ error: 'Role does not belong to this tenant.' });
      }
      if (isBuiltInRoleId(roleRow.id)) {
        resolvedRole = legacyRoleFromRoleId(roleRow.id);
      } else {
        if (!role || typeof role !== 'string') {
          return res.status(400).json({
            error: 'Invalid role configuration.',
            details: 'When assigning a custom role, you must specify the user type (e.g. Receptionist, Cashier for employee roles; Admin for admin roles).',
          });
        }
        resolvedRole = role;
      }
      const roleCategory = roleRow.category as 'admin' | 'employee';
      const allowedLegacy = roleCategory === 'admin' ? LEGACY_ADMIN_ROLES : LEGACY_EMPLOYEE_ROLES;
      if (!allowedLegacy.includes(resolvedRole)) {
        return res.status(400).json({
          error: 'Invalid role configuration.',
          details: roleCategory === 'admin'
            ? 'Admin roles can only be assigned to Admin/Manager/Supervisor user types (tenant_admin, admin_user, customer_admin).'
            : 'Employee roles can only be assigned to Receptionist, Cashier, or Operational user types (receptionist, cashier, coordinator, employee).',
        });
      }
      resolvedRoleId = roleRow.id;
    } else {
      const validRoles = ['employee', 'receptionist', 'coordinator', 'cashier', 'customer_admin', 'admin_user'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }
    }

    const operationalRoles = ['employee', 'receptionist', 'coordinator', 'cashier'];
    if (operationalRoles.includes(resolvedRole) && !branch_id) {
      return res.status(400).json({ error: 'Branch is required for this role.', hint: 'Select a branch for employees, receptionists, coordinators, and cashiers.' });
    }
    if (branch_id) {
      const { data: branchRow } = await supabase.from('branches').select('id').eq('id', branch_id).eq('tenant_id', tenant_id).maybeSingle();
      if (!branchRow) {
        return res.status(400).json({ error: 'Invalid branch or branch does not belong to this tenant.' });
      }
    }

    // Check if username already exists
    if (username) {
      const { data: existingUser, error: existingUserError } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .maybeSingle();

      if (existingUserError && existingUserError.code !== 'PGRST116') {
        throw existingUserError;
      }

      if (existingUser) {
        return res.status(400).json({ error: 'Username already exists' });
      }
    }

    // Check if email already exists (if email provided)
    if (email) {
      const { data: existingUser, error: existingUserError } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();

      if (existingUserError && existingUserError.code !== 'PGRST116') {
        throw existingUserError;
      }

      if (existingUser) {
        return res.status(400).json({ error: 'Email already exists' });
      }
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 10);

    // Create user in database directly (no Supabase Auth dependency)
    const emailForUser = email || `${username}@bookati.local`;
    const userPayload: Record<string, any> = {
      username,
      email: emailForUser,
      phone: phone || null,
      full_name,
      full_name_ar: full_name_ar || '',
      role: resolvedRole || 'employee',
      tenant_id,
      password_hash: passwordHash,
      is_active: true,
    };
    if (branch_id) userPayload.branch_id = branch_id;
    if (resolvedRoleId) userPayload.role_id = resolvedRoleId;

    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert(userPayload)
      .select()
      .single();

    if (userError) {
      // Handle unique constraint violation
      if (userError.code === '23505' || userError.message?.includes('unique') || userError.message?.includes('duplicate')) {
        if (userError.message?.includes('email')) {
          return res.status(400).json({ error: 'Email already exists' });
        }
        if (userError.message?.includes('username')) {
          return res.status(400).json({ error: 'Username already exists' });
        }
        return res.status(400).json({ error: 'A user with this information already exists' });
      }
      throw userError;
    }

    // Create employee service assignments (only for employees, not receptionists/cashiers)
    if (resolvedRole === 'employee' && service_shift_assignments && service_shift_assignments.length > 0 && branch_id) {
      const { data: branchServiceIds } = await supabase.from('service_branches').select('service_id').eq('branch_id', branch_id);
      const allowedServiceIds = new Set((branchServiceIds || []).map((r: any) => r.service_id));

      const assignments: any[] = [];
      service_shift_assignments.forEach((serviceAssignment: any) => {
        const serviceId = serviceAssignment.serviceId;
        if (!allowedServiceIds.has(serviceId)) return;
        const shiftIds = serviceAssignment.shiftIds || [];
        if (shiftIds.length > 0) {
          shiftIds.forEach((shift_id: string) => {
            assignments.push({
              employee_id: newUser.id,
              service_id: serviceId,
              shift_id,
              tenant_id,
              duration_minutes: null,
              capacity_per_slot: null,
            });
          });
        } else {
          assignments.push({
            employee_id: newUser.id,
            service_id: serviceId,
            shift_id: null,
            tenant_id,
            duration_minutes: null,
            capacity_per_slot: null,
          });
        }
      });

      if (assignments.length > 0) {
        const { error: assignmentError } = await supabase
          .from('employee_services')
          .upsert(assignments, {
            onConflict: 'employee_id,service_id,shift_id',
            ignoreDuplicates: true
          });

        if (assignmentError) {
          throw assignmentError;
        }
      }
    }

    // Create employee shifts (working hours) when provided
    if (resolvedRole === 'employee' && employeeShiftsBody && Array.isArray(employeeShiftsBody) && employeeShiftsBody.length > 0) {
      const shiftsToInsert = employeeShiftsBody
        .filter((s: any) => s && Array.isArray(s.days_of_week) && s.days_of_week.length > 0 && s.start_time_utc && s.end_time_utc)
        .map((s: any) => ({
          tenant_id,
          employee_id: newUser.id,
          days_of_week: s.days_of_week,
          start_time_utc: s.start_time_utc,
          end_time_utc: s.end_time_utc,
          is_active: s.is_active !== false,
        }));
      if (shiftsToInsert.length > 0) {
        const { error: shiftsError } = await supabase.from('employee_shifts').insert(shiftsToInsert);
        if (shiftsError) {
          console.error('Create employee_shifts error:', shiftsError);
          // Don't fail the whole create; user was created
        }
        if (tenant_id) invalidateEmployeeAvailabilityForTenant(tenant_id);
      }
    }

    res.json({ user: newUser });
  } catch (error: any) {
    console.error('Create employee error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update employee
router.post('/update', async (req, res) => {
  try {
    const {
      employee_id,
      username,
      password,
      full_name,
      full_name_ar,
      phone,
      role,
      role_id,
      branch_id,
      is_active,
      is_paused_until,
    } = req.body;

    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // Get existing employee
    const { data: existing, error: existingError } = await supabase
      .from('users')
      .select('*')
      .eq('id', employee_id)
      .single();

    if (existingError || !existing) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    // Update password if provided
    if (password) {
      const passwordHash = await bcrypt.hash(password, 10);
      const { error: passwordError } = await supabase
        .from('users')
        .update({ password_hash: passwordHash })
        .eq('id', employee_id);

      if (passwordError) {
        throw passwordError;
      }
    }

    // Update database fields
    const updates: any = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (full_name_ar !== undefined) updates.full_name_ar = full_name_ar;
    if (phone !== undefined) updates.phone = phone;
    if (role_id !== undefined) {
      if (role_id) {
        const { data: roleRow, error: roleErr } = await supabase
          .from('roles')
          .select('id, tenant_id, category, is_active')
          .eq('id', role_id)
          .maybeSingle();
        if (roleErr || !roleRow || !roleRow.is_active) {
          return res.status(400).json({ error: 'Invalid or inactive role.' });
        }
        if (roleRow.tenant_id && existing.tenant_id && roleRow.tenant_id !== existing.tenant_id) {
          return res.status(400).json({ error: 'Role does not belong to this tenant.' });
        }
        let legacyRole: string;
        if (isBuiltInRoleId(roleRow.id)) {
          legacyRole = legacyRoleFromRoleId(role_id);
        } else {
          legacyRole = (role && typeof role === 'string' ? role : existing.role) || 'employee';
          const roleCategory = roleRow.category as 'admin' | 'employee';
          const allowedLegacy = roleCategory === 'admin' ? LEGACY_ADMIN_ROLES : LEGACY_EMPLOYEE_ROLES;
          if (!allowedLegacy.includes(legacyRole)) {
            return res.status(400).json({
              error: 'Invalid role configuration.',
              details: 'When assigning a custom role, specify a user type that matches the role category (e.g. Receptionist/Cashier for employee roles; Admin for admin roles).',
            });
          }
        }
        const roleCategory = roleRow.category as 'admin' | 'employee';
        const allowedLegacy = roleCategory === 'admin' ? LEGACY_ADMIN_ROLES : LEGACY_EMPLOYEE_ROLES;
        if (!allowedLegacy.includes(legacyRole)) {
          return res.status(400).json({
            error: 'Invalid role configuration.',
            details: roleCategory === 'admin'
              ? 'Admin roles can only be assigned to Admin/Manager/Supervisor user types (tenant_admin, admin_user, customer_admin).'
              : 'Employee roles can only be assigned to Receptionist, Cashier, or Operational user types (receptionist, cashier, coordinator, employee).',
          });
        }
        updates.role_id = role_id;
        updates.role = legacyRole;
      } else {
        updates.role_id = null;
        updates.role = 'employee';
      }
    } else if (role !== undefined) {
      const validRoles = ['employee', 'receptionist', 'coordinator', 'cashier', 'customer_admin', 'admin_user'];
      if (!validRoles.includes(role)) {
        return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
      }
      updates.role = role;
    }
    if (branch_id !== undefined) {
      if (branch_id && existing.tenant_id) {
        const { data: branchRow } = await supabase.from('branches').select('id').eq('id', branch_id).eq('tenant_id', existing.tenant_id).maybeSingle();
        if (!branchRow) return res.status(400).json({ error: 'Invalid branch or branch does not belong to this tenant.' });
      }
      updates.branch_id = branch_id || null;
    }
    if (is_active !== undefined) updates.is_active = is_active;
    if (is_paused_until !== undefined) updates.is_paused_until = is_paused_until === '' || is_paused_until === null ? null : is_paused_until;
    if (username !== undefined && username !== existing.username) {
      // Check if new username already exists
      const { data: usernameCheck, error: usernameCheckError } = await supabase
        .from('users')
        .select('id')
        .eq('username', username)
        .neq('id', employee_id);

      if (usernameCheckError) {
        throw usernameCheckError;
      }

      if (usernameCheck && usernameCheck.length > 0) {
        return res.status(400).json({ error: 'Username already exists' });
      }
      updates.username = username;
    }

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('users')
        .update(updates)
        .eq('id', employee_id);

      if (updateError) {
        throw updateError;
      }
    }

    res.json({ success: true, message: 'Employee updated successfully' });
  } catch (error: any) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Single endpoint for Employee Shifts page: users + employee_shifts + employee_services in one round-trip (faster load)
router.get('/shifts-page-data', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const branchesListRes = await supabase.from('branches').select('id, name').eq('tenant_id', tenantId);
    if (branchesListRes.error) throw branchesListRes.error;
    const branchIds = (branchesListRes.data ?? []).map((b: { id: string }) => b.id);

    const [usersRes, shiftsRes, servicesRes, branchShiftsRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, full_name, full_name_ar, role, branch_id')
        .eq('tenant_id', tenantId)
        .eq('role', 'employee')
        .order('full_name'),
      supabase
        .from('employee_shifts')
        .select('id, employee_id, days_of_week, start_time_utc, end_time_utc, is_active')
        .eq('tenant_id', tenantId)
        .eq('is_active', true),
      supabase
        .from('employee_services')
        .select('employee_id, service_id, services(name, name_ar)')
        .eq('tenant_id', tenantId),
      branchIds.length > 0
        ? supabase.from('branch_shifts').select('branch_id, days_of_week, start_time, end_time').in('branch_id', branchIds)
        : Promise.resolve({ data: [] as any[], error: null }),
    ]);

    if (usersRes.error) throw usersRes.error;
    if (shiftsRes.error) throw shiftsRes.error;
    if (servicesRes.error) throw servicesRes.error;
    if (branchShiftsRes.error) throw branchShiftsRes.error;

    const branchShiftsByBranch = new Map<string, Array<{ days_of_week: number[]; start_time_utc: string; end_time_utc: string }>>();
    for (const bs of branchShiftsRes.data ?? []) {
      const list = branchShiftsByBranch.get(bs.branch_id) ?? [];
      const startTime = typeof bs.start_time === 'string' ? bs.start_time.slice(0, 8) : '00:00:00';
      const endTime = typeof bs.end_time === 'string' ? bs.end_time.slice(0, 8) : '23:59:00';
      list.push({
        days_of_week: Array.isArray(bs.days_of_week) ? bs.days_of_week : [],
        start_time_utc: startTime,
        end_time_utc: endTime,
      });
      branchShiftsByBranch.set(bs.branch_id, list);
    }

    res.json({
      users: usersRes.data ?? [],
      employee_shifts: shiftsRes.data ?? [],
      employee_services: servicesRes.data ?? [],
      branches: branchesListRes.data ?? [],
      branch_shifts_by_branch: Object.fromEntries(branchShiftsByBranch),
    });
  } catch (error: any) {
    console.error('Shifts page data error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export { router as employeeRoutes };

