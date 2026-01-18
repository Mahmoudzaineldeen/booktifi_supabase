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

async function updateHatemPassword() {
  console.log('🔄 Updating hatem password...\n');

  // Update password for hatem's NEW auth user ID
  const { data, error } = await supabase.auth.admin.updateUserById(
    '8a321565-dfcd-43b1-bc9d-4a01216c4076',
    { password: 'book@ati6722' }
  );

  if (error) {
    console.error('❌ Error updating password:', error);
  } else {
    console.log('✅ Password updated for hatem@kaptifi.com');
    console.log('   User can now login with: book@ati6722');
  }
}

updateHatemPassword().catch(console.error);
