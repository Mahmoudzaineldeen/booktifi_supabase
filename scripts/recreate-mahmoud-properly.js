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

async function recreateMahmoud() {
  console.log('🔄 Recreating mahmoud auth user properly...\n');

  const oldUserId = '7cfe4207-6d6f-4386-8749-ecd8a8ac058f';

  // Create new auth user
  const { data: authUser, error: createError } = await supabase.auth.admin.createUser({
    email: 'mahmoudnzaineldeen@gmail.com',
    password: '111111',
    email_confirm: true,
    user_metadata: {
      full_name: 'mahmoud zaineldeen'
    }
  });

  if (createError) {
    console.error('❌ Error creating auth user:', createError);
    return;
  }

  console.log('✅ Auth user created');
  console.log('   Old ID:', oldUserId);
  console.log('   New ID:', authUser.user.id);

  // Now update all foreign key references
  console.log('\n📝 Updating foreign key references...');

  // Update bookings
  const { error: bookingsError } = await supabase
    .from('bookings')
    .update({ created_by_user_id: authUser.user.id })
    .eq('created_by_user_id', oldUserId);

  if (bookingsError) {
    console.error('❌ Error updating bookings:', bookingsError);
  } else {
    console.log('✅ Updated bookings references');
  }

  // Update users table
  const { error: usersError } = await supabase
    .from('users')
    .update({ id: authUser.user.id })
    .eq('id', oldUserId);

  if (usersError) {
    console.error('❌ Error updating users:', usersError);
  } else {
    console.log('✅ Updated users table ID');
  }

  console.log('\n✅ Mahmoud can now login with: mahmoudnzaineldeen@gmail.com / 111111');
}

recreateMahmoud().catch(console.error);
