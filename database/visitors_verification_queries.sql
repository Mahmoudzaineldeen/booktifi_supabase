-- =============================================================================
-- VISITORS PAGE — DATABASE-LEVEL VERIFICATION QUERIES
-- Run in Supabase SQL Editor. Replace :tenant_id with your tenant UUID in every
-- query, e.g. replace :tenant_id with 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'.
-- Or use a variable: \set tenant_id 'your-uuid' (psql) then :tenant_id.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- QUERY 1 — TOTAL VISITORS (Customers Only)
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS total_customers
FROM customers
WHERE tenant_id = :tenant_id;

-- -----------------------------------------------------------------------------
-- QUERY 2 — TOTAL UNIQUE VISITORS (Customers + Guests)
-- Guests = distinct customer_phone from bookings where customer_id IS NULL
-- and phone not already in customers (normalized match)
-- -----------------------------------------------------------------------------
SELECT
  (SELECT COUNT(*) FROM customers WHERE tenant_id = :tenant_id)
  + (SELECT COUNT(*) FROM (
       SELECT DISTINCT b.customer_phone
       FROM bookings b
       WHERE b.tenant_id = :tenant_id
         AND b.customer_id IS NULL
         AND b.customer_phone IS NOT NULL
         AND TRIM(b.customer_phone) <> ''
         AND NOT EXISTS (
           SELECT 1 FROM customers c
           WHERE c.tenant_id = :tenant_id
             AND TRIM(REGEXP_REPLACE(COALESCE(c.phone, ''), '[^0-9]', '', 'g'))
             = TRIM(REGEXP_REPLACE(COALESCE(b.customer_phone, ''), '[^0-9]', '', 'g'))
         )
     ) g) AS total_unique_visitors;

-- -----------------------------------------------------------------------------
-- QUERY 3 — TOTAL BOOKINGS
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS total_bookings
FROM bookings
WHERE tenant_id = :tenant_id;

-- -----------------------------------------------------------------------------
-- QUERY 4 — TOTAL PACKAGE BOOKINGS (package_covered_quantity > 0)
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS total_package_bookings
FROM bookings
WHERE tenant_id = :tenant_id
  AND COALESCE(package_covered_quantity, 0) > 0;

-- -----------------------------------------------------------------------------
-- QUERY 5 — TOTAL PAID BOOKINGS (package_covered_quantity = 0)
-- -----------------------------------------------------------------------------
SELECT COUNT(*) AS total_paid_bookings
FROM bookings
WHERE tenant_id = :tenant_id
  AND COALESCE(package_covered_quantity, 0) = 0;

-- -----------------------------------------------------------------------------
-- QUERY 6 — TOTAL SPENT (real money only)
-- Rules: package_covered_quantity = 0, status IN (confirmed, completed, checked_in)
-- -----------------------------------------------------------------------------
SELECT COALESCE(SUM(total_price), 0) AS total_spent
FROM bookings
WHERE tenant_id = :tenant_id
  AND COALESCE(package_covered_quantity, 0) = 0
  AND LOWER(TRIM(status)) IN ('confirmed', 'completed', 'checked_in');

-- -----------------------------------------------------------------------------
-- QUERY 7 — VISITOR LIST VERIFICATION (matches API rows)
-- Customer visitors + guest visitors, with aggregates
-- -----------------------------------------------------------------------------
WITH booking_agg AS (
  SELECT
    COALESCE(b.customer_id::text, 'guest-' || b.customer_phone) AS visitor_id,
    b.customer_id,
    b.customer_phone,
    COUNT(*) AS total_bookings,
    SUM(CASE WHEN COALESCE(b.package_covered_quantity, 0) > 0 THEN 1 ELSE 0 END) AS package_bookings_count,
    SUM(CASE WHEN COALESCE(b.package_covered_quantity, 0) = 0 THEN 1 ELSE 0 END) AS paid_bookings_count,
    SUM(
      CASE
        WHEN COALESCE(b.package_covered_quantity, 0) = 0
         AND LOWER(TRIM(b.status)) IN ('confirmed', 'completed', 'checked_in')
        THEN COALESCE(b.total_price, 0)
        ELSE 0
      END
    ) AS total_spent,
    MAX(s.slot_date) AS last_booking_date
  FROM bookings b
  LEFT JOIN slots s ON s.id = b.slot_id
  WHERE b.tenant_id = :tenant_id
  GROUP BY b.customer_id, b.customer_phone
),
customer_visitors AS (
  SELECT
    c.id::text AS visitor_id,
    c.name,
    c.phone,
    c.email,
    COALESCE(ba.total_bookings, 0) AS total_bookings,
    COALESCE(ba.total_spent, 0) AS total_spent,
    COALESCE(ba.package_bookings_count, 0) AS package_bookings_count,
    COALESCE(ba.paid_bookings_count, 0) AS paid_bookings_count,
    ba.last_booking_date,
    CASE WHEN c.is_blocked THEN 'blocked' ELSE 'active' END AS status
  FROM customers c
  LEFT JOIN booking_agg ba ON ba.customer_id = c.id
  WHERE c.tenant_id = :tenant_id
),
guest_visitors AS (
  SELECT
    'guest-' || ba.customer_phone AS visitor_id,
    MAX(b.customer_name) AS name,
    ba.customer_phone AS phone,
    MAX(b.customer_email) AS email,
    ba.total_bookings,
    ba.total_spent,
    ba.package_bookings_count,
    ba.paid_bookings_count,
    ba.last_booking_date,
    'active' AS status
  FROM booking_agg ba
  JOIN bookings b ON b.tenant_id = :tenant_id
    AND b.customer_id IS NULL
    AND b.customer_phone = ba.customer_phone
  WHERE ba.customer_id IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM customers c
      WHERE c.tenant_id = :tenant_id
        AND (c.phone = ba.customer_phone OR TRIM(REPLACE(REPLACE(REPLACE(c.phone, '+', ''), '-', ''), ' ', '')) = TRIM(REPLACE(REPLACE(REPLACE(ba.customer_phone, '+', ''), '-', ''), ' ', ''))
    )
  GROUP BY ba.customer_phone, ba.total_bookings, ba.total_spent, ba.package_bookings_count, ba.paid_bookings_count, ba.last_booking_date
)
SELECT * FROM customer_visitors
UNION ALL
SELECT * FROM guest_visitors
ORDER BY last_booking_date DESC NULLS LAST;

-- -----------------------------------------------------------------------------
-- QUERY 8 — FILTER TEST QUERIES (parameterized)
-- Replace :name, :phone, :start_date, :end_date, :booking_type, :booking_status, :service_id
-- as needed. Use NULL or omit for "no filter".
-- -----------------------------------------------------------------------------

-- 8a) Total visitors with NAME filter (customers whose name contains search)
-- :name = e.g. 'حاتم' or 'sobia'
SELECT COUNT(*) AS total_visitors_with_name_filter
FROM customers
WHERE tenant_id = :tenant_id
  AND (:name IS NULL OR :name = '' OR name ILIKE '%' || REPLACE(REPLACE(REPLACE(:name, '\', '\\'), '%', '\%'), '_', '\_') || '%');

-- 8b) Total bookings with DATE RANGE (slot_date)
-- :start_date, :end_date = 'YYYY-MM-DD' or NULL
SELECT COUNT(*) AS total_bookings_date_filter
FROM bookings b
LEFT JOIN slots s ON s.id = b.slot_id
WHERE b.tenant_id = :tenant_id
  AND (:start_date IS NULL OR s.slot_date >= :start_date)
  AND (:end_date IS NULL OR s.slot_date <= :end_date);

-- 8c) Total package bookings with DATE + SERVICE + STATUS
SELECT COUNT(*) AS total_package_bookings_filtered
FROM bookings b
LEFT JOIN slots s ON s.id = b.slot_id
WHERE b.tenant_id = :tenant_id
  AND COALESCE(b.package_covered_quantity, 0) > 0
  AND (:start_date IS NULL OR s.slot_date >= :start_date)
  AND (:end_date IS NULL OR s.slot_date <= :end_date)
  AND (:service_id IS NULL OR b.service_id = :service_id)
  AND (:booking_status IS NULL OR :booking_status = '' OR b.status = :booking_status);

-- 8d) Total spent with same filters (paid only, status confirmed/completed/checked_in)
SELECT COALESCE(SUM(b.total_price), 0) AS total_spent_filtered
FROM bookings b
LEFT JOIN slots s ON s.id = b.slot_id
WHERE b.tenant_id = :tenant_id
  AND COALESCE(b.package_covered_quantity, 0) = 0
  AND LOWER(TRIM(b.status)) IN ('confirmed', 'completed', 'checked_in')
  AND (:start_date IS NULL OR s.slot_date >= :start_date)
  AND (:end_date IS NULL OR s.slot_date <= :end_date)
  AND (:service_id IS NULL OR b.service_id = :service_id);
