-- Payment method and Zoho payment sync for bookings
-- PART 6: payment_method (onsite|transfer), transaction_reference, zoho_payment_id, zoho_sync_status

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IS NULL OR payment_method IN ('onsite', 'transfer')),
  ADD COLUMN IF NOT EXISTS transaction_reference text,
  ADD COLUMN IF NOT EXISTS zoho_payment_id text,
  ADD COLUMN IF NOT EXISTS zoho_sync_status text CHECK (zoho_sync_status IS NULL OR zoho_sync_status IN ('synced', 'pending', 'failed'));

COMMENT ON COLUMN bookings.payment_method IS 'onsite = مدفوع يدوياً, transfer = حوالة';
COMMENT ON COLUMN bookings.transaction_reference IS 'Required when payment_method = transfer';
COMMENT ON COLUMN bookings.zoho_payment_id IS 'Zoho customer payment ID after recording payment against invoice';
COMMENT ON COLUMN bookings.zoho_sync_status IS 'synced | pending | failed';

CREATE INDEX IF NOT EXISTS idx_bookings_payment_method ON bookings(payment_method) WHERE payment_method IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_zoho_sync_status ON bookings(zoho_sync_status) WHERE zoho_sync_status = 'pending';
