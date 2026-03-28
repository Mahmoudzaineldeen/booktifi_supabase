import express from 'express';
import jwt from 'jsonwebtoken';
import { supabase } from '../db';
import { downloadDaftraInvoicePdfForTenant } from '../services/daftraInvoiceService';

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key-change-in-production';

const router = express.Router();

/**
 * GET /api/daftra/invoices/:invoiceId/download
 * Same access pattern as Zoho: booking row links daftra_invoice_id; staff must be same tenant.
 */
router.get('/invoices/:invoiceId/download', async (req, res) => {
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

    const { data: booking, error } = await supabase
      .from('bookings')
      .select('tenant_id, daftra_invoice_id')
      .eq('daftra_invoice_id', invoiceId)
      .limit(1)
      .maybeSingle();

    if (error || !booking?.tenant_id) {
      return res.status(404).json({ error: 'Invoice not found' });
    }

    if (userTenantId && userRole && ['receptionist', 'tenant_admin', 'admin_user'].includes(userRole)) {
      if (userTenantId !== booking.tenant_id) {
        return res.status(403).json({ error: 'Access denied. This invoice belongs to a different tenant.' });
      }
    }

    const pdfBuffer = await downloadDaftraInvoicePdfForTenant(booking.tenant_id, invoiceId);

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="daftra-invoice-${invoiceId}.pdf"`);
    res.setHeader('Content-Length', pdfBuffer.length.toString());
    res.send(pdfBuffer);
  } catch (err: any) {
    console.error('[Daftra Routes] Download error:', err?.message || err);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(500).json({ error: err?.message || 'Failed to download invoice' });
  }
});

router.options('/invoices/:invoiceId/download', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.sendStatus(200);
});

export { router as daftraRoutes };
