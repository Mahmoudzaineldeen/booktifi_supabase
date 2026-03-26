-- ============================================================================
-- Service pricing tags: optional fees, many-to-many with services, booking snapshot
-- Backward compatible: nullable booking columns; default tag seeded per tenant
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.service_pricing_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, name)
);

CREATE UNIQUE INDEX IF NOT EXISTS service_pricing_tags_one_default_per_tenant
  ON public.service_pricing_tags (tenant_id)
  WHERE (is_default = true);

CREATE TABLE IF NOT EXISTS public.tag_fees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tag_id uuid NOT NULL REFERENCES public.service_pricing_tags(id) ON DELETE CASCADE,
  fee_name text,
  fee_value numeric(10,2) NOT NULL DEFAULT 0 CHECK (fee_value >= 0),
  description text,
  UNIQUE (tag_id)
);

CREATE TABLE IF NOT EXISTS public.service_tag_assignments (
  service_id uuid NOT NULL REFERENCES public.services(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES public.service_pricing_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (service_id, tag_id)
);

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS tag_id uuid REFERENCES public.service_pricing_tags(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS applied_tag_fee numeric(10,2) NOT NULL DEFAULT 0;

-- Prevent fees on default tag
CREATE OR REPLACE FUNCTION public.prevent_tag_fee_on_default()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.service_pricing_tags t
    WHERE t.id = NEW.tag_id AND t.is_default = true
  ) THEN
    RAISE EXCEPTION 'Cannot attach a fee to the default tag';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tag_fees_no_default ON public.tag_fees;
CREATE TRIGGER trg_tag_fees_no_default
  BEFORE INSERT OR UPDATE ON public.tag_fees
  FOR EACH ROW EXECUTE FUNCTION public.prevent_tag_fee_on_default();

CREATE OR REPLACE FUNCTION public.prevent_delete_default_pricing_tag()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.is_default = true THEN
    RAISE EXCEPTION 'Cannot delete the default tag';
  END IF;
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_pricing_tags_no_delete_default ON public.service_pricing_tags;
CREATE TRIGGER trg_service_pricing_tags_no_delete_default
  BEFORE DELETE ON public.service_pricing_tags
  FOR EACH ROW EXECUTE FUNCTION public.prevent_delete_default_pricing_tag();

-- Seed default tag per tenant that has services
INSERT INTO public.service_pricing_tags (tenant_id, name, description, is_default)
SELECT DISTINCT s.tenant_id, 'Default', 'Standard pricing', true
FROM public.services s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.service_pricing_tags t
  WHERE t.tenant_id = s.tenant_id AND t.is_default = true
);

-- Link every service to its tenant default tag
INSERT INTO public.service_tag_assignments (service_id, tag_id)
SELECT s.id, t.id
FROM public.services s
JOIN public.service_pricing_tags t ON t.tenant_id = s.tenant_id AND t.is_default = true
ON CONFLICT DO NOTHING;

-- RBAC permissions (admin category)
INSERT INTO public.permissions (id, name, description, category) VALUES
  ('manage_tags', 'Manage tags', 'Create, edit, delete pricing tags and fees', 'admin'),
  ('assign_tags_to_services', 'Assign tags to services', 'Link pricing tags to services', 'admin'),
  ('view_tags', 'View tags', 'View pricing tags and fees', 'admin')
ON CONFLICT (id) DO NOTHING;

-- System Admin role gets all permissions (idempotent pattern from 20260308200000)
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001'::uuid, id FROM public.permissions WHERE id IN (
  'manage_tags', 'assign_tags_to_services', 'view_tags'
)
ON CONFLICT DO NOTHING;

-- Typical tenant admin roles: grant tag permissions (Customer Admin + Bookings Only Admin)
INSERT INTO public.role_permissions (role_id, permission_id) VALUES
  ('00000000-0000-0000-0000-000000000007'::uuid, 'manage_tags'),
  ('00000000-0000-0000-0000-000000000007'::uuid, 'assign_tags_to_services'),
  ('00000000-0000-0000-0000-000000000007'::uuid, 'view_tags'),
  ('00000000-0000-0000-0000-000000000006'::uuid, 'view_tags'),
  ('00000000-0000-0000-0000-000000000006'::uuid, 'assign_tags_to_services')
ON CONFLICT DO NOTHING;
