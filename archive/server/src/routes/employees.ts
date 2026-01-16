import express from 'express';
import { query } from '../db';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userResult = await query(
      `INSERT INTO users (id, username, email, phone, full_name, full_name_ar, role, tenant_id, password_hash, is_active)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, true)
       RETURNING *`,
      [username, email || null, phone || null, full_name, full_name_ar || '', role || 'employee', tenant_id, hashedPassword]
    );

    const newUser = userResult.rows[0];

    // Create employee service assignments
    if (service_shift_assignments && service_shift_assignments.length > 0) {
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
        for (const assignment of assignments) {
          await query(
            `INSERT INTO employee_services (id, employee_id, service_id, shift_id, tenant_id, duration_minutes, capacity_per_slot)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
             ON CONFLICT (employee_id, service_id, shift_id) DO NOTHING`,
            [
              assignment.employee_id,
              assignment.service_id,
              assignment.shift_id,
              assignment.tenant_id,
              assignment.duration_minutes,
              assignment.capacity_per_slot,
            ]
          );
        }
      }
    }

    res.json({ user: newUser });
  } catch (error: any) {
    console.error('Create employee error:', error);
    res.status(500).json({ error: error.message });
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
      email,
      phone,
      role,
      is_active,
    } = req.body;

    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // Get existing employee
    const existingResult = await query('SELECT * FROM users WHERE id = $1', [employee_id]);
    if (existingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const existing = existingResult.rows[0];

    // Update fields
    const updates: any = {};
    if (full_name !== undefined) updates.full_name = full_name;
    if (full_name_ar !== undefined) updates.full_name_ar = full_name_ar;
    if (phone !== undefined) updates.phone = phone;
    if (role !== undefined) updates.role = role;
    if (is_active !== undefined) updates.is_active = is_active;
    if (username !== undefined && username !== existing.username) {
      updates.username = username;
      updates.email = email || null;
    }

    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updates.password_hash = hashedPassword;
    }

    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map((key, i) => `${key} = $${i + 1}`).join(', ');
      const values = Object.values(updates);
      values.push(employee_id);

      await query(
        `UPDATE users SET ${setClauses} WHERE id = $${values.length}`,
        values
      );
    }

    res.json({ success: true, message: 'Employee updated successfully' });
  } catch (error: any) {
    console.error('Update employee error:', error);
    res.status(500).json({ error: error.message });
  }
});

export { router as employeeRoutes };

