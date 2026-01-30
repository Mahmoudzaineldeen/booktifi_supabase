-- Add same payment options as bookings: payment_method (onsite | transfer), transaction_reference
ALTER TABLE package_subscriptions
  ADD COLUMN IF NOT EXISTS payment_method text CHECK (payment_method IS NULL OR payment_method IN ('onsite', 'transfer')),
  ADD COLUMN IF NOT EXISTS transaction_reference text;

COMMENT ON COLUMN package_subscriptions.payment_method IS 'onsite = مدفوع يدوياً, transfer = حوالة بنكية';
COMMENT ON COLUMN package_subscriptions.transaction_reference IS 'Required when payment_method = transfer';

CREATE INDEX IF NOT EXISTS idx_package_subscriptions_payment_method ON package_subscriptions(payment_method) WHERE payment_method IS NOT NULL;
