/*
  Tenant trial countdown + enforcement

  - Adds trial metadata on tenants (is_active already exists).
  - DB triggers: block mutations on tenant-scoped rows when tenant is inactive
    (authenticated/anon). Service role bypasses — Express middleware must enforce for API.
  - Protects privileged tenant columns from non–solution_owner updates.
*/

-- Enum for trial lifecycle
DO $$ BEGIN
  CREATE TYPE tenant_trial_status AS ENUM ('active', 'expired');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS trial_status tenant_trial_status NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS trial_countdown_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_message_override text;

COMMENT ON COLUMN tenants.trial_ends_at IS 'When set, trial expiry job may deactivate tenant at or after this instant.';
COMMENT ON COLUMN tenants.trial_status IS 'active | expired; expired is set together with is_active=false by the job.';
COMMENT ON COLUMN tenants.trial_countdown_enabled IS 'When true and trial active, staff UI shows countdown banner.';
COMMENT ON COLUMN tenants.trial_message_override IS 'Optional banner text replacing the default countdown copy.';

CREATE INDEX IF NOT EXISTS idx_tenants_trial_expiry_active
  ON tenants (trial_ends_at)
  WHERE trial_status = 'active' AND trial_ends_at IS NOT NULL;

-- Align trial_status with existing inactive tenants
UPDATE tenants
SET trial_status = 'expired'
WHERE is_active = false AND trial_status = 'active';

-- ---------------------------------------------------------------------------
-- Helper: JWT is service role (server / maintenance)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._jwt_role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.role', true), '');
$$;

CREATE OR REPLACE FUNCTION public._is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public._jwt_role(), '') = 'service_role';
$$;

CREATE OR REPLACE FUNCTION public._is_solution_owner(uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM users u WHERE u.id = uid AND u.role = 'solution_owner'
  );
$$;

-- ---------------------------------------------------------------------------
-- Child tables: block I/U/D when referenced tenant is inactive
-- (bypass for service_role; bypass for solution_owner)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_tenant_active_mutations()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  tid uuid;
  uid uuid;
  active boolean;
BEGIN
  IF TG_TABLE_SCHEMA IS DISTINCT FROM 'public' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF public._is_service_role() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  uid := auth.uid();
  IF uid IS NOT NULL AND public._is_solution_owner(uid) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  tid := COALESCE(NEW.tenant_id, OLD.tenant_id);
  IF tid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT t.is_active INTO active FROM tenants t WHERE t.id = tid;
  IF active IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF active = false THEN
    RAISE EXCEPTION 'Tenant is inactive (trial expired)'
      USING ERRCODE = '42501';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Attach to every base table that has a tenant_id column (except tenants itself)
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.table_name::text AS tname
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public'
      AND c.column_name = 'tenant_id'
      AND t.table_type = 'BASE TABLE'
      AND c.table_name <> 'tenants'
    ORDER BY c.table_name
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_guard_tenant_active ON public.%I',
      r.tname
    );
    EXECUTE format(
      'CREATE TRIGGER trg_guard_tenant_active
         BEFORE INSERT OR UPDATE OR DELETE ON public.%I
         FOR EACH ROW
         EXECUTE FUNCTION public.guard_tenant_active_mutations()',
      r.tname
    );
  END LOOP;
END $$;

-- ---------------------------------------------------------------------------
-- tenants: non–solution_owner cannot touch inactive row or flip is_active / trial fields
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_tenants_privileged_updates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid uuid;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF public._is_service_role() THEN
    RETURN NEW;
  END IF;

  uid := auth.uid();
  IF uid IS NOT NULL AND public._is_solution_owner(uid) THEN
    RETURN NEW;
  END IF;

  IF OLD.is_active = false THEN
    RAISE EXCEPTION 'Tenant is inactive (trial expired)'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
    RAISE EXCEPTION 'Only solution owner may change tenant active status'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.trial_ends_at IS DISTINCT FROM OLD.trial_ends_at
     OR NEW.trial_status IS DISTINCT FROM OLD.trial_status
     OR NEW.trial_countdown_enabled IS DISTINCT FROM OLD.trial_countdown_enabled
     OR NEW.trial_message_override IS DISTINCT FROM OLD.trial_message_override
  THEN
    RAISE EXCEPTION 'Only solution owner may change trial settings'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_tenants_privileged ON tenants;
CREATE TRIGGER trg_guard_tenants_privileged
  BEFORE UPDATE ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_tenants_privileged_updates();

-- ---------------------------------------------------------------------------
-- RPC: expire due trials (callable from Edge or server with service role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.expire_due_tenant_trials()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  UPDATE tenants t
  SET
    trial_status = 'expired',
    is_active = false,
    updated_at = now()
  WHERE t.trial_status = 'active'
    AND t.trial_ends_at IS NOT NULL
    AND t.trial_ends_at <= now();

  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END;
$$;
