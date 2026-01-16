import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to authenticate
function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'No authorization header' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    req.user = decoded;
    next();
  } catch (error: any) {
    res.status(401).json({ error: 'Invalid token' });
  }
}

// Get reviews for a service (public)
router.get('/service/:serviceId', async (req, res) => {
  try {
    const { serviceId } = req.params;
    const { limit = 10, offset = 0 } = req.query;

    // Show all visible reviews to everyone (no approval required)
    const { data, error } = await supabase
      .from('reviews')
      .select(`
        *,
        users!customer_id (
          full_name,
          full_name_ar
        )
      `)
      .eq('service_id', serviceId)
      .eq('is_visible', true)
      .order('created_at', { ascending: false })
      .range(
        parseInt(offset as string),
        parseInt(offset as string) + parseInt(limit as string) - 1
      );

    if (error) throw error;

    // Transform the data to match the original structure
    const reviews = (data || []).map(review => ({
      ...review,
      customer_name: review.users?.full_name || null,
      customer_name_ar: review.users?.full_name_ar || null,
      users: undefined // Remove the nested users object
    }));

    // Log image_url for debugging
    reviews.forEach((review, idx) => {
      if (review.image_url) {
        console.log(`Review ${idx + 1} has image_url:`, review.image_url.substring(0, 100) + '...');
        console.log(`Review ${idx + 1} image_url length:`, review.image_url.length);
        console.log(`Review ${idx + 1} image_url starts with data:`, review.image_url.startsWith('data:'));
      } else {
        console.log(`Review ${idx + 1} has no image_url`);
      }
    });

    res.json(reviews);
  } catch (error: any) {
    console.error('Get service reviews error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Create review (customer only - authenticated users)
router.post('/', authenticate, async (req, res) => {
  try {
    const customerId = req.user.id;
    const userRole = req.user.role;

    console.log('Creating review request:', {
      customerId,
      userRole,
      bodyKeys: Object.keys(req.body),
      hasImage: !!req.body.image_base64,
      imageSize: req.body.image_base64 ? req.body.image_base64.length : 0
    });

    // Ensure only customers can create testimonials (not service providers or admins)
    if (userRole !== 'customer') {
      return res.status(403).json({ 
        error: 'Only customers can create testimonials. Service providers and admins cannot create testimonials.' 
      });
    }

    // Extract data from request body
    const body = req.body;
    const service_id = body.service_id;
    const tenant_id = body.tenant_id;
    const rating = typeof body.rating === 'string' ? parseInt(body.rating) : body.rating;
    const comment = body.comment;
    const comment_ar = body.comment_ar;
    const booking_id = body.booking_id;
    const images = body.images; // Array of { base64: string, filename: string }
    const image_base64 = body.image_base64; // Legacy support for single image
    const image_filename = body.image_filename; // Legacy support
    
    // Handle image upload (base64 encoding) - Support both single and multiple images
    let imageUrl: string | null = null;
    
    // New format: multiple images
    if (images && Array.isArray(images) && images.length > 0) {
      try {
        const maxBase64Length = 200 * 1024 * 1024; // 200MB per image
        const imageUrls: string[] = [];
        
        for (const img of images) {
          if (!img.base64 || !img.filename) continue;
          
          // Validate base64 string length
          if (img.base64.length > maxBase64Length) {
            console.warn('Image base64 too large:', img.base64.length, 'bytes. Max allowed:', maxBase64Length);
            continue; // Skip this image
          }
          
          // Determine mime type from filename
          const fileExtension = img.filename.split('.').pop()?.toLowerCase() || 'jpg';
          const mimeType = fileExtension === 'png' ? 'image/png' : 
                          fileExtension === 'gif' ? 'image/gif' : 
                          'image/jpeg';
          
          const dataUrl = `data:${mimeType};base64,${img.base64}`;
          imageUrls.push(dataUrl);
        }
        
        // Store as JSON array if multiple images, or single string if one image
        if (imageUrls.length > 0) {
          imageUrl = imageUrls.length === 1 ? imageUrls[0] : JSON.stringify(imageUrls);
          console.log(`Processed ${imageUrls.length} image(s). Total size: ${imageUrl.length} characters`);
        }
      } catch (error: any) {
        console.error('Error processing images:', error);
        console.error('Error stack:', error.stack);
        imageUrl = null;
      }
    }
    // Legacy format: single image (for backward compatibility)
    else if (image_base64) {
      try {
        const maxBase64Length = 200 * 1024 * 1024; // 200MB
        if (image_base64.length > maxBase64Length) {
          console.warn('Image base64 too large:', image_base64.length, 'bytes. Max allowed:', maxBase64Length);
          imageUrl = null;
        } else {
          const fileExtension = image_filename?.split('.').pop()?.toLowerCase() || 'jpg';
          const mimeType = fileExtension === 'png' ? 'image/png' : 
                          fileExtension === 'gif' ? 'image/gif' : 
                          'image/jpeg';
          imageUrl = `data:${mimeType};base64,${image_base64}`;
          console.log('Image processed successfully. Final size:', imageUrl.length, 'characters');
        }
      } catch (error: any) {
        console.error('Error processing image:', error);
        console.error('Error stack:', error.stack);
        imageUrl = null;
      }
    }

    // Validate required fields
    if (!service_id || !rating) {
      return res.status(400).json({ error: 'Service ID and rating are required' });
    }

    if (!comment || !comment.trim()) {
      return res.status(400).json({ error: 'Review text is required and cannot be empty' });
    }

    if (rating < 1 || rating > 5) {
      return res.status(400).json({ error: 'Rating must be between 1 and 5' });
    }

    // FUTURE FEATURE: Booking validation
    // Currently, we don't enforce booking validation as per requirements
    // The system is structured to support this feature later
    // When implemented, uncomment and use the following validation:
    /*
    if (booking_id) {
      const { data: booking, error: bookingError } = await supabase
        .from('bookings')
        .select('id, status, customer_id')
        .eq('id', booking_id)
        .maybeSingle();

      if (!booking) {
        return res.status(404).json({ error: 'Booking not found' });
      }

      if (booking.customer_id !== customerId) {
        return res.status(403).json({ error: 'This booking does not belong to you' });
      }

      if (booking.status !== 'completed') {
        return res.status(400).json({ error: 'Can only review completed bookings' });
      }

      // Check if review already exists for this booking
      const { data: existingReview } = await supabase
        .from('reviews')
        .select('id')
        .eq('booking_id', booking_id)
        .maybeSingle();

      if (existingReview) {
        return res.status(400).json({ error: 'Review already exists for this booking' });
      }
    }
    */

    // Get tenant_id from service (if not provided)
    let finalTenantId = tenant_id;
    if (!finalTenantId) {
      const { data: serviceData, error: serviceError } = await supabase
        .from('services')
        .select('tenant_id')
        .eq('id', service_id)
        .maybeSingle();

      if (serviceError) throw serviceError;
      if (!serviceData) {
        return res.status(404).json({ error: 'Service not found' });
      }
      finalTenantId = serviceData.tenant_id;
    }


    // Create review/testimonial
    // Note: booking_id and service_id are stored for future validation
    // Currently, we don't enforce booking validation (future feature)
    console.log('Executing insert with params:', {
      finalTenantId,
      service_id,
      booking_id: booking_id || null,
      customerId,
      rating,
      commentLength: comment.trim().length,
      comment_arLength: comment_ar?.trim()?.length || 0,
      imageUrlLength: imageUrl?.length || 0
    });

    const { data: reviewData, error: insertError } = await supabase
      .from('reviews')
      .insert({
        tenant_id: finalTenantId,
        service_id: service_id,
        booking_id: booking_id || null, // Store for future booking validation
        customer_id: customerId, // user_id stored as customer_id
        rating: rating,
        comment: comment.trim(), // Ensure no empty reviews
        comment_ar: comment_ar?.trim() || null,
        image_url: imageUrl
      })
      .select()
      .single();

    if (insertError) throw insertError;

    // Log saved image_url for debugging
    if (reviewData?.image_url) {
      console.log('Review created with image_url:', reviewData.image_url.substring(0, 100) + '...');
      console.log('Image URL length:', reviewData.image_url.length);
      console.log('Image URL starts with data:', reviewData.image_url.startsWith('data:'));
    } else {
      console.log('Review created without image_url');
    }

    res.status(201).json({ review: reviewData });
  } catch (error: any) {
    console.error('Create review error:', error);
    console.error('Error message:', error.message);
    console.error('Error stack:', error.stack);
    console.error('Error code:', error.code);
    console.error('Error detail:', error.detail);
    
    // Provide more specific error messages
    if (error.code === '23505') {
      // Unique constraint violation
      return res.status(409).json({ 
        error: 'A review already exists for this service',
        details: error.detail
      });
    } else if (error.code === '23503') {
      // Foreign key constraint violation
      return res.status(400).json({ 
        error: 'Invalid service or tenant ID',
        details: error.detail
      });
    } else if (error.message?.includes('value too long')) {
      return res.status(400).json({ 
        error: 'Image is too large. Please use a smaller image.',
        details: 'The image data exceeds the maximum allowed size'
      });
    }
    
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { 
        stack: error.stack,
        code: error.code,
        detail: error.detail
      })
    });
  }
});

// Update review (customer only, if not approved)
router.put('/:reviewId', authenticate, async (req, res) => {
  try {
    const customerId = req.user.id;
    const { reviewId } = req.params;
    const { rating, comment, comment_ar, images } = req.body;

    // Check if review exists and belongs to customer
    const { data: review, error: reviewError } = await supabase
      .from('reviews')
      .select('id, customer_id, is_approved')
      .eq('id', reviewId)
      .maybeSingle();

    if (reviewError) throw reviewError;
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    if (review.customer_id !== customerId) {
      return res.status(403).json({ error: 'You can only update your own reviews' });
    }

    // Allow users to update their reviews regardless of approval status
    // Note: service_id and rating are not required for updates (only for creation)

    // Update review
    const updateData: any = {};

    if (rating !== undefined) {
      if (rating < 1 || rating > 5) {
        return res.status(400).json({ error: 'Rating must be between 1 and 5' });
      }
      updateData.rating = rating;
    }

    if (comment !== undefined) {
      updateData.comment = comment;
    }

    if (comment_ar !== undefined) {
      updateData.comment_ar = comment_ar;
    }

    // Handle image updates (same logic as create)
    if (images !== undefined) {
      let imageUrl: string | null = null;
      if (images && Array.isArray(images) && images.length > 0) {
        try {
          const maxBase64Length = 200 * 1024 * 1024; // 200MB per image
          const imageUrls: string[] = [];

          for (const img of images) {
            if (!img.base64 || !img.filename) continue;

            if (img.base64.length > maxBase64Length) {
              console.warn('Image base64 too large:', img.base64.length, 'bytes. Max allowed:', maxBase64Length);
              continue;
            }

            const fileExtension = img.filename.split('.').pop()?.toLowerCase() || 'jpg';
            const mimeType = fileExtension === 'png' ? 'image/png' :
                            fileExtension === 'gif' ? 'image/gif' :
                            'image/jpeg';

            const dataUrl = `data:${mimeType};base64,${img.base64}`;
            imageUrls.push(dataUrl);
          }

          if (imageUrls.length > 0) {
            imageUrl = imageUrls.length === 1 ? imageUrls[0] : JSON.stringify(imageUrls);
          } else {
            // If all images were too large or invalid, set to null to remove images
            imageUrl = null;
          }
        } catch (error: any) {
          console.error('Error processing images:', error);
        }
      } else if (images === null) {
        // Explicitly set to null to remove images
        imageUrl = null;
      }

      if (imageUrl !== undefined) {
        updateData.image_url = imageUrl;
      }
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateData.updated_at = new Date().toISOString();

    const { data: updatedReview, error: updateError } = await supabase
      .from('reviews')
      .update(updateData)
      .eq('id', reviewId)
      .select()
      .single();

    if (updateError) throw updateError;

    res.json({ review: updatedReview });
  } catch (error: any) {
    console.error('Update review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Delete review (customer can delete own reviews, service provider can delete any review)
router.delete('/:reviewId', authenticate, async (req, res) => {
  try {
    const userId = req.user.id;
    const userRole = req.user.role;
    const { reviewId } = req.params;

    // Check if review exists
    const { data: review, error: reviewError } = await supabase
      .from('reviews')
      .select('id, customer_id, tenant_id')
      .eq('id', reviewId)
      .maybeSingle();

    if (reviewError) throw reviewError;
    if (!review) {
      return res.status(404).json({ error: 'Review not found' });
    }

    // Allow deletion if:
    // 1. User is the customer who wrote the review, OR
    // 2. User is a service provider (tenant_admin) and the review belongs to their tenant
    const isOwner = review.customer_id === userId;
    const isServiceProvider = (userRole === 'tenant_admin' || userRole === 'receptionist' || userRole === 'cashier');

    // For service providers, check if review belongs to their tenant
    let canDelete = isOwner;
    if (isServiceProvider && !isOwner) {
      // Check if user's tenant matches review's tenant
      const { data: userData, error: userError } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', userId)
        .maybeSingle();

      if (userError) throw userError;
      if (userData && userData.tenant_id === review.tenant_id) {
        canDelete = true;
      }
    }

    if (!canDelete) {
      return res.status(403).json({ error: 'You do not have permission to delete this review' });
    }

    const { error: deleteError } = await supabase
      .from('reviews')
      .delete()
      .eq('id', reviewId);

    if (deleteError) throw deleteError;

    res.json({ message: 'Review deleted successfully' });
  } catch (error: any) {
    console.error('Delete review error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get review statistics for a service
router.get('/service/:serviceId/stats', async (req, res) => {
  try {
    const { serviceId } = req.params;

    // Fetch all visible reviews for this service
    const { data: reviews, error } = await supabase
      .from('reviews')
      .select('rating')
      .eq('service_id', serviceId)
      .eq('is_visible', true);

    if (error) throw error;

    // Perform JavaScript aggregation
    const total_reviews = reviews ? reviews.length : 0;

    if (total_reviews === 0) {
      return res.json({
        total_reviews: 0,
        average_rating: 0,
        five_star: 0,
        four_star: 0,
        three_star: 0,
        two_star: 0,
        one_star: 0
      });
    }

    const sum = reviews.reduce((acc, review) => acc + review.rating, 0);
    const average_rating = sum / total_reviews;

    const five_star = reviews.filter(r => r.rating === 5).length;
    const four_star = reviews.filter(r => r.rating === 4).length;
    const three_star = reviews.filter(r => r.rating === 3).length;
    const two_star = reviews.filter(r => r.rating === 2).length;
    const one_star = reviews.filter(r => r.rating === 1).length;

    res.json({
      total_reviews,
      average_rating,
      five_star,
      four_star,
      three_star,
      two_star,
      one_star
    });
  } catch (error: any) {
    console.error('Get review stats error:', error);
    res.status(500).json({ error: error.message });
  }
});

export { router as reviewRoutes };


