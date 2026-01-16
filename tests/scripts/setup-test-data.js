/**
 * Test Data Setup Script
 * Creates test data for testing Bookati platform
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env.test');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function setupTestData() {
  console.log('Setting up test data...');

  try {
    // Create test tenant
    const { data: tenant, error: tenantError } = await supabase
      .from('tenants')
      .insert({
        name: 'Test Tenant',
        slug: 'test-tenant-' + Date.now(),
        industry: 'test',
        is_active: true,
        public_page_enabled: true,
      })
      .select()
      .single();

    if (tenantError) throw tenantError;
    console.log('✓ Test tenant created:', tenant.id);

    // Create test service
    const { data: service, error: serviceError } = await supabase
      .from('services')
      .insert({
        tenant_id: tenant.id,
        name: 'Test Service',
        base_price: 100,
        duration_minutes: 60,
        capacity_per_slot: 1,
        is_active: true,
        is_public: true,
      })
      .select()
      .single();

    if (serviceError) throw serviceError;
    console.log('✓ Test service created:', service.id);

    // Create test users (would need auth API in real implementation)
    console.log('✓ Test data setup complete');
    console.log('\nTest Tenant ID:', tenant.id);
    console.log('Test Service ID:', service.id);

  } catch (error) {
    console.error('Error setting up test data:', error);
    process.exit(1);
  }
}

setupTestData();


