/*
  Ensure free-trial end deactivates tenants (is_active = false, trial_status = expired).

  - expire_due_tenant_trials() already did this, but guard_tenants_privileged_updates()
    only allows the UPDATE when _is_service_role() is true. Calls without a JWT
    (e.g. pg_cron) would fail unless we set the claim for this transaction.
  - Lock down EXECUTE: only service_role (Node server / maintenance), not anon/authenticated.
  - Optionally schedule pg_cron when the extension exists (hosted Supabase).
*/

CREATE OR REPLACE FUNCTION public.expire_due_tenant_trials()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  -- Let guard_tenants_privileged_updates() treat this UPDATE as service_role
  -- (needed for pg_cron / direct SQL; harmless when PostgREST already sends service JWT).
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);

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

REVOKE ALL ON FUNCTION public.expire_due_tenant_trials() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.expire_due_tenant_trials() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_due_tenant_trials() TO service_role;

-- Optional: run in the database every minute so tenants deactivate even if the API server is stopped.
DO $$
DECLARE
  r record;
  jid bigint;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron extension not installed; trial expiry relies on the API job calling expire_due_tenant_trials()';
    RETURN;
  END IF;

  FOR r IN (SELECT jobid FROM cron.job WHERE jobname = 'expire-due-tenant-trials-every-minute')
  LOOP
    PERFORM cron.unschedule(r.jobid);
  END LOOP;

  SELECT cron.schedule(
    'expire-due-tenant-trials-every-minute',
    '* * * * *',
    'SELECT public.expire_due_tenant_trials()'
  ) INTO jid;

  RAISE NOTICE 'Scheduled expire-due-tenant-trials-every-minute (pg_cron job id %)', jid;
EXCEPTION
  WHEN undefined_function OR undefined_table THEN
    RAISE NOTICE 'pg_cron unavailable; trial expiry relies on the API job';
  WHEN others THEN
    RAISE NOTICE 'Trial expiry pg_cron schedule skipped: %', SQLERRM;
END;
$$;
