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

async function createMahmoudAuth() {
  console.log('🔄 Creating auth entry for mahmoudnzaineldeen@gmail.com...\n');

  // The ID that already exists in public.users
  const existingUserId = '7cfe4207-6d6f-4386-8749-ecd8a8ac058f';

  // We need to insert directly into auth.users with this specific ID
  // Since Supabase Admin API doesn't let us specify the ID, we'll use SQL
  const password = '111111';

  // Hash the password using Supabase's crypt function
  const { error } = await supabase.rpc('create_auth_user_with_id', {
    user_id: existingUserId,
    user_email: 'mahmoudnzaineldeen@gmail.com',
    user_password: password
  });

  if (error) {
    console.error('❌ Error creating auth user:', error);
    console.log('\nTrying direct SQL insert...');

    // Try direct SQL insert
    const { data, error: sqlError } = await supabase.from('auth.users').insert({
      id: existingUserId,
      email: 'mahmoudnzaineldeen@gmail.com',
      encrypted_password: password, // This won't work - need proper hashing
      email_confirmed_at: new Date().toISOString(),
      aud: 'authenticated',
      role: 'authenticated'
    });

    if (sqlError) {
      console.error('❌ SQL insert also failed:', sqlError);
    }
  } else {
    console.log('✅ Auth user created for mahmoudnzaineldeen@gmail.com');
  }
}

createMahmoudAuth().catch(console.error);
