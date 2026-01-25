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
  // Try VITE_API_URL first
  let apiUrl = import.meta.env.VITE_API_URL;
  
  // Fallback to Railway backend if VITE_API_URL is not set
  if (!apiUrl) {
    const railwayUrl = 'https://booktifisupabase-production.up.railway.app/api';
    console.warn('[getApiUrl] ⚠️  VITE_API_URL not set, using Railway backend fallback:', railwayUrl);
    console.warn('[getApiUrl] To avoid this warning, set VITE_API_URL in your environment variables.');
    apiUrl = railwayUrl;
  }
  
  console.log('[getApiUrl] Using API URL:', apiUrl);
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
