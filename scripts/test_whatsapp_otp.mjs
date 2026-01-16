import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

async function testSendOTP() {
  // Try different formats
  const phoneNumber = '+201032560826'; // Egyptian number (formatted from +20 10 32560826)
  const otp = Math.floor(100000 + Math.random() * 900000).toString(); // Random 6-digit OTP
  const language = 'en';

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;

  console.log('\n📱 ============================================');
  console.log('📱 Testing WhatsApp OTP Sending');
  console.log('📱 ============================================');
  console.log(`Phone Number: ${phoneNumber}`);
  console.log(`OTP: ${otp}`);
  console.log(`Language: ${language}`);
  console.log(`Phone Number ID: ${phoneNumberId || 'NOT SET'}`);
  console.log(`Access Token: ${accessToken ? 'SET ✅' : 'NOT SET ❌'}`);
  console.log('============================================\n');

  if (!phoneNumberId || !accessToken) {
    console.error('❌ WhatsApp Meta API not configured');
    console.error('   Please set WHATSAPP_PHONE_NUMBER_ID and WHATSAPP_ACCESS_TOKEN in server/.env');
    process.exit(1);
  }

  // Format phone number (remove + and spaces)
  const formattedPhone = phoneNumber.replace(/^\+/, '').replace(/\s/g, '');

  // Use v22.0 API version
  const apiVersion = 'v22.0';
  const apiUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  const messageText = language === 'ar'
    ? `رمز التحقق الخاص بك هو: *${otp}*\n\nهذا الرمز صالح لمدة 10 دقائق فقط.\n\nإذا لم تطلب إعادة تعيين كلمة المرور، يرجى تجاهل هذه الرسالة.\n\nشكراً لك،\nفريق Bookati`
    : `Your verification code is: *${otp}*\n\nThis code is valid for 10 minutes only.\n\nIf you did not request a password reset, please ignore this message.\n\nThank you,\nThe Bookati Team`;

  console.log(`📱 Sending WhatsApp message via Meta API:`);
  console.log(`   URL: ${apiUrl}`);
  console.log(`   Original Phone: ${phoneNumber}`);
  console.log(`   Formatted Phone: ${formattedPhone}`);
  console.log(`   Phone Number ID: ${phoneNumberId}`);
  console.log(`   Message Preview: ${messageText.substring(0, 50)}...`);
  console.log('');

  try {
    const response = await axios.post(
      apiUrl,
      {
        messaging_product: 'whatsapp',
        to: formattedPhone,
        type: 'text',
        text: {
          body: messageText,
        },
      },
      {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );

    console.log('📥 Full API Response:');
    console.log(JSON.stringify(response.data, null, 2));
    console.log('');

    if (response.data.messages && response.data.messages[0]?.id) {
      console.log(`✅ WhatsApp OTP sent successfully!`);
      console.log(`   Message ID: ${response.data.messages[0].id}`);
      console.log(`   To: ${phoneNumber} (${formattedPhone})`);
      console.log(`   OTP: ${otp}`);
      console.log(`   Status: ${response.data.messages[0].message_status || 'sent'}`);
      
      // Check for contacts
      if (response.data.contacts && response.data.contacts.length > 0) {
        console.log(`   Contact: ${response.data.contacts[0].wa_id || 'N/A'}`);
      }
    } else {
      console.log('❌ Unexpected response from WhatsApp API');
      console.log('Response:', JSON.stringify(response.data, null, 2));
    }
  } catch (error) {
    console.error('\n❌ Failed to send WhatsApp message');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error Response:', JSON.stringify(error.response.data, null, 2));
      
      const errorData = error.response.data;
      if (errorData.error) {
        console.error('\n📋 Error Details:');
        console.error(`   Code: ${errorData.error.code || 'N/A'}`);
        console.error(`   Type: ${errorData.error.type || 'N/A'}`);
        console.error(`   Message: ${errorData.error.message || 'N/A'}`);
        console.error(`   Subcode: ${errorData.error.error_subcode || 'N/A'}`);
        
        // Common error codes
        if (errorData.error.code === 131047) {
          console.error('\n⚠️  This error means:');
          console.error('   - The recipient phone number is not registered on WhatsApp');
          console.error('   - Or the number format is incorrect');
        } else if (errorData.error.code === 131026) {
          console.error('\n⚠️  This error means:');
          console.error('   - You need to use a template message outside the 24-hour window');
          console.error('   - Text messages only work within 24 hours of user interaction');
        } else if (errorData.error.code === 131031) {
          console.error('\n⚠️  This error means:');
          console.error('   - The recipient has not opted in to receive messages');
          console.error('   - Or the phone number is blocked');
        }
      }
    } else {
      console.error('Error:', error.message);
    }
    process.exit(1);
  }
  
  process.exit(0);
}

testSendOTP();
