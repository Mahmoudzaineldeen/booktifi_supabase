-- Support tickets (internal fixing/support) and impersonation audit log
-- Part of multi-tenant, multi-branch, role-based support ticket system.

-- ============================================
-- 1. SUPPORT TICKET STATUS ENUM
-- ============================================
DO $$ BEGIN
  CREATE TYPE support_ticket_status AS ENUM ('open', 'in_progress', 'resolved');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ============================================
-- 2. SUPPORT_TICKETS TABLE
-- ============================================
CREATE TABLE IF NOT EXISTS support_tickets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  branch_id uuid REFERENCES branches(id) ON DELETE SET NULL,
  created_by_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  title text NOT NULL,
  description text NOT NULL,
  status support_ticket_status NOT NULL DEFAULT 'open',
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_support_tickets_tenant_id ON support_tickets(tenant_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_branch_id ON support_tickets(branch_id);
CREATE INDEX IF NOT EXISTS idx_support_tickets_status ON support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_support_tickets_created_at ON support_tickets(created_at DESC);
COMMENT ON TABLE support_tickets IS 'Internal fixing/support tickets created by operational roles; visible to Solution Owner.';

-- ============================================
-- 3. IMPERSONATION_LOGS TABLE (audit)
-- ============================================
CREATE TABLE IF NOT EXISTS impersonation_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  solution_owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  started_at timestamptz DEFAULT now() NOT NULL,
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_impersonation_logs_solution_owner_id ON impersonation_logs(solution_owner_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_logs_target_user_id ON impersonation_logs(target_user_id);
CREATE INDEX IF NOT EXISTS idx_impersonation_logs_started_at ON impersonation_logs(started_at DESC);
COMMENT ON TABLE impersonation_logs IS 'Audit log for Solution Owner impersonation sessions.';
