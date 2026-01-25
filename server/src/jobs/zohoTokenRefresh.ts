/**
 * Zoho Token Refresh Background Job
 * 
 * This job proactively refreshes Zoho access tokens before they expire,
 * ensuring tokens are always valid without manual intervention.
 * 
 * Runs every 10 minutes and refreshes tokens that expire within 15 minutes.
 */

import { supabase } from '../db';

// Import zohoService instance dynamically to avoid circular dependencies
async function getZohoService() {
  const { zohoService } = await import('../services/zohoService.js');
  return zohoService;
}

/**
 * Refresh tokens for all tenants that have tokens expiring soon
 */
export async function refreshExpiringTokens(): Promise<void> {
  try {
    const now = new Date();
    // Refresh tokens that expire within 15 minutes (900 seconds)
    const refreshThreshold = new Date(now.getTime() + 15 * 60 * 1000);
    
    console.log(`[ZohoTokenRefresh] Checking for tokens expiring before ${refreshThreshold.toISOString()}...`);

    // Get all tokens that expire soon
    const { data: tokens, error } = await supabase
      .from('zoho_tokens')
      .select('tenant_id, expires_at, refresh_token')
      .not('refresh_token', 'is', null)
      .lte('expires_at', refreshThreshold.toISOString())
      .order('expires_at', { ascending: true });

    if (error) {
      console.error(`[ZohoTokenRefresh] Error fetching tokens: ${error.message}`);
      return;
    }

    if (!tokens || tokens.length === 0) {
      console.log(`[ZohoTokenRefresh] No tokens need refreshing`);
      return;
    }

    console.log(`[ZohoTokenRefresh] Found ${tokens.length} token(s) that need refreshing`);

    // Refresh each token
    const refreshPromises = tokens.map(async (token) => {
      try {
        const expiresAt = new Date(token.expires_at);
        const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60);
        
        console.log(`[ZohoTokenRefresh] Refreshing token for tenant ${token.tenant_id} (expires in ${minutesUntilExpiry} minutes)...`);

        // Use the zohoService to refresh the token
        // This will handle all the logic including updating the database
        const zohoService = await getZohoService();
        await zohoService.getAccessToken(token.tenant_id);
        
        console.log(`[ZohoTokenRefresh] ✅ Successfully refreshed token for tenant ${token.tenant_id}`);
        return { tenantId: token.tenant_id, success: true };
      } catch (refreshError: any) {
        console.error(`[ZohoTokenRefresh] ❌ Failed to refresh token for tenant ${token.tenant_id}: ${refreshError.message}`);
        
        // Check if refresh token is invalid - this means user needs to reconnect
        if (refreshError.message?.includes('invalid') || 
            refreshError.message?.includes('INVALID_REFRESH_TOKEN') ||
            refreshError.message?.includes('invalid_grant')) {
          console.error(`[ZohoTokenRefresh] ⚠️  Refresh token is invalid for tenant ${token.tenant_id}`);
          console.error(`[ZohoTokenRefresh]    User needs to reconnect Zoho in Settings → Zoho Integration`);
        }
        
        return { tenantId: token.tenant_id, success: false, error: refreshError.message };
      }
    });

    const results = await Promise.allSettled(refreshPromises);
    
    const successful = results.filter(r => r.status === 'fulfilled' && r.value.success).length;
    const failed = results.length - successful;
    
    console.log(`[ZohoTokenRefresh] ✅ Completed: ${successful} refreshed, ${failed} failed`);
  } catch (error: any) {
    console.error(`[ZohoTokenRefresh] ❌ Error in refresh job: ${error.message}`);
    console.error(`[ZohoTokenRefresh]    Stack: ${error.stack}`);
  }
}

/**
 * Start the token refresh worker
 * Runs every 10 minutes to proactively refresh tokens
 */
export function startZohoTokenRefresh(intervalMs: number = 10 * 60 * 1000): NodeJS.Timeout {
  console.log(`[ZohoTokenRefresh] Starting token refresh worker (interval: ${intervalMs / 1000 / 60} minutes)`);
  
  // Run immediately on start
  refreshExpiringTokens().catch(error => {
    console.error(`[ZohoTokenRefresh] Error in initial refresh: ${error.message}`);
  });
  
  // Then run periodically
  return setInterval(() => {
    refreshExpiringTokens().catch(error => {
      console.error(`[ZohoTokenRefresh] Error in periodic refresh: ${error.message}`);
    });
  }, intervalMs);
}

/**
 * Stop the token refresh worker
 */
export function stopZohoTokenRefresh(intervalId: NodeJS.Timeout): void {
  clearInterval(intervalId);
  console.log(`[ZohoTokenRefresh] Token refresh worker stopped`);
}
