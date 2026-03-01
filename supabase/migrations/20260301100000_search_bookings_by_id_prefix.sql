-- Search bookings by booking ID prefix (e.g. 48AC5182 matches UUIDs starting with 48ac5182).
-- Used when user enters a short ID instead of full UUID.

CREATE OR REPLACE FUNCTION search_booking_ids_by_id_prefix(
  p_tenant_id uuid,
  p_branch_id uuid,
  p_id_prefix text,
  p_limit int DEFAULT 50
)
RETURNS TABLE (id uuid)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
BEGIN
  IF p_tenant_id IS NULL OR p_id_prefix IS NULL OR TRIM(p_id_prefix) = '' THEN
    RETURN;
  END IF;

  -- Normalize: lowercase, remove dashes so 979DEEBC or 979deebc-1234 both work
  v_prefix := LOWER(REGEXP_REPLACE(TRIM(p_id_prefix), '-', '', 'g'));

  IF LENGTH(v_prefix) < 4 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT b.id
  FROM bookings b
  WHERE b.tenant_id = p_tenant_id
    AND (p_branch_id IS NULL OR b.branch_id = p_branch_id)
    AND (b.id::text LIKE v_prefix || '%' OR REPLACE(b.id::text, '-', '') LIKE v_prefix || '%')
  ORDER BY b.created_at DESC
  LIMIT p_limit;
END;
$$;

COMMENT ON FUNCTION search_booking_ids_by_id_prefix(uuid, uuid, text, int) IS
  'Returns booking ids whose UUID (as text) starts with the given prefix. Used for short booking ID search.';
