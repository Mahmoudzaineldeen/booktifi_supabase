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

async function updateMahmoudPassword() {
  console.log('🔄 Updating mahmoud password...\n');

  // Update password for mahmoud's auth user ID
  const { data, error } = await supabase.auth.admin.updateUserById(
    '7cfe4207-6d6f-4386-8749-ecd8a8ac058f',
    { password: '111111' }
  );

  if (error) {
    console.error('❌ Error updating password:', error);
  } else {
    console.log('✅ Password updated for mahmoudnzaineldeen@gmail.com');
    console.log('   User can now login with: 111111');
  }
}

updateMahmoudPassword().catch(console.error);
