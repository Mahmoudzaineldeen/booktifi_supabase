import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { testWhatsAppConnection } from '../services/whatsappService';
import { testEmailConnection, sendEmail, type SendEmailOptions } from '../services/emailApiService';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email?: string;
        role?: string;
        tenant_id?: string;
      };
    }
  }
}

// Middleware to authenticate tenant admin
function authenticateTenantAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      console.error('[Auth] No authorization header provided');
      return res.status(401).json({ 
        error: 'Authorization header required',
        hint: 'Please provide a valid Bearer token in the Authorization header'
      });
    }

    const token = authHeader.replace('Bearer ', '');
    if (!token || token.trim() === '') {
      console.error('[Auth] Empty token provided');
      return res.status(401).json({ error: 'Token is required' });
    }

    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      console.error('[Auth] JWT verification failed:', {
        error: jwtError.message,
        name: jwtError.name,
        hasJwtSecret: !!JWT_SECRET,
        jwtSecretLength: JWT_SECRET?.length || 0
      });
      
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ 
          error: 'Token has expired',
          hint: 'Please log in again to get a new token'
        });
      } else if (jwtError.name === 'JsonWebTokenError') {
        return res.status(401).json({ 
          error: 'Invalid token',
          hint: 'The token format is invalid. Please log in again.'
        });
      } else {
        return res.status(401).json({ 
          error: 'Token verification failed',
          hint: jwtError.message || 'Please log in again'
        });
      }
    }
    
    // Allow tenant_admin, receptionist, cashier, and solution_owner
    const allowedRoles = ['tenant_admin', 'receptionist', 'cashier', 'solution_owner'];
    if (!decoded.role) {
      console.error('[Auth] Token missing role:', { decoded });
      return res.status(403).json({ 
        error: 'Access denied. No role found in token. Please log in again.',
        debug: 'Token missing role field'
      });
    }
    if (!allowedRoles.includes(decoded.role)) {
      console.error('[Auth] Role not allowed:', { role: decoded.role, allowedRoles });
      return res.status(403).json({ 
        error: `Access denied. Your role "${decoded.role}" does not have permission to access this resource.`,
        userRole: decoded.role,
        allowedRoles: allowedRoles,
        hint: 'You need to be logged in as a tenant admin, receptionist, cashier, or solution owner.'
      });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
    };
    
    console.log('[Auth] Authentication successful:', {
      userId: decoded.id,
      role: decoded.role,
      tenantId: decoded.tenant_id || 'N/A'
    });
    
    next();
  } catch (error: any) {
    console.error('[Auth] Unexpected error in authentication middleware:', error);
    return res.status(401).json({ 
      error: 'Authentication failed',
      hint: error.message || 'Please log in again'
    });
  }
}

// Helper function to check if user is solution owner
function isSolutionOwner(req: express.Request): boolean {
  return req.user?.role === 'solution_owner';
}

// Helper function to get tenant_id for queries (handles solution_owner)
function getTenantIdForQuery(req: express.Request, requiredTenantId?: string): string | null {
  // If solution owner and requiredTenantId provided, use it (for tenant-specific operations)
  if (isSolutionOwner(req) && requiredTenantId) {
    return requiredTenantId;
  }
  // If solution owner without requiredTenantId, return null (for system-wide queries)
  if (isSolutionOwner(req)) {
    return null;
  }
  // For other roles, use their tenant_id
  return req.user?.tenant_id || null;
}

// Get SMTP settings for tenant
router.get('/smtp-settings', authenticateTenantAdmin, async (req, res) => {
  try {
    // Solution Owner needs to provide tenant_id in query params for tenant-specific operations
    const tenantId = req.query.tenant_id as string || req.user!.tenant_id;
    
    if (!tenantId) {
      if (isSolutionOwner(req)) {
        return res.status(400).json({ 
          error: 'Tenant ID is required. Please provide tenant_id as a query parameter.',
          hint: 'Solution Owner must specify which tenant\'s settings to retrieve.'
        });
      }
      return res.status(400).json({ error: 'Tenant ID not found' });
    }

    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('smtp_settings')
        .eq('id', tenantId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const smtpSettings = data.smtp_settings || null;
      
      // Don't send password back, only send if it exists
      if (smtpSettings && smtpSettings.smtp_password) {
        smtpSettings.smtp_password = '***'; // Mask password
      }

      res.json({ smtp_settings: smtpSettings });
    } catch (dbError: any) {
      // Check if column doesn't exist
      if (dbError.message && dbError.message.includes('column') && dbError.message.includes('smtp_settings')) {
        console.warn('⚠️  smtp_settings column does not exist. Please run migration: 20251203000001_add_smtp_settings_to_tenants.sql');
        return res.json({ smtp_settings: null });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('Error fetching SMTP settings:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Update email settings for tenant (supports both SendGrid API and SMTP)
router.put('/smtp-settings', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user?.tenant_id;
    
    // For solution_owner, tenant_id can be null - they can manage any tenant
    // For other roles, tenant_id is required
    if (!tenantId && req.user?.role !== 'solution_owner') {
      console.error('[Tenant Settings] ❌ Tenant ID missing from token:', {
        userId: req.user?.id,
        role: req.user?.role,
        hasTenantId: !!req.user?.tenant_id,
      });
      return res.status(400).json({ 
        error: 'Tenant ID not found in authentication token',
        hint: 'Your account may not be associated with a tenant. Please contact support or log in with a different account.'
      });
    }
    const { 
      smtp_host, 
      smtp_port, 
      smtp_user, 
      smtp_password,
      sendgrid_api_key,
      from_email 
    } = req.body;
    
    if (!tenantId) {
      console.error('[Tenant Settings] ❌ Tenant ID missing from JWT token:', {
        userId: req.user!.id,
        role: req.user!.role,
        hasTenantId: !!req.user!.tenant_id
      });
      return res.status(400).json({ 
        error: 'Tenant ID not found in authentication token',
        hint: 'Please log out and log in again. Your account may not be associated with a tenant.'
      });
    }

    console.log(`[Tenant Settings] 📝 Updating email settings for tenant ${tenantId}`);

    // Get current tenant settings
    const { data: currentTenant, error: tenantError } = await supabase
      .from('tenants')
      .select('smtp_settings, email_settings')
      .eq('id', tenantId)
      .single();

    if (tenantError || !currentTenant) {
      console.error(`[Tenant Settings] ❌ Tenant ${tenantId} not found in database:`, tenantError);
      return res.status(404).json({ 
        error: 'Tenant not found',
        hint: `The tenant with ID ${tenantId} does not exist in the database. Please contact support.`
      });
    }

    // Prepare update object
    const updateData: any = {
      updated_at: new Date().toISOString()
    };

    // Update SendGrid API key (recommended for production)
    if (sendgrid_api_key !== undefined) {
      const emailSettings = currentTenant.email_settings || {};
      emailSettings.sendgrid_api_key = sendgrid_api_key;
      if (from_email) {
        emailSettings.from_email = from_email;
      }
      updateData.email_settings = emailSettings;
      console.log(`[Tenant Settings] ✅ SendGrid API key configured for tenant ${tenantId}`);
    }

    // Update SMTP settings (fallback for local development)
    if (smtp_user && smtp_password) {
      const smtpSettings = {
        smtp_host: smtp_host || 'smtp.gmail.com',
        smtp_port: smtp_port || 587,
        smtp_user,
        smtp_password, // In production, this should be encrypted
      };
      updateData.smtp_settings = smtpSettings;
      console.log(`[Tenant Settings] ✅ SMTP settings configured for tenant ${tenantId}`);
    }

    // Validate: At least one email method must be configured
    if (!sendgrid_api_key && (!smtp_user || !smtp_password)) {
      return res.status(400).json({ 
        error: 'Either SendGrid API key or SMTP credentials are required',
        hint: 'For production deployments, SendGrid API is recommended to avoid SMTP port blocking issues.'
      });
    }

    try {
      const { data, error } = await supabase
        .from('tenants')
        .update(updateData)
        .eq('id', tenantId)
        .select('id, smtp_settings, email_settings')
        .single();

      if (error) {
        console.error(`[Tenant Settings] ❌ Database error updating tenant ${tenantId}:`, error);
        return res.status(500).json({ 
          error: 'Failed to update tenant settings',
          details: error.message 
        });
      }
      
      if (!data) {
        console.error(`[Tenant Settings] ❌ Tenant ${tenantId} not found after update attempt`);
        return res.status(404).json({ 
          error: 'Tenant not found',
          hint: `The tenant with ID ${tenantId} does not exist in the database.`
        });
      }

      // Prepare response (mask sensitive data)
      const response: any = {
        success: true,
        message: 'Email settings updated successfully',
      };

      if (data.smtp_settings) {
        const smtpResponse = { ...data.smtp_settings };
        smtpResponse.smtp_password = '***';
        response.smtp_settings = smtpResponse;
      }

      if (data.email_settings) {
        const emailResponse = { ...data.email_settings };
        if (emailResponse.sendgrid_api_key) {
          emailResponse.sendgrid_api_key = '***';
        }
        response.email_settings = emailResponse;
        response.provider = 'sendgrid';
      } else if (data.smtp_settings) {
        response.provider = 'smtp';
      }

      res.json(response);
    } catch (dbError: any) {
      // Check if column doesn't exist
      if (dbError.message && dbError.message.includes('column')) {
        console.error('❌ Database column does not exist. Please run migration.');
        return res.status(500).json({ 
          error: 'Database migration required',
          details: 'The email_settings or smtp_settings column may not exist in the tenants table.'
        });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('Error updating email settings:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test email connection (SendGrid API or SMTP)
// This endpoint now uses the production-ready email API service
router.post('/smtp-settings/test', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    const { smtp_host, smtp_port, smtp_user, smtp_password, sendgrid_api_key, from_email } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ 
        success: false,
        error: 'Tenant ID not found' 
      });
    }

    // If SendGrid API key is provided in request, temporarily save it for testing
    if (sendgrid_api_key) {
      const { data: tenant } = await supabase
        .from('tenants')
        .select('email_settings')
        .eq('id', tenantId)
        .single();

      const emailSettings = tenant?.email_settings || {};
      emailSettings.sendgrid_api_key = sendgrid_api_key;
      if (from_email) {
        emailSettings.from_email = from_email;
      }

      await supabase
        .from('tenants')
        .update({ 
          email_settings: emailSettings,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId);
    }

    // If SMTP settings are provided in request, temporarily save them for testing
    if (smtp_user && smtp_password) {
      const smtpSettings = {
        smtp_host: smtp_host || 'smtp.gmail.com',
        smtp_port: smtp_port || 587,
        smtp_user,
        smtp_password,
      };

      await supabase
        .from('tenants')
        .update({ 
          smtp_settings: smtpSettings,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId);
    }

    // Test email connection using the unified email API service
    console.log(`[Email Test] Testing email connection for tenant ${tenantId}...`);
    const testResult = await testEmailConnection(tenantId);

    if (!testResult.success) {
      // Return 400 for configuration errors, 500 for actual connection failures
      const statusCode = testResult.error?.includes('not configured') || 
                        testResult.error?.includes('No email service') 
                        ? 400 
                        : 500;
      
      return res.status(statusCode).json({
        success: false,
        error: testResult.error || 'Email connection test failed',
        provider: testResult.provider,
        hint: testResult.hint || (testResult.provider === 'sendgrid' 
          ? 'Please verify your SendGrid API key is correct and has permission to send emails.'
          : 'SMTP connection failed. For production deployments, consider using SendGrid API to avoid port blocking issues.'),
      });
    }

    // If connection test passed, send a test email
    const { data: tenant } = await supabase
      .from('tenants')
      .select('smtp_settings, email_settings')
      .eq('id', tenantId)
      .single();

    const testEmail = smtp_user || 
                      tenant?.email_settings?.from_email || 
                      tenant?.smtp_settings?.smtp_user || 
                      'test@example.com';

    const fromEmail = tenant?.email_settings?.from_email || 
                     tenant?.smtp_settings?.smtp_user || 
                     'noreply@bookati.com';

    const testEmailOptions: SendEmailOptions = {
      from: `"Bookati Test" <${fromEmail}>`,
      to: testEmail,
      subject: 'Email Connection Test - Bookati',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">Email Connection Test</h2>
          <p>This is a test email to verify your email configuration.</p>
          <p>If you received this email, your <strong>${testResult.provider?.toUpperCase() || 'EMAIL'}</strong> configuration is working correctly! ✅</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">This is an automated test email from Bookati.</p>
        </div>
      `,
    };

    const sendResult = await sendEmail(tenantId, testEmailOptions);

    if (sendResult.success) {
      return res.json({
        success: true,
        message: `Email connection test successful! Test email sent via ${testResult.provider?.toUpperCase() || 'EMAIL'}.`,
        provider: testResult.provider,
        messageId: sendResult.messageId,
        testEmail,
        hint: testResult.provider === 'sendgrid' 
          ? 'SendGrid API is recommended for production deployments as it avoids SMTP port blocking issues.'
          : 'Consider using SendGrid API for production to avoid SMTP connection timeouts in cloud environments.',
      });
    } else {
      return res.status(500).json({
        success: false,
        error: `Connection test passed but email send failed: ${sendResult.error}`,
        provider: testResult.provider,
        hint: 'Please verify your email configuration is correct.',
      });
    }

  } catch (error: any) {
    console.error('[SMTP Test] Unexpected error:', error);
    console.error('[SMTP Test] Error stack:', error.stack);
    res.status(500).json({ 
      success: false,
      error: error.message || 'SMTP connection test failed',
      code: error.code,
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get WhatsApp settings for tenant
router.get('/whatsapp-settings', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID not found' });
    }

    try {
      const { data, error } = await supabase
        .from('tenants')
        .select('whatsapp_settings')
        .eq('id', tenantId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const whatsappSettings = data.whatsapp_settings || null;
      
      // Mask sensitive information
      if (whatsappSettings) {
        if (whatsappSettings.access_token) {
          whatsappSettings.access_token = '***';
        }
        if (whatsappSettings.api_key) {
          whatsappSettings.api_key = '***';
        }
        if (whatsappSettings.auth_token) {
          whatsappSettings.auth_token = '***';
        }
      }

      res.json({ whatsapp_settings: whatsappSettings });
    } catch (dbError: any) {
      if (dbError.message && dbError.message.includes('column') && dbError.message.includes('whatsapp_settings')) {
        console.warn('⚠️  whatsapp_settings column does not exist. Please run migration: 20251201000000_add_whatsapp_settings_to_tenants.sql');
        return res.json({ whatsapp_settings: null });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('Error fetching WhatsApp settings:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Update WhatsApp settings for tenant
router.put('/whatsapp-settings', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    const { provider, api_url, api_key, phone_number_id, access_token, account_sid, auth_token, from } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID not found' });
    }

    if (!provider) {
      return res.status(400).json({ error: 'Provider is required' });
    }

    // Validate required fields based on provider
    if (provider === 'meta') {
      if (!phone_number_id || !access_token) {
        return res.status(400).json({ 
          error: 'Phone Number ID and Access Token are required for Meta Cloud API' 
        });
      }
    } else if (provider === 'twilio') {
      if (!account_sid || !auth_token) {
        return res.status(400).json({ 
          error: 'Account SID and Auth Token are required for Twilio' 
        });
      }
    } else if (provider === 'wati') {
      if (!api_key) {
        return res.status(400).json({ 
          error: 'API Key is required for WATI' 
        });
      }
    }

    const whatsappSettings: any = {
      provider,
    };

    // Add provider-specific settings
    if (api_url) whatsappSettings.api_url = api_url;
    if (api_key) whatsappSettings.api_key = api_key;
    if (phone_number_id) whatsappSettings.phone_number_id = phone_number_id;
    if (access_token) whatsappSettings.access_token = access_token;
    if (account_sid) whatsappSettings.account_sid = account_sid;
    if (auth_token) whatsappSettings.auth_token = auth_token;
    if (from) whatsappSettings.from = from;

    try {
      const { data, error } = await supabase
        .from('tenants')
        .update({
          whatsapp_settings: whatsappSettings,
          updated_at: new Date().toISOString()
        })
        .eq('id', tenantId)
        .select('id, whatsapp_settings')
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      // Mask sensitive info in response
      const responseSettings = { ...whatsappSettings };
      if (responseSettings.access_token) responseSettings.access_token = '***';
      if (responseSettings.api_key) responseSettings.api_key = '***';
      if (responseSettings.auth_token) responseSettings.auth_token = '***';

      res.json({ 
        success: true,
        message: 'WhatsApp settings updated successfully',
        whatsapp_settings: responseSettings
      });
    } catch (dbError: any) {
      if (dbError.message && dbError.message.includes('column') && dbError.message.includes('whatsapp_settings')) {
        console.error('❌ whatsapp_settings column does not exist. Please run migration: 20251201000000_add_whatsapp_settings_to_tenants.sql');
        return res.status(500).json({ 
          error: 'Database migration required. Please run: 20251201000000_add_whatsapp_settings_to_tenants.sql',
          details: 'The whatsapp_settings column does not exist in the tenants table.'
        });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('Error updating WhatsApp settings:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test WhatsApp connection
router.post('/whatsapp-settings/test', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    const { provider, api_url, api_key, phone_number_id, access_token, account_sid, auth_token, from } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID not found' });
    }

    // If settings not provided in body, get from database
    let config: any = {
      provider: provider,
    };

    if (!provider) {
      const { data, error } = await supabase
        .from('tenants')
        .select('whatsapp_settings')
        .eq('id', tenantId)
        .single();

      if (error || !data) {
        return res.status(404).json({ error: 'Tenant not found' });
      }

      const settings = data.whatsapp_settings;
      if (!settings || !settings.provider) {
        return res.status(400).json({ error: 'WhatsApp settings not configured. Please save settings first.' });
      }

      // Convert snake_case from database to camelCase for whatsappService
      config.provider = settings.provider;
      if (settings.api_url) config.apiUrl = settings.api_url;
      if (settings.api_key) config.apiKey = settings.api_key;
      if (settings.phone_number_id) config.phoneNumberId = settings.phone_number_id;
      if (settings.access_token) config.accessToken = settings.access_token;
      if (settings.account_sid) config.accountSid = settings.account_sid;
      if (settings.auth_token) config.authToken = settings.auth_token;
      if (settings.from) config.from = settings.from;

      // Validate required fields for Meta
      if (config.provider === 'meta' && (!config.phoneNumberId || !config.accessToken)) {
        return res.status(400).json({ 
          error: 'Phone Number ID and Access Token are required for Meta Cloud API' 
        });
      }
    } else {
      // Use provided settings - convert snake_case to camelCase for whatsappService
      config.provider = provider;
      if (api_url) config.apiUrl = api_url;
      if (api_key) config.apiKey = api_key;
      if (phone_number_id) config.phoneNumberId = phone_number_id;
      if (access_token) config.accessToken = access_token;
      if (account_sid) config.accountSid = account_sid;
      if (auth_token) config.authToken = auth_token;
      if (from) config.from = from;

      // Validate required fields based on provider
      if (provider === 'meta') {
        if (!phone_number_id || !access_token) {
          return res.status(400).json({ 
            error: 'Phone Number ID and Access Token are required for Meta Cloud API' 
          });
        }
      } else if (provider === 'twilio') {
        if (!account_sid || !auth_token) {
          return res.status(400).json({ 
            error: 'Account SID and Auth Token are required for Twilio' 
          });
        }
      } else if (provider === 'wati') {
        if (!api_key) {
          return res.status(400).json({ 
            error: 'API Key is required for WATI' 
          });
        }
      }
    }

    // Validate required fields before testing
    if (config.provider === 'meta') {
      if (!config.phoneNumberId || !config.accessToken) {
        return res.status(400).json({ 
          success: false,
          error: 'Phone Number ID and Access Token are required for Meta Cloud API',
          provider: config.provider
        });
      }
    } else if (config.provider === 'twilio') {
      if (!config.accountSid || !config.authToken) {
        return res.status(400).json({ 
          success: false,
          error: 'Account SID and Auth Token are required for Twilio',
          provider: config.provider
        });
      }
    } else if (config.provider === 'wati') {
      if (!config.apiKey) {
        return res.status(400).json({ 
          success: false,
          error: 'API Key is required for WATI',
          provider: config.provider
        });
      }
    } else if (!config.provider) {
      return res.status(400).json({ 
        success: false,
        error: 'Provider is required'
      });
    }

    // Test connection
    const testResult = await testWhatsAppConnection(config);

    if (testResult.success) {
      res.json({ 
        success: true,
        message: 'WhatsApp connection test successful!',
        provider: config.provider
      });
    } else {
      res.status(400).json({ 
        success: false,
        error: testResult.error || 'WhatsApp connection test failed',
        provider: config.provider
      });
    }
  } catch (error: any) {
    console.error('WhatsApp test error:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'WhatsApp connection test failed',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get Zoho configuration for tenant
router.get('/zoho-config', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID not found' });
    }

    try {
      const { data, error } = await supabase
        .from('tenant_zoho_configs')
        .select('id, tenant_id, client_id, redirect_uri, scopes, region, is_active, created_at, updated_at')
        .eq('tenant_id', tenantId)
        .single();

      if (error || !data) {
        return res.json({ zoho_config: null });
      }

      const config = data;
      
      // Never send client_secret back
      res.json({ 
        zoho_config: {
          id: config.id,
          tenant_id: config.tenant_id,
          client_id: config.client_id,
          redirect_uri: config.redirect_uri,
          scopes: config.scopes,
          region: config.region,
          is_active: config.is_active,
          created_at: config.created_at,
          updated_at: config.updated_at,
          has_credentials: true, // Indicates credentials are set
        }
      });
    } catch (dbError: any) {
      if (dbError.message && dbError.message.includes('relation') && dbError.message.includes('tenant_zoho_configs')) {
        console.warn('⚠️  tenant_zoho_configs table does not exist. Please run migration: 20250131000000_create_tenant_zoho_configs_table.sql');
        return res.json({ zoho_config: null });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('Error fetching Zoho config:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Update Zoho configuration for tenant
router.put('/zoho-config', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    const { client_id, client_secret, redirect_uri, scopes, region } = req.body;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID not found' });
    }

    // Validate required fields
    if (!client_id || !client_secret) {
      return res.status(400).json({ error: 'Client ID and Client Secret are required' });
    }

    const defaultRedirectUri = redirect_uri || `${process.env.APP_URL || 'https://booktifisupabase-production.up.railway.app'}/api/zoho/callback`;
    const defaultScopes = scopes || [
      'ZohoInvoice.invoices.CREATE',
      'ZohoInvoice.invoices.READ',
      'ZohoInvoice.invoices.UPDATE', // Required for payment status sync
      'ZohoInvoice.contacts.CREATE',
      'ZohoInvoice.contacts.READ'
    ];
    const defaultRegion = region || 'com';

    try {
      // Check if config exists
      const { data: existingData } = await supabase
        .from('tenant_zoho_configs')
        .select('id')
        .eq('tenant_id', tenantId)
        .single();

      let data;
      let error;
      if (existingData) {
        // Update existing
        const updateResult = await supabase
          .from('tenant_zoho_configs')
          .update({
            client_id,
            client_secret,
            redirect_uri: defaultRedirectUri,
            scopes: defaultScopes,
            region: defaultRegion,
            is_active: true,
            updated_at: new Date().toISOString()
          })
          .eq('tenant_id', tenantId)
          .select('id, tenant_id, client_id, redirect_uri, scopes, region, is_active, created_at, updated_at')
          .single();

        data = updateResult.data;
        error = updateResult.error;
      } else {
        // Insert new
        const insertResult = await supabase
          .from('tenant_zoho_configs')
          .insert({
            tenant_id: tenantId,
            client_id,
            client_secret,
            redirect_uri: defaultRedirectUri,
            scopes: defaultScopes,
            region: defaultRegion,
            is_active: true
          })
          .select('id, tenant_id, client_id, redirect_uri, scopes, region, is_active, created_at, updated_at')
          .single();

        data = insertResult.data;
        error = insertResult.error;
      }

      if (error || !data) {
        return res.status(500).json({ error: 'Failed to save Zoho configuration' });
      }

      const config = data;

      // Clear credential cache to ensure fresh data is loaded
      const { zohoCredentials } = await import('../config/zohoCredentials');
      zohoCredentials.clearTenantCache(tenantId);

      res.json({ 
        success: true,
        message: 'Zoho configuration saved successfully',
        zoho_config: {
          id: config.id,
          tenant_id: config.tenant_id,
          client_id: config.client_id,
          redirect_uri: config.redirect_uri,
          scopes: config.scopes,
          region: config.region,
          is_active: config.is_active,
          created_at: config.created_at,
          updated_at: config.updated_at,
        }
      });
    } catch (dbError: any) {
      if (dbError.message && dbError.message.includes('relation') && dbError.message.includes('tenant_zoho_configs')) {
        console.error('❌ tenant_zoho_configs table does not exist. Please run migration: 20250131000000_create_tenant_zoho_configs_table.sql');
        return res.status(500).json({ 
          error: 'Database migration required. Please run: 20250131000000_create_tenant_zoho_configs_table.sql',
          details: 'The tenant_zoho_configs table does not exist.'
        });
      }
      throw dbError;
    }
  } catch (error: any) {
    console.error('Error updating Zoho config:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Get Zoho connection status (check if tokens exist)
router.get('/zoho-status', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID not found' });
    }

    // Check if config exists
    const { data: configData } = await supabase
      .from('tenant_zoho_configs')
      .select('id, is_active')
      .eq('tenant_id', tenantId)
      .single();

    const hasConfig = configData && configData.is_active;

    // Check if tokens exist
    const { data: tokenData } = await supabase
      .from('zoho_tokens')
      .select('id, expires_at')
      .eq('tenant_id', tenantId)
      .order('created_at', { ascending: false })
      .limit(1)
      .single();

    const hasTokens = !!tokenData;
    let tokenStatus = 'not_connected';
    let tokenExpiresAt = null;

    if (hasTokens && tokenData) {
      const expiresAt = new Date(tokenData.expires_at);
      const now = new Date();
      if (expiresAt > now) {
        tokenStatus = 'connected';
        tokenExpiresAt = expiresAt.toISOString();
      } else {
        tokenStatus = 'expired';
        tokenExpiresAt = expiresAt.toISOString();
      }
    }

    res.json({
      has_config: hasConfig,
      has_tokens: hasTokens,
      connection_status: tokenStatus,
      token_expires_at: tokenExpiresAt,
    });
  } catch (error: any) {
    console.error('Error checking Zoho status:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

// Test Zoho connection (create a test invoice)
router.post('/zoho-config/test', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id;
    
    if (!tenantId) {
      return res.status(400).json({ error: 'Tenant ID not found' });
    }

    // Check if config exists
    const { data: configData } = await supabase
      .from('tenant_zoho_configs')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (!configData) {
      return res.status(400).json({
        success: false,
        error: 'Zoho configuration not found. Please save your Zoho credentials first.'
      });
    }

    // Check if tokens exist
    const { data: tokenData } = await supabase
      .from('zoho_tokens')
      .select('id')
      .eq('tenant_id', tenantId)
      .single();

    if (!tokenData) {
      return res.status(400).json({
        success: false,
        error: 'Zoho account not connected. Please connect your Zoho account first using the OAuth flow.'
      });
    }

    // Try to use Zoho service to test connection
    try {
      const { zohoService } = await import('../services/zohoService.js');
      
      // This will test if we can get an access token
      const accessToken = await zohoService.getAccessToken(tenantId);
      
      if (accessToken) {
        res.json({ 
          success: true,
          message: 'Zoho connection test successful! Your Zoho integration is working correctly.',
        });
      } else {
        res.status(400).json({ 
          success: false,
          error: 'Failed to get access token. Please reconnect your Zoho account.' 
        });
      }
    } catch (zohoError: any) {
      console.error('Zoho test error:', zohoError);
      res.status(400).json({ 
        success: false,
        error: zohoError.message || 'Zoho connection test failed. Please check your configuration and reconnect.',
      });
    }
  } catch (error: any) {
    console.error('Error testing Zoho connection:', error);
    res.status(500).json({ 
      success: false,
      error: error.message || 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

export { router as tenantRoutes };

