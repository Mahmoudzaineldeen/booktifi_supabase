/**
 * Zoho Books / Zoho Invoice integration.
 *
 * Required Zoho OAuth scopes (ensure these are requested and granted):
 * - Create invoices   (ZohoInvoice.invoices.CREATE / ZohoBooks.invoices.CREATE)
 * - Fetch invoice details (ZohoInvoice.invoices.READ / ZohoBooks.invoices.READ)
 * - Update invoice details (ZohoInvoice.invoices.UPDATE / ZohoBooks.invoices.UPDATE)
 * - Create customers  (ZohoInvoice.contacts.CREATE / ZohoBooks.contacts.CREATE)
 * - Fetch customer details (ZohoInvoice.contacts.READ / ZohoBooks.contacts.READ)
 * - Customer payments (for recording payment so invoice becomes Paid)
 *
 * Critical business rule: Before sending an invoice via WhatsApp or Email, the system
 * MUST fetch the current payment status from Zoho and send ONLY if the invoice status
 * is "Paid". If not paid, do not send and surface: "Invoice cannot be sent because
 * payment has not been completed."
 */
import axios, { AxiosInstance, AxiosError } from 'axios';
import { supabase } from '../db';
import dotenv from 'dotenv';
import { zohoCredentials } from '../config/zohoCredentials';

dotenv.config();

interface ZohoToken {
  id: string;
  tenant_id: string;
  access_token: string;
  refresh_token: string;
  expires_at: Date;
}

interface ZohoInvoiceData {
  customer_name: string;
  customer_email?: string; // Optional - invoices can be created without email
  customer_phone?: string; // Optional - for WhatsApp delivery
  line_items: Array<{
    name: string;
    description?: string;
    rate: number;
    quantity: number;
    unit?: string;
  }>;
  date: string;
  due_date?: string;
  currency_code: string;
  notes?: string;
  /** Bank transfer reference - shown as Zoho invoice reference_number on PDF */
  reference_number?: string;
  custom_fields?: Record<string, any>;
}

interface ZohoInvoiceResponse {
  invoice: {
    invoice_id: string;
    invoice_number: string;
    status: string;
  };
  code: number;
  message: string;
}

class ZohoService {
  private apiBaseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private scope: string;

  constructor() {
    this.apiBaseUrl = process.env.ZOHO_API_BASE_URL || 'https://invoice.zoho.com/api/v3';
    
    // Credentials are loaded per-tenant from database when needed
    // These are fallback values (will be overridden by tenant-specific credentials)
    try {
      const globalCreds = zohoCredentials.loadCredentials(false);
      if (globalCreds) {
        this.clientId = globalCreds.client_id;
        this.clientSecret = globalCreds.client_secret;
        if (!process.env.APP_URL) {
          throw new Error('APP_URL environment variable is required for Zoho OAuth redirect URI');
        }
        this.redirectUri = globalCreds.redirect_uri || process.env.APP_URL + '/api/zoho/callback';
        this.scope = (globalCreds.scope || ['ZohoInvoice.invoices.CREATE', 'ZohoInvoice.invoices.READ']).join(',');
      } else {
        // No global credentials - will use tenant-specific from database
        this.clientId = '';
        this.clientSecret = '';
        if (!process.env.APP_URL) {
          throw new Error('APP_URL environment variable is required for Zoho OAuth redirect URI');
        }
        this.redirectUri = process.env.APP_URL + '/api/zoho/callback';
        this.scope = 'ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.invoices.UPDATE';
      }
    } catch (error: any) {
      // No global credentials available - will use tenant-specific from database
      this.clientId = '';
      this.clientSecret = '';
      if (!process.env.APP_URL && !process.env.ZOHO_REDIRECT_URI) {
        throw new Error('Either APP_URL or ZOHO_REDIRECT_URI environment variable is required for Zoho OAuth redirect URI');
      }
      this.redirectUri = process.env.ZOHO_REDIRECT_URI || process.env.APP_URL + '/api/zoho/callback';
      this.scope = process.env.ZOHO_SCOPE || 'ZohoInvoice.invoices.CREATE,ZohoInvoice.invoices.READ,ZohoInvoice.invoices.UPDATE';
    }
    
    console.log('[ZohoService] ✅ Initialized. Credentials will be loaded from database per tenant when needed.');
  }

  /**
   * Get or refresh access token for a tenant
   */
  async getAccessToken(tenantId: string): Promise<string> {
    // Get existing token
    const { data: tokens, error } = await supabase
      .from('zoho_tokens')
      .select('*')
      .eq('tenant_id', tenantId)
      .single();

    if (error || !tokens) {
      throw new Error(`No Zoho token found for tenant ${tenantId}. Please complete OAuth flow first.`);
    }

    const token: ZohoToken = tokens;

    // Check if token is expired or expiring soon (with 5 minute buffer)
    const expiresAt = new Date(token.expires_at);
    const now = new Date();
    const buffer = 5 * 60 * 1000; // 5 minutes
    const timeUntilExpiry = expiresAt.getTime() - now.getTime();
    const minutesUntilExpiry = Math.round(timeUntilExpiry / 1000 / 60);

    console.log(`[ZohoService] getAccessToken() - Token status:`);
    console.log(`[ZohoService]    Expires at: ${expiresAt.toISOString()}`);
    console.log(`[ZohoService]    Current time: ${now.toISOString()}`);
    console.log(`[ZohoService]    Minutes until expiry: ${minutesUntilExpiry}`);

    // CRITICAL: Always attempt refresh if token is expired or expiring soon
    // This ensures expired tokens are automatically refreshed
    if (timeUntilExpiry < buffer) {
      if (timeUntilExpiry <= 0) {
        console.log(`[ZohoService] Token is expired (${minutesUntilExpiry} minutes ago), refreshing for tenant ${tenantId}...`);
      } else {
        console.log(`[ZohoService] Token expires soon (${minutesUntilExpiry} minutes), refreshing for tenant ${tenantId}...`);
      }
      
      // CRITICAL: Check if refresh_token exists before attempting refresh
      if (!token.refresh_token || token.refresh_token.trim().length === 0) {
        const errorMsg = `Cannot refresh token: refresh_token is missing or empty. Please reconnect Zoho in Settings → Zoho Integration`;
        console.error(`[ZohoService] ❌ ${errorMsg}`);
        throw new Error(errorMsg);
      }
      
      try {
        const newAccessToken = await this.refreshAccessToken(tenantId, token.refresh_token);
        console.log(`[ZohoService] ✅ Token refreshed successfully`);
        return newAccessToken;
      } catch (refreshError: any) {
        // Check if error is about invalid refresh token
        const errorMessage = refreshError.message || '';
        if (errorMessage.includes('INVALID_REFRESH_TOKEN') || 
            errorMessage.includes('invalid_grant') ||
            errorMessage.includes('invalid refresh token')) {
          const errorMsg = `Refresh token is invalid or expired. Please reconnect Zoho in Settings → Zoho Integration → Disconnect and Connect again`;
          console.error(`[ZohoService] ❌ ${errorMsg}`);
          throw new Error(errorMsg);
        }
        
        console.error(`[ZohoService] ❌ Failed to refresh token: ${refreshError.message}`);
        throw new Error(`Failed to refresh Zoho token. Please reconnect Zoho in Settings → Zoho Integration. Error: ${refreshError.message}`);
      }
    }

    console.log(`[ZohoService] ✅ Token is valid, using existing access token`);
    return token.access_token;
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(tenantId: string, refreshToken: string): Promise<string> {
    try {
      // Use tenant-specific credentials (loaded from database)
      const clientId = await zohoCredentials.getClientIdForTenant(tenantId);
      const clientSecret = await zohoCredentials.getClientSecretForTenant(tenantId);
      const region = await zohoCredentials.getRegionForTenant(tenantId);

      // Determine token endpoint based on tenant's region
      let tokenEndpoint = 'https://accounts.zoho.com/oauth/v2/token';
      if (region === 'eu') {
        tokenEndpoint = 'https://accounts.zoho.eu/oauth/v2/token';
      } else if (region === 'in') {
        tokenEndpoint = 'https://accounts.zoho.in/oauth/v2/token';
      } else if (region === 'au') {
        tokenEndpoint = 'https://accounts.zoho.com.au/oauth/v2/token';
      } else if (region === 'jp') {
        tokenEndpoint = 'https://accounts.zoho.jp/oauth/v2/token';
      } else if (region === 'cn') {
        tokenEndpoint = 'https://accounts.zoho.com.cn/oauth/v2/token';
      }
      // Default to .com for US and other regions

      console.log(`[ZohoService] Refreshing token for tenant ${tenantId} using region: ${region}, endpoint: ${tokenEndpoint}`);

      const response = await axios.post(
        tokenEndpoint,
        null,
        {
          params: {
            refresh_token: refreshToken,
            client_id: clientId,
            client_secret: clientSecret,
            grant_type: 'refresh_token',
          },
        }
      );

      const { access_token, expires_in, refresh_token: newRefreshToken } = response.data;
      const expiresAt = new Date(Date.now() + expires_in * 1000);

      // Update token in database
      // Note: Zoho may or may not return a new refresh_token
      // If provided, update it; otherwise keep the existing one
      if (newRefreshToken) {
        // New refresh token provided - update both
        await supabase
          .from('zoho_tokens')
          .update({
            access_token,
            refresh_token: newRefreshToken,
            expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('tenant_id', tenantId);
        console.log(`[ZohoService] Token refreshed successfully (new refresh token received) for tenant ${tenantId}`);
      } else {
        // No new refresh token - only update access token
        await supabase
          .from('zoho_tokens')
          .update({
            access_token,
            expires_at: expiresAt.toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('tenant_id', tenantId);
        console.log(`[ZohoService] Token refreshed successfully (using existing refresh token) for tenant ${tenantId}`);
      }

      return access_token;
    } catch (error: any) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        const errorData = axiosError.response.data as any;
        console.error(`[ZohoService] Token refresh failed for tenant ${tenantId}:`, {
          status: axiosError.response.status,
          code: errorData?.code,
          message: errorData?.message || errorData?.error || error.message,
          data: errorData,
        });
        
        // Check for specific error codes
        if (errorData?.code === 'INVALID_REFRESH_TOKEN' || errorData?.error === 'invalid_grant') {
          throw new Error('Refresh token is invalid or expired. Please re-authenticate Zoho.');
        }
      } else {
        console.error(`[ZohoService] Token refresh failed for tenant ${tenantId}:`, error.message);
      }
      throw new Error(`Failed to refresh Zoho token: ${error.message}`);
    }
  }

  /**
   * Store OAuth tokens after authorization
   */
  async storeTokens(tenantId: string, accessToken: string, refreshToken: string, expiresIn: number, grantedScopes?: string): Promise<void> {
    const expiresAt = new Date(Date.now() + expiresIn * 1000);

    // Only include columns that exist in all schema versions (granted_scopes may be missing if migration not applied)
    const { data, error } = await supabase
      .from('zoho_tokens')
      .upsert({
        tenant_id: tenantId,
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: expiresAt.toISOString(),
        updated_at: new Date().toISOString()
      }, {
        onConflict: 'tenant_id'
      })
      .select('id')
      .single();

    if (error) {
      console.error(`[ZohoService] Failed to store tokens for tenant ${tenantId}:`, error.code, error.message);
      if (error.message?.includes('row-level security') || error.code === '42501') {
        throw new Error(
          'Zoho tokens could not be saved: Row Level Security is blocking the write. ' +
          'Ensure the server uses SUPABASE_SERVICE_ROLE_KEY (not the anon key) so Zoho token storage works.'
        );
      }
      throw new Error(`Failed to store Zoho tokens: ${error.message}`);
    }

    console.log(`[ZohoService] Tokens stored for tenant ${tenantId}`);
    if (grantedScopes) {
      const hasUpdate = grantedScopes.includes('ZohoInvoice.invoices.UPDATE') || grantedScopes.includes('invoices.UPDATE');
      if (hasUpdate) {
        console.log(`[ZohoService] ✅ Token has UPDATE scope - payment status sync will work`);
      } else {
        console.warn(`[ZohoService] ⚠️  Token does NOT have UPDATE scope - payment status sync will fail`);
      }
    }
  }

  /**
   * Ensure base URL is a valid absolute URL (axios rejects relative or empty URLs).
   */
  private normalizeApiBaseUrl(baseUrl: string | undefined): string {
    const url = (baseUrl || this.apiBaseUrl || '').trim();
    if (!url || (!url.startsWith('http://') && !url.startsWith('https://'))) {
      return 'https://invoice.zoho.com/api/v3';
    }
    return url.replace(/\/+$/, ''); // strip trailing slashes
  }

  /**
   * Get API base URL for a tenant based on their region.
   * Always returns a valid absolute URL (no relative or empty).
   */
  private async getApiBaseUrlForTenant(tenantId: string): Promise<string> {
    try {
      const region = await zohoCredentials.getRegionForTenant(tenantId);
      
      // Map region to API base URL
      const regionMap: Record<string, string> = {
        'eu': 'https://invoice.zoho.eu/api/v3',
        'in': 'https://invoice.zoho.in/api/v3',
        'au': 'https://invoice.zoho.com.au/api/v3',
        'jp': 'https://invoice.zoho.jp/api/v3',
        'cn': 'https://invoice.zoho.com.cn/api/v3',
        'com': 'https://invoice.zoho.com/api/v3',
      };
      
      const base = regionMap[region] || regionMap['com'] || 'https://invoice.zoho.com/api/v3';
      return this.normalizeApiBaseUrl(base);
    } catch (error) {
      return this.normalizeApiBaseUrl(this.apiBaseUrl);
    }
  }

  /**
   * Get stored Zoho Organization ID for a tenant (from tenant_zoho_configs).
   * Required for customer payments and recommended for all Zoho Invoice API calls.
   * Returns null if not set — do NOT call GET /organizations here (often 401).
   */
  async getZohoOrganizationId(tenantId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('tenant_zoho_configs')
        .select('zoho_organization_id')
        .eq('tenant_id', tenantId)
        .single();
      if (error || !data) return null;
      const id = (data as any)?.zoho_organization_id;
      return id && String(id).trim() ? String(id).trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Fetch organizations from Zoho and store the first organization_id in tenant_zoho_configs.
   * Call this after OAuth token exchange so payments and invoice APIs work.
   * GET https://invoice.zoho.com/api/v3/organizations with Zoho-oauthtoken.
   */
  async fetchAndStoreZohoOrganizationId(tenantId: string, accessToken: string): Promise<string | null> {
    try {
      const apiBaseUrl = await this.getApiBaseUrlForTenant(tenantId);
      const url = `${apiBaseUrl}/organizations`;
      const res = await axios.get(url, {
        headers: { Authorization: `Zoho-oauthtoken ${accessToken}` },
      });
      const orgs = (res.data as any)?.organizations;
      if (!orgs || orgs.length === 0) {
        console.warn('[ZohoService] No organizations returned from Zoho');
        return null;
      }
      const orgId = orgs[0].organization_id;
      if (!orgId) return null;
      const { error } = await supabase
        .from('tenant_zoho_configs')
        .update({
          zoho_organization_id: String(orgId).trim(),
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId);
      if (error) {
        console.warn('[ZohoService] Could not save organization id:', error.message);
        return orgId;
      }
      console.log('[ZohoService] Stored Zoho Organization ID for tenant', tenantId);
      return String(orgId).trim();
    } catch (e: any) {
      const msg = e?.response?.data?.message || e?.message;
      console.warn('[ZohoService] Could not fetch organization id:', msg);
      return null;
    }
  }

  /**
   * Create or get customer/contact in Zoho
   * Zoho Invoice requires customers to exist before creating invoices
   */
  async getOrCreateCustomer(tenantId: string, customerName: string, customerEmail?: string): Promise<string> {
    const accessToken = await this.getAccessToken(tenantId);
    const apiBaseUrl = await this.getApiBaseUrlForTenant(tenantId);
    
    try {
      // First, try to find existing customer by email (if provided)
      let searchResponse: any = null;
      
      if (customerEmail) {
        console.log(`[ZohoService] Searching for customer by email: ${customerEmail}`);
        searchResponse = await axios.get(
          `${apiBaseUrl}/contacts`,
          {
            params: {
              search_text: customerEmail,
            },
            headers: {
              'Authorization': `Zoho-oauthtoken ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      }

      // If not found by email (or email not provided), try searching by name
      if (!searchResponse || !searchResponse.data?.contacts || searchResponse.data.contacts.length === 0) {
        console.log(`[ZohoService] Not found by email, searching by name: ${customerName}`);
        searchResponse = await axios.get(
          `${apiBaseUrl}/contacts`,
          {
            params: {
              search_text: customerName,
            },
            headers: {
              'Authorization': `Zoho-oauthtoken ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );
      }

      // If customer exists, return their contact_id
      if (searchResponse.data?.contacts && searchResponse.data.contacts.length > 0) {
        const existingCustomer = searchResponse.data.contacts.find(
          (c: any) => 
            (customerEmail && c.email && c.email.toLowerCase() === customerEmail.toLowerCase()) || 
            (c.contact_name && c.contact_name.toLowerCase() === customerName.toLowerCase())
        );
        if (existingCustomer) {
          console.log(`[ZohoService] ✅ Found existing customer: ${existingCustomer.contact_id} (${existingCustomer.contact_name})`);
          return existingCustomer.contact_id;
        }
      }

      // Customer doesn't exist, create new one
      console.log(`[ZohoService] Creating new customer: ${customerName}${customerEmail ? ` (${customerEmail})` : ' (no email)'}`);
      const createPayload: any = {
        contact_name: customerName,
        contact_type: 'customer',
      };
      
      // Only include email if provided
      if (customerEmail) {
        createPayload.email = customerEmail;
      }
      
      console.log('[ZohoService] Customer creation payload:', JSON.stringify(createPayload, null, 2));
      
      const createResponse = await axios.post(
        `${apiBaseUrl}/contacts`,
        createPayload,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      console.log('[ZohoService] Customer creation response:', JSON.stringify(createResponse.data, null, 2));

      if (createResponse.data?.contact?.contact_id) {
        console.log(`[ZohoService] ✅ Created new customer: ${createResponse.data.contact.contact_id}`);
        return createResponse.data.contact.contact_id;
      }

      // Check for error in response
      if (createResponse.data?.code && createResponse.data.code !== 0) {
        // If customer already exists error, try to find them again
        if (createResponse.data.code === 3062 || createResponse.data.message?.includes('already exists')) {
          console.log(`[ZohoService] Customer already exists, searching again...`);
          // Search more broadly - get all contacts and find by name
          const allContactsResponse = await axios.get(
            `${this.apiBaseUrl}/contacts`,
            {
              params: {
                page: 1,
                per_page: 200, // Get more results
              },
              headers: {
                'Authorization': `Zoho-oauthtoken ${accessToken}`,
                'Content-Type': 'application/json',
              },
            }
          );
          
          if (allContactsResponse.data?.contacts) {
            const found = allContactsResponse.data.contacts.find(
              (c: any) => 
                (c.contact_name && c.contact_name.toLowerCase() === customerName.toLowerCase()) ||
                (c.email && c.email.toLowerCase() === customerEmail.toLowerCase())
            );
            if (found) {
              console.log(`[ZohoService] ✅ Found existing customer after 'already exists' error: ${found.contact_id}`);
              return found.contact_id;
            }
          }
        }
        throw new Error(`Zoho API error: ${createResponse.data.message || JSON.stringify(createResponse.data)}`);
      }

      throw new Error('Failed to create customer: No contact_id in response: ' + JSON.stringify(createResponse.data));
    } catch (error: any) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        // Handle "already exists" error by searching again
        const errorData = axiosError.response.data as any;
        if (errorData?.code === 3062 || errorData?.message?.includes('already exists')) {
          console.log(`[ZohoService] Customer already exists error, searching for existing customer...`);
          try {
            // Search by name
            const searchResponse = await axios.get(
              `${this.apiBaseUrl}/contacts`,
              {
                params: {
                  search_text: customerName,
                },
                headers: {
                  'Authorization': `Zoho-oauthtoken ${accessToken}`,
                  'Content-Type': 'application/json',
                },
              }
            );
            
            if (searchResponse.data?.contacts && searchResponse.data.contacts.length > 0) {
              const found = searchResponse.data.contacts.find(
                (c: any) => 
                  (c.contact_name && c.contact_name.toLowerCase() === customerName.toLowerCase()) ||
                  (c.email && c.email.toLowerCase() === customerEmail.toLowerCase())
              );
              if (found) {
                console.log(`[ZohoService] ✅ Found existing customer after error: ${found.contact_id}`);
                return found.contact_id;
              }
            }
          } catch (searchError) {
            // Ignore search error, throw original
          }
        }
        
        console.error('[ZohoService] Customer creation/fetch failed:', {
          status: axiosError.response.status,
          data: axiosError.response.data,
        });
        throw new Error(`Failed to get/create customer: ${JSON.stringify(axiosError.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Create invoice in Zoho
   */
  async createInvoice(tenantId: string, invoiceData: ZohoInvoiceData): Promise<ZohoInvoiceResponse> {
    const accessToken = await this.getAccessToken(tenantId);

    // Get or create customer first - REQUIRED for Zoho Invoice
    // Zoho Invoice does not auto-create customers, so we must create them first
    console.log(`[ZohoService] Getting or creating customer: ${invoiceData.customer_name} (${invoiceData.customer_email})`);
    const customerId = await this.getOrCreateCustomer(tenantId, invoiceData.customer_name, invoiceData.customer_email);
    
    if (!customerId) {
      throw new Error('Failed to get or create customer: No customer_id returned');
    }

    // Build payload according to Zoho Invoice API format
    // Zoho Invoice requires customer_id, not customer_name/customer_email
    const payload: any = {
      customer_id: customerId, // REQUIRED: Zoho Invoice requires customer_id
      line_items: invoiceData.line_items.map(item => {
        // CRITICAL: Validate and sanitize line item data
        const itemName = (item.name || 'Item').trim();
        const itemDescription = (item.description || '').trim();
        const itemRate = typeof item.rate === 'number' ? item.rate : parseFloat(String(item.rate || 0));
        const itemQuantity = typeof item.quantity === 'number' ? item.quantity : parseFloat(String(item.quantity || 1));
        const itemUnit = (item.unit || 'ticket').trim();
        
        // Validate rate and quantity
        if (isNaN(itemRate) || itemRate < 0) {
          console.error(`[ZohoService] ❌ Invalid rate: ${item.rate}, using 0`);
        }
        if (isNaN(itemQuantity) || itemQuantity < 0) {
          console.error(`[ZohoService] ❌ Invalid quantity: ${item.quantity}, using 1`);
        }
        
        return {
          name: itemName,
          description: itemDescription,
          rate: Math.max(0, itemRate),
          quantity: Math.max(1, itemQuantity),
          unit: itemUnit,
        };
      }),
      date: invoiceData.date,
      due_date: invoiceData.due_date || invoiceData.date,
      currency_code: invoiceData.currency_code || 'SAR',
      status: 'sent', // CRITICAL: Set status to 'sent' so invoice can be emailed (not 'draft')
    };
    
    // CRITICAL: Validate currency_code before sending to Zoho
    if (!payload.currency_code || payload.currency_code.trim().length === 0) {
      console.error(`[ZohoService] ❌ CRITICAL: currency_code is empty in payload, using SAR as fallback`);
      payload.currency_code = 'SAR';
    } else {
      payload.currency_code = payload.currency_code.trim().toUpperCase();
    }
    
    // Validate currency code format (must be 3 uppercase letters)
    const currencyCodeRegex = /^[A-Z]{3}$/;
    if (!currencyCodeRegex.test(payload.currency_code)) {
      console.error(`[ZohoService] ❌ CRITICAL: Invalid currency_code format: "${payload.currency_code}", using SAR as fallback`);
      payload.currency_code = 'SAR';
    }
    
    console.log(`[ZohoService] 📋 Invoice payload prepared with currency: ${payload.currency_code}`);
    
    // Bank transfer reference: always set reference_number and ensure it appears in notes (permanent fix for PDF)
    const refNum = invoiceData.reference_number && String(invoiceData.reference_number).trim();
    if (refNum) {
      payload.reference_number = refNum;
      const refLine = `\nPayment: Bank transfer. Reference: ${refNum}`;
      const existingNotes = (invoiceData.notes || '').trim();
      payload.notes = existingNotes.includes(refNum) ? existingNotes : (existingNotes + refLine).trim();
    } else if (invoiceData.notes) {
      payload.notes = invoiceData.notes;
    }
    
    // Log payload for debugging (remove sensitive data in production)
    console.log('[ZohoService] 📋 Final invoice payload:');
    console.log(`   Customer ID: ${payload.customer_id}`);
    console.log(`   Currency: ${payload.currency_code}`);
    console.log(`   Date: ${payload.date}`);
    console.log(`   Due Date: ${payload.due_date}`);
    console.log(`   Status: ${payload.status}`);
    console.log(`   Line Items: ${payload.line_items.length}`);
    payload.line_items.forEach((item: any, index: number) => {
      console.log(`     ${index + 1}. ${item.name} - ${item.rate} x ${item.quantity} = ${item.rate * item.quantity} ${payload.currency_code}`);
    });
    console.log(`   Total: ${payload.line_items.reduce((sum: number, item: any) => sum + (item.rate * item.quantity), 0)} ${payload.currency_code}`);
    console.log('[ZohoService] ⚠️  Creating invoice with status: "sent" (not draft) - this allows email sending');

    const apiBaseUrl = this.normalizeApiBaseUrl(await this.getApiBaseUrlForTenant(tenantId));
    const orgId = await this.getZohoOrganizationId(tenantId);
    const createUrl = orgId ? `${apiBaseUrl}/invoices?organization_id=${encodeURIComponent(orgId)}` : `${apiBaseUrl}/invoices`;

    try {
      const response = await axios.post(
        createUrl,
        payload,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const responseData = response.data;
      
      // Verify invoice status - if still draft, mark as sent
      if (responseData.invoice) {
        const invoiceStatus = responseData.invoice.status || responseData.invoice.invoice_status;
        console.log(`[ZohoService] Invoice created - Status: ${invoiceStatus}`);
        console.log(`[ZohoService] Invoice ID: ${responseData.invoice.invoice_id}`);
        
        // If invoice was created as draft (even though we requested 'sent'), mark it as sent
        if (invoiceStatus && (invoiceStatus.toLowerCase() === 'draft' || invoiceStatus.toLowerCase() === 'd')) {
          console.log(`[ZohoService] ⚠️  Invoice created as draft, marking as sent...`);
          try {
            await this.markInvoiceAsSent(tenantId, responseData.invoice.invoice_id);
            console.log(`[ZohoService] ✅ Invoice marked as sent`);
          } catch (markError: any) {
            console.error(`[ZohoService] ⚠️  Failed to mark invoice as sent: ${markError.message}`);
            // Continue - we'll try to send email anyway
          }
        } else {
          console.log(`[ZohoService] ✅ Invoice created with status: ${invoiceStatus} (ready for email)`);
        }
      }

      return responseData;
    } catch (error: any) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        console.error('[ZohoService] Invoice creation failed:', {
          status: axiosError.response.status,
          data: axiosError.response.data,
        });
        throw new Error(`Zoho API error: ${JSON.stringify(axiosError.response.data)}`);
      }
      throw error;
    }
  }

  /**
   * Mark invoice as sent in Zoho
   * This is required if invoice was created as draft
   * Uses tenant API base URL and organization_id so Zoho applies the update
   */
  async markInvoiceAsSent(tenantId: string, invoiceId: string): Promise<void> {
    const accessToken = await this.getAccessToken(tenantId);
    const apiBaseUrl = this.normalizeApiBaseUrl(await this.getApiBaseUrlForTenant(tenantId));
    const orgId = await this.getZohoOrganizationId(tenantId);
    const base = orgId ? `${apiBaseUrl}/invoices/${invoiceId}?organization_id=${encodeURIComponent(orgId)}` : `${apiBaseUrl}/invoices/${invoiceId}`;
    const markSentUrl = orgId ? `${apiBaseUrl}/invoices/${invoiceId}/mark-as-sent?organization_id=${encodeURIComponent(orgId)}` : `${apiBaseUrl}/invoices/${invoiceId}/mark-as-sent`;

    try {
      console.log(`[ZohoService] Marking invoice ${invoiceId} as sent...`);
      
      // Method 1: Try mark-as-sent endpoint
      try {
        const response = await axios.post(
          markSentUrl,
          {},
          {
            headers: {
              'Authorization': `Zoho-oauthtoken ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const responseData = response.data as any;
        if (responseData.code === 0 || responseData.invoice) {
          console.log(`[ZohoService] ✅ Invoice ${invoiceId} marked as sent via mark-as-sent endpoint`);
          return;
        }
      } catch (markError: any) {
        // If mark-as-sent doesn't work, try status update
        if (markError.response?.status === 404 || markError.response?.status === 405) {
          console.log(`[ZohoService] Mark-as-sent endpoint not available, trying status update...`);
        } else {
          throw markError;
        }
      }

      // Method 2: Update invoice status directly (with organization_id so it applies)
      const updateResponse = await axios.put(
        base,
        { 
          status: 'sent',
          invoice_status: 'sent' // Try both field names
        },
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const updateData = updateResponse.data as any;
      if (updateData.code === 0 || updateData.invoice) {
        console.log(`[ZohoService] ✅ Invoice ${invoiceId} status updated to 'sent'`);
      } else {
        console.warn(`[ZohoService] ⚠️  Status update returned code: ${updateData.code}`);
      }
    } catch (error: any) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        const errorData = axiosError.response.data as any;
        console.error(`[ZohoService] Failed to mark invoice as sent:`, {
          status: axiosError.response.status,
          code: errorData?.code,
          message: errorData?.message || errorData?.error,
        });
        // Don't throw - email might still work even if status is draft
        console.log(`[ZohoService] ⚠️  Continuing with email send attempt (invoice may be in draft status)`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Send invoice via email through Zoho
   * Critical: Fetches latest payment status from Zoho; only sends if invoice is Paid.
   * Ensures invoice is sent via email with retry logic.
   */
  async sendInvoiceEmail(tenantId: string, invoiceId: string, customerEmail: string, retryCount: number = 0): Promise<void> {
    const MAX_RETRIES = 2;
    const paymentStatus = await this.getInvoicePaymentStatus(tenantId, invoiceId);
    if (paymentStatus.error) {
      throw new Error(paymentStatus.error);
    }
    if (!paymentStatus.isPaid) {
      console.warn(`[ZohoService] ❌ Invoice ${invoiceId} not sent via Email: payment status in Zoho is "${paymentStatus.status || 'unknown'}" (not Paid)`);
      throw new Error('Invoice cannot be sent because payment has not been completed.');
    }
    const accessToken = await this.getAccessToken(tenantId);

    // Validate email format before sending
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(customerEmail)) {
      throw new Error(`Invalid email format: ${customerEmail}`);
    }

    try {
      console.log(`[ZohoService] 📧 Sending invoice ${invoiceId} to ${customerEmail} (attempt ${retryCount + 1}/${MAX_RETRIES + 1})...`);
      const apiBaseUrl = this.normalizeApiBaseUrl(await this.getApiBaseUrlForTenant(tenantId));
      const orgId = await this.getZohoOrganizationId(tenantId);
      const emailUrl = orgId
        ? `${apiBaseUrl}/invoices/${invoiceId}/email?organization_id=${encodeURIComponent(orgId)}`
        : `${apiBaseUrl}/invoices/${invoiceId}/email`;
      const response = await axios.post(
        emailUrl,
        {
          send_from_org_email_id: true,
          to_mail_ids: [customerEmail.trim()], // Ensure email is trimmed
        },
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000, // 30 second timeout
        }
      );

      // Check response for success
      const responseData = response.data as any;
      if (responseData.code === 0) {
        console.log(`[ZohoService] ✅ Invoice ${invoiceId} sent to ${customerEmail}`);
        console.log(`[ZohoService]    Zoho response: ${responseData.message || 'Email sent successfully'}`);
        if (responseData.is_first_email !== undefined) {
          console.log(`[ZohoService]    Is first email: ${responseData.is_first_email}`);
        }
        return; // Success - exit function
      } else {
        console.warn(`[ZohoService] ⚠️  Email API returned non-zero code: ${responseData.code}`);
        console.warn(`[ZohoService]    Message: ${responseData.message || 'Unknown'}`);
        
        // If non-zero code but not a critical error, retry
        if (retryCount < MAX_RETRIES && responseData.code !== 1025) {
          console.log(`[ZohoService] 🔄 Retrying email send (${retryCount + 1}/${MAX_RETRIES})...`);
          await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
          return this.sendInvoiceEmail(tenantId, invoiceId, customerEmail, retryCount + 1);
        }
        
        // Don't throw error for non-zero codes - Zoho might still send the email
        // But log it as a warning
        if (responseData.code === 1025) {
          throw new Error(`Failed to send invoice email: Your Zoho account mobile number is not verified. Please verify it at https://accounts.zoho.com/ → Security → Mobile Number. Error: ${responseData.message}`);
        }
      }
    } catch (error: any) {
      const axiosError = error as AxiosError;
      
      // Retry on network errors or 5xx errors
      if (retryCount < MAX_RETRIES && (
        !axiosError.response || 
        (axiosError.response.status >= 500 && axiosError.response.status < 600)
      )) {
        console.warn(`[ZohoService] ⚠️  Email send failed (attempt ${retryCount + 1}), retrying...`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1))); // Exponential backoff
        return this.sendInvoiceEmail(tenantId, invoiceId, customerEmail, retryCount + 1);
      }
      
      if (axiosError.response) {
        const errorData = axiosError.response.data as any;
        console.error('[ZohoService] Email sending failed:', {
          status: axiosError.response.status,
          code: errorData?.code,
          message: errorData?.message || errorData?.error,
          data: axiosError.response.data,
        });
        
        // Check for specific error codes
        if (errorData?.code === 1025) {
          // Mobile number not verified
          throw new Error(`Failed to send invoice email: Your Zoho account mobile number is not verified. Please verify it at https://accounts.zoho.com/ → Security → Mobile Number. Error: ${errorData.message}`);
        }
        
        throw new Error(`Failed to send invoice email: ${JSON.stringify(errorData)}`);
      }
      throw error;
    }
  }

  /**
   * Get invoice PDF URL
   */
  async getInvoicePdfUrl(tenantId: string, invoiceId: string): Promise<string> {
    const accessToken = await this.getAccessToken(tenantId);
    const apiBaseUrl = this.normalizeApiBaseUrl(await this.getApiBaseUrlForTenant(tenantId));
    const orgId = await this.getZohoOrganizationId(tenantId);
    const url = orgId ? `${apiBaseUrl}/invoices/${invoiceId}?organization_id=${encodeURIComponent(orgId)}` : `${apiBaseUrl}/invoices/${invoiceId}`;

    try {
      const response = await axios.get(url, {
        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
        params: { accept: 'pdf' },
      });

      // Zoho returns PDF URL in response
      return response.data.invoice?.pdf_url || '';
    } catch (error: any) {
      console.error('[ZohoService] Failed to get invoice PDF:', error.message);
      throw error;
    }
  }

  /**
   * Download invoice PDF as Buffer
   */
  async downloadInvoicePdf(tenantId: string, invoiceId: string): Promise<Buffer> {
    let accessToken = await this.getAccessToken(tenantId);
    const apiBaseUrl = this.normalizeApiBaseUrl(await this.getApiBaseUrlForTenant(tenantId));
    const orgId = await this.getZohoOrganizationId(tenantId);
    const url = orgId ? `${apiBaseUrl}/invoices/${invoiceId}?organization_id=${encodeURIComponent(orgId)}` : `${apiBaseUrl}/invoices/${invoiceId}`;

    try {
      const response = await axios.get(url, {
        headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
        params: { accept: 'pdf' },
        responseType: 'arraybuffer', // Get PDF as binary data
      });

      return Buffer.from(response.data);
    } catch (error: any) {
      // If 401 (Unauthorized), try refreshing token and retry once
      if (error.response?.status === 401) {
        console.log(`[ZohoService] 401 Unauthorized - refreshing token and retrying...`);
        try {
          // Get refresh token from database
          const { data: tokens, error: tokenError } = await supabase
            .from('zoho_tokens')
            .select('refresh_token')
            .eq('tenant_id', tenantId)
            .single();

          if (!tokenError && tokens && tokens.refresh_token) {
            // Refresh token and retry
            accessToken = await this.refreshAccessToken(tenantId, tokens.refresh_token);

            // Retry the request with new token (same URL with org_id if present)
            const retryResponse = await axios.get(url, {
              headers: { 'Authorization': `Zoho-oauthtoken ${accessToken}` },
              params: { accept: 'pdf' },
              responseType: 'arraybuffer',
            });

            console.log(`[ZohoService] Retry successful after token refresh`);
            return Buffer.from(retryResponse.data);
          } else {
            throw new Error('No refresh token available');
          }
        } catch (retryError: any) {
          const axiosError = retryError as AxiosError;
          console.error('[ZohoService] Failed to refresh token and retry:', retryError.message);
          
          if (axiosError.response) {
            const errorData = axiosError.response.data as any;
            console.error('[ZohoService] Retry error details:', {
              status: axiosError.response.status,
              code: errorData?.code,
              message: errorData?.message || errorData?.error,
              data: axiosError.response.data,
            });
            
            // Check for specific error codes
            if (errorData?.code === 401 || axiosError.response.status === 401) {
              // 401 after refresh suggests:
              // 1. Refresh token is invalid/expired
              // 2. Region mismatch (token from one region, API call to another)
              // 3. Token not yet propagated
              console.error('[ZohoService] ⚠️ 401 after token refresh - possible causes:');
              console.error('   1. Refresh token is invalid or expired');
              console.error('   2. Region mismatch (check ZOHO_API_BASE_URL matches your Zoho organization region)');
              console.error('   3. Organization location mismatch');
              console.error(`   Current API Base URL: ${this.apiBaseUrl}`);
              console.error(`   Please verify your Zoho organization region and set ZOHO_API_BASE_URL accordingly`);
              const authUrl = `${process.env.APP_URL || 'APP_URL_NOT_SET'}/api/zoho/auth?tenant_id=${tenantId}`;
              throw new Error(`Failed to download invoice PDF: Token refresh succeeded but API call still returns 401. This usually means: (1) Refresh token is invalid/expired, or (2) Region mismatch. Please re-authenticate Zoho and verify ZOHO_API_BASE_URL matches your organization region. Visit: ${authUrl}`);
            }
          }
          
          // Check if it's a refresh token issue
          if (retryError.message?.includes('invalid') || retryError.message?.includes('expired')) {
            const authUrl = `${process.env.APP_URL || 'https://booktifisupabase-production.up.railway.app'}/api/zoho/auth?tenant_id=${tenantId}`;
            throw new Error(`Failed to download invoice PDF: Refresh token is invalid or expired. Please re-authenticate Zoho by visiting: ${authUrl}`);
          }
          
          const authUrl = `${process.env.APP_URL || 'https://booktifisupabase-production.up.railway.app'}/api/zoho/auth?tenant_id=${tenantId}`;
          throw new Error(`Failed to download invoice PDF: Token refresh failed. Please re-authenticate Zoho by visiting: ${authUrl}`);
        }
      }
      
      console.error('[ZohoService] Failed to download invoice PDF:', error.message);
      if (error.response) {
        console.error('[ZohoService] Response status:', error.response.status);
        console.error('[ZohoService] Response data:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * Send invoice via WhatsApp
   * Flow: Fetch latest payment status from Zoho → Only if Paid: Download PDF → Send via WhatsApp
   * Critical: Invoice must NOT be sent if Zoho status is not Paid.
   */
  async sendInvoiceViaWhatsApp(tenantId: string, invoiceId: string, phoneNumber: string, customMessage?: string): Promise<void> {
    try {
      const paymentStatus = await this.getInvoicePaymentStatus(tenantId, invoiceId);
      if (paymentStatus.error) {
        throw new Error(paymentStatus.error);
      }
      if (!paymentStatus.isPaid) {
        console.warn(`[ZohoService] ❌ Invoice ${invoiceId} not sent via WhatsApp: payment status in Zoho is "${paymentStatus.status || 'unknown'}" (not Paid)`);
        throw new Error('Invoice cannot be sent because payment has not been completed.');
      }
      // Step 2: Download Invoice PDF from Zoho API
      console.log(`[ZohoService] 📥 Step 2: Downloading invoice PDF from Zoho API (Invoice ID: ${invoiceId})...`);
      const pdfBuffer = await this.downloadInvoicePdf(tenantId, invoiceId);
      console.log(`[ZohoService] ✅ Step 2 Complete: Invoice PDF downloaded (${(pdfBuffer.length / 1024).toFixed(2)} KB)`);
      
      // Step 3: Send PDF via WhatsApp API
      console.log(`[ZohoService] 📤 Step 3: Sending invoice PDF via WhatsApp API to ${phoneNumber}...`);
      const { sendWhatsAppDocument } = await import('./whatsappService.js');
      
      // Get tenant WhatsApp config
      const { data: tenants, error: tenantError } = await supabase
        .from('tenants')
        .select('whatsapp_settings')
        .eq('id', tenantId)
        .single();

      let whatsappConfig: any = undefined;
      if (!tenantError && tenants && tenants.whatsapp_settings) {
        const settings = tenants.whatsapp_settings;
        whatsappConfig = {
          provider: settings.provider,
          apiUrl: settings.api_url,
          apiKey: settings.api_key,
          phoneNumberId: settings.phone_number_id,
          accessToken: settings.access_token,
          accountSid: settings.account_sid,
          authToken: settings.auth_token,
          from: settings.from,
        };
      }
      
      // Send invoice PDF via WhatsApp API (customMessage can include Transfer Reference or Paid On Site)
      const message = customMessage || 'Your booking invoice is attached. Thank you for your booking!';
      const result = await sendWhatsAppDocument(
        phoneNumber,
        pdfBuffer,
        `invoice_${invoiceId}.pdf`,
        message,
        whatsappConfig
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to send invoice via WhatsApp');
      }
      
      console.log(`[ZohoService] ✅ Step 3 Complete: Invoice PDF sent via WhatsApp API to ${phoneNumber}`);
    } catch (error: any) {
      console.error(`[ZohoService] Failed to send invoice via WhatsApp:`, error.message);
      throw error;
    }
  }

  /**
   * Map booking data to Zoho invoice format
   */
  async mapBookingToInvoice(bookingId: string): Promise<ZohoInvoiceData> {
    console.log(`[ZohoService] 🔍 Mapping booking ${bookingId} to invoice data...`);
    
    // Fetch booking with related data (including offer if present)
    let bookings: any = null;
    let bookingError: any = null;
    
    try {
      // First, try to fetch booking with relations (excluding currency_code from tenants relation to avoid alias issues)
      const result = await supabase
        .from('bookings')
        .select(`
          *,
          services (
            name,
            name_ar,
            description,
            description_ar,
            base_price
          ),
          slots (
            start_time,
            end_time,
            slot_date
          ),
          tenants (
            name,
            name_ar
          ),
          service_offers (
            price,
            name,
            name_ar
          )
        `)
        .eq('id', bookingId)
        .single();

      bookings = result.data;
      bookingError = result.error;
      
      // If error is related to currency_code column, try a simpler query without tenants relation
      if (bookingError && (bookingError.message?.includes('currency_code') || bookingError.code === '42703')) {
        console.warn(`[ZohoService] ⚠️ Relation query failed (likely currency_code issue), trying simpler query...`);
        
        const simpleResult = await supabase
          .from('bookings')
          .select(`
            *,
            services (
              name,
              name_ar,
              description,
              description_ar,
              base_price
            ),
            slots (
              start_time,
              end_time,
              slot_date
            ),
            service_offers (
              price,
              name,
              name_ar
            )
          `)
          .eq('id', bookingId)
          .single();
        
        bookings = simpleResult.data;
        bookingError = simpleResult.error;
        
        if (!bookingError && bookings) {
          console.log(`[ZohoService] ✅ Booking fetched with simpler query (currency will be fetched separately)`);
        }
      }
      
      if (bookingError) {
        console.error(`[ZohoService] ❌ Error fetching booking: ${bookingError.message}`);
        console.error(`[ZohoService]    Error code: ${bookingError.code}`);
        console.error(`[ZohoService]    Error details: ${JSON.stringify(bookingError)}`);
      }
    } catch (queryError: any) {
      console.error(`[ZohoService] ❌ Exception fetching booking: ${queryError.message}`);
      console.error(`[ZohoService]    Stack: ${queryError.stack}`);
      bookingError = queryError;
    }

    if (bookingError || !bookings) {
      const errorMsg = `Booking ${bookingId} not found or query failed: ${bookingError?.message || 'Unknown error'}`;
      console.error(`[ZohoService] ❌ ${errorMsg}`);
      throw new Error(errorMsg);
    }
    
    console.log(`[ZohoService] ✅ Booking fetched successfully`);
    console.log(`[ZohoService]    Customer: ${bookings.customer_name}`);
    console.log(`[ZohoService]    Tenant Currency: ${bookings.tenants?.currency_code || 'NOT FOUND (will use SAR)'}`);

    // Get tenant currency - try from relation first, then fallback to direct query
    let tenantCurrencyCode = bookings.tenants?.currency_code;
    
    if (!tenantCurrencyCode && bookings.tenant_id) {
      console.log(`[ZohoService] ⚠️ Currency not found in relation, fetching directly from tenant...`);
      try {
        const { data: tenantData, error: tenantError } = await supabase
          .from('tenants')
          .select('currency_code')
          .eq('id', bookings.tenant_id)
          .maybeSingle();
        
        if (!tenantError && tenantData?.currency_code) {
          tenantCurrencyCode = tenantData.currency_code;
          console.log(`[ZohoService] ✅ Currency fetched directly: ${tenantCurrencyCode}`);
        } else {
          console.warn(`[ZohoService] ⚠️ Could not fetch currency directly: ${tenantError?.message || 'No data'}`);
        }
      } catch (tenantQueryError: any) {
        console.error(`[ZohoService] ❌ Error fetching tenant currency: ${tenantQueryError.message}`);
      }
    }
    
    // Final fallback to SAR if still not found
    if (!tenantCurrencyCode) {
      console.warn(`[ZohoService] ⚠️ No currency found, using default: SAR`);
      tenantCurrencyCode = 'SAR';
    }
    
    const booking = {
      ...bookings,
      service_name: bookings.services?.name || 'Unknown Service',
      service_name_ar: bookings.services?.name_ar || '',
      service_description: bookings.services?.description || '',
      service_description_ar: bookings.services?.description_ar || '',
      base_price: bookings.services?.base_price || 0,
      start_time: bookings.slots?.start_time,
      end_time: bookings.slots?.end_time,
      slot_date: bookings.slots?.slot_date,
      tenant_name: bookings.tenants?.name || 'Unknown Tenant',
      tenant_name_ar: bookings.tenants?.name_ar || '',
      tenant_currency_code: tenantCurrencyCode,
      offer_price: bookings.service_offers?.price,
      offer_name: bookings.service_offers?.name,
      offer_name_ar: bookings.service_offers?.name_ar,
    };
    
    console.log(`[ZohoService] ✅ Booking data prepared`);
    console.log(`[ZohoService]    Tenant Currency: ${booking.tenant_currency_code}`);
    console.log(`[ZohoService]    Service: ${booking.service_name}`);
    console.log(`[ZohoService]    Base Price: ${booking.base_price}`);
      // Default to English for invoice language
      // You can add language detection logic here if needed
      const language = 'en';

      // Determine service name based on language
      // CRITICAL: Ensure service name is never null/undefined/empty
      let serviceName = language === 'ar' && booking.service_name_ar
        ? booking.service_name_ar
        : booking.service_name;
      
      if (!serviceName || serviceName.trim().length === 0) {
        console.warn(`[ZohoService] ⚠️ Service name is empty, using fallback`);
        serviceName = 'Service'; // Fallback name
      }
      serviceName = serviceName.trim();

      let serviceDescription = language === 'ar' && booking.service_description_ar
        ? booking.service_description_ar
        : booking.service_description;
      
      // Description can be empty, but ensure it's at least an empty string
      if (!serviceDescription) {
        serviceDescription = '';
      }
      serviceDescription = serviceDescription.trim();
      
      console.log(`[ZohoService] 📋 Service details:`);
      console.log(`   Name: ${serviceName}`);
      console.log(`   Description length: ${serviceDescription.length}`);
      console.log(`   Language: ${language}`);

      // Build line items
      const lineItems: ZohoInvoiceData['line_items'] = [];

      // Determine price: use offer price if offer exists, otherwise use base_price
      let pricePerTicket: number;
      if (booking.offer_id && booking.offer_price) {
        pricePerTicket = parseFloat(booking.offer_price.toString());
        console.log(`[ZohoService] Using offer price for invoice: ${pricePerTicket} (Offer ID: ${booking.offer_id})`);
      } else {
        pricePerTicket = parseFloat(booking.base_price?.toString() || '0');
      }

      // Use paid_quantity for invoice (only invoice the paid portion)
      // If paid_quantity is null/undefined, fallback to visitor_count (for backward compatibility)
      const paidQty = booking.paid_quantity !== null && booking.paid_quantity !== undefined 
        ? booking.paid_quantity 
        : (booking.visitor_count || 1);
      const packageCoveredQty = booking.package_covered_quantity || 0;
      
      console.log(`[ZohoService] 📊 Partial coverage check:`);
      console.log(`   Total tickets: ${booking.visitor_count || 1}`);
      console.log(`   Package covered: ${packageCoveredQty}`);
      console.log(`   Paid quantity: ${paidQty}`);
      
      // ============================================================================
      // STRICT BILLING: Only create invoice line items if there's a paid portion
      // ============================================================================
      if (paidQty > 0) {
        // Use the actual total_price from booking (which already accounts for paid portion)
        const totalPrice = parseFloat(booking.total_price.toString());
        
        // DOUBLE-CHECK: Ensure total_price > 0 (should never happen if paidQty > 0, but safety check)
        if (totalPrice <= 0) {
          console.warn(`[ZohoService] ⚠️ WARNING: paidQty > 0 but total_price = ${totalPrice}`);
          console.warn(`[ZohoService]    This should not happen - skipping invoice creation`);
          throw new Error('Invalid invoice data: paid quantity > 0 but total price = 0');
        }
        
        // Build item name - include offer name if offer is used
        let itemName = serviceName;
        if (booking.offer_id && booking.offer_name) {
          const offerName = language === 'ar' && booking.offer_name_ar 
            ? booking.offer_name_ar 
            : booking.offer_name;
          // Only add offer name if it's different from service name
          if (offerName !== serviceName) {
              itemName = `${serviceName} - ${offerName}`;
            } else {
              itemName = `${serviceName} (Offer)`;
            }
          }

        // Add note about package coverage if applicable
        let itemDescription = serviceDescription;
        if (packageCoveredQty > 0) {
          const coverageNote = language === 'ar' 
            ? ` (${packageCoveredQty} تذكرة مغطاة بالباقة)`
            : ` (${packageCoveredQty} tickets covered by package)`;
          itemDescription = serviceDescription 
            ? `${serviceDescription}${coverageNote}`
            : coverageNote.trim();
        }

        lineItems.push({
          name: itemName,
          description: itemDescription,
          rate: pricePerTicket,
          quantity: paidQty, // Only invoice paid tickets
          unit: 'ticket',
        });
        
        console.log(`[ZohoService] ✅ Invoice line item created for ${paidQty} paid ticket(s) at ${pricePerTicket} each = ${totalPrice}`);
      } else {
        // This should never happen if the check above works, but add safety
        console.warn(`[ZohoService] ⚠️ WARNING: No paid quantity but reached line item creation`);
        console.warn(`[ZohoService]    This indicates a logic error - invoice should not be created`);
        throw new Error('Cannot create invoice: paid quantity is 0 or total price is 0');
      }

      // Format date
      const bookingDate = new Date(booking.created_at);
      const slotDate = booking.slot_date ? new Date(booking.slot_date) : bookingDate;
      
      // Invoice date (today)
      const invoiceDate = new Date();
      invoiceDate.setHours(0, 0, 0, 0);
      
      // Due date must be after invoice date (Zoho requirement)
      // Use slot date if it's in the future, otherwise use invoice date + 7 days
      let dueDate = slotDate;
      if (dueDate <= invoiceDate) {
        // If slot date is in the past or today, set due date to 7 days from now
        dueDate = new Date(invoiceDate);
        dueDate.setDate(dueDate.getDate() + 7);
      }

      // Build custom fields
      const customFields: Record<string, any> = {
        booking_id: booking.id,
        slot_date: slotDate.toISOString().split('T')[0],
      };

      if (booking.start_time && booking.end_time) {
        const startTime = new Date(booking.start_time);
        const endTime = new Date(booking.end_time);
        customFields.slot_time = `${startTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })} - ${endTime.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`;
      }

      let notes = booking.notes || `Booking ID: ${booking.id}`;
      const payMethod = (booking as any).payment_method;
      const payRef = (booking as any).transaction_reference?.toString?.()?.trim();
      if (payMethod === 'transfer' && payRef) {
        notes += `\nPayment: Bank transfer. Reference: ${payRef}`;
      } else if (payMethod === 'onsite' || payMethod === 'cash') {
        notes += '\nPayment: Paid on site';
      }
      return {
        customer_name: booking.customer_name,
        customer_email: booking.customer_email || undefined, // Optional
        customer_phone: booking.customer_phone || undefined, // For WhatsApp delivery
        line_items: lineItems,
        date: invoiceDate.toISOString().split('T')[0], // Use today's date for invoice
        due_date: dueDate.toISOString().split('T')[0], // Due date must be after invoice date
        currency_code: (booking as any).tenant_currency_code || 'SAR',
        notes,
        reference_number: payMethod === 'transfer' && payRef ? payRef : undefined,
        custom_fields: customFields,
      };
      
      // CRITICAL: Validate currency_code before returning
      const finalCurrencyCode = invoiceData.currency_code || 'SAR';
      if (!finalCurrencyCode || finalCurrencyCode.trim().length === 0) {
        console.error(`[ZohoService] ❌ CRITICAL: currency_code is empty or null, using SAR as fallback`);
        invoiceData.currency_code = 'SAR';
      } else {
        invoiceData.currency_code = finalCurrencyCode.trim().toUpperCase();
      }
      
      // Validate currency code format (must be 3 uppercase letters)
      const currencyCodeRegex = /^[A-Z]{3}$/;
      if (!currencyCodeRegex.test(invoiceData.currency_code)) {
        console.error(`[ZohoService] ❌ CRITICAL: Invalid currency_code format: "${invoiceData.currency_code}", using SAR as fallback`);
        invoiceData.currency_code = 'SAR';
      }
      
      console.log(`[ZohoService] ✅ Invoice data mapped successfully`);
      console.log(`[ZohoService]    Currency: ${invoiceData.currency_code}`);
      console.log(`[ZohoService]    Line items: ${invoiceData.line_items.length}`);
      console.log(`[ZohoService]    Total amount: ${invoiceData.line_items.reduce((sum, item) => sum + (item.rate * item.quantity), 0)} ${invoiceData.currency_code}`);
      
      return invoiceData;
  }

  /**
   * Generate and send receipt for a booking group (bulk booking)
   * Creates ONE invoice for all bookings in the group
   */
  async generateReceiptForBookingGroup(bookingGroupId: string): Promise<{ invoiceId: string; success: boolean; error?: string }> {
    try {
      // Fetch all bookings in the group (include paid_quantity and package_covered_quantity)
      const { data: bookings, error: bookingError } = await supabase
        .from('bookings')
        .select(`
          id,
          tenant_id,
          customer_name,
          customer_phone,
          customer_email,
          total_price,
          paid_quantity,
          package_covered_quantity,
          visitor_count,
          zoho_invoice_id,
          services (
            name,
            name_ar,
            description,
            description_ar,
            base_price
          ),
          slots (
            start_time,
            end_time,
            slot_date
          ),
          tenants (
            name,
            name_ar,
            currency_code
          ),
          service_offers (
            price,
            name,
            name_ar
          )
        `)
        .eq('booking_group_id', bookingGroupId)
        .order('created_at', { ascending: true });

      if (bookingError || !bookings || bookings.length === 0) {
        throw new Error(`No bookings found for group ${bookingGroupId}`);
      }

      const firstBooking = bookings[0];
      const tenantId = firstBooking.tenant_id;

      if (!tenantId) {
        throw new Error(`Booking group ${bookingGroupId} has no tenant_id`);
      }

      // CRITICAL: Check if Zoho is configured for this tenant BEFORE attempting invoice creation
      const { data: zohoConfig } = await supabase
        .from('tenant_zoho_configs')
        .select('id, is_active')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .single();
      
      const { data: zohoToken } = await supabase
        .from('zoho_tokens')
        .select('id, expires_at')
        .eq('tenant_id', tenantId)
        .single();
      
      if (!zohoConfig || !zohoToken) {
        const errorMsg = `Zoho Invoice not configured for tenant ${tenantId}. Config: ${!!zohoConfig}, Token: ${!!zohoToken}. Please configure Zoho Invoice in Settings → Zoho Integration`;
        console.error(`[ZohoService] ❌ ${errorMsg}`);
        return {
          invoiceId: '',
          success: false,
          error: errorMsg
        };
      }
      
      // Check if token is expired
      if (zohoToken.expires_at) {
        const expiresAt = new Date(zohoToken.expires_at);
        const now = new Date();
        if (expiresAt <= now) {
          const errorMsg = `Zoho token expired for tenant ${tenantId}. Please refresh Zoho connection in Settings`;
          console.error(`[ZohoService] ❌ ${errorMsg}`);
          return {
            invoiceId: '',
            success: false,
            error: errorMsg
          };
        }
      }
      
      console.log(`[ZohoService] ✅ Zoho is configured and connected for tenant ${tenantId}`);

      // CRITICAL: Idempotency check - prevent duplicate invoices
      // Check if invoice already exists for this booking group
      const bookingsWithInvoice = bookings.filter(b => b.zoho_invoice_id);
      if (bookingsWithInvoice.length > 0) {
        const existingInvoiceId = bookingsWithInvoice[0].zoho_invoice_id;
        // Verify all bookings have the same invoice ID (should be the case)
        const allSameInvoice = bookings.every(b => !b.zoho_invoice_id || b.zoho_invoice_id === existingInvoiceId);
        
        if (allSameInvoice && existingInvoiceId) {
          console.log(`[ZohoService] Invoice already exists for booking group ${bookingGroupId}: ${existingInvoiceId}`);
          return {
            invoiceId: existingInvoiceId,
            success: true
          };
        }
      }

      // Check if there's any paid quantity across all bookings
      const totalPaidQty = bookings.reduce((sum, b) => sum + (b.paid_quantity || 0), 0);
      const totalPackageCoveredQty = bookings.reduce((sum, b) => sum + (b.package_covered_quantity || 0), 0);

      console.log(`[ZohoService] 📊 Bulk booking partial coverage check:`);
      console.log(`   Total bookings: ${bookings.length}`);
      console.log(`   Total package covered: ${totalPackageCoveredQty}`);
      console.log(`   Total paid: ${totalPaidQty}`);

      // ============================================================================
      // STRICT BILLING RULE: Invoice ONLY when real money is owed
      // ============================================================================
      // CRITICAL: Do NOT create invoice if:
      // 1. totalPaidQty <= 0 (fully covered by package)
      // 2. totalAmount <= 0 (no money owed)
      // ============================================================================
      
      // Calculate total amount first to double-check
      const calculatedTotalAmount = bookings.reduce((sum, b) => {
        return sum + parseFloat(String(b.total_price || 0));
      }, 0);
      
      // STRICT CHECK: Only create invoice if there's actual money owed
      if (totalPaidQty <= 0 || calculatedTotalAmount <= 0) {
        console.log(`[ZohoService] ℹ️ STRICT BILLING: Bulk invoice NOT created (package-covered booking)`);
        console.log(`[ZohoService]    Total paid quantity: ${totalPaidQty} (must be > 0)`);
        console.log(`[ZohoService]    Total amount: ${calculatedTotalAmount} (must be > 0)`);
        console.log(`[ZohoService]    Total package covered: ${totalPackageCoveredQty}`);
        console.log(`[ZohoService]    → This is CORRECT: No invoice for free bookings`);
        return {
          invoiceId: '',
          success: true, // Not an error - just no invoice needed
          error: undefined
        };
      }

      // Aggregate paid bookings into invoice line items
      const lineItems: Array<{
        name: string;
        description?: string;
        rate: number;
        quantity: number;
        unit?: string;
      }> = [];

      let totalAmount = 0;
      const language = 'en'; // Default to English for invoice

      // Group bookings by service for cleaner invoice
      const serviceGroups = new Map<string, typeof bookings>();
      for (const booking of bookings) {
        const serviceId = booking.services?.id || 'unknown';
        if (!serviceGroups.has(serviceId)) {
          serviceGroups.set(serviceId, []);
        }
        serviceGroups.get(serviceId)!.push(booking);
      }

      for (const [serviceId, serviceBookings] of serviceGroups.entries()) {
        const firstBooking = serviceBookings[0];
        const serviceName = language === 'ar' && firstBooking.services.name_ar
          ? firstBooking.services.name_ar
          : firstBooking.services.name;

        const serviceDescription = language === 'ar' && firstBooking.services.description_ar
          ? firstBooking.services.description_ar
          : firstBooking.services.description;

        // Sum paid quantities for this service
        const paidQtyForService = serviceBookings.reduce((sum, b) => sum + (b.paid_quantity || 0), 0);
        const packageCoveredQtyForService = serviceBookings.reduce((sum, b) => sum + (b.package_covered_quantity || 0), 0);

        if (paidQtyForService > 0) {
          // Calculate price per paid ticket
          const pricePerTicket = parseFloat(String(firstBooking.services.base_price || 0));
          const totalPriceForService = serviceBookings.reduce((sum, b) => sum + parseFloat(String(b.total_price || 0)), 0);

          // Build description with slot info and package coverage note
          const slotInfo = serviceBookings.map(b => {
            const slotDate = b.slots?.slot_date;
            const startTime = b.slots?.start_time;
            const endTime = b.slots?.end_time;
            return slotDate && startTime && endTime ? `${slotDate} ${startTime}-${endTime}` : '';
          }).filter(Boolean).join(', ');

          let itemDescription = serviceDescription || '';
          if (slotInfo) {
            itemDescription = itemDescription ? `${itemDescription}\n${slotInfo}` : slotInfo;
          }
          if (packageCoveredQtyForService > 0) {
            const coverageNote = language === 'ar' 
              ? ` (${packageCoveredQtyForService} تذكرة مغطاة بالباقة)`
              : ` (${packageCoveredQtyForService} tickets covered by package)`;
            itemDescription = itemDescription ? `${itemDescription}${coverageNote}` : coverageNote.trim();
          }

          lineItems.push({
            name: serviceName,
            description: itemDescription || undefined,
            rate: pricePerTicket,
            quantity: paidQtyForService, // Only invoice paid tickets
            unit: 'ticket'
          });

          totalAmount += totalPriceForService;
        }
      }

      if (lineItems.length === 0) {
        console.log(`[ZohoService] ℹ️ No paid bookings in group - invoice will be empty (fully covered by package)`);
        return {
          invoiceId: '',
          success: true,
          error: undefined
        };
      }

      // Prepare invoice data
      const invoiceData: ZohoInvoiceData = {
        customer_name: firstBooking.customer_name,
        customer_email: firstBooking.customer_email || undefined,
        customer_phone: firstBooking.customer_phone || undefined,
        line_items: lineItems,
        date: new Date().toISOString().split('T')[0],
        due_date: new Date().toISOString().split('T')[0],
        currency_code: (firstBooking as any).tenants?.currency_code || 'SAR',
        notes: `Booking Group: ${bookingGroupId}\nTotal Bookings: ${bookings.length}`
      };

      // Create invoice in Zoho
      console.log(`[ZohoService] 📋 Creating invoice for booking group ${bookingGroupId} (${bookings.length} bookings)...`);
      const invoiceResponse = await this.createInvoice(tenantId, invoiceData);

      if (!invoiceResponse.invoice || !invoiceResponse.invoice.invoice_id) {
        throw new Error(`Failed to create invoice: ${invoiceResponse.message || 'Unknown error'}`);
      }

      const invoiceId = invoiceResponse.invoice.invoice_id;
      console.log(`[ZohoService] ✅ Invoice created: ${invoiceId}`);

      // Update ALL bookings in the group with invoice ID
      const { error: updateError } = await supabase
        .from('bookings')
        .update({
          zoho_invoice_id: invoiceId,
          zoho_invoice_created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('booking_group_id', bookingGroupId);

      if (updateError) {
        throw new Error(`Failed to update bookings with invoice ID: ${updateError.message}`);
      }

      console.log(`[ZohoService] ✅ Updated ${bookings.length} bookings with invoice ID ${invoiceId}`);

      // Send invoice via email/WhatsApp
      const customerEmail = firstBooking.customer_email;
      const customerPhone = firstBooking.customer_phone;

      if (customerEmail) {
        try {
          await this.sendInvoiceEmail(tenantId, invoiceId, customerEmail);
          console.log(`[ZohoService] ✅ Invoice sent via email`);
        } catch (emailError: any) {
          console.error(`[ZohoService] ⚠️ Email delivery failed:`, emailError.message);
        }
      }

      if (customerPhone) {
        try {
          await this.sendInvoiceViaWhatsApp(tenantId, invoiceId, customerPhone);
          console.log(`[ZohoService] ✅ Invoice sent via WhatsApp`);
        } catch (whatsappError: any) {
          console.error(`[ZohoService] ⚠️ WhatsApp delivery failed:`, whatsappError.message);
        }
      }

      return {
        invoiceId,
        success: true
      };
    } catch (error: any) {
      console.error(`[ZohoService] ❌ Error generating receipt for booking group:`, error);
      return {
        invoiceId: '',
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }

  /**
   * Generate and send receipt for a booking.
   * Optional paymentMethod and transactionReference ensure the bank transfer reference
   * is included on the invoice when creating at booking creation (avoids race with DB update).
   */
  async generateReceipt(
    bookingId: string,
    options?: { paymentMethod?: string; transactionReference?: string }
  ): Promise<{ invoiceId: string; success: boolean; error?: string }> {
    try {
      // CRITICAL: The booking was just created via RPC, and there might be a slight delay
      // before it's visible in queries. Retry with exponential backoff.
      let booking: any = null;
      let retryCount = 0;
      const maxRetries = 5;
      const baseDelay = 500; // 500ms base delay
      
      console.log(`[ZohoService] 🔍 Looking up booking ${bookingId}...`);
      
      while (!booking && retryCount < maxRetries) {
        if (retryCount > 0) {
          const delay = baseDelay * Math.pow(2, retryCount - 1); // Exponential backoff: 500ms, 1s, 2s, 4s
          console.log(`[ZohoService] ⏳ Waiting ${delay}ms before retry ${retryCount}/${maxRetries}...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // Query booking - use maybeSingle to avoid throwing error if not found
        // Include paid_quantity and package_covered_quantity for partial coverage support
        const { data: bookingData, error: bookingError } = await supabase
          .from('bookings')
          .select('zoho_invoice_id, tenant_id, customer_email, customer_phone, customer_name, paid_quantity, package_covered_quantity, payment_status, total_price, payment_method, transaction_reference')
          .eq('id', bookingId)
          .maybeSingle(); // Use maybeSingle to avoid throwing error if not found
        
        if (bookingData && !bookingError) {
          booking = bookingData;
          console.log(`[ZohoService] ✅ Booking found after ${retryCount} attempt(s)`);
        } else {
          retryCount++;
          if (retryCount < maxRetries) {
            console.warn(`[ZohoService] ⚠️ Booking ${bookingId} not found yet (attempt ${retryCount}/${maxRetries}), retrying...`);
            if (bookingError) {
              console.warn(`[ZohoService]    Error: ${bookingError.message}`);
            }
          } else {
            const errorMsg = `Booking ${bookingId} not found after ${maxRetries} attempts. The booking may not have been created successfully or there is a database replication delay.`;
            console.error(`[ZohoService] ❌ ${errorMsg}`);
            return {
              invoiceId: '',
              success: false,
              error: errorMsg
            };
          }
        }
      }

      // Validate tenant_id
      if (!booking.tenant_id) {
        throw new Error(`Booking ${bookingId} has no tenant_id`);
      }

      // ============================================================================
      // PRECONDITION VERIFICATION (CRITICAL - Must pass before invoice creation)
      // ============================================================================
      console.log(`[ZohoService] 🔒 Verifying preconditions for invoice creation...`);
      
      // Precondition 1: Zoho Configuration
      const { data: zohoConfig } = await supabase
        .from('tenant_zoho_configs')
        .select('id, is_active, client_id, redirect_uri')
        .eq('tenant_id', booking.tenant_id)
        .eq('is_active', true)
        .maybeSingle();
      
      if (!zohoConfig) {
        const errorMsg = `Zoho Invoice not configured for tenant ${booking.tenant_id}. Please configure Zoho Invoice in Settings → Zoho Integration (add client_id, client_secret, redirect_uri)`;
        console.error(`[ZohoService] ❌ PRECONDITION FAILED: ${errorMsg}`);
        return {
          invoiceId: '',
          success: false,
          error: errorMsg
        };
      }
      
      if (!zohoConfig.client_id || !zohoConfig.redirect_uri) {
        const errorMsg = `Zoho configuration incomplete for tenant ${booking.tenant_id}. Missing: ${!zohoConfig.client_id ? 'client_id' : ''} ${!zohoConfig.redirect_uri ? 'redirect_uri' : ''}. Please complete Zoho setup in Settings`;
        console.error(`[ZohoService] ❌ PRECONDITION FAILED: ${errorMsg}`);
        return {
          invoiceId: '',
          success: false,
          error: errorMsg
        };
      }
      
      console.log(`[ZohoService] ✅ Precondition 1: Zoho configuration exists and is active`);
      
      // Precondition 2: Zoho OAuth Tokens
      const { data: zohoToken } = await supabase
        .from('zoho_tokens')
        .select('id, expires_at, access_token')
        .eq('tenant_id', booking.tenant_id)
        .maybeSingle();
      
      if (!zohoToken) {
        const errorMsg = `Zoho OAuth tokens not found for tenant ${booking.tenant_id}. Please complete OAuth flow in Settings → Zoho Integration → Connect Zoho`;
        console.error(`[ZohoService] ❌ PRECONDITION FAILED: ${errorMsg}`);
        return {
          invoiceId: '',
          success: false,
          error: errorMsg
        };
      }
      
      // Precondition 3: Token Status Check (expiration handled by getAccessToken())
      // CRITICAL: We don't check expiration here because getAccessToken() will auto-refresh
      // expired or soon-to-expire tokens. We only verify the token record exists.
      if (zohoToken.expires_at) {
        const expiresAt = new Date(zohoToken.expires_at);
        const now = new Date();
        const minutesUntilExpiry = Math.round((expiresAt.getTime() - now.getTime()) / 1000 / 60);
        
        console.log(`[ZohoService] 🔍 Token status check:`);
        console.log(`[ZohoService]    Token expires at: ${expiresAt.toISOString()}`);
        console.log(`[ZohoService]    Current time: ${now.toISOString()}`);
        console.log(`[ZohoService]    Minutes until expiry: ${minutesUntilExpiry}`);
        
        if (minutesUntilExpiry <= 5) {
          console.warn(`[ZohoService] ⚠️ Token expires soon (${minutesUntilExpiry} minutes) - getAccessToken() will auto-refresh`);
        } else if (minutesUntilExpiry > 0) {
          console.log(`[ZohoService] ✅ Token is valid (expires in ${minutesUntilExpiry} minutes)`);
        } else {
          console.warn(`[ZohoService] ⚠️ Token is expired (${Math.abs(minutesUntilExpiry)} minutes ago) - getAccessToken() will attempt to refresh using refresh_token`);
        }
        // Continue - getAccessToken() will handle refresh for expired tokens
      } else {
        console.warn(`[ZohoService] ⚠️ Token has no expiration date - proceeding (getAccessToken() will handle validation)`);
      }
      
      console.log(`[ZohoService] ✅ Precondition 2: Zoho OAuth tokens exist (getAccessToken() will handle refresh if needed)`);
      
      // Precondition 4: Customer Contact (at least email OR phone)
      const hasEmail = booking.customer_email && booking.customer_email.trim().length > 0;
      const hasPhone = booking.customer_phone && booking.customer_phone.trim().length > 0;
      
      if (!hasEmail && !hasPhone) {
        // Invoice can still be created, but delivery will be skipped
        console.warn(`[ZohoService] ⚠️ Precondition 4: No customer contact (email or phone) - invoice will be created but NOT sent`);
      } else {
        console.log(`[ZohoService] ✅ Precondition 4: Customer contact available (email: ${hasEmail}, phone: ${hasPhone})`);
      }
      
      console.log(`[ZohoService] ✅ All preconditions verified - proceeding with invoice creation`);

      // Check if booking has paid quantity before creating invoice
      // Fetch paid_quantity to determine if invoice should be created
      // CRITICAL: Must also select total_price to check if invoice should be created
      const { data: bookingWithPaidQty, error: paidQtyError } = await supabase
        .from('bookings')
        .select('paid_quantity, package_covered_quantity, visitor_count, total_price')
        .eq('id', bookingId)
        .maybeSingle();
      
      const paidQty = bookingWithPaidQty?.paid_quantity ?? (bookingWithPaidQty?.visitor_count || 0);
      const packageCoveredQty = bookingWithPaidQty?.package_covered_quantity ?? 0;
      
      console.log(`[ZohoService] 📊 Partial coverage check for invoice:`);
      console.log(`   Paid quantity: ${paidQty}`);
      console.log(`   Package covered: ${packageCoveredQty}`);
      console.log(`   Total price from DB: ${bookingWithPaidQty?.total_price ?? 'null/undefined'}`);
      
      // ============================================================================
      // STRICT BILLING RULE: Invoice ONLY when real money is owed
      // ============================================================================
      // CRITICAL: Do NOT create invoice if:
      // 1. paidQty <= 0 (fully covered by package)
      // 2. total_price <= 0 (no money owed)
      // ============================================================================
      
      // Get total_price to double-check
      // CRITICAL: total_price is now selected in the query above
      const bookingTotalPrice = bookingWithPaidQty?.total_price !== null && bookingWithPaidQty?.total_price !== undefined
        ? parseFloat(bookingWithPaidQty.total_price.toString()) 
        : 0;
      
      console.log(`[ZohoService] 📊 Price validation:`);
      console.log(`   Raw total_price: ${bookingWithPaidQty?.total_price}`);
      console.log(`   Parsed total_price: ${bookingTotalPrice}`);
      console.log(`   Type: ${typeof bookingWithPaidQty?.total_price}`);
      
      // STRICT CHECK: Only create invoice if there's actual money owed
      if (paidQty <= 0 || bookingTotalPrice <= 0) {
        console.log(`[ZohoService] ℹ️ STRICT BILLING: Invoice NOT created (package-covered booking)`);
        console.log(`[ZohoService]    Paid quantity: ${paidQty} (must be > 0)`);
        console.log(`[ZohoService]    Total price: ${bookingTotalPrice} (must be > 0)`);
        console.log(`[ZohoService]    Package covered: ${packageCoveredQty}`);
        console.log(`[ZohoService]    → This is CORRECT: No invoice for free bookings`);
        return {
          invoiceId: '',
          success: true, // Not an error - just no invoice needed
          error: undefined
        };
      }

      // Map booking to invoice data (needed for delivery even if invoice exists)
      let invoiceData: ZohoInvoiceData;
      try {
        invoiceData = await this.mapBookingToInvoice(bookingId);
        console.log(`[ZohoService] ✅ Booking mapped to invoice data successfully`);
        
        // Ensure bank transfer reference is on the invoice (from request when creating at booking creation)
        const payMethod = options?.paymentMethod ?? (booking as any)?.payment_method;
        const payRef = (options?.transactionReference ?? (booking as any)?.transaction_reference)?.toString?.()?.trim();
        if (payMethod === 'transfer' && payRef) {
          const refLine = `\nPayment: Bank transfer. Reference: ${payRef}`;
          if (!invoiceData.notes?.includes(payRef)) {
            invoiceData.notes = (invoiceData.notes || '').trim() + refLine;
            console.log(`[ZohoService] ✅ Added bank transfer reference to invoice notes`);
          }
          invoiceData.reference_number = payRef;
          console.log(`[ZohoService] ✅ Set invoice reference_number for PDF: ${payRef}`);
        }
        
        // Verify invoice has line items (should have paidQty items)
        if (!invoiceData.line_items || invoiceData.line_items.length === 0) {
          console.log(`[ZohoService] ℹ️ No line items in invoice data - booking fully covered by package`);
          return {
            invoiceId: '',
            success: true, // Not an error - just no invoice needed
            error: undefined
          };
        }
      } catch (mapError: any) {
        const errorMsg = `Failed to map booking to invoice data: ${mapError.message || 'Unknown error'}`;
        console.error(`[ZohoService] ❌ ${errorMsg}`);
        console.error(`[ZohoService]    Stack: ${mapError.stack}`);
        return {
          invoiceId: '',
          success: false,
          error: errorMsg
        };
      }
      
      // IMPORTANT: Ensure we use email directly from booking if mapBookingToInvoice didn't get it
      // This ensures email is always used if available in the database
      const customerEmail = booking.customer_email || invoiceData.customer_email;
      const customerPhone = booking.customer_phone || invoiceData.customer_phone;
      
      // Update invoiceData with direct booking values (more reliable)
      if (customerEmail) {
        invoiceData.customer_email = customerEmail.trim();
      }
      if (customerPhone) {
        invoiceData.customer_phone = customerPhone.trim();
      }
      
      // Log customer contact information for debugging
      console.log(`[ZohoService] 📋 Customer contact info for invoice:`);
      console.log(`   Name: ${invoiceData.customer_name}`);
      console.log(`   Email (from booking): ${booking.customer_email || 'NULL'}`);
      console.log(`   Email (from mapped data): ${invoiceData.customer_email || 'NULL'}`);
      console.log(`   Email (final): ${invoiceData.customer_email || 'NOT PROVIDED'}`);
      console.log(`   Phone: ${invoiceData.customer_phone || 'NOT PROVIDED'}`);

      let invoiceId: string;

      // ============================================================================
      // DUPLICATE PREVENTION: Check if invoice already exists
      // ============================================================================
      if (booking.zoho_invoice_id) {
        console.log(`[ZohoService] ⚠️ DUPLICATE PREVENTION: Invoice already exists for booking ${bookingId}`);
        console.log(`[ZohoService]    Existing Invoice ID: ${booking.zoho_invoice_id}`);
        console.log(`[ZohoService]    Skipping invoice creation to prevent duplicates`);
        invoiceId = booking.zoho_invoice_id;
        
        // Verify the existing invoice still exists in Zoho
        try {
          const existingInvoiceCheck = await this.getInvoice(booking.tenant_id, invoiceId);
          if (existingInvoiceCheck.invoice) {
            console.log(`[ZohoService] ✅ Existing invoice verified in Zoho`);
            console.log(`[ZohoService]    Invoice Number: ${existingInvoiceCheck.invoice.invoice_number || 'N/A'}`);
            console.log(`[ZohoService]    Invoice Status: ${existingInvoiceCheck.invoice.status || 'N/A'}`);
          } else {
            console.warn(`[ZohoService] ⚠️ Existing invoice ${invoiceId} not found in Zoho - may have been deleted`);
          }
        } catch (checkError: any) {
          console.warn(`[ZohoService] ⚠️ Could not verify existing invoice: ${checkError.message}`);
        }
        
        console.log(`[ZohoService]    Will attempt to send via email/WhatsApp if not already sent`);
      } else {
        // Email is optional - validate format only if provided
        if (invoiceData.customer_email) {
          const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
          if (!emailRegex.test(invoiceData.customer_email)) {
            throw new Error(`Invalid email format: ${invoiceData.customer_email}`);
          }
        }

        // ============================================================================
        // STEP 1: Create Invoice in Zoho Invoice API
        // ============================================================================
        console.log(`[ZohoService] 📋 Step 1: Creating invoice in Zoho Invoice for booking ${bookingId}...`);
        console.log(`[ZohoService]    Customer: ${invoiceData.customer_name}`);
        console.log(`[ZohoService]    Amount: ${invoiceData.line_items.reduce((sum, item) => sum + (item.rate * item.quantity), 0)} ${invoiceData.currency_code}`);
        console.log(`[ZohoService]    Line items: ${invoiceData.line_items.length}`);
        
        let invoiceResponse: ZohoInvoiceResponse;
        try {
          invoiceResponse = await this.createInvoice(booking.tenant_id, invoiceData);
        } catch (createError: any) {
          // CRITICAL: If Zoho API fails, log error but don't fail booking
          const errorMsg = `Failed to create invoice in Zoho: ${createError.message || 'Unknown error'}`;
          console.error(`[ZohoService] ❌ Step 1 FAILED: ${errorMsg}`);
          
          // Log failure to zoho_invoice_logs
          await supabase
            .from('zoho_invoice_logs')
            .insert({
              booking_id: bookingId,
              tenant_id: booking.tenant_id,
              zoho_invoice_id: null,
              status: 'failed',
              request_payload: JSON.stringify(invoiceData),
              response_payload: JSON.stringify({ error: createError.message, stack: createError.stack }),
            });
          
          return {
            invoiceId: '',
            success: false,
            error: errorMsg
          };
        }

        // Verify Zoho response structure
        if (!invoiceResponse.invoice || !invoiceResponse.invoice.invoice_id) {
          const errorMsg = `Invalid Zoho response: ${invoiceResponse.message || 'No invoice_id in response'}`;
          console.error(`[ZohoService] ❌ Step 1 FAILED: ${errorMsg}`);
          console.error(`[ZohoService]    Response: ${JSON.stringify(invoiceResponse, null, 2)}`);
          
          // Log failure
          await supabase
            .from('zoho_invoice_logs')
            .insert({
              booking_id: bookingId,
              tenant_id: booking.tenant_id,
              zoho_invoice_id: null,
              status: 'failed',
              request_payload: JSON.stringify(invoiceData),
              response_payload: JSON.stringify(invoiceResponse),
            });
          
          return {
            invoiceId: '',
            success: false,
            error: errorMsg
          };
        }

        invoiceId = invoiceResponse.invoice.invoice_id;
        const invoiceNumber = invoiceResponse.invoice.invoice_number || '';
        const invoiceStatus = invoiceResponse.invoice.status || 'sent';
        
        console.log(`[ZohoService] ✅ Step 1 Complete: Invoice created in Zoho`);
        console.log(`[ZohoService]    Invoice ID: ${invoiceId}`);
        console.log(`[ZohoService]    Invoice Number: ${invoiceNumber || 'N/A'}`);
        console.log(`[ZohoService]    Invoice Status: ${invoiceStatus}`);

        // ============================================================================
        // STEP 2: Persist Invoice Data to Database
        // ============================================================================
        console.log(`[ZohoService] 💾 Step 2: Saving invoice data to database for booking ${bookingId}...`);
        
        // Build invoice URL (Zoho Invoice web URL format)
        const region = await zohoCredentials.getRegionForTenant(booking.tenant_id).catch(() => 'com');
        const invoiceUrl = `https://invoice.zoho.${region}/#/invoices/${invoiceId}`;
        
        const { data: updatedBooking, error: updateError } = await supabase
          .from('bookings')
          .update({
            zoho_invoice_id: invoiceId,
            zoho_invoice_created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq('id', bookingId)
          .select('id, zoho_invoice_id, zoho_invoice_created_at')
          .single();

        if (updateError || !updatedBooking) {
          // CRITICAL: Invoice was created in Zoho but failed to save to DB
          // This is a serious issue - invoice exists in Zoho but not linked to booking
          const errorMsg = `CRITICAL: Invoice ${invoiceId} created in Zoho but failed to save to database. Booking: ${bookingId}, Error: ${updateError?.message || 'Booking not found'}`;
          console.error(`[ZohoService] ❌ Step 2 FAILED: ${errorMsg}`);
          console.error(`[ZohoService]    ⚠️  MANUAL ACTION REQUIRED: Link invoice ${invoiceId} to booking ${bookingId}`);
          
          // Log critical error
          await supabase
            .from('zoho_invoice_logs')
            .insert({
              booking_id: bookingId,
              tenant_id: booking.tenant_id,
              zoho_invoice_id: invoiceId,
              status: 'partial_success', // Invoice created but not linked
              request_payload: JSON.stringify(invoiceData),
              response_payload: JSON.stringify({ 
                invoice_id: invoiceId,
                invoice_number: invoiceNumber,
                status: invoiceStatus,
                db_error: updateError?.message 
              }),
            });
          
          return {
            invoiceId: invoiceId, // Return invoice ID even though DB update failed
            success: false,
            error: errorMsg
          };
        }

        if (updatedBooking.zoho_invoice_id !== invoiceId) {
          const errorMsg = `Invoice ID mismatch: expected ${invoiceId}, got ${updatedBooking.zoho_invoice_id}`;
          console.error(`[ZohoService] ❌ Step 2 FAILED: ${errorMsg}`);
          return {
            invoiceId: invoiceId,
            success: false,
            error: errorMsg
          };
        }

        console.log(`[ZohoService] ✅ Step 2 Complete: Invoice data saved to database`);
        console.log(`[ZohoService]    Booking ID: ${updatedBooking.id}`);
        console.log(`[ZohoService]    Invoice ID: ${updatedBooking.zoho_invoice_id}`);
        console.log(`[ZohoService]    Invoice Number: ${invoiceNumber || 'N/A'}`);
        console.log(`[ZohoService]    Invoice URL: ${invoiceUrl}`);
        console.log(`[ZohoService]    Invoice Status: ${invoiceStatus}`);
        console.log(`[ZohoService]    Invoice Created At: ${updatedBooking.zoho_invoice_created_at}`);

        // ============================================================================
        // STEP 3: Log Success to zoho_invoice_logs
        // ============================================================================
        await supabase
          .from('zoho_invoice_logs')
          .insert({
            booking_id: bookingId,
            tenant_id: booking.tenant_id,
            zoho_invoice_id: invoiceId,
            status: 'success',
            request_payload: JSON.stringify(invoiceData),
            response_payload: JSON.stringify({
              invoice_id: invoiceId,
              invoice_number: invoiceNumber,
              status: invoiceStatus,
              invoice_url: invoiceUrl,
              ...invoiceResponse
            }),
          });
        console.log(`[ZohoService] ✅ Step 3 Complete: Invoice creation logged to zoho_invoice_logs`);
      }

      // ============================================================================
      // STEP 4: Verify Invoice Exists in Zoho (Post-Creation Verification)
      // ============================================================================
      console.log(`[ZohoService] 🔍 Step 4: Verifying invoice exists in Zoho...`);
      try {
        const verificationResult = await this.getInvoice(booking.tenant_id, invoiceId);
        if (verificationResult.invoice) {
          console.log(`[ZohoService] ✅ Step 4 Complete: Invoice verified in Zoho`);
          console.log(`[ZohoService]    Invoice Number: ${verificationResult.invoice.invoice_number || 'N/A'}`);
          console.log(`[ZohoService]    Invoice Status: ${verificationResult.invoice.status || 'N/A'}`);
          console.log(`[ZohoService]    Invoice Amount: ${verificationResult.invoice.total || 'N/A'}`);
          console.log(`[ZohoService]    Invoice Currency: ${verificationResult.invoice.currency_code || 'N/A'}`);
        } else {
          console.warn(`[ZohoService] ⚠️ Step 4: Invoice verification failed: ${verificationResult.error || 'Unknown error'}`);
          console.warn(`[ZohoService]    Invoice may still be processing in Zoho. This is non-critical.`);
        }
      } catch (verifyError: any) {
        console.warn(`[ZohoService] ⚠️ Step 4: Invoice verification error (non-critical): ${verifyError.message}`);
      }
      
      console.log(`[ZohoService] ✅ Invoice ${invoiceId} saved successfully`);
      console.log(`[ZohoService] ⚠️  Email/WhatsApp errors will NOT affect invoice save from this point`);

      // CRITICAL: Invoice MUST NOT be sent (Email or WhatsApp) if booking payment status is not PAID.
      // Only send when booking is already marked paid (e.g. after mark-paid or payment-status update).
      const bookingPaymentStatus = (booking as any).payment_status;
      const maySendInvoice = bookingPaymentStatus === 'paid' || bookingPaymentStatus === 'paid_manual';
      if (!maySendInvoice) {
        console.log(`[ZohoService] ⏭️ Skipping invoice delivery: booking payment_status is "${bookingPaymentStatus || 'unknown'}" (only send when paid/paid_manual)`);
      }

      // Send invoice via email (if email is provided) — ONLY when booking is paid
      // Note: Errors here won't affect invoice save since it's already persisted
      if (maySendInvoice) {
      // Ensure invoice is marked Paid in Zoho before sending (Zoho only allows email/WhatsApp when invoice is Paid)
      const totalAmount = Number((booking as any).total_price) || 0;
      if (totalAmount > 0) {
        try {
          const payMode = (booking as any).payment_method === 'transfer' ? 'banktransfer' : 'cash';
          const payRef = ((booking as any).transaction_reference || 'Paid On Site').toString().trim() || (payMode === 'cash' ? 'Paid On Site' : '');
          const paidResult = await this.ensurePackageInvoicePaid(booking.tenant_id, invoiceId, totalAmount, payMode, payRef);
          if (paidResult.success) {
            console.log(`[ZohoService] ✅ Invoice ${invoiceId} marked paid in Zoho — proceeding with email/WhatsApp`);
          } else if (paidResult.error) {
            console.warn(`[ZohoService] ⚠️ Could not mark invoice paid in Zoho: ${paidResult.error} — email/WhatsApp may fail`);
          }
        } catch (ensureErr: any) {
          console.warn(`[ZohoService] ⚠️ Ensure invoice paid failed: ${ensureErr?.message} — email/WhatsApp may fail`);
        }
      }
      console.log(`[ZohoService] ========================================`);
      console.log(`[ZohoService] EMAIL DELIVERY PROCESS STARTING`);
      console.log(`[ZohoService] ========================================`);
      console.log(`[ZohoService] 🔍 Email extraction debug:`);
      console.log(`   booking.customer_email (raw): ${booking.customer_email || 'NULL'}`);
      console.log(`   booking.customer_email (type): ${typeof booking.customer_email}`);
      console.log(`   invoiceData.customer_email (raw): ${invoiceData.customer_email || 'NULL'}`);
      console.log(`   invoiceData.customer_email (type): ${typeof invoiceData.customer_email}`);
      
      // Get email from multiple sources to ensure we don't miss it
      let emailToSend: string | null = null;
      
      // Priority 1: Direct from booking (most reliable)
      if (booking.customer_email && typeof booking.customer_email === 'string') {
        const trimmed = booking.customer_email.trim();
        if (trimmed.length > 0) {
          emailToSend = trimmed;
          console.log(`[ZohoService] ✅ Email found in booking: "${emailToSend}"`);
        }
      }
      
      // Priority 2: From invoiceData (fallback)
      if (!emailToSend && invoiceData.customer_email && typeof invoiceData.customer_email === 'string') {
        const trimmed = invoiceData.customer_email.trim();
        if (trimmed.length > 0) {
          emailToSend = trimmed;
          console.log(`[ZohoService] ✅ Email found in invoiceData: "${emailToSend}"`);
        }
      }
      
      console.log(`[ZohoService] 📧 Final email to send: ${emailToSend || 'NOT FOUND'}`);
      
      if (emailToSend && emailToSend.length > 0) {
        // Validate email format
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        const isValidFormat = emailRegex.test(emailToSend);
        
        console.log(`[ZohoService] 🔍 Email validation:`);
        console.log(`   Email: "${emailToSend}"`);
        console.log(`   Length: ${emailToSend.length}`);
        console.log(`   Valid format: ${isValidFormat ? '✅ YES' : '❌ NO'}`);
        
        if (!isValidFormat) {
          console.error(`[ZohoService] ❌ Invalid email format: "${emailToSend}" - skipping email delivery`);
        } else {
          console.log(`[ZohoService] 📧 Attempting to send invoice via email to ${emailToSend}...`);
          console.log(`[ZohoService]    Invoice ID: ${invoiceId}`);
          console.log(`[ZohoService]    Tenant ID: ${booking.tenant_id}`);
          
          try {
            await this.sendInvoiceEmail(booking.tenant_id, invoiceId, emailToSend);
            console.log(`[ZohoService] ✅ Invoice sent via email to ${emailToSend}`);
            
            // Log successful email delivery
            try {
              await supabase
                .from('zoho_invoice_logs')
                .insert({
                  booking_id: bookingId,
                  tenant_id: booking.tenant_id,
                  zoho_invoice_id: invoiceId,
                  status: 'email_sent',
                  request_payload: JSON.stringify({ email: emailToSend, delivery_method: 'email', invoice_id: invoiceId }),
                  response_payload: JSON.stringify({ success: true, sent_at: new Date().toISOString() }),
                });
              console.log(`[ZohoService] ✅ Email delivery logged to database`);
            } catch (logError: any) {
              console.error(`[ZohoService] ⚠️  Failed to log email delivery: ${logError.message}`);
            }
          } catch (emailError: any) {
            console.error(`[ZohoService] ❌ Failed to send invoice email: ${emailError.message}`);
            console.error(`[ZohoService]    Error type: ${emailError.constructor.name}`);
            console.error(`[ZohoService]    Error details:`, emailError.response?.data || emailError.stack);
            
            // Log email failure
            try {
              await supabase
                .from('zoho_invoice_logs')
                .insert({
                  booking_id: bookingId,
                  tenant_id: booking.tenant_id,
                  zoho_invoice_id: invoiceId,
                  status: 'email_failed',
                  error_message: emailError.message,
                  request_payload: JSON.stringify({
                    email: emailToSend,
                    delivery_method: 'email',
                    invoice_id: invoiceId,
                    error_type: emailError.constructor.name,
                    error_data: emailError.response?.data || null
                  }),
                });
              console.log(`[ZohoService] ✅ Email failure logged to database`);
            } catch (logError: any) {
              console.error(`[ZohoService] ⚠️  Failed to log email failure: ${logError.message}`);
            }
            
            // Continue - invoice is created even if email fails
            // But we log it clearly for debugging
          }
        }
      } else {
        console.log(`[ZohoService] ⚠️ No customer email provided, skipping email delivery`);
        console.log(`[ZohoService]    This means invoice was created but NOT sent via email!`);
        console.log(`[ZohoService]    Customer will only receive invoice via WhatsApp (if phone provided)`);
        console.log(`[ZohoService]    Debug info:`);
        console.log(`      booking.customer_email: ${booking.customer_email || 'NULL'}`);
        console.log(`      invoiceData.customer_email: ${invoiceData.customer_email || 'NULL'}`);
      }
      
      console.log(`[ZohoService] ========================================`);
      console.log(`[ZohoService] EMAIL DELIVERY PROCESS COMPLETE`);
      console.log(`[ZohoService] ========================================`);

      // Step 2 & 3: Download Invoice PDF and Send via WhatsApp (if phone is provided)
      // This follows the exact path: Download PDF → Send via WhatsApp
      console.log(`[ZohoService] 🔍 WhatsApp delivery check: customer_phone = ${invoiceData.customer_phone ? `"${invoiceData.customer_phone}"` : 'falsy'}`);
      if (invoiceData.customer_phone) {
        console.log(`[ZohoService] 📱 Step 2-3: Downloading invoice PDF and sending via WhatsApp to ${invoiceData.customer_phone}...`);
        try {
          await this.sendInvoiceViaWhatsApp(booking.tenant_id, invoiceId, invoiceData.customer_phone);
          console.log(`[ZohoService] ✅ Step 2-3 Complete: Invoice PDF sent via WhatsApp to ${invoiceData.customer_phone}`);
        } catch (whatsappError: any) {
          console.error(`[ZohoService] ❌ Step 2-3 Failed: ${whatsappError.message}`);
          console.error(`[ZohoService]    Error details:`, whatsappError.response?.data || whatsappError.stack);
          // Continue - invoice is created even if WhatsApp fails
        }
      } else {
        console.log(`[ZohoService] ⚠️ No customer phone provided, skipping WhatsApp delivery`);
        console.log(`[ZohoService]    Phone value: ${invoiceData.customer_phone}`);
        console.log(`[ZohoService]    Type: ${typeof invoiceData.customer_phone}`);
        console.log(`[ZohoService]    This means invoice was created but NOT sent to customer!`);
      }
      } // end if (maySendInvoice)

      // ============================================================================
      // STEP 5: Final Verification & Validation
      // ============================================================================
      console.log(`[ZohoService] 🔍 Step 5: Final verification of invoice linking...`);
      try {
        const { data: verifyBooking, error: verifyError } = await supabase
          .from('bookings')
          .select('zoho_invoice_id, zoho_invoice_created_at, customer_name, total_price')
          .eq('id', bookingId)
          .maybeSingle();

        if (!verifyError && verifyBooking && verifyBooking.zoho_invoice_id === invoiceId) {
          console.log(`[ZohoService] ✅ Step 5 Complete: Invoice linking verified`);
          console.log(`[ZohoService]    Booking ID: ${verifyBooking.id}`);
          console.log(`[ZohoService]    Invoice ID: ${verifyBooking.zoho_invoice_id}`);
          console.log(`[ZohoService]    Invoice Created At: ${verifyBooking.zoho_invoice_created_at}`);
          console.log(`[ZohoService]    Customer: ${verifyBooking.customer_name}`);
          console.log(`[ZohoService]    Amount: ${verifyBooking.total_price}`);
        } else {
          console.error(`[ZohoService] ❌ Step 5 FAILED: Invoice ${invoiceId} not found in database!`);
          console.error(`[ZohoService]    Error: ${verifyError?.message || 'Booking not found'}`);
          console.error(`[ZohoService]    Found: ${JSON.stringify(verifyBooking || {})}`);
        }
      } catch (verifyError: any) {
        console.error(`[ZohoService] ⚠️ Step 5: Verification error: ${verifyError.message}`);
      }

      console.log(`[ZohoService] ========================================`);
      console.log(`[ZohoService] ✅ RECEIPT GENERATION COMPLETE`);
      console.log(`[ZohoService] ========================================`);
      console.log(`[ZohoService]    Booking ID: ${bookingId}`);
      console.log(`[ZohoService]    Invoice ID: ${invoiceId}`);
      console.log(`[ZohoService]    Status: SUCCESS`);
      console.log(`[ZohoService] ========================================`);
      
      // Final verification: Ensure invoice ID is valid before returning success
      if (!invoiceId || invoiceId.trim().length === 0) {
        const errorMsg = 'Invoice creation completed but invoice_id is empty or invalid';
        console.error(`[ZohoService] ❌ ${errorMsg}`);
        return {
          invoiceId: '',
          success: false,
          error: errorMsg
        };
      }
      
      return { invoiceId, success: true };
    } catch (error: any) {
      // ============================================================================
      // ERROR HANDLING: Log failure and return structured error
      // ============================================================================
      console.error(`[ZohoService] ========================================`);
      console.error(`[ZohoService] ❌ CRITICAL ERROR: Failed to generate receipt for booking ${bookingId}`);
      console.error(`[ZohoService] ========================================`);
      console.error(`[ZohoService]    Error: ${error.message}`);
      console.error(`[ZohoService]    Error Type: ${error.constructor.name}`);
      console.error(`[ZohoService]    Error Code: ${error.code || 'N/A'}`);
      console.error(`[ZohoService]    Stack: ${error.stack}`);
      console.error(`[ZohoService] ========================================`);
      
      // Log failure to zoho_invoice_logs
      try {
        const { data: bookingCheck, error: checkError } = await supabase
          .from('bookings')
          .select('tenant_id, zoho_invoice_id')
          .eq('id', bookingId)
          .maybeSingle();

        if (!checkError && bookingCheck) {
          await supabase
            .from('zoho_invoice_logs')
            .insert({
              booking_id: bookingId,
              tenant_id: bookingCheck.tenant_id,
              zoho_invoice_id: bookingCheck.zoho_invoice_id || null,
              status: 'failed',
              error_message: error.message,
              request_payload: JSON.stringify({ 
                bookingId,
                error_type: error.constructor.name,
                error_stack: error.stack 
              }),
              response_payload: JSON.stringify({ 
                error: error.message,
                timestamp: new Date().toISOString()
              }),
            });
          console.log(`[ZohoService] ✅ Error logged to zoho_invoice_logs`);
        }
      } catch (logError: any) {
        console.error(`[ZohoService] ⚠️ Failed to log error: ${logError.message}`);
      }

      // Return structured error response
      const errorMessage = error.message || 'Unknown error during invoice generation';
      return { 
        invoiceId: '', 
        success: false, 
        error: errorMessage 
      };
    }
  }

  /**
   * Update invoice status in Zoho based on booking payment status
   * Maps internal payment statuses to Zoho invoice statuses
   */
  /**
   * Check if stored token has UPDATE scope
   */
  private async checkStoredTokenHasUpdateScope(tenantId: string): Promise<{ hasUpdate: boolean; scopes?: string }> {
    try {
      const { data: tokens } = await supabase
        .from('zoho_tokens')
        .select('granted_scopes')
        .eq('tenant_id', tenantId)
        .single();

      if (!tokens?.granted_scopes) {
        // Old token without scopes stored - assume it might not have UPDATE
        return { hasUpdate: false };
      }

      const scopes = tokens.granted_scopes;
      const hasUpdate = scopes.includes('ZohoInvoice.invoices.UPDATE') || scopes.includes('invoices.UPDATE');
      return { hasUpdate, scopes };
    } catch (error) {
      // If check fails, assume we need to verify via API
      return { hasUpdate: true }; // Optimistic - let API error tell us
    }
  }

  async updateInvoiceStatus(tenantId: string, invoiceId: string, paymentStatus: string): Promise<{ success: boolean; error?: string; hint?: string }> {
    // Check if stored token has UPDATE scope before attempting
    const scopeCheck = await this.checkStoredTokenHasUpdateScope(tenantId);
    if (!scopeCheck.hasUpdate && scopeCheck.scopes) {
      console.warn(`[ZohoService] ⚠️  Stored token does not have UPDATE scope. Scopes: ${scopeCheck.scopes}`);
      return {
        success: false,
        error: 'Token does not have UPDATE permissions',
        hint: `The stored Zoho token was obtained without UPDATE scope. Please disconnect and reconnect to Zoho in Settings to get a new token with UPDATE permissions. Current scopes: ${scopeCheck.scopes}`
      };
    }

    const accessToken = await this.getAccessToken(tenantId);
    const apiBaseUrl = await this.getApiBaseUrlForTenant(tenantId);

    // Map internal payment status to Zoho invoice status (must match database enum)
    const statusMap: Record<string, string> = {
      'paid': 'paid',
      'paid_manual': 'paid',
      'unpaid': 'sent', // Keep as 'sent' (not draft) so it can be paid
      'awaiting_payment': 'sent',
      'refunded': 'void', // Zoho uses 'void' for refunded invoices
    };

    const zohoStatus = statusMap[paymentStatus] || 'sent';
    
    console.log(`[ZohoService] Updating invoice ${invoiceId} status: ${paymentStatus} → ${zohoStatus}`);

    try {
      // Method 1: Try PUT update
      try {
        const updateResponse = await axios.put(
          `${apiBaseUrl}/invoices/${invoiceId}`,
          {
            status: zohoStatus,
            invoice_status: zohoStatus,
          },
          {
            headers: {
              'Authorization': `Zoho-oauthtoken ${accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        );

        const updateData = updateResponse.data as any;
        if (updateData.code === 0 || updateData.invoice) {
          console.log(`[ZohoService] ✅ Invoice ${invoiceId} status updated to '${zohoStatus}'`);
          return { success: true };
        }
      } catch (putError: any) {
        // If PUT doesn't work, try specific endpoints
        if (zohoStatus === 'paid') {
          // Try mark-as-paid endpoint
          try {
            const markPaidResponse = await axios.post(
              `${apiBaseUrl}/invoices/${invoiceId}/mark-as-paid`,
              {},
              {
                headers: {
                  'Authorization': `Zoho-oauthtoken ${accessToken}`,
                  'Content-Type': 'application/json',
                },
              }
            );
            const markData = markPaidResponse.data as any;
            if (markData.code === 0 || markData.invoice) {
              console.log(`[ZohoService] ✅ Invoice ${invoiceId} marked as paid`);
              return { success: true };
            }
          } catch (markError: any) {
            console.warn(`[ZohoService] ⚠️  Mark-as-paid failed: ${markError.message}`);
          }
        } else if (zohoStatus === 'void') {
          // Try void endpoint
          try {
            const voidResponse = await axios.post(
              `${apiBaseUrl}/invoices/${invoiceId}/void`,
              {},
              {
                headers: {
                  'Authorization': `Zoho-oauthtoken ${accessToken}`,
                  'Content-Type': 'application/json',
                },
              }
            );
            const voidData = voidResponse.data as any;
            if (voidData.code === 0 || voidData.invoice) {
              console.log(`[ZohoService] ✅ Invoice ${invoiceId} voided`);
              return { success: true };
            }
          } catch (voidError: any) {
            console.warn(`[ZohoService] ⚠️  Void failed: ${voidError.message}`);
          }
        }

        // If all methods fail, log but don't throw
        const errorData = putError.response?.data as any;
        const errorMessage = errorData?.message || putError.message;
        const isAuthorizationError = 
          putError.response?.status === 401 || 
          putError.response?.status === 403 ||
          errorMessage?.toLowerCase().includes('not authorized') ||
          errorMessage?.toLowerCase().includes('unauthorized');
        
        console.error(`[ZohoService] ⚠️  Failed to update invoice status:`, {
          status: putError.response?.status,
          code: errorData?.code,
          message: errorMessage,
          isAuthorizationError,
        });
        
        // Provide helpful error message for authorization issues
        let helpfulError = `Zoho API error: ${errorMessage}`;
        let hint: string | undefined;
        
        if (isAuthorizationError) {
          helpfulError += '. The Zoho access token does not have UPDATE permissions.';
          
          // Check stored scopes to provide specific guidance
          const scopeCheck = await this.checkStoredTokenHasUpdateScope(tenantId);
          if (!scopeCheck.hasUpdate && scopeCheck.scopes) {
            hint = `The stored Zoho token was obtained without UPDATE scope. Current scopes: ${scopeCheck.scopes}

To fix this:
1. Go to Settings → Zoho Invoice Integration
2. Click "Disconnect" to clear the old token (this removes the token without UPDATE)
3. Click "Connect to Zoho" again
4. Authorize with all permissions (you should see 5 scopes including "Scope to update invoice details")
5. The new token will have UPDATE permissions and payment status sync will work

Note: The booking payment status was updated successfully in the database. Only the Zoho invoice sync failed due to missing permissions.`;
          } else {
            hint = `The Zoho access token was obtained without UPDATE scope. To fix this:
1. Go to Settings → Zoho Invoice Integration
2. Click "Disconnect" to clear the old token
3. Click "Connect to Zoho" again
4. Authorize with all permissions (including UPDATE)
5. The new token will have UPDATE permissions and payment status sync will work

Note: The booking payment status was updated successfully in the database. Only the Zoho invoice sync failed due to missing permissions.`;
          }
        }
        
        // Return success=false but don't throw - booking update should still succeed
        return { 
          success: false, 
          error: helpfulError,
          hint
        };
      }

      return { success: true };
    } catch (error: any) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        const errorData = axiosError.response.data as any;
        console.error(`[ZohoService] Failed to update invoice status:`, {
          status: axiosError.response.status,
          code: errorData?.code,
          message: errorData?.message || errorData?.error,
        });
        return { 
          success: false, 
          error: `Zoho API error: ${errorData?.message || JSON.stringify(errorData)}` 
        };
      }
      return { 
        success: false, 
        error: error.message || 'Unknown error updating invoice status' 
      };
    }
  }

  /**
   * @deprecated Do NOT update invoice status directly. Use recordCustomerPayment instead.
   * Zoho marks invoice as Paid only when a customer payment is recorded (POST /customerpayments).
   */
  async tryMarkInvoicePaid(_tenantId: string, _invoiceId: string): Promise<boolean> {
    console.warn('[ZohoService] tryMarkInvoicePaid is deprecated; use recordCustomerPayment to record payment.');
    return false;
  }

  /**
   * Ensure a package subscription invoice is marked as PAID in Zoho so email/WhatsApp can be sent.
   * Correct way: record a customer payment via POST /customerpayments (not mark-as-paid).
   * Use this when the subscription was created as paid (onsite/transfer).
   */
  async ensurePackageInvoicePaid(
    tenantId: string,
    invoiceId: string,
    amount: number,
    paymentMode: 'cash' | 'banktransfer',
    referenceNumber: string
  ): Promise<{ success: boolean; error?: string }> {
    const status = await this.getInvoicePaymentStatus(tenantId, invoiceId);
    if (status.isPaid) {
      return { success: true };
    }
    const record = await this.recordCustomerPayment(tenantId, invoiceId, amount, paymentMode, referenceNumber);
    if (!record.success) {
      return { success: false, error: record.error };
    }
    const after = await this.getInvoicePaymentStatus(tenantId, invoiceId);
    if (after.isPaid) {
      console.log(`[ZohoService] ✅ Invoice ${invoiceId} marked as paid via customer payment`);
      return { success: true };
    }
    return { success: true };
  }

  /**
   * Record a customer payment in Zoho so the invoice is marked as PAID.
   * Zoho marks invoice as paid only when a PAYMENT is recorded (not by updating status).
   * paymentMode: 'cash' = Paid On Site, 'banktransfer' = Bank Transfer.
   * Organization ID is MANDATORY — stored in Settings or fetched on OAuth completion.
   */
  async recordCustomerPayment(
    tenantId: string,
    invoiceId: string,
    amount: number,
    paymentMode: 'cash' | 'banktransfer',
    referenceNumber: string,
    date?: string
  ): Promise<{ success: boolean; paymentId?: string; error?: string }> {
    const orgId = await this.getZohoOrganizationId(tenantId);
    if (!orgId) {
      const msg = 'No organization id. Add Zoho Organization ID in Settings (Zoho Invoice → Settings → Organization Profile), or reconnect Zoho so it can be saved automatically.';
      console.warn('[ZohoService]', msg);
      return { success: false, error: msg };
    }

    const accessToken = await this.getAccessToken(tenantId);
    const apiBaseUrl = this.normalizeApiBaseUrl(await this.getApiBaseUrlForTenant(tenantId));
    const paymentDate = date || new Date().toISOString().slice(0, 10);

    const { invoice, error: invError } = await this.getInvoice(tenantId, invoiceId);
    if (invError || !invoice) {
      return { success: false, error: invError || 'Invoice not found' };
    }
    const customerId = invoice.customer_id;
    if (!customerId) {
      return { success: false, error: 'Invoice has no customer_id' };
    }

    // Zoho Invoice API expects payment_mode: "Cash" or "Bank Transfer"
    const zohoPaymentMode = paymentMode === 'banktransfer' ? 'Bank Transfer' : 'Cash';
    const payload: Record<string, unknown> = {
      customer_id: customerId,
      payment_mode: zohoPaymentMode,
      amount: Number(amount),
      date: paymentDate,
      invoices: [{ invoice_id: invoiceId, amount_applied: Number(amount) }],
    };
    const ref = referenceNumber?.trim() || (paymentMode === 'cash' ? 'Paid On Site' : undefined);
    if (ref) payload.reference_number = ref;

    const customerPaymentsUrl = `${apiBaseUrl}/customerpayments?organization_id=${encodeURIComponent(orgId)}`;
    const headers: Record<string, string> = {
      Authorization: `Zoho-oauthtoken ${accessToken}`,
      'Content-Type': 'application/json',
    };

    try {
      const res = await axios.post(customerPaymentsUrl, payload, { headers });
      const data = res.data as any;
      if (data.code === 0 && data.payment?.payment_id) {
        console.log(`[ZohoService] ✅ Customer payment recorded: ${data.payment.payment_id}`);
        return { success: true, paymentId: data.payment.payment_id };
      }
      return { success: false, error: data.message || 'Unknown Zoho response' };
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message;
      console.error('[ZohoService] recordCustomerPayment failed:', msg);
      const isUnauthorized = err.response?.status === 401 || (msg && String(msg).toLowerCase().includes('not authorized'));
      if (isUnauthorized) {
        console.error('[ZohoService] ⚠️  Recording payments requires Zoho scope ZohoInvoice.fullaccess.all. Disconnect and reconnect Zoho in Settings so the new token has this scope.');
      }
      const hint = isUnauthorized
        ? ' Reconnect Zoho in Settings with scope ZohoInvoice.fullaccess.all (Disconnect then Connect again) so recording payments works.'
        : '';
      return { success: false, error: msg + hint };
    }
  }

  /**
   * Fetch latest invoice payment status from Zoho and return whether it is fully paid.
   * Required before sending invoice via WhatsApp or Email (critical business rule).
   * Zoho invoice status: sent, draft, overdue, paid, void, unpaid, partially_paid, viewed.
   * Balance = unpaid amount; when paid, balance is 0 and status is "paid".
   */
  async getInvoicePaymentStatus(tenantId: string, invoiceId: string): Promise<{
    isPaid: boolean;
    status?: string;
    balance?: number;
    error?: string;
  }> {
    const result = await this.getInvoice(tenantId, invoiceId);
    if (result.error) {
      return { isPaid: false, error: result.error };
    }
    const inv = result.invoice;
    if (!inv) {
      return { isPaid: false, error: 'Invoice not found' };
    }
    const status = (inv.status || '').toLowerCase();
    const balanceRaw = inv.balance;
    const balance = balanceRaw !== undefined && balanceRaw !== null && balanceRaw !== ''
      ? Number(balanceRaw)
      : undefined;
    const isPaid = status === 'paid' || (balance !== undefined && Number.isFinite(balance) && balance <= 0);
    return { isPaid: !!isPaid, status: inv.status, balance };
  }

  /**
   * Get invoice details from Zoho.
   * Uses organization_id when available so API calls succeed (required in some regions).
   */
  async getInvoice(tenantId: string, invoiceId: string): Promise<{ invoice?: any; error?: string }> {
    const accessToken = await this.getAccessToken(tenantId);
    const apiBaseUrl = this.normalizeApiBaseUrl(await this.getApiBaseUrlForTenant(tenantId));
    const orgId = await this.getZohoOrganizationId(tenantId);
    const url = orgId
      ? `${apiBaseUrl}/invoices/${invoiceId}?organization_id=${encodeURIComponent(orgId)}`
      : `${apiBaseUrl}/invoices/${invoiceId}`;

    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Zoho-oauthtoken ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      const responseData = response.data as any;
      if (responseData.invoice) {
        return { invoice: responseData.invoice };
      }
      
      return { error: 'Invoice not found in Zoho response' };
    } catch (error: any) {
      const axiosError = error as AxiosError;
      if (axiosError.response) {
        const errorData = axiosError.response.data as any;
        if (axiosError.response.status === 404) {
          return { error: 'Invoice not found in Zoho' };
        }
        return { error: `Zoho API error: ${errorData?.message || JSON.stringify(errorData)}` };
      }
      return { error: error.message || 'Unknown error fetching invoice' };
    }
  }

  /**
   * Update invoice amount (for price changes after booking time edit)
   */
  async updateInvoiceAmount(
    invoiceId: string,
    newAmount: number
  ): Promise<{ success: boolean; error?: string; invoiceId?: string }> {
    try {
      const tenantId = await this.getTenantIdFromInvoice(invoiceId);
      if (!tenantId) {
        throw new Error(`Could not find tenant for invoice ${invoiceId}`);
      }

      const accessToken = await this.getAccessToken(tenantId);
      if (!accessToken) {
        throw new Error(`No Zoho access token found for tenant ${tenantId}`);
      }

      const apiBaseUrl = await this.getApiBaseUrlForTenant(tenantId);
      console.log(`[ZohoService] Updating invoice ${invoiceId} amount to ${newAmount}`);

      // Get current invoice to preserve line items structure
      const getResponse = await axios.get(
        `${apiBaseUrl}/invoices/${invoiceId}`,
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const invoiceData = getResponse.data as any;
      if (!invoiceData.invoice) {
        throw new Error(`Invoice ${invoiceId} not found in Zoho`);
      }

      const currentInvoice = invoiceData.invoice;
      const currentTotal = parseFloat(currentInvoice.total) || 0;
      const difference = newAmount - currentTotal;

      // If amount hasn't changed, no-op
      if (Math.abs(difference) < 0.01) {
        console.log(`[ZohoService] Invoice amount unchanged: ${currentTotal}`);
        return { success: true, invoiceId };
      }

      // Update line items to match new total
      // Calculate adjustment factor
      const adjustmentFactor = currentTotal > 0 ? newAmount / currentTotal : 1;
      
      const updatedLineItems = currentInvoice.line_items.map((item: any) => ({
        line_item_id: item.line_item_id,
        name: item.name,
        description: item.description || '',
        rate: parseFloat(item.rate) * adjustmentFactor,
        quantity: parseFloat(item.quantity) || 1,
        unit: item.unit || 'ticket',
      }));

      // Update invoice with new line items
      const updateResponse = await axios.put(
        `${apiBaseUrl}/invoices/${invoiceId}`,
        {
          line_items: updatedLineItems,
          notes: currentInvoice.notes 
            ? `${currentInvoice.notes}\n[Updated: Amount adjusted to ${newAmount} due to booking time change]`
            : `[Updated: Amount adjusted to ${newAmount} due to booking time change]`,
        },
        {
          headers: {
            'Authorization': `Zoho-oauthtoken ${accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const updateData = updateResponse.data as any;
      if (updateData.code === 0 || updateData.invoice) {
        console.log(`[ZohoService] ✅ Invoice ${invoiceId} amount updated to ${newAmount}`);
        return { success: true, invoiceId };
      } else {
        throw new Error(`Failed to update invoice: ${updateData.message || 'Unknown error'}`);
      }
    } catch (error: any) {
      console.error(`[ZohoService] ❌ Error updating invoice amount:`, error.message);
      return { 
        success: false, 
        error: error.message || 'Failed to update invoice amount',
        invoiceId 
      };
    }
  }

  /**
   * Get tenant ID from invoice ID (helper for updateInvoiceAmount)
   */
  private async getTenantIdFromInvoice(invoiceId: string): Promise<string | null> {
    try {
      const { data, error } = await supabase
        .from('bookings')
        .select('tenant_id')
        .eq('zoho_invoice_id', invoiceId)
        .limit(1)
        .single();

      if (error || !data) {
        return null;
      }

      return data.tenant_id;
    } catch (error) {
      return null;
    }
  }
}

export const zohoService = new ZohoService();

