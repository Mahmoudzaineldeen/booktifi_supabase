import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: join(__dirname, '../server/.env') });

const supabaseUrl = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const supabase = createClient(supabaseUrl, supabaseKey);

async function getOTP(email) {
  console.log(`\n🔍 Looking for OTP for: ${email}\n`);

  try {
    // Try with email column first
    let { data, error } = await supabase
      .from('otp_requests')
      .select('email, otp_code, expires_at, created_at, verified, purpose')
      .eq('email', email)
      .order('created_at', { ascending: false })
      .limit(1);

    if (error && error.message?.includes('column') && error.message?.includes('email')) {
      // Fallback to phone column
      console.log('⚠️  email column not found, trying phone column...\n');
      const result = await supabase
        .from('otp_requests')
        .select('phone, otp_code, expires_at, created_at, verified')
        .eq('phone', email)
        .order('created_at', { ascending: false })
        .limit(1);
      
      data = result.data;
      error = result.error;
    }

    if (error) {
      console.error('❌ Error:', error.message);
      return;
    }

    if (!data || data.length === 0) {
      console.log('❌ No OTP found for this email.');
      console.log('   Make sure you requested an OTP first.');
      return;
    }

    const otpRecord = data[0];
    const expiresAt = new Date(otpRecord.expires_at);
    const now = new Date();
    const isExpired = expiresAt < now;
    const timeLeft = Math.max(0, Math.floor((expiresAt - now) / 1000 / 60));

    console.log('📧 ============================================');
    console.log(`📧 OTP FOUND FOR: ${email}`);
    console.log(`📧 CODE: ${otpRecord.otp_code}`);
    console.log(`📧 Status: ${otpRecord.verified ? '✅ Verified' : '⏳ Pending'}`);
    console.log(`📧 Expires: ${expiresAt.toLocaleString()}`);
    console.log(`📧 Time Left: ${timeLeft} minutes`);
    console.log(`📧 Status: ${isExpired ? '❌ EXPIRED' : '✅ VALID'}`);
    if (otpRecord.purpose) {
      console.log(`📧 Purpose: ${otpRecord.purpose}`);
    }
    console.log('📧 ============================================\n');

    if (isExpired) {
      console.log('⚠️  This OTP has expired. Please request a new one.\n');
    } else if (otpRecord.verified) {
      console.log('⚠️  This OTP has already been used.\n');
    } else {
      console.log('✅ You can use this OTP code to verify.\n');
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.log('Usage: node get_otp_from_db.js <email>');
  console.log('Example: node get_otp_from_db.js user@example.com');
  process.exit(1);
}

getOTP(email);

