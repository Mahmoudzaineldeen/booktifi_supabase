/*
  # Add Indexes for Receptionist Package Management
  
  Adds indexes to optimize search queries for:
  - Package search by name
  - Subscriber search by customer name/phone
  - Subscriber search by package name
  - Subscriber search by service name
*/

-- Ensure pg_trgm extension exists (required for text search indexes)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  END IF;
END $$;

-- Indexes for package name search (separate indexes for each column)
-- These support ILIKE queries with wildcards
CREATE INDEX IF NOT EXISTS idx_service_packages_name_search 
  ON service_packages USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_service_packages_name_ar_search 
  ON service_packages USING gin (name_ar gin_trgm_ops);

-- Indexes for customer name/phone search (separate indexes for each column)
CREATE INDEX IF NOT EXISTS idx_customers_name_search 
  ON customers USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_customers_phone_search 
  ON customers USING gin (phone gin_trgm_ops);

-- Index for package subscriptions tenant + status (for fast filtering)
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_tenant_status_active 
  ON package_subscriptions(tenant_id, status, is_active) 
  WHERE status = 'active' AND is_active = true;

-- Index for package subscription usage with service names (for service search)
CREATE INDEX IF NOT EXISTS idx_package_usage_subscription_service 
  ON package_subscription_usage(subscription_id, service_id);

-- Composite index for subscriber search performance
CREATE INDEX IF NOT EXISTS idx_package_subscriptions_tenant_customer 
  ON package_subscriptions(tenant_id, customer_id, status, is_active);

-- Additional index for service name search in services table
CREATE INDEX IF NOT EXISTS idx_services_name_search 
  ON services USING gin (name gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_services_name_ar_search 
  ON services USING gin (name_ar gin_trgm_ops);
