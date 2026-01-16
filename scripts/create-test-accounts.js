#!/usr/bin/env node

/**
 * Create Test Accounts Script
 * 
 * Creates:
 * - 100 customer accounts (password: 111111)
 * - 2 receptionist accounts (password: 111111)
 * - Verifies service provider account exists
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import { createClient } from '@supabase/supabase-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('❌ Missing Supabase configuration');
  console.error('   SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
  console.error('   SUPABASE_SERVICE_ROLE_KEY:', supabaseKey ? 'Set' : 'Missing');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const PASSWORD = '111111';
const PASSWORD_HASH = await bcrypt.hash(PASSWORD, 10);

async function verifyServiceProvider() {
  console.log('\n🔍 Verifying service provider account...\n');
  
  const { data: users, error } = await supabase
    .from('users')
    .select('id, email, username, full_name, role, tenant_id')
    .eq('email', 'mahmoudnzaineldeen@gmail.com')
    .maybeSingle();
  
  if (error) {
    console.error('❌ Error checking service provider:', error);
    return null;
  }
  
  if (!users) {
    console.log('⚠️  Service provider account not found');
    console.log('   Email: mahmoudnzaineldeen@gmail.com');
    return null;
  }
  
  console.log('✅ Service provider account found:');
  console.log(`   ID: ${users.id}`);
  console.log(`   Email: ${users.email}`);
  console.log(`   Role: ${users.role}`);
  console.log(`   Tenant ID: ${users.tenant_id}`);
  
  // Get tenant info
  if (users.tenant_id) {
    const { data: tenant } = await supabase
      .from('tenants')
      .select('id, name, slug')
      .eq('id', users.tenant_id)
      .maybeSingle();
    
    if (tenant) {
      console.log(`   Tenant: ${tenant.name} (${tenant.slug})`);
      return { user: users, tenant };
    }
  }
  
  return { user: users, tenant: null };
}

async function createCustomers(tenantId, count = 100) {
  console.log(`\n👥 Creating ${count} customer accounts...\n`);
  
  const customers = [];
  const errors = [];
  
  for (let i = 1; i <= count; i++) {
    const email = `customer${i}@test.bookati.com`;
    const phone = `+2010000000${String(i).padStart(3, '0')}`;
    const fullName = `Customer ${i}`;
    
    try {
      // Check if customer already exists
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .eq('email', email)
        .maybeSingle();
      
      if (existing) {
        console.log(`   ⏭️  Customer ${i} already exists, skipping...`);
        continue;
      }
      
      // Create customer user
      const { data: user, error: userError } = await supabase
        .from('users')
        .insert({
          email,
          phone,
          full_name: fullName,
          role: 'customer',
          tenant_id: tenantId,
          password_hash: PASSWORD_HASH,
          is_active: true,
        })
        .select()
        .single();
      
      if (userError) {
        errors.push({ customer: i, error: userError.message });
        console.log(`   ❌ Failed to create customer ${i}: ${userError.message}`);
        continue;
      }
      
      // Create customer record
      const { error: customerError } = await supabase
        .from('customers')
        .upsert({
          tenant_id: tenantId,
          phone,
          name: fullName,
          email,
        }, {
          onConflict: 'tenant_id,phone'
        });
      
      if (customerError) {
        console.log(`   ⚠️  Customer ${i} user created but customer record failed: ${customerError.message}`);
      }
      
      customers.push(user);
      
      if (i % 10 === 0) {
        console.log(`   ✅ Created ${i}/${count} customers...`);
      }
    } catch (error) {
      errors.push({ customer: i, error: error.message });
      console.log(`   ❌ Error creating customer ${i}: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Created ${customers.length}/${count} customer accounts`);
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} errors occurred`);
  }
  
  return { customers, errors };
}

async function createReceptionists(tenantId, count = 2) {
  console.log(`\n👔 Creating ${count} receptionist accounts...\n`);
  
  const receptionists = [];
  const errors = [];
  
  for (let i = 1; i <= count; i++) {
    const username = `receptionist${i}`;
    const email = `${username}@test.bookati.com`;
    const fullName = `Receptionist ${i}`;
    
    try {
      // Check if receptionist already exists
      const { data: existing } = await supabase
        .from('users')
        .select('id')
        .or(`username.eq.${username},email.eq.${email}`)
        .maybeSingle();
      
      if (existing) {
        console.log(`   ⏭️  Receptionist ${i} already exists, skipping...`);
        continue;
      }
      
      // Create receptionist
      const { data: user, error: userError } = await supabase
        .from('users')
        .insert({
          username,
          email,
          full_name: fullName,
          role: 'receptionist',
          tenant_id: tenantId,
          password_hash: PASSWORD_HASH,
          is_active: true,
        })
        .select()
        .single();
      
      if (userError) {
        errors.push({ receptionist: i, error: userError.message });
        console.log(`   ❌ Failed to create receptionist ${i}: ${userError.message}`);
        continue;
      }
      
      receptionists.push(user);
      console.log(`   ✅ Created receptionist ${i}: ${username}`);
    } catch (error) {
      errors.push({ receptionist: i, error: error.message });
      console.log(`   ❌ Error creating receptionist ${i}: ${error.message}`);
    }
  }
  
  console.log(`\n✅ Created ${receptionists.length}/${count} receptionist accounts`);
  if (errors.length > 0) {
    console.log(`   ⚠️  ${errors.length} errors occurred`);
  }
  
  return { receptionists, errors };
}

async function main() {
  console.log('🚀 Starting test account creation...\n');
  
  // Verify service provider
  const serviceProvider = await verifyServiceProvider();
  
  if (!serviceProvider) {
    console.error('\n❌ Service provider account not found!');
    console.error('   Please ensure the account exists before creating test accounts.');
    process.exit(1);
  }
  
  if (!serviceProvider.tenant) {
    console.error('\n❌ Service provider has no tenant!');
    console.error('   Cannot create test accounts without a tenant.');
    process.exit(1);
  }
  
  const tenantId = serviceProvider.tenant.id;
  const tenantSlug = serviceProvider.tenant.slug;
  
  console.log(`\n📋 Using tenant: ${serviceProvider.tenant.name} (${tenantSlug})\n`);
  
  // Create customers
  const { customers, errors: customerErrors } = await createCustomers(tenantId, 100);
  
  // Create receptionists
  const { receptionists, errors: receptionistErrors } = await createReceptionists(tenantId, 2);
  
  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('📊 SUMMARY');
  console.log('='.repeat(60));
  console.log(`✅ Service Provider: ${serviceProvider.user.email}`);
  console.log(`✅ Customers Created: ${customers.length}/100`);
  console.log(`✅ Receptionists Created: ${receptionists.length}/2`);
  console.log(`\n🔑 All accounts use password: ${PASSWORD}`);
  console.log(`\n📝 Test URLs:`);
  console.log(`   Service Provider: http://localhost:5173/${tenantSlug}/admin`);
  console.log(`   Receptionist: http://localhost:5173/${tenantSlug}/reception`);
  console.log(`   Customer Booking: http://localhost:5173/${tenantSlug}/book`);
  console.log(`   Customer Login: http://localhost:5173/${tenantSlug}/customer/login`);
  
  if (customerErrors.length > 0 || receptionistErrors.length > 0) {
    console.log(`\n⚠️  Errors occurred during creation. Check logs above.`);
  }
  
  console.log('\n✅ Test account creation complete!\n');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
