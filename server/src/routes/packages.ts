import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger, isVerboseLogging } from '../utils/logger';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

/** Roles allowed to access receptionist package/subscription endpoints (reception + tenant dashboard admin). Single source of truth to avoid 403 for tenant_admin. */
const RECEPTIONIST_OR_ADMIN_ROLES = ['receptionist', 'admin_user', 'tenant_admin', 'customer_admin'];

/**
 * Normalize phone number to international format
 * Handles Egyptian numbers specially: +2001032560826 -> +201032560826 (removes leading 0 after +20)
 * @param phone - Phone number in any format
 * @returns Normalized phone number in E.164 format or null if invalid
 */
function normalizePhoneNumber(phone: string): string | null {
  if (!phone || typeof phone !== 'string') {
    return null;
  }

  // Remove all spaces, dashes, and parentheses
  let cleaned = phone.replace(/[\s\-\(\)]/g, '');

  // If already in international format with +
  if (cleaned.startsWith('+')) {
    // Special handling for Egypt: +2001032560826 -> +201032560826
    if (cleaned.startsWith('+20')) {
      const afterCode = cleaned.substring(3); // Get number after +20
      // If starts with 0, remove it (Egyptian numbers: +2001032560826 -> +201032560826)
      if (afterCode.startsWith('0') && afterCode.length >= 10) {
        const withoutZero = afterCode.substring(1);
        // Validate it's a valid Egyptian mobile number (starts with 1, 2, or 5)
        if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
          return `+20${withoutZero}`;
        }
      }
      // If already correct format (+201032560826), return as is
      return cleaned;
    }
    // For other countries, return as is
    return cleaned;
  }

  // If starts with 00, replace with +
  if (cleaned.startsWith('00')) {
    cleaned = '+' + cleaned.substring(2);
    // Apply Egypt normalization if needed
    if (cleaned.startsWith('+20')) {
      const afterCode = cleaned.substring(3);
      if (afterCode.startsWith('0') && afterCode.length >= 10) {
        const withoutZero = afterCode.substring(1);
        if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
          return `+20${withoutZero}`;
        }
      }
    }
    return cleaned;
  }

  // Egyptian numbers: 01XXXXXXXX (11 digits) -> +201XXXXXXXX
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    const withoutZero = cleaned.substring(1);
    if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
      return `+20${withoutZero}`;
    }
  }

  // If starts with 20 (country code without +), add +
  if (cleaned.startsWith('20') && cleaned.length >= 12) {
    // Check if it has leading 0 after 20 (2001032560826 -> 201032560826)
    const afterCode = cleaned.substring(2);
    if (afterCode.startsWith('0') && afterCode.length >= 10) {
      const withoutZero = afterCode.substring(1);
      if (withoutZero.startsWith('1') || withoutZero.startsWith('2') || withoutZero.startsWith('5')) {
        return `+20${withoutZero}`;
      }
    }
    return `+${cleaned}`;
  }

  // If it's 10 digits starting with 1, 2, or 5 (Egyptian mobile without 0), add +20
  if (cleaned.length === 10 && (cleaned.startsWith('1') || cleaned.startsWith('2') || cleaned.startsWith('5'))) {
    return `+20${cleaned}`;
  }

  // Return null if we can't determine the format
  return null;
}

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
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'User does not belong to a tenant' });
    }

    req.user = {
      id: decoded.id,
      email: decoded.email,
      role: decoded.role,
      tenant_id: decoded.tenant_id,
    };

    next();
  } catch (error: any) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Middleware to authenticate admin user, customer admin, or tenant admin
function authenticateSubscriptionManager(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'User does not belong to a tenant' });
    }

    if (!RECEPTIONIST_OR_ADMIN_ROLES.includes(decoded.role)) {
      return res.status(403).json({ 
        error: 'Access denied',
        details: 'Only admin users, customer admins, tenant admins, and receptionists can manage subscriptions'
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
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

// Middleware to authenticate receptionist OR admin (same package/subscription capabilities, no duplicated logic)
function authenticateReceptionistOrAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'No authorization token provided' });
    }

    const token = authHeader.substring(7);
    const decoded = jwt.verify(token, JWT_SECRET) as any;

    if (!decoded.tenant_id) {
      return res.status(403).json({ error: 'User does not belong to a tenant' });
    }

    if (!RECEPTIONIST_OR_ADMIN_ROLES.includes(decoded.role)) {
      return res.status(403).json({
        error: 'Access denied',
        details: 'Only receptionists and admins can access this endpoint'
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
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

/** Create Zoho invoice for a package subscription (used by customer purchase and receptionist/admin subscribe). */
async function createInvoiceForPackageSubscription(
  tenant_id: string,
  subscription: { id: string },
  package_id: string,
  packageData: { name: string; name_ar?: string; total_price: number },
  customerData: { name: string; email?: string | null; phone?: string | null },
  options?: {
    customer_phone?: string;
    customer_email?: string;
    /** When present, record payment in Zoho so invoice becomes Paid before sending email/WhatsApp. */
    payment?: { payment_method: 'onsite' | 'transfer'; transaction_reference?: string | null };
  }
): Promise<{ zohoInvoiceId: string | null; invoiceError: string | null }> {
  let zohoInvoiceId: string | null = null;
  let invoiceError: string | null = null;
  const total_price = typeof packageData.total_price === 'number' && !Number.isNaN(packageData.total_price)
    ? packageData.total_price
    : Number(packageData.total_price) || 0;
  const customer_phone = options?.customer_phone ?? customerData.phone ?? undefined;
  const customer_email = options?.customer_email ?? customerData.email ?? undefined;

  if (isVerboseLogging()) {
    logger.info('Package subscription invoice: attempting', {}, {}, { tenant_id, subscriptionId: subscription.id, package_id, customer: customerData.name });
  }

  try {
    const { data: tenantData } = await supabase
      .from('tenants')
      .select('currency_code')
      .eq('id', tenant_id)
      .single();
    const currencyCode = tenantData?.currency_code || 'SAR';

    const { data: zohoConfig, error: zohoConfigError } = await supabase
      .from('tenant_zoho_configs')
      .select('client_id, client_secret, redirect_uri')
      .eq('tenant_id', tenant_id)
      .single();

    if (zohoConfigError || !zohoConfig?.client_id) {
      invoiceError = 'Zoho Invoice not configured for this tenant.';
      logger.warn('Package subscription invoice: skipped (Zoho not configured)', zohoConfigError || undefined, {}, { tenant_id, subscriptionId: subscription.id });
      return { zohoInvoiceId, invoiceError };
    }

    const { data: zohoToken, error: tokenError } = await supabase
      .from('zoho_tokens')
      .select('id')
      .eq('tenant_id', tenant_id)
      .single();

    if (tokenError || !zohoToken) {
      invoiceError = 'Zoho OAuth tokens not found. Complete OAuth in Settings → Zoho Integration.';
      logger.warn('Package subscription invoice: skipped (no Zoho tokens)', tokenError || undefined, {}, { tenant_id, subscriptionId: subscription.id });
      return { zohoInvoiceId, invoiceError };
    }

    const { zohoService } = await import('../services/zohoService.js');
    const packageName = packageData.name || packageData.name_ar || 'Service Package';
    let notes = `Package Subscription ID: ${subscription.id}\nPackage ID: ${package_id}`;
    if (options?.payment) {
      if (options.payment.payment_method === 'transfer' && options.payment.transaction_reference?.trim()) {
        notes += `\nPayment: Bank transfer. Reference: ${options.payment.transaction_reference.trim()}`;
      } else if (options.payment.payment_method === 'onsite') {
        notes += '\nPayment: Paid on site';
      }
    }
    const invoiceData = {
      customer_name: customerData.name,
      customer_email: customer_email || undefined,
      customer_phone: customer_phone || undefined,
      line_items: [{
        name: packageName,
        description: `Prepaid package subscription - ${packageName}`,
        rate: total_price,
        quantity: 1,
        unit: 'package'
      }],
      date: new Date().toISOString().split('T')[0],
      due_date: new Date().toISOString().split('T')[0],
      currency_code: currencyCode,
      notes
    };

    const invoiceResponse = await zohoService.createInvoice(tenant_id, invoiceData);

    if (invoiceResponse.invoice?.invoice_id) {
      zohoInvoiceId = invoiceResponse.invoice.invoice_id;
      if (isVerboseLogging()) {
        logger.info('Package subscription invoice: created', {}, {}, { subscriptionId: subscription.id, zohoInvoiceId });
      }
      // If subscription was created as paid (onsite/transfer), mark invoice as Paid in Zoho so email/WhatsApp can be sent
      if (options?.payment && total_price > 0) {
        try {
          const paymentMode = options.payment.payment_method === 'transfer' ? 'banktransfer' : 'cash';
          const referenceNumber = options.payment.transaction_reference?.trim() || (paymentMode === 'cash' ? 'Paid On Site' : '');
          const paidResult = await zohoService.ensurePackageInvoicePaid(
            tenant_id,
            zohoInvoiceId,
            total_price,
            paymentMode,
            referenceNumber
          );
          if (paidResult.success && isVerboseLogging()) {
            logger.info('Package subscription invoice: invoice marked paid in Zoho', {}, {}, { subscriptionId: subscription.id, zohoInvoiceId });
          }
          if (!paidResult.success && isVerboseLogging()) {
            logger.warn('Package subscription invoice: Zoho mark paid failed (email/WhatsApp may be skipped)', undefined, {}, { subscriptionId: subscription.id, error: paidResult.error });
          }
        } catch (err: any) {
          if (isVerboseLogging()) {
            logger.warn('Package subscription invoice: Zoho mark paid exception', err, {}, { subscriptionId: subscription.id });
          }
        }
      }
      if (invoiceData.customer_email) {
        try {
          await zohoService.sendInvoiceEmail(tenant_id, zohoInvoiceId, invoiceData.customer_email);
        } catch (_e) { /* non-blocking */ }
      }
      if (invoiceData.customer_phone) {
        const normalizedPhone = normalizePhoneNumber(invoiceData.customer_phone);
        if (normalizedPhone) {
          try {
            await zohoService.sendInvoiceViaWhatsApp(tenant_id, zohoInvoiceId, normalizedPhone);
          } catch (_e) { /* non-blocking */ }
        }
      }
      let updateErr: any = null;
      const { error: err1 } = await supabase
        .from('package_subscriptions')
        .update({ zoho_invoice_id: zohoInvoiceId, payment_status: 'paid' })
        .eq('id', subscription.id);
      updateErr = err1;
      if (updateErr) {
        const isColumnError = String(updateErr.message || '').includes('column');
        if (isColumnError) {
          const { error: err2 } = await supabase
            .from('package_subscriptions')
            .update({ zoho_invoice_id: zohoInvoiceId })
            .eq('id', subscription.id);
          if (!err2) updateErr = null;
        }
        if (updateErr && isVerboseLogging()) {
          logger.warn('Create invoice: failed to update subscription with invoice id', updateErr, {}, { subscriptionId: subscription.id });
        }
      }
      // Do not set invoiceError — invoice was created and possibly sent; only DB link may have failed
    } else {
      invoiceError = invoiceResponse.message || 'Failed to create invoice';
      logger.warn('Package subscription invoice: Zoho returned no invoice_id', undefined, {}, { subscriptionId: subscription.id, message: invoiceError });
    }
  } catch (err: any) {
    invoiceError = err?.message || 'Failed to create invoice';
    logger.error('Package subscription invoice: exception', err, {}, { tenant_id, subscriptionId: subscription.id });
  }
  return { zohoInvoiceId, invoiceError };
}

// ============================================================================
// Create Package (Atomic Transaction)
// NOTE: Minimum requirement is 1 service (updated from 2 services)
// ============================================================================
router.post('/', authenticateTenantAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const {
      name,
      name_ar,
      description,
      description_ar,
      total_price,
      original_price,
      discount_percentage,
      image_url,
      gallery_urls,
      is_active = true,
      service_ids, // Array of service IDs (backward compatibility)
      services, // Array of { service_id, capacity_total } objects (new format)
    } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Package name is required' });
    }

    if (!name_ar || !name_ar.trim()) {
      return res.status(400).json({ error: 'Package name in Arabic is required' });
    }

    // Support both old format (service_ids) and new format (services with capacity)
    // NOTE: Minimum requirement is 1 service (changed from 2)
    let serviceData: Array<{ service_id: string; capacity_total: number }> = [];
    
    if (services && Array.isArray(services) && services.length > 0) {
      // New format: services array with capacity_total
      serviceData = services.map((s: any) => ({
        service_id: typeof s === 'string' ? s : s.service_id,
        capacity_total: typeof s === 'object' && s.capacity_total ? s.capacity_total : 5
      }));
    } else if (service_ids && Array.isArray(service_ids) && service_ids.length > 0) {
      // Old format: just service IDs (backward compatibility)
      serviceData = service_ids.map((id: string) => ({
        service_id: id,
        capacity_total: 5 // Default capacity
      }));
    }

    // Validate: Require at least 1 service (minimum changed from 2 to 1)
    if (serviceData.length < 1) {
      return res.status(400).json({ 
        error: 'At least 1 service is required for a package',
        hint: 'Please select at least 1 service'
      });
    }
    
    // Log for debugging

    // Extract and validate service IDs
    const serviceIds = serviceData
      .map(s => {
        const id = typeof s.service_id === 'string' ? s.service_id.trim() : String(s.service_id || '').trim();
        return id;
      })
      .filter(id => id && id.length > 0);
    
    if (serviceIds.length === 0) {
      if (isVerboseLogging()) logger.warn('Create Package: no valid service IDs', undefined, {}, { serviceDataLength: serviceData?.length });
      return res.status(400).json({ 
        error: 'No valid service IDs found',
        hint: 'Please ensure all services have valid service IDs',
        received_data: serviceData
      });
    }

    // Validate service IDs are valid UUIDs
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const invalidUuids = serviceIds.filter(id => !uuidRegex.test(id));
    if (invalidUuids.length > 0) {
      if (isVerboseLogging()) logger.warn('Create Package: invalid UUIDs', undefined, {}, { invalidUuids });
      return res.status(400).json({ 
        error: 'Invalid service ID format',
        hint: 'Service IDs must be valid UUIDs',
        invalid_ids: invalidUuids
      });
    }


    if (typeof total_price !== 'number' || total_price < 0) {
      return res.status(400).json({ error: 'Total price must be a non-negative number' });
    }

    // Validate service IDs exist and belong to tenant
    const { data: validServices, error: servicesError } = await supabase
      .from('services')
      .select('id, tenant_id, base_price, name')
      .in('id', serviceIds)
      .eq('tenant_id', tenantId);

    if (servicesError) {
      if (isVerboseLogging()) logger.error('Create Package: validate services', servicesError, {}, {});
      return res.status(500).json({ 
        error: 'Failed to validate services',
        details: servicesError.message 
      });
    }


    if (!validServices || validServices.length === 0) {
      // Get all services for this tenant to help debug
      const { data: allTenantServices } = await supabase
        .from('services')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .limit(10);
      
      
      return res.status(400).json({ 
        error: 'No valid services found',
        hint: `Selected services do not exist or do not belong to your tenant. Requested IDs: ${serviceIds.join(', ')}`,
        debug: {
          requested_service_ids: serviceIds,
          tenant_id: tenantId,
          available_services_count: allTenantServices?.length || 0
        }
      });
    }

    if (validServices.length !== serviceIds.length) {
      const foundIds = new Set(validServices.map(s => s.id));
      const missingIds = serviceIds.filter(id => !foundIds.has(id));
      if (isVerboseLogging()) logger.warn('Create Package: some services invalid', undefined, {}, { missingIds });
      return res.status(400).json({ 
        error: 'Some services are invalid',
        details: `The following service IDs are invalid or do not belong to your tenant: ${missingIds.join(', ')}`,
        valid_service_ids: Array.from(foundIds)
      });
    }

    // Prepare package payload
    const packagePayload: any = {
      tenant_id: tenantId,
      name: name.trim(),
      name_ar: name_ar.trim(),
      description: description?.trim() || null,
      description_ar: description_ar?.trim() || null,
      total_price: total_price,
      original_price: original_price || null,
      discount_percentage: discount_percentage || null,
      image_url: image_url || null,
      gallery_urls: Array.isArray(gallery_urls) ? gallery_urls : (gallery_urls ? [gallery_urls] : []),
      is_active: is_active,
    };

    // Create package
    const { data: newPackage, error: packageError } = await supabase
      .from('service_packages')
      .insert(packagePayload)
      .select()
      .single();

    if (packageError) {
      if (isVerboseLogging()) logger.error('Create Package: insert failed', packageError, {}, {});
      return res.status(500).json({ 
        error: 'Failed to create package',
        details: packageError.message || packageError.code || 'Unknown error'
      });
    }

    if (!newPackage || !newPackage.id) {
      if (isVerboseLogging()) logger.error('Create Package: no data returned', undefined, {}, {});
      return res.status(500).json({ error: 'Package creation failed - no ID returned' });
    }

    // Create package_services entries with capacity_total
    const packageServices = serviceData.map((s) => ({
      package_id: newPackage.id,
      service_id: s.service_id.trim(),
      capacity_total: s.capacity_total || 5, // Default to 5 if not provided
    }));

    const { data: insertedServices, error: servicesInsertError } = await supabase
      .from('package_services')
      .insert(packageServices)
      .select();

    if (servicesInsertError) {
      if (isVerboseLogging()) logger.error('Create Package: insert services failed', servicesInsertError, {}, {});
      
      // CRITICAL: Rollback - delete the package
      const { error: deleteError } = await supabase
        .from('service_packages')
        .delete()
        .eq('id', newPackage.id)
        .select();

      if (deleteError) {
        if (isVerboseLogging()) logger.error('Create Package: rollback failed', deleteError, {}, {});
        return res.status(500).json({ 
          error: 'Failed to create package services and rollback failed',
          details: `Service insertion error: ${servicesInsertError.message || servicesInsertError.code}. Rollback error: ${deleteError.message || deleteError.code}`,
          warning: 'Package may exist in database without services. Please delete it manually.'
        });
      }

      return res.status(500).json({ 
        error: 'Failed to add services to package. Package creation was rolled back.',
        details: servicesInsertError.message || servicesInsertError.code || 'Unknown error'
      });
    }

    if (!insertedServices || insertedServices.length === 0) {
      if (isVerboseLogging()) logger.error('Create Package: no services inserted', undefined, {}, {});
      
      // Rollback
      const { error: deleteError } = await supabase
        .from('service_packages')
        .delete()
        .eq('id', newPackage.id);

      if (deleteError) {
        if (isVerboseLogging()) logger.error('Create Package: rollback failed', deleteError, {}, {});
      }

      return res.status(500).json({ 
        error: 'No services were inserted. Package creation was rolled back.',
        warning: 'Please verify package was deleted'
      });
    }

    // Verify all services were inserted
    if (insertedServices.length !== serviceData.length) {
      if (isVerboseLogging()) logger.warn('Create Package: service count mismatch', undefined, {}, { expected: serviceData.length, inserted: insertedServices.length });
    }

    // Fetch complete package with services
    const { data: completePackage, error: fetchError } = await supabase
      .from('service_packages')
      .select(`
        *,
        package_services (
          id,
          service_id,
          quantity,
          services (
            id,
            name,
            name_ar,
            base_price
          )
        )
      `)
      .eq('id', newPackage.id)
      .single();

    if (fetchError) {
      if (isVerboseLogging()) logger.warn('Create Package: fetch package failed', fetchError, {}, {});
      // Still return success since package and services were created
    }

    if (isVerboseLogging()) logger.info('Create Package success', undefined, { packageId: newPackage.id, servicesCount: insertedServices.length });

    res.status(201).json({
      success: true,
      message: 'Package created successfully',
      package: completePackage || newPackage,
      services_count: insertedServices.length,
    });

  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Create package error', error, context);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: 'An unexpected error occurred while creating the package'
    });
  }
});

// ============================================================================
// Update Package
// ============================================================================
router.put('/:id', authenticateTenantAdmin, async (req, res) => {
  try {
    const packageId = req.params.id;
    const tenantId = req.user!.tenant_id!;
    const updateData = req.body;

    // Get current package to verify ownership
    const { data: currentPackage, error: fetchError } = await supabase
      .from('service_packages')
      .select('id, tenant_id')
      .eq('id', packageId)
      .single();

    if (fetchError || !currentPackage) {
      return res.status(404).json({ error: 'Package not found' });
    }

    if (currentPackage.tenant_id !== tenantId) {
      return res.status(403).json({ error: 'Access denied. This package belongs to a different tenant.' });
    }

    // Update package
    const { data: updatedPackage, error: updateError } = await supabase
      .from('service_packages')
      .update({
        ...updateData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', packageId)
      .select()
      .single();

    if (updateError) {
      if (isVerboseLogging()) logger.error('Update Package failed', updateError, {}, {});
      return res.status(500).json({ 
        error: 'Failed to update package',
        details: updateError.message || updateError.code || 'Unknown error'
      });
    }

    res.json({
      success: true,
      message: 'Package updated successfully',
      package: updatedPackage,
    });

  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Update package error', error, context);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// Create Package Subscription (Customer Purchase)
// ============================================================================
router.post('/subscriptions', async (req, res) => {
  try {
    const {
      tenant_id,
      package_id,
      customer_id,
      customer_name,
      customer_phone,
      customer_email,
      total_price,
      payment_method: reqPaymentMethod,
      transaction_reference: reqTransactionRef,
      payment_status: reqPaymentStatus, // Optional: 'pending' | 'paid' — when 'pending', invoice is created when marked paid later
    } = req.body;

    // Validate payment method + transaction reference (same as bookings)
    if (reqPaymentMethod === 'transfer') {
      const refVal = reqTransactionRef != null ? String(reqTransactionRef).trim() : '';
      if (!refVal) {
        return res.status(400).json({ error: 'transaction_reference is required when payment method is transfer (حوالة)' });
      }
    }

    // Validation
    if (!tenant_id || !package_id) {
      return res.status(400).json({ error: 'Tenant ID and Package ID are required' });
    }

    // ============================================================================
    // MAINTENANCE MODE CHECK - Block customers only
    // ============================================================================
    // Extract user role from token if present
    let userRole: string | undefined;
    try {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        const token = authHeader.replace('Bearer ', '');
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        userRole = decoded.role;
      }
    } catch (error) {
      // Continue without auth - will be treated as customer
    }

    // For customers or unauthenticated users, check maintenance mode
    if (!userRole || userRole === 'customer') {
      const { data: tenantData, error: tenantError } = await supabase
        .from('tenants')
        .select('maintenance_mode')
        .eq('id', tenant_id)
        .single();

      if (!tenantError && tenantData && tenantData.maintenance_mode === true) {
        return res.status(403).json({
          error: 'Bookings are temporarily disabled. Please visit us in person to make a reservation.',
          code: 'BOOKING_DISABLED_MAINTENANCE'
        });
      }
    }
    // Staff roles can always create subscriptions

    if (!customer_id && (!customer_name || !customer_phone)) {
      return res.status(400).json({ error: 'Customer ID or customer name and phone are required' });
    }

    // Verify package exists and belongs to tenant
    const { data: packageData, error: packageError } = await supabase
      .from('service_packages')
      .select('id, tenant_id, total_price, name, name_ar')
      .eq('id', package_id)
      .eq('tenant_id', tenant_id)
      .eq('is_active', true)
      .single();

    if (packageError || !packageData) {
      return res.status(404).json({ error: 'Package not found or inactive' });
    }

    // Verify price matches
    if (total_price !== packageData.total_price) {
      return res.status(400).json({ error: 'Price mismatch' });
    }

    let finalCustomerId = customer_id;

    // Create customer if customer_id not provided
    if (!finalCustomerId) {
      // Check if customer exists by phone
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id')
        .eq('tenant_id', tenant_id)
        .eq('phone', customer_phone)
        .maybeSingle();

      if (existingCustomer) {
        finalCustomerId = existingCustomer.id;
      } else {
        // Create new customer
        const { data: newCustomer, error: customerError } = await supabase
          .from('customers')
          .insert({
            tenant_id,
            name: customer_name,
            phone: customer_phone,
            email: customer_email || null,
          })
          .select()
          .single();

        if (customerError || !newCustomer) {
          return res.status(500).json({ 
            error: 'Failed to create customer',
            details: customerError?.message 
          });
        }

        finalCustomerId = newCustomer.id;
      }
    }

    // Get package services to calculate total capacity
    const { data: packageServices, error: servicesError } = await supabase
      .from('package_services')
      .select('service_id, capacity_total')
      .eq('package_id', package_id);

    if (servicesError) {
      if (isVerboseLogging()) logger.error('Create Subscription: fetch package services', servicesError, {}, {});
      return res.status(500).json({ 
        error: 'Failed to fetch package services',
        details: servicesError.message 
      });
    }

    // Check if package has any services
    if (!packageServices || packageServices.length === 0) {
      if (isVerboseLogging()) logger.error('Create Subscription: package has no services', undefined, {}, { package_id, package_name: packageData?.name });
      
      // Try to get package name for better error message
      const { data: pkgInfo } = await supabase
        .from('service_packages')
        .select('name, name_ar')
        .eq('id', package_id)
        .single();
      
      return res.status(400).json({ 
        error: 'Package has no services',
        details: 'This package does not have any services configured. Please contact the administrator to add services to this package before purchasing.',
        package_id,
        package_name: pkgInfo?.name || 'Unknown',
        hint: 'The package may have been created incorrectly or services may have been removed. Please verify the package configuration in the admin panel.'
      });
    }

    // Calculate total capacity (sum of all service capacities)
    // Use capacity_total if available, otherwise default to 1 per service
    const totalCapacity = packageServices.reduce((sum, ps) => {
      const capacity = ps.capacity_total;
      const validCapacity = (capacity && typeof capacity === 'number' && capacity > 0) ? capacity : 1;
      return sum + validCapacity;
    }, 0);

    if (totalCapacity === 0) {
      if (isVerboseLogging()) logger.error('Create Subscription: total capacity 0', undefined, {}, { package_id, services_count: packageServices?.length });
      return res.status(400).json({ 
        error: 'Package has no capacity',
        details: 'Package must have at least one service with capacity > 0. Please check the package configuration.'
      });
    }

    // Create package subscription
    // Build subscription data - try to include all possible columns for schema compatibility
    const subscriptionData: any = {
      tenant_id,
      package_id,
      customer_id: finalCustomerId,
    };
    if (reqPaymentStatus === 'pending' || reqPaymentStatus === 'paid') {
      subscriptionData.payment_status = reqPaymentStatus;
    }
    if (reqPaymentMethod === 'onsite' || reqPaymentMethod === 'transfer') {
      subscriptionData.payment_method = reqPaymentMethod;
      subscriptionData.transaction_reference = reqPaymentMethod === 'transfer' && reqTransactionRef != null ? String(reqTransactionRef).trim() : null;
    }

    // Try to add new schema columns (may not exist in older migrations)
    // Check error to see if columns don't exist, then retry without them
    subscriptionData.total_quantity = totalCapacity;
    subscriptionData.remaining_quantity = totalCapacity;
    subscriptionData.is_active = true;
    subscriptionData.status = 'active'; // For old schema compatibility

    let subscription;
    let subscriptionError;

    // First attempt: try with all columns
    const insertResult = await supabase
      .from('package_subscriptions')
      .insert(subscriptionData)
      .select()
      .single();

    subscription = insertResult.data;
    subscriptionError = insertResult.error;

    // If error is about missing columns, try with minimal schema
    if (subscriptionError && (
      subscriptionError.message?.includes('column') && 
      (subscriptionError.message?.includes('total_quantity') || 
       subscriptionError.message?.includes('remaining_quantity'))
    )) {
      if (isVerboseLogging()) logger.warn('Create Subscription: trying old schema', undefined, {}, {});
      
      // Retry with old schema (status only, no total_quantity/remaining_quantity)
      const oldSchemaData = {
        tenant_id,
        package_id,
        customer_id: finalCustomerId,
        status: 'active',
      };

      const oldSchemaResult = await supabase
        .from('package_subscriptions')
        .insert(oldSchemaData)
        .select()
        .single();

      subscription = oldSchemaResult.data;
      subscriptionError = oldSchemaResult.error;
    }

    if (subscriptionError) {
      if (isVerboseLogging()) logger.error('Create Subscription: insert failed', subscriptionError, {}, { code: subscriptionError?.code });
      
      return res.status(500).json({ 
        error: 'Failed to create package subscription',
        details: subscriptionError.message || subscriptionError.error || 'Unknown error',
        code: subscriptionError.code,
        hint: subscriptionError.hint
      });
    }

    if (!subscription) {
      return res.status(500).json({ 
        error: 'Failed to create package subscription',
        details: 'No subscription data returned from database'
      });
    }

    // Initialize package usage records (trigger should handle this, but ensure it exists)
    // The trigger initialize_package_usage() should create package_subscription_usage records

    // Create Zoho invoice for package purchase (prepaid) — same path as receptionist/admin subscribe
    let zohoInvoiceId: string | null = null;
    let invoiceError: string | null = null;
    const { data: customerDataForInvoice } = await supabase
      .from('customers')
      .select('name, email, phone')
      .eq('id', finalCustomerId)
      .single();

    // When payment_status is 'unpaid', skip invoice at creation; invoice is created when marked paid later.
    if (!customerDataForInvoice) {
      invoiceError = 'Customer not found for invoice';
    } else if (reqPaymentStatus === 'pending') {
      // Skip invoice — will be created when subscription is marked paid
      if (isVerboseLogging()) logger.info('Package subscription: created as pending (not paid), invoice will be created when marked paid', {}, {}, { subscriptionId: subscription.id });
    } else {
      const invoiceOptions: { customer_phone?: string; customer_email?: string; payment?: { payment_method: 'onsite' | 'transfer'; transaction_reference?: string | null } } = {
        customer_phone: customer_phone,
        customer_email: customer_email || undefined,
      };
      if (reqPaymentMethod === 'onsite' || reqPaymentMethod === 'transfer') {
        invoiceOptions.payment = {
          payment_method: reqPaymentMethod,
          transaction_reference: reqTransactionRef != null ? String(reqTransactionRef).trim() : undefined,
        };
      }
      const result = await createInvoiceForPackageSubscription(
        tenant_id,
        subscription,
        package_id,
        { name: packageData.name, name_ar: packageData.name_ar, total_price: packageData.total_price },
        { name: customerDataForInvoice.name, email: customerDataForInvoice.email ?? undefined, phone: customerDataForInvoice.phone ?? undefined },
        invoiceOptions
      );
      zohoInvoiceId = result.zohoInvoiceId;
      invoiceError = result.invoiceError;
    }

    // Return success even if invoice creation failed (subscription is created)
    // Invoice error will be logged but won't block the subscription
    res.status(201).json({
      success: true,
      message: 'Package subscription created successfully',
      subscription,
      invoice: zohoInvoiceId ? {
        id: zohoInvoiceId,
        status: 'created'
      } : null,
      invoice_error: invoiceError || undefined
    });

  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Create package subscription error', error, context);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: 'An unexpected error occurred while creating the package subscription'
    });
  }
});

// ============================================================================
// Cancel Package Subscription
// Allowed roles: admin_user, customer_admin, tenant_admin, receptionist
// ============================================================================
router.put('/subscriptions/:subscriptionId/cancel', authenticateSubscriptionManager, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const { subscriptionId } = req.params;

    if (!subscriptionId) {
      return res.status(400).json({ error: 'Subscription ID is required' });
    }

    // Verify subscription exists and belongs to tenant
    const { data: subscription, error: fetchError } = await supabase
      .from('package_subscriptions')
      .select('id, tenant_id, status, is_active')
      .eq('id', subscriptionId)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError) {
      return res.status(404).json({ 
        error: 'Subscription not found',
        details: fetchError.message || 'The subscription does not exist or does not belong to your tenant'
      });
    }

    if (!subscription) {
      return res.status(404).json({ 
        error: 'Subscription not found',
        details: 'The subscription does not exist or does not belong to your tenant'
      });
    }

    // Check if already cancelled
    if (subscription.status === 'cancelled' || subscription.is_active === false) {
      return res.status(400).json({ 
        error: 'Subscription already cancelled',
        details: 'This subscription has already been cancelled'
      });
    }

    // Update subscription to cancelled
    // Build update data based on what columns exist
    const updateData: any = {
      status: 'cancelled'
    };
    
    // Only add is_active if the subscription has that property (check from fetched data)
    if (subscription.hasOwnProperty('is_active') || subscription.is_active !== undefined) {
      updateData.is_active = false;
    }

    const { data: updatedSubscription, error: updateError } = await supabase
      .from('package_subscriptions')
      .update(updateData)
      .eq('id', subscriptionId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (updateError) {
      // If error is about missing columns, try with old schema (status only)
      if (updateError.message?.includes('column') && updateError.message?.includes('is_active')) {
        
        const oldSchemaUpdate = {
          status: 'cancelled'
          // updated_at is typically auto-managed, so we don't set it explicitly
        };

        const { data: oldUpdated, error: oldError } = await supabase
          .from('package_subscriptions')
          .update(oldSchemaUpdate)
          .eq('id', subscriptionId)
          .eq('tenant_id', tenantId)
          .select()
          .single();

        if (oldError) {
          return res.status(500).json({ 
            error: 'Failed to cancel subscription',
            details: oldError.message || 'Unknown error',
            code: oldError.code
          });
        }

        return res.json({
          success: true,
          message: 'Package subscription cancelled successfully',
          subscription: oldUpdated
        });
      }

      return res.status(500).json({ 
        error: 'Failed to cancel subscription',
        details: updateError.message || 'Unknown error',
        code: updateError.code,
        hint: updateError.hint
      });
    }

    if (!updatedSubscription) {
      return res.status(500).json({ 
        error: 'Failed to cancel subscription',
        details: 'Update succeeded but no subscription data returned'
      });
    }

    res.json({
      success: true,
      message: 'Package subscription cancelled successfully',
      subscription: updatedSubscription
    });

  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Cancel package subscription error', error, context);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: 'An unexpected error occurred while cancelling the subscription'
    });
  }
});

// ============================================================================
// PATCH /subscriptions/:subscriptionId/payment-status - Edit payment status (admin/reception)
// ============================================================================
router.patch('/subscriptions/:subscriptionId/payment-status', authenticateSubscriptionManager, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const { subscriptionId } = req.params;
    const { payment_status, payment_method, transaction_reference } = req.body;

    if (!subscriptionId) {
      return res.status(400).json({ error: 'Subscription ID is required' });
    }

    const validStatuses = ['paid', 'pending', 'failed'];
    if (payment_status != null && !validStatuses.includes(String(payment_status))) {
      return res.status(400).json({ error: 'Invalid payment_status. Must be paid, pending, or failed.' });
    }

    const payMethod = payment_method === 'transfer' ? 'transfer' : payment_method === 'onsite' ? 'onsite' : undefined;
    if (payMethod === 'transfer') {
      const refVal = transaction_reference != null ? String(transaction_reference).trim() : '';
      if (!refVal) {
        return res.status(400).json({ error: 'transaction_reference is required when payment method is transfer (حوالة)' });
      }
    }

    const { data: subscription, error: fetchError } = await supabase
      .from('package_subscriptions')
      .select('id, tenant_id, package_id, customer_id, zoho_invoice_id')
      .eq('id', subscriptionId)
      .eq('tenant_id', tenantId)
      .single();

    if (fetchError || !subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    // When marking as paid and no invoice yet (e.g. created as pending), create invoice first then update
    if (payment_status === 'paid' && !(subscription as any).zoho_invoice_id) {
      const { data: subFull, error: subErr } = await supabase
        .from('package_subscriptions')
        .select('id, tenant_id, package_id, customer_id')
        .eq('id', subscriptionId)
        .eq('tenant_id', tenantId)
        .single();
      if (!subErr && subFull) {
        const { data: pkg } = await supabase.from('service_packages').select('id, name, name_ar, total_price').eq('id', (subFull as any).package_id).single();
        const { data: cust } = await supabase.from('customers').select('id, name, phone, email').eq('id', (subFull as any).customer_id).single();
        if (pkg && cust) {
          const invoiceOptions: { customer_phone?: string; customer_email?: string; payment?: { payment_method: 'onsite' | 'transfer'; transaction_reference?: string | null } } = {
            customer_phone: (cust as any).phone ?? undefined,
            customer_email: (cust as any).email ?? undefined,
          };
          if (payMethod === 'transfer' || payMethod === 'onsite') {
            invoiceOptions.payment = {
              payment_method: payMethod || 'onsite',
              transaction_reference: payMethod === 'transfer' && transaction_reference != null ? String(transaction_reference).trim() : undefined,
            };
          }
          await createInvoiceForPackageSubscription(
            tenantId,
            subFull,
            (subFull as any).package_id,
            { name: (pkg as any).name, name_ar: (pkg as any).name_ar, total_price: (pkg as any).total_price },
            { name: (cust as any).name, email: (cust as any).email ?? undefined, phone: (cust as any).phone ?? undefined },
            invoiceOptions
          );
          // createInvoiceForPackageSubscription already updates subscription with zoho_invoice_id and payment_status 'paid'
        }
      }
    }

    const updatePayload: Record<string, unknown> = {};
    if (payment_status != null) updatePayload.payment_status = payment_status;
    if (payMethod !== undefined) updatePayload.payment_method = payMethod;
    if (payMethod === 'transfer' && transaction_reference != null) {
      updatePayload.transaction_reference = String(transaction_reference).trim();
    } else if (payMethod === 'onsite' || (payment_status != null && payMethod === undefined)) {
      updatePayload.transaction_reference = null;
    }

    if (Object.keys(updatePayload).length === 0) {
      return res.status(400).json({ error: 'No payment fields to update. Provide payment_status and/or payment_method.' });
    }

    const { data: updated, error: updateError } = await supabase
      .from('package_subscriptions')
      .update(updatePayload)
      .eq('id', subscriptionId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({ error: 'Failed to update payment status', details: updateError.message });
    }

    res.json({ success: true, subscription: updated });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Update subscription payment status error', error, context);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// GET /subscriptions/:subscriptionId/invoice/download - Download package subscription invoice PDF
// ============================================================================
router.get('/subscriptions/:subscriptionId/invoice/download', authenticateSubscriptionManager, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const { subscriptionId } = req.params;

    if (!subscriptionId) {
      return res.status(400).json({ error: 'Subscription ID is required' });
    }

    const { data: subscription, error } = await supabase
      .from('package_subscriptions')
      .select('id, tenant_id, zoho_invoice_id')
      .eq('id', subscriptionId)
      .eq('tenant_id', tenantId)
      .single();

    if (error || !subscription) {
      return res.status(404).json({ error: 'Subscription not found' });
    }

    const invoiceId = (subscription as any).zoho_invoice_id;
    if (!invoiceId || typeof invoiceId !== 'string') {
      return res.status(404).json({ error: 'No invoice found for this subscription' });
    }

    const { zohoService } = await import('../services/zohoService.js');
    const pdfBuffer = await zohoService.downloadInvoicePdf(tenantId, invoiceId);

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="subscription-invoice-${subscriptionId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length.toString());
    res.send(pdfBuffer);
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Download subscription invoice error', error, context);
    res.status(500).json({
      error: error.message || 'Failed to download invoice',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined,
    });
  }
});

// ============================================================================
// RECEPTIONIST PACKAGE MANAGEMENT ENDPOINTS
// Receptionists can view packages and subscribe customers, but NOT edit/delete
// ============================================================================

// ============================================================================
// GET /receptionist/packages and GET /tenant/packages - List packages (reception + tenant dashboard)
// Use authenticateSubscriptionManager so tenant_admin/customer_admin are allowed (single source of truth).
// ============================================================================
async function handleGetPackagesForReceptionOrTenant(req: express.Request, res: express.Response) {
  try {
    const tenantId = req.user!.tenant_id!;
    const { search, service_id } = req.query;

    // Build query
    let query = supabase
      .from('service_packages')
      .select(`
        id,
        name,
        name_ar,
        description,
        description_ar,
        total_price,
        original_price,
        discount_percentage,
        is_active,
        package_services (
          service_id,
          capacity_total,
          services (
            id,
            name,
            name_ar
          )
        )
      `)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .order('name');

    // Search by package name
    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = search.trim();
      query = query.or(`name.ilike.%${searchTerm}%,name_ar.ilike.%${searchTerm}%`);
    }

    // Filter by service if provided
    if (service_id && typeof service_id === 'string') {
      const { data: packageServices } = await supabase
        .from('package_services')
        .select('package_id')
        .eq('service_id', service_id);

      if (packageServices && packageServices.length > 0) {
        const packageIds = packageServices.map((ps: any) => ps.package_id);
        query = query.in('id', packageIds);
      } else {
        return res.json({ packages: [] });
      }
    }

    const { data: packages, error } = await query;

    if (error) {
      if (isVerboseLogging()) logger.error('Get Packages failed', error, {}, {});
      return res.status(500).json({
        error: 'Failed to fetch packages',
        details: error.message,
      });
    }

    const formattedPackages = (packages || []).map((pkg: any) => ({
      id: pkg.id,
      name: pkg.name,
      name_ar: pkg.name_ar,
      description: pkg.description,
      description_ar: pkg.description_ar,
      total_price: pkg.total_price,
      original_price: pkg.original_price,
      discount_percentage: pkg.discount_percentage,
      is_active: pkg.is_active,
      services: (pkg.package_services || []).map((ps: any) => ({
        service_id: ps.service_id,
        service_name: ps.services?.name || '',
        service_name_ar: ps.services?.name_ar || '',
        capacity: ps.capacity_total || 0
      }))
    }));

    res.json({ packages: formattedPackages });
  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Get packages error', error, context);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

router.get('/receptionist/packages', authenticateSubscriptionManager, handleGetPackagesForReceptionOrTenant);
router.get('/tenant/packages', authenticateSubscriptionManager, handleGetPackagesForReceptionOrTenant);

// ============================================================================
// GET /receptionist/subscribers - List package subscribers with search (reception + tenant dashboard)
// ============================================================================
router.get('/receptionist/subscribers', authenticateSubscriptionManager, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const { search, search_type, page = 1, limit = 50 } = req.query;

    const pageNum = parseInt(page as string) || 1;
    const limitNum = parseInt(limit as string) || 50;
    const offset = (pageNum - 1) * limitNum;

    // Fetch all subscriptions first (we'll filter after fetching related data)
    // Note: We fetch all because Supabase doesn't support filtering on nested relations directly
    // This is acceptable for receptionist use cases as the dataset is typically manageable
    const { data: allSubscriptions, error: fetchError } = await supabase
      .from('package_subscriptions')
      .select(`
        id,
        customer_id,
        package_id,
        status,
        subscribed_at,
        zoho_invoice_id,
        payment_status,
        payment_method,
        transaction_reference
      `)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .eq('is_active', true)
      .order('subscribed_at', { ascending: false });

    if (fetchError) {
      if (isVerboseLogging()) logger.error('Receptionist Subscribers failed', fetchError, {}, {});
      return res.status(500).json({ 
        error: 'Failed to fetch subscribers',
        details: fetchError.message 
      });
    }

    if (!allSubscriptions || allSubscriptions.length === 0) {
      return res.json({
        subscribers: [],
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: 0,
          total_pages: 0
        }
      });
    }

    // Fetch related data for all subscriptions
    const customerIds = [...new Set(allSubscriptions.map(s => s.customer_id))];
    const packageIds = [...new Set(allSubscriptions.map(s => s.package_id))];

    // Fetch customers
    const { data: customersData } = await supabase
      .from('customers')
      .select('id, name, phone, email')
      .in('id', customerIds);

    // Fetch packages
    const { data: packagesData } = await supabase
      .from('service_packages')
      .select('id, name, name_ar')
      .in('id', packageIds);

    // Fetch usage for all subscriptions
    const subscriptionIds = allSubscriptions.map(s => s.id);
    const { data: usageData } = await supabase
      .from('package_subscription_usage')
      .select(`
        subscription_id,
        service_id,
        original_quantity,
        remaining_quantity,
        used_quantity,
        services (
          name,
          name_ar
        )
      `)
      .in('subscription_id', subscriptionIds);

    // Build subscribers with related data
    let subscribersWithData = allSubscriptions.map(sub => {
      const customer = customersData?.find(c => c.id === sub.customer_id);
      const packageData = packagesData?.find(p => p.id === sub.package_id);
      const usage = (usageData || []).filter(u => u.subscription_id === sub.id).map((u: any) => ({
        service_id: u.service_id,
        service_name: u.services?.name || '',
        service_name_ar: u.services?.name_ar || '',
        original_quantity: u.original_quantity,
        remaining_quantity: u.remaining_quantity,
        used_quantity: u.used_quantity
      }));

      return {
        id: sub.id,
        customer_id: sub.customer_id,
        package_id: sub.package_id,
        zoho_invoice_id: (sub as any).zoho_invoice_id ?? null,
        payment_status: (sub as any).payment_status ?? null,
        payment_method: (sub as any).payment_method ?? null,
        transaction_reference: (sub as any).transaction_reference ?? null,
        customer,
        package: packageData,
        usage,
        subscribed_at: sub.subscribed_at,
        status: sub.status
      };
    });

    // Apply search filters
    if (search && typeof search === 'string' && search.trim()) {
      const searchTerm = search.trim().toLowerCase();
      const searchType = search_type as string || 'all';

      subscribersWithData = subscribersWithData.filter(sub => {
        if (!sub.customer || !sub.package) return false;

        if (searchType === 'customer_name' || searchType === 'all') {
          if (sub.customer.name?.toLowerCase().includes(searchTerm)) return true;
        }
        if (searchType === 'customer_phone' || searchType === 'all') {
          if (sub.customer.phone?.toLowerCase().includes(searchTerm)) return true;
        }
        if (searchType === 'package_name' || searchType === 'all') {
          if (sub.package.name?.toLowerCase().includes(searchTerm) ||
              sub.package.name_ar?.toLowerCase().includes(searchTerm)) return true;
        }
        if (searchType === 'service_name' || searchType === 'all') {
          if (sub.usage.some(u => 
            u.service_name?.toLowerCase().includes(searchTerm) ||
            u.service_name_ar?.toLowerCase().includes(searchTerm)
          )) return true;
        }
        return false;
      });
    }

    // Apply pagination
    const total = subscribersWithData.length;
    const paginatedSubscribers = subscribersWithData.slice(offset, offset + limitNum);

    // Format response
    const formattedSubscribers = paginatedSubscribers.map(sub => ({
      id: sub.id,
      customer_id: sub.customer_id,
      package_id: sub.package_id,
      customer: sub.customer,
      package: sub.package,
      usage: sub.usage,
      subscribed_at: sub.subscribed_at,
      status: sub.status
    }));

    res.json({
      subscribers: formattedSubscribers,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        total_pages: Math.ceil(total / limitNum)
      }
    });

  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Receptionist get subscribers error', error, context);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// POST /receptionist/subscriptions - Subscribe customer to package (receptionist/admin)
// Accepts either customer_id OR (customer_phone + customer_name, optional customer_email) — find-or-create customer
// ============================================================================
router.post('/receptionist/subscriptions', authenticateSubscriptionManager, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const { package_id, customer_id, customer_phone, customer_name, customer_email, payment_method: reqPaymentMethod, transaction_reference: reqTransactionRef, payment_status: reqPaymentStatus } = req.body;

    if (reqPaymentMethod === 'transfer') {
      const refVal = reqTransactionRef != null ? String(reqTransactionRef).trim() : '';
      if (!refVal) {
        return res.status(400).json({ error: 'transaction_reference is required when payment method is transfer (حوالة)' });
      }
    }

    // Validation
    if (!package_id) {
      return res.status(400).json({ error: 'Package ID is required' });
    }

    let finalCustomerId = customer_id;

    if (!finalCustomerId) {
      // Require phone + name when not providing customer_id
      if (!customer_phone || typeof customer_phone !== 'string' || !customer_name || typeof customer_name !== 'string') {
        return res.status(400).json({ error: 'Customer ID or Customer phone and name are required' });
      }
      const normalizedPhone = normalizePhoneNumber(customer_phone) || customer_phone.replace(/[\s\-\(\)]/g, '');
      if (!normalizedPhone) {
        return res.status(400).json({ error: 'Invalid customer phone number' });
      }

      // Find or create customer by phone
      const { data: existingCustomer } = await supabase
        .from('customers')
        .select('id, name, phone, email')
        .eq('tenant_id', tenantId)
        .eq('phone', normalizedPhone)
        .maybeSingle();

      if (existingCustomer) {
        finalCustomerId = existingCustomer.id;
      } else {
        const { data: newCustomer, error: createErr } = await supabase
          .from('customers')
          .insert({
            tenant_id: tenantId,
            name: customer_name.trim(),
            phone: normalizedPhone,
            email: (customer_email && typeof customer_email === 'string' && customer_email.trim()) ? customer_email.trim() : null,
          })
          .select('id, name, phone, email')
          .single();

        if (createErr || !newCustomer) {
          return res.status(500).json({
            error: 'Failed to create customer',
            details: (createErr as any)?.message || 'Unknown error',
          });
        }
        finalCustomerId = newCustomer.id;
      }
    }

    // Verify package exists and belongs to tenant
    const { data: packageData, error: packageError } = await supabase
      .from('service_packages')
      .select('id, tenant_id, total_price, name, name_ar, is_active')
      .eq('id', package_id)
      .eq('tenant_id', tenantId)
      .eq('is_active', true)
      .single();

    if (packageError || !packageData) {
      return res.status(404).json({ error: 'Package not found or inactive' });
    }

    // Verify customer exists and belongs to tenant
    const { data: customerData, error: customerError } = await supabase
      .from('customers')
      .select('id, tenant_id, name, phone, email')
      .eq('id', finalCustomerId)
      .eq('tenant_id', tenantId)
      .single();

    if (customerError || !customerData) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    // Check if subscription already exists
    const { data: existingSubscription } = await supabase
      .from('package_subscriptions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('customer_id', finalCustomerId)
      .eq('package_id', package_id)
      .eq('status', 'active')
      .eq('is_active', true)
      .maybeSingle();

    if (existingSubscription) {
      return res.status(400).json({ 
        error: 'Subscription already exists',
        details: 'This customer already has an active subscription for this package'
      });
    }

    // Get package services to initialize usage
    const { data: packageServices, error: servicesError } = await supabase
      .from('package_services')
      .select('service_id, capacity_total')
      .eq('package_id', package_id);

    if (servicesError) {
      return res.status(500).json({ 
        error: 'Failed to fetch package services',
        details: servicesError.message 
      });
    }

    if (!packageServices || packageServices.length === 0) {
      return res.status(400).json({ error: 'Package has no services' });
    }

    // Create subscription (include payment_status, payment_method, transaction_reference when provided)
    const insertPayload: Record<string, unknown> = {
      tenant_id: tenantId,
      customer_id: finalCustomerId,
      package_id: package_id,
      status: 'active',
      is_active: true
    };
    if (reqPaymentStatus === 'pending' || reqPaymentStatus === 'paid') {
      insertPayload.payment_status = reqPaymentStatus;
    }
    if (reqPaymentMethod === 'onsite' || reqPaymentMethod === 'transfer') {
      insertPayload.payment_method = reqPaymentMethod;
      insertPayload.transaction_reference = reqPaymentMethod === 'transfer' && reqTransactionRef != null ? String(reqTransactionRef).trim() : null;
    }
    const { data: subscription, error: subscriptionError } = await supabase
      .from('package_subscriptions')
      .insert(insertPayload)
      .select()
      .single();

    if (subscriptionError || !subscription) {
      return res.status(500).json({ 
        error: 'Failed to create subscription',
        details: subscriptionError?.message 
      });
    }

    // Initialize usage records for each service
    const usageRecords = packageServices.map(ps => ({
      subscription_id: subscription.id,
      service_id: ps.service_id,
      original_quantity: ps.capacity_total,
      remaining_quantity: ps.capacity_total,
      used_quantity: 0
    }));

    const { error: usageError } = await supabase
      .from('package_subscription_usage')
      .insert(usageRecords);

    if (usageError) {
      if (isVerboseLogging()) logger.error('Receptionist Subscribe: usage records failed', usageError, {}, {});
      // Don't fail - subscription is created, usage can be fixed later
    }

    // Create Zoho invoice when not created as pending (pending = invoice created when marked paid later)
    let zohoInvoiceId: string | null = null;
    let invoiceError: string | null = null;
    if (reqPaymentStatus !== 'pending') {
      const customer_phone_raw = req.body.customer_phone as string | undefined;
      const customer_email_raw = req.body.customer_email as string | undefined;
      if (isVerboseLogging()) {
        logger.info('Receptionist subscribe: creating package subscription invoice', {}, {}, { subscriptionId: subscription.id, packageId: package_id });
      }
      const receptionInvoiceOptions: { customer_phone?: string; customer_email?: string; payment?: { payment_method: 'onsite' | 'transfer'; transaction_reference?: string | null } } = {
        customer_phone: customer_phone_raw,
        customer_email: customer_email_raw,
      };
      if (reqPaymentMethod === 'onsite' || reqPaymentMethod === 'transfer') {
        receptionInvoiceOptions.payment = {
          payment_method: reqPaymentMethod,
          transaction_reference: reqTransactionRef != null ? String(reqTransactionRef).trim() : undefined,
        };
      }
      const result = await createInvoiceForPackageSubscription(
        tenantId,
        subscription,
        package_id,
        { name: packageData.name, name_ar: packageData.name_ar, total_price: packageData.total_price },
        { name: customerData.name, email: customerData.email ?? undefined, phone: customerData.phone ?? undefined },
        receptionInvoiceOptions
      );
      zohoInvoiceId = result.zohoInvoiceId;
      invoiceError = result.invoiceError;
      if (invoiceError && isVerboseLogging()) {
        logger.warn('Receptionist subscribe: invoice creation failed (subscription still created)', undefined, {}, { subscriptionId: subscription.id, invoiceError });
      }
    } else if (isVerboseLogging()) {
      logger.info('Receptionist subscribe: created as pending (not paid), invoice will be created when marked paid', {}, {}, { subscriptionId: subscription.id });
    }

    res.status(201).json({
      success: true,
      message: 'Customer subscribed to package successfully',
      subscription: {
        id: subscription.id,
        customer: customerData,
        package: {
          id: packageData.id,
          name: packageData.name,
          name_ar: packageData.name_ar
        },
        subscribed_at: subscription.subscribed_at
      },
      invoice: zohoInvoiceId ? { id: zohoInvoiceId, status: 'created' } : null,
      invoice_error: invoiceError ?? undefined
    });

  } catch (error: any) {
    const context = logger.extractContext(req);
    logger.error('Receptionist subscribe customer error', error, context);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: 'An unexpected error occurred while subscribing customer to package'
    });
  }
});

export { router as packageRoutes };
