-- Add invoice processing status to bookings (background invoice flow).
-- invoice_processing_status: pending | processing | completed | failed
-- invoice_last_error: last error message when status = failed

ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS invoice_processing_status text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS invoice_last_error text DEFAULT NULL;

COMMENT ON COLUMN bookings.invoice_processing_status IS 'Background invoice job: pending, processing, completed, failed';
COMMENT ON COLUMN bookings.invoice_last_error IS 'Last error when invoice_processing_status = failed';

-- Update INSERT trigger to queue zoho_receipt for paid_manual as well as paid
-- (invoice_processing_status is set by the app when creating booking so UI can show "preparing")
CREATE OR REPLACE FUNCTION trigger_zoho_receipt_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.zoho_invoice_id IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.payment_status IN ('paid', 'paid_manual') THEN
    INSERT INTO queue_jobs (job_type, payload, status)
    VALUES (
      'zoho_receipt',
      jsonb_build_object(
        'booking_id', NEW.id,
        'tenant_id', NEW.tenant_id,
        'attempt', 0
      ),
      'pending'
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zoho_receipt_trigger_insert ON bookings;
CREATE TRIGGER zoho_receipt_trigger_insert
AFTER INSERT ON bookings
FOR EACH ROW
WHEN (NEW.payment_status IN ('paid', 'paid_manual') AND NEW.zoho_invoice_id IS NULL)
EXECUTE FUNCTION trigger_zoho_receipt_on_insert();

-- UPDATE trigger: when marking as paid, queue job (app sets invoice_processing_status when needed)
CREATE OR REPLACE FUNCTION trigger_zoho_receipt_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status IN ('paid', 'paid_manual') AND (OLD.payment_status IS NULL OR OLD.payment_status NOT IN ('paid', 'paid_manual')) THEN
    IF NEW.zoho_invoice_id IS NULL THEN
      INSERT INTO queue_jobs (job_type, payload, status)
      VALUES (
        'zoho_receipt',
        jsonb_build_object(
          'booking_id', NEW.id,
          'tenant_id', NEW.tenant_id,
          'attempt', 0
        ),
        'pending'
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS zoho_receipt_trigger ON bookings;
CREATE TRIGGER zoho_receipt_trigger
AFTER UPDATE OF payment_status ON bookings
FOR EACH ROW
WHEN (NEW.payment_status IN ('paid', 'paid_manual') AND (OLD.payment_status IS NULL OR OLD.payment_status NOT IN ('paid', 'paid_manual')))
EXECUTE FUNCTION trigger_zoho_receipt_on_payment();
