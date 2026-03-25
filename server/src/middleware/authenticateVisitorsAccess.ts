import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/** Same roles as legacy visitors routes (tenant staff who may view visitor/report data). */
export const VISITORS_ACCESS_ROLES = ['receptionist', 'tenant_admin', 'customer_admin', 'admin_user', 'coordinator'];

export function authenticateVisitorsAccess(req: Request, res: Response, next: NextFunction) {
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
      return res.status(403).json({ error: 'Access denied. Only admin or receptionist can access visitors.' });
    }
    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'No tenant associated with your account.' });
    }
    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
      branch_id: decoded.branch_id ?? null,
    } as any;
    next();
  } catch (err: any) {
    return res.status(500).json({ error: 'Authentication error', hint: err.message });
  }
}
