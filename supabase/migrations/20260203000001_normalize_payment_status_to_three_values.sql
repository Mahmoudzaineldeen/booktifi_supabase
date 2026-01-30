-- Normalize booking payment_status to allowed set: unpaid, paid, paid_manual
-- Display is derived as: Unpaid | Paid On Site (paid/paid_manual + onsite) | Bank Transfer (paid/paid_manual + transfer)
-- Convert awaiting_payment and refunded to unpaid for consistency.

UPDATE bookings
SET payment_status = 'unpaid'
WHERE payment_status IN ('awaiting_payment', 'refunded');

COMMENT ON COLUMN bookings.payment_status IS 'Stored: unpaid, paid, paid_manual. Display as: Unpaid | Paid On Site | Bank Transfer (based on payment_method when paid).';
