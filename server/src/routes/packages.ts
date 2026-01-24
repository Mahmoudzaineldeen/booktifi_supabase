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
      service_ids, // Array of service IDs to include in package
    } = req.body;

    // Validation
    if (!name || !name.trim()) {
      return res.status(400).json({ error: 'Package name is required' });
    }

    if (!name_ar || !name_ar.trim()) {
      return res.status(400).json({ error: 'Package name in Arabic is required' });
    }

    if (!Array.isArray(service_ids) || service_ids.length < 2) {
      return res.status(400).json({ 
        error: 'At least 2 services are required for a package',
        hint: 'Please select at least 2 services'
      });
    }

    if (typeof total_price !== 'number' || total_price < 0) {
      return res.status(400).json({ error: 'Total price must be a non-negative number' });
    }

    // Validate service IDs exist and belong to tenant
    const { data: validServices, error: servicesError } = await supabase
      .from('services')
      .select('id, tenant_id, base_price')
      .in('id', service_ids)
      .eq('tenant_id', tenantId);

    if (servicesError) {
      console.error('[Create Package] Error validating services:', servicesError);
      return res.status(500).json({ 
        error: 'Failed to validate services',
        details: servicesError.message 
      });
    }

    if (!validServices || validServices.length === 0) {
      return res.status(400).json({ 
        error: 'No valid services found',
        hint: 'Selected services do not exist or do not belong to your tenant'
      });
    }

    if (validServices.length !== service_ids.length) {
      const foundIds = new Set(validServices.map(s => s.id));
      const missingIds = service_ids.filter(id => !foundIds.has(id));
      return res.status(400).json({ 
        error: 'Some services are invalid',
        details: `The following service IDs are invalid or do not belong to your tenant: ${missingIds.join(', ')}`
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

    // Create package_services entries
    const packageServices = service_ids.map((serviceId: string) => ({
      package_id: newPackage.id,
      service_id: serviceId.trim(),
      quantity: 1,
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
    if (insertedServices.length !== service_ids.length) {
      console.warn(`[Create Package] Warning: Expected ${service_ids.length} services, inserted ${insertedServices.length}`);
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

export { router as packageRoutes };
