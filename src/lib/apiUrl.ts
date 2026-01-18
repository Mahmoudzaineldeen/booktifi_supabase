/**
 * Centralized API URL detection utility
 * Handles different environments: Bolt, local development, and production
 */

/**
 * Get the API base URL based on the current environment
 * - Bolt/WebContainer: Uses Railway backend from VITE_API_URL or fallback
 * - Local development: Uses localhost:3001 or VITE_API_URL
 * - Production: Uses VITE_API_URL
 */
export function getApiUrl(): string {
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
      // In Bolt, use Railway backend URL from environment variable or fallback
      const railwayUrl = import.meta.env.VITE_API_URL || 'https://booktifisupabase-production.up.railway.app/api';
      console.log('[getApiUrl] Bolt/WebContainer detected, using Railway backend:', railwayUrl);
      return railwayUrl;
    }
  }
  
  // Local development or production: use VITE_API_URL or fallback to localhost
  return import.meta.env.VITE_API_URL || 'http://localhost:3001/api';
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
