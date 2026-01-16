import { readFileSync } from 'fs';
import { join } from 'path';
import dotenv from 'dotenv';
import { supabase } from '../db';

dotenv.config();

/**
 * Zoho OAuth Credentials Interface
 * Contains client credentials for Zoho OAuth 2.0 flows
 */
interface ZohoCredentials {
  client_id: string;
  client_secret: string;
  scope?: string[];
  redirect_uri?: string;
  region?: string;
}

/**
 * Self Client JSON Structure (from Zoho Developer Console)
 */
interface ZohoSelfClientJson {
  client_id: string;
  client_secret: string;
  code?: string; // Authorization code (if present)
  grant_type?: string;
  scope?: string[];
  expiry_time?: number;
}

/**
 * Secure Zoho Credentials Loader
 * 
 * Loads credentials from (in priority order):
 * 1. Tenant-specific database config (highest priority - for SaaS)
 * 2. Environment variables (for production/global fallback)
 * 3. self_client.json file (development/fallback)
 * 
 * Security:
 * - Credentials stored in memory only
 * - Never exposed to frontend
 * - JSON file excluded from version control
 * - Tenant credentials encrypted in database
 */
class ZohoCredentialsManager {
  private credentials: ZohoCredentials | null = null;
  private tenantCredentialsCache: Map<string, ZohoCredentials> = new Map();
  private readonly credentialsPath: string;

  constructor() {
    // Path to self_client.json (relative to server directory)
    this.credentialsPath = join(process.cwd(), 'self_client.json');
  }

  /**
   * Get credentials for a specific tenant
   * Priority: Tenant DB config > Global env/file
   */
  async getCredentialsForTenant(tenantId: string): Promise<ZohoCredentials> {
    // Check cache first
    if (this.tenantCredentialsCache.has(tenantId)) {
      return this.tenantCredentialsCache.get(tenantId)!;
    }

    try {
      // Try to load from tenant-specific database config
      const { data, error } = await supabase
        .from('tenant_zoho_configs')
        .select('client_id, client_secret, redirect_uri, scopes, region')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single();

      if (data && !error) {
        const credentials: ZohoCredentials = {
          client_id: data.client_id,
          client_secret: data.client_secret,
          redirect_uri: data.redirect_uri || this.getDefaultRedirectUri(),
          scope: data.scopes || this.getDefaultScope(),
        };

        // Cache for this session
        this.tenantCredentialsCache.set(tenantId, credentials);
        console.log(`[ZohoCredentials] ✅ Loaded tenant-specific credentials for tenant ${tenantId}`);
        return credentials;
      }
    } catch (error: any) {
      // If table doesn't exist or query fails, fall back to global
      console.warn(`[ZohoCredentials] ⚠️  Could not load tenant config for ${tenantId}, using global: ${error.message}`);
    }

      // Fall back to global credentials (if available)
      const globalCreds = this.loadCredentials(false);
      if (globalCreds) {
        this.tenantCredentialsCache.set(tenantId, globalCreds);
        console.log(`[ZohoCredentials] ⚠️  Using global fallback credentials for tenant ${tenantId}`);
        return globalCreds;
      }
      
      // No credentials available at all
      throw new Error(
        `Zoho credentials not configured for tenant ${tenantId}. ` +
        `Please configure Zoho credentials in tenant settings or set global credentials.`
      );
  }

  /**
   * Get client ID for a specific tenant
   */
  async getClientIdForTenant(tenantId: string): Promise<string> {
    const creds = await this.getCredentialsForTenant(tenantId);
    return creds.client_id;
  }

  /**
   * Get client secret for a specific tenant
   */
  async getClientSecretForTenant(tenantId: string): Promise<string> {
    const creds = await this.getCredentialsForTenant(tenantId);
    return creds.client_secret;
  }

  /**
   * Get redirect URI for a specific tenant
   */
  async getRedirectUriForTenant(tenantId: string): Promise<string> {
    const creds = await this.getCredentialsForTenant(tenantId);
    return creds.redirect_uri || this.getDefaultRedirectUri();
  }

  /**
   * Get scope for a specific tenant
   */
  async getScopeForTenant(tenantId: string): Promise<string[]> {
    const creds = await this.getCredentialsForTenant(tenantId);
    return creds.scope || this.getDefaultScope();
  }

  /**
   * Get region for a specific tenant
   */
  async getRegionForTenant(tenantId: string): Promise<string> {
    try {
      const { data, error } = await supabase
        .from('tenant_zoho_configs')
        .select('region')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single();

      if (data && !error && data.region) {
        return data.region;
      }
    } catch (error) {
      console.warn(`[ZohoCredentials] Could not load region for tenant ${tenantId}, using default`);
    }
    // Fall back to global credentials or default
    const globalCreds = this.loadCredentials(false);
    return globalCreds?.region || process.env.ZOHO_REGION || 'com';
  }

  /**
   * Clear tenant credentials cache (useful when config is updated)
   */
  clearTenantCache(tenantId?: string): void {
    if (tenantId) {
      this.tenantCredentialsCache.delete(tenantId);
      console.log(`[ZohoCredentials] 🔄 Cleared credentials cache for tenant ${tenantId}`);
    } else {
      this.tenantCredentialsCache.clear();
      console.log('[ZohoCredentials] 🔄 Cleared all tenant credentials cache');
    }
  }

  /**
   * Get default redirect URI
   */
  private getDefaultRedirectUri(): string {
    return process.env.ZOHO_REDIRECT_URI || 'http://localhost:3001/api/zoho/callback';
  }

  /**
   * Get default scope
   */
  private getDefaultScope(): string[] {
    return process.env.ZOHO_SCOPE?.split(',').map(s => s.trim()) || [
      'ZohoInvoice.invoices.CREATE',
      'ZohoInvoice.invoices.READ',
      'ZohoInvoice.contacts.CREATE',
      'ZohoInvoice.contacts.READ'
    ];
  }

  /**
   * Load Zoho credentials securely
   * Priority: Environment variables > JSON file
   * 
   * Note: This is for global/fallback credentials. Tenant-specific credentials
   * should be loaded via getCredentialsForTenant() which reads from database.
   * 
   * @returns ZohoCredentials object with client_id and client_secret
   * @throws Error if credentials cannot be loaded (only if required)
   */
  loadCredentials(required: boolean = false): ZohoCredentials | null {
    // If already loaded, return cached credentials
    if (this.credentials) {
      return this.credentials;
    }

    // Priority 1: Environment variables (production-safe)
    const envClientId = process.env.ZOHO_CLIENT_ID;
    const envClientSecret = process.env.ZOHO_CLIENT_SECRET;

    if (envClientId && envClientSecret) {
      console.log('[ZohoCredentials] ✅ Loaded credentials from environment variables');
      this.credentials = {
        client_id: envClientId,
        client_secret: envClientSecret,
        scope: process.env.ZOHO_SCOPE?.split(',').map(s => s.trim()),
        redirect_uri: process.env.ZOHO_REDIRECT_URI,
        region: process.env.ZOHO_REGION || 'com',
      };
      return this.credentials;
    }

    // Priority 2: Load from self_client.json (development/fallback)
    try {
      console.log('[ZohoCredentials] 📄 Loading credentials from self_client.json...');
      const fileContent = readFileSync(this.credentialsPath, 'utf8');
      const jsonData: ZohoSelfClientJson = JSON.parse(fileContent);

      // Validate required fields
      if (!jsonData.client_id || !jsonData.client_secret) {
        if (required) {
          throw new Error('self_client.json is missing client_id or client_secret');
        }
        return null;
      }

      // Extract credentials
      this.credentials = {
        client_id: jsonData.client_id,
        client_secret: jsonData.client_secret,
        scope: jsonData.scope || ['ZohoInvoice.invoices.CREATE', 'ZohoInvoice.invoices.READ', 'ZohoInvoice.invoices.UPDATE'],
        redirect_uri: process.env.ZOHO_REDIRECT_URI || 'http://localhost:3001/api/zoho/callback',
        region: process.env.ZOHO_REGION || 'com',
      };

      console.log('[ZohoCredentials] ✅ Loaded credentials from self_client.json');
      console.log(`[ZohoCredentials]   Client ID: ${jsonData.client_id.substring(0, 10)}...`);
      console.log(`[ZohoCredentials]   Scopes: ${this.credentials.scope?.join(', ')}`);

      // Warn if using file in production
      if (process.env.NODE_ENV === 'production') {
        console.warn('[ZohoCredentials] ⚠️  WARNING: Using credentials from file in production. Consider using environment variables instead.');
      }

      return this.credentials;
    } catch (error: any) {
      // Handle file not found
      if (error.code === 'ENOENT') {
        if (required) {
          throw new Error(
            `Zoho credentials not found. Credentials will be loaded from database per tenant. ` +
            `For global fallback, either:\n` +
            `1. Set ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET environment variables, or\n` +
            `2. Place self_client.json in ${this.credentialsPath}`
          );
        }
        // Not required, return null (credentials will be loaded from DB per tenant)
        return null;
      }

      // Handle JSON parse errors
      if (error instanceof SyntaxError) {
        if (required) {
          throw new Error(`Invalid JSON in self_client.json: ${error.message}`);
        }
        return null;
      }

      if (required) {
        throw new Error(`Failed to load Zoho credentials: ${error.message}`);
      }
      return null;
    }
  }

  /**
   * Get client ID (global/fallback)
   * @returns Client ID string
   * @throws Error if credentials not available
   */
  getClientId(): string {
    const creds = this.loadCredentials(true);
    if (!creds) {
      throw new Error('Zoho credentials not available. Configure per tenant in database or set global credentials.');
    }
    return creds.client_id;
  }

  /**
   * Get client secret (global/fallback)
   * @returns Client secret string
   * @throws Error if credentials not available
   */
  getClientSecret(): string {
    const creds = this.loadCredentials(true);
    if (!creds) {
      throw new Error('Zoho credentials not available. Configure per tenant in database or set global credentials.');
    }
    return creds.client_secret;
  }

  /**
   * Get scope (global/fallback)
   * @returns Scope array or default scope
   */
  getScope(): string[] {
    const creds = this.loadCredentials(false);
    return creds?.scope || ['ZohoInvoice.invoices.CREATE', 'ZohoInvoice.invoices.READ', 'ZohoInvoice.invoices.UPDATE'];
  }

  /**
   * Get redirect URI (global/fallback)
   * @returns Redirect URI string
   */
  getRedirectUri(): string {
    const creds = this.loadCredentials(false);
    return creds?.redirect_uri || 'http://localhost:3001/api/zoho/callback';
  }

  /**
   * Clear cached credentials (useful for testing or credential rotation)
   */
  clearCache(): void {
    this.credentials = null;
    console.log('[ZohoCredentials] 🔄 Credentials cache cleared');
  }

  /**
   * Check if credentials are loaded
   * @returns true if credentials are available
   */
  isLoaded(): boolean {
    return this.credentials !== null;
  }
}

// Export singleton instance
export const zohoCredentials = new ZohoCredentialsManager();

// Export types for use in other modules
export type { ZohoCredentials, ZohoSelfClientJson };

