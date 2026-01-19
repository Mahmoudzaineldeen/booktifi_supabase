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
    // Check for SendGrid API key in environment (global fallback)
    const sendgridApiKey = process.env.SENDGRID_API_KEY;
    
    // Check tenant-specific email settings from database
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('smtp_settings, email_settings')
      .eq('id', tenantId)
      .single();

    if (error || !tenant) {
      console.error(`[EmailAPI] ❌ Tenant ${tenantId} not found`);
      return null;
    }

    // Check if tenant has SendGrid API key configured
    const tenantSendgridKey = tenant.email_settings?.sendgrid_api_key || 
                              tenant.smtp_settings?.sendgrid_api_key;

    // Determine provider priority
    const apiKey = tenantSendgridKey || sendgridApiKey;
    
    if (apiKey) {
      return {
        provider: 'sendgrid',
        sendgridApiKey: apiKey,
      };
    }

    // Fallback to SMTP if available
    const smtpSettings = tenant.smtp_settings;
    if (smtpSettings?.smtp_user && smtpSettings?.smtp_password) {
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
    console.error(`[EmailAPI] ❌ No email configuration found for tenant ${tenantId}`);
    return null;
  } catch (error: any) {
    console.error(`[EmailAPI] ❌ Error fetching email config:`, error.message);
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
  const config = await getEmailConfig(tenantId);
  
  if (!config) {
    return {
      success: false,
      error: 'Email service not configured for tenant',
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
