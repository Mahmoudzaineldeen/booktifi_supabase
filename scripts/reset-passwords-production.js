import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing required environment variables');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

async function resetPasswords() {
  console.log('🔄 Resetting passwords for production users...\n');

  // Reset password for hatem@kaptifi.com
  const { data: data1, error: error1 } = await supabase.auth.admin.updateUserById(
    '7137da17-537f-4b02-89e0-73ade6a1db4c',
    { password: 'book@ati6722' }
  );

  if (error1) {
    console.error('❌ Error updating hatem@kaptifi.com:', error1);
  } else {
    console.log('✅ Password updated for hatem@kaptifi.com');
  }

  // Create auth user for info@kingdomcentre.com.sa
  console.log('\n📝 Creating auth user for info@kingdomcentre.com.sa...');
  const { data: data2, error: error2 } = await supabase.auth.admin.createUser({
    email: 'info@kingdomcentre.com.sa',
    password: 'King@123',
    email_confirm: true,
    user_metadata: {
      full_name: 'Healing Touch Admin'
    }
  });

  if (error2) {
    console.error('❌ Error creating info@kingdomcentre.com.sa:', error2);
  } else {
    console.log('✅ Auth user created for info@kingdomcentre.com.sa');
    console.log('   User ID:', data2.user.id);

    // Now update the public.users table to use the new auth ID
    const { error: updateError } = await supabase
      .from('users')
      .update({ id: data2.user.id })
      .eq('email', 'info@kingdomcentre.com.sa');

    if (updateError) {
      console.error('❌ Error updating public.users:', updateError);
    } else {
      console.log('✅ Updated public.users with new auth ID');
    }
  }

  console.log('\n✅ Password reset complete! Users can now login.');
}

resetPasswords().catch(console.error);
