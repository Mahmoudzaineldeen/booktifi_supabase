/**
 * Update Solution Owner Password Hash
 * Email: hatem@kaptifi.com
 * Password: Book@ati6722
 * 
 * This script updates the password_hash in the users table for the Solution Owner
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
  console.error('Required: VITE_SUPABASE_URL (or SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function updateSolutionOwnerPassword() {
  console.log('🔐 Updating Solution Owner Password Hash\n');

  const email = 'hatem@kaptifi.com';
  const password = 'Book@ati6722';

  try {
    // Step 1: Find the user
    console.log('📋 Step 1: Finding Solution Owner user...');
    const { data: user, error: findError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email)
      .maybeSingle();

    if (findError) {
      console.error('❌ Error finding user:', findError);
      throw findError;
    }

    if (!user) {
      console.error('❌ User not found with email:', email);
      console.error('   Please create the Solution Owner account first using create-solution-owner-hatem.js');
      process.exit(1);
    }

    console.log('✅ User found');
    console.log('   User ID:', user.id);
    console.log('   Email:', user.email);
    console.log('   Role:', user.role);
    console.log('   Current password_hash:', user.password_hash ? 'Set (will be updated)' : 'NULL (will be set)');

    // Step 2: Hash the password
    console.log('\n📋 Step 2: Hashing password...');
    const passwordHash = await bcrypt.hash(password, 10);
    console.log('✅ Password hashed successfully');
    console.log('   Hash length:', passwordHash.length);
    console.log('   Hash preview:', passwordHash.substring(0, 20) + '...');

    // Step 3: Update the password_hash
    console.log('\n📋 Step 3: Updating password_hash in database...');
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({
        password_hash: passwordHash,
        updated_at: new Date().toISOString()
      })
      .eq('id', user.id)
      .select('id, email, role, password_hash')
      .single();

    if (updateError) {
      console.error('❌ Error updating password_hash:', updateError);
      throw updateError;
    }

    console.log('✅ Password hash updated successfully');

    // Step 4: Verify the update
    console.log('\n📋 Step 4: Verifying password hash...');
    const { data: verifyUser, error: verifyError } = await supabase
      .from('users')
      .select('id, email, role, password_hash')
      .eq('id', user.id)
      .single();

    if (verifyError) {
      console.error('❌ Error verifying update:', verifyError);
      throw verifyError;
    }

    if (!verifyUser.password_hash) {
      console.error('❌ Password hash is still NULL after update!');
      process.exit(1);
    }

    // Step 5: Test password verification
    console.log('\n📋 Step 5: Testing password verification...');
    const passwordMatch = await bcrypt.compare(password, verifyUser.password_hash);
    
    if (!passwordMatch) {
      console.error('❌ Password verification failed! The hash may be incorrect.');
      process.exit(1);
    }

    console.log('✅ Password verification successful');
    console.log('   Password matches the hash');

    // Summary
    console.log('\n✅ Solution Owner password hash updated successfully!\n');
    console.log('═══════════════════════════════════════');
    console.log('📧 Email:', email);
    console.log('🔑 Password:', password);
    console.log('👤 User ID:', verifyUser.id);
    console.log('🎭 Role:', verifyUser.role);
    console.log('🔐 Password Hash:', verifyUser.password_hash ? 'Set ✅' : 'NULL ❌');
    console.log('═══════════════════════════════════════');
    console.log('\n💡 The Solution Owner can now login using:');
    console.log('   - Email:', email);
    console.log('   - Password:', password);
    console.log('\n✅ Password hash is properly stored and verified!');

  } catch (error) {
    console.error('\n❌ Failed to update password hash:', error);
    process.exit(1);
  }
}

// Run the script
updateSolutionOwnerPassword();
