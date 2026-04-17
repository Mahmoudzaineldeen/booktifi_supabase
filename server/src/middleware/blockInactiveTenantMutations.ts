import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const cache = new Map<string, { active: boolean; exp: number }>();
const CACHE_MS = 30_000;

/** Paths that must not require an active tenant (auth, health, public hooks). */
const EXEMPT_PREFIXES = [
  '/api/auth',
  '/health',
  '/api/health',
];

function isExemptPath(path: string): boolean {
  const p = path.split('?')[0] || '';
  if (EXEMPT_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))) {
    return true;
  }
  // Generic read-only SELECT proxy (POST/GET). Needed for read-only UI when tenant is inactive
  // and so staff can refresh trial fields without being blocked as a "mutation".
  if (p === '/api/query' || p.startsWith('/api/query/')) {
    return true;
  }
  return false;
}

async function tenantIsActive(tenantId: string): Promise<boolean> {
  const hit = cache.get(tenantId);
  if (hit && hit.exp > Date.now()) return hit.active;
  const { data, error } = await supabase.from('tenants').select('is_active').eq('id', tenantId).maybeSingle();
  if (error || !data) {
    cache.set(tenantId, { active: false, exp: Date.now() + CACHE_MS });
    return false;
  }
  const active = data.is_active === true;
  cache.set(tenantId, { active, exp: Date.now() + CACHE_MS });
  return active;
}

/**
 * Blocks POST/PUT/PATCH/DELETE when JWT carries a tenant_id for an inactive tenant.
 * Service-role Supabase calls from this process do not go through this middleware.
 */
export function blockInactiveTenantMutations(req: Request, res: Response, next: NextFunction) {
  const method = req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }

  const path = req.path || req.url || '';
  if (!path.startsWith('/api') || isExemptPath(path)) {
    return next();
  }

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.slice(7).trim();
  if (!token) return next();

  let decoded: { tenant_id?: string | null; role?: string | null };
  try {
    decoded = jwt.verify(token, JWT_SECRET) as { tenant_id?: string | null; role?: string | null };
  } catch {
    return next();
  }

  const role = decoded.role != null ? String(decoded.role) : '';
  if (role === 'solution_owner') {
    return next();
  }

  const tenantId = decoded.tenant_id;
  if (!tenantId) {
    return next();
  }

  void (async () => {
    try {
      const active = await tenantIsActive(tenantId);
      if (!active) {
        res.status(403).json({
          error: 'Tenant is inactive (trial expired)',
          code: 'TENANT_INACTIVE',
        });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: 'Unable to verify tenant status' });
    }
  })();
}
