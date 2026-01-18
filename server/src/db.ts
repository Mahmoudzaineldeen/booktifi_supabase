import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { join } from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

// Get the directory of the current module
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory (where this file is located)
dotenv.config({ path: join(__dirname, '..', '.env') });

const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const isUsingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error('Missing Supabase configuration');
  console.error('SUPABASE_URL:', supabaseUrl ? 'Set' : 'Missing');
  console.error('SUPABASE_KEY:', supabaseKey ? 'Set' : 'Missing');
  throw new Error('Missing Supabase configuration. Please check your .env file.');
}

// Warn if using anon key instead of service role key
if (!isUsingServiceRole) {
  console.warn('⚠️  WARNING: Using ANON key instead of SERVICE_ROLE key');
  console.warn('   Backend operations may fail due to Row Level Security (RLS) policies.');
  console.warn('   To fix: Add SUPABASE_SERVICE_ROLE_KEY to server/.env');
  console.warn('   Get it from: Supabase Dashboard → Settings → API → service_role key');
}

export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

console.log('✅ Supabase client initialized:', supabaseUrl);
console.log(`   Using: ${isUsingServiceRole ? 'SERVICE_ROLE key (bypasses RLS)' : 'ANON key (subject to RLS)'}`);export async function testConnection() {
  try {
    const { data, error } = await supabase.from('tenants').select('id').limit(1);
    if (error) {
      console.error('Database connection test failed:', error);
      return false;
    }
    console.log('✅ Database connection successful');
    return true;
  } catch (error) {
    console.error('Database connection test error:', error);
    return false;
  }
}testConnection();
