-- Bookings for Isabletia today (tenant: healingtouches_sa@hotmail.com)
-- Run in Supabase SQL Editor. For another date, replace CURRENT_DATE.

WITH tenant AS (
  SELECT id AS tenant_id
  FROM tenants
  WHERE contact_email = 'healingtouches_sa@hotmail.com'
  LIMIT 1
),
isabletia AS (
  SELECT u.id AS employee_id
  FROM users u
  CROSS JOIN tenant t
  WHERE u.tenant_id = t.tenant_id
    AND u.role = 'employee'
    AND (u.full_name ILIKE '%Isabletia%' OR u.full_name_ar ILIKE '%Isabletia%')
  LIMIT 1
)
SELECT
  b.id AS booking_id,
  b.customer_name,
  b.customer_phone,
  b.customer_email,
  s.slot_date,
  s.start_time,
  s.end_time,
  b.status,
  b.payment_status,
  b.total_price,
  b.visitor_count,
  b.notes,
  b.created_at,
  COALESCE(srv.name, srv.name_ar) AS service_name
FROM bookings b
JOIN slots s ON s.id = b.slot_id
JOIN isabletia i ON i.employee_id = b.employee_id
CROSS JOIN tenant t
LEFT JOIN services srv ON srv.id = b.service_id AND srv.tenant_id = t.tenant_id
WHERE b.tenant_id = t.tenant_id
  AND s.slot_date = CURRENT_DATE
ORDER BY s.start_time;
