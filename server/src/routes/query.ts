import express from 'express';
import { supabase } from '../db';
import { invalidateEmployeeAvailabilityForTenant } from '../utils/employeeAvailabilityCache';

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

    // Parse select to handle both string and array formats
    // Support: string (comma-separated) or array of column names
    let cleanSelect: string;
    
    if (Array.isArray(select)) {
      // If select is an array, join with commas
      cleanSelect = select.join(',');
    } else if (typeof select === 'string') {
      // If select is a string, use it directly
      cleanSelect = select;
    } else {
      // Default to '*' if select is not provided or invalid
      cleanSelect = '*';
    }
    
    // Normalize the string (handle comma-separated columns and Supabase-style nested selects)
    // Express automatically decodes URL parameters, but we need to handle spaces
    cleanSelect = cleanSelect.trim();
    
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
          // Validate UUID format for id fields
          if (typeof value === 'string' && (key.toLowerCase().endsWith('id') || key.toLowerCase().endsWith('_id'))) {
            const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
            if (value.length > 0 && !uuidRegex.test(value)) {
              throw new Error(`Invalid UUID format for field "${key}": "${value}". UUIDs must be in the format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`);
            }
          }

          // Validate column name format (alphanumeric, underscore, no special chars)
          const validateColumnName = (col: string): string => {
            if (!col || !/^[a-z_][a-z0-9_]*$/i.test(col)) {
              throw new Error(`Invalid column name format: "${col}". Column names must start with a letter or underscore and contain only alphanumeric characters and underscores.`);
            }
            return col;
          };

          // CRITICAL: Convert frontend query builder syntax (__gte, __lte, etc.) to Supabase methods
          // This prevents "column does not exist" errors where __gte is treated as a column name
          if (key.endsWith('__neq')) {
            const column = validateColumnName(key.replace('__neq', ''));
            query = query.neq(column, value);
          } else if (key.endsWith('__in')) {
            const column = validateColumnName(key.replace('__in', ''));
            if (!Array.isArray(value)) {
              throw new Error(`Value for __in operator must be an array, got: ${typeof value}`);
            }
            if (value.length === 0) {
              // Empty array means no matches - use a condition that will never match
              query = query.eq(column, '__NO_MATCH__');
            } else {
              query = query.in(column, value);
            }
          } else if (key.endsWith('__gt')) {
            const column = validateColumnName(key.replace('__gt', ''));
            // Ensure value is a number for comparison operators
            if (typeof value !== 'number' && typeof value !== 'string') {
              throw new Error(`Value for __gt operator must be a number or string, got: ${typeof value}`);
            }
            query = query.gt(column, value);
          } else if (key.endsWith('__gte')) {
            const column = validateColumnName(key.replace('__gte', ''));
            if (typeof value !== 'number' && typeof value !== 'string') {
              throw new Error(`Value for __gte operator must be a number or string, got: ${typeof value}`);
            }
            query = query.gte(column, value);
          } else if (key.endsWith('__lt')) {
            const column = validateColumnName(key.replace('__lt', ''));
            if (typeof value !== 'number' && typeof value !== 'string') {
              throw new Error(`Value for __lt operator must be a number or string, got: ${typeof value}`);
            }
            query = query.lt(column, value);
          } else if (key.endsWith('__lte')) {
            const column = validateColumnName(key.replace('__lte', ''));
            if (typeof value !== 'number' && typeof value !== 'string') {
              throw new Error(`Value for __lte operator must be a number or string, got: ${typeof value}`);
            }
            query = query.lte(column, value);
          } else if (Array.isArray(value)) {
            // If value is array but key doesn't have __in suffix, use .in() method
            const column = validateColumnName(key);
            if (value.length === 0) {
              query = query.eq(column, '__NO_MATCH__');
            } else {
              query = query.in(column, value);
            }
          } else if (value === null || value === 'null') {
            // IS NULL: use .is() so PostgREST generates "col.is.null", not eq which can send literal "null" and break UUID columns
            const column = validateColumnName(key);
            query = query.is(column, null);
          } else {
            // Default: equality check
            const column = validateColumnName(key);
            query = query.eq(column, value);
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

    // Log as a single line so concurrent requests don't interleave and garble output
    const queryLog = {
      table,
      select: cleanSelect,
      where,
      orderBy,
      limit,
    };
    console.log('[Query]', JSON.stringify(queryLog));

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
        // Invalid column name - provide more context
        const columnHint = error.hint || error.details || '';
        errorMessage = `Invalid column name in query. Check your SELECT and WHERE clauses. ${columnHint}`;
        // Return 400 instead of 500 for client errors
        return res.status(400).json({ 
          error: errorMessage,
          code: error.code,
          details: error.details,
          hint: error.hint
        });
      } else if (error.code === '42501') {
        errorMessage = `Row Level Security (RLS) policy violation. The operation is blocked by RLS. ` +
          `To fix: Add SUPABASE_SERVICE_ROLE_KEY to server/.env (get it from Supabase Dashboard → Settings → API). ` +
          `The service role key bypasses RLS for backend operations.`;
      } else if (error.hint) {
        errorMessage = `${errorMessage} (Hint: ${error.hint})`;
      }
      
      // Use 400 for client errors (invalid queries), 500 for server errors
      const isClientError = ['PGRST116', '42P01', '42703', '22P02'].includes(error.code || '');
      return res.status(isClientError ? 400 : 500).json({ 
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

    let records = Array.isArray(data) ? data : [data];

    // Normalize employee_shifts so TIME and integer[] match DB expectations and CHECK constraints
    if (table === 'employee_shifts' && records.length > 0) {
      try {
        records = records.map((r: any) => {
          // Parse days_of_week: array, PostgreSQL "{0,1,2}", or "0,1,2"
          let days: number[] = [];
          const rawDays = r.days_of_week;
          if (Array.isArray(rawDays)) {
            days = (rawDays as any[]).map((d: any) => Number(d)).filter((n: number) => !Number.isNaN(n) && n >= 0 && n <= 6);
          } else if (typeof rawDays === 'string') {
            const s = rawDays.replace(/^\{|\}$/g, '').trim();
            if (s) days = s.split(',').map((x: string) => Number(x.trim())).filter((n: number) => !Number.isNaN(n) && n >= 0 && n <= 6);
          } else if (typeof rawDays === 'number' && rawDays >= 0 && rawDays <= 6) {
            days = [rawDays];
          }
          if (days.length === 0) {
            throw new Error('Each shift must have at least one day selected (days_of_week).');
          }
          const toTime = (v: any) => {
            if (v == null || v === '') return null;
            let s = String(v).trim();
            if (!s) return null;
            const tMatch = s.match(/T(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?(?:Z)?/i);
            if (tMatch) {
              const [, h, m, sec] = tMatch;
              return `${String(Number(h)).padStart(2, '0')}:${String(Number(m)).padStart(2, '0')}:${String(sec !== undefined ? Number(sec) : 0).padStart(2, '0')}`;
            }
            s = s.replace(/\.[0-9]+$/, '').slice(0, 12);
            if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) return s.length === 5 ? `${s}:00` : s;
            return null;
          };
          const start = toTime(r.start_time_utc);
          const end = toTime(r.end_time_utc);
          if (!start || !end) {
            throw new Error('Shift start_time_utc and end_time_utc must be valid times (e.g. 09:00 or 09:00:00).');
          }
          const [sh, sm] = start.split(':').map(Number);
          const [eh, em] = end.split(':').map(Number);
          const startM = (sh || 0) * 60 + (sm || 0);
          const endM = (eh || 0) * 60 + (em || 0);
          if (endM <= startM) {
            throw new Error('Shift end time must be after start time.');
          }
          return {
            tenant_id: r.tenant_id,
            employee_id: r.employee_id,
            days_of_week: days,
            start_time_utc: start,
            end_time_utc: end,
            is_active: r.is_active !== false,
          };
        });
      } catch (validationErr: any) {
        const msg = validationErr?.message || 'Invalid employee shift data.';
        console.error(`[Insert] employee_shifts validation:`, msg, 'Payload:', JSON.stringify(Array.isArray(data) ? data : [data]));
        return res.status(400).json({ error: msg });
      }
    }

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
      // Handle ON CONFLICT based on table using upsert with ignoreDuplicates
      if (table === 'package_services') {
        // Use upsert with ignoreDuplicates to handle duplicate (package_id, service_id) pairs
        query = supabase.from(table).upsert(records, { 
          onConflict: 'package_id,service_id',
          ignoreDuplicates: true 
        });
      } else if (table === 'employee_services') {
        // Use plain insert; ON CONFLICT varies by DB (two-column vs three-column unique). Duplicates get unique violation.
        query = supabase.from(table).insert(records);
      } else {
        query = supabase.from(table).insert(records);
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

      // Handle check constraint violations (e.g. employee_shifts: end_time > start_time, days_of_week not empty)
      if (error.code === '23514') {
        const msg = error.message || '';
        const friendly = msg.includes('end_time_utc') || msg.includes('start_time')
          ? 'Shift end time must be after start time.'
          : msg.includes('days_of_week') || msg.includes('array_length')
            ? 'Each shift must have at least one day selected.'
            : `Invalid data: ${msg}`;
        console.error(`[Insert] Check constraint violation (23514):`, msg);
        return res.status(400).json({ error: friendly });
      }
      
      // Generic error with full message
      const errorMessage = error.message || `Failed to insert into ${table}`;
      console.error(`[Insert] Generic error: ${errorMessage}`);
      throw new Error(errorMessage);
    }

    console.log(`[Insert] Successfully inserted ${result?.length || 0} record(s)`);

    // Invalidate employee-based availability cache when employee_shifts or employee_services change
    if ((table === 'employee_shifts' || table === 'employee_services') && records.length > 0) {
      const tenantId = (records[0] as any)?.tenant_id;
      if (tenantId) invalidateEmployeeAvailabilityForTenant(tenantId);
    }

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
      // Return a clear message when column is missing (migration not run on this DB)
      const msg = error.message || '';
      if (msg.includes('does not exist') && msg.includes('column')) {
        return res.status(500).json({
          error: msg,
          hint: 'A required database column may be missing. Run Supabase migrations (e.g. scheduling_mode on tenant_features).',
        });
      }
      throw error;
    }

    console.log(`[Update] Successfully updated ${result?.length || 0} record(s)`);

    // Invalidate employee-based availability cache when employee_shifts or employee_services change
    if ((table === 'employee_shifts' || table === 'employee_services') && result && (Array.isArray(result) ? result.length > 0 : result)) {
      const row = Array.isArray(result) ? result[0] : result;
      const tenantId = (row as any)?.tenant_id;
      if (tenantId) invalidateEmployeeAvailabilityForTenant(tenantId);
    }

    res.json(result);
  } catch (error: any) {
    console.error('[Update] ERROR:', error);
    const message = error.message || 'Update failed';
    const hint = message.includes('does not exist') && message.includes('column')
      ? ' Run Supabase migrations for this environment.'
      : undefined;
    res.status(500).json({ error: message, ...(hint && { hint }) });
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
