// Script to test email delivery only
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load .env from server directory (where SMTP settings are configured)
dotenv.config({ path: join(__dirname, '..', 'server', '.env') });

async function testEmailDelivery() {
  try {
    console.log('📧 Testing Email Delivery (SMTP)\n');
    
    const testEmail = 'kaptifidev@gmail.com';
    console.log(`📧 Test Email: ${testEmail}\n`);
    
    // Check SMTP configuration
    const emailConfig = {
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: parseInt(process.env.SMTP_PORT || '587'),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS || process.env.SMTP_PASSWORD, // Support both names
      },
    };
    
    console.log('📋 SMTP Configuration:');
    console.log(`   Host: ${emailConfig.host}`);
    console.log(`   Port: ${emailConfig.port}`);
    console.log(`   Secure: ${emailConfig.secure}`);
    console.log(`   User: ${emailConfig.auth.user ? '***SET*** ✅' : '❌ NOT SET'}`);
    console.log(`   Pass: ${emailConfig.auth.pass ? '***SET*** ✅' : '❌ NOT SET'}\n`);
    
    if (!emailConfig.auth.user || !emailConfig.auth.pass) {
      console.log('❌ SMTP credentials not configured!');
      console.log('\n📝 To configure SMTP, add these to your .env file:');
      console.log('   SMTP_HOST=smtp.gmail.com');
      console.log('   SMTP_PORT=587');
      console.log('   SMTP_SECURE=false');
      console.log('   SMTP_USER=your-email@gmail.com');
      console.log('   SMTP_PASS=your-app-password (or SMTP_PASSWORD)');
      console.log('\n💡 For Gmail, you need to use an App Password, not your regular password.');
      console.log('   Steps:');
      console.log('   1. Enable 2-Step Verification in Google Account');
      console.log('   2. Go to: https://myaccount.google.com/apppasswords');
      console.log('   3. Generate App Password for "Mail"');
      console.log('   4. Use that password in SMTP_PASS');
      return;
    }
    
    // Import nodemailer from server node_modules
    const serverNodeModules = join(__dirname, '..', 'server', 'node_modules');
    const nodemailerPath = join(serverNodeModules, 'nodemailer', 'lib', 'nodemailer.js');
    const nodemailer = await import(`file:///${nodemailerPath.replace(/\\/g, '/')}`);
    
    console.log('📤 Creating SMTP transporter...');
    const transporter = nodemailer.default.createTransport({
      ...emailConfig,
      tls: {
        // Do not fail on invalid certificates (for development/testing)
        rejectUnauthorized: false,
      },
    });
    
    // Verify connection
    console.log('🔍 Verifying SMTP connection...');
    await transporter.verify();
    console.log('✅ SMTP connection verified!\n');
    
    // Send test email
    console.log('📨 Sending test email...');
    const testMessage = {
      from: emailConfig.auth.user,
      to: testEmail,
      subject: 'Test: Booking Ticket Email Delivery',
      text: 'This is a test email to verify SMTP configuration is working correctly.',
      html: `
        <h2>✅ SMTP Test Email</h2>
        <p>This is a test email to verify that SMTP configuration is working correctly.</p>
        <p>If you received this email, your SMTP settings are configured properly!</p>
        <hr>
        <p><strong>Test Details:</strong></p>
        <ul>
          <li>SMTP Host: ${emailConfig.host}</li>
          <li>SMTP Port: ${emailConfig.port}</li>
          <li>Sent at: ${new Date().toLocaleString()}</li>
        </ul>
      `,
    };
    
    const info = await transporter.sendMail(testMessage);
    
    console.log('✅ Email sent successfully!');
    console.log(`   Message ID: ${info.messageId}`);
    console.log(`   Response: ${info.response}`);
    console.log(`\n📬 Check your inbox at ${testEmail}`);
    console.log('   (Also check spam folder if not found)');
    
  } catch (error) {
    console.error('\n❌ Email delivery failed!');
    console.error(`   Error: ${error.message}`);
    
    if (error.code === 'EAUTH') {
      console.error('\n💡 Authentication failed. Possible issues:');
      console.error('   1. Wrong email or password');
      console.error('   2. For Gmail: You need to use an App Password, not your regular password');
      console.error('   3. 2-Step Verification must be enabled in your Google account');
      console.error('   4. "Less secure app access" might be disabled (for older Gmail accounts)');
    } else if (error.code === 'ECONNECTION' || error.code === 'ETIMEDOUT') {
      console.error('\n💡 Connection failed. Possible issues:');
      console.error('   1. Wrong SMTP host or port');
      console.error('   2. Firewall blocking the connection');
      console.error('   3. Network connectivity issues');
    } else if (error.code === 'EENVELOPE') {
      console.error('\n💡 Envelope error. Check the recipient email address.');
    }
    
    throw error;
  }
}

testEmailDelivery().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});

