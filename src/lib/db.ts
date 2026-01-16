// PostgreSQL Database Client
// Replaces Supabase client with direct PostgreSQL connection via API

// In Bolt/WebContainer, use relative URLs to go through Vite proxy
// Otherwise use the configured API URL or default to localhost
const getApiUrl = () => {
  // Check if we're in a WebContainer/Bolt environment
  const isWebContainer = typeof window !== 'undefined' && 
    (window.location.hostname.includes('webcontainer') || 
     window.location.hostname.includes('bolt') ||
     window.location.hostname === 'localhost' && window.location.port === '5173');
  
  if (isWebContainer || !import.meta.env.VITE_API_URL) {
    // Use relative URL - Vite proxy will handle it
    return '/api';
  }
  
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
};

const API_URL = getApiUrl();

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
      const timeout = url.startsWith('/') ? 30000 : 10000; // 30s for relative URLs, 10s for absolute
      
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
        userFriendlyMessage = 'Request timed out. The server may be slow or still starting. Please wait a moment and try again.';
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
            const result = await self.request(`/insert/${table}`, {
              method: 'POST',
              body: JSON.stringify({ data, returning: columns }),
            });
            if (result.error) return { data: null, error: result.error };
            return { data: Array.isArray(data) ? result.data[0] : result.data, error: null };
          },
          then: async (resolve?: any, reject?: any) => {
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
      
      // Build request body
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
      await this.request('/auth/signout', { method: 'POST' });
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
