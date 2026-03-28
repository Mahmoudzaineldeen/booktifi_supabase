-- Invoice provider selection (Zoho vs Daftra) and Daftra credentials.
-- Daftra API: https://docs.daftara.dev/

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS invoice_provider text NOT NULL DEFAULT 'zoho'
    CHECK (invoice_provider IN ('zoho', 'daftra'));

ALTER TABLE public.tenants
  ADD COLUMN IF NOT EXISTS daftra_settings jsonb DEFAULT NULL;

COMMENT ON COLUMN public.tenants.invoice_provider IS 'Active invoice backend for new bookings: zoho | daftra';
COMMENT ON COLUMN public.tenants.daftra_settings IS 'Daftra API: { subdomain, api_token, store_id, default_product_id, country_code?, fallback_to_zoho? }';

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS daftra_invoice_id text,
  ADD COLUMN IF NOT EXISTS daftra_invoice_created_at timestamptz;

COMMENT ON COLUMN public.bookings.daftra_invoice_id IS 'Daftra invoice numeric id (string) when invoice_provider was daftra';
COMMENT ON COLUMN public.bookings.daftra_invoice_created_at IS 'When the Daftra invoice was created';

CREATE INDEX IF NOT EXISTS idx_bookings_daftra_invoice_id
  ON public.bookings (daftra_invoice_id)
  WHERE daftra_invoice_id IS NOT NULL;

-- Queue invoice job only when neither provider has stored an invoice id yet
CREATE OR REPLACE FUNCTION public.trigger_zoho_receipt_on_payment()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status IN ('paid', 'paid_manual')
     AND (OLD.payment_status IS NULL OR OLD.payment_status NOT IN ('paid', 'paid_manual')) THEN
    IF NEW.zoho_invoice_id IS NULL
       AND (NEW.daftra_invoice_id IS NULL OR NEW.daftra_invoice_id = '') THEN
      INSERT INTO public.queue_jobs (job_type, payload, status)
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

DROP TRIGGER IF EXISTS zoho_receipt_trigger ON public.bookings;
CREATE TRIGGER zoho_receipt_trigger
AFTER UPDATE OF payment_status ON public.bookings
FOR EACH ROW
WHEN (
  NEW.payment_status IN ('paid', 'paid_manual')
  AND (OLD.payment_status IS NULL OR OLD.payment_status NOT IN ('paid', 'paid_manual'))
)
EXECUTE FUNCTION public.trigger_zoho_receipt_on_payment();

CREATE OR REPLACE FUNCTION public.trigger_zoho_receipt_on_insert()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.payment_status IN ('paid', 'paid_manual')
     AND NEW.zoho_invoice_id IS NULL
     AND (NEW.daftra_invoice_id IS NULL OR NEW.daftra_invoice_id = '') THEN
    INSERT INTO public.queue_jobs (job_type, payload, status)
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

DROP TRIGGER IF EXISTS zoho_receipt_trigger_insert ON public.bookings;
CREATE TRIGGER zoho_receipt_trigger_insert
AFTER INSERT ON public.bookings
FOR EACH ROW
WHEN (NEW.payment_status IN ('paid', 'paid_manual'))
EXECUTE FUNCTION public.trigger_zoho_receipt_on_insert();
