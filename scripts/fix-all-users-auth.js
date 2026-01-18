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

async function fixAllUsers() {
  console.log('🔄 Fixing all user authentication...\n');

  // 1. Fix hatem@kaptifi.com - delete and recreate
  console.log('📝 Fixing hatem@kaptifi.com...');

  // Delete existing auth entry
  await supabase.auth.admin.deleteUser('7137da17-537f-4b02-89e0-73ade6a1db4c');
  console.log('   Deleted old auth entry');

  // Create new auth user
  const { data: hatem, error: hatemError } = await supabase.auth.admin.createUser({
    email: 'hatem@kaptifi.com',
    password: 'book@ati6722',
    email_confirm: true,
    user_metadata: {
      full_name: 'Hatem - Solution Owner'
    }
  });

  if (hatemError) {
    console.error('❌ Error creating hatem@kaptifi.com:', hatemError);
  } else {
    console.log('✅ Auth user created for hatem@kaptifi.com');
    console.log('   User ID:', hatem.user.id);

    // Update public.users to use new auth ID
    const { error: updateError } = await supabase
      .from('users')
      .update({ id: hatem.user.id })
      .eq('email', 'hatem@kaptifi.com');

    if (updateError) {
      console.error('❌ Error updating public.users:', updateError);
    } else {
      console.log('✅ Updated public.users with new auth ID');
    }
  }

  // 2. Create mahmoudnzaineldeen@gmail.com in auth.users
  console.log('\n📝 Creating auth user for mahmoudnzaineldeen@gmail.com...');
  const { data: mahmoud, error: mahmoudError } = await supabase.auth.admin.createUser({
    email: 'mahmoudnzaineldeen@gmail.com',
    password: '111111',
    email_confirm: true,
    user_metadata: {
      full_name: 'Mahmoud Nzaineldeen'
    }
  });

  if (mahmoudError) {
    console.error('❌ Error creating mahmoudnzaineldeen@gmail.com:', mahmoudError);
  } else {
    console.log('✅ Auth user created for mahmoudnzaineldeen@gmail.com');
    console.log('   User ID:', mahmoud.user.id);

    // Update public.users to use new auth ID
    const { error: updateError2 } = await supabase
      .from('users')
      .update({ id: mahmoud.user.id })
      .eq('email', 'mahmoudnzaineldeen@gmail.com');

    if (updateError2) {
      console.error('❌ Error updating public.users:', updateError2);
    } else {
      console.log('✅ Updated public.users with new auth ID');
    }
  }

  console.log('\n✅ All users fixed! Ready to login:');
  console.log('   - hatem@kaptifi.com / book@ati6722');
  console.log('   - info@kingdomcentre.com.sa / King@123');
  console.log('   - mahmoudnzaineldeen@gmail.com / 111111');
}

fixAllUsers().catch(console.error);
