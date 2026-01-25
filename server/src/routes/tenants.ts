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
    
    // Allow tenant_admin, receptionist, cashier, solution_owner, customer_admin, and admin_user
    // Note: customer_admin and admin_user have restricted access (bookings only) enforced at route level
    const allowedRoles = ['tenant_admin', 'receptionist', 'cashier', 'solution_owner', 'customer_admin', 'admin_user'];
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

// Middleware to authenticate tenant admin ONLY (strict - no receptionist/cashier)
function authenticateTenantAdminOnly(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.replace('Bearer ', '');
    let decoded: any;
    try {
      decoded = jwt.verify(token, JWT_SECRET) as any;
    } catch (jwtError: any) {
      if (jwtError.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token has expired' });
      }
      return res.status(401).json({ error: 'Invalid token' });
    }
    
    // STRICT: Only tenant_admin can change currency
    if (decoded.role !== 'tenant_admin') {
      console.error('[Auth] Access denied for currency change:', {
        userId: decoded.id,
        actualRole: decoded.role,
        requiredRole: 'tenant_admin'
      });
      return res.status(403).json({ 
        error: 'Access denied. Only Service Providers (tenant admins) can change currency.',
        userRole: decoded.role
      });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
    };
    
    next();
  } catch (error: any) {
    console.error('[Auth] Authentication error:', error);
    return res.status(401).json({ error: 'Authentication failed' });
  }
}

// Get SMTP settings for tenant (block customer_admin and admin_user)
router.get('/smtp-settings', authenticateTenantAdmin, async (req, res) => {
  // Block restricted roles from accessing settings
  if (req.user?.role === 'customer_admin' || req.user?.role === 'admin_user') {
    return res.status(403).json({ 
      error: 'Access denied. This role does not have permission to access settings.',
      userRole: req.user.role
    });
  }
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
  // Block restricted roles from accessing settings
  if (req.user?.role === 'customer_admin' || req.user?.role === 'admin_user') {
    return res.status(403).json({ 
      error: 'Access denied. This role does not have permission to access settings.',
      userRole: req.user.role
    });
  }
  console.log('[Tenants Route] PUT /smtp-settings called');
  console.log('[Tenants Route] Request user:', {
    userId: req.user?.id,
    role: req.user?.role,
    tenantId: req.user?.tenant_id
  });
  
  try {
    // Centralized tenant resolution - use helper function for consistency
    const tenantId = getTenantIdForQuery(req);
    
    // For solution_owner, tenant_id can be null - they can manage any tenant
    // For other roles, tenant_id is required from JWT
    if (!tenantId && req.user?.role !== 'solution_owner') {
      console.error('[Tenant Settings] ❌ Tenant ID missing from token:', {
        userId: req.user?.id,
        role: req.user?.role,
        hasTenantId: !!req.user?.tenant_id,
        decodedToken: req.user
      });
      // Return 401 (Unauthorized) not 400 - this is an authentication/authorization issue
      return res.status(401).json({ 
        error: 'Tenant ID not found in authentication token',
        hint: 'Your account may not be associated with a tenant. Please log out and log in again, or contact support.',
        code: 'MISSING_TENANT_ID'
      });
    }
    
    // Solution owner must provide tenant_id in request body for tenant-specific operations
    if (req.user?.role === 'solution_owner' && !tenantId) {
      const bodyTenantId = req.body.tenant_id;
      if (!bodyTenantId) {
        return res.status(400).json({
          error: 'Tenant ID is required',
          hint: 'Solution Owner must provide tenant_id in the request body for tenant-specific operations.'
        });
      }
      // Use body tenant_id for solution owner
      const { 
        smtp_host, 
        smtp_port, 
        smtp_user, 
        smtp_password
      } = req.body;
      
      return await updateSmtpSettings(bodyTenantId, {
        smtp_host,
        smtp_port,
        smtp_user,
        smtp_password
      }, res);
    }
    
    // For non-solution-owner roles, tenant_id must come from JWT
    if (!tenantId) {
      console.error('[Tenant Settings] ❌ Tenant ID missing from JWT token:', {
        userId: req.user!.id,
        role: req.user!.role,
        hasTenantId: !!req.user!.tenant_id
      });
      return res.status(401).json({ 
        error: 'Tenant ID not found in authentication token',
        hint: 'Please log out and log in again. Your account may not be associated with a tenant.',
        code: 'MISSING_TENANT_ID'
      });
    }
    
    const { 
      smtp_host, 
      smtp_port, 
      smtp_user, 
      smtp_password
    } = req.body;
    
    return await updateSmtpSettings(tenantId, {
      smtp_host,
      smtp_port,
      smtp_user,
      smtp_password
    }, res);
  } catch (error: any) {
    console.error('[Tenant Settings] Unexpected error:', error);
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

// Helper function to update SMTP settings (extracted for reusability)
async function updateSmtpSettings(
  tenantId: string,
  settings: {
    smtp_host?: string;
    smtp_port?: number;
    smtp_user?: string;
    smtp_password?: string;
  },
  res: express.Response
) {
  try {
    const {
      smtp_host,
      smtp_port,
      smtp_user,
      smtp_password
    } = settings;

    console.log(`[Tenant Settings] 📝 Updating SMTP settings for tenant ${tenantId}`);

    // Get current tenant settings - verify tenant exists first
    const { data: currentTenant, error: tenantError } = await supabase
      .from('tenants')
      .select('id, smtp_settings')
      .eq('id', tenantId)
      .single();

    if (tenantError) {
      console.error(`[Tenant Settings] ❌ Database error fetching tenant ${tenantId}:`, tenantError);
      
      // Check if it's a "column does not exist" error
      if (tenantError.code === '42703' || tenantError.message?.includes('does not exist')) {
        const missingColumn = tenantError.message?.includes('email_settings') 
          ? 'email_settings' 
          : tenantError.message?.includes('smtp_settings')
          ? 'smtp_settings'
          : 'unknown column';
        
        return res.status(500).json({
          error: 'Database migration required',
          hint: `The ${missingColumn} column does not exist in the tenants table. Please run migration: 20260124000002_add_email_settings_to_tenants.sql`,
          code: 'MIGRATION_REQUIRED',
          migration: '20260124000002_add_email_settings_to_tenants.sql'
        });
      }
      
      // Check if it's a "not found" error
      if (tenantError.code === 'PGRST116' || tenantError.message?.includes('No rows')) {
        return res.status(404).json({ 
          error: 'Tenant not found',
          hint: `The tenant with ID ${tenantId} does not exist in the database. Please contact support.`,
          code: 'TENANT_NOT_FOUND'
        });
      }
      
      // Other database errors
      return res.status(500).json({
        error: 'Database error',
        hint: tenantError.message || 'Failed to fetch tenant information',
        code: 'DATABASE_ERROR'
      });
    }

    if (!currentTenant) {
      console.error(`[Tenant Settings] ❌ Tenant ${tenantId} not found in database`);
      return res.status(404).json({ 
        error: 'Tenant not found',
        hint: `The tenant with ID ${tenantId} does not exist in the database. Please contact support.`,
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Validate: SMTP credentials are required
    if (!smtp_user || !smtp_password) {
      return res.status(400).json({ 
        error: 'SMTP credentials are required',
        hint: 'Please provide SMTP host, port, email, and app password.',
        code: 'MISSING_SMTP_CONFIG'
      });
    }

    // Prepare SMTP settings
    const smtpSettings = {
      smtp_host: smtp_host || 'smtp.gmail.com',
      smtp_port: smtp_port || 587,
      smtp_user,
      smtp_password,
    };

    // Prepare update object
    const updateData: any = {
      smtp_settings: smtpSettings,
      updated_at: new Date().toISOString()
    };

    console.log(`[Tenant Settings] ✅ SMTP settings configured for tenant ${tenantId}`);

    // Update tenant settings in database
    const { data: updatedTenant, error: updateError } = await supabase
      .from('tenants')
      .update(updateData)
      .eq('id', tenantId)
      .select('id, smtp_settings')
      .single();

    if (updateError) {
      console.error(`[Tenant Settings] ❌ Database error updating tenant ${tenantId}:`, updateError);
      
      // Check if column doesn't exist
      if (updateError.code === '42703' || (updateError.message && updateError.message.includes('does not exist'))) {
        return res.status(500).json({ 
          error: 'Database migration required',
          hint: `The smtp_settings column does not exist in the tenants table. Please run migration: 20251203000001_add_smtp_settings_to_tenants.sql`,
          code: 'MIGRATION_REQUIRED',
          migration: '20251203000001_add_smtp_settings_to_tenants.sql'
        });
      }
      
      return res.status(500).json({ 
        error: 'Failed to update SMTP settings',
        hint: updateError.message || 'Database update failed',
        code: 'UPDATE_FAILED'
      });
    }
    
    if (!updatedTenant) {
      console.error(`[Tenant Settings] ❌ Tenant ${tenantId} not found after update attempt`);
      return res.status(404).json({ 
        error: 'Tenant not found',
        hint: `The tenant with ID ${tenantId} does not exist in the database.`,
        code: 'TENANT_NOT_FOUND'
      });
    }

    // Prepare response (mask sensitive data)
    const response: any = {
      success: true,
      message: 'SMTP settings updated successfully',
      provider: 'smtp',
    };

    if (updatedTenant.smtp_settings) {
      const smtpResponse = { ...updatedTenant.smtp_settings };
      smtpResponse.smtp_password = '***';
      response.smtp_settings = smtpResponse;
    }

    return res.json(response);
  } catch (error: any) {
    console.error('[Tenant Settings] Unexpected error in updateSmtpSettings:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code
    });
    return res.status(500).json({ 
      error: error.message || 'Internal server error',
      hint: 'An unexpected error occurred while updating SMTP settings',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
      code: 'INTERNAL_ERROR'
    });
  }
}

// Test email connection (SendGrid API or SMTP)
// This endpoint now uses the production-ready email API service
router.post('/smtp-settings/test', authenticateTenantAdmin, async (req, res) => {
  // Block restricted roles from accessing settings
  if (req.user?.role === 'customer_admin' || req.user?.role === 'admin_user') {
    return res.status(403).json({ 
      error: 'Access denied. This role does not have permission to access settings.',
      userRole: req.user.role
    });
  }
  console.log('[SMTP Test] ========================================');
  console.log('[SMTP Test] Email test request received');
  console.log('[SMTP Test] Tenant ID:', req.user?.tenant_id);
  console.log('[SMTP Test] ========================================');
  
  try {
    const tenantId = req.user!.tenant_id;
    const { smtp_host, smtp_port, smtp_user, smtp_password, sendgrid_api_key, from_email } = req.body;
    
    if (!tenantId) {
      console.error('[SMTP Test] ❌ Tenant ID not found');
      return res.status(400).json({ 
        success: false,
        error: 'Tenant ID not found' 
      });
    }

    // If SendGrid API key is provided in request, temporarily save it for testing
    if (sendgrid_api_key) {
      try {
        // First check if email_settings column exists
        const { data: tenant, error: tenantError } = await supabase
          .from('tenants')
          .select('smtp_settings')
          .eq('id', tenantId)
          .single();

        if (tenantError) {
          console.error('[SMTP Test] ❌ Error fetching tenant for SendGrid update:', tenantError);
          // Continue anyway - we can still test with provided credentials
        } else {
          // Try to update email_settings if column exists
          try {
            const emailSettings = {
              sendgrid_api_key,
              from_email: from_email || undefined
            };

            const { error: updateError } = await supabase
              .from('tenants')
              .update({ 
                email_settings: emailSettings,
                updated_at: new Date().toISOString()
              })
              .eq('id', tenantId);

            if (updateError) {
              console.error('[SMTP Test] ⚠️  Error updating SendGrid settings (column may not exist):', updateError.message);
              console.log('[SMTP Test] ℹ️  This is non-fatal - continuing with test using provided credentials');
              // Continue anyway - we can still test with provided credentials
            } else {
              console.log('[SMTP Test] ✅ SendGrid API key saved for testing');
            }
          } catch (updateErr: any) {
            console.error('[SMTP Test] ⚠️  Failed to update email_settings:', updateErr.message);
            console.log('[SMTP Test] ℹ️  The email_settings column may not exist. Run migration 20260124000002_add_email_settings_to_tenants.sql');
            // Continue anyway - we can still test with provided credentials
          }
        }
      } catch (err: any) {
        console.error('[SMTP Test] ⚠️  Error saving SendGrid settings:', err.message);
        // Continue anyway - we can still test
      }
    }

    // If SMTP settings are provided in request, temporarily save them for testing
    if (smtp_user && smtp_password) {
      try {
        const smtpSettings = {
          smtp_host: smtp_host || 'smtp.gmail.com',
          smtp_port: smtp_port || 587,
          smtp_user,
          smtp_password,
        };

        const { error: updateError } = await supabase
          .from('tenants')
          .update({ 
            smtp_settings: smtpSettings,
            updated_at: new Date().toISOString()
          })
          .eq('id', tenantId);

        if (updateError) {
          console.error('[SMTP Test] ⚠️  Error updating SMTP settings:', updateError);
          // Continue anyway - we can still test with provided credentials
        } else {
          console.log('[SMTP Test] ✅ SMTP settings saved for testing');
        }
      } catch (err: any) {
        console.error('[SMTP Test] ⚠️  Error saving SMTP settings:', err.message);
        // Continue anyway - we can still test with provided credentials
      }
    }

    // Test email connection using the unified email API service
    console.log(`[SMTP Test] Testing email connection for tenant ${tenantId}...`);
    
    let testResult;
    try {
      // Add timeout wrapper to prevent hanging
      // Use AbortController for better timeout handling
      const testPromise = testEmailConnection(tenantId);
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Email connection test timed out after 20 seconds'));
        }, 20000);
        
        // Clean up timeout if promise resolves first
        testPromise.finally(() => clearTimeout(timeoutId)).catch(() => {});
      });
      
      testResult = await Promise.race([testPromise, timeoutPromise]);
    } catch (timeoutError: any) {
      console.error('[SMTP Test] ❌ Test timed out or failed:', timeoutError.message);
      console.error('[SMTP Test]    Error type:', timeoutError.name);
      console.error('[SMTP Test]    Error code:', timeoutError.code);
      
      // Ensure we always send a response
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: timeoutError.message || 'Email connection test timed out',
          hint: 'The test took too long to complete. This may indicate network issues or SMTP port blocking. Consider using SendGrid API for production.',
          provider: 'smtp',
        });
      }
      return; // Response already sent
    }

    console.log('[SMTP Test] Test result:', testResult);

    if (!testResult.success) {
      console.error('[SMTP Test] ❌ Connection test failed:', testResult.error);
      // Return 400 for configuration errors, 500 for actual connection failures
      const statusCode = testResult.error?.includes('not configured') || 
                        testResult.error?.includes('No email service') 
                        ? 400 
                        : 500;
      
      return res.status(statusCode).json({
        success: false,
        error: testResult.error || 'SMTP connection test failed',
        provider: testResult.provider,
        hint: testResult.hint || 'SMTP connection failed. Please check your credentials and network settings.',
      });
    }
    
    console.log('[SMTP Test] ✅ Connection test passed, sending test email...');

    // If connection test passed, send a test email
    let tenant;
    try {
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('smtp_settings')
        .eq('id', tenantId)
        .single();

      if (tenantError) {
        console.error('[SMTP Test] ⚠️  Error fetching tenant for email details:', tenantError);
        // Use provided credentials as fallback
        tenant = null;
      } else {
        tenant = tenantData;
      }
    } catch (err: any) {
      console.error('[SMTP Test] ⚠️  Error fetching tenant:', err.message);
      tenant = null;
    }

    // Determine test email address - prioritize provided email, then tenant settings
    const testEmail = smtp_user || 
                      tenant?.smtp_settings?.smtp_user || 
                      'test@example.com';

    // Determine from email address
    const fromEmail = tenant?.smtp_settings?.smtp_user || 
                     smtp_user ||
                     'noreply@bookati.com';

    console.log('[SMTP Test] Preparing test email:');
    console.log('   From:', fromEmail);
    console.log('   To:', testEmail);
    console.log('   Provider: SMTP');

    const testEmailOptions: SendEmailOptions = {
      from: `"Bookati Test" <${fromEmail}>`,
      to: testEmail,
      subject: 'SMTP Connection Test - Bookati',
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
          <h2 style="color: #2563eb;">SMTP Connection Test</h2>
          <p>This is a test email to verify your SMTP configuration.</p>
          <p>If you received this email, your SMTP configuration is working correctly! ✅</p>
          <hr style="border: none; border-top: 1px solid #eee; margin: 20px 0;">
          <p style="color: #999; font-size: 12px;">This is an automated test email from Bookati.</p>
        </div>
      `,
    };

    let sendResult;
    try {
      console.log('[SMTP Test] Attempting to send test email...');
      // Add timeout wrapper for email sending
      const sendPromise = sendEmail(tenantId, testEmailOptions);
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timeoutId = setTimeout(() => {
          reject(new Error('Email send timed out after 30 seconds'));
        }, 30000);
        
        // Clean up timeout if promise resolves first
        sendPromise.finally(() => clearTimeout(timeoutId)).catch(() => {});
      });
      
      sendResult = await Promise.race([sendPromise, timeoutPromise]);
    } catch (timeoutError: any) {
      console.error('[SMTP Test] ❌ Email send timed out or failed:', timeoutError.message);
      console.error('[SMTP Test]    Error type:', timeoutError.name);
      console.error('[SMTP Test]    Error code:', timeoutError.code);
      
      // Ensure we always send a response
      if (!res.headersSent) {
        return res.status(500).json({
          success: false,
          error: timeoutError.message || 'Email send timed out',
          hint: 'The email send took too long to complete. This may indicate SMTP port blocking or network issues.',
          provider: 'smtp',
        });
      }
      return; // Response already sent
    }

    console.log('[SMTP Test] Send result:', sendResult);

    if (sendResult.success) {
      console.log('[SMTP Test] ✅ Test email sent successfully');
      return res.json({
        success: true,
        message: `SMTP connection test successful! Test email sent to ${testEmail}.`,
        provider: 'smtp',
        messageId: sendResult.messageId,
        testEmail,
      });
    } else {
      console.error('[SMTP Test] ❌ Email send failed:', sendResult.error);
      return res.status(500).json({
        success: false,
        error: `SMTP connection verified but email send failed: ${sendResult.error}`,
        provider: 'smtp',
        hint: 'SMTP connection works but email sending failed. Please check your SMTP credentials.',
      });
    }

  } catch (error: any) {
    console.error('[SMTP Test] ❌ ========================================');
    console.error('[SMTP Test] ❌ Unexpected error:', error);
    console.error('[SMTP Test] ❌ Error message:', error.message);
    console.error('[SMTP Test] ❌ Error code:', error.code);
    console.error('[SMTP Test] ❌ Error name:', error.name);
    console.error('[SMTP Test] ❌ Error stack:', error.stack);
    console.error('[SMTP Test] ❌ ========================================');
    
    // Ensure we always send a response, even if there was an error
    if (!res.headersSent) {
      res.status(500).json({ 
        success: false,
        error: error.message || 'SMTP connection test failed',
        code: error.code,
        hint: 'An unexpected error occurred. Please check your SMTP settings and server logs for details.',
        details: process.env.NODE_ENV === 'development' ? error.stack : undefined
      });
    } else {
      console.error('[SMTP Test] ⚠️  Response already sent, cannot send error response');
    }
  }
});

// Get WhatsApp settings for tenant
router.get('/whatsapp-settings', authenticateTenantAdmin, async (req, res) => {
  // Block restricted roles from accessing settings
  if (req.user?.role === 'customer_admin' || req.user?.role === 'admin_user') {
    return res.status(403).json({ 
      error: 'Access denied. This role does not have permission to access settings.',
      userRole: req.user.role
    });
  }
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
  // Block restricted roles from accessing settings
  if (req.user?.role === 'customer_admin' || req.user?.role === 'admin_user') {
    return res.status(403).json({ 
      error: 'Access denied. This role does not have permission to access settings.',
      userRole: req.user.role
    });
  }
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
  // Block restricted roles from accessing settings
  if (req.user?.role === 'customer_admin' || req.user?.role === 'admin_user') {
    return res.status(403).json({ 
      error: 'Access denied. This role does not have permission to access settings.',
      userRole: req.user.role
    });
  }
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

    if (!process.env.APP_URL && !redirect_uri) {
      throw new Error('Either APP_URL environment variable or redirect_uri parameter is required for Zoho OAuth');
    }
    const defaultRedirectUri = redirect_uri || `${process.env.APP_URL}/api/zoho/callback`;
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

// ============================================================================
// Currency Settings
// ============================================================================

// Get currency settings (block customer_admin and admin_user)
router.get('/currency', authenticateTenantAdmin, async (req, res) => {
  // Block restricted roles from accessing settings
  if (req.user?.role === 'customer_admin' || req.user?.role === 'admin_user') {
    return res.status(403).json({ 
      error: 'Access denied. This role does not have permission to access settings.',
      userRole: req.user.role
    });
  }
  try {
    const tenantId = req.user!.tenant_id!;

    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('currency_code')
      .eq('id', tenantId)
      .single();

    // Handle missing column gracefully (PostgreSQL error code 42703 = undefined column)
    if (error && (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist'))) {
      console.warn('[Currency] currency_code column does not exist yet, using default SAR');
      return res.json({
        currency_code: 'SAR',
      });
    }

    if (error) {
      console.error('[Currency] Error fetching currency:', error);
      return res.status(500).json({ error: 'Failed to fetch currency settings' });
    }

    res.json({
      currency_code: tenant?.currency_code || 'SAR',
    });
  } catch (error: any) {
    // Handle missing column gracefully in catch block too
    if (error.code === '42703' || error.message?.includes('column') || error.message?.includes('does not exist')) {
      console.warn('[Currency] currency_code column does not exist yet, using default SAR');
      return res.json({
        currency_code: 'SAR',
      });
    }
    console.error('[Currency] Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update currency settings (Tenant Provider only)
router.put('/currency', authenticateTenantAdminOnly, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const { currency_code } = req.body;

    // Validate currency code
    const validCurrencies = ['SAR', 'USD', 'GBP', 'EUR'];
    if (!currency_code || !validCurrencies.includes(currency_code)) {
      return res.status(400).json({
        error: 'Invalid currency code',
        valid_currencies: validCurrencies,
        hint: `Currency must be one of: ${validCurrencies.join(', ')}`
      });
    }

    // Check for pending unpaid invoices (warn but don't block)
    const { count: unpaidCount, error: countError } = await supabase
      .from('bookings')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .in('payment_status', ['unpaid', 'awaiting_payment']);

    if (countError) {
      console.warn('[Currency] Could not check unpaid invoices:', countError);
    }

    // Update currency
    const { data: updatedTenant, error: updateError } = await supabase
      .from('tenants')
      .update({ currency_code })
      .eq('id', tenantId)
      .select('currency_code')
      .single();

    if (updateError) {
      console.error('[Currency] Error updating currency:', updateError);
      return res.status(500).json({ error: 'Failed to update currency' });
    }

    console.log(`[Currency] ✅ Currency updated to ${currency_code} for tenant ${tenantId}`);

    res.json({
      success: true,
      currency_code: updatedTenant.currency_code,
      warning: unpaidCount && unpaidCount > 0
        ? `You have ${unpaidCount} unpaid booking(s). Existing invoices will keep their original currency.`
        : undefined,
    });
  } catch (error: any) {
    console.error('[Currency] Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export { router as tenantRoutes };

