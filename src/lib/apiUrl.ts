/**
 * Centralized API URL detection utility
 * Handles different environments: Bolt, local development, and production
 */

/**
 * Get the API base URL based on the current environment
 * - Local dev (localhost:5173): returns '/api' so requests are same-origin and Vite proxy forwards to Railway (avoids CORS)
 * - Otherwise: VITE_API_URL or Railway fallback for direct requests
 */
export function getApiUrl(): string {
  // In browser on localhost dev server: use relative /api so Vite proxy is used (no CORS)
  if (typeof window !== 'undefined') {
    const { origin, port } = window.location;
    if (origin.startsWith('http://localhost:') && port === '5173') {
      return '/api'; // same-origin /api/* → Vite proxy → Railway
    }
  }

  let apiUrl = import.meta.env.VITE_API_URL;
  if (!apiUrl) {
    const railwayUrl = 'https://booktifisupabase-production.up.railway.app/api';
    console.warn('[getApiUrl] ⚠️  VITE_API_URL not set, using Railway backend fallback:', railwayUrl);
    apiUrl = railwayUrl;
  }
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
