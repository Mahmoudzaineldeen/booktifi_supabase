import express from 'express';
import { supabase } from '../db';
import { zohoService } from '../services/zohoService';
import { zohoCredentials } from '../config/zohoCredentials';
import axios from 'axios';

const router = express.Router();

/**
 * GET /api/zoho/auth
 * Initiate OAuth flow - redirect to Zoho authorization page
 * Uses tenant-specific credentials if available, falls back to global
 */
router.get('/auth', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    // HYBRID APPROACH: Dynamic redirect URI detection
    // Priority 1: Frontend-provided origin (most reliable)
    let origin: string | undefined = req.query.origin as string | undefined;
    let originSource = 'Unknown';
    
    // Debug: Log all available information
    console.log(`[Zoho Routes] ========================================`);
    console.log(`[Zoho Routes] DEBUG: Origin Detection`);
    console.log(`[Zoho Routes] Query params:`, req.query);
    console.log(`[Zoho Routes] Origin from query:`, req.query.origin);
    console.log(`[Zoho Routes] Origin header:`, req.headers.origin);
    console.log(`[Zoho Routes] Referer header:`, req.headers.referer);
    console.log(`[Zoho Routes] Host header:`, req.headers.host);
    console.log(`[Zoho Routes] ========================================`);
    
    // Priority 2: Request headers (Origin or Referer)
    if (!origin) {
      origin = req.headers.origin as string | undefined;
      if (origin) {
        originSource = 'Origin Header';
      } else if (req.headers.referer) {
        // If no Origin header, try to extract from Referer
        try {
          const refererUrl = new URL(req.headers.referer);
          origin = `${refererUrl.protocol}//${refererUrl.host}`;
          originSource = 'Referer Header';
        } catch (e) {
          // Invalid referer URL, ignore
        }
      }
    } else {
      originSource = 'Frontend';
    }
    
    // Priority 3: Environment variable
    if (!origin) {
      origin = process.env.APP_URL;
      if (origin) {
        originSource = 'Environment Variable (APP_URL)';
      }
    }
    
    // Priority 4: Construct from Host header (for same-origin requests)
    if (!origin) {
      const host = req.headers.host;
      const protocol = req.secure || req.headers['x-forwarded-proto'] === 'https' ? 'https' : 'http';
      if (host) {
        origin = `${protocol}://${host}`;
        originSource = 'Host Header';
      }
    }
    
    // Final fallback: Use APP_URL from environment or construct from Railway
    if (!origin) {
      if (!process.env.APP_URL) {
        throw new Error('APP_URL environment variable is required for Zoho OAuth');
      }
      origin = process.env.APP_URL;
      originSource = 'Environment (APP_URL)';
    }
    
    // Construct redirect URI from detected origin
    const redirectUri = `${origin}/api/zoho/callback`;
    
    // Log the redirect URI being used for debugging
    console.log(`[Zoho Routes] ========================================`);
    console.log(`[Zoho Routes] INITIATING OAUTH FLOW`);
    console.log(`[Zoho Routes] Tenant ID: ${tenantId}`);
    console.log(`[Zoho Routes] Detected Origin: ${origin}`);
    console.log(`[Zoho Routes] Origin Source: ${originSource}`);
    console.log(`[Zoho Routes] Using Redirect URI: ${redirectUri}`);
    console.log(`[Zoho Routes] ⚠️  Make sure this EXACT URI is configured in Zoho Developer Console`);
    console.log(`[Zoho Routes] ========================================`);

    // Load tenant-specific credentials (or fall back to global)
    const clientId = await zohoCredentials.getClientIdForTenant(tenantId);
    const scope = (await zohoCredentials.getScopeForTenant(tenantId)).join(',');

    // Store tenant_id and redirect_uri in state parameter for callback verification
    const state = Buffer.from(JSON.stringify({ 
      tenant_id: tenantId,
      redirect_uri: redirectUri // Store for verification in callback
    })).toString('base64');

    // Determine Zoho accounts URL based on region (if tenant has custom region)
    let accountsUrl = 'https://accounts.zoho.com/oauth/v2/auth';
    try {
      const { data: configResult, error } = await supabase
        .from('tenant_zoho_configs')
        .select('region')
        .eq('tenant_id', tenantId)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (!error && configResult?.region) {
        const region = configResult.region;
        if (region === 'eu') {
          accountsUrl = 'https://accounts.zoho.eu/oauth/v2/auth';
        } else if (region === 'in') {
          accountsUrl = 'https://accounts.zoho.in/oauth/v2/auth';
        } else if (region === 'au') {
          accountsUrl = 'https://accounts.zoho.com.au/oauth/v2/auth';
        } else if (region === 'jp') {
          accountsUrl = 'https://accounts.zoho.jp/oauth/v2/auth';
        }
      }
    } catch (error) {
      // If query fails, use default
      console.warn('[Zoho Routes] Could not determine region, using default');
    }

    const authUrl = `${accountsUrl}?` +
      `scope=${encodeURIComponent(scope)}&` +
      `client_id=${clientId}&` +
      `response_type=code&` +
      `access_type=offline&` +
      `prompt=consent&` +
      `redirect_uri=${encodeURIComponent(redirectUri)}&` +
      `state=${state}`;

    console.log(`[Zoho Routes] Client ID: ${clientId.substring(0, 10)}...`);
    console.log(`[Zoho Routes] Access Type: offline (for refresh_token)`);
    console.log(`[Zoho Routes] Prompt: consent (force consent screen)`);
    console.log(`[Zoho Routes] ⚠️  These parameters ensure refresh_token is returned`);
    console.log(`[Zoho Routes] Requested Scopes: ${scope}`);
    console.log(`[Zoho Routes] ⚠️  CRITICAL: Make sure these scopes include ZohoInvoice.invoices.UPDATE for payment status sync`);
    console.log(`[Zoho Routes] ⚠️  CRITICAL: Redirect URI being sent to Zoho: ${redirectUri}`);
    console.log(`[Zoho Routes] ⚠️  This EXACT URI must be in Zoho Developer Console`);
    console.log(`[Zoho Routes] Full Auth URL: ${authUrl.substring(0, 200)}...`);
    console.log(`[Zoho Routes] ⚠️  If Zoho redirects incorrectly, check Zoho Developer Console for redirect URI configuration`);
    
    res.redirect(authUrl);
  } catch (error: any) {
    console.error('[Zoho Routes] Auth initiation error:', error);
    res.status(500).json({ error: error.message || 'Failed to initiate OAuth flow' });
  }
});

/**
 * GET /api/zoho/callback
 * Handle OAuth callback from Zoho
 */
router.get('/callback', async (req, res) => {
  try {
    const { code, state, error, error_description } = req.query;

    // Log all query parameters for debugging
    console.log('[Zoho Routes] Callback received:', {
      hasCode: !!code,
      hasState: !!state,
      hasError: !!error,
      error: error,
      errorDescription: error_description,
      allParams: req.query,
    });

    // Check if Zoho returned an error (user denied, invalid request, etc.)
    if (error) {
      const errorMsg = error_description || error || 'Unknown error from Zoho';
      console.error('[Zoho Routes] OAuth error from Zoho:', errorMsg);
      return res.status(400).send(`
        <html>
          <head>
            <title>Zoho OAuth Error</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
              .error { background: #fee; border: 1px solid #fcc; padding: 15px; border-radius: 5px; }
              .info { background: #eef; border: 1px solid #ccf; padding: 15px; border-radius: 5px; margin-top: 20px; }
              h1 { color: #c00; }
              code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
            </style>
          </head>
          <body>
            <h1>❌ Zoho OAuth Error</h1>
            <div class="error">
              <p><strong>Error:</strong> ${error}</p>
              ${error_description ? `<p><strong>Description:</strong> ${error_description}</p>` : ''}
            </div>
            <div class="info">
              <h3>What happened?</h3>
              <p>Zoho returned an error during the OAuth authorization process.</p>
              <p><strong>Common causes:</strong></p>
              <ul>
                <li>You denied access to the application</li>
                <li>The redirect URI doesn't match what's configured in Zoho</li>
                <li>The authorization request was invalid</li>
              </ul>
              <h3>What to do?</h3>
              <ol>
                <li>Make sure the redirect URI in Zoho Developer Console matches: <code>${process.env.APP_URL || 'APP_URL_NOT_SET'}/api/zoho/callback</code></li>
                <li>Try the OAuth flow again: <a href="/api/zoho/auth?tenant_id=63107b06-938e-4ce6-b0f3-520a87db397b">Start OAuth Flow</a></li>
                <li>If you denied access, make sure to click "Allow" or "Authorize" when prompted</li>
              </ol>
            </div>
          </body>
        </html>
      `);
    }

    // Check if authorization code is missing or invalid type
    if (!code || typeof code !== 'string') {
      console.error('[Zoho Routes] Authorization code is missing or invalid. Query params:', req.query);
      return res.status(400).send(`
        <html>
          <head>
            <title>Authorization Code Missing</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 600px; margin: 50px auto; padding: 20px; }
              .error { background: #fee; border: 1px solid #fcc; padding: 15px; border-radius: 5px; }
              .info { background: #eef; border: 1px solid #ccf; padding: 15px; border-radius: 5px; margin-top: 20px; }
              h1 { color: #c00; }
              code { background: #f5f5f5; padding: 2px 6px; border-radius: 3px; }
            </style>
          </head>
          <body>
            <h1>❌ Authorization Code Missing</h1>
            <div class="error">
              <p>The OAuth callback was received but no authorization code was provided.</p>
            </div>
            <div class="info">
              <h3>What happened?</h3>
              <p>Zoho redirected back to the callback URL, but didn't include an authorization code.</p>
              <p><strong>Common causes:</strong></p>
              <ul>
                <li>You accessed the callback URL directly (without going through OAuth)</li>
                <li>The redirect URI doesn't match exactly what's configured in Zoho</li>
                <li>Zoho encountered an error but didn't include error parameters</li>
                <li>The authorization was denied or cancelled</li>
              </ul>
              <h3>What to do?</h3>
              <ol>
                <li>Make sure you're starting the OAuth flow from: <code>/api/zoho/auth?tenant_id=YOUR_TENANT_ID</code></li>
                <li>Verify the redirect URI in Zoho Developer Console matches exactly: <code>${process.env.APP_URL || 'https://booktifisupabase-production.up.railway.app'}/api/zoho/callback</code></li>
                <li>Try the OAuth flow again and make sure to click "Allow" or "Authorize"</li>
                <li>Check the browser console and server logs for more details</li>
              </ol>
              <p><strong>Debug Info:</strong></p>
              <pre style="background: #f5f5f5; padding: 10px; border-radius: 3px; overflow-x: auto;">${JSON.stringify(req.query, null, 2)}</pre>
            </div>
          </body>
        </html>
      `);
    }

    // Ensure code is a string
    const authCode = typeof code === 'string' ? code : Array.isArray(code) ? String(code[0]) : String(code);
    if (!authCode) {
      return res.status(400).json({ error: 'Invalid authorization code' });
    }

    // Decode state to get tenant_id and redirect_uri
    let tenantId: string;
    let redirectUri: string | undefined;
    try {
      const stateString: string = typeof state === 'string' 
        ? state 
        : Array.isArray(state) 
          ? String(state[0]) 
          : String(state);
      if (!stateString) {
        return res.status(400).json({ error: 'Invalid state parameter' });
      }
      const stateData = JSON.parse(Buffer.from(stateString, 'base64').toString());
      tenantId = stateData.tenant_id;
      redirectUri = stateData.redirect_uri; // Get redirect_uri from state if present
      
      console.log(`[Zoho Routes] State decoded:`, {
        tenantId,
        hasRedirectUri: !!redirectUri,
        redirectUri: redirectUri || 'not in state'
      });
    } catch (error: any) {
      console.error(`[Zoho Routes] Failed to decode state:`, error.message);
      return res.status(400).json({ error: 'Invalid state parameter' });
    }

    // Exchange authorization code for tokens
    try {
      // Load tenant-specific credentials (or fall back to global)
      const clientId = await zohoCredentials.getClientIdForTenant(tenantId);
      const clientSecret = await zohoCredentials.getClientSecretForTenant(tenantId);
      
      // Use redirect URI from state (stored during auth initiation)
      // This ensures we use the EXACT same redirect URI that was sent to Zoho
      if (!redirectUri) {
        // Fallback if redirect_uri not in state (shouldn't happen with Solution 8, but safe fallback)
        redirectUri = await zohoCredentials.getRedirectUriForTenant(tenantId);
        console.log(`[Zoho Routes] ⚠️  Redirect URI not in state, using credentials (fallback): ${redirectUri}`);
      } else {
        console.log(`[Zoho Routes] ✅ Using redirect URI from state: ${redirectUri}`);
      }
      
      const region = await zohoCredentials.getRegionForTenant(tenantId);

      // Determine token endpoint based on region
      let tokenEndpoint = 'https://accounts.zoho.com/oauth/v2/token';
      if (region === 'eu') {
        tokenEndpoint = 'https://accounts.zoho.eu/oauth/v2/token';
      } else if (region === 'in') {
        tokenEndpoint = 'https://accounts.zoho.in/oauth/v2/token';
      } else if (region === 'au') {
        tokenEndpoint = 'https://accounts.zoho.com.au/oauth/v2/token';
      } else if (region === 'jp') {
        tokenEndpoint = 'https://accounts.zoho.jp/oauth/v2/token';
      }

      console.log(`[Zoho Routes] ========================================`);
      console.log(`[Zoho Routes] TOKEN EXCHANGE STARTING`);
      console.log(`[Zoho Routes] Using token endpoint: ${tokenEndpoint} for region: ${region}`);
      console.log(`[Zoho Routes] ⚠️  CRITICAL: Redirect URI must match EXACTLY what was sent to Zoho during authorization`);
      console.log(`[Zoho Routes] Redirect URI being used: ${redirectUri}`);
      console.log(`[Zoho Routes] ⚠️  Make sure this EXACT URI is in Zoho Developer Console`);
      console.log(`[Zoho Routes] Token exchange params:`, {
        grant_type: 'authorization_code',
        client_id: clientId.substring(0, 15) + '...',
        redirect_uri: redirectUri,
        code: authCode.substring(0, 20) + '...',
      });
      console.log(`[Zoho Routes] Full client_id: ${clientId}`);
      console.log(`[Zoho Routes] Full redirect_uri: ${redirectUri}`);
      console.log(`[Zoho Routes] ========================================`);

      let tokenResponse;
      try {
        tokenResponse = await axios.post(
          tokenEndpoint,
          null,
          {
            params: {
              grant_type: 'authorization_code',
              client_id: clientId,
              client_secret: clientSecret,
              redirect_uri: redirectUri,
              code: authCode,
            },
          }
        );
      } catch (axiosError: any) {
        console.error(`[Zoho Routes] ❌ Axios request failed:`, {
          message: axiosError.message,
          status: axiosError.response?.status,
          statusText: axiosError.response?.statusText,
          data: axiosError.response?.data,
        });
        throw axiosError;
      }

      console.log(`[Zoho Routes] ✅ Token response received`);
      console.log(`[Zoho Routes] Token response status:`, tokenResponse.status);
      console.log(`[Zoho Routes] Token response data:`, JSON.stringify(tokenResponse.data, null, 2));

      const { access_token, refresh_token, expires_in } = tokenResponse.data;

      if (!access_token || !refresh_token) {
        console.error(`[Zoho Routes] Missing tokens in response:`, {
          hasAccessToken: !!access_token,
          hasRefreshToken: !!refresh_token,
          responseData: tokenResponse.data,
        });
        throw new Error('Failed to obtain tokens from Zoho');
      }

      // Log the scopes granted in the token response
      const grantedScopes = tokenResponse.data.scope || 'Not provided in response';
      console.log(`[Zoho Routes] ✅ Token exchange successful`);
      console.log(`[Zoho Routes] Granted Scopes: ${grantedScopes}`);
      
      // Check if UPDATE scope is included
      const hasUpdateScope = grantedScopes.includes('ZohoInvoice.invoices.UPDATE') || 
                            grantedScopes.includes('invoices.UPDATE');
      if (!hasUpdateScope) {
        console.warn(`[Zoho Routes] ⚠️  WARNING: UPDATE scope not found in granted scopes!`);
        console.warn(`[Zoho Routes] ⚠️  Payment status sync will fail. Please reconnect with UPDATE scope.`);
        console.warn(`[Zoho Routes] ⚠️  Granted scopes: ${grantedScopes}`);
      } else {
        console.log(`[Zoho Routes] ✅ UPDATE scope confirmed - payment status sync will work`);
      }

      // Store tokens with granted scopes
      await zohoService.storeTokens(tenantId, access_token, refresh_token, expires_in, grantedScopes);

      // Redirect to success page with postMessage to parent window
      res.send(`
        <html>
          <head>
            <title>Zoho Integration Success</title>
            <style>
              body {
                font-family: Arial, sans-serif;
                max-width: 500px;
                margin: 50px auto;
                padding: 20px;
                text-align: center;
              }
              .success {
                background: #d4edda;
                border: 1px solid #c3e6cb;
                color: #155724;
                padding: 20px;
                border-radius: 5px;
                margin: 20px 0;
              }
              .info {
                color: #666;
                font-size: 14px;
                margin-top: 20px;
              }
            </style>
          </head>
          <body>
            <div class="success">
              <h1>✅ Zoho Integration Successful!</h1>
              <p>Your Zoho Invoice account has been connected successfully.</p>
              <p class="info">This window will close automatically...</p>
            </div>
            <script>
              // Notify parent window that OAuth completed
              if (window.opener) {
                window.opener.postMessage({ type: 'ZOHO_OAUTH_SUCCESS', tenantId: '${tenantId}' }, '*');
              }
              
              // Close window after 2 seconds
              setTimeout(() => {
                window.close();
              }, 2000);
            </script>
          </body>
        </html>
      `);
    } catch (tokenError: any) {
      // Handle token exchange errors
      console.error('[Zoho Routes] Token exchange error:', tokenError);
      
      let errorMessage = 'Failed to exchange authorization code for tokens';
      let errorDetails = tokenError.message;
      
      // Check if it's an Axios error with response data
      if (tokenError.response) {
        console.error('[Zoho Routes] Zoho API error response:', {
          status: tokenError.response.status,
          data: tokenError.response.data,
        });
        errorDetails = JSON.stringify(tokenError.response.data, null, 2);
        errorMessage = tokenError.response.data?.error || errorMessage;
      }

      return res.status(400).send(`
        <html>
          <head>
            <title>Zoho Token Exchange Failed</title>
            <style>
              body { font-family: Arial, sans-serif; max-width: 700px; margin: 50px auto; padding: 20px; }
              .error { background: #fee; border: 1px solid #fcc; padding: 15px; border-radius: 5px; }
              .details { background: #f5f5f5; padding: 10px; border-radius: 3px; margin-top: 10px; overflow-x: auto; }
              h1 { color: #c00; }
              pre { white-space: pre-wrap; word-wrap: break-word; }
            </style>
          </head>
          <body>
            <h1>❌ Token Exchange Failed</h1>
            <div class="error">
              <p><strong>Error:</strong> ${errorMessage}</p>
              <div class="details">
                <pre>${errorDetails}</pre>
              </div>
            </div>
            <p><a href="javascript:window.close()">Close Window</a></p>
          </body>
        </html>
      `);
    }
  } catch (error: any) {
    console.error('[Zoho Routes] Callback error:', error);
    res.status(500).send(`
      <html>
        <head><title>Zoho Integration Error</title></head>
        <body>
          <h1>❌ Zoho Integration Failed</h1>
          <p>Error: ${error.message || 'Unknown error'}</p>
          <p>Please try again or contact support.</p>
        </body>
      </html>
    `);
  }
});

/**
 * GET /api/zoho/status
 * Check Zoho integration status for a tenant
 */
router.get('/status', async (req, res) => {
  try {
    const tenantId = req.query.tenant_id as string;
    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const { data: token, error } = await supabase
      .from('zoho_tokens')
      .select('id, tenant_id, expires_at, created_at, updated_at')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle();

    if (error) {
      throw error;
    }

    if (!token) {
      return res.json({
        connected: false,
        message: 'Zoho not connected',
      });
    }

    // Calculate status based on expires_at
    const status = new Date(token.expires_at) > new Date() ? 'active' : 'expired';

    return res.json({
      connected: true,
      status: status,
      expires_at: token.expires_at,
      created_at: token.created_at,
      updated_at: token.updated_at,
    });
  } catch (error: any) {
    console.error('[Zoho Routes] Status check error:', error);
    res.status(500).json({ error: error.message || 'Failed to check status' });
  }
});

/**
 * POST /api/zoho/disconnect
 * Disconnect Zoho integration for a tenant
 */
router.post('/disconnect', async (req, res) => {
  try {
    const { tenant_id } = req.body;
    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    const { error } = await supabase
      .from('zoho_tokens')
      .delete()
      .eq('tenant_id', tenant_id);

    if (error) {
      throw error;
    }

    res.json({
      success: true,
      message: 'Zoho integration disconnected successfully',
    });
  } catch (error: any) {
    console.error('[Zoho Routes] Disconnect error:', error);
    res.status(500).json({ error: error.message || 'Failed to disconnect' });
  }
});

/**
 * POST /api/zoho/test-invoice
 * Test invoice creation (for testing purposes)
 */
router.post('/test-invoice', async (req, res) => {
  try {
    const { tenant_id, booking_id } = req.body;

    if (!tenant_id || !booking_id) {
      return res.status(400).json({ error: 'tenant_id and booking_id are required' });
    }

    const result = await zohoService.generateReceipt(booking_id);

    if (result.success) {
      res.json({
        success: true,
        invoice_id: result.invoiceId,
        message: 'Test invoice created successfully',
      });
    } else {
      res.status(500).json({
        success: false,
        error: result.error,
      });
    }
  } catch (error: any) {
    console.error('[Zoho Routes] Test invoice error:', error);
    res.status(500).json({ error: error.message || 'Failed to create test invoice' });
  }
});

/**
 * GET /api/zoho/invoices/:invoiceId/download
 * Download invoice PDF (for customers)
 * Supports both Authorization header and token query parameter for flexibility
 */
router.get('/invoices/:invoiceId/download', async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const token = req.query.token as string || req.headers.authorization?.replace('Bearer ', '');
    
    console.log(`[Zoho Routes] Download request for invoice: ${invoiceId}`);
    
    if (!invoiceId) {
      console.error('[Zoho Routes] Invoice ID missing');
      return res.status(400).json({ error: 'Invoice ID is required' });
    }

    // Optional: Validate token if provided (for security)
    // For now, we'll allow downloads without strict auth since invoices are already public to customers

    // Get tenant_id from booking (need to find booking by zoho_invoice_id)
    const { data: booking, error } = await supabase
      .from('bookings')
      .select('tenant_id')
      .eq('zoho_invoice_id', invoiceId)
      .limit(1)
      .maybeSingle();

    if (error || !booking) {
      console.error(`[Zoho Routes] Invoice not found in database: ${invoiceId}`, error);
      return res.status(404).json({ error: 'Invoice not found' });
    }

    const tenantId = booking.tenant_id;
    console.log(`[Zoho Routes] Found tenant_id: ${tenantId} for invoice: ${invoiceId}`);

    // Download PDF from Zoho
    console.log(`[Zoho Routes] Downloading PDF from Zoho for invoice: ${invoiceId}`);
    const pdfBuffer = await zohoService.downloadInvoicePdf(tenantId, invoiceId);
    console.log(`[Zoho Routes] PDF downloaded successfully, size: ${pdfBuffer.length} bytes`);

    // Set CORS headers (must be set before sending response)
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    
    // Set response headers for PDF download
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="invoice-${invoiceId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length.toString());

    // Send PDF buffer
    res.send(pdfBuffer);
    console.log(`[Zoho Routes] PDF sent successfully`);
  } catch (error: any) {
    console.error('[Zoho Routes] Download invoice error:', error);
    console.error('[Zoho Routes] Error stack:', error.stack);
    
    // Set CORS headers even for errors
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    
    res.status(500).json({ 
      error: error.message || 'Failed to download invoice',
      details: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * OPTIONS /api/zoho/invoices/:invoiceId/download
 * Handle CORS preflight for invoice download
 */
router.options('/invoices/:invoiceId/download', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.sendStatus(200);
});

export { router as zohoRoutes };

