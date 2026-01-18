/**
 * Centralized API URL detection utility
 * Handles different environments: Bolt, local development, and production
 */

/**
 * Get the API base URL based on the current environment
 * - Priority: VITE_API_URL environment variable (if set)
 * - Bolt/WebContainer: Uses Railway backend from VITE_API_URL or fallback
 * - Local development: Uses Railway backend (default) or VITE_API_URL
 * - Production: Uses VITE_API_URL
 */
export function getApiUrl(): string {
  // Always check VITE_API_URL first - if set, use it (highest priority)
  if (import.meta.env.VITE_API_URL) {
    const apiUrl = import.meta.env.VITE_API_URL;
    console.log('[getApiUrl] Using VITE_API_URL:', apiUrl);
    return apiUrl.endsWith('/api') ? apiUrl : `${apiUrl}/api`;
  }

  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    const origin = window.location.origin;
    
    // Comprehensive detection for Bolt/WebContainer environments
    const isWebContainer = 
      hostname.includes('webcontainer') || 
      hostname.includes('bolt') ||
      hostname.includes('local-credentialless') ||
      hostname.includes('webcontainer-api.io') ||
      origin.includes('bolt.host') ||
      (hostname === 'localhost' && window.location.port === '5173');
    
    if (isWebContainer) {
      // In Bolt, use Railway backend URL
      const railwayUrl = 'https://booktifisupabase-production.up.railway.app/api';
      console.log('[getApiUrl] Bolt/WebContainer detected, using Railway backend:', railwayUrl);
      return railwayUrl;
    }
  }
  
  // Local development: Default to Railway backend (not localhost)
  // This ensures we test against the deployed backend
  const railwayUrl = 'https://booktifisupabase-production.up.railway.app/api';
  console.log('[getApiUrl] Local development, using Railway backend:', railwayUrl);
  return railwayUrl;
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
