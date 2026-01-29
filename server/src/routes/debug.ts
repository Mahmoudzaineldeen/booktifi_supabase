/**
 * TEMPORARY debug routes for database-level verification of Visitors page.
 * Compare GET /api/debug/visitors-db-check response with GET /api/visitors summary.
 * Remove or guard by env (e.g. NODE_ENV !== 'production') when done debugging.
 */

import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const VISITORS_ACCESS_ROLES = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user', 'coordinator'];

function authenticateDebug(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) return res.status(401).json({ error: 'Token is required' });
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (e: any) {
      if (e.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token has expired' });
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (!VISITORS_ACCESS_ROLES.includes(decoded.role)) {
      return res.status(403).json({ error: 'Access denied. Only admin or receptionist can access debug.' });
    }
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'No tenant associated with your account.' });
    }
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role, tenant_id: decoded.tenant_id };
    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Authentication error', hint: err.message });
  }
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        tenant_id?: string;
      };
    }
  }
}

/**
 * GET /api/debug/visitors-db-check
 * Runs DB verification queries (Q1–Q6) via RPC and returns JSON.
 * Compare with GET /api/visitors summary to verify correctness.
 */
router.get('/visitors-db-check', authenticateDebug, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const { data, error } = await supabase.rpc('visitors_db_verification', {
      p_tenant_id: tenantId,
    });
    if (error) {
      logger.error('visitors_db_verification RPC error', error, { tenantId });
      return res.status(500).json({
        error: 'Database verification failed',
        hint: error.message,
        code: error.code,
      });
    }
    const result = data as Record<string, unknown> | null;
    if (result == null) {
      return res.status(500).json({ error: 'RPC returned no data' });
    }
    return res.json({
      total_customers: result.total_customers,
      total_unique_visitors: result.total_unique_visitors,
      total_bookings: result.total_bookings,
      total_package_bookings: result.total_package_bookings,
      total_paid_bookings: result.total_paid_bookings,
      total_spent: result.total_spent,
    });
  } catch (err: any) {
    logger.error('Debug visitors-db-check error', err, { tenantId: req.user?.tenant_id });
    res.status(500).json({ error: err.message || 'Internal server error' });
  }
});

export { router as debugRoutes };
