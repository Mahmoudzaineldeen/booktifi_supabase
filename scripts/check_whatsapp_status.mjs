import axios from 'axios';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

// Load .env from server directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

async function checkWhatsAppStatus() {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const messageId = 'wamid.HBgMMjAxMDMyNTYwODI2FQIAERgSQjU1M0EwQkVBRDEwODA0NkRCAA=='; // Last message ID

  console.log('\n📱 ============================================');
  console.log('📱 Checking WhatsApp Message Status');
  console.log('📱 ============================================');
  console.log(`Message ID: ${messageId}`);
  console.log(`Phone Number ID: ${phoneNumberId}`);
  console.log('============================================\n');

  if (!phoneNumberId || !accessToken) {
    console.error('❌ WhatsApp Meta API not configured');
    process.exit(1);
  }

  try {
    // Check phone number status
    const apiVersion = 'v22.0';
    const phoneUrl = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}`;
    
    console.log('📞 Checking Phone Number Status...');
    const phoneResponse = await axios.get(phoneUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });
    
    console.log('Phone Number Info:');
    console.log(JSON.stringify(phoneResponse.data, null, 2));
    console.log('');

    // Note: Meta doesn't provide a direct API to check message status
    // Status updates come via webhooks
    console.log('ℹ️  Note: Message status updates are received via webhooks.');
    console.log('   To check delivery status, you need to:');
    console.log('   1. Set up a webhook endpoint');
    console.log('   2. Subscribe to message status events');
    console.log('   3. Check your webhook logs for delivery confirmations');
    console.log('');
    console.log('📋 Common reasons messages might not be received:');
    console.log('   1. Phone number not registered on WhatsApp');
    console.log('   2. User needs to opt-in first (for business messages)');
    console.log('   3. Phone number is blocked');
    console.log('   4. Using template messages requires pre-approved templates');
    console.log('   5. 24-hour messaging window expired (need to use template)');
    console.log('');

  } catch (error) {
    console.error('❌ Error checking status');
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Error:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('Error:', error.message);
    }
  }
  
  process.exit(0);
}

checkWhatsAppStatus();

