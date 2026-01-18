import express from 'express';
import { supabase } from '../db';

const router = express.Router();

// Generic query endpoint - supports both GET (for simple queries) and POST (for complex queries)
router.post('/query', async (req, res) => {
  try {
    const { table, select = '*', where, orderBy, limit } = req.body;

    if (!table) {
      return res.status(400).json({ error: 'Table name is required' });
    }

    // Validate table name to prevent SQL injection
    if (!/^[a-z_][a-z0-9_]*$/.test(table as string)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }

    // Start building the query
    let query = supabase.from(table as string);

    // Parse select to handle comma-separated columns and Supabase-style nested selects
    // Express automatically decodes URL parameters, but we need to handle spaces
    let cleanSelect = (select as string).trim();
    
    // Remove leading/trailing commas
    cleanSelect = cleanSelect.replace(/^,+|,+$/g, '').trim();
    
    // Normalize whitespace: replace multiple spaces/newlines with single space
    cleanSelect = cleanSelect.replace(/\s+/g, ' ');
    
    // Remove spaces after commas (e.g., "id, tenant_id" -> "id,tenant_id")
    // But keep spaces in nested relations (e.g., "services:service_id (name)")
    // Only remove spaces after commas that are not inside parentheses
    cleanSelect = cleanSelect.replace(/,\s+/g, ',');
    
    // Trim again after normalization
    cleanSelect = cleanSelect.trim();

    // Apply select (with nested relations)
    if (cleanSelect && cleanSelect !== '*') {
      query = query.select(cleanSelect);
    } else {
      query = query.select('*');
    }

    // Apply WHERE conditions
    if (where) {
      let conditions;
      // where can be either a string (from GET) or object (from POST)
      if (typeof where === 'string') {
        try {
          conditions = JSON.parse(where);
        } catch (parseError: any) {
          console.error('[Query] Failed to parse WHERE clause:', where);
          return res.status(400).json({ 
            error: 'Invalid WHERE clause format', 
            details: parseError.message 
          });
        }
      } else {
        conditions = where;
      }

      Object.entries(conditions).forEach(([key, value]) => {
        try {
          // CRITICAL: Convert frontend query builder syntax (__gte, __lte, etc.) to Supabase methods
          // This prevents "column does not exist" errors where __gte is treated as a column name
          if (key.endsWith('__neq')) {
            const column = key.replace('__neq', '');
            if (!column) {
              throw new Error(`Invalid column name after removing __neq suffix: ${key}`);
            }
            query = query.neq(column, value);
          } else if (key.endsWith('__in')) {
            const column = key.replace('__in', '');
            if (!column) {
              throw new Error(`Invalid column name after removing __in suffix: ${key}`);
            }
            if (!Array.isArray(value)) {
              throw new Error(`Value for __in operator must be an array, got: ${typeof value}`);
            }
            query = query.in(column, value);
          } else if (key.endsWith('__gt')) {
            const column = key.replace('__gt', '');
            if (!column) {
              throw new Error(`Invalid column name after removing __gt suffix: ${key}`);
            }
            query = query.gt(column, value);
          } else if (key.endsWith('__gte')) {
            const column = key.replace('__gte', '');
            if (!column) {
              throw new Error(`Invalid column name after removing __gte suffix: ${key}`);
            }
            query = query.gte(column, value);
          } else if (key.endsWith('__lt')) {
            const column = key.replace('__lt', '');
            if (!column) {
              throw new Error(`Invalid column name after removing __lt suffix: ${key}`);
            }
            query = query.lt(column, value);
          } else if (key.endsWith('__lte')) {
            const column = key.replace('__lte', '');
            if (!column) {
              throw new Error(`Invalid column name after removing __lte suffix: ${key}`);
            }
            query = query.lte(column, value);
          } else if (Array.isArray(value)) {
            // If value is array but key doesn't have __in suffix, use .in() method
            query = query.in(key, value);
          } else {
            // Default: equality check
            query = query.eq(key, value);
          }
        } catch (queryError: any) {
          console.error(`[Query] Error applying condition ${key}=${JSON.stringify(value)}:`, queryError);
          console.error(`[Query] Condition details:`, { key, value, type: typeof value, isArray: Array.isArray(value) });
          throw new Error(`Failed to apply WHERE condition: ${key} - ${queryError.message}`);
        }
      });
    }

    // Apply ORDER BY
    if (orderBy) {
      let order;
      // orderBy can be either a string (from GET) or object (from POST)
      if (typeof orderBy === 'string') {
        try {
          order = JSON.parse(orderBy);
        } catch (parseError: any) {
          console.error('[Query] Failed to parse ORDER BY clause:', orderBy);
          return res.status(400).json({ 
            error: 'Invalid ORDER BY clause format', 
            details: parseError.message 
          });
        }
      } else {
        order = orderBy;
      }
      query = query.order(order.column, { ascending: order.ascending !== false });
    }

    // Apply LIMIT
    if (limit) {
      const limitValue = typeof limit === 'string' ? parseInt(limit) : limit;
      if (!isNaN(limitValue) && limitValue > 0) {
        query = query.limit(limitValue);
      }
    }

    console.log('[Query] Executing Supabase query for table:', table);
    console.log('[Query] Raw select parameter:', select);
    console.log('[Query] Cleaned select:', cleanSelect);
    console.log('[Query] Where:', where);
    console.log('[Query] OrderBy:', orderBy);
    console.log('[Query] Limit:', limit);
    console.log('[Query] Full query params:', { table, select: cleanSelect, where, orderBy, limit });

    const { data, error } = await query;

    if (error) {
      console.error('[Query] Supabase error:', error);
      console.error('[Query] Error code:', error.code);
      console.error('[Query] Error details:', error.details);
      console.error('[Query] Error hint:', error.hint);
      
      // Provide more helpful error messages
      let errorMessage = error.message || 'Database query failed';
      
      // Handle common Supabase errors
      if (error.code === 'PGRST116') {
        errorMessage = `Column not found in table "${table}". Check your SELECT columns.`;
      } else if (error.code === '42P01') {
        errorMessage = `Table "${table}" does not exist.`;
      } else if (error.code === '42703') {
        errorMessage = `Invalid column name in query. Check your SELECT and WHERE clauses.`;
      } else if (error.code === '42501') {
        errorMessage = `Row Level Security (RLS) policy violation. The operation is blocked by RLS. ` +
          `To fix: Add SUPABASE_SERVICE_ROLE_KEY to server/.env (get it from Supabase Dashboard → Settings → API). ` +
          `The service role key bypasses RLS for backend operations.`;
      } else if (error.hint) {
        errorMessage = `${errorMessage} (Hint: ${error.hint})`;
      }
      
      return res.status(500).json({ 
        error: errorMessage,
        code: error.code,
        details: error.details,
        hint: error.hint
      });
    }

    res.json(data || []);
  } catch (error: any) {
    console.error('[Query] Unexpected error:', error);
    console.error('[Query] Error stack:', error.stack);
    console.error('[Query] Request body:', req.body);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      type: error.name || 'UnknownError',
      ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
  }
});

// GET handler for backward compatibility (simple queries only)
// Note: Complex queries with nested where clauses should use POST to avoid URL encoding issues
router.get('/query', async (req, res) => {
  // Redirect GET to POST by temporarily modifying request
  const originalMethod = req.method;
  const originalBody = req.body;
  
  try {
    const { table, select = '*', where, orderBy, limit } = req.query;

    if (!table) {
      return res.status(400).json({ error: 'Table name is required' });
    }

    // Convert GET params to POST body format
    req.method = 'POST';
    req.body = {
      table,
      select,
      where: where ? (typeof where === 'string' ? JSON.parse(where) : where) : undefined,
      orderBy: orderBy ? (typeof orderBy === 'string' ? JSON.parse(orderBy as string) : orderBy) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
    };

    // Find and call the POST handler
    const postHandler = router.stack.find((layer: any) => 
      layer.route?.path === '/query' && 
      layer.route?.methods?.post
    )?.route?.stack[0]?.handle;

    if (postHandler) {
      return postHandler(req, res);
    } else {
      throw new Error('POST handler not found');
    }
  } catch (error: any) {
    console.error('[Query GET] Error:', error);
    res.status(500).json({ 
      error: error.message || 'Internal server error',
      hint: 'For complex queries, use POST /api/query instead of GET'
    });
  } finally {
    // Restore original request
    req.method = originalMethod;
    req.body = originalBody;
  }
});

// Insert endpoint
router.post('/insert/:table', async (req, res) => {
  try {
    const { table } = req.params;
    const { data, returning = '*' } = req.body;

    if (!data) {
      return res.status(400).json({ error: 'Data is required' });
    }

    // Validate table name to prevent SQL injection
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }

    const records = Array.isArray(data) ? data : [data];

    // Check which key is being used
    const isUsingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
    console.log(`[Insert] Inserting ${records.length} record(s) into ${table}`);
    console.log(`[Insert] Using: ${isUsingServiceRole ? 'SERVICE_ROLE key' : 'ANON key (may fail due to RLS)'}`);

    // Use Supabase insert with upsert options based on table
    let query;
    
    // For users table, use upsert to handle duplicate IDs gracefully
    if (table === 'users') {
      // Use upsert with conflict resolution on 'id' column
      // This will update existing records or insert new ones
      query = supabase.from(table).upsert(records, { 
        onConflict: 'id',
        ignoreDuplicates: false 
      });
    } else if (table === 'tenants') {
      // For tenants table, use upsert to handle duplicate slugs gracefully
      // This will update existing records or insert new ones
      query = supabase.from(table).upsert(records, { 
        onConflict: 'slug',
        ignoreDuplicates: false 
      });
    } else {
      query = supabase.from(table).insert(records);

    // Handle ON CONFLICT based on table
    if (table === 'package_services') {
      query = query.ignoreDuplicates();
    } else if (table === 'employee_services') {
      query = query.ignoreDuplicates();
      }
    }

    // Apply select for returning
    if (returning && returning !== '*') {
      query = query.select(returning);
    } else {
      query = query.select();
    }

    const { data: result, error } = await query;

    if (error) {
      console.error(`[Insert] ❌ Error inserting into ${table}:`, error);
      console.error(`[Insert] Error code: ${error.code}`);
      console.error(`[Insert] Error message: ${error.message}`);
      console.error(`[Insert] Error details:`, JSON.stringify(error, null, 2));
      console.error(`[Insert] Data attempted:`, JSON.stringify(records, null, 2));
      
      // Provide helpful error message for RLS violations
      if (error.code === '42501') {
        const isUsingServiceRole = !!process.env.SUPABASE_SERVICE_ROLE_KEY;
        if (!isUsingServiceRole) {
          console.error('[Insert] RLS Error: Using ANON key. Service role key required for inserts.');
          console.error('[Insert] Solution: Add SUPABASE_SERVICE_ROLE_KEY to server/.env');
          throw new Error(
            'Row Level Security (RLS) policy violation. ' +
            'The backend is using ANON key which is subject to RLS policies. ' +
            'Add SUPABASE_SERVICE_ROLE_KEY to server/.env to bypass RLS. ' +
            'Get it from: Supabase Dashboard → Settings → API → service_role key (secret)'
          );
        } else {
          console.error('[Insert] RLS Error: Even with service role key, RLS is blocking. Check RLS policies in Supabase.');
          throw new Error(
            'Row Level Security (RLS) policy violation. ' +
            'Even with service role key, the operation is blocked. ' +
            'This may indicate: 1) RLS policies need to be updated, 2) Service role key is incorrect, ' +
            'or 3) Table has restrictive RLS policies. Check Supabase Dashboard → Authentication → Policies.'
          );
        }
      }
      
      // Handle unique constraint violations
      if (error.code === '23505') {
        const constraintMatch = error.message.match(/Key \(([^)]+)\)=\([^)]+\) already exists/);
        
        // For users table, try to return the existing record instead of error
        if (table === 'users' && records.length === 1 && records[0].id) {
          console.log(`[Insert] User with ID ${records[0].id} already exists, fetching existing record...`);
          const { data: existingUser, error: fetchError } = await supabase
            .from('users')
            .select(returning && returning !== '*' ? returning : '*')
            .eq('id', records[0].id)
            .single();
          
          if (!fetchError && existingUser) {
            console.log(`[Insert] Returning existing user record`);
            return res.json(Array.isArray(data) ? [existingUser] : existingUser);
          }
        }
        
        // For tenants table, try to return the existing record instead of error
        if (table === 'tenants' && records.length === 1) {
          // Try to find by slug first (most common conflict)
          const slug = records[0].slug;
          if (slug) {
            console.log(`[Insert] Tenant with slug "${slug}" already exists, fetching existing record...`);
            const { data: existingTenant, error: fetchError } = await supabase
              .from('tenants')
              .select(returning && returning !== '*' ? returning : '*')
              .eq('slug', slug)
              .single();
            
            if (!fetchError && existingTenant) {
              console.log(`[Insert] Returning existing tenant record`);
              return res.json(Array.isArray(data) ? [existingTenant] : existingTenant);
            }
          }
          
          // Fallback: try to find by ID if provided
          if (records[0].id) {
            console.log(`[Insert] Tenant with ID ${records[0].id} already exists, fetching existing record...`);
            const { data: existingTenant, error: fetchError } = await supabase
              .from('tenants')
              .select(returning && returning !== '*' ? returning : '*')
              .eq('id', records[0].id)
              .single();
            
            if (!fetchError && existingTenant) {
              console.log(`[Insert] Returning existing tenant record`);
              return res.json(Array.isArray(data) ? [existingTenant] : existingTenant);
            }
          }
        }
        
        if (constraintMatch) {
          throw new Error(
            `Duplicate entry: ${constraintMatch[1]} already exists. ` +
            `Please use a different value or update the existing record.`
          );
        }
        throw new Error(`Duplicate entry: ${error.message}`);
      }
      
      // Handle not null violations
      if (error.code === '23502') {
        const columnMatch = error.message.match(/null value in column "([^"]+)"/);
        if (columnMatch) {
          throw new Error(
            `Missing required field: ${columnMatch[1]} is required but was not provided.`
          );
        }
        throw new Error(`Missing required field: ${error.message}`);
      }
      
      // Handle foreign key violations
      if (error.code === '23503') {
        throw new Error(
          `Foreign key violation: ${error.message}. ` +
          `Make sure all referenced records exist.`
        );
      }
      
      // Generic error with full message
      const errorMessage = error.message || `Failed to insert into ${table}`;
      console.error(`[Insert] Generic error: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    console.log(`[Insert] Successfully inserted ${result?.length || 0} record(s)`);

    res.json(Array.isArray(data) ? result : result?.[0]);
  } catch (error: any) {
    console.error('Insert error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Update endpoint
router.post('/update/:table', async (req, res) => {
  try {
    const { table } = req.params;
    let { data, where } = req.body;

    if (!data || !where) {
      return res.status(400).json({ error: 'Data and where clause are required' });
    }

    // Validate table name to prevent SQL injection
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }

    // Clean data to convert string "NULL" to actual null
    const cleanRequestBody = (obj: any): any => {
      if (obj === null || obj === undefined) return obj;
      if (typeof obj !== 'object') {
        if (obj === 'NULL' || obj === 'null' || (typeof obj === 'string' && obj.trim().toUpperCase() === 'NULL')) {
          return null;
        }
        return obj;
      }
      if (Array.isArray(obj)) {
        return obj.map(cleanRequestBody);
      }
      const cleaned: any = {};
      Object.keys(obj).forEach(key => {
        const value = obj[key];
        if (value === 'NULL' || value === 'null' || (typeof value === 'string' && value.trim().toUpperCase() === 'NULL')) {
          cleaned[key] = null;
        } else if (typeof value === 'object' && value !== null) {
          cleaned[key] = cleanRequestBody(value);
        } else {
          cleaned[key] = value;
        }
      });
      return cleaned;
    };

    console.log('[Update] BEFORE cleaning - Raw req.body.data:', JSON.stringify(data, null, 2));
    data = cleanRequestBody(data);
    console.log('[Update] AFTER cleaning - Cleaned data:', JSON.stringify(data, null, 2));

    // Start building the update query
    let query = supabase.from(table).update(data);

    // Apply WHERE conditions
    Object.entries(where).forEach(([key, value]) => {
      query = query.eq(key, value);
    });

    // Return all columns
    query = query.select();

    console.log(`[Update] Updating table "${table}" with data:`, data);
    console.log(`[Update] Where conditions:`, where);

    const { data: result, error } = await query;

    if (error) {
      console.error('[Update] Supabase error:', error);
      throw error;
    }

    console.log(`[Update] Successfully updated ${result?.length || 0} record(s)`);

    res.json(result);
  } catch (error: any) {
    console.error('[Update] ERROR:', error);
    console.error('[Update] Error message:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Delete endpoint
router.post('/delete/:table', async (req, res) => {
  try {
    const { table } = req.params;
    const { where } = req.body;

    if (!where) {
      return res.status(400).json({ error: 'Where clause is required' });
    }

    // Validate table name to prevent SQL injection
    if (!/^[a-z_][a-z0-9_]*$/.test(table)) {
      return res.status(400).json({ error: 'Invalid table name' });
    }

    // For services table, warn about related bookings
    if (table === 'services' && where.id) {
      const { count, error } = await supabase
        .from('bookings')
        .select('*', { count: 'exact', head: true })
        .eq('service_id', where.id);

      if (!error && count && count > 0) {
        console.log(`[Delete] Warning: Deleting service ${where.id} will also delete ${count} associated booking(s) due to CASCADE`);
      }
    }

    // Start building the delete query
    let query = supabase.from(table).delete();

    // Apply WHERE conditions
    Object.entries(where).forEach(([key, value]) => {
      if (Array.isArray(value)) {
        query = query.in(key, value);
      } else {
        query = query.eq(key, value);
      }
    });

    // Return deleted rows
    query = query.select();

    console.log('[Delete] Deleting from table:', table);
    console.log('[Delete] Where conditions:', where);

    const { data: result, error } = await query;

    if (error) {
      console.error('[Delete] Supabase error:', error);

      // Handle foreign key constraint violations
      if (error.code === '23503') {
        let message = 'Cannot delete this record because it is referenced by related records.';

        if (table === 'services') {
          message = 'Cannot delete service because it has associated bookings. Please delete or reassign the bookings first.';
        } else if (table === 'shifts') {
          message = 'Cannot delete shift because it has associated bookings. Please delete or reassign the bookings first.';
        } else if (table === 'slots') {
          message = 'Cannot delete slot because it has associated bookings. Please delete or reassign the bookings first.';
        }

        return res.status(409).json({
          error: 'Cannot delete record',
          message: message,
          details: {
            code: error.code,
            hint: error.hint
          }
        });
      }

      throw error;
    }

    console.log(`[Delete] Successfully deleted ${result?.length || 0} record(s)`);

    res.json(result);
  } catch (error: any) {
    console.error('Delete error:', error);
    res.status(500).json({ error: error.message });
  }
});

// RPC endpoint (for database functions)
router.post('/rpc/:function', async (req, res) => {
  try {
    const { function: functionName } = req.params;
    const params = req.body || {};

    console.log('[RPC] Calling function:', functionName);
    console.log('[RPC] Params:', params);

    const { data, error } = await supabase.rpc(functionName, params);

    if (error) {
      console.error('[RPC] Supabase error:', error);
      throw error;
    }

    res.json(data);
  } catch (error: any) {
    console.error('RPC error:', error);
    res.status(500).json({ error: error.message });
  }
});

export { router as queryRoutes };
