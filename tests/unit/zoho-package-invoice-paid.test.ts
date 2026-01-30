/**
 * Verifies the Zoho package subscription invoice "mark as paid" fix.
 * Ensures: (1) ensurePackageInvoicePaid is used in packages route,
 * (2) ZohoService has tryMarkInvoicePaid and ensurePackageInvoicePaid,
 * (3) ensurePackageInvoicePaid tries mark-as-paid before recordCustomerPayment.
 */
import { readFileSync, existsSync } from 'fs';
import path from 'path';

const projectRoot = path.resolve(__dirname, '../..');
const serverSrc = path.join(projectRoot, 'server', 'src');

function readServerFile(relativePath: string): string {
  const fullPath = path.join(serverSrc, relativePath);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }
  return readFileSync(fullPath, 'utf-8');
}

describe('Zoho package invoice paid fix', () => {
  it('packages route uses ensurePackageInvoicePaid (not only recordCustomerPayment) for paid subscriptions', () => {
    const packagesCode = readServerFile('routes/packages.ts');
    expect(packagesCode).toContain('ensurePackageInvoicePaid');
    expect(packagesCode).not.toMatch(/options\?\.[\s\S]*?recordCustomerPayment\s*\(/);
    expect(packagesCode).toMatch(/ensurePackageInvoicePaid\s*\(/);
  });

  it('ZohoService defines tryMarkInvoicePaid and ensurePackageInvoicePaid', () => {
    const zohoCode = readServerFile('services/zohoService.ts');
    expect(zohoCode).toContain('tryMarkInvoicePaid');
    expect(zohoCode).toContain('ensurePackageInvoicePaid');
    expect(zohoCode).toContain('async tryMarkInvoicePaid(');
    expect(zohoCode).toContain('async ensurePackageInvoicePaid(');
  });

  it('ensurePackageInvoicePaid tries tryMarkInvoicePaid before recordCustomerPayment', () => {
    const zohoCode = readServerFile('services/zohoService.ts');
    const ensureStart = zohoCode.indexOf('async ensurePackageInvoicePaid(');
    const ensureEnd = zohoCode.indexOf('async recordCustomerPayment(', ensureStart);
    expect(ensureStart).toBeGreaterThanOrEqual(0);
    expect(ensureEnd).toBeGreaterThan(ensureStart);
    const ensureBody = zohoCode.slice(ensureStart, ensureEnd);
    expect(ensureBody).toContain('tryMarkInvoicePaid');
    expect(ensureBody).toContain('getInvoicePaymentStatus');
    expect(ensureBody).toContain('recordCustomerPayment');
    const tryMarkPos = ensureBody.indexOf('tryMarkInvoicePaid');
    const recordPos = ensureBody.indexOf('recordCustomerPayment');
    expect(tryMarkPos).toBeLessThan(recordPos);
  });

  it('recordCustomerPayment uses tenant-stored zoho_organization_id first', () => {
    const zohoCode = readServerFile('services/zohoService.ts');
    expect(zohoCode).toContain('tenant_zoho_configs');
    expect(zohoCode).toContain('zoho_organization_id');
    expect(zohoCode).toContain('Using tenant-stored Zoho Organization ID');
  });
});
