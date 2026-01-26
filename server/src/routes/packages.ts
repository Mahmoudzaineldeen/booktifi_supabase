import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';
import { logger } from '../utils/logger';

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

    if (!customer_id && (!customer_name || !customer_phone)) {
      return res.status(400).json({ error: 'Customer ID or customer name and phone are required' });
    }

    // Verify package exists and belongs to tenant
    const { data: packageData, error: packageError } = await supabase
      .from('service_packages')
      .select('id, tenant_id, total_price')
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
      return res.status(500).json({ 
        error: 'Failed to fetch package services',
        details: servicesError.message 
      });
    }

    // Calculate total capacity (sum of all service capacities)
    const totalCapacity = packageServices?.reduce((sum, ps) => sum + (ps.capacity_total || 1), 0) || 0;

    // Create package subscription
    const { data: subscription, error: subscriptionError } = await supabase
      .from('package_subscriptions')
      .insert({
        tenant_id,
        package_id,
        customer_id: finalCustomerId,
        total_quantity: totalCapacity,
        remaining_quantity: totalCapacity,
        is_active: true,
      })
      .select()
      .single();

    if (subscriptionError) {
      console.error('[Create Subscription] Error:', subscriptionError);
      return res.status(500).json({ 
        error: 'Failed to create package subscription',
        details: subscriptionError.message 
      });
    }

    // Initialize package usage records (trigger should handle this, but ensure it exists)
    // The trigger initialize_package_usage() should create package_subscription_usage records

    res.status(201).json({
      success: true,
      message: 'Package subscription created successfully',
      subscription,
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

export { router as packageRoutes };
