/*
  Fix: Super Admin saves tenant trial fields via Express → PostgREST service role.
  _is_service_role() must recognize service role across Supabase JWT claim shapes.
  (Invoker rights so JWT claims from the request are visible.)
*/

CREATE OR REPLACE FUNCTION public._jwt_role()
RETURNS text
LANGUAGE plpgsql
STABLE
SET search_path = public, auth
AS $$
DECLARE
  r text;
BEGIN
  BEGIN
    r := NULLIF(btrim(auth.jwt() ->> 'role'), '');
    IF r IS NOT NULL THEN
      RETURN r;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  BEGIN
    r := NULLIF(btrim(current_setting('request.jwt.claim.role', true)), '');
    IF r IS NOT NULL THEN
      RETURN r;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  BEGIN
    r := NULLIF(btrim((current_setting('request.jwt.claims', true)::jsonb ->> 'role')), '');
    IF r IS NOT NULL THEN
      RETURN r;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  BEGIN
    r := NULLIF(btrim(auth.role()::text), '');
    IF r IS NOT NULL THEN
      RETURN r;
    END IF;
  EXCEPTION
    WHEN OTHERS THEN
      NULL;
  END;

  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public._is_service_role()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(public._jwt_role(), '') = 'service_role';
$$;
