import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase credentials in .env file');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function checkUsersAndAuthStatus() {
  console.log('='.repeat(80));
  console.log('CHECKING USERS AND AUTH STATUS');
  console.log('='.repeat(80));

  // Check public.users table
  console.log('\n1. Checking public.users table:');
  const { data: users, error: usersError } = await supabase
    .from('users')
    .select('id, email, full_name, role, tenant_id, is_active')
    .order('created_at', { ascending: false })
    .limit(10);

  if (usersError) {
    console.error('Error fetching users:', usersError);
  } else {
    console.log(`Found ${users.length} users in public.users table:`);
    users.forEach((user, i) => {
      console.log(`  ${i + 1}. ${user.email} (${user.role}) - Tenant: ${user.tenant_id} - Active: ${user.is_active}`);
      console.log(`     ID: ${user.id}`);
    });
  }

  // Check tenants table
  console.log('\n2. Checking tenants table:');
  const { data: tenants, error: tenantsError } = await supabase
    .from('tenants')
    .select('id, name, name_arabic, slug, is_active')
    .order('created_at', { ascending: false })
    .limit(10);

  if (tenantsError) {
    console.error('Error fetching tenants:', tenantsError);
  } else {
    console.log(`Found ${tenants.length} tenants:`);
    tenants.forEach((tenant, i) => {
      console.log(`  ${i + 1}. ${tenant.name} (${tenant.name_arabic}) - Slug: ${tenant.slug} - Active: ${tenant.is_active}`);
      console.log(`     ID: ${tenant.id}`);
    });
  }

  // Test tenant insertion
  console.log('\n3. Testing tenant insertion (will rollback):');
  const testSlug = 'test-tenant-' + Date.now();
  const { data: testTenant, error: testError } = await supabase
    .from('tenants')
    .insert({
      name: 'Test Tenant',
      name_arabic: 'اختبار',
      slug: testSlug,
      industry: 'testing',
      contact_email: 'test@example.com',
      contact_phone: '+1234567890',
      is_active: true,
      public_page_enabled: true,
    })
    .select()
    .single();

  if (testError) {
    console.error('❌ Failed to insert test tenant:', testError);
    console.error('Error details:', JSON.stringify(testError, null, 2));
  } else {
    console.log('✅ Successfully inserted test tenant:', testTenant.id);
    // Clean up
    await supabase.from('tenants').delete().eq('id', testTenant.id);
    console.log('✅ Cleaned up test tenant');
  }

  // Check RLS policies
  console.log('\n4. Checking if we can query without authentication:');
  const { data: publicTenants, error: publicError } = await supabase
    .from('tenants')
    .select('id, name')
    .limit(1);

  if (publicError) {
    console.error('❌ Cannot query tenants without auth:', publicError.message);
  } else {
    console.log('✅ Can query tenants without auth');
  }

  console.log('\n' + '='.repeat(80));
  console.log('DIAGNOSIS COMPLETE');
  console.log('='.repeat(80));
}

checkUsersAndAuthStatus().catch(console.error);
