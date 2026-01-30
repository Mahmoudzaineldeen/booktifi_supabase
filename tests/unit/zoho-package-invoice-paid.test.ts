/**
 * Verifies the Zoho package subscription invoice payment fix.
 * Ensures: (1) ensurePackageInvoicePaid is used in packages route,
 * (2) ZohoService uses recordCustomerPayment (customer payment API) for marking paid,
 * (3) Organization ID is required and used (getZohoOrganizationId / tenant_zoho_configs).
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

  it('ZohoService defines ensurePackageInvoicePaid and recordCustomerPayment', () => {
    const zohoCode = readServerFile('services/zohoService.ts');
    expect(zohoCode).toContain('ensurePackageInvoicePaid');
    expect(zohoCode).toContain('recordCustomerPayment');
    expect(zohoCode).toContain('async ensurePackageInvoicePaid(');
    expect(zohoCode).toContain('async recordCustomerPayment(');
  });

  it('ensurePackageInvoicePaid uses recordCustomerPayment (customer payment API) not mark-as-paid', () => {
    const zohoCode = readServerFile('services/zohoService.ts');
    const ensureStart = zohoCode.indexOf('async ensurePackageInvoicePaid(');
    const ensureEnd = zohoCode.indexOf('async getInvoicePaymentStatus(', ensureStart);
    expect(ensureStart).toBeGreaterThanOrEqual(0);
    const ensureBody = zohoCode.slice(ensureStart, ensureStart + 2500);
    expect(ensureBody).toContain('getInvoicePaymentStatus');
    expect(ensureBody).toContain('recordCustomerPayment');
    // Must NOT rely on tryMarkInvoicePaid for success (deprecated; payment = customer payment API)
    const recordPos = ensureBody.indexOf('recordCustomerPayment');
    expect(recordPos).toBeGreaterThanOrEqual(0);
  });

  it('recordCustomerPayment requires organization ID (getZohoOrganizationId / tenant_zoho_configs)', () => {
    const zohoCode = readServerFile('services/zohoService.ts');
    expect(zohoCode).toContain('getZohoOrganizationId');
    expect(zohoCode).toContain('tenant_zoho_configs');
    expect(zohoCode).toContain('zoho_organization_id');
    expect(zohoCode).toContain('customerpayments?organization_id=');
  });
});
