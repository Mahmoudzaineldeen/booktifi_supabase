import { Request, Response, NextFunction } from 'express';
import { supabase } from '../db';
import { zohoService } from '../services/zohoService';

/**
 * Middleware to ensure Zoho tokens are valid for a tenant
 * This middleware checks if tokens exist and are valid before allowing Zoho operations
 */
export async function ensureZohoAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const tenantId = req.body.tenant_id || req.query.tenant_id || req.params.tenant_id;

    if (!tenantId) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    // Check if tokens exist
    const { data: token, error: tokenError } = await supabase
      .from('zoho_tokens')
      .select('*')
      .eq('tenant_id', tenantId)
      .maybeSingle();

    if (tokenError) {
      throw tokenError;
    }

    if (!token) {
      return res.status(401).json({
        error: 'Zoho not connected',
        message: 'Please complete OAuth flow first. Visit /api/zoho/auth?tenant_id=' + tenantId,
      });
    }

    // Try to get access token (this will refresh if needed)
    try {
      await zohoService.getAccessToken(tenantId);
      next();
    } catch (accessTokenError: any) {
      return res.status(401).json({
        error: 'Zoho token invalid or expired',
        message: 'Please reconnect Zoho. Visit /api/zoho/auth?tenant_id=' + tenantId,
        details: accessTokenError.message,
      });
    }
  } catch (error: any) {
    console.error('[Zoho Auth Middleware] Error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
}

