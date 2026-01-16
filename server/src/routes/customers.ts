import express from 'express';
import { supabase } from '../db';
import jwt from 'jsonwebtoken';

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

// Middleware to authenticate customer
function authenticate(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      return res.status(401).json({ error: 'Authorization header required' });
    }

    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET) as any;
    
    if (decoded.role !== 'customer') {
      return res.status(403).json({ error: 'Access denied. Customer role required.' });
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

// Get customer's bookings
router.get('/bookings', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('bookings')
      .select(`
        id,
        service_id,
        status,
        total_price,
        visitor_count,
        notes,
        created_at,
        services:service_id (
          name,
          name_ar
        ),
        slots:slot_id (
          slot_date,
          start_time,
          end_time
        ),
        reviews!reviews_booking_id_fkey (
          id,
          rating,
          is_approved
        )
      `)
      .eq('customer_id', userId)
      .eq('reviews.customer_id', userId)
      .order('slots(slot_date)', { ascending: false })
      .order('slots(start_time)', { ascending: false });

    if (error) throw error;

    // Transform the nested data structure to match the original flat structure
    const transformedData = data.map((booking: any) => ({
      id: booking.id,
      service_id: booking.service_id,
      service_name: booking.services?.name,
      service_name_ar: booking.services?.name_ar,
      slot_date: booking.slots?.slot_date,
      start_time: booking.slots?.start_time,
      end_time: booking.slots?.end_time,
      status: booking.status,
      total_price: booking.total_price,
      visitor_count: booking.visitor_count,
      notes: booking.notes,
      created_at: booking.created_at,
      review_id: booking.reviews?.[0]?.id || null,
      rating: booking.reviews?.[0]?.rating || null,
      review_approved: booking.reviews?.[0]?.is_approved || null,
    }));

    res.json(transformedData);
  } catch (error: any) {
    console.error('Error fetching customer bookings:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get customer profile
router.get('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('users')
      .select('id, email, username, full_name, full_name_ar, phone, role, tenant_id, created_at')
      .eq('id', userId)
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found' });
      }
      throw error;
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error fetching customer profile:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update customer profile
router.put('/profile', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;
    const { full_name, full_name_ar, phone } = req.body;

    const updateData: any = {};

    if (full_name !== undefined) {
      updateData.full_name = full_name;
    }

    if (full_name_ar !== undefined) {
      updateData.full_name_ar = full_name_ar;
    }

    if (phone !== undefined) {
      updateData.phone = phone;
    }

    if (Object.keys(updateData).length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add updated_at timestamp
    updateData.updated_at = new Date().toISOString();

    const { data, error } = await supabase
      .from('users')
      .update(updateData)
      .eq('id', userId)
      .select('id, email, username, full_name, full_name_ar, phone, role, tenant_id')
      .single();

    if (error) {
      if (error.code === 'PGRST116') {
        return res.status(404).json({ error: 'User not found' });
      }
      throw error;
    }

    res.json(data);
  } catch (error: any) {
    console.error('Error updating customer profile:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get customer's invoices with pagination, search, and lazy loading support
router.get('/invoices', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    // Extract query parameters
    const page = parseInt(req.query.page as string) || 1;
    const limit = parseInt(req.query.limit as string) || 10;
    const search = (req.query.search as string) || '';
    const offset = (page - 1) * limit;

    // Build query
    let query = supabase
      .from('bookings')
      .select(`
        id,
        zoho_invoice_id,
        zoho_invoice_created_at,
        total_price,
        status,
        payment_status,
        customer_name,
        customer_email,
        customer_phone,
        created_at,
        services:service_id (
          name,
          name_ar
        ),
        slots:slot_id (
          slot_date,
          start_time,
          end_time
        )
      `, { count: 'exact' })
      .eq('customer_id', userId)
      .not('zoho_invoice_id', 'is', null);

    // Add search filter if provided
    if (search && search.trim()) {
      const searchTerm = search.trim();
      query = query.or(`services.name.ilike.%${searchTerm}%,services.name_ar.ilike.%${searchTerm}%,zoho_invoice_id.ilike.%${searchTerm}%,customer_name.ilike.%${searchTerm}%`);
    }

    // Add pagination and ordering
    const { data, error, count } = await query
      .order('zoho_invoice_created_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) throw error;

    const total = count || 0;
    const totalPages = Math.ceil(total / limit);

    // Transform the nested data structure to match the original flat structure
    const transformedData = data.map((booking: any) => ({
      id: booking.id,
      zoho_invoice_id: booking.zoho_invoice_id,
      zoho_invoice_created_at: booking.zoho_invoice_created_at,
      total_price: booking.total_price,
      status: booking.status,
      payment_status: booking.payment_status,
      customer_name: booking.customer_name,
      customer_email: booking.customer_email,
      customer_phone: booking.customer_phone,
      created_at: booking.created_at,
      service_name: booking.services?.name || 'Unknown Service',
      service_name_ar: booking.services?.name_ar || '',
      slot_date: booking.slots?.slot_date,
      start_time: booking.slots?.start_time,
      end_time: booking.slots?.end_time,
    }));

    // Log for debugging
    console.log(`[Customer Invoices API] Customer: ${userId}, Page: ${page}, Limit: ${limit}, Total: ${total}, Results: ${transformedData.length}`);
    if (transformedData.length > 0) {
      const firstDate = transformedData[0].zoho_invoice_created_at || transformedData[0].created_at;
      const lastDate = transformedData[transformedData.length - 1].zoho_invoice_created_at || transformedData[transformedData.length - 1].created_at;
      console.log(`[Customer Invoices API] Date range: ${new Date(firstDate).toLocaleString()} to ${new Date(lastDate).toLocaleString()}`);
    }

    res.json({
      data: transformedData,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    });
  } catch (error: any) {
    console.error('Error fetching customer invoices:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Get latest invoice timestamp for a customer (for diagnostic purposes)
router.get('/invoices/latest', authenticate, async (req, res) => {
  try {
    const userId = req.user!.id;

    const { data, error } = await supabase
      .from('bookings')
      .select('zoho_invoice_id, zoho_invoice_created_at, created_at')
      .eq('customer_id', userId)
      .not('zoho_invoice_id', 'is', null)
      .order('zoho_invoice_created_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw error;

    if (data) {
      res.json({
        invoice_id: data.zoho_invoice_id,
        timestamp: data.zoho_invoice_created_at || data.created_at,
      });
    } else {
      res.json({
        invoice_id: null,
        timestamp: null,
      });
    }
  } catch (error: any) {
    console.error('Error fetching latest invoice:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export { router as customerRoutes };



