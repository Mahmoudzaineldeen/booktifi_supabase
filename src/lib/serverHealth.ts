/**
 * Server Health Check Utility
 * Checks if the backend server is running and accessible
 */

// In Bolt/WebContainer, use relative URLs
const getApiBaseUrl = () => {
  const isWebContainer = typeof window !== 'undefined' && 
    (window.location.hostname.includes('webcontainer') || 
     window.location.hostname.includes('bolt') ||
     window.location.hostname === 'localhost' && window.location.port === '5173');
  
  if (isWebContainer || !import.meta.env.VITE_API_URL) {
    return ''; // Relative URL - Vite proxy will handle it
  }
  
  return import.meta.env.VITE_API_URL?.replace('/api', '') || 'http://localhost:3001';
};

const API_BASE_URL = getApiBaseUrl();
const HEALTH_CHECK_INTERVAL = 30000; // Check every 30 seconds
const HEALTH_CHECK_TIMEOUT = 3000; // 3 second timeout

let healthCheckInterval: number | null = null;
let isServerHealthy = false;
let healthCheckListeners: Array<(healthy: boolean) => void> = [];

/**
 * Check if the server is healthy
 */
export async function checkServerHealth(): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), HEALTH_CHECK_TIMEOUT);
    
    const response = await fetch(`${API_BASE_URL}/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-cache',
    });
    
    clearTimeout(timeoutId);
    
    if (response.ok) {
      const data = await response.json();
      const healthy = data.status === 'ok';
      
      if (healthy !== isServerHealthy) {
        isServerHealthy = healthy;
        notifyListeners(healthy);
      }
      
      return healthy;
    }
    
    return false;
  } catch (error) {
    if (isServerHealthy) {
      isServerHealthy = false;
      notifyListeners(false);
    }
    return false;
  }
}

/**
 * Start periodic health checks
 */
export function startHealthCheck(): void {
  if (healthCheckInterval !== null) {
    return; // Already running
  }
  
  // Initial check
  checkServerHealth();
  
  // Set up periodic checks
  healthCheckInterval = window.setInterval(() => {
    checkServerHealth();
  }, HEALTH_CHECK_INTERVAL);
}

/**
 * Stop periodic health checks
 */
export function stopHealthCheck(): void {
  if (healthCheckInterval !== null) {
    clearInterval(healthCheckInterval);
    healthCheckInterval = null;
  }
}

/**
 * Subscribe to health status changes
 */
export function onHealthChange(callback: (healthy: boolean) => void): () => void {
  healthCheckListeners.push(callback);
  
  // Immediately notify with current status
  callback(isServerHealthy);
  
  // Return unsubscribe function
  return () => {
    healthCheckListeners = healthCheckListeners.filter(cb => cb !== callback);
  };
}

/**
 * Get current health status (synchronous)
 */
export function getServerHealth(): boolean {
  return isServerHealthy;
}

function notifyListeners(healthy: boolean): void {
  healthCheckListeners.forEach(callback => {
    try {
      callback(healthy);
    } catch (error) {
      console.error('[serverHealth] Error in health check listener:', error);
    }
  });
}
