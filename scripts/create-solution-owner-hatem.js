/**
 * Create Solution Owner Admin User
 * Email: hatem@kaptifi.com
 * Password: Book@ati6722
 * Role: solution_owner
 * Tenant ID: NULL (system-wide access)
 */

import { createClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from multiple possible locations
dotenv.config({ path: resolve(__dirname, '../.env') });
dotenv.config({ path: resolve(__dirname, '../server/.env') });

// Try multiple environment variable names
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing Supabase credentials in .env file');
  console.error('Required: VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function createSolutionOwner() {
  console.log('🚀 Creating Solution Owner Admin User...\n');

  const email = 'hatem@kaptifi.com';
  const password = 'Book@ati6722';
  const fullName = 'Hatem - Solution Owner';
  const role = 'solution_owner';

  try {
    // Step 1: Check if user already exists in auth.users
    console.log('📋 Step 1: Checking if user already exists...');
    const { data: existingAuthUsers, error: listError } = await supabase.auth.admin.listUsers();

    if (listError) {
      console.error('❌ Error listing users:', listError);
      throw listError;
    }

    const existingAuthUser = existingAuthUsers.users.find(u => u.email === email);
    let authUserId;

    if (existingAuthUser) {
      console.log('✅ Auth user already exists');
      console.log('   Email:', existingAuthUser.email);
      console.log('   ID:', existingAuthUser.id);
      authUserId = existingAuthUser.id;

      // Update password to the new one
      console.log('\n🔑 Updating password...');
      const { error: updateError } = await supabase.auth.admin.updateUserById(
        authUserId,
        { password: password }
      );

      if (updateError) {
        console.error('❌ Error updating password:', updateError);
        throw updateError;
      }
      console.log('✅ Password updated successfully');
    } else {
      // Step 2: Create auth user
      console.log('📝 Creating new auth user...');
      const { data: authData, error: authError } = await supabase.auth.admin.createUser({
        email: email,
        password: password,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role: role
        }
      });

      if (authError) {
        console.error('❌ Error creating auth user:', authError);
        throw authError;
      }

      authUserId = authData.user.id;
      console.log('✅ Auth user created successfully');
      console.log('   Email:', email);
      console.log('   ID:', authUserId);
    }

    // Step 3: Check if profile exists in public.users
    console.log('\n📋 Step 2: Checking user profile...');
    const { data: existingProfile, error: profileCheckError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUserId)
      .maybeSingle();

    if (profileCheckError) {
      console.error('❌ Error checking profile:', profileCheckError);
      throw profileCheckError;
    }

    if (existingProfile) {
      console.log('✅ Profile exists, updating...');
      
      // Hash password for password_hash column
      console.log('   Hashing password...');
      const passwordHash = await bcrypt.hash(password, 10);
      
      const { error: updateError } = await supabase
        .from('users')
        .update({
          email: email,
          full_name: fullName,
          role: role,
          is_active: true,
          tenant_id: null,  // CRITICAL: Solution Owner has NULL tenant_id for system-wide access
          password_hash: passwordHash  // Store hashed password
        })
        .eq('id', authUserId);

      if (updateError) {
        console.error('❌ Error updating profile:', updateError);
        throw updateError;
      }
      console.log('✅ Profile updated successfully');
      console.log('   ⚠️  Verified: tenant_id is NULL (system-wide access)');
    } else {
      console.log('📝 Creating new profile...');
      
      // Hash password for password_hash column
      console.log('   Hashing password...');
      const passwordHash = await bcrypt.hash(password, 10);
      
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: authUserId,
          email: email,
          full_name: fullName,
          role: role,
          is_active: true,
          tenant_id: null,  // CRITICAL: Solution Owner has NULL tenant_id for system-wide access
          password_hash: passwordHash  // Store hashed password
        });

      if (insertError) {
        console.error('❌ Error creating profile:', insertError);
        throw insertError;
      }
      console.log('✅ Profile created successfully');
      console.log('   ⚠️  Verified: tenant_id is NULL (system-wide access)');
    }

    // Step 4: Verify the user
    console.log('\n📋 Step 3: Verifying user...');
    const { data: verifyData, error: verifyError } = await supabase
      .from('users')
      .select('*')
      .eq('id', authUserId)
      .single();

    if (verifyError) {
      console.error('❌ Error verifying user:', verifyError);
      throw verifyError;
    }

    // Step 5: Verify tenant_id is NULL
    if (verifyData.tenant_id !== null) {
      console.warn('⚠️  WARNING: tenant_id is not NULL! Updating to NULL...');
      const { error: fixError } = await supabase
        .from('users')
        .update({ tenant_id: null })
        .eq('id', authUserId);
      
      if (fixError) {
        console.error('❌ Error fixing tenant_id:', fixError);
        throw fixError;
      }
      console.log('✅ tenant_id fixed to NULL');
    }

    console.log('\n✅ Solution Owner Admin created successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 Full Name:', verifyData.full_name);
    console.log('🎭 Role:', verifyData.role);
    console.log('✨ Status:', verifyData.is_active ? 'Active' : 'Inactive');
    console.log('🆔 User ID:', verifyData.id);
    console.log('🏢 Tenant ID:', verifyData.tenant_id === null ? 'NULL (System-wide)' : verifyData.tenant_id);
    console.log('═══════════════════════════════════════');
    console.log('\n🌐 Access URLs:');
    console.log('   - /solution-admin');
    console.log('   - /management (redirects to /login, then /solution-admin)');
    console.log('\n💡 You can now login with these credentials!');
    console.log('\n🔒 Security Notes:');
    console.log('   - Solution Owner has NULL tenant_id for system-wide access');
    console.log('   - Can view and manage all tenants');
    console.log('   - Bypasses tenant-level RLS policies');
    console.log('   - Access is restricted to /solution-admin route only');

  } catch (error) {
    console.error('\n❌ Failed to create solution owner:', error);
    process.exit(1);
  }
}

// Run the script
createSolutionOwner();
