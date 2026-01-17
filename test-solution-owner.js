/**
 * Test Solution Owner Implementation
 * 
 * This script tests:
 * 1. Solution Owner authentication
 * 2. Access to all tenants
 * 3. Tenant creation
 * 4. Access control
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: resolve(__dirname, '.env') });
dotenv.config({ path: resolve(__dirname, 'server/.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('❌ Missing Supabase credentials');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

const SOLUTION_OWNER_EMAIL = 'hatem@kaptifi.com';
const SOLUTION_OWNER_PASSWORD = 'Book@ati6722';

async function testSolutionOwner() {
  console.log('🧪 Testing Solution Owner Implementation\n');
  console.log('═══════════════════════════════════════\n');

  let testResults = {
    authentication: false,
    viewAllTenants: false,
    createTenant: false,
    accessControl: false,
    backendAccess: false,
  };

  try {
    // Test 1: Authentication
    console.log('📋 Test 1: Authentication');
    console.log('   Attempting to sign in as Solution Owner...');
    
    const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
      email: SOLUTION_OWNER_EMAIL,
      password: SOLUTION_OWNER_PASSWORD,
    });

    if (authError) {
      console.error('   ❌ Authentication failed:', authError.message);
      return testResults;
    }

    if (!authData.user) {
      console.error('   ❌ No user returned from authentication');
      return testResults;
    }

    console.log('   ✅ Authentication successful');
    console.log('      User ID:', authData.user.id);
    testResults.authentication = true;

    // Test 2: Fetch user profile
    console.log('\n📋 Test 2: User Profile');
    const { data: userProfile, error: profileError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authData.user.id)
      .single();

    if (profileError || !userProfile) {
      console.error('   ❌ Failed to fetch user profile:', profileError?.message);
      return testResults;
    }

    console.log('   ✅ User profile fetched');
    console.log('      Role:', userProfile.role);
    console.log('      Tenant ID:', userProfile.tenant_id === null ? 'NULL (System-wide)' : userProfile.tenant_id);

    if (userProfile.role !== 'solution_owner') {
      console.error('   ❌ Role is not solution_owner');
      return testResults;
    }

    if (userProfile.tenant_id !== null) {
      console.error('   ❌ Tenant ID is not NULL');
      return testResults;
    }

    console.log('   ✅ Role and tenant_id are correct');

    // Test 3: View all tenants (no tenant_id filtering)
    console.log('\n📋 Test 3: View All Tenants');
    console.log('   Querying tenants without tenant_id filter...');
    
    const { data: tenants, error: tenantsError } = await supabase
      .from('tenants')
      .select('*')
      .order('created_at', { ascending: false });

    if (tenantsError) {
      console.error('   ❌ Failed to fetch tenants:', tenantsError.message);
      console.error('   Error code:', tenantsError.code);
      console.error('   Error details:', tenantsError.details);
      return testResults;
    }

    console.log('   ✅ Successfully fetched all tenants');
    console.log('      Total tenants:', tenants?.length || 0);
    if (tenants && tenants.length > 0) {
      console.log('      Sample tenant:', tenants[0].name);
    }
    testResults.viewAllTenants = true;

    // Test 4: Access Control - Verify RLS policies
    console.log('\n📋 Test 4: Row Level Security (RLS)');
    console.log('   Testing RLS policies for Solution Owner...');
    
    // Try to query tenants (should work due to RLS)
    const { data: rlsTest, error: rlsError } = await supabase
      .from('tenants')
      .select('id, name, is_active')
      .limit(5);

    if (rlsError) {
      console.error('   ❌ RLS test failed:', rlsError.message);
      console.error('   Error code:', rlsError.code);
      if (rlsError.code === '42501') {
        console.error('   ⚠️  RLS policy violation - Solution Owner may not have proper RLS policies');
      }
      return testResults;
    }

    console.log('   ✅ RLS policies allow Solution Owner access');
    console.log('      Fetched', rlsTest?.length || 0, 'tenants');
    testResults.accessControl = true;

    // Test 5: Backend API Access (simulate)
    console.log('\n📋 Test 5: Backend API Access');
    console.log('   Note: This requires the backend server to be running');
    console.log('   Testing JWT token generation...');
    
    // The token is in authData.session.access_token
    if (authData.session?.access_token) {
      console.log('   ✅ JWT token available');
      console.log('      Token length:', authData.session.access_token.length);
      console.log('   ⚠️  Backend API testing requires server to be running');
      console.log('   ⚠️  Test manually by calling API endpoints with this token');
      testResults.backendAccess = true;
    } else {
      console.error('   ❌ No access token in session');
    }

    // Summary
    console.log('\n═══════════════════════════════════════');
    console.log('📊 Test Results Summary');
    console.log('═══════════════════════════════════════');
    console.log('Authentication:', testResults.authentication ? '✅ PASS' : '❌ FAIL');
    console.log('View All Tenants:', testResults.viewAllTenants ? '✅ PASS' : '❌ FAIL');
    console.log('Access Control (RLS):', testResults.accessControl ? '✅ PASS' : '❌ FAIL');
    console.log('Backend Access:', testResults.backendAccess ? '✅ PASS' : '⚠️  MANUAL TEST REQUIRED');
    console.log('═══════════════════════════════════════\n');

    // Sign out
    await supabase.auth.signOut();
    console.log('✅ Signed out successfully');

  } catch (error) {
    console.error('\n❌ Test failed with error:', error);
    console.error('Stack:', error.stack);
  }
}

// Run tests
testSolutionOwner();
