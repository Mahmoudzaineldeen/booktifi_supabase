/**
 * Create Test Data for Package Capacity System
 * 
 * Creates:
 * - Packages (single service and multiple services)
 * - Package subscriptions with various usage states
 * - Package subscription usage records
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variable is required');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function createTestData() {
  console.log('🚀 Creating test data for package capacity system...\n');

  try {
    // Step 1: Get a tenant
    const { data: tenants, error: tenantError } = await supabase
      .from('tenants')
      .select('id, slug')
      .limit(1);

    if (tenantError) throw tenantError;
    if (!tenants || tenants.length === 0) {
      throw new Error('No tenants found. Please create a tenant first.');
    }

    const tenant = tenants[0];
    console.log(`✅ Using tenant: ${tenant.slug} (${tenant.id})`);

    // Step 2: Get or create services
    let { data: services, error: servicesError } = await supabase
      .from('services')
      .select('id, name')
      .eq('tenant_id', tenant.id)
      .limit(5);

    if (servicesError) throw servicesError;

    // Create services if we don't have enough
    if (!services || services.length < 3) {
      console.log(`⚠️  Found ${services?.length || 0} services. Creating test services...`);
      
      const servicesToCreate = [
        { name: 'Test Service 1', name_ar: 'خدمة اختبار 1', duration_minutes: 60, service_duration_minutes: 60, base_price: 50.00 },
        { name: 'Test Service 2', name_ar: 'خدمة اختبار 2', duration_minutes: 90, service_duration_minutes: 90, base_price: 75.00 },
        { name: 'Test Service 3', name_ar: 'خدمة اختبار 3', duration_minutes: 45, service_duration_minutes: 45, base_price: 40.00 }
      ];

      for (const serviceData of servicesToCreate) {
        // Check if service already exists
        const { data: existing } = await supabase
          .from('services')
          .select('id, name')
          .eq('tenant_id', tenant.id)
          .eq('name', serviceData.name)
          .limit(1)
          .single();

        if (!existing) {
          const { data: newService, error: createError } = await supabase
            .from('services')
            .insert({
              tenant_id: tenant.id,
              name: serviceData.name,
              name_ar: serviceData.name_ar,
              duration_minutes: serviceData.duration_minutes,
              service_duration_minutes: serviceData.service_duration_minutes,
              base_price: serviceData.base_price,
              capacity_per_slot: 1,
              is_public: true,
              is_active: true
            })
            .select('id, name')
            .single();

          if (createError) {
            console.warn(`⚠️  Could not create service ${serviceData.name}:`, createError.message);
          } else {
            console.log(`✅ Created service: ${newService.name}`);
          }
        }
      }

      // Re-fetch services
      const { data: updatedServices, error: refetchError } = await supabase
        .from('services')
        .select('id, name')
        .eq('tenant_id', tenant.id)
        .limit(5);

      if (refetchError) throw refetchError;
      services = updatedServices;
    }

    if (!services || services.length < 2) {
      throw new Error('Need at least 2 services. Found: ' + (services?.length || 0));
    }

    console.log(`✅ Using ${services.length} services`);

    // Step 3: Get or create test customers
    let customer1, customer2, customer3;

    // Customer 1 - will have single service package
    const { data: existingCustomer1 } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('tenant_id', tenant.id)
      .eq('phone', '+12345678901')
      .limit(1)
      .single();

    if (existingCustomer1) {
      customer1 = existingCustomer1;
      console.log(`✅ Using existing customer 1: ${customer1.name}`);
    } else {
      const { data: newCustomer1, error: cust1Error } = await supabase
        .from('customers')
        .insert({
          tenant_id: tenant.id,
          name: 'Test Customer 1',
          phone: '+12345678901',
          email: 'test1@example.com'
        })
        .select()
        .single();

      if (cust1Error) throw cust1Error;
      customer1 = newCustomer1;
      console.log(`✅ Created customer 1: ${customer1.name}`);
    }

    // Customer 2 - will have multiple services package
    const { data: existingCustomer2 } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('tenant_id', tenant.id)
      .eq('phone', '+12345678902')
      .limit(1)
      .single();

    if (existingCustomer2) {
      customer2 = existingCustomer2;
      console.log(`✅ Using existing customer 2: ${customer2.name}`);
    } else {
      const { data: newCustomer2, error: cust2Error } = await supabase
        .from('customers')
        .insert({
          tenant_id: tenant.id,
          name: 'Test Customer 2',
          phone: '+12345678902',
          email: 'test2@example.com'
        })
        .select()
        .single();

      if (cust2Error) throw cust2Error;
      customer2 = newCustomer2;
      console.log(`✅ Created customer 2: ${customer2.name}`);
    }

    // Customer 3 - will have exhausted package
    const { data: existingCustomer3 } = await supabase
      .from('customers')
      .select('id, name, phone')
      .eq('tenant_id', tenant.id)
      .eq('phone', '+12345678903')
      .limit(1)
      .single();

    if (existingCustomer3) {
      customer3 = existingCustomer3;
      console.log(`✅ Using existing customer 3: ${customer3.name}`);
    } else {
      const { data: newCustomer3, error: cust3Error } = await supabase
        .from('customers')
        .insert({
          tenant_id: tenant.id,
          name: 'Test Customer 3',
          phone: '+12345678903',
          email: 'test3@example.com'
        })
        .select()
        .single();

      if (cust3Error) throw cust3Error;
      customer3 = newCustomer3;
      console.log(`✅ Created customer 3: ${customer3.name}`);
    }

    // Step 4: Create packages

    // Package 1: Single service package
    let package1;
    const { data: existingPkg1 } = await supabase
      .from('service_packages')
      .select('id, name')
      .eq('tenant_id', tenant.id)
      .eq('name', 'Test Package - Single Service')
      .limit(1)
      .single();

    if (existingPkg1) {
      package1 = existingPkg1;
      console.log(`✅ Using existing package 1: ${package1.name}`);
    } else {
      const { data: newPkg1, error: pkg1Error } = await supabase
        .from('service_packages')
        .insert({
          tenant_id: tenant.id,
          name: 'Test Package - Single Service',
          name_ar: 'باقة اختبار - خدمة واحدة',
          description: 'Test package with single service',
          total_price: 100.00,
          is_active: true
        })
        .select()
        .single();

      if (pkg1Error) throw pkg1Error;
      package1 = newPkg1;
      console.log(`✅ Created package 1: ${package1.name}`);
    }

    // Package 2: Multiple services package
    let package2;
    const { data: existingPkg2 } = await supabase
      .from('service_packages')
      .select('id, name')
      .eq('tenant_id', tenant.id)
      .eq('name', 'Test Package - Multiple Services')
      .limit(1)
      .single();

    if (existingPkg2) {
      package2 = existingPkg2;
      console.log(`✅ Using existing package 2: ${package2.name}`);
    } else {
      const { data: newPkg2, error: pkg2Error } = await supabase
        .from('service_packages')
        .insert({
          tenant_id: tenant.id,
          name: 'Test Package - Multiple Services',
          name_ar: 'باقة اختبار - خدمات متعددة',
          description: 'Test package with multiple services',
          total_price: 200.00,
          is_active: true
        })
        .select()
        .single();

      if (pkg2Error) throw pkg2Error;
      package2 = newPkg2;
      console.log(`✅ Created package 2: ${package2.name}`);
    }

    // Package 3: Exhausted package
    let package3;
    const { data: existingPkg3 } = await supabase
      .from('service_packages')
      .select('id, name')
      .eq('tenant_id', tenant.id)
      .eq('name', 'Test Package - Exhausted')
      .limit(1)
      .single();

    if (existingPkg3) {
      package3 = existingPkg3;
      console.log(`✅ Using existing package 3: ${package3.name}`);
    } else {
      const { data: newPkg3, error: pkg3Error } = await supabase
        .from('service_packages')
        .insert({
          tenant_id: tenant.id,
          name: 'Test Package - Exhausted',
          name_ar: 'باقة اختبار - مستنفذة',
          description: 'Test package that will be exhausted',
          total_price: 150.00,
          is_active: true
        })
        .select()
        .single();

      if (pkg3Error) throw pkg3Error;
      package3 = newPkg3;
      console.log(`✅ Created package 3: ${package3.name}`);
    }

    // Step 5: Add services to packages

    // Package 1: Single service (capacity: 5)
    const { error: ps1Error } = await supabase
      .from('package_services')
      .upsert({
        package_id: package1.id,
        service_id: services[0].id,
        capacity_total: 5
      }, {
        onConflict: 'package_id,service_id'
      });

    if (ps1Error) {
      throw ps1Error;
    }
    console.log(`✅ Package 1: Added service ${services[0].name} with capacity 5`);

    // Package 2: Multiple services (capacity: 3 each)
    for (let i = 0; i < Math.min(3, services.length); i++) {
      const { error: ps2Error } = await supabase
        .from('package_services')
        .upsert({
          package_id: package2.id,
          service_id: services[i].id,
          capacity_total: 3
        }, {
          onConflict: 'package_id,service_id'
        });

      if (ps2Error) {
        throw ps2Error;
      }
      console.log(`✅ Package 2: Added service ${services[i].name} with capacity 3`);
    }

    // Package 3: Single service (capacity: 2, will be exhausted)
    const { error: ps3Error } = await supabase
      .from('package_services')
      .upsert({
        package_id: package3.id,
        service_id: services[0].id,
        capacity_total: 2
      }, {
        onConflict: 'package_id,service_id'
      });

    if (ps3Error) {
      throw ps3Error;
    }
    console.log(`✅ Package 3: Added service ${services[0].name} with capacity 2`);

    // Step 6: Create subscriptions

    // Subscription 1: Customer 1 -> Package 1 (full capacity)
    // Check if exists first
    let sub1;
    const { data: existingSub1 } = await supabase
      .from('package_subscriptions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer1.id)
      .eq('package_id', package1.id)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingSub1) {
      sub1 = existingSub1;
      // Update to ensure is_active is true
      await supabase
        .from('package_subscriptions')
        .update({ is_active: true })
        .eq('id', sub1.id);
      console.log(`✅ Using existing subscription 1`);
    } else {
      const { data: newSub1, error: sub1Error } = await supabase
        .from('package_subscriptions')
        .insert({
          tenant_id: tenant.id,
          customer_id: customer1.id,
          package_id: package1.id,
          status: 'active',
          is_active: true
        })
        .select()
        .single();

      if (sub1Error) throw sub1Error;
      sub1 = newSub1;
      console.log(`✅ Created subscription 1: Customer 1 -> Package 1`);
    }

    // Subscription 2: Customer 2 -> Package 2 (partial usage)
    let sub2;
    const { data: existingSub2 } = await supabase
      .from('package_subscriptions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer2.id)
      .eq('package_id', package2.id)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingSub2) {
      sub2 = existingSub2;
      await supabase
        .from('package_subscriptions')
        .update({ is_active: true })
        .eq('id', sub2.id);
      console.log(`✅ Using existing subscription 2`);
    } else {
      const { data: newSub2, error: sub2Error } = await supabase
        .from('package_subscriptions')
        .insert({
          tenant_id: tenant.id,
          customer_id: customer2.id,
          package_id: package2.id,
          status: 'active',
          is_active: true
        })
        .select()
        .single();

      if (sub2Error) throw sub2Error;
      sub2 = newSub2;
      console.log(`✅ Created subscription 2: Customer 2 -> Package 2`);
    }

    // Subscription 3: Customer 3 -> Package 3 (exhausted)
    let sub3;
    const { data: existingSub3 } = await supabase
      .from('package_subscriptions')
      .select('id')
      .eq('tenant_id', tenant.id)
      .eq('customer_id', customer3.id)
      .eq('package_id', package3.id)
      .eq('status', 'active')
      .limit(1)
      .single();

    if (existingSub3) {
      sub3 = existingSub3;
      await supabase
        .from('package_subscriptions')
        .update({ is_active: true })
        .eq('id', sub3.id);
      console.log(`✅ Using existing subscription 3`);
    } else {
      const { data: newSub3, error: sub3Error } = await supabase
        .from('package_subscriptions')
        .insert({
          tenant_id: tenant.id,
          customer_id: customer3.id,
          package_id: package3.id,
          status: 'active',
          is_active: true
        })
        .select()
        .single();

      if (sub3Error) throw sub3Error;
      sub3 = newSub3;
      console.log(`✅ Created subscription 3: Customer 3 -> Package 3`);
    }

    // Step 7: Create package_subscription_usage records

    // Subscription 1: Full capacity (5 remaining, 0 used)
    const { error: usage1Error } = await supabase
      .from('package_subscription_usage')
      .upsert({
        subscription_id: sub1.id,
        service_id: services[0].id,
        original_quantity: 5,
        remaining_quantity: 5,
        used_quantity: 0
      }, {
        onConflict: 'subscription_id,service_id'
      });

    if (usage1Error) {
      throw usage1Error;
    }
    console.log(`✅ Subscription 1 usage: 5 remaining, 0 used`);

    // Subscription 2: Partial usage (1 remaining, 2 used) for first service
    const { error: usage2Error } = await supabase
      .from('package_subscription_usage')
      .upsert({
        subscription_id: sub2.id,
        service_id: services[0].id,
        original_quantity: 3,
        remaining_quantity: 1,
        used_quantity: 2
      }, {
        onConflict: 'subscription_id,service_id'
      });

    if (usage2Error) {
      throw usage2Error;
    }
    console.log(`✅ Subscription 2 usage (service 1): 1 remaining, 2 used`);

    // Subscription 2: Full capacity for second service
    if (services.length > 1) {
      const { error: usage2bError } = await supabase
        .from('package_subscription_usage')
        .upsert({
          subscription_id: sub2.id,
          service_id: services[1].id,
          original_quantity: 3,
          remaining_quantity: 3,
          used_quantity: 0
        }, {
          onConflict: 'subscription_id,service_id'
        });

      if (usage2bError) {
        throw usage2bError;
      }
      console.log(`✅ Subscription 2 usage (service 2): 3 remaining, 0 used`);
    }

    // Subscription 3: Exhausted (0 remaining, 2 used)
    const { error: usage3Error } = await supabase
      .from('package_subscription_usage')
      .upsert({
        subscription_id: sub3.id,
        service_id: services[0].id,
        original_quantity: 2,
        remaining_quantity: 0,
        used_quantity: 2
      }, {
        onConflict: 'subscription_id,service_id'
      });

    if (usage3Error) {
      throw usage3Error;
    }
    console.log(`✅ Subscription 3 usage: 0 remaining, 2 used (EXHAUSTED)`);

    // Step 8: Create exhaustion notification for manually exhausted capacity
    // (Notifications are normally created by triggers when bookings exhaust capacity,
    // but for testing we need to create one manually)
    const { error: notifError } = await supabase
      .from('package_exhaustion_notifications')
      .upsert({
        subscription_id: sub3.id,
        service_id: services[0].id
      }, {
        onConflict: 'subscription_id,service_id'
      });

    if (notifError) {
      console.warn(`⚠️  Could not create exhaustion notification:`, notifError.message);
    } else {
      console.log(`✅ Created exhaustion notification for subscription 3`);
    }

    console.log('\n✅ Test data creation complete!');
    console.log('\n📊 Summary:');
    console.log(`   - 3 packages created`);
    console.log(`   - 3 subscriptions created`);
    console.log(`   - Multiple usage records created`);
    console.log(`   - 1 exhausted capacity (for testing)`);

  } catch (error) {
    console.error('\n❌ Error creating test data:', error);
    console.error('Error details:', error.message);
    process.exit(1);
  }
}

createTestData();
