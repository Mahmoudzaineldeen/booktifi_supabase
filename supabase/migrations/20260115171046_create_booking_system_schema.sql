/*
  # Complete Booking System Schema

  ## Overview
  Multi-tenant booking and scheduling system with comprehensive features for service management,
  employee scheduling, customer bookings, payments, and integrations.

  ## New Tables
  
  ### Core Tables
  - `tenants` - Multi-tenant organizations with branding, subscription, and configuration
  - `users` - System users with roles (solution_owner, tenant_admin, receptionist, cashier, employee, customer)
  - `customers` - Customer profiles with booking history
  
  ### Service Management
  - `service_categories` - Categories for organizing services
  - `services` - Individual services with pricing, duration, capacity, and localization
  - `service_offers` - Time-limited discounts and promotions
  - `service_packages` - Bundled service offerings
  - `package_services` - Service items within packages
  
  ### Scheduling
  - `shifts` - Recurring work schedules with days/times
  - `employee_services` - Employee assignments to services and shifts
  - `slots` - Generated time slots for bookings with capacity management
  
  ### Booking System
  - `bookings` - Customer reservations with status tracking and payment
  - `booking_locks` - Temporary capacity reservations during checkout
  - `package_subscriptions` - Customer package purchases with remaining quantity
  - `package_usage` - Tracking package consumption
  
  ### Payment & Invoicing
  - `payments` - Payment transaction records
  - `zoho_tokens` - OAuth tokens for Zoho integration
  - `zoho_invoice_logs` - Invoice generation audit trail
  - `tenant_zoho_configs` - Per-tenant Zoho API configuration
  
  ### Feedback & Marketing
  - `reviews` - Customer service reviews with approval workflow
  - `testimonials` - Curated customer testimonials for marketing
  
  ### System Tables
  - `tenant_features` - Feature flags per tenant
  - `otp_requests` - One-time password verification
  - `sms_logs` - SMS delivery tracking
  - `queue_jobs` - Background job queue
  - `audit_logs` - System-wide audit trail

  ## Custom Types
  - `booking_status` - pending, confirmed, checked_in, completed, cancelled
  - `payment_status` - unpaid, paid_manual, awaiting_payment, paid, refunded
  - `user_role` - solution_owner, tenant_admin, receptionist, cashier, employee, customer

  ## Key Features
  - Multi-language support (English/Arabic) throughout
  - Timezone handling for global operations
  - Capacity management with concurrent booking locks
  - Flexible pricing with adult/child rates and discounts
  - Employee scheduling with custom capacity/duration overrides
  - Package subscriptions with usage tracking
  - Comprehensive audit logging
  - Zoho Books integration for invoicing

  ## Security
  - RLS enabled on all tables
  - Security definer functions for controlled access
  - Policies must be added based on specific business requirements

  ## Important Notes
  1. This schema creates the structure but RLS policies need to be defined separately
  2. The `generate_slots_for_shift` function automatically generates bookable time slots
  3. Booking locks prevent double-booking during checkout process
  4. All timestamps use timestamptz for timezone awareness
  5. Soft deletes are NOT used - rely on CASCADE or SET NULL based on relationship
*/

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create custom ENUM types
DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE payment_status AS ENUM ('unpaid', 'paid_manual', 'awaiting_payment', 'paid', 'refunded');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('solution_owner', 'tenant_admin', 'receptionist', 'cashier', 'employee', 'customer');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Core Tables

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  name text NOT NULL,
  name_ar text NOT NULL DEFAULT '',
  slug text UNIQUE NOT NULL,
  industry text NOT NULL,
  contact_email text,
  contact_phone text,
  address text,
  tenant_time_zone text DEFAULT 'Asia/Riyadh' NOT NULL,
  announced_time_zone text DEFAULT 'Asia/Riyadh' NOT NULL,
  subscription_start timestamptz DEFAULT now(),
  subscription_end timestamptz,
  is_active boolean DEFAULT true NOT NULL,
  public_page_enabled boolean DEFAULT true NOT NULL,
  maintenance_mode boolean DEFAULT false NOT NULL,
  maintenance_message text,
  theme_preset text DEFAULT 'blue-gold',
  logo_url text,
  custom_theme_config jsonb,
  smtp_settings jsonb DEFAULT NULL,
  whatsapp_settings jsonb DEFAULT NULL,
  landing_page_settings jsonb DEFAULT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  email text,
  phone text,
  full_name text NOT NULL,
  full_name_ar text DEFAULT '',
  username text UNIQUE,
  password_hash text,
  role user_role NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS service_categories (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  name_ar text NOT NULL DEFAULT '',
  description text,
  description_ar text,
  display_order integer DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS services (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  category_id uuid REFERENCES service_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  name_ar text NOT NULL DEFAULT '',
  description text,
  description_ar text,
  duration_minutes integer NOT NULL CHECK (duration_minutes > 0),
  base_price decimal(10, 2) NOT NULL CHECK (base_price >= 0),
  adult_price numeric(10, 2) NOT NULL,
  child_price numeric(10, 2),
  capacity_per_slot integer DEFAULT 1 NOT NULL CHECK (capacity_per_slot > 0),
  is_public boolean DEFAULT false NOT NULL,
  assigned_employee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  image_url text,
  gallery_urls jsonb DEFAULT '[]'::jsonb,
  discount_percentage numeric(5, 2) DEFAULT 0,
  discount_start_date date,
  discount_end_date date,
  what_to_expect jsonb DEFAULT '[]'::jsonb,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT unique_service_name_per_tenant UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS service_offers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  service_id uuid REFERENCES services(id) ON DELETE CASCADE NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  name_ar text,
  description text,
  description_ar text,
  discount_percentage numeric(5, 2) NOT NULL CHECK (discount_percentage >= 0 AND discount_percentage <= 100),
  start_date date NOT NULL,
  end_date date NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CHECK (end_date >= start_date)
);

CREATE TABLE IF NOT EXISTS shifts (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE NOT NULL,
  days_of_week integer[] NOT NULL,
  start_time_utc time NOT NULL,
  end_time_utc time NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CHECK (array_length(days_of_week, 1) > 0)
);

CREATE TABLE IF NOT EXISTS employee_services (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  employee_id uuid REFERENCES users(id) ON DELETE CASCADE NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE NOT NULL,
  shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  custom_duration_minutes integer,
  custom_capacity integer,
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(employee_id, service_id, shift_id)
);

CREATE TABLE IF NOT EXISTS slots (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE NOT NULL,
  shift_id uuid REFERENCES shifts(id) ON DELETE CASCADE NOT NULL,
  employee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  slot_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  start_time_utc timestamptz NOT NULL,
  end_time_utc timestamptz NOT NULL,
  total_capacity integer NOT NULL CHECK (total_capacity > 0),
  original_capacity integer NOT NULL CHECK (original_capacity > 0),
  remaining_capacity integer NOT NULL CHECK (remaining_capacity >= 0),
  available_capacity integer NOT NULL CHECK (available_capacity >= 0),
  booked_count integer DEFAULT 0 NOT NULL CHECK (booked_count >= 0),
  is_available boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  CHECK (remaining_capacity <= total_capacity),
  CHECK (available_capacity <= total_capacity)
);

CREATE TABLE IF NOT EXISTS customers (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  phone text NOT NULL,
  name text,
  email text,
  total_bookings integer DEFAULT 0 NOT NULL,
  last_booking_at timestamptz,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, phone)
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE RESTRICT NOT NULL,
  slot_id uuid REFERENCES slots(id) ON DELETE RESTRICT NOT NULL,
  employee_id uuid REFERENCES users(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  package_id uuid,
  booking_group_id uuid,
  customer_name text NOT NULL,
  customer_phone text NOT NULL,
  customer_email text,
  visitor_count integer DEFAULT 1 NOT NULL CHECK (visitor_count > 0),
  adult_count integer DEFAULT 0 NOT NULL CHECK (adult_count >= 0),
  child_count integer DEFAULT 0 NOT NULL CHECK (child_count >= 0),
  total_price decimal(10, 2) NOT NULL CHECK (total_price >= 0),
  status booking_status DEFAULT 'pending' NOT NULL,
  payment_status payment_status DEFAULT 'unpaid' NOT NULL,
  notes text,
  qr_token text,
  qr_scanned boolean DEFAULT false NOT NULL,
  qr_scanned_at timestamptz,
  qr_scanned_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  language text DEFAULT 'en',
  zoho_invoice_id text,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  checked_in_at timestamptz,
  checked_in_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  status_changed_at timestamptz DEFAULT now() NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS booking_locks (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slot_id uuid REFERENCES slots(id) ON DELETE CASCADE NOT NULL,
  reserved_by_session_id text NOT NULL,
  reserved_capacity integer DEFAULT 1 NOT NULL CHECK (reserved_capacity > 0),
  lock_acquired_at timestamptz DEFAULT now() NOT NULL,
  lock_expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE SET NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  is_approved boolean DEFAULT false NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS zoho_tokens (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(tenant_id)
);

CREATE TABLE IF NOT EXISTS zoho_invoice_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE SET NULL,
  invoice_id text,
  invoice_number text,
  status text NOT NULL,
  error_message text,
  response_data jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_zoho_configs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  client_id text NOT NULL,
  client_secret text NOT NULL,
  redirect_uri text NOT NULL,
  region text DEFAULT 'com' NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(tenant_id)
);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  provider text,
  amount decimal(10, 2) NOT NULL,
  currency text DEFAULT 'SAR',
  status text,
  gateway_txn_id text,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS otp_requests (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone text,
  email text,
  otp_code text NOT NULL,
  purpose text DEFAULT 'login' NOT NULL,
  expires_at timestamptz NOT NULL,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS sms_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  phone text NOT NULL,
  message text NOT NULL,
  status text,
  provider_response jsonb,
  created_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS queue_jobs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  job_type text NOT NULL,
  status text DEFAULT 'pending',
  payload jsonb NOT NULL,
  attempts integer DEFAULT 0,
  created_at timestamptz DEFAULT now() NOT NULL,
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS service_packages (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  name text NOT NULL,
  name_ar text,
  description text,
  description_ar text,
  total_price decimal(10, 2) NOT NULL CHECK (total_price >= 0),
  discount_percentage numeric(5, 2) DEFAULT 0,
  discount_start_date date,
  discount_end_date date,
  image_url text,
  gallery_urls jsonb DEFAULT '[]'::jsonb,
  is_public boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS package_services (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  package_id uuid REFERENCES service_packages(id) ON DELETE CASCADE NOT NULL,
  service_id uuid REFERENCES services(id) ON DELETE CASCADE NOT NULL,
  quantity integer DEFAULT 1 NOT NULL CHECK (quantity > 0),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(package_id, service_id)
);

CREATE TABLE IF NOT EXISTS package_subscriptions (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  package_id uuid REFERENCES service_packages(id) ON DELETE RESTRICT NOT NULL,
  customer_id uuid REFERENCES customers(id) ON DELETE CASCADE NOT NULL,
  total_quantity integer NOT NULL CHECK (total_quantity > 0),
  remaining_quantity integer NOT NULL CHECK (remaining_quantity >= 0),
  expires_at timestamptz,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  CHECK (remaining_quantity <= total_quantity)
);

CREATE TABLE IF NOT EXISTS package_usage (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  subscription_id uuid REFERENCES package_subscriptions(id) ON DELETE CASCADE NOT NULL,
  booking_id uuid REFERENCES bookings(id) ON DELETE CASCADE NOT NULL,
  quantity_used integer NOT NULL CHECK (quantity_used > 0),
  created_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(subscription_id, booking_id)
);

CREATE TABLE IF NOT EXISTS tenant_features (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  feature_name text NOT NULL,
  is_enabled boolean DEFAULT true NOT NULL,
  config jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(tenant_id, feature_name)
);

CREATE TABLE IF NOT EXISTS testimonials (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE NOT NULL,
  customer_name text NOT NULL,
  customer_name_ar text,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text NOT NULL,
  comment_ar text,
  image_url text,
  display_order integer DEFAULT 0,
  is_featured boolean DEFAULT false NOT NULL,
  is_active boolean DEFAULT true NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL,
  updated_at timestamptz DEFAULT now() NOT NULL
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action_type text NOT NULL,
  resource_type text NOT NULL,
  resource_id uuid,
  old_values jsonb,
  new_values jsonb,
  ip_address text,
  user_agent text,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create Indexes
CREATE INDEX IF NOT EXISTS idx_tenants_slug ON tenants(slug);
CREATE INDEX IF NOT EXISTS idx_tenants_is_active ON tenants(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_users_tenant_id ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username) WHERE username IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_service_categories_tenant_id ON service_categories(tenant_id);
CREATE INDEX IF NOT EXISTS idx_services_tenant_id ON services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_services_category_id ON services(category_id);
CREATE INDEX IF NOT EXISTS idx_services_is_public ON services(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_services_is_active ON services(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_service_offers_service_id ON service_offers(service_id);
CREATE INDEX IF NOT EXISTS idx_service_offers_tenant_id ON service_offers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_offers_dates ON service_offers(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_shifts_tenant_id ON shifts(tenant_id);
CREATE INDEX IF NOT EXISTS idx_shifts_service_id ON shifts(service_id);
CREATE INDEX IF NOT EXISTS idx_employee_services_employee_id ON employee_services(employee_id);
CREATE INDEX IF NOT EXISTS idx_employee_services_service_id ON employee_services(service_id);
CREATE INDEX IF NOT EXISTS idx_employee_services_shift_id ON employee_services(shift_id);
CREATE INDEX IF NOT EXISTS idx_employee_services_tenant_id ON employee_services(tenant_id);
CREATE INDEX IF NOT EXISTS idx_slots_tenant_id ON slots(tenant_id);
CREATE INDEX IF NOT EXISTS idx_slots_service_id ON slots(service_id);
CREATE INDEX IF NOT EXISTS idx_slots_shift_id ON slots(shift_id);
CREATE INDEX IF NOT EXISTS idx_slots_employee_id ON slots(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_slots_slot_date ON slots(slot_date);
CREATE INDEX IF NOT EXISTS idx_slots_start_time_utc ON slots(start_time_utc);
CREATE INDEX IF NOT EXISTS idx_slots_available ON slots(is_available) WHERE is_available = true;
CREATE INDEX IF NOT EXISTS idx_slots_date_service ON slots(slot_date, service_id, is_available);
CREATE INDEX IF NOT EXISTS idx_customers_tenant_id ON customers(tenant_id);
CREATE INDEX IF NOT EXISTS idx_customers_phone ON customers(tenant_id, phone);
CREATE INDEX IF NOT EXISTS idx_bookings_tenant_id ON bookings(tenant_id);
CREATE INDEX IF NOT EXISTS idx_bookings_service_id ON bookings(service_id);
CREATE INDEX IF NOT EXISTS idx_bookings_slot_id ON bookings(slot_id);
CREATE INDEX IF NOT EXISTS idx_bookings_employee_id ON bookings(employee_id) WHERE employee_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_customer_id ON bookings(customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_customer_phone ON bookings(customer_phone);
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bookings_booking_group_id ON bookings(booking_group_id) WHERE booking_group_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_bookings_package_id ON bookings(package_id) WHERE package_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_booking_locks_slot_id ON booking_locks(slot_id);
CREATE INDEX IF NOT EXISTS idx_booking_locks_expires_at ON booking_locks(lock_expires_at);
CREATE INDEX IF NOT EXISTS idx_reviews_tenant_id ON reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_reviews_service_id ON reviews(service_id) WHERE service_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_reviews_is_approved ON reviews(is_approved) WHERE is_approved = true;
CREATE INDEX IF NOT EXISTS idx_service_packages_tenant_id ON service_packages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_service_packages_is_public ON service_packages(is_public) WHERE is_public = true;
CREATE INDEX IF NOT EXISTS idx_service_packages_is_active ON service_packages(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_package_services_package_id ON package_services(package_id);
CREATE INDEX IF NOT EXISTS idx_package_services_service_id ON package_services(service_id);
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_tenant_id ON package_subscriptions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_customer_id ON package_subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_package_id ON package_subscriptions(package_id);
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_is_active ON package_subscriptions(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_package_usage_subscription_id ON package_usage(subscription_id);
CREATE INDEX IF NOT EXISTS idx_package_usage_booking_id ON package_usage(booking_id);
CREATE INDEX IF NOT EXISTS idx_tenant_features_tenant_id ON tenant_features(tenant_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_tenant_id ON testimonials(tenant_id);
CREATE INDEX IF NOT EXISTS idx_testimonials_is_active ON testimonials(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_testimonials_display_order ON testimonials(display_order);
CREATE INDEX IF NOT EXISTS idx_zoho_tokens_tenant_id ON zoho_tokens(tenant_id);
CREATE INDEX IF NOT EXISTS idx_zoho_invoice_logs_tenant_id ON zoho_invoice_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_zoho_invoice_logs_booking_id ON zoho_invoice_logs(booking_id) WHERE booking_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tenant_zoho_configs_tenant_id ON tenant_zoho_configs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_payments_booking_id ON payments(booking_id);
CREATE INDEX IF NOT EXISTS idx_payments_tenant_id ON payments(tenant_id);
CREATE INDEX IF NOT EXISTS idx_otp_requests_phone ON otp_requests(phone) WHERE phone IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_requests_email ON otp_requests(email) WHERE email IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_otp_requests_expires_at ON otp_requests(expires_at);
CREATE INDEX IF NOT EXISTS idx_audit_logs_tenant_id ON audit_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type_id ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Enable Row Level Security
ALTER TABLE tenants ENABLE ROW LEVEL SECURITY;
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE shifts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE booking_locks ENABLE ROW LEVEL SECURITY;
ALTER TABLE service_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_services ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE package_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_features ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE zoho_invoice_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_zoho_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE otp_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE sms_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE queue_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop existing triggers and functions to replace them
DROP TRIGGER IF EXISTS set_tenant_slug ON tenants;
DROP FUNCTION IF EXISTS generate_tenant_slug() CASCADE;
DROP FUNCTION IF EXISTS get_user_role() CASCADE;
DROP FUNCTION IF EXISTS get_user_tenant_id() CASCADE;
DROP FUNCTION IF EXISTS generate_slots_for_shift(uuid, date, date) CASCADE;
DROP FUNCTION IF EXISTS acquire_booking_lock(uuid, text, integer, integer) CASCADE;
DROP FUNCTION IF EXISTS validate_booking_lock(uuid, text) CASCADE;
DROP FUNCTION IF EXISTS get_active_locks_for_slots(uuid[]) CASCADE;
DROP FUNCTION IF EXISTS cleanup_expired_locks() CASCADE;

-- Helper Functions

CREATE OR REPLACE FUNCTION generate_tenant_slug()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.slug IS NULL THEN
    NEW.slug := lower(regexp_replace(NEW.name, '[^a-zA-Z0-9]+', '', 'g'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_tenant_slug
  BEFORE INSERT ON tenants
  FOR EACH ROW
  EXECUTE FUNCTION generate_tenant_slug();

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS user_role AS $$
  SELECT role FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS uuid AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION generate_slots_for_shift(
  p_shift_id uuid,
  p_start_date date,
  p_end_date date
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_tenant_id uuid;
  v_service_id uuid;
  v_start_time_utc time;
  v_end_time_utc time;
  v_days_of_week integer[];
  v_duration_minutes integer;
  v_capacity_per_slot integer;
  v_employee_id uuid;
  v_current_date date;
  v_slot_start_minutes integer;
  v_slot_end_minutes integer;
  v_shift_start_minutes integer;
  v_shift_end_minutes integer;
  v_slots_generated integer := 0;
  v_start_time time;
  v_end_time time;
  v_start_timestamp timestamptz;
  v_end_timestamp timestamptz;
  v_original_capacity integer;
BEGIN
  SELECT 
    sh.tenant_id,
    sh.service_id,
    sh.start_time_utc,
    sh.end_time_utc,
    sh.days_of_week,
    srv.duration_minutes,
    srv.capacity_per_slot
  INTO 
    v_tenant_id,
    v_service_id,
    v_start_time_utc,
    v_end_time_utc,
    v_days_of_week,
    v_duration_minutes,
    v_capacity_per_slot
  FROM shifts sh
  JOIN services srv ON sh.service_id = srv.id
  WHERE sh.id = p_shift_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Shift not found';
  END IF;

  v_original_capacity := v_capacity_per_slot;

  DELETE FROM slots
  WHERE shift_id = p_shift_id
    AND slot_date >= p_start_date
    AND slot_date <= p_end_date;

  v_shift_start_minutes := EXTRACT(HOUR FROM v_start_time_utc) * 60 + 
                           EXTRACT(MINUTE FROM v_start_time_utc);
  v_shift_end_minutes := EXTRACT(HOUR FROM v_end_time_utc) * 60 + 
                         EXTRACT(MINUTE FROM v_end_time_utc);

  v_current_date := p_start_date;
  WHILE v_current_date <= p_end_date LOOP
    IF EXTRACT(DOW FROM v_current_date)::integer = ANY(v_days_of_week) THEN
      
      FOR v_employee_id IN 
        SELECT DISTINCT employee_id 
        FROM employee_services 
        WHERE shift_id = p_shift_id
      LOOP
        SELECT 
          COALESCE(es.custom_capacity, v_capacity_per_slot),
          COALESCE(es.custom_duration_minutes, v_duration_minutes)
        INTO v_capacity_per_slot, v_duration_minutes
        FROM employee_services es
        WHERE es.employee_id = v_employee_id
          AND es.shift_id = p_shift_id
          AND es.service_id = v_service_id
        LIMIT 1;
        
        v_original_capacity := v_capacity_per_slot;
        
        v_slot_start_minutes := v_shift_start_minutes;
        
        WHILE v_slot_start_minutes + v_duration_minutes <= v_shift_end_minutes LOOP
          v_slot_end_minutes := v_slot_start_minutes + v_duration_minutes;
          
          v_start_time := make_time(
            v_slot_start_minutes / 60,
            v_slot_start_minutes % 60,
            0
          );
          v_end_time := make_time(
            v_slot_end_minutes / 60,
            v_slot_end_minutes % 60,
            0
          );
          
          v_start_timestamp := v_current_date + v_start_time;
          v_end_timestamp := v_current_date + v_end_time;
          
          INSERT INTO slots (
            tenant_id,
            service_id,
            shift_id,
            employee_id,
            slot_date,
            start_time,
            end_time,
            start_time_utc,
            end_time_utc,
            total_capacity,
            original_capacity,
            remaining_capacity,
            available_capacity,
            booked_count,
            is_available
          ) VALUES (
            v_tenant_id,
            v_service_id,
            p_shift_id,
            v_employee_id,
            v_current_date,
            v_start_time,
            v_end_time,
            v_start_timestamp,
            v_end_timestamp,
            v_capacity_per_slot,
            v_original_capacity,
            v_capacity_per_slot,
            v_capacity_per_slot,
            0,
            true
          );
          
          v_slots_generated := v_slots_generated + 1;
          v_slot_start_minutes := v_slot_start_minutes + v_duration_minutes;
        END LOOP;
        
      END LOOP;
      
    END IF;
    
    v_current_date := v_current_date + 1;
  END LOOP;

  RETURN v_slots_generated;
END;
$$;

CREATE OR REPLACE FUNCTION acquire_booking_lock(
  p_slot_id uuid,
  p_session_id text,
  p_reserved_capacity integer,
  p_lock_duration_seconds integer DEFAULT 120
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slot_record RECORD;
  v_locked_capacity integer;
  v_available_capacity integer;
  v_lock_id uuid;
BEGIN
  SELECT 
    id,
    available_capacity,
    is_available,
    original_capacity
  INTO v_slot_record
  FROM slots
  WHERE id = p_slot_id
  FOR UPDATE;
  
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Slot not found';
  END IF;
  
  IF NOT v_slot_record.is_available THEN
    RAISE EXCEPTION 'Slot is not available';
  END IF;
  
  SELECT COALESCE(SUM(reserved_capacity), 0)
  INTO v_locked_capacity
  FROM booking_locks
  WHERE slot_id = p_slot_id
    AND lock_expires_at > now();
  
  v_available_capacity := v_slot_record.available_capacity - v_locked_capacity;
  
  IF v_available_capacity < p_reserved_capacity THEN
    RAISE EXCEPTION 'Not enough tickets available. Only % available, but % requested.', 
      v_available_capacity, p_reserved_capacity;
  END IF;
  
  INSERT INTO booking_locks (
    slot_id,
    reserved_by_session_id,
    reserved_capacity,
    lock_expires_at
  ) VALUES (
    p_slot_id,
    p_session_id,
    p_reserved_capacity,
    now() + (p_lock_duration_seconds || ' seconds')::interval
  )
  RETURNING id INTO v_lock_id;
  
  RETURN v_lock_id;
END;
$$;

CREATE OR REPLACE FUNCTION validate_booking_lock(
  p_lock_id uuid,
  p_session_id text
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_lock_record RECORD;
BEGIN
  SELECT 
    id,
    slot_id,
    reserved_by_session_id,
    reserved_capacity,
    lock_expires_at
  INTO v_lock_record
  FROM booking_locks
  WHERE id = p_lock_id;
  
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  
  IF v_lock_record.lock_expires_at <= now() THEN
    RETURN false;
  END IF;
  
  IF v_lock_record.reserved_by_session_id != p_session_id THEN
    RETURN false;
  END IF;
  
  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION get_active_locks_for_slots(
  p_slot_ids uuid[]
) RETURNS TABLE (
  slot_id uuid,
  total_locked_capacity integer
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    bl.slot_id,
    COALESCE(SUM(bl.reserved_capacity), 0)::integer as total_locked_capacity
  FROM booking_locks bl
  WHERE bl.slot_id = ANY(p_slot_ids)
    AND bl.lock_expires_at > now()
  GROUP BY bl.slot_id;
END;
$$;

CREATE OR REPLACE FUNCTION cleanup_expired_locks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM booking_locks
  WHERE lock_expires_at <= now();
  
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  
  RETURN v_deleted_count;
END;
$$;

-- Grant function permissions
GRANT EXECUTE ON FUNCTION acquire_booking_lock(uuid, text, integer, integer) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION validate_booking_lock(uuid, text) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_active_locks_for_slots(uuid[]) TO authenticated, anon;
GRANT EXECUTE ON FUNCTION cleanup_expired_locks() TO authenticated, anon;
GRANT EXECUTE ON FUNCTION get_user_role() TO authenticated;
GRANT EXECUTE ON FUNCTION get_user_tenant_id() TO authenticated;
GRANT EXECUTE ON FUNCTION generate_slots_for_shift(uuid, date, date) TO authenticated;
