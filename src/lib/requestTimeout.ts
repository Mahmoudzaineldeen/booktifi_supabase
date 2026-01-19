/**
 * Centralized timeout configuration for API requests
 * Handles Railway cold starts and different endpoint types
 */

/**
 * Get appropriate timeout for an API endpoint
 * 
 * @param endpoint - The API endpoint path
 * @param isRelativeUrl - Whether the URL is relative (starts with /)
 * @returns Timeout in milliseconds
 */
export function getRequestTimeout(endpoint: string, isRelativeUrl: boolean = false): number {
  // Authentication endpoints need longer timeout (Railway cold starts can take 30-60s)
  const isAuthEndpoint = 
    endpoint.includes('/auth/') || 
    endpoint.includes('/signin') || 
    endpoint.includes('/signup') ||
    endpoint.includes('/sign-in') ||
    endpoint.includes('/sign-up') ||
    endpoint.includes('/forgot-password') ||
    endpoint.includes('/reset-password') ||
    endpoint.includes('/refresh') ||
    endpoint.includes('/validate');

  // Tenant queries may also be slower
  const isTenantQuery = 
    endpoint.includes('/tenants/') || 
    (endpoint.includes('/query') && endpoint.includes('table=tenants'));

  // Base timeout: longer for relative URLs (local dev), shorter for absolute (production)
  const baseTimeout = isRelativeUrl ? 30000 : 10000; // 30s for relative, 10s for absolute

  // Apply endpoint-specific timeouts
  if (isAuthEndpoint) {
    // 60 seconds for auth endpoints (handles Railway cold starts)
    return 60000;
  } else if (isTenantQuery) {
    // 60 seconds for tenant queries (can be slow)
    return baseTimeout * 2;
  }

  // Default timeout
  return baseTimeout;
}

/**
 * Create an AbortSignal with appropriate timeout for an endpoint
 * 
 * @param endpoint - The API endpoint path
 * @param isRelativeUrl - Whether the URL is relative (starts with /)
 * @returns AbortSignal with timeout
 */
export function createTimeoutSignal(endpoint: string, isRelativeUrl: boolean = false): AbortSignal {
  const timeout = getRequestTimeout(endpoint, isRelativeUrl);
  return AbortSignal.timeout(timeout);
}

/**
 * Check if an endpoint is an authentication endpoint
 */
export function isAuthEndpoint(endpoint: string): boolean {
  return endpoint.includes('/auth/') || 
         endpoint.includes('/signin') || 
         endpoint.includes('/signup') ||
         endpoint.includes('/sign-in') ||
         endpoint.includes('/sign-up') ||
         endpoint.includes('/forgot-password') ||
         endpoint.includes('/reset-password') ||
         endpoint.includes('/refresh') ||
         endpoint.includes('/validate');
}
