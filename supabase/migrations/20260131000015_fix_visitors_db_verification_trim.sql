-- Fix visitors_db_verification: cast status to text so TRIM works with booking_status enum.

CREATE OR REPLACE FUNCTION visitors_db_verification(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total_customers bigint;
  v_total_unique_visitors bigint;
  v_total_bookings bigint;
  v_total_package_bookings bigint;
  v_total_paid_bookings bigint;
  v_total_spent numeric;
BEGIN
  IF p_tenant_id IS NULL THEN
    RETURN jsonb_build_object('error', 'tenant_id is required');
  END IF;

  -- Q1: Total customers
  SELECT COUNT(*) INTO v_total_customers
  FROM customers
  WHERE tenant_id = p_tenant_id;

  -- Q2: Total unique visitors = customers + distinct guest phones (not in customers)
  SELECT (
    (SELECT COUNT(*) FROM customers WHERE tenant_id = p_tenant_id)
    + (SELECT COUNT(*) FROM (
         SELECT DISTINCT b.customer_phone
         FROM bookings b
         WHERE b.tenant_id = p_tenant_id
           AND b.customer_id IS NULL
           AND b.customer_phone IS NOT NULL
           AND TRIM(b.customer_phone::text) <> ''
           AND NOT EXISTS (
             SELECT 1 FROM customers c
             WHERE c.tenant_id = p_tenant_id
               AND TRIM(REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', '', 'g'))
               = TRIM(REGEXP_REPLACE(COALESCE(b.customer_phone, ''), '[^0-9]', '', 'g'))
           )
       ) g)
  ) INTO v_total_unique_visitors;

  -- Q3: Total bookings
  SELECT COUNT(*) INTO v_total_bookings
  FROM bookings
  WHERE tenant_id = p_tenant_id;

  -- Q4: Total package bookings
  SELECT COUNT(*) INTO v_total_package_bookings
  FROM bookings
  WHERE tenant_id = p_tenant_id
    AND COALESCE(package_covered_quantity, 0) > 0;

  -- Q5: Total paid bookings
  SELECT COUNT(*) INTO v_total_paid_bookings
  FROM bookings
  WHERE tenant_id = p_tenant_id
    AND COALESCE(package_covered_quantity, 0) = 0;

  -- Q6: Total spent = booking paid amounts + package purchase amounts (all customer spending)
  SELECT (
    (SELECT COALESCE(SUM(b.total_price), 0)
     FROM bookings b
     WHERE b.tenant_id = p_tenant_id
       AND COALESCE(b.package_covered_quantity, 0) = 0
       AND LOWER(TRIM(b.status::text)) IN ('confirmed', 'completed', 'checked_in'))
    + (SELECT COALESCE(SUM(sp.total_price), 0)
       FROM package_subscriptions ps
       JOIN service_packages sp ON sp.id = ps.package_id
       WHERE ps.tenant_id = p_tenant_id
         AND ps.payment_status = 'paid')
  ) INTO v_total_spent;

  RETURN jsonb_build_object(
    'total_customers', v_total_customers,
    'total_unique_visitors', v_total_unique_visitors,
    'total_bookings', v_total_bookings,
    'total_package_bookings', v_total_package_bookings,
    'total_paid_bookings', v_total_paid_bookings,
    'total_spent', v_total_spent
  );
END;
$$;

COMMENT ON FUNCTION visitors_db_verification(uuid) IS
  'Debug: returns DB-level visitor stats (Q1–Q6) for comparison with GET /api/visitors summary.';
