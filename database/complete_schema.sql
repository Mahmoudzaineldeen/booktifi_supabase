-- ============================================================================
-- Complete Database Schema Export
-- Generated from Supabase SQL Editor
-- ============================================================================
-- This file contains the complete schema for the booking system database
-- Run this file in a fresh database to recreate the entire schema
-- ============================================================================

-- ============================================================================
-- 1. CREATE TYPES/ENUMS (Must be created first)
-- ============================================================================

CREATE TYPE booking_status AS ENUM ('pending', 'confirmed', 'checked_in', 'completed', 'cancelled');
CREATE TYPE capacity_mode AS ENUM ('employee_based', 'service_based');
CREATE TYPE payment_status AS ENUM ('unpaid', 'paid_manual', 'awaiting_payment', 'paid', 'refunded');
CREATE TYPE user_role AS ENUM ('solution_owner', 'tenant_admin', 'receptionist', 'cashier', 'employee', 'customer');

-- ============================================================================
-- 2. CREATE TABLES
-- ============================================================================

CREATE TABLE IF NOT EXISTS audit_logs (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID,
  user_id UUID,
  action_type TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id UUID,
  old_values JSONB,
  new_values JSONB,
  ip_address TEXT,
  user_agent TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS booking_locks (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  slot_id UUID NOT NULL,
  reserved_by_session_id TEXT NOT NULL,
  reserved_capacity INTEGER(32,0) NOT NULL DEFAULT 1,
  lock_acquired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  lock_expires_at TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  service_id UUID NOT NULL,
  slot_id UUID NOT NULL,
  employee_id UUID,
  customer_name TEXT NOT NULL,
  customer_phone TEXT NOT NULL,
  customer_email TEXT,
  visitor_count INTEGER(32,0) NOT NULL DEFAULT 1,
  total_price NUMERIC(10,2) NOT NULL,
  status booking_status NOT NULL DEFAULT 'pending'::booking_status,
  payment_status payment_status NOT NULL DEFAULT 'unpaid'::payment_status,
  notes TEXT,
  qr_token TEXT,
  created_by_user_id UUID,
  checked_in_at TIMESTAMP WITH TIME ZONE,
  checked_in_by_user_id UUID,
  status_changed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  booking_group_id UUID,
  package_subscription_id UUID,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  customer_id UUID,
  offer_id UUID,
  adult_count INTEGER(32,0) NOT NULL,
  child_count INTEGER(32,0) NOT NULL DEFAULT 0,
  qr_scanned BOOLEAN NOT NULL DEFAULT false,
  qr_scanned_at TIMESTAMP WITH TIME ZONE,
  qr_scanned_by_user_id UUID,
  package_id UUID,
  zoho_invoice_id TEXT,
  zoho_invoice_created_at TIMESTAMP WITH TIME ZONE,
  language TEXT NOT NULL DEFAULT 'en'::text
);

CREATE TABLE IF NOT EXISTS customers (id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  phone TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_booking_at TIMESTAMP WITH TIME ZONE,
  total_bookings INTEGER(32,0) DEFAULT 0
);

CREATE TABLE IF NOT EXISTS employee_services (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  employee_id UUID NOT NULL,
  service_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  shift_id UUID,
  duration_minutes INTEGER(32,0),
  capacity_per_slot INTEGER(32,0) DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS otp_requests (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  phone TEXT,
  otp_code TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  verified BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  purpose TEXT DEFAULT 'password_reset'::text,
  email TEXT
);

CREATE TABLE IF NOT EXISTS package_services (id UUID NOT NULL DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL,
  service_id UUID NOT NULL,
  quantity INTEGER(32,0) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_subscription_usage (id UUID NOT NULL DEFAULT gen_random_uuid(),
  subscription_id UUID NOT NULL,
  service_id UUID NOT NULL,
  original_quantity INTEGER(32,0) NOT NULL,
  remaining_quantity INTEGER(32,0) NOT NULL,
  used_quantity INTEGER(32,0) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS package_subscriptions (id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  customer_id UUID NOT NULL,
  package_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'::text,
  subscribed_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payments (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  booking_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  provider TEXT,
  amount NUMERIC(10,2) NOT NULL,
  currency TEXT DEFAULT 'SAR'::text,
  status TEXT,
  gateway_txn_id TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS queue_jobs (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  job_type TEXT NOT NULL,
  status TEXT DEFAULT 'pending'::text,
  payload JSONB NOT NULL,
  attempts INTEGER(32,0) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE
);

CREATE TABLE IF NOT EXISTS reviews (id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  service_id UUID NOT NULL,
  booking_id UUID,
  customer_id UUID NOT NULL,
  rating INTEGER(32,0) NOT NULL,
  comment TEXT,
  comment_ar TEXT,
  is_approved BOOLEAN NOT NULL DEFAULT false,
  is_visible BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  image_url TEXT
);

CREATE TABLE IF NOT EXISTS service_categories (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT ''::text,
  description TEXT,
  description_ar TEXT,
  display_order INTEGER(32,0) DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_offers (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  service_id UUID NOT NULL,
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT,
  description TEXT,
  description_ar TEXT,
  price NUMERIC(10,2) NOT NULL,
  original_price NUMERIC(10,2),
  discount_percentage INTEGER(32,0),
  duration_minutes INTEGER(32,0),
  perks JSONB DEFAULT '[]'::jsonb,
  perks_ar JSONB DEFAULT '[]'::jsonb,
  badge TEXT,
  badge_ar TEXT,
  display_order INTEGER(32,0) DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  closing_time TIME WITHOUT TIME ZONE,
  meeting_point TEXT,
  meeting_point_ar TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS service_packages (id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  description TEXT,
  description_ar TEXT,
  total_price NUMERIC(10,2) NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  original_price NUMERIC(10,2),
  discount_percentage INTEGER(32,0),
  image_url TEXT,
  gallery_urls JSONB DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS services (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  category_id UUID,
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT ''::text,
  description TEXT,
  description_ar TEXT,
  duration_minutes INTEGER(32,0) NOT NULL,
  base_price NUMERIC(10,2) NOT NULL,
  capacity_per_slot INTEGER(32,0) NOT NULL DEFAULT 1,
  capacity_mode capacity_mode NOT NULL DEFAULT 'employee_based'::capacity_mode,
  service_duration_minutes INTEGER(32,0) NOT NULL,
  service_capacity_per_slot INTEGER(32,0),
  is_public BOOLEAN NOT NULL DEFAULT false,
  assigned_employee_id UUID,
  image_url TEXT,
  gallery_urls JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  average_rating NUMERIC(3,2) DEFAULT 0,
  total_reviews INTEGER(32,0) DEFAULT 0,
  original_price NUMERIC(10,2),
  discount_percentage INTEGER(32,0),
  child_price NUMERIC(10,2)
);

CREATE TABLE IF NOT EXISTS shifts (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  service_id UUID NOT NULL,
  days_of_week _int4[] NOT NULL,
  start_time_utc TIME WITHOUT TIME ZONE NOT NULL,
  end_time_utc TIME WITHOUT TIME ZONE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS slots (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  shift_id UUID NOT NULL,
  employee_id UUID,
  slot_date DATE NOT NULL,
  start_time TIME WITHOUT TIME ZONE NOT NULL,
  end_time TIME WITHOUT TIME ZONE NOT NULL,
  start_time_utc TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time_utc TIMESTAMP WITH TIME ZONE NOT NULL,
  available_capacity INTEGER(32,0) NOT NULL,
  booked_count INTEGER(32,0) NOT NULL DEFAULT 0,
  is_available BOOLEAN NOT NULL DEFAULT true,
  is_overbooked BOOLEAN NOT NULL DEFAULT false,
  original_capacity INTEGER(32,0) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sms_logs (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID,
  phone TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT,
  provider_response JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_features (id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  employees_enabled BOOLEAN NOT NULL DEFAULT true,
  employee_assignment_mode TEXT NOT NULL DEFAULT 'both'::text,
  packages_enabled BOOLEAN NOT NULL DEFAULT true,
  landing_page_enabled BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenant_zoho_configs (id UUID NOT NULL DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  client_id CHARACTER VARYING(255) NOT NULL,
  client_secret CHARACTER VARYING(255) NOT NULL,
  redirect_uri CHARACTER VARYING(500) DEFAULT 'http://localhost:3001/api/zoho/callback'::character varying,
  scopes _text[] DEFAULT ARRAY['ZohoInvoice.invoices.CREATE'::text, 'ZohoInvoice.invoices.READ'::text, 'ZohoInvoice.contacts.CREATE'::text, 'ZohoInvoice.contacts.READ'::text],
  region CHARACTER VARYING(50) DEFAULT 'com'::character varying,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tenants (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  name_ar TEXT NOT NULL DEFAULT ''::text,
  slug TEXT NOT NULL,
  industry TEXT NOT NULL,
  contact_email TEXT,
  contact_phone TEXT,
  address TEXT,
  tenant_time_zone TEXT NOT NULL DEFAULT 'Asia/Riyadh'::text,
  announced_time_zone TEXT NOT NULL DEFAULT 'Asia/Riyadh'::text,
  subscription_start TIMESTAMP WITH TIME ZONE DEFAULT now(),
  subscription_end TIMESTAMP WITH TIME ZONE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  public_page_enabled BOOLEAN NOT NULL DEFAULT true,
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  maintenance_message TEXT,
  theme_preset TEXT DEFAULT 'blue-gold'::text,
  logo_url TEXT,
  custom_theme_config JSONB,
  landing_page_settings JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  smtp_settings JSONB,
  whatsapp_settings JSONB
);

CREATE TABLE IF NOT EXISTS time_slots (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID NOT NULL,
  service_id UUID NOT NULL,
  shift_id UUID NOT NULL,
  start_time_utc TIMESTAMP WITH TIME ZONE NOT NULL,
  end_time_utc TIMESTAMP WITH TIME ZONE NOT NULL,
  total_capacity INTEGER(32,0) NOT NULL,
  remaining_capacity INTEGER(32,0) NOT NULL,
  is_available BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID,
  email TEXT,
  username TEXT,
  phone TEXT,
  full_name TEXT NOT NULL,
  full_name_ar TEXT DEFAULT ''::text,
  role user_role NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  capacity_per_slot INTEGER(32,0) NOT NULL DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  password_hash TEXT
);

CREATE TABLE IF NOT EXISTS zoho_invoice_logs (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  booking_id UUID,
  tenant_id UUID,
  zoho_invoice_id TEXT,
  status TEXT NOT NULL,
  error_message TEXT,
  request_payload JSONB,
  response_payload JSONB,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS zoho_tokens (id UUID NOT NULL DEFAULT uuid_generate_v4(),
  tenant_id UUID,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- ============================================================================
-- 3. CREATE PRIMARY KEYS
-- ============================================================================

ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);
ALTER TABLE booking_locks ADD CONSTRAINT booking_locks_pkey PRIMARY KEY (id);
ALTER TABLE bookings ADD CONSTRAINT bookings_pkey PRIMARY KEY (id);
ALTER TABLE customers ADD CONSTRAINT customers_pkey PRIMARY KEY (id);
ALTER TABLE employee_services ADD CONSTRAINT employee_services_pkey PRIMARY KEY (id);
ALTER TABLE otp_requests ADD CONSTRAINT otp_requests_pkey PRIMARY KEY (id);
ALTER TABLE package_services ADD CONSTRAINT package_services_pkey PRIMARY KEY (id);
ALTER TABLE package_subscription_usage ADD CONSTRAINT package_subscription_usage_pkey PRIMARY KEY (id);
ALTER TABLE package_subscriptions ADD CONSTRAINT package_subscriptions_pkey PRIMARY KEY (id);
ALTER TABLE payments ADD CONSTRAINT payments_pkey PRIMARY KEY (id);
ALTER TABLE queue_jobs ADD CONSTRAINT queue_jobs_pkey PRIMARY KEY (id);
ALTER TABLE reviews ADD CONSTRAINT reviews_pkey PRIMARY KEY (id);
ALTER TABLE service_categories ADD CONSTRAINT service_categories_pkey PRIMARY KEY (id);
ALTER TABLE service_offers ADD CONSTRAINT service_offers_pkey PRIMARY KEY (id);
ALTER TABLE service_packages ADD CONSTRAINT service_packages_pkey PRIMARY KEY (id);
ALTER TABLE services ADD CONSTRAINT services_pkey PRIMARY KEY (id);
ALTER TABLE shifts ADD CONSTRAINT shifts_pkey PRIMARY KEY (id);
ALTER TABLE slots ADD CONSTRAINT slots_pkey PRIMARY KEY (id);
ALTER TABLE sms_logs ADD CONSTRAINT sms_logs_pkey PRIMARY KEY (id);
ALTER TABLE tenant_features ADD CONSTRAINT tenant_features_pkey PRIMARY KEY (id);
ALTER TABLE tenant_zoho_configs ADD CONSTRAINT tenant_zoho_configs_pkey PRIMARY KEY (id);
ALTER TABLE tenants ADD CONSTRAINT tenants_pkey PRIMARY KEY (id);
ALTER TABLE time_slots ADD CONSTRAINT time_slots_pkey PRIMARY KEY (id);
ALTER TABLE users ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE zoho_invoice_logs ADD CONSTRAINT zoho_invoice_logs_pkey PRIMARY KEY (id);
ALTER TABLE zoho_tokens ADD CONSTRAINT zoho_tokens_pkey PRIMARY KEY (id);

-- ============================================================================
-- 4. CREATE UNIQUE CONSTRAINTS
-- ============================================================================

CREATE UNIQUE INDEX customers_tenant_id_phone_key ON public.customers USING btree (tenant_id, phone);
CREATE UNIQUE INDEX employee_services_employee_id_service_id_shift_id_key ON public.employee_services USING btree (employee_id, service_id, shift_id);
CREATE UNIQUE INDEX package_services_package_id_service_id_key ON public.package_services USING btree (package_id, service_id);
CREATE UNIQUE INDEX package_subscription_usage_subscription_id_service_id_key ON public.package_subscription_usage USING btree (subscription_id, service_id);
CREATE UNIQUE INDEX reviews_booking_id_key ON public.reviews USING btree (booking_id);
CREATE UNIQUE INDEX tenants_slug_key ON public.tenants USING btree (slug);
CREATE UNIQUE INDEX tenant_features_tenant_id_key ON public.tenant_features USING btree (tenant_id);
CREATE UNIQUE INDEX tenant_zoho_configs_tenant_id_key ON public.tenant_zoho_configs USING btree (tenant_id);
CREATE UNIQUE INDEX users_username_key ON public.users USING btree (username);
CREATE UNIQUE INDEX zoho_tokens_tenant_id_key ON public.zoho_tokens USING btree (tenant_id);

-- ============================================================================
-- 5. CREATE INDEXES
-- ============================================================================

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);
CREATE INDEX idx_audit_logs_resource_type_id ON public.audit_logs USING btree (resource_type, resource_id);
CREATE INDEX idx_audit_logs_tenant_id ON public.audit_logs USING btree (tenant_id);
CREATE INDEX idx_booking_locks_expires_at ON public.booking_locks USING btree (lock_expires_at);
CREATE INDEX idx_booking_locks_session_id ON public.booking_locks USING btree (reserved_by_session_id);
CREATE INDEX idx_booking_locks_slot_expires ON public.booking_locks USING btree (slot_id, lock_expires_at);
CREATE INDEX idx_booking_locks_slot_id ON public.booking_locks USING btree (slot_id);
CREATE INDEX idx_bookings_created_at ON public.bookings USING btree (created_at DESC);
CREATE INDEX idx_bookings_customer_id ON public.bookings USING btree (customer_id);
CREATE INDEX idx_bookings_customer_phone ON public.bookings USING btree (customer_phone);
CREATE INDEX idx_bookings_group_id ON public.bookings USING btree (booking_group_id);
CREATE INDEX idx_bookings_language ON public.bookings USING btree (language);
CREATE INDEX idx_bookings_offer_id ON public.bookings USING btree (offer_id);
CREATE INDEX idx_bookings_package_id ON public.bookings USING btree (package_id) WHERE (package_id IS NOT NULL);
CREATE INDEX idx_bookings_package_subscription ON public.bookings USING btree (package_subscription_id);
CREATE INDEX idx_bookings_service_id ON public.bookings USING btree (service_id);
CREATE INDEX idx_bookings_slot_id ON public.bookings USING btree (slot_id);
CREATE INDEX idx_bookings_status ON public.bookings USING btree (status);
CREATE INDEX idx_bookings_tenant_id ON public.bookings USING btree (tenant_id);
CREATE INDEX idx_bookings_zoho_invoice_id ON public.bookings USING btree (zoho_invoice_id) WHERE (zoho_invoice_id IS NOT NULL);
CREATE INDEX idx_customers_tenant_id ON public.customers USING btree (tenant_id);
CREATE INDEX idx_customers_tenant_phone ON public.customers USING btree (tenant_id, phone);
CREATE INDEX idx_employee_services_employee_id ON public.employee_services USING btree (employee_id);
CREATE INDEX idx_employee_services_service_id ON public.employee_services USING btree (service_id);
CREATE INDEX idx_employee_services_shift_id ON public.employee_services USING btree (shift_id);
CREATE INDEX idx_employee_services_tenant_id ON public.employee_services USING btree (tenant_id);
CREATE INDEX idx_otp_requests_email ON public.otp_requests USING btree (email) WHERE (email IS NOT NULL);
CREATE INDEX idx_otp_requests_email_purpose ON public.otp_requests USING btree (email, purpose, verified, expires_at) WHERE (email IS NOT NULL);
CREATE INDEX idx_otp_requests_phone_purpose ON public.otp_requests USING btree (phone, purpose, verified, expires_at) WHERE (phone IS NOT NULL);
CREATE INDEX idx_otp_requests_purpose ON public.otp_requests USING btree (purpose) WHERE (purpose IS NOT NULL);
CREATE INDEX idx_package_services_package_id ON public.package_services USING btree (package_id);
CREATE INDEX idx_package_services_service_id ON public.package_services USING btree (service_id);
CREATE INDEX idx_package_usage_service ON public.package_subscription_usage USING btree (service_id);
CREATE INDEX idx_package_usage_subscription ON public.package_subscription_usage USING btree (subscription_id);
CREATE INDEX idx_package_subscriptions_customer ON public.package_subscriptions USING btree (customer_id, status);
CREATE INDEX idx_package_subscriptions_package ON public.package_subscriptions USING btree (package_id);
CREATE INDEX idx_package_subscriptions_tenant ON public.package_subscriptions USING btree (tenant_id);
CREATE INDEX idx_reviews_approved ON public.reviews USING btree (is_approved, is_visible);
CREATE INDEX idx_reviews_customer_id ON public.reviews USING btree (customer_id);
CREATE INDEX idx_reviews_service_id ON public.reviews USING btree (service_id);
CREATE INDEX idx_reviews_tenant_id ON public.reviews USING btree (tenant_id);
CREATE INDEX idx_service_categories_tenant_id ON public.service_categories USING btree (tenant_id);
CREATE INDEX idx_service_offers_is_active ON public.service_offers USING btree (is_active);
CREATE INDEX idx_service_offers_service_id ON public.service_offers USING btree (service_id);
CREATE INDEX idx_service_offers_tenant_id ON public.service_offers USING btree (tenant_id);
CREATE INDEX idx_service_packages_active ON public.service_packages USING btree (tenant_id, is_active);
CREATE INDEX idx_service_packages_tenant_id ON public.service_packages USING btree (tenant_id);
CREATE INDEX idx_services_capacity_mode ON public.services USING btree (capacity_mode);
CREATE INDEX idx_services_category_id ON public.services USING btree (category_id);
CREATE INDEX idx_services_is_public ON public.services USING btree (is_public) WHERE (is_public = true);
CREATE INDEX idx_services_tenant_id ON public.services USING btree (tenant_id);
CREATE INDEX idx_shifts_service_id ON public.shifts USING btree (service_id);
CREATE INDEX idx_shifts_tenant_id ON public.shifts USING btree (tenant_id);
CREATE INDEX idx_slots_date ON public.slots USING btree (slot_date);
CREATE INDEX idx_slots_employee_id ON public.slots USING btree (employee_id);
CREATE INDEX idx_slots_overbooked ON public.slots USING btree (is_overbooked) WHERE (is_overbooked = true);
CREATE INDEX idx_slots_shift_id ON public.slots USING btree (shift_id);
CREATE INDEX idx_slots_tenant_id ON public.slots USING btree (tenant_id);
CREATE INDEX idx_tenant_zoho_configs_active ON public.tenant_zoho_configs USING btree (tenant_id, is_active);
CREATE INDEX idx_tenant_zoho_configs_tenant_id ON public.tenant_zoho_configs USING btree (tenant_id);
CREATE INDEX idx_tenants_slug ON public.tenants USING btree (slug);
CREATE INDEX idx_time_slots_available ON public.time_slots USING btree (is_available) WHERE (is_available = true);
CREATE INDEX idx_time_slots_service_id ON public.time_slots USING btree (service_id);
CREATE INDEX idx_time_slots_start_time ON public.time_slots USING btree (start_time_utc);
CREATE INDEX idx_time_slots_tenant_id ON public.time_slots USING btree (tenant_id);
CREATE INDEX idx_users_capacity ON public.users USING btree (capacity_per_slot);
CREATE INDEX idx_users_password_hash ON public.users USING btree (password_hash) WHERE (password_hash IS NOT NULL);
CREATE INDEX idx_users_role ON public.users USING btree (role);
CREATE INDEX idx_users_tenant_id ON public.users USING btree (tenant_id);
CREATE INDEX idx_users_username ON public.users USING btree (username);
CREATE INDEX idx_zoho_invoice_logs_booking_id ON public.zoho_invoice_logs USING btree (booking_id);
CREATE INDEX idx_zoho_invoice_logs_created_at ON public.zoho_invoice_logs USING btree (created_at);
CREATE INDEX idx_zoho_invoice_logs_status ON public.zoho_invoice_logs USING btree (status);
CREATE INDEX idx_zoho_invoice_logs_tenant_id ON public.zoho_invoice_logs USING btree (tenant_id);
CREATE INDEX idx_zoho_tokens_expires_at ON public.zoho_tokens USING btree (expires_at);
CREATE INDEX idx_zoho_tokens_tenant_id ON public.zoho_tokens USING btree (tenant_id);

-- ============================================================================
-- 6. CREATE FOREIGN KEY CONSTRAINTS
-- ============================================================================

ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE audit_logs ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE booking_locks ADD CONSTRAINT booking_locks_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE CASCADE;
ALTER TABLE bookings ADD CONSTRAINT bookings_checked_in_by_user_id_fkey FOREIGN KEY (checked_in_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_created_by_user_id_fkey FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_offer_id_fkey FOREIGN KEY (offer_id) REFERENCES service_offers(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_package_id_fkey FOREIGN KEY (package_id) REFERENCES service_packages(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_qr_scanned_by_user_id_fkey FOREIGN KEY (qr_scanned_by_user_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE bookings ADD CONSTRAINT bookings_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE bookings ADD CONSTRAINT bookings_slot_id_fkey FOREIGN KEY (slot_id) REFERENCES slots(id) ON DELETE RESTRICT;
ALTER TABLE bookings ADD CONSTRAINT bookings_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE customers ADD CONSTRAINT customers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE employee_services ADD CONSTRAINT employee_services_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE employee_services ADD CONSTRAINT employee_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE employee_services ADD CONSTRAINT employee_services_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
ALTER TABLE employee_services ADD CONSTRAINT employee_services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE package_services ADD CONSTRAINT package_services_package_id_fkey FOREIGN KEY (package_id) REFERENCES service_packages(id) ON DELETE CASCADE;
ALTER TABLE package_services ADD CONSTRAINT package_services_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE package_subscription_usage ADD CONSTRAINT package_subscription_usage_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE package_subscription_usage ADD CONSTRAINT package_subscription_usage_subscription_id_fkey FOREIGN KEY (subscription_id) REFERENCES package_subscriptions(id) ON DELETE CASCADE;
ALTER TABLE package_subscriptions ADD CONSTRAINT package_subscriptions_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE CASCADE;
ALTER TABLE package_subscriptions ADD CONSTRAINT package_subscriptions_package_id_fkey FOREIGN KEY (package_id) REFERENCES service_packages(id) ON DELETE RESTRICT;
ALTER TABLE package_subscriptions ADD CONSTRAINT package_subscriptions_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
ALTER TABLE payments ADD CONSTRAINT payments_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE reviews ADD CONSTRAINT reviews_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL;
ALTER TABLE reviews ADD CONSTRAINT reviews_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE reviews ADD CONSTRAINT reviews_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE reviews ADD CONSTRAINT reviews_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE service_categories ADD CONSTRAINT service_categories_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE service_offers ADD CONSTRAINT service_offers_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE service_offers ADD CONSTRAINT service_offers_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE service_packages ADD CONSTRAINT service_packages_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE services ADD CONSTRAINT services_assigned_employee_id_fkey FOREIGN KEY (assigned_employee_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE services ADD CONSTRAINT services_category_id_fkey FOREIGN KEY (category_id) REFERENCES service_categories(id) ON DELETE SET NULL;
ALTER TABLE services ADD CONSTRAINT services_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE shifts ADD CONSTRAINT shifts_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE shifts ADD CONSTRAINT shifts_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE slots ADD CONSTRAINT slots_employee_id_fkey FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE slots ADD CONSTRAINT slots_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
ALTER TABLE slots ADD CONSTRAINT slots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE sms_logs ADD CONSTRAINT sms_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tenant_features ADD CONSTRAINT tenant_features_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE tenant_zoho_configs ADD CONSTRAINT tenant_zoho_configs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE time_slots ADD CONSTRAINT time_slots_service_id_fkey FOREIGN KEY (service_id) REFERENCES services(id) ON DELETE CASCADE;
ALTER TABLE time_slots ADD CONSTRAINT time_slots_shift_id_fkey FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE CASCADE;
ALTER TABLE time_slots ADD CONSTRAINT time_slots_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE users ADD CONSTRAINT users_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE zoho_invoice_logs ADD CONSTRAINT zoho_invoice_logs_booking_id_fkey FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE;
ALTER TABLE zoho_invoice_logs ADD CONSTRAINT zoho_invoice_logs_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;
ALTER TABLE zoho_tokens ADD CONSTRAINT zoho_tokens_tenant_id_fkey FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE;

-- ============================================================================
-- 7. CREATE FUNCTIONS
-- ============================================================================

-- Note: Functions are included in a separate section due to their complexity
-- See the original export for complete function definitions

-- ============================================================================
-- 8. CREATE TRIGGERS
-- ============================================================================

-- Note: Triggers depend on functions, so functions must be created first
-- See the original export for complete trigger definitions

-- ============================================================================
-- END OF SCHEMA EXPORT
-- ============================================================================
