/**
 * Simplified Email Service - SMTP Only
 * Uses only SMTP (no SendGrid) for email sending
 */

import { supabase } from '../db';

export type EmailProvider = 'smtp';

export interface EmailConfig {
  provider: EmailProvider;
  smtpSettings: {
    host: string;
    port: number;
    user: string;
    password: string;
  };
}

export interface EmailAttachment {
  filename: string;
  content: Buffer | string;
  contentType: string;
}

export interface SendEmailOptions {
  to: string | string[];
  from: string;
  subject: string;
  html: string;
  text?: string;
  attachments?: EmailAttachment[];
  replyTo?: string;
}

export interface SendEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  provider?: EmailProvider;
}

/**
 * Get SMTP configuration for a tenant
 */
async function getEmailConfig(tenantId: string): Promise<EmailConfig | null> {
  try {
    console.log(`[EmailAPI] 🔍 Fetching SMTP configuration for tenant ${tenantId}...`);
    
    // Get SMTP settings from database
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('smtp_settings')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      console.error(`[EmailAPI] ❌ Tenant ${tenantId} not found or error:`, error?.message || 'Unknown error');
      console.error(`[EmailAPI]    This means emails CANNOT be sent!`);
      console.error(`[EmailAPI]    ACTION REQUIRED: Configure SMTP settings in tenant settings page`);
      return null;
    }

    console.log(`[EmailAPI] ✅ Tenant found, checking SMTP settings...`);

    const smtpSettings = tenant.smtp_settings;
    if (smtpSettings?.smtp_user && smtpSettings?.smtp_password) {
      console.log(`[EmailAPI] ✅ Using SMTP as email provider`);
      console.log(`[EmailAPI]    SMTP Host: ${smtpSettings.smtp_host || 'not set'}`);
      console.log(`[EmailAPI]    SMTP Port: ${smtpSettings.smtp_port || 'not set'}`);
      console.log(`[EmailAPI]    SMTP User: ${smtpSettings.smtp_user}`);
      return {
        provider: 'smtp',
        smtpSettings: {
          host: smtpSettings.smtp_host || 'smtp.gmail.com',
          port: smtpSettings.smtp_port || 587,
          user: smtpSettings.smtp_user,
          password: smtpSettings.smtp_password,
        },
      };
    }

    // If no configuration found
    console.error(`[EmailAPI] ❌ ========================================`);
    console.error(`[EmailAPI] ❌ NO SMTP CONFIGURATION FOUND`);
    console.error(`[EmailAPI] ❌ ========================================`);
    console.error(`[EmailAPI]    Tenant ID: ${tenantId}`);
    console.error(`[EmailAPI]    SMTP Settings: ${smtpSettings ? 'Partial' : 'NOT FOUND'}`);
    if (smtpSettings) {
      console.error(`[EmailAPI]      - Host: ${smtpSettings.smtp_host || 'NOT SET'}`);
      console.error(`[EmailAPI]      - Port: ${smtpSettings.smtp_port || 'NOT SET'}`);
      console.error(`[EmailAPI]      - User: ${smtpSettings.smtp_user || 'NOT SET'}`);
      console.error(`[EmailAPI]      - Password: ${smtpSettings.smtp_password ? 'SET' : 'NOT SET'}`);
    }
    console.error(`[EmailAPI] ❌ ========================================`);
    console.error(`[EmailAPI]    ACTION REQUIRED:`);
    console.error(`[EmailAPI]    Configure SMTP Settings:`);
    console.error(`[EmailAPI]       - Go to tenant settings page`);
    console.error(`[EmailAPI]       - Set SMTP Host: smtp.gmail.com`);
    console.error(`[EmailAPI]       - Set SMTP Port: 465 (SSL) - Port 587 is blocked by Railway`);
    console.error(`[EmailAPI]       - Set Email: your Gmail address`);
    console.error(`[EmailAPI]       - Set App Password from: https://myaccount.google.com/apppasswords`);
    console.error(`[EmailAPI]       - NOTE: You MUST use App Password, not your regular Gmail password`);
    console.error(`[EmailAPI] ❌ ========================================`);
    return null;
  } catch (error: any) {
    console.error(`[EmailAPI] ❌ Error fetching SMTP config:`, error.message);
    console.error(`[EmailAPI]    Stack:`, error.stack);
    return null;
  }
}

/**
 * Send email via SMTP
 */
async function sendViaSMTP(
  config: EmailConfig,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  if (!config.smtpSettings) {
    return {
      success: false,
      error: 'SMTP settings not configured',
      provider: 'smtp',
    };
  }

  try {
    // Dynamic import to avoid loading nodemailer if not needed
    const nodemailer = await import('nodemailer');
    
    const useSecure = config.smtpSettings.port === 465;
    const useTLS = config.smtpSettings.port === 587;

    const transporter = nodemailer.default.createTransport({
      host: config.smtpSettings.host,
      port: config.smtpSettings.port,
      secure: useSecure,
      auth: {
        user: config.smtpSettings.user,
        pass: config.smtpSettings.password.trim(),
      },
      tls: {
        rejectUnauthorized: false,
        ciphers: 'SSLv3',
        minVersion: 'TLSv1.2',
      },
      connectionTimeout: 30000,
      greetingTimeout: 30000,
      socketTimeout: 30000,
      requireTLS: useTLS,
    });

    const toEmails = Array.isArray(options.to) ? options.to : [options.to];
    
    const attachments = options.attachments?.map(att => ({
      filename: att.filename,
      content: att.content,
      contentType: att.contentType,
    })) || [];

    const mailOptions = {
      from: options.from,
      to: toEmails.join(', '),
      subject: options.subject,
      html: options.html,
      text: options.text,
      attachments,
      replyTo: options.replyTo,
    };

    const info = await transporter.sendMail(mailOptions);
    
    console.log(`[EmailAPI] ✅ Email sent via SMTP to ${toEmails.join(', ')}`);
    console.log(`   Message ID: ${info.messageId}`);
    
    return {
      success: true,
      messageId: info.messageId,
      provider: 'smtp',
    };
  } catch (error: any) {
    console.error(`[EmailAPI] ❌ SMTP error:`, error.message);
    console.error(`   Error code: ${error.code}`);
    console.error(`   Error command: ${error.command}`);

    return {
      success: false,
      error: error.message,
      provider: 'smtp',
    };
  }
}

/**
 * Main email sending function - SMTP only
 */
export async function sendEmail(
  tenantId: string,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  console.log(`[EmailAPI] 📧 sendEmail called for tenant ${tenantId}`);
  console.log(`[EmailAPI]    To: ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
  console.log(`[EmailAPI]    Subject: ${options.subject}`);
  
  const config = await getEmailConfig(tenantId);
  
  if (!config) {
    console.error(`[EmailAPI] ❌ CRITICAL: SMTP not configured for tenant ${tenantId}`);
    console.error(`[EmailAPI]    Email will NOT be sent!`);
    console.error(`[EmailAPI]    Please configure SMTP settings in tenant settings page`);
    return {
      success: false,
      error: 'SMTP not configured. Please configure SMTP settings (host, port, email, app password).',
    };
  }

  // Log SMTP details
  console.log(`[EmailAPI] 📧 Sending email via SMTP`);
  console.log(`   To: ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
  console.log(`   Subject: ${options.subject}`);
  console.log(`   Attachments: ${options.attachments?.length || 0}`);

  return await sendViaSMTP(config, options);
}

/**
 * Test SMTP connection
 */
export async function testEmailConnection(tenantId: string): Promise<{
  success: boolean;
  provider?: EmailProvider;
  error?: string;
  message?: string;
  hint?: string;
}> {
  const config = await getEmailConfig(tenantId);
  
  if (!config) {
    return {
      success: false,
      error: 'SMTP not configured',
      hint: 'Please configure SMTP settings (host, port, email, app password) in the tenant settings page.',
    };
  }

  // Test SMTP
  if (config.smtpSettings) {
    try {
      console.log(`[EmailAPI] Testing SMTP connection to ${config.smtpSettings.host}:${config.smtpSettings.port}...`);
      const nodemailer = await import('nodemailer');
      
      const useSecure = config.smtpSettings.port === 465;
      const useTLS = config.smtpSettings.port === 587;

      const transporter = nodemailer.default.createTransport({
        host: config.smtpSettings.host,
        port: config.smtpSettings.port,
        secure: useSecure,
        auth: {
          user: config.smtpSettings.user,
          pass: config.smtpSettings.password.trim(),
        },
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 15000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
        requireTLS: useTLS,
      });

      // Add timeout wrapper to prevent hanging
      const verifyPromise = new Promise<void>((resolve, reject) => {
        transporter.verify((error) => {
          if (error) {
            console.error(`[EmailAPI] SMTP verify error:`, error.message);
            reject(error);
          } else {
            console.log(`[EmailAPI] ✅ SMTP connection verified successfully`);
            resolve();
          }
        });
      });

      // Add timeout to verification
      const timeoutPromise = new Promise<void>((_, reject) => {
        setTimeout(() => {
          reject(new Error('SMTP verification timeout after 15 seconds'));
        }, 15000);
      });

      await Promise.race([verifyPromise, timeoutPromise]);

      return {
        success: true,
        provider: 'smtp',
        message: `SMTP connection verified: ${config.smtpSettings.host}:${config.smtpSettings.port}`,
      };
    } catch (error: any) {
      console.error(`[EmailAPI] ❌ SMTP test failed:`, error.message);
      console.error(`   Error code: ${error.code}`);
      console.error(`   Error command: ${error.command}`);
      
      // Provide more helpful error messages
      let errorMessage = error.message;
      let errorHint = 'Please check your SMTP settings.';
      
      if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.message?.includes('timeout')) {
        errorMessage = `SMTP connection timeout. Port ${config.smtpSettings.port} is likely blocked by your hosting provider (Railway, Vercel, etc. block SMTP ports).`;
        errorHint = `SOLUTION: Change SMTP Port from ${config.smtpSettings.port} to 465 (SSL/TLS). Port 465 is less commonly blocked. In your SMTP settings, set port to 465 and try again.`;
      } else if (error.code === 'EAUTH' || error.code === 'EAUTHFAILED') {
        errorMessage = `SMTP authentication failed. Your email or password is incorrect.`;
        errorHint = 'For Gmail: You MUST use an App Password (not your regular password). Generate one at: https://myaccount.google.com/apppasswords';
      }
      
      return {
        success: false,
        provider: 'smtp',
        error: errorMessage,
        hint: errorHint,
      };
    }
  }

  return {
    success: false,
    error: 'SMTP not configured',
  };
}
