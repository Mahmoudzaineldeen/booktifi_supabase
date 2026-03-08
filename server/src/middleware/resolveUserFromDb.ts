/**
 * Resolve current user from database so req.user has fresh role_id and role.
 * Use after authMiddleware so permission resolution and role-based logic
 * always use current DB state (role category change, reassignment) without re-login.
 */
import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../db';

export async function resolveUserFromDb(req: Request, res: Response, next: NextFunction): Promise<void> {
  const userId = (req as any).user?.id;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const { data: user, error } = await supabase
    .from('users')
    .select('id, email, role, role_id, tenant_id, branch_id, is_active')
    .eq('id', userId)
    .maybeSingle();
  if (error) {
    console.error('[resolveUserFromDb]', error);
    res.status(500).json({ error: 'Failed to resolve user' });
    return;
  }
  if (!user || user.is_active === false) {
    res.status(401).json({ error: 'User not found or inactive' });
    return;
  }
  (req as any).user = {
    id: user.id,
    email: user.email ?? undefined,
    role: user.role ?? 'employee',
    role_id: user.role_id ?? null,
    tenant_id: user.tenant_id ?? null,
    branch_id: user.branch_id ?? null,
  };
  next();
}
