/*
  # Fix payment_status enum cast in create_bulk_booking

  Ensures payment_status is cast to the enum type so INSERT works when
  the column is of type payment_status (enum) and expression is text.
*/

CREATE OR REPLACE FUNCTION public.create_bulk_booking(
  p_slot_ids uuid[],
  p_service_id uuid,
  p_tenant_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_customer_email text,
  p_visitor_count integer,
  p_adult_count integer,
  p_child_count integer,
  p_total_price numeric(10,2),
  p_notes text,
  p_employee_id uuid,
  p_session_id text,
  p_customer_id uuid,
  p_offer_id uuid,
  p_language text DEFAULT 'en',
  p_booking_group_id uuid DEFAULT NULL,
  p_package_subscription_id uuid DEFAULT NULL,
  p_package_covered_quantity integer DEFAULT 0,
  p_paid_quantity integer DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot_record RECORD;
  v_service_record RECORD;
  v_tenant_record RECORD;
  v_booking_id uuid;
  v_booking_ids uuid[] := ARRAY[]::uuid[];
  v_locked_capacity integer;
  v_available_capacity integer;
  v_total_requested integer;
  v_slot_index integer;
  v_booking jsonb;
  v_bookings jsonb[] := ARRAY[]::jsonb[];
  v_booking_group_id_final uuid;
  v_price_per_slot numeric(10,2);
  v_unique_slot_count integer;
  v_paid_qty integer;
  v_package_covered_qty integer;
  v_slot_package_covered integer;
  v_slot_paid integer;
BEGIN
  IF array_length(p_slot_ids, 1) IS NULL OR array_length(p_slot_ids, 1) = 0 THEN
    RAISE EXCEPTION 'At least one slot must be provided';
  END IF;

  IF p_service_id IS NULL OR p_tenant_id IS NULL OR 
     p_customer_name IS NULL OR p_customer_phone IS NULL THEN
    RAISE EXCEPTION 'Missing required fields';
  END IF;

  IF p_visitor_count != (p_adult_count + p_child_count) THEN
    RAISE EXCEPTION 'visitor_count (%) does not match adult_count (%) + child_count (%)', 
      p_visitor_count, p_adult_count, p_child_count;
  END IF;

  IF p_paid_quantity IS NULL THEN
    v_paid_qty := p_visitor_count - p_package_covered_quantity;
  ELSE
    v_paid_qty := p_paid_quantity;
  END IF;

  v_package_covered_qty := p_package_covered_quantity;

  IF (v_package_covered_qty + v_paid_qty) != p_visitor_count THEN
    RAISE EXCEPTION 'package_covered_quantity (%) + paid_quantity (%) must equal visitor_count (%)', 
      v_package_covered_qty, v_paid_qty, p_visitor_count;
  END IF;

  IF v_package_covered_qty < 0 OR v_paid_qty < 0 THEN
    RAISE EXCEPTION 'package_covered_quantity and paid_quantity must be non-negative';
  END IF;

  SELECT id, tenant_id, is_active
  INTO v_service_record
  FROM services
  WHERE id = p_service_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Service not found';
  END IF;

  IF v_service_record.tenant_id != p_tenant_id THEN
    RAISE EXCEPTION 'Service does not belong to the specified tenant';
  END IF;

  IF NOT v_service_record.is_active THEN
    RAISE EXCEPTION 'Service is not active';
  END IF;

  SELECT id, is_active
  INTO v_tenant_record
  FROM tenants
  WHERE id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Tenant not found';
  END IF;

  IF NOT v_tenant_record.is_active THEN
    RAISE EXCEPTION 'Tenant account is deactivated';
  END IF;

  IF p_booking_group_id IS NULL THEN
    v_booking_group_id_final := gen_random_uuid();
  ELSE
    v_booking_group_id_final := p_booking_group_id;
  END IF;

  v_total_requested := array_length(p_slot_ids, 1);

  IF v_total_requested != p_visitor_count THEN
    RAISE EXCEPTION 'Number of slots (%) does not match visitor_count (%). Each slot requires 1 visitor.', 
      v_total_requested, p_visitor_count;
  END IF;

  v_price_per_slot := p_total_price / array_length(p_slot_ids, 1);

  FOR v_slot_index IN 1..array_length(p_slot_ids, 1) LOOP
    IF v_slot_index <= v_package_covered_qty THEN
      v_slot_package_covered := 1;
      v_slot_paid := 0;
    ELSE
      v_slot_package_covered := 0;
      v_slot_paid := 1;
    END IF;

    SELECT id, available_capacity, is_available, original_capacity, booked_count, tenant_id
    INTO v_slot_record
    FROM slots
    WHERE id = p_slot_ids[v_slot_index]
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Slot % not found', p_slot_ids[v_slot_index];
    END IF;

    IF v_slot_record.tenant_id != p_tenant_id THEN
      RAISE EXCEPTION 'Slot % does not belong to the specified tenant', p_slot_ids[v_slot_index];
    END IF;

    IF NOT v_slot_record.is_available THEN
      RAISE EXCEPTION 'Slot % is not available', p_slot_ids[v_slot_index];
    END IF;

    IF v_slot_record.available_capacity < 1 THEN
      RAISE EXCEPTION 'Slot % has no available capacity', p_slot_ids[v_slot_index];
    END IF;

    DECLARE
      v_slot_price numeric(10,2);
    BEGIN
      IF v_slot_paid > 0 THEN
        v_slot_price := v_price_per_slot;
      ELSE
        v_slot_price := 0;
      END IF;

      INSERT INTO bookings (
        tenant_id, service_id, slot_id, employee_id,
        customer_name, customer_phone, customer_email,
        visitor_count, adult_count, child_count,
        total_price, status, payment_status, notes,
        created_by_user_id, customer_id, offer_id, language,
        booking_group_id, package_subscription_id,
        package_covered_quantity,
        paid_quantity
      ) VALUES (
        p_tenant_id, p_service_id, p_slot_ids[v_slot_index], p_employee_id,
        p_customer_name, p_customer_phone, p_customer_email,
        1,
        CASE WHEN v_slot_index <= p_adult_count THEN 1 ELSE 0 END,
        CASE WHEN v_slot_index > p_adult_count THEN 1 ELSE 0 END,
        v_slot_price,
        'pending',
        CASE WHEN v_slot_paid > 0 THEN 'unpaid'::payment_status ELSE 'paid'::payment_status END,
        p_notes,
        p_customer_id, p_customer_id, p_offer_id, p_language,
        v_booking_group_id_final, p_package_subscription_id,
        v_slot_package_covered,
        v_slot_paid
      )
      RETURNING id INTO v_booking_id;

      UPDATE slots
      SET 
        available_capacity = GREATEST(0, available_capacity - 1),
        booked_count = booked_count + 1
      WHERE id = p_slot_ids[v_slot_index];

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Failed to update slot capacity for slot %', p_slot_ids[v_slot_index];
      END IF;

      v_booking_ids := array_append(v_booking_ids, v_booking_id);

      SELECT jsonb_build_object(
        'id', b.id, 'tenant_id', b.tenant_id, 'service_id', b.service_id,
        'slot_id', b.slot_id, 'employee_id', b.employee_id,
        'customer_name', b.customer_name, 'customer_phone', b.customer_phone,
        'customer_email', b.customer_email, 'visitor_count', b.visitor_count,
        'adult_count', b.adult_count, 'child_count', b.child_count,
        'total_price', b.total_price, 'status', b.status,
        'payment_status', b.payment_status, 'notes', b.notes,
        'customer_id', b.customer_id, 'offer_id', b.offer_id,
        'language', b.language, 'booking_group_id', b.booking_group_id,
        'package_subscription_id', b.package_subscription_id,
        'package_covered_quantity', b.package_covered_quantity,
        'paid_quantity', b.paid_quantity,
        'created_at', b.created_at, 'updated_at', b.updated_at
      )
      INTO v_booking
      FROM bookings b
      WHERE b.id = v_booking_id;

      v_bookings := array_append(v_bookings, v_booking);
    END;
  END LOOP;

  RETURN jsonb_build_object(
    'bookings', v_bookings,
    'booking_group_id', v_booking_group_id_final,
    'total_bookings', array_length(v_booking_ids, 1),
    'package_covered_total', v_package_covered_qty,
    'paid_total', v_paid_qty
  );
END;
$$;

ALTER FUNCTION public.create_bulk_booking(
  uuid[], uuid, uuid, text, text, text, integer, integer, integer,
  numeric, text, uuid, text, uuid, uuid, text, uuid, uuid, integer, integer
) SECURITY DEFINER;
