import express from 'express';
import { supabase } from '../db';
import bcrypt from 'bcryptjs';

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
      service_shift_assignments,
    } = req.body;

    if (!username || !password || !full_name || !tenant_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Validate role
    const validRoles = ['employee', 'receptionist', 'coordinator', 'cashier', 'customer_admin', 'admin_user'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({ error: `Invalid role. Must be one of: ${validRoles.join(', ')}` });
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
    const { data: newUser, error: userError } = await supabase
      .from('users')
      .insert({
        username,
        email: emailForUser,
        phone: phone || null,
        full_name,
        full_name_ar: full_name_ar || '',
        role: role || 'employee',
        tenant_id,
        password_hash: passwordHash,
        is_active: true,
      })
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
    if (role === 'employee' && service_shift_assignments && service_shift_assignments.length > 0) {
      const assignments: any[] = [];
      service_shift_assignments.forEach((serviceAssignment: any) => {
        if (serviceAssignment.shiftIds && serviceAssignment.shiftIds.length > 0) {
          serviceAssignment.shiftIds.forEach((shift_id: string) => {
            assignments.push({
              employee_id: newUser.id,
              service_id: serviceAssignment.serviceId,
              shift_id,
              tenant_id,
              duration_minutes: serviceAssignment.durationMinutes || null,
              capacity_per_slot: serviceAssignment.capacityPerSlot || 1,
            });
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
      is_active,
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
    if (is_active !== undefined) updates.is_active = is_active;
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

export { router as employeeRoutes };

