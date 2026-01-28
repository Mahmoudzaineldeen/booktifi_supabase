import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

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

    // Allow admin_user, customer_admin, tenant_admin, and receptionist
    const allowedRoles = ['admin_user', 'customer_admin', 'tenant_admin', 'receptionist'];
    if (!allowedRoles.includes(decoded.role)) {
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

    // Allow receptionist or admin_user — same endpoints, same validations, no permission gaps
    const allowedRoles = ['receptionist', 'admin_user'];
    if (!allowedRoles.includes(decoded.role)) {
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
    console.log('[Create Package] Service data count:', serviceData.length);
    if (serviceData.length < 1) {
      console.log('[Create Package] Validation failed: Need at least 1 service, got:', serviceData.length);
      return res.status(400).json({ 
        error: 'At least 1 service is required for a package',
        hint: 'Please select at least 1 service'
      });
    }
    
    // Log for debugging
    console.log('[Create Package] ✅ Validation passed: Package will be created with', serviceData.length, 'service(s)');
    console.log('[Create Package] Service data:', JSON.stringify(serviceData, null, 2));

    // Extract and validate service IDs
    const serviceIds = serviceData
      .map(s => {
        const id = typeof s.service_id === 'string' ? s.service_id.trim() : String(s.service_id || '').trim();
        return id;
      })
      .filter(id => id && id.length > 0);
    
    if (serviceIds.length === 0) {
      console.error('[Create Package] No valid service IDs extracted from serviceData:', serviceData);
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
      console.error('[Create Package] Invalid UUID format:', invalidUuids);
      return res.status(400).json({ 
        error: 'Invalid service ID format',
        hint: 'Service IDs must be valid UUIDs',
        invalid_ids: invalidUuids
      });
    }

    console.log('[Create Package] Extracted service IDs:', serviceIds);
    console.log('[Create Package] Validating services for tenant:', tenantId);

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
      console.error('[Create Package] Error validating services:', servicesError);
      return res.status(500).json({ 
        error: 'Failed to validate services',
        details: servicesError.message 
      });
    }

    console.log('[Create Package] Valid services found:', validServices?.length || 0);
    console.log('[Create Package] Valid service IDs:', validServices?.map(s => s.id) || []);

    if (!validServices || validServices.length === 0) {
      // Get all services for this tenant to help debug
      const { data: allTenantServices } = await supabase
        .from('services')
        .select('id, name')
        .eq('tenant_id', tenantId)
        .limit(10);
      
      console.log('[Create Package] Available services for tenant:', allTenantServices?.map(s => ({ id: s.id, name: s.name })) || []);
      
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
      console.warn('[Create Package] Some services are invalid:', missingIds);
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
      console.error('[Create Package] Error creating package:', packageError);
      return res.status(500).json({ 
        error: 'Failed to create package',
        details: packageError.message || packageError.code || 'Unknown error'
      });
    }

    if (!newPackage || !newPackage.id) {
      console.error('[Create Package] Package creation returned no data or missing ID');
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
      console.error('[Create Package] Error inserting package services:', servicesInsertError);
      
      // CRITICAL: Rollback - delete the package
      const { error: deleteError } = await supabase
        .from('service_packages')
        .delete()
        .eq('id', newPackage.id)
        .select();

      if (deleteError) {
        console.error('[Create Package] CRITICAL: Failed to rollback package deletion:', deleteError);
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
      console.error('[Create Package] CRITICAL: No services were inserted despite no error!');
      
      // Rollback
      const { error: deleteError } = await supabase
        .from('service_packages')
        .delete()
        .eq('id', newPackage.id);

      if (deleteError) {
        console.error('[Create Package] CRITICAL: Failed to rollback:', deleteError);
      }

      return res.status(500).json({ 
        error: 'No services were inserted. Package creation was rolled back.',
        warning: 'Please verify package was deleted'
      });
    }

    // Verify all services were inserted
    if (insertedServices.length !== serviceData.length) {
      console.warn(`[Create Package] Warning: Expected ${serviceData.length} services, inserted ${insertedServices.length}`);
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
      console.warn('[Create Package] Warning: Could not fetch complete package:', fetchError);
      // Still return success since package and services were created
    }

    console.log(`[Create Package] ✅ Successfully created package ${newPackage.id} with ${insertedServices.length} service(s)`);

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
      console.error('[Update Package] Error:', updateError);
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
    } = req.body;

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
      console.error('[Create Subscription] Error fetching package services:', servicesError);
      return res.status(500).json({ 
        error: 'Failed to fetch package services',
        details: servicesError.message 
      });
    }

    console.log('[Create Subscription] Package services fetched:', {
      count: packageServices?.length || 0,
      services: packageServices?.map(ps => ({
        service_id: ps.service_id,
        capacity_total: ps.capacity_total
      })) || []
    });

    // Check if package has any services
    if (!packageServices || packageServices.length === 0) {
      console.error('[Create Subscription] Package has no services:', { 
        package_id,
        tenant_id,
        package_name: packageData.name || 'Unknown'
      });
      
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
      // Handle null, undefined, or 0 values - default to 1 if invalid
      const validCapacity = (capacity && typeof capacity === 'number' && capacity > 0) ? capacity : 1;
      console.log(`[Create Subscription] Service ${ps.service_id}: capacity_total=${capacity}, using=${validCapacity}`);
      return sum + validCapacity;
    }, 0);

    console.log('[Create Subscription] Total capacity calculated:', totalCapacity);

    if (totalCapacity === 0) {
      console.error('[Create Subscription] Total capacity is 0 after calculation:', {
        package_id,
        services_count: packageServices.length,
        services: packageServices
      });
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

    // Try to add new schema columns (may not exist in older migrations)
    // Check error to see if columns don't exist, then retry without them
    subscriptionData.total_quantity = totalCapacity;
    subscriptionData.remaining_quantity = totalCapacity;
    subscriptionData.is_active = true;
    subscriptionData.status = 'active'; // For old schema compatibility

    console.log('[Create Subscription] Inserting subscription with data:', {
      ...subscriptionData,
      customer_id: '***', // Hide customer_id in logs
    });

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
      console.warn('[Create Subscription] New schema columns not found, trying old schema...');
      
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
      console.error('[Create Subscription] Error:', subscriptionError);
      console.error('[Create Subscription] Error code:', subscriptionError.code);
      console.error('[Create Subscription] Error message:', subscriptionError.message);
      console.error('[Create Subscription] Error details:', subscriptionError.details);
      console.error('[Create Subscription] Error hint:', subscriptionError.hint);
      
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

    // PART 1: Create Zoho invoice for package purchase (prepaid)
    // Packages are prepaid, so invoice must be created at purchase time
    let zohoInvoiceId: string | null = null;
    let invoiceError: string | null = null;
    let customerData: any = null; // Store customer data for final status logging

    console.log('[Create Subscription] ========================================');
    console.log('[Create Subscription] 📋 STARTING INVOICE CREATION PROCESS');
    console.log('[Create Subscription] Subscription ID:', subscription.id);
    console.log('[Create Subscription] Customer ID:', finalCustomerId);
    console.log('[Create Subscription] Package price:', total_price);
    console.log('[Create Subscription] ========================================');

    try {
      // Get customer details for invoice
      console.log('[Create Subscription] Step 1: Fetching customer data...');
      const { data: fetchedCustomerData, error: customerFetchError } = await supabase
        .from('customers')
        .select('name, email, phone')
        .eq('id', finalCustomerId)
        .single();

      if (customerFetchError || !fetchedCustomerData) {
        console.error('[Create Subscription] ❌ Step 1 FAILED: Failed to fetch customer for invoice');
        console.error('[Create Subscription] Error details:', customerFetchError);
        invoiceError = `Failed to fetch customer details for invoice: ${customerFetchError?.message || 'Customer not found'}`;
      } else {
        customerData = fetchedCustomerData; // Store for later use
        console.log('[Create Subscription] ✅ Step 1 SUCCESS: Customer data fetched');
        console.log('[Create Subscription] Customer:', {
          name: customerData.name,
          email: customerData.email || 'no email',
          phone: customerData.phone || 'no phone'
        });
        console.log('[Create Subscription] ✅ Customer data fetched:', {
          name: customerData.name,
          email: customerData.email || 'no email',
          phone: customerData.phone || 'no phone'
        });
        // Get tenant currency
        console.log('[Create Subscription] Step 2: Fetching tenant currency...');
        const { data: tenantData } = await supabase
          .from('tenants')
          .select('currency_code')
          .eq('id', tenant_id)
          .single();

        const currencyCode = tenantData?.currency_code || 'SAR';
        console.log('[Create Subscription] ✅ Step 2 SUCCESS: Currency code:', currencyCode);

        // Import ZohoService dynamically
        console.log('[Create Subscription] Step 3: Importing ZohoService...');
        const { zohoService } = await import('../services/zohoService.js');
        console.log('[Create Subscription] ✅ Step 3 SUCCESS: ZohoService imported');

        // Pre-check: Verify Zoho is configured before attempting invoice creation
        console.log('[Create Subscription] Step 3.5: Checking Zoho configuration...');
        let zohoConfigured = false;
        const { data: zohoConfig, error: zohoConfigError } = await supabase
          .from('tenant_zoho_configs')
          .select('client_id, client_secret, redirect_uri')
          .eq('tenant_id', tenant_id)
          .single();

        if (zohoConfigError || !zohoConfig || !zohoConfig.client_id) {
          console.warn('[Create Subscription] ⚠️  Zoho not configured for this tenant');
          console.warn('[Create Subscription] ⚠️  Invoice creation will be skipped');
          console.warn('[Create Subscription] 💡 To enable invoices: Configure Zoho in Settings → Zoho Integration');
          invoiceError = 'Zoho Invoice not configured for this tenant. Please configure Zoho in Settings → Zoho Integration';
          zohoConfigured = false;
        } else {
          console.log('[Create Subscription] ✅ Step 3.5 SUCCESS: Zoho configuration found');
          
          // Check if OAuth tokens exist
          const { data: zohoToken, error: tokenError } = await supabase
            .from('zoho_tokens')
            .select('id')
            .eq('tenant_id', tenant_id)
            .single();

          if (tokenError || !zohoToken) {
            console.warn('[Create Subscription] ⚠️  Zoho OAuth tokens not found');
            console.warn('[Create Subscription] 💡 To enable invoices: Complete OAuth flow in Settings → Zoho Integration → Connect Zoho');
            invoiceError = 'Zoho OAuth tokens not found. Please complete OAuth flow in Settings → Zoho Integration';
            zohoConfigured = false;
          } else {
            console.log('[Create Subscription] ✅ Step 3.5 SUCCESS: Zoho OAuth tokens found');
            zohoConfigured = true;
          }
        }

        // Skip invoice creation if Zoho is not configured
        if (!zohoConfigured) {
          console.log('[Create Subscription] ⏭️  Skipping invoice creation - Zoho not configured');
        } else {
          // Create invoice data
          console.log('[Create Subscription] Step 4: Preparing invoice data...');
          const packageName = packageData.name || packageData.name_ar || 'Service Package';
          const invoiceData = {
            customer_name: customerData.name,
            customer_email: customerData.email || customer_email || undefined,
            customer_phone: customerData.phone || customer_phone || undefined,
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
            notes: `Package Subscription ID: ${subscription.id}\nPackage ID: ${package_id}`
          };

          console.log('[Create Subscription] ✅ Step 4 SUCCESS: Invoice data prepared');
          console.log('[Create Subscription] Invoice details:', {
            customer_name: invoiceData.customer_name,
            customer_email: invoiceData.customer_email || 'none',
            total_price: total_price,
            currency: currencyCode,
            line_items_count: invoiceData.line_items.length
          });

          // Create invoice in Zoho
          console.log('[Create Subscription] Step 5: Calling zohoService.createInvoice...');
          console.log('[Create Subscription] ⚠️  This may fail if Zoho is not configured for this tenant');
          const invoiceResponse = await zohoService.createInvoice(tenant_id, invoiceData);
          console.log('[Create Subscription] ✅ Step 5 COMPLETE: Invoice response received');
          console.log('[Create Subscription] Response details:', {
            hasInvoice: !!invoiceResponse.invoice,
            invoiceId: invoiceResponse.invoice?.invoice_id || 'none',
            message: invoiceResponse.message || 'no message',
            success: invoiceResponse.success || false
          });

          if (invoiceResponse.invoice && invoiceResponse.invoice.invoice_id) {
            zohoInvoiceId = invoiceResponse.invoice.invoice_id;
            console.log('[Create Subscription] ✅ Zoho invoice created:', zohoInvoiceId);

            // Send invoice via email if customer email is available
            const emailToSend = invoiceData.customer_email;
            if (emailToSend) {
              console.log('[Create Subscription] Step 6: Sending invoice via email...');
              try {
                await zohoService.sendInvoiceEmail(tenant_id, zohoInvoiceId, emailToSend);
                console.log('[Create Subscription] ✅ Step 6 SUCCESS: Invoice sent to customer email');
              } catch (emailError: any) {
                console.error('[Create Subscription] ⚠️  Failed to send invoice email:', emailError.message);
                // Don't fail the subscription creation - invoice was created successfully
                // Email can be sent manually from Zoho if needed
              }
            } else {
              console.warn('[Create Subscription] ⚠️  No customer email provided - invoice created but not sent via email');
            }

            // Send invoice via WhatsApp if customer phone is available
            const phoneToSend = invoiceData.customer_phone || customer_phone;
            if (phoneToSend) {
              // Normalize phone number before sending
              const normalizedPhone = normalizePhoneNumber(phoneToSend);
              if (normalizedPhone) {
                console.log('[Create Subscription] Step 7: Sending invoice via WhatsApp...');
                console.log('[Create Subscription]    Phone (original):', phoneToSend);
                console.log('[Create Subscription]    Phone (normalized):', normalizedPhone);
                try {
                  await zohoService.sendInvoiceViaWhatsApp(tenant_id, zohoInvoiceId, normalizedPhone);
                  console.log('[Create Subscription] ✅ Step 7 SUCCESS: Invoice sent to customer WhatsApp');
                } catch (whatsappError: any) {
                  console.error('[Create Subscription] ⚠️  Failed to send invoice via WhatsApp:', whatsappError.message);
                  // Don't fail the subscription creation - invoice was created successfully
                  // WhatsApp can be sent manually from Zoho if needed
                }
              } else {
                console.warn('[Create Subscription] ⚠️  Invalid phone number format - cannot send via WhatsApp:', phoneToSend);
              }
            } else {
              console.warn('[Create Subscription] ⚠️  No customer phone provided - invoice created but not sent via WhatsApp');
            }

            // Log final status
            if (!emailToSend && !phoneToSend) {
              console.warn('[Create Subscription] ⚠️  No customer contact (email/phone) provided - invoice created but not sent');
              console.warn('[Create Subscription] 💡 Invoice can be sent manually from Zoho Invoice dashboard');
            }

            // Update subscription with invoice ID and mark as paid
            // Try to update with new schema columns first, fall back to old schema if columns don't exist
            const updateData: any = {};
            
            // Check if zoho_invoice_id column exists by trying to update it
            const testUpdate = await supabase
              .from('package_subscriptions')
              .update({ zoho_invoice_id: zohoInvoiceId })
              .eq('id', subscription.id)
              .select('zoho_invoice_id')
              .single();
            
            if (testUpdate.error) {
              // Column might not exist - log warning but continue
              if (testUpdate.error.message?.includes('column') && testUpdate.error.message?.includes('zoho_invoice_id')) {
                console.warn('[Create Subscription] ⚠️ zoho_invoice_id column not found - migration may not be applied');
                console.warn('[Create Subscription] ⚠️ Please run migration: 20260131000006_add_package_invoice_fields.sql');
              } else {
                console.error('[Create Subscription] Failed to update subscription with invoice ID:', testUpdate.error);
              }
            } else {
              // Column exists, try to update payment_status too
              const paymentStatusUpdate = await supabase
                .from('package_subscriptions')
                .update({ payment_status: 'paid' })
                .eq('id', subscription.id);
              
              if (paymentStatusUpdate.error) {
                if (paymentStatusUpdate.error.message?.includes('column') && paymentStatusUpdate.error.message?.includes('payment_status')) {
                  console.warn('[Create Subscription] ⚠️ payment_status column not found - migration may not be applied');
                } else {
                  console.error('[Create Subscription] Failed to update payment_status:', paymentStatusUpdate.error);
                }
              }
              
              // Refresh subscription data to include invoice ID
              const { data: updatedSubscription } = await supabase
                .from('package_subscriptions')
                .select()
                .eq('id', subscription.id)
                .single();
              
              if (updatedSubscription) {
                subscription = updatedSubscription;
              }
            }
          } else {
            invoiceError = invoiceResponse.message || 'Failed to create invoice';
            console.error('[Create Subscription] ❌ Invoice creation failed:', invoiceError);
            console.error('[Create Subscription] Invoice response:', JSON.stringify(invoiceResponse, null, 2));
          }
        } // End of else block for Zoho configuration check
      }
    } catch (invoiceErr: any) {
      console.error('[Create Subscription] ========================================');
      console.error('[Create Subscription] ❌ EXCEPTION IN INVOICE CREATION');
      console.error('[Create Subscription] ========================================');
      console.error('[Create Subscription] Error type:', invoiceErr?.constructor?.name || 'Unknown');
      console.error('[Create Subscription] Error message:', invoiceErr?.message || 'No message');
      console.error('[Create Subscription] Error code:', invoiceErr?.code || 'No code');
      
      // Check for specific Zoho configuration errors
      if (invoiceErr?.message?.includes('Zoho') || invoiceErr?.message?.includes('token') || invoiceErr?.message?.includes('OAuth')) {
        console.error('[Create Subscription] 🔍 DIAGNOSIS: Zoho configuration issue detected');
        console.error('[Create Subscription] 💡 SOLUTION: Configure Zoho in Settings → Zoho Integration');
        console.error('[Create Subscription] 💡 Required: client_id, client_secret, redirect_uri, and OAuth connection');
      }
      
      if (invoiceErr?.stack) {
        console.error('[Create Subscription] Error stack:', invoiceErr.stack);
      }
      
      invoiceError = invoiceErr.message || 'Failed to create invoice';
      console.error('[Create Subscription] ========================================');
      // Don't fail the subscription creation - invoice can be created later
    }
    
    // Log final invoice status
    console.log('[Create Subscription] ========================================');
    console.log('[Create Subscription] 📊 FINAL INVOICE STATUS');
    console.log('[Create Subscription] ========================================');
    if (zohoInvoiceId) {
      console.log('[Create Subscription] ✅ SUCCESS: Invoice created');
      console.log('[Create Subscription] Invoice ID:', zohoInvoiceId);
      const emailSent = customerData?.email || customer_email;
      const phoneSent = customerData?.phone || customer_phone;
      if (emailSent) {
        console.log('[Create Subscription] ✅ Email sent to:', emailSent);
      } else {
        console.warn('[Create Subscription] ⚠️  No email sent (customer email not provided)');
      }
      if (phoneSent) {
        console.log('[Create Subscription] ✅ WhatsApp sent to:', phoneSent);
      } else {
        console.warn('[Create Subscription] ⚠️  No WhatsApp sent (customer phone not provided)');
      }
    } else {
      console.warn('[Create Subscription] ⚠️  FAILED: No invoice created');
      if (invoiceError) {
        console.warn('[Create Subscription] Error reason:', invoiceError);
      } else {
        console.warn('[Create Subscription] No error message available (check logs above)');
      }
    }
    console.log('[Create Subscription] ========================================');

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

    console.log(`[Cancel Subscription] Request received:`, {
      subscriptionId,
      tenantId,
      userId: req.user!.id,
      role: req.user!.role
    });

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
      console.error(`[Cancel Subscription] Error fetching subscription:`, {
        error: fetchError.message,
        code: fetchError.code,
        details: fetchError.details,
        hint: fetchError.hint
      });
      return res.status(404).json({ 
        error: 'Subscription not found',
        details: fetchError.message || 'The subscription does not exist or does not belong to your tenant'
      });
    }

    if (!subscription) {
      console.error(`[Cancel Subscription] Subscription not found:`, { subscriptionId, tenantId });
      return res.status(404).json({ 
        error: 'Subscription not found',
        details: 'The subscription does not exist or does not belong to your tenant'
      });
    }

    console.log(`[Cancel Subscription] Found subscription:`, {
      id: subscription.id,
      status: subscription.status,
      is_active: subscription.is_active
    });

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

    console.log(`[Cancel Subscription] Updating with data:`, updateData);

    const { data: updatedSubscription, error: updateError } = await supabase
      .from('package_subscriptions')
      .update(updateData)
      .eq('id', subscriptionId)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (updateError) {
      console.error(`[Cancel Subscription] Update error:`, {
        error: updateError.message,
        code: updateError.code,
        details: updateError.details,
        hint: updateError.hint
      });

      // If error is about missing columns, try with old schema (status only)
      if (updateError.message?.includes('column') && updateError.message?.includes('is_active')) {
        console.warn('[Cancel Subscription] is_active column not found, trying old schema...');
        
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
          console.error('[Cancel Subscription] Old schema update error:', {
            error: oldError.message,
            code: oldError.code,
            details: oldError.details
          });
          return res.status(500).json({ 
            error: 'Failed to cancel subscription',
            details: oldError.message || 'Unknown error',
            code: oldError.code
          });
        }

        console.log(`[Cancel Subscription] ✅ Subscription ${subscriptionId} cancelled (old schema) by ${req.user!.role} (${req.user!.id})`);
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
      console.error(`[Cancel Subscription] Update succeeded but no data returned`);
      return res.status(500).json({ 
        error: 'Failed to cancel subscription',
        details: 'Update succeeded but no subscription data returned'
      });
    }

    console.log(`[Cancel Subscription] ✅ Subscription ${subscriptionId} cancelled by ${req.user!.role} (${req.user!.id})`);

    res.json({
      success: true,
      message: 'Package subscription cancelled successfully',
      subscription: updatedSubscription
    });

  } catch (error: any) {
    console.error(`[Cancel Subscription] Exception:`, {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
    const context = logger.extractContext(req);
    logger.error('Cancel package subscription error', error, context);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      details: 'An unexpected error occurred while cancelling the subscription'
    });
  }
});

// ============================================================================
// RECEPTIONIST PACKAGE MANAGEMENT ENDPOINTS
// Receptionists can view packages and subscribe customers, but NOT edit/delete
// ============================================================================

// ============================================================================
// GET /receptionist/packages - List packages with search (receptionist only)
// ============================================================================
router.get('/receptionist/packages', authenticateReceptionistOrAdmin, async (req, res) => {
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
      // Get packages that include this service
      const { data: packageServices } = await supabase
        .from('package_services')
        .select('package_id')
        .eq('service_id', service_id);

      if (packageServices && packageServices.length > 0) {
        const packageIds = packageServices.map(ps => ps.package_id);
        query = query.in('id', packageIds);
      } else {
        // No packages found with this service
        return res.json({ packages: [] });
      }
    }

    const { data: packages, error } = await query;

    if (error) {
      console.error('[Receptionist Packages] Error:', error);
      return res.status(500).json({ 
        error: 'Failed to fetch packages',
        details: error.message 
      });
    }

    // Format response
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
    logger.error('Receptionist get packages error', error, context);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// ============================================================================
// GET /receptionist/subscribers - List package subscribers with search (receptionist only)
// ============================================================================
router.get('/receptionist/subscribers', authenticateReceptionistOrAdmin, async (req, res) => {
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
        subscribed_at
      `)
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .eq('is_active', true)
      .order('subscribed_at', { ascending: false });

    if (fetchError) {
      console.error('[Receptionist Subscribers] Error:', fetchError);
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
// POST /receptionist/subscriptions - Subscribe customer to package (receptionist only)
// ============================================================================
router.post('/receptionist/subscriptions', authenticateReceptionistOrAdmin, async (req, res) => {
  try {
    const tenantId = req.user!.tenant_id!;
    const { package_id, customer_id } = req.body;

    // Validation
    if (!package_id) {
      return res.status(400).json({ error: 'Package ID is required' });
    }

    if (!customer_id) {
      return res.status(400).json({ error: 'Customer ID is required' });
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
      .eq('id', customer_id)
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
      .eq('customer_id', customer_id)
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

    // Create subscription
    const { data: subscription, error: subscriptionError } = await supabase
      .from('package_subscriptions')
      .insert({
        tenant_id: tenantId,
        customer_id: customer_id,
        package_id: package_id,
        status: 'active',
        is_active: true
      })
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
      console.error('[Receptionist Subscribe] Error creating usage records:', usageError);
      // Don't fail - subscription is created, usage can be fixed later
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
      }
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
