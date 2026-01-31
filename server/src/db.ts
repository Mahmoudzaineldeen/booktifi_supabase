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

const MAX_SUPABASE_RETRIES = 2;

function isTransientConnectionError(err: unknown): boolean {
  const msg = err && typeof (err as Error).message === 'string' ? (err as Error).message : '';
  const str = String(msg).toLowerCase();
  return (
    str.includes('terminated') ||
    str.includes('other side closed') ||
    str.includes('und_err_socket') ||
    str.includes('econnreset') ||
    str.includes('etimedout') ||
    str.includes('econnrefused') ||
    str.includes('fetch failed')
  );
}

function createFetchWithRetry(): typeof fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    let lastError: unknown;
    for (let attempt = 0; attempt <= MAX_SUPABASE_RETRIES; attempt++) {
      try {
        return await fetch(input, init);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_SUPABASE_RETRIES && isTransientConnectionError(err)) {
          const delayMs = 500 * (attempt + 1);
          console.warn(`[Supabase] Transient connection error (attempt ${attempt + 1}/${MAX_SUPABASE_RETRIES + 1}), retrying in ${delayMs}ms:`, (err as Error).message);
          await new Promise((r) => setTimeout(r, delayMs));
          continue;
        }
        throw err;
      }
    }
    throw lastError;
  };
}

// Create Supabase client with retry fetch for transient "other side closed" / UND_ERR_SOCKET errors
export const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  },
  global: {
    fetch: createFetchWithRetry(),
    headers: {
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`,
    }
  }
});

console.log('✅ Supabase client initialized:', supabaseUrl);
console.log(`   Using: ${isUsingServiceRole ? 'SERVICE_ROLE key (bypasses RLS)' : 'ANON key (subject to RLS)'}`);

export async function testConnection() {
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
}

testConnection();
