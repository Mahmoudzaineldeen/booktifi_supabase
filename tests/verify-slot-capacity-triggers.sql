-- ============================================================================
-- Quick Verification Script: Slot Capacity Triggers
-- ============================================================================
-- Run this in Supabase SQL Editor to verify triggers are working correctly
-- ============================================================================

-- Step 1: Check if triggers exist and are active
SELECT 
  tgname as trigger_name,
  tgrelid::regclass as table_name,
  tgenabled as is_enabled,
  CASE 
    WHEN tgenabled = 'O' THEN 'Enabled'
    WHEN tgenabled = 'D' THEN 'Disabled'
    ELSE 'Unknown'
  END as status
FROM pg_trigger
WHERE tgname LIKE '%slot_capacity%'
ORDER BY tgname;

-- Step 2: Check if functions exist
SELECT 
  proname as function_name,
  pg_get_functiondef(oid) as function_definition
FROM pg_proc
WHERE proname IN (
  'reduce_slot_capacity_on_booking',
  'restore_slot_capacity_on_booking',
  'recalculate_all_slot_capacities'
)
ORDER BY proname;

-- Step 3: Find a test slot with available capacity
-- Replace <TENANT_ID> with your actual tenant ID
SELECT 
  s.id as slot_id,
  s.slot_date,
  s.start_time,
  s.end_time,
  s.available_capacity,
  s.booked_count,
  s.original_capacity,
  s.is_available,
  COUNT(b.id) FILTER (WHERE b.status IN ('pending', 'confirmed')) as active_bookings,
  SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')) as total_booked_visitors
FROM slots s
LEFT JOIN bookings b ON b.slot_id = s.id
WHERE s.is_available = true
  AND s.available_capacity > 0
  AND s.slot_date >= CURRENT_DATE
  -- AND s.tenant_id = '<TENANT_ID>'  -- Uncomment and set your tenant ID
GROUP BY s.id, s.slot_date, s.start_time, s.end_time, s.available_capacity, s.booked_count, s.original_capacity, s.is_available
ORDER BY s.slot_date, s.start_time
LIMIT 5;

-- Step 4: Verify capacity calculation for a specific slot
-- Replace <SLOT_ID> with an actual slot ID from Step 3
/*
SELECT 
  s.id as slot_id,
  s.original_capacity,
  s.available_capacity as current_available,
  s.booked_count as current_booked,
  COUNT(b.id) FILTER (WHERE b.status IN ('pending', 'confirmed')) as actual_active_bookings,
  SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')) as actual_booked_visitors,
  s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0) as expected_available,
  COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0) as expected_booked,
  CASE 
    WHEN s.available_capacity = (s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0))
      AND s.booked_count = COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0)
    THEN '✅ CORRECT'
    ELSE '❌ MISMATCH'
  END as status
FROM slots s
LEFT JOIN bookings b ON b.slot_id = s.id
WHERE s.id = '<SLOT_ID>'  -- Replace with actual slot ID
GROUP BY s.id, s.original_capacity, s.available_capacity, s.booked_count;
*/

-- Step 5: Test trigger manually (create a test booking)
-- WARNING: This will create an actual booking! Use a test slot.
/*
-- First, note the slot capacity
SELECT id, available_capacity, booked_count 
FROM slots 
WHERE id = '<SLOT_ID>';

-- Create a test booking (this should trigger reduce_slot_capacity_on_booking)
-- Replace placeholders with actual values
INSERT INTO bookings (
  tenant_id,
  service_id,
  slot_id,
  customer_name,
  customer_phone,
  visitor_count,
  adult_count,
  child_count,
  total_price,
  status,
  payment_status
) VALUES (
  '<TENANT_ID>',
  '<SERVICE_ID>',
  '<SLOT_ID>',
  'Test Customer',
  '+966501234567',
  1,
  1,
  0,
  100.00,
  'pending',
  'unpaid'
)
RETURNING id, status;

-- Check if capacity was reduced
SELECT id, available_capacity, booked_count 
FROM slots 
WHERE id = '<SLOT_ID>';

-- Cancel the test booking (this should trigger restore_slot_capacity_on_booking)
UPDATE bookings
SET status = 'cancelled'
WHERE id = '<BOOKING_ID>'  -- Use the ID from INSERT above
RETURNING id, status;

-- Check if capacity was restored
SELECT id, available_capacity, booked_count 
FROM slots 
WHERE id = '<SLOT_ID>';

-- Cleanup: Delete the test booking
DELETE FROM bookings WHERE id = '<BOOKING_ID>';
*/

-- Step 6: Run recalculation function to fix any inconsistencies
-- This will recalculate all slot capacities based on actual bookings
SELECT * FROM recalculate_all_slot_capacities()
LIMIT 10;

-- Step 7: Check for slots with incorrect capacity
SELECT 
  s.id,
  s.slot_date,
  s.start_time,
  s.original_capacity,
  s.available_capacity as current_available,
  s.booked_count as current_booked,
  COUNT(b.id) FILTER (WHERE b.status IN ('pending', 'confirmed')) as actual_bookings,
  SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')) as actual_booked_visitors,
  s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0) as expected_available,
  CASE 
    WHEN s.available_capacity != (s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0))
      OR s.booked_count != COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0)
    THEN '❌ INCORRECT'
    ELSE '✅ CORRECT'
  END as status
FROM slots s
LEFT JOIN bookings b ON b.slot_id = s.id
WHERE s.is_available = true
GROUP BY s.id, s.slot_date, s.start_time, s.original_capacity, s.available_capacity, s.booked_count
HAVING s.available_capacity != (s.original_capacity - COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0))
   OR s.booked_count != COALESCE(SUM(b.visitor_count) FILTER (WHERE b.status IN ('pending', 'confirmed')), 0)
ORDER BY s.slot_date, s.start_time
LIMIT 20;
