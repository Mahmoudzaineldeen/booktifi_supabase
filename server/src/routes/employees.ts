import express from 'express';
import { supabase } from '../db';
import bcrypt from 'bcryptjs';
import { invalidateEmployeeAvailabilityForTenant } from '../utils/employeeAvailabilityCache';

const router = express.Router();

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
      tenant_id,
      branch_id,
      service_shift_assignments,
      employee_shifts: employeeShiftsBody,
    } = req.body;

    if (!username || !password || !full_name || !tenant_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate role
    const validRoles = ['employee', 'receptionist', 'coordinator', 'cashier', 'customer_admin', 'admin_user'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
    }

    const operationalRoles = ['employee', 'receptionist', 'coordinator', 'cashier'];
    if (operationalRoles.includes(role) && !branch_id) {
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
      role: role || 'employee',
      tenant_id,
      password_hash: passwordHash,
      is_active: true,
    };
    if (branch_id) userPayload.branch_id = branch_id;

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
    if (role === 'employee' && service_shift_assignments && service_shift_assignments.length > 0 && branch_id) {
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
    if (role === 'employee' && employeeShiftsBody && Array.isArray(employeeShiftsBody) && employeeShiftsBody.length > 0) {
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
    if (role !== undefined) {
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

    const [usersRes, shiftsRes, servicesRes, branchesRes] = await Promise.all([
      supabase
        .from('users')
        .select('id, full_name, full_name_ar, role, branch_id')
        .eq('tenant_id', tenantId)
        .in('role', ['employee', 'receptionist', 'coordinator', 'cashier', 'customer_admin', 'admin_user'])
        .eq('is_active', true)
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
      supabase
        .from('branches')
        .select('id, name, name_ar')
        .eq('tenant_id', tenantId),
    ]);

    if (usersRes.error) throw usersRes.error;
    if (shiftsRes.error) throw shiftsRes.error;
    if (servicesRes.error) throw servicesRes.error;
    if (branchesRes.error) throw branchesRes.error;

    res.json({
      users: usersRes.data ?? [],
      employee_shifts: shiftsRes.data ?? [],
      employee_services: servicesRes.data ?? [],
      branches: branchesRes.data ?? [],
    });
  } catch (error: any) {
    console.error('Shifts page data error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export { router as employeeRoutes };

