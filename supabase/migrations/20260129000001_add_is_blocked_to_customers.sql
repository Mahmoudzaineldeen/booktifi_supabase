/*
  # Add is_blocked to customers table

  Used for Visitors Management: block/unblock visitors so they cannot create
  new bookings from the customer side. Reception/Admin see a warning when
  trying to book for a blocked visitor.
*/

ALTER TABLE public.customers
ADD COLUMN IF NOT EXISTS is_blocked boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.customers.is_blocked IS 'When true, visitor cannot create bookings from customer side; reception/admin see warning when booking.';
