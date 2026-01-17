/**
 * Create Solution Owner Admin User
 * Username: Bookatiadmin
 * Password: Book@king6722
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables
dotenv.config({ path: resolve(__dirname, '../.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
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

  const email = 'bookatiadmin@bookati.local';
  const password = 'Book@king6722';
  const fullName = 'Bookati Admin';
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
          full_name: fullName
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
      const { error: updateError } = await supabase
        .from('users')
        .update({
          email: email,
          full_name: fullName,
          role: role,
          is_active: true,
          tenant_id: null
        })
        .eq('id', authUserId);

      if (updateError) {
        console.error('❌ Error updating profile:', updateError);
        throw updateError;
      }
      console.log('✅ Profile updated successfully');
    } else {
      console.log('📝 Creating new profile...');
      const { error: insertError } = await supabase
        .from('users')
        .insert({
          id: authUserId,
          email: email,
          full_name: fullName,
          role: role,
          is_active: true,
          tenant_id: null
        });

      if (insertError) {
        console.error('❌ Error creating profile:', insertError);
        throw insertError;
      }
      console.log('✅ Profile created successfully');
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

    console.log('\n✅ Solution Owner Admin created successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 Full Name:', verifyData.full_name);
    console.log('🎭 Role:', verifyData.role);
    console.log('✨ Status:', verifyData.is_active ? 'Active' : 'Inactive');
    console.log('🆔 User ID:', verifyData.id);
    console.log('═══════════════════════════════════════');
    console.log('\n🌐 Login URL: /management');
    console.log('   (NOT /auth/login - that\'s for tenants)');
    console.log('\n💡 You can now login with these credentials!');

  } catch (error) {
    console.error('\n❌ Failed to create solution owner:', error);
    process.exit(1);
  }
}

// Run the script
createSolutionOwner();
