-- RPC: get visitor export summary (SQL-only aggregation for report export).
-- Returns one row: total_bookings, package_bookings, paid_bookings, total_spent.
-- total_spent = SUM(total_price) only where package_covered_quantity = 0 AND status IN ('confirmed','completed','checked_in').
-- Never includes package-covered bookings in total_spent.

CREATE OR REPLACE FUNCTION get_visitor_export_summary(
  p_tenant_id uuid,
  p_customer_id uuid DEFAULT NULL,
  p_guest_phone text DEFAULT NULL
)
RETURNS TABLE (
  total_bookings bigint,
  package_bookings bigint,
  paid_bookings bigint,
  total_spent numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    COUNT(*)::bigint AS total_bookings,
    COUNT(*) FILTER (WHERE COALESCE(b.package_covered_quantity, 0) > 0)::bigint AS package_bookings,
    COUNT(*) FILTER (WHERE COALESCE(b.package_covered_quantity, 0) = 0)::bigint AS paid_bookings,
    COALESCE(SUM(b.total_price) FILTER (
      WHERE COALESCE(b.package_covered_quantity, 0) = 0
        AND LOWER(COALESCE(b.status, '')) IN ('confirmed', 'completed', 'checked_in')
    ), 0)::numeric AS total_spent
  FROM bookings b
  WHERE b.tenant_id = p_tenant_id
    AND (
      (p_customer_id IS NOT NULL AND b.customer_id = p_customer_id)
      OR (p_customer_id IS NULL AND p_guest_phone IS NOT NULL AND b.customer_id IS NULL AND TRIM(COALESCE(b.customer_phone, '')) = TRIM(p_guest_phone))
    );
$$;

COMMENT ON FUNCTION get_visitor_export_summary(uuid, uuid, text) IS
  'Returns aggregated booking counts and total spent for a visitor (customer or guest). total_spent excludes package-covered bookings.';
