// PostgreSQL Database Client
// Replaces Supabase client with direct PostgreSQL connection via API
// Falls back to Supabase Auth in production if backend is not available

import { createClient } from '@supabase/supabase-js';

// Supabase client for fallback authentication
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabaseClient = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

// In Bolt/WebContainer, use relative URLs to go through Vite proxy
// Otherwise use the configured API URL or default to localhost
const getApiUrl = () => {
  // Check if we're in development mode (Vite dev server)
  const isViteDev = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' && window.location.port === '5173') ||
    window.location.hostname.includes('webcontainer');

  // Check if we're in Bolt production (no backend available)
  const isBoltProduction = typeof window !== 'undefined' &&
    window.location.hostname.includes('.bolt.host');

  if (isViteDev) {
    // Development: Use relative URL - Vite proxy will handle it
    console.log('[db] Using Vite dev proxy for API');
    return '/api';
  }

  if (isBoltProduction) {
    // Bolt production: No backend available, will use Supabase fallback
    console.log('[db] Bolt production detected, backend not available');
    return '/api'; // Will fail and trigger Supabase fallback
  }

  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
};

const API_URL = getApiUrl();

// Track backend availability
let backendAvailable: boolean | null = null;
let lastBackendCheck: number = 0;
// In production (Bolt), check every time. In dev, cache for 60 seconds
const isBoltProduction = typeof window !== 'undefined' && window.location.hostname.includes('bolt.host');
const BACKEND_CHECK_INTERVAL = isBoltProduction ? 0 : 60000;

// Check if backend server is available
async function isBackendAvailable(): Promise<boolean> {
  const now = Date.now();
  if (backendAvailable !== null && (now - lastBackendCheck) < BACKEND_CHECK_INTERVAL) {
    console.log('[db] Using cached backend availability:', backendAvailable);
    return backendAvailable;
  }

  console.log('[db] Checking backend availability at:', `${API_URL}/health`);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1000); // 1 second timeout

    const response = await fetch(`${API_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
    });
    clearTimeout(timeout);

    backendAvailable = response.ok;
    lastBackendCheck = now;
    console.log('[db] Backend availability check result:', {
      available: backendAvailable,
      status: response.status,
      ok: response.ok
    });
    return backendAvailable;
  } catch (error: any) {
    backendAvailable = false;
    lastBackendCheck = now;
    console.log('[db] Backend availability check failed:', error.message);
    return false;
  }
}

class DatabaseClient {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_URL;
  }

  private async request(endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<{ data: any; error: any }> {
    const maxRetries = 3;
    const retryDelay = 1000; // Start with 1 second
    
    try {
      const token = localStorage.getItem('auth_token');
      const url = `${this.baseUrl}${endpoint}`;
      
      // Use longer timeout in WebContainer/Bolt environments
      // Increase timeout for tenant queries which may be slower
      const isTenantQuery = endpoint.includes('tenants') || endpoint.includes('query') && endpoint.includes('table=tenants');
      const baseTimeout = url.startsWith('/') ? 30000 : 10000; // 30s for relative URLs, 10s for absolute
      const timeout = isTenantQuery ? baseTimeout * 2 : baseTimeout; // 60s for tenant queries, 30s/10s for others
      
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          ...(token && { Authorization: `Bearer ${token}` }),
          ...options.headers,
        },
        signal: AbortSignal.timeout(timeout),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({ message: response.statusText }));
        
        // Handle token expiration - try to refresh
        if (response.status === 401 && (error.message?.includes('token') || error.message?.includes('expired') || error.expired)) {
          // Try to refresh token
          try {
            const refreshResult = await this.auth.refreshSession();
            if (refreshResult.data && !refreshResult.error) {
              // Retry the original request with new token
              const newToken = localStorage.getItem('auth_token');
              const retryResponse = await fetch(`${this.baseUrl}${endpoint}`, {
                ...options,
                headers: {
                  'Content-Type': 'application/json',
                  ...(newToken && { Authorization: `Bearer ${newToken}` }),
                  ...options.headers,
                },
              });
              
              if (retryResponse.ok) {
                const retryData = await retryResponse.json();
                return { data: retryData, error: null };
              }
            }
          } catch (refreshError) {
            // Refresh failed, return original error
            console.warn('[db.request] Token refresh failed:', refreshError);
          }
        }
        
        return { data: null, error };
      }

      const data = await response.json();
      return { data, error: null };
    } catch (error: any) {
      // Network errors shouldn't trigger logout
      const errorMessage = error.message || 'Network error';
      const errorName = error.name || '';
      
      // Check if this is a retryable network error
      const isRetryableError = (
        errorMessage.includes('ERR_CONNECTION_REFUSED') ||
        errorMessage.includes('Failed to fetch') ||
        errorName === 'TypeError' ||
        errorMessage.includes('network') ||
        errorMessage.includes('timeout') ||
        errorName === 'AbortError'
      );
      
      // Retry logic for network errors (exponential backoff)
      if (isRetryableError && retryCount < maxRetries) {
        const delay = retryDelay * Math.pow(2, retryCount); // Exponential backoff: 1s, 2s, 4s
        console.warn(`[db.request] Network error, retrying in ${delay}ms... (attempt ${retryCount + 1}/${maxRetries})`);
        
        await new Promise(resolve => setTimeout(resolve, delay));
        return this.request(endpoint, options, retryCount + 1);
      }
      
      // Provide more helpful error messages
      let userFriendlyMessage = errorMessage;
      let errorCode = 'NETWORK_ERROR';
      
      if (errorMessage.includes('ERR_CONNECTION_REFUSED') || 
          errorMessage.includes('Failed to fetch') ||
          errorName === 'TypeError' ||
          errorMessage.includes('network')) {
        // Check if we're in Bolt/WebContainer
        const isWebContainer = typeof window !== 'undefined' && 
          (window.location.hostname.includes('webcontainer') || 
           window.location.hostname.includes('bolt'));
        
        if (isWebContainer) {
          userFriendlyMessage = 'Cannot connect to backend. In Bolt/WebContainer, make sure:\n\n1. The backend server is running (check terminal)\n2. Both frontend and backend are started with: npm run dev\n3. Wait a few seconds for services to initialize';
        } else {
          userFriendlyMessage = 'Backend server is not running. Please start the server:\n\n1. Open terminal\n2. cd to project/server\n3. Run: npm run dev\n\nOr double-click start-server.bat';
        }
        errorCode = 'SERVER_NOT_RUNNING';
      } else if (errorMessage.includes('timeout') || errorName === 'AbortError' || errorMessage.includes('signal timed out')) {
        // For timeout errors, return a more graceful message that doesn't require user action
        userFriendlyMessage = 'Request is taking longer than expected. Please wait...';
        errorCode = 'TIMEOUT';
      }
      
      // Enhanced error logging - consolidated into single message (only on final failure)
      if (retryCount >= maxRetries) {
        const errorDetails = [
          '╔═══════════════════════════════════════════════════════════════╗',
          '║                    NETWORK CONNECTION ERROR                   ║',
          '╠═══════════════════════════════════════════════════════════════╣',
          `║ Error: ${errorMessage.padEnd(57)}║`,
          `║ Type: ${errorName.padEnd(60)}║`,
          `║ URL: ${`${this.baseUrl}${endpoint}`.padEnd(61)}║`,
          `║ Retries: ${retryCount}/${maxRetries}${' '.repeat(52)}║`,
          '╠═══════════════════════════════════════════════════════════════╣',
        ];
        
        if (errorCode === 'SERVER_NOT_RUNNING') {
          errorDetails.push(
            '║ SOLUTION: Start the backend server                          ║',
            '║                                                               ║',
            '║ Method 1: Double-click start-server.bat in server folder     ║',
            '║ Method 2: Run: cd server && npm run dev                       ║',
            '║                                                               ║',
            '║ Then verify: http://localhost:3001/health                   ║'
          );
        }
        
        errorDetails.push('╚═══════════════════════════════════════════════════════════════╝');
        
        // Log as single message to reduce console noise
        console.error(errorDetails.join('\n'));
      }
      
      // Log additional details separately if needed
      if (import.meta.env.DEV && error.stack && retryCount >= maxRetries) {
        console.debug('Stack trace:', error.stack);
      }
      
      return { 
        data: null, 
        error: { 
          message: userFriendlyMessage,
          originalMessage: errorMessage,
          code: errorCode
        } 
      };
    }
  }

  from(table: string) {
    const self = this;
    let queryParams: any = {
      table,
      select: '*',
      where: {},
      orderBy: null,
      limit: null,
    };

    // Helper to check if we should use Supabase fallback
    const shouldUseSupabaseFallback = async () => {
      const available = await isBackendAvailable();
      return !available && supabaseClient !== null;
    };

    const builder: any = {
      select: (columns: string = '*') => {
        queryParams.select = columns;
        return builder;
      },
      eq: (column: string, value: any) => {
        queryParams.where[column] = value;
        return builder;
      },
      neq: (column: string, value: any) => {
        queryParams.where[`${column}__neq`] = value;
        return builder;
      },
      in: (column: string, values: any[]) => {
        queryParams.where[`${column}__in`] = values;
        return builder;
      },
      gte: (column: string, value: any) => {
        queryParams.where[`${column}__gte`] = value;
        return builder;
      },
      lte: (column: string, value: any) => {
        queryParams.where[`${column}__lte`] = value;
        return builder;
      },
      gt: (column: string, value: any) => {
        queryParams.where[`${column}__gt`] = value;
        return builder;
      },
      lt: (column: string, value: any) => {
        queryParams.where[`${column}__lt`] = value;
        return builder;
      },
      order: (column: string, options?: { ascending?: boolean }) => {
        queryParams.orderBy = { column, ascending: options?.ascending !== false };
        return builder;
      },
      limit: (count: number) => {
        queryParams.limit = count;
        return builder;
      },
      maybeSingle: async () => {
        if (await shouldUseSupabaseFallback()) {
          let query = supabaseClient!.from(table).select(queryParams.select);
          Object.keys(queryParams.where).forEach(key => {
            query = query.eq(key, queryParams.where[key]);
          });
          if (queryParams.orderBy) {
            query = query.order(queryParams.orderBy.column, { ascending: queryParams.orderBy.ascending });
          }
          const { data, error } = await query.limit(1).maybeSingle();
          return { data, error };
        }

        queryParams.limit = 1;
        const result = await self.request(`/query?${new URLSearchParams({
          table: queryParams.table,
          select: queryParams.select,
          where: JSON.stringify(queryParams.where),
          ...(queryParams.orderBy && { orderBy: JSON.stringify(queryParams.orderBy) }),
          limit: '1',
        }).toString()}`);
        return { data: result.data?.[0] || null, error: result.error };
      },
      single: async () => {
        if (await shouldUseSupabaseFallback()) {
          let query = supabaseClient!.from(table).select(queryParams.select);
          Object.keys(queryParams.where).forEach(key => {
            query = query.eq(key, queryParams.where[key]);
          });
          if (queryParams.orderBy) {
            query = query.order(queryParams.orderBy.column, { ascending: queryParams.orderBy.ascending });
          }
          const { data, error } = await query.limit(1).single();
          return { data, error };
        }

        queryParams.limit = 1;
        const result = await self.request(`/query?${new URLSearchParams({
          table: queryParams.table,
          select: queryParams.select,
          where: JSON.stringify(queryParams.where),
          ...(queryParams.orderBy && { orderBy: JSON.stringify(queryParams.orderBy) }),
          limit: '1',
        }).toString()}`);
        if (result.error) return { data: null, error: result.error };
        if (!result.data || result.data.length === 0) {
          return { data: null, error: { message: 'No rows returned' } };
        }
        return { data: result.data[0], error: null };
      },
      then: async (resolve?: any, reject?: any) => {
        if (await shouldUseSupabaseFallback()) {
          let query = supabaseClient!.from(table).select(queryParams.select);
          Object.keys(queryParams.where).forEach(key => {
            query = query.eq(key, queryParams.where[key]);
          });
          if (queryParams.orderBy) {
            query = query.order(queryParams.orderBy.column, { ascending: queryParams.orderBy.ascending });
          }
          if (queryParams.limit) {
            query = query.limit(queryParams.limit);
          }
          const { data, error } = await query;
          if (error) {
            if (reject) reject(error);
            return { data: null, error };
          }
          if (resolve) resolve({ data, error: null });
          return { data, error: null };
        }

        const params = new URLSearchParams({
          table: queryParams.table,
          select: queryParams.select,
          where: JSON.stringify(queryParams.where),
        });
        if (queryParams.orderBy) params.append('orderBy', JSON.stringify(queryParams.orderBy));
        if (queryParams.limit) params.append('limit', queryParams.limit.toString());

        const result = await self.request(`/query?${params.toString()}`);
        if (result.error) {
          if (reject) reject(result.error);
          return { data: null, error: result.error };
        }
        if (resolve) resolve({ data: result.data, error: null });
        return { data: result.data, error: null };
      },
      insert: (data: any | any[]) => ({
        select: (columns: string = '*') => ({
          single: async () => {
            if (await shouldUseSupabaseFallback()) {
              const { data: result, error } = await supabaseClient!
                .from(table)
                .insert(data)
                .select(columns)
                .single();
              return { data: result, error };
            }

            const result = await self.request(`/insert/${table}`, {
              method: 'POST',
              body: JSON.stringify({ data, returning: columns }),
            });
            if (result.error) return { data: null, error: result.error };
            return { data: Array.isArray(data) ? result.data[0] : result.data, error: null };
          },
          then: async (resolve?: any, reject?: any) => {
            if (await shouldUseSupabaseFallback()) {
              const { data: result, error } = await supabaseClient!
                .from(table)
                .insert(data)
                .select(columns);
              if (error) {
                if (reject) reject(error);
                return { data: null, error };
              }
              if (resolve) resolve({ data: result, error: null });
              return { data: result, error: null };
            }

            const result = await self.request(`/insert/${table}`, {
              method: 'POST',
              body: JSON.stringify({ data, returning: columns }),
            });
            if (result.error) {
              if (reject) reject(result.error);
              return { data: null, error: result.error };
            }
            if (resolve) resolve({ data: result.data, error: null });
            return { data: result.data, error: null };
          },
        }),
        then: async (resolve?: any, reject?: any) => {
          if (await shouldUseSupabaseFallback()) {
            const { data: result, error } = await supabaseClient!
              .from(table)
              .insert(data)
              .select();
            if (error) {
              if (reject) reject(error);
              return { data: null, error };
            }
            if (resolve) resolve({ data: result, error: null });
            return { data: result, error: null };
          }

          const result = await self.request(`/insert/${table}`, {
            method: 'POST',
            body: JSON.stringify({ data }),
          });
          if (result.error) {
            if (reject) reject(result.error);
            return { data: null, error: result.error };
          }
          if (resolve) resolve({ data: result.data, error: null });
          return { data: result.data, error: null };
        },
      }),
      update: (data: any) => {
        // Clean data before sending - remove any string "NULL" values
        const cleanData = (data: any): any => {
          console.log('[db.ts] cleanData - Input data:', JSON.stringify(data, null, 2));
          const cleaned: any = {};
          Object.keys(data).forEach(key => {
            const value = data[key];
            console.log(`[db.ts] cleanData - Processing key "${key}":`, {
              value,
              type: typeof value,
              isNull: value === null,
              isUndefined: value === undefined,
              isStringNULL: value === 'NULL' || value === 'null' || (typeof value === 'string' && value.trim().toUpperCase() === 'NULL')
            });
            // Convert string "NULL" to actual null
            if (value === 'NULL' || value === 'null' || (typeof value === 'string' && value.trim().toUpperCase() === 'NULL')) {
              console.log(`[db.ts] cleanData - Converting "${key}" from string "NULL" to null`);
              cleaned[key] = null;
            } else {
              cleaned[key] = value;
            }
          });
          console.log('[db.ts] cleanData - Output cleaned data:', JSON.stringify(cleaned, null, 2));
          return cleaned;
        };
        
        return {
          eq: (column: string, value: any) => ({
            then: async (resolve?: any, reject?: any) => {
              const cleanedData = cleanData(data);
              const result = await self.request(`/update/${table}`, {
                method: 'POST',
                body: JSON.stringify({ data: cleanedData, where: { [column]: value } }),
              });
              if (result.error) {
                if (reject) reject(result.error);
                return { data: null, error: result.error };
              }
              if (resolve) resolve({ data: result.data, error: null });
              return { data: result.data, error: null };
            },
          }),
          then: async (resolve?: any, reject?: any) => {
            const cleanedData = cleanData(data);
            const result = await self.request(`/update/${table}`, {
              method: 'POST',
              body: JSON.stringify({ data: cleanedData, where: queryParams.where }),
            });
            if (result.error) {
              if (reject) reject(result.error);
              return { data: null, error: result.error };
            }
            if (resolve) resolve({ data: result.data, error: null });
            return { data: result.data, error: null };
          },
        };
      },
      delete: () => ({
        eq: (column: string, value: any) => ({
          then: async (resolve?: any, reject?: any) => {
            const result = await self.request(`/delete/${table}`, {
              method: 'POST',
              body: JSON.stringify({ where: { [column]: value } }),
            });
            if (result.error) {
              if (reject) reject(result.error);
              return { data: null, error: result.error };
            }
            if (resolve) resolve({ data: result.data, error: null });
            return { data: result.data, error: null };
          },
        }),
      }),
    };

    // Initialize with select
    builder.select = (columns: string = '*') => {
      queryParams.select = columns;
      return builder;
    };

    return builder;
  }

  // RPC method (for database functions)
  rpc(functionName: string, params?: Record<string, any>) {
    return {
      then: async (resolve?: any, reject?: any) => {
        const result = await this.request(`/rpc/${functionName}`, {
          method: 'POST',
          body: JSON.stringify(params || {}),
        });
        if (result.error) {
          if (reject) reject(result.error);
          return { data: null, error: result.error };
        }
        if (resolve) resolve({ data: result.data, error: null });
        return { data: result.data, error: null };
      },
    };
  }

  // Auth methods
  auth = {
    getSession: async () => {
      // Try to get session from multiple possible locations
      const sessionStr = localStorage.getItem('auth_session');
      const supabaseTokenStr = localStorage.getItem('supabase.auth.token');
      const token = localStorage.getItem('auth_token');
      const userDataStr = localStorage.getItem('user_data');
      
      // First, try auth_session (standard location)
      if (sessionStr) {
        try {
          const session = JSON.parse(sessionStr);
          // Ensure session has required structure
          if (session && session.user && session.access_token) {
            return { data: { session }, error: null };
          } else {
            console.warn('[db.auth.getSession] Invalid session structure:', session);
          }
        } catch (error) {
          console.error('[db.auth.getSession] Error parsing auth_session:', error);
        }
      }
      
      // Second, try supabase.auth.token (used by OTP flow)
      if (supabaseTokenStr) {
        try {
          const supabaseSession = JSON.parse(supabaseTokenStr);
          if (supabaseSession && supabaseSession.user && supabaseSession.access_token) {
            // Also check if we have user_data to enrich the session
            let user = supabaseSession.user;
            if (userDataStr) {
              try {
                const userData = JSON.parse(userDataStr);
                // Merge user data to ensure we have the correct user ID
                user = { ...user, ...userData };
              } catch (e) {
                console.warn('[db.auth.getSession] Error parsing user_data:', e);
              }
            }
            return { 
              data: { 
                session: { 
                  user, 
                  access_token: supabaseSession.access_token || token 
                } 
              }, 
              error: null 
            };
          }
        } catch (error) {
          console.error('[db.auth.getSession] Error parsing supabase.auth.token:', error);
        }
      }
      
      // Third, try to reconstruct from token and user_data
      if (token) {
        let user: { id: string; email?: string; username?: string } = { id: 'unknown' };
        
        // Try to get user ID from user_data
        if (userDataStr) {
          try {
            const userData = JSON.parse(userDataStr);
            if (userData.id) {
              user = { 
                id: userData.id, 
                ...(userData.email && { email: userData.email }), 
                ...(userData.username && { username: userData.username })
              };
            }
          } catch (e) {
            console.warn('[db.auth.getSession] Error parsing user_data:', e);
          }
        }
        
        return { 
          data: { 
            session: { 
              user, 
              access_token: token 
            } 
          }, 
          error: null 
        };
      }
      
      return { data: { session: null }, error: null };
    },
    signInWithPassword: async (credentials: { email?: string; username?: string; password: string; forCustomer?: boolean }) => {
      // Check if backend is available
      const useBackend = await isBackendAvailable();

      if (!useBackend && supabaseClient) {
        // Fall back to Supabase Auth
        console.log('[db] Backend not available, using Supabase Auth fallback');

        try {
          const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: credentials.email || credentials.username || '',
            password: credentials.password,
          });

          if (error) throw error;

          if (data?.session && data?.user) {
            // Store session
            localStorage.setItem('auth_session', JSON.stringify(data.session));
            localStorage.setItem('auth_token', data.session.access_token);

            // Fetch user profile from database
            const { data: userProfile, error: profileError } = await supabaseClient
              .from('users')
              .select('*, tenants(*)')
              .eq('id', data.user.id)
              .single();

            if (profileError) {
              console.error('[db] Error fetching user profile:', profileError);
              return {
                data: null,
                error: { message: 'Failed to fetch user profile', code: 'PROFILE_FETCH_ERROR' }
              };
            }

            // Check if customer is trying to access non-customer pages
            if (credentials.forCustomer === false && userProfile.role === 'customer') {
              await supabaseClient.auth.signOut();
              return {
                data: null,
                error: { message: 'Access denied: Customers cannot use this login page', code: 'CUSTOMER_ACCESS_DENIED' }
              };
            }

            return {
              data: {
                session: data.session,
                user: userProfile,
                tenant: userProfile.tenants
              },
              error: null
            };
          }

          return { data: null, error: { message: 'No session data returned', code: 'NO_SESSION' } };
        } catch (error: any) {
          console.error('[db] Supabase Auth fallback error:', error);
          return {
            data: null,
            error: { message: error.message || 'Authentication failed', code: error.code || 'AUTH_ERROR' }
          };
        }
      }

      // Use backend API
      const result = await this.request('/auth/signin', {
        method: 'POST',
        body: JSON.stringify(credentials),
      });
      if (result.data?.session) {
        localStorage.setItem('auth_session', JSON.stringify(result.data.session));
        localStorage.setItem('auth_token', result.data.session.access_token);
      }
      return result;
    },
    signUp: async (credentials: {
      email?: string;
      username?: string;
      password: string;
      full_name?: string;
      role?: string;
      tenant_id?: string;
      phone?: string;
      options?: {
        data?: {
          full_name?: string;
          role?: string;
          tenant_id?: string;
          phone?: string;
        };
      };
    }) => {
      // Extract data from options.data (Supabase-style) or from direct parameters
      const full_name = credentials.options?.data?.full_name || credentials.full_name;
      const role = credentials.options?.data?.role || credentials.role;
      const tenant_id = credentials.options?.data?.tenant_id || credentials.tenant_id;
      const phone = credentials.options?.data?.phone || credentials.phone;
      const email = credentials.email || credentials.username;

      // Check if backend is available
      const useBackend = await isBackendAvailable();

      if (!useBackend && supabaseClient) {
        // Fall back to Supabase Auth + direct database insert
        console.log('[db] Backend not available, using Supabase Auth fallback for signup');

        try {
          // First, create the auth user
          const { data: authData, error: authError } = await supabaseClient.auth.signUp({
            email: email || '',
            password: credentials.password,
          });

          if (authError) throw authError;

          if (authData?.user) {
            // Now create the user profile in the users table
            const { data: userProfile, error: profileError } = await supabaseClient
              .from('users')
              .insert({
                id: authData.user.id,
                email,
                phone,
                full_name,
                role: role || 'tenant_admin',
                tenant_id,
                is_active: true,
              })
              .select()
              .single();

            if (profileError) {
              console.error('[db] Error creating user profile:', profileError);
              // Note: Can't clean up auth user with anon key (would need service_role key)
              // The auth user will remain but won't be able to login without a profile
              return {
                data: null,
                error: {
                  message: profileError.message || 'Failed to create user profile',
                  code: profileError.code || 'PROFILE_CREATE_ERROR',
                  details: profileError.details || profileError.hint
                }
              };
            }

            // Store session if available
            if (authData.session) {
              localStorage.setItem('auth_session', JSON.stringify(authData.session));
              localStorage.setItem('auth_token', authData.session.access_token);
            }

            return {
              data: {
                session: authData.session,
                user: userProfile,
              },
              error: null
            };
          }

          return { data: null, error: { message: 'No user data returned', code: 'NO_USER' } };
        } catch (error: any) {
          console.error('[db] Supabase Auth fallback signup error:', error);
          return {
            data: null,
            error: { message: error.message || 'Signup failed', code: error.code || 'SIGNUP_ERROR' }
          };
        }
      }

      // Use backend API
      const requestBody: any = {
        email: credentials.email,
        username: credentials.username,
        password: credentials.password,
      };

      // Add optional fields if provided
      if (full_name) {
        requestBody.full_name = full_name;
      }
      if (role) {
        requestBody.role = role;
      }
      if (tenant_id) {
        requestBody.tenant_id = tenant_id;
      }
      if (phone) {
        requestBody.phone = phone;
      }

      const result = await this.request('/auth/signup', {
        method: 'POST',
        body: JSON.stringify(requestBody),
      });
      if (result.data?.session) {
        localStorage.setItem('auth_session', JSON.stringify(result.data.session));
        localStorage.setItem('auth_token', result.data.session.access_token);
      }
      return result;
    },
    signOut: async () => {
      localStorage.removeItem('auth_session');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user_data');
      localStorage.removeItem('supabase.auth.token');

      // Try backend signout
      const useBackend = await isBackendAvailable();
      if (useBackend) {
        await this.request('/auth/signout', { method: 'POST' });
      }

      // Also call Supabase signout if available
      if (supabaseClient) {
        await supabaseClient.auth.signOut();
      }

      return { error: null };
    },
    onAuthStateChange: (callback: (event: string, session: any) => void) => {
      // Only check auth state on initial mount, not periodically
      // Periodic checks can cause false logout triggers
      const checkAuth = async () => {
        try {
          const { data } = await db.auth.getSession();
          // Only trigger TOKEN_REFRESHED if session actually exists
          // Don't trigger if session is null to avoid clearing state
          if (data?.session) {
            callback('TOKEN_REFRESHED', data.session);
          }
        } catch (error) {
          // Silently fail - don't trigger logout on check errors
          console.warn('[onAuthStateChange] Session check failed:', error);
        }
      };
      
      // Initial check only - no periodic polling
      checkAuth();
      
      return {
        data: {
          subscription: {
            unsubscribe: () => {
              // Nothing to clean up since we're not using intervals
            },
          },
        },
      };
    },
    updateUser: async (updates: { password?: string }) => {
      const result = await this.request('/auth/update', {
        method: 'POST',
        body: JSON.stringify(updates),
      });
      return result;
    },
    getUser: async (token?: string) => {
      const result = await this.request('/auth/user', {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      return result;
    },
    refreshSession: async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        return { data: null, error: { message: 'No token to refresh' } };
      }
      
      const result = await this.request('/auth/refresh', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      if (result.data?.access_token) {
        // Update stored token
        const sessionStr = localStorage.getItem('auth_session');
        if (sessionStr) {
          try {
            const session = JSON.parse(sessionStr);
            session.access_token = result.data.access_token;
            localStorage.setItem('auth_session', JSON.stringify(session));
          } catch (e) {
            // If parsing fails, create new session
            localStorage.setItem('auth_session', JSON.stringify({
              access_token: result.data.access_token,
              user: { id: 'unknown' },
            }));
          }
        }
        localStorage.setItem('auth_token', result.data.access_token);
      }
      
      return result;
    },
    validateSession: async () => {
      const token = localStorage.getItem('auth_token');
      if (!token) {
        return { data: { valid: false }, error: null };
      }
      
      const result = await this.request('/auth/validate', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      
      return result;
    },
  };
}

export const db = new DatabaseClient();
