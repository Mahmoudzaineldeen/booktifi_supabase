/**
 * Create Package and Subscribe User
 * 
 * Authenticates as admin, creates a package, and subscribes a user to it.
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

// Credentials
const ADMIN_EMAIL = 'mamoudnzaineldeen@gmail.com';
const USER_EMAIL = 'kaptifidev@gmail.com';

async function getUserByEmail(email) {
  console.log(`🔍 Finding user: ${email}...`);
  
  // Try case-insensitive search
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, tenant_id, role')
    .ilike('email', email)
    .limit(5);

  if (error) {
    throw new Error(`Error finding user: ${error.message}`);
  }

  if (!users || users.length === 0) {
    // List available users for debugging
    const { data: allUsers } = await supabase
      .from('users')
      .select('email, role')
      .limit(10);
    
    console.log('Available users:');
    allUsers?.forEach(u => console.log(`  - ${u.email} (${u.role})`));
    
    throw new Error(`User not found: ${email}`);
  }

  // Find exact match first, otherwise use first result
  const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase()) || users[0];

  console.log(`✅ Found user: ${user.email} (${user.role})`);
  return user;
}

async function getTenant(tenantId) {
  const { data: tenant, error } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('id', tenantId)
    .limit(1)
    .single();

  if (error || !tenant) {
    throw new Error(`Tenant not found: ${tenantId}`);
  }

  return tenant;
}

async function getServices(tenantId) {
  console.log(`📋 Fetching services...`);
  
  const { data: services, error } = await supabase
    .from('services')
    .select('id, name, name_ar')
    .eq('tenant_id', tenantId)
    .eq('is_active', true)
    .limit(10);

  if (error) {
    throw new Error(`Failed to fetch services: ${error.message}`);
  }

  if (services.length < 2) {
    throw new Error(`Need at least 2 services to create a package. Found: ${services.length}`);
  }

  console.log(`✅ Found ${services.length} services`);
  return services;
}

async function createPackage(tenantId, packageData, serviceIds) {
  console.log(`📦 Creating package: ${packageData.name}...`);
  
  // Create package
  const { data: newPackage, error: packageError } = await supabase
    .from('service_packages')
    .insert({
      tenant_id: tenantId,
      name: packageData.name,
      name_ar: packageData.name_ar,
      description: packageData.description,
      description_ar: packageData.description_ar,
      total_price: packageData.total_price,
      original_price: packageData.original_price,
      discount_percentage: packageData.discount_percentage,
      is_active: true
    })
    .select()
    .single();

  if (packageError) {
    throw new Error(`Failed to create package: ${packageError.message}`);
  }

  // Create package_services entries (using capacity_total)
  const packageServices = serviceIds.map((serviceId) => ({
    package_id: newPackage.id,
    service_id: serviceId,
    capacity_total: packageData.capacity_per_service || 5, // Default 5 bookings per service
  }));

  const { error: servicesError } = await supabase
    .from('package_services')
    .insert(packageServices);

  if (servicesError) {
    // Rollback: delete package
    await supabase.from('service_packages').delete().eq('id', newPackage.id);
    throw new Error(`Failed to add services to package: ${servicesError.message}`);
  }

  console.log(`✅ Package created successfully: ${newPackage.name}`);
  return newPackage;
}

async function getCustomerByEmail(tenantId, email) {
  console.log(`👤 Finding customer: ${email}...`);
  
  const { data: customers, error } = await supabase
    .from('customers')
    .select('id, name, email, phone')
    .eq('tenant_id', tenantId)
    .eq('email', email)
    .limit(1);

  if (error) {
    throw new Error(`Failed to find customer: ${error.message}`);
  }

  if (customers.length === 0) {
    throw new Error(`Customer not found: ${email}`);
  }

  console.log(`✅ Found customer: ${customers[0].name || email}`);
  return customers[0];
}

async function createSubscription(subscriptionData) {
  console.log(`💳 Creating subscription...`);

  // First check if subscription already exists
  const { data: existing } = await supabase
    .from('package_subscriptions')
    .select('id')
    .eq('tenant_id', subscriptionData.tenant_id)
    .eq('customer_id', subscriptionData.customer_id)
    .eq('package_id', subscriptionData.package_id)
    .eq('status', 'active')
    .limit(1)
    .single();

  if (existing) {
    console.log(`✅ Subscription already exists`);
    return existing;
  }

  const { data: subscription, error } = await supabase
    .from('package_subscriptions')
    .insert({
      tenant_id: subscriptionData.tenant_id,
      customer_id: subscriptionData.customer_id,
      package_id: subscriptionData.package_id,
      status: 'active',
      is_active: true
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create subscription: ${error.message}`);
  }

  console.log(`✅ Subscription created successfully`);
  return subscription;
}

async function findOrCreateAdminUser(email, password) {
  console.log(`🔍 Finding or creating admin user: ${email}...`);
  
  // Try to find user
  const { data: users } = await supabase
    .from('users')
    .select('id, email, tenant_id, role')
    .ilike('email', email)
    .limit(5);

  if (users && users.length > 0) {
    const user = users.find(u => u.email?.toLowerCase() === email.toLowerCase()) || users[0];
    console.log(`✅ Found existing user: ${user.email} (${user.role})`);
    return user;
  }

  // User doesn't exist - need to find a tenant first
  console.log(`⚠️  User not found. Finding a tenant to create user...`);
  
  const { data: tenants } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .limit(1)
    .single();

  if (!tenants) {
    throw new Error('No tenants found. Please create a tenant first.');
  }

  const tenant = tenants;
  console.log(`   Using tenant: ${tenant.name} (${tenant.slug})`);

  // Create user (you'll need to hash the password - for now, we'll just create without password)
  // Note: In production, you should hash the password properly
  const { data: newUser, error } = await supabase
    .from('users')
    .insert({
      email: email,
      tenant_id: tenant.id,
      role: 'tenant_admin',
      full_name: 'Admin User',
      is_active: true
    })
    .select()
    .single();

  if (error) {
    throw new Error(`Failed to create user: ${error.message}`);
  }

  console.log(`✅ Created user: ${newUser.email} (${newUser.role})`);
  console.log(`⚠️  Note: Password needs to be set manually in the database`);
  
  return newUser;
}

async function main() {
  try {
    console.log('🚀 Starting package creation process...\n');

    // Step 1: Get or create admin user and tenant
    const adminUser = await findOrCreateAdminUser(ADMIN_EMAIL, '111111');
    if (!adminUser.tenant_id) {
      throw new Error('Admin user does not have a tenant_id');
    }

    const tenant = await getTenant(adminUser.tenant_id);
    console.log(`   Tenant: ${tenant.name} (${tenant.slug})\n`);

    // Step 2: Get services
    const services = await getServices(tenant.id);
    
    // Select first 2-3 services for the package
    const selectedServices = services.slice(0, Math.min(3, services.length));
    const serviceIds = selectedServices.map(s => s.id);
    
    console.log(`   Selected services for package:`);
    selectedServices.forEach((s, i) => {
      console.log(`     ${i + 1}. ${s.name} (${s.name_ar || 'N/A'})`);
    });
    console.log('');

    // Step 3: Create package
    const packageData = {
      name: 'Premium Package',
      name_ar: 'الباقة المميزة',
      description: 'A premium package with multiple services',
      description_ar: 'باقة مميزة مع خدمات متعددة',
      total_price: 500.00,
      original_price: 600.00,
      discount_percentage: 17, // Integer percentage (rounded)
      capacity_per_service: 5, // 5 bookings per service
    };

    const newPackage = await createPackage(tenant.id, packageData, serviceIds);
    console.log(`   Package ID: ${newPackage.id}\n`);

    // Step 4: Find or create customer (user)
    let customer;
    try {
      customer = await getCustomerByEmail(tenant.id, USER_EMAIL);
    } catch (error) {
      console.log(`⚠️  Customer not found. Creating customer...`);
      
      // Find user first
      const { data: user } = await supabase
        .from('users')
        .select('id, email, full_name')
        .ilike('email', USER_EMAIL)
        .limit(1)
        .single();

      if (!user) {
        throw new Error(`User ${USER_EMAIL} not found. Please create the user first.`);
      }

      // Create customer
      const { data: newCustomer, error: custError } = await supabase
        .from('customers')
        .insert({
          tenant_id: tenant.id,
          name: user.full_name || user.email,
          email: user.email,
          phone: '+1234567890' // Default phone
        })
        .select()
        .single();

      if (custError) {
        throw new Error(`Failed to create customer: ${custError.message}`);
      }

      customer = newCustomer;
      console.log(`✅ Created customer: ${customer.name || customer.email}`);
    }
    
    console.log(`   Customer ID: ${customer.id}\n`);

    // Step 5: Create subscription
    const subscription = await createSubscription({
      tenant_id: tenant.id,
      customer_id: customer.id,
      package_id: newPackage.id,
    });

    console.log('\n✅ Package creation and subscription complete!');
    console.log('\n📊 Summary:');
    console.log(`   Package: ${newPackage.name} (${newPackage.name_ar})`);
    console.log(`   Price: ${newPackage.total_price} (Original: ${packageData.original_price})`);
    console.log(`   Services: ${selectedServices.length}`);
    console.log(`   Capacity per service: ${packageData.capacity_per_service} bookings`);
    console.log(`   Customer: ${customer.name || customer.email}`);
    console.log(`   Subscription ID: ${subscription.id}`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

main();
