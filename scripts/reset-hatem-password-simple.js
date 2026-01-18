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

async function resetPassword() {
  console.log('🔄 Setting simple password for hatem@kaptifi.com...\n');

  // Try with a simpler password
  const { data, error } = await supabase.auth.admin.updateUserById(
    '8a321565-dfcd-43b1-bc9d-4a01216c4076',
    {
      password: 'Hatem123',
      email_confirm: true
    }
  );

  if (error) {
    console.error('❌ Error:', error);
  } else {
    console.log('✅ Password updated to: Hatem123');
    console.log('   User:', data.user.email);
    console.log('   ID:', data.user.id);
  }
}

resetPassword().catch(console.error);
