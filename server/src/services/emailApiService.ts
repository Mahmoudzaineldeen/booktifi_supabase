/**
 * Production-Ready Email API Service
 * Uses SendGrid API (HTTP-based) instead of SMTP for cloud environments
 * Falls back to SMTP for local development if API is not configured
 */

import axios from 'axios';
import { supabase } from '../db';

export type EmailProvider = 'sendgrid' | 'smtp' | 'auto';

export interface EmailConfig {
  provider: EmailProvider;
  sendgridApiKey?: string;
  smtpSettings?: {
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
 * Get email configuration for a tenant
 * Priority: SendGrid API > SMTP from database > Environment variables
 */
async function getEmailConfig(tenantId: string): Promise<EmailConfig | null> {
  try {
    console.log(`[EmailAPI] 🔍 Fetching email configuration for tenant ${tenantId}...`);
    
    // Check for SendGrid API key in environment (global fallback)
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    if (sendgridApiKey) {
      console.log(`[EmailAPI] ✅ Found SENDGRID_API_KEY in environment variables`);
    } else {
      console.log(`[EmailAPI] ⚠️  SENDGRID_API_KEY not found in environment variables`);
    }
    
    // Check tenant-specific email settings from database
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('smtp_settings, email_settings')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      console.error(`[EmailAPI] ❌ Tenant ${tenantId} not found or error:`, error?.message || 'Unknown error');
      console.error(`[EmailAPI]    This means emails CANNOT be sent!`);
      console.error(`[EmailAPI]    ACTION REQUIRED: Configure email settings in tenant settings page`);
      return null;
    }

    console.log(`[EmailAPI] ✅ Tenant found, checking email settings...`);

    // Check if tenant has SendGrid API key configured
    const tenantSendgridKey = tenant.email_settings?.sendgrid_api_key || 
                              tenant.smtp_settings?.sendgrid_api_key;

    if (tenantSendgridKey) {
      console.log(`[EmailAPI] ✅ Found SendGrid API key in tenant settings`);
    } else {
      console.log(`[EmailAPI] ⚠️  SendGrid API key not found in tenant settings`);
    }

    // Determine provider priority
    const apiKey = tenantSendgridKey || sendgridApiKey;
    
    if (apiKey) {
      console.log(`[EmailAPI] ✅ Using SendGrid as email provider`);
      return {
        provider: 'sendgrid',
        sendgridApiKey: apiKey,
      };
    }

    // Fallback to SMTP if available
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
    console.error(`[EmailAPI] ❌ NO EMAIL CONFIGURATION FOUND`);
    console.error(`[EmailAPI] ❌ ========================================`);
    console.error(`[EmailAPI]    Tenant ID: ${tenantId}`);
    console.error(`[EmailAPI]    SendGrid API Key: ${apiKey ? 'Found' : 'NOT FOUND'}`);
    console.error(`[EmailAPI]    SMTP Settings: ${smtpSettings ? 'Partial' : 'NOT FOUND'}`);
    if (smtpSettings) {
      console.error(`[EmailAPI]      - Host: ${smtpSettings.smtp_host || 'NOT SET'}`);
      console.error(`[EmailAPI]      - Port: ${smtpSettings.smtp_port || 'NOT SET'}`);
      console.error(`[EmailAPI]      - User: ${smtpSettings.smtp_user || 'NOT SET'}`);
      console.error(`[EmailAPI]      - Password: ${smtpSettings.smtp_password ? 'SET' : 'NOT SET'}`);
    }
    console.error(`[EmailAPI] ❌ ========================================`);
    console.error(`[EmailAPI]    ACTION REQUIRED:`);
    console.error(`[EmailAPI]    1. Configure SendGrid API Key (recommended):`);
    console.error(`[EmailAPI]       - Go to tenant settings page`);
    console.error(`[EmailAPI]       - Add SendGrid API key to email_settings.sendgrid_api_key`);
    console.error(`[EmailAPI]       - OR set SENDGRID_API_KEY environment variable`);
    console.error(`[EmailAPI]    2. Configure SMTP Settings (alternative):`);
    console.error(`[EmailAPI]       - Go to tenant settings page`);
    console.error(`[EmailAPI]       - Configure SMTP settings (host, port, user, password)`);
    console.error(`[EmailAPI] ❌ ========================================`);
    return null;
  } catch (error: any) {
    console.error(`[EmailAPI] ❌ Error fetching email config:`, error.message);
    console.error(`[EmailAPI]    Stack:`, error.stack);
    return null;
  }
}

/**
 * Send email via SendGrid API
 */
async function sendViaSendGrid(
  config: EmailConfig,
  options: SendEmailOptions
): Promise<SendEmailResult> {
  if (!config.sendgridApiKey) {
    return {
      success: false,
      error: 'SendGrid API key not configured',
      provider: 'sendgrid',
    };
  }

  try {
    const toEmails = Array.isArray(options.to) ? options.to : [options.to];
    
    // Prepare attachments for SendGrid
    const attachments = options.attachments?.map(att => {
      const content = Buffer.isBuffer(att.content) 
        ? att.content.toString('base64')
        : typeof att.content === 'string'
        ? Buffer.from(att.content).toString('base64')
        : '';

      return {
        content,
        filename: att.filename,
        type: att.contentType,
        disposition: 'attachment',
      };
    }) || [];

    const payload = {
      personalizations: [
        {
          to: toEmails.map(email => ({ email })),
          subject: options.subject,
        },
      ],
      from: { email: options.from },
      content: [
        {
          type: 'text/html',
          value: options.html,
        },
        ...(options.text ? [{
          type: 'text/plain',
          value: options.text,
        }] : []),
      ],
      ...(attachments.length > 0 && { attachments }),
      ...(options.replyTo && { reply_to: { email: options.replyTo } }),
    };

    const response = await axios.post(
      'https://api.sendgrid.com/v3/mail/send',
      payload,
      {
        headers: {
          'Authorization': `Bearer ${config.sendgridApiKey}`,
          'Content-Type': 'application/json',
        },
        timeout: 30000, // 30 seconds
      }
    );

    // SendGrid returns 202 Accepted on success
    if (response.status === 202) {
      const messageId = response.headers['x-message-id'] || `sg-${Date.now()}`;
      console.log(`[EmailAPI] ✅ Email sent via SendGrid to ${toEmails.join(', ')}`);
      console.log(`   Message ID: ${messageId}`);
      return {
        success: true,
        messageId,
        provider: 'sendgrid',
      };
    }

    return {
      success: false,
      error: `Unexpected response status: ${response.status}`,
      provider: 'sendgrid',
    };
  } catch (error: any) {
    const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
    const errorCode = error.response?.status || error.code;
    
    console.error(`[EmailAPI] ❌ SendGrid error:`, errorMessage);
    console.error(`   Status: ${errorCode}`);
    console.error(`   Response:`, error.response?.data);

    return {
      success: false,
      error: errorMessage,
      provider: 'sendgrid',
    };
  }
}

/**
 * Send email via SMTP (fallback for local development)
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
 * Main email sending function
 * Automatically chooses best provider (SendGrid API > SMTP)
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
    console.error(`[EmailAPI] ❌ CRITICAL: Email service not configured for tenant ${tenantId}`);
    console.error(`[EmailAPI]    Email will NOT be sent!`);
    console.error(`[EmailAPI]    Please configure email settings in tenant settings page`);
    return {
      success: false,
      error: 'Email service not configured for tenant. Please configure SendGrid API key or SMTP settings in tenant settings.',
    };
  }

  // Log which provider will be used
  console.log(`[EmailAPI] 📧 Sending email via ${config.provider.toUpperCase()}`);
  console.log(`   To: ${Array.isArray(options.to) ? options.to.join(', ') : options.to}`);
  console.log(`   Subject: ${options.subject}`);
  console.log(`   Attachments: ${options.attachments?.length || 0}`);

  // Try SendGrid first (production-ready)
  if (config.provider === 'sendgrid' || (config.provider === 'auto' && config.sendgridApiKey)) {
    const result = await sendViaSendGrid(config, options);
    
    // If SendGrid fails and we have SMTP fallback, try SMTP
    if (!result.success && config.smtpSettings && config.provider === 'auto') {
      console.log(`[EmailAPI] ⚠️ SendGrid failed, falling back to SMTP...`);
      return await sendViaSMTP(config, options);
    }
    
    return result;
  }

  // Use SMTP (for local development)
  if (config.provider === 'smtp' || config.smtpSettings) {
    return await sendViaSMTP(config, options);
  }

  return {
    success: false,
    error: 'No email provider configured',
  };
}

/**
 * Test email connection
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
      error: 'Email service not configured',
      hint: 'Please configure SendGrid API Key (recommended for production) or SMTP settings in the tenant settings page.',
    };
  }

  // Test SendGrid
  if (config.sendgridApiKey) {
    try {
      const response = await axios.get('https://api.sendgrid.com/v3/user/profile', {
        headers: {
          'Authorization': `Bearer ${config.sendgridApiKey}`,
        },
        timeout: 10000,
      });

      if (response.status === 200) {
        return {
          success: true,
          provider: 'sendgrid',
          message: `SendGrid API connected successfully. Account: ${response.data.email || 'Verified'}`,
        };
      }
    } catch (error: any) {
      const errorMessage = error.response?.data?.errors?.[0]?.message || error.message;
      return {
        success: false,
        provider: 'sendgrid',
        error: `SendGrid API test failed: ${errorMessage}`,
      };
    }
  }

  // Test SMTP
  if (config.smtpSettings) {
    try {
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
        connectionTimeout: 30000,
        greetingTimeout: 30000,
        socketTimeout: 30000,
        requireTLS: useTLS,
      });

      await new Promise<void>((resolve, reject) => {
        transporter.verify((error) => {
          if (error) reject(error);
          else resolve();
        });
      });

      return {
        success: true,
        provider: 'smtp',
        message: `SMTP connection verified: ${config.smtpSettings.host}:${config.smtpSettings.port}`,
      };
    } catch (error: any) {
      return {
        success: false,
        provider: 'smtp',
        error: `SMTP connection failed: ${error.message}`,
      };
    }
  }

  return {
    success: false,
    error: 'No email provider configured',
  };
}
