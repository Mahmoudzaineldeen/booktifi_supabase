import { sendOTPWhatsApp } from '../server/src/services/whatsappService.js';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

async function testSendOTP() {
  const phoneNumber = '+201032560826'; // Egyptian number
  const otp = '123456'; // Test OTP
  const language = 'en';

  console.log('\n📱 ============================================');
  console.log('📱 Testing WhatsApp OTP Sending');
  console.log('📱 ============================================');
  console.log(`Phone Number: ${phoneNumber}`);
  console.log(`OTP: ${otp}`);
  console.log(`Language: ${language}`);
  console.log('============================================\n');

  try {
    // Use default config from .env
    const result = await sendOTPWhatsApp(phoneNumber, otp, language);

    if (result.success) {
      console.log('\n✅ SUCCESS! WhatsApp OTP sent successfully!');
      console.log(`   Phone: ${phoneNumber}`);
      console.log(`   OTP: ${otp}`);
    } else {
      console.log('\n❌ FAILED to send WhatsApp OTP');
      console.log(`   Error: ${result.error}`);
    }
  } catch (error) {
    console.error('\n❌ Exception occurred:');
    console.error(error);
  }
}

testSendOTP();

