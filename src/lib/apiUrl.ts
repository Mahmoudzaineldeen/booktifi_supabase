/**
 * Centralized API URL detection utility
 * Handles different environments: Bolt, local development, and production
 */

/**
 * Get the API base URL based on the current environment
 * - Priority: VITE_API_URL environment variable (if set)
 * - Netlify/Production: Uses VITE_API_URL (must be set)
 * - Bolt/WebContainer: Uses Railway backend from VITE_API_URL or fallback
 * - Local development: Uses Railway backend (default) or VITE_API_URL
 */
export function getApiUrl(): string {
  // VITE_API_URL is REQUIRED - no fallbacks to hardcoded URLs
  const apiUrl = import.meta.env.VITE_API_URL;
  
  if (!apiUrl) {
    const error = '[getApiUrl] ❌ CRITICAL: VITE_API_URL environment variable is not set!';
    console.error(error);
    console.error('[getApiUrl] Please set VITE_API_URL in your environment variables.');
    console.error('[getApiUrl] For local development: VITE_API_URL=http://localhost:3001/api');
    console.error('[getApiUrl] For production: VITE_API_URL=https://your-backend-url.com/api');
    throw new Error('VITE_API_URL environment variable is required. Please configure it in your environment.');
  }
  
  console.log('[getApiUrl] Using VITE_API_URL:', apiUrl);
  return apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;
}

/**
 * Get the API base URL without /api suffix (for health checks, etc.)
 */
export function getApiBaseUrl(): string {
  const apiUrl = getApiUrl();
  return apiUrl.replace('/api', '');
}

/**
 * Check if we're running in Bolt/WebContainer environment
 */
export function isBoltEnvironment(): boolean {
  if (typeof window === 'undefined') return false;
  
  const hostname = window.location.hostname;
  const origin = window.location.origin;
  
  return (
    hostname.includes('webcontainer') || 
    hostname.includes('bolt') ||
    hostname.includes('local-credentialless') ||
    hostname.includes('webcontainer-api.io') ||
    origin.includes('bolt.host') ||
    (hostname === 'localhost' && window.location.port === '5173')
  );
}
