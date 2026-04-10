import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';
import {
  DaftraPdfDownloadError,
  downloadDaftraInvoicePdfForTenant,
  loadDaftraSettingsForTenant,
  resolveDaftraInternalInvoiceId,
} from '../services/daftraInvoiceService';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const router = express.Router();

/**
 * GET /api/daftra/invoices/:invoiceId/download
 * GET /api/daftra/invoices/:invoiceId/file
 * Same access pattern as Zoho: booking row links daftra_invoice_id; staff must be same tenant.
 */
const handleInvoicePdfDownload: express.RequestHandler = async (req, res) => {
  try {
    const { invoiceId } = req.params;
    const token = (req.query.token as string) || req.headers.authorization?.replace('Bearer ', '');

    if (!invoiceId) {
      return res.status(400).json({ error: 'Invoice ID is required' });
    }

    let userRole: string | null = null;
    let userTenantId: string | null = null;

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as { role?: string; tenant_id?: string | null };
        userRole = decoded.role ?? null;
        userTenantId = decoded.tenant_id ?? null;

        if (userRole === 'cashier') {
          return res.status(403).json({
            error: 'Access denied. Cashiers cannot download invoices.',
            hint: 'Use receptionist, tenant owner, or customer account.',
          });
        }
      } catch (e: any) {
        console.warn('[Daftra Routes] Token validation failed, allowing download (email link):', e?.message);
      }
    }

    let { data: booking, error } = await supabase
      .from('bookings')
      .select('tenant_id, daftra_invoice_id')
      .eq('daftra_invoice_id', invoiceId)
      .limit(1)
      .maybeSingle();

    // Allow display invoice no (e.g. 000095) when JWT provides tenant — map to internal Daftra id via API.
    if ((error || !booking?.tenant_id) && userTenantId) {
      const settings = await loadDaftraSettingsForTenant(userTenantId);
      if (settings) {
        try {
          const resolved = await resolveDaftraInternalInvoiceId(settings, invoiceId);
          const second = await supabase
            .from('bookings')
            .select('tenant_id, daftra_invoice_id')
            .eq('daftra_invoice_id', String(resolved))
            .limit(1)
            .maybeSingle();
          if (!second.error && second.data?.tenant_id) {
            booking = second.data;
            error = null;
          }
        } catch {
          /* keep 404 below */
        }
      }
    }

    if (error || !booking?.tenant_id) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (userTenantId && userRole && ['receptionist', 'tenant_admin', 'admin_user'].includes(userRole)) {
      if (userTenantId !== booking.tenant_id) {
        return res.status(403).json({ error: 'Access denied. This invoice belongs to a different tenant.' });
      }
    }

    const { pdf: pdfBuffer, source, resolvedInvoiceId } = await downloadDaftraInvoicePdfForTenant(booking.tenant_id, invoiceId);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader(
      'Access-Control-Expose-Headers',
      'X-Invoice-Source, X-Daftra-Invoice-Id, Content-Disposition, Content-Length, Content-Type'
    );
    const sourceHeader =
      source === 'daftra-remote'
        ? 'daftra-api'
        : source === 'daftra-template'
          ? 'daftra-html-template'
          : 'bookati-local-generator';
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Surrogate-Control', 'no-store');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('X-Invoice-Source', sourceHeader);
    res.setHeader('X-Daftra-Invoice-Id', String(resolvedInvoiceId));
    res.setHeader('Content-Disposition', `attachment; filename="daftra-invoice-${resolvedInvoiceId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length.toString());
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[Daftra Routes] Download error:', {
      invoiceId: req.params?.invoiceId,
      message: err?.message || String(err),
      statusCode: err?.statusCode,
    });
    res.setHeader('Access-Control-Allow-Origin', '*');
    const msg = err?.message || 'Failed to download invoice';
    let status = 500;
    if (err instanceof DaftraPdfDownloadError) {
      status = err.statusCode;
    } else if (msg.toLowerCase().includes('not found')) {
      status = 404;
    } else if (msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('access denied')) {
      status = 403;
    }
    res.status(status).json({ error: msg });
  }
};

router.get('/invoices/:invoiceId/download', handleInvoicePdfDownload);
router.get('/invoices/:invoiceId/file', handleInvoicePdfDownload);

router.options('/invoices/:invoiceId/download', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Invoice-Source, X-Daftra-Invoice-Id, Content-Disposition, Content-Length, Content-Type'
  );
  res.sendStatus(200);
});
router.options('/invoices/:invoiceId/file', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader(
    'Access-Control-Expose-Headers',
    'X-Invoice-Source, X-Daftra-Invoice-Id, Content-Disposition, Content-Length, Content-Type'
  );
  res.sendStatus(200);
});

export { router as daftraRoutes };
