/**
 * Regenerate invoice for a specific booking via routing service.
 * Usage: npx tsx scripts/regenerate-daftra-booking-invoice.ts <bookingId>
 */
import { invoiceRoutingService } from '../src/services/invoiceRoutingService';

async function main() {
  const bookingId = process.argv[2];
  if (!bookingId) throw new Error('Usage: npx tsx scripts/regenerate-daftra-booking-invoice.ts <bookingId>');
  const out = await invoiceRoutingService.regenerateInvoiceForBooking(bookingId);
  console.log(JSON.stringify(out, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
