/**
 * Master Test Runner
 * Runs all backend API tests in sequence
 */

import { runAllTests as runAuthTests } from './01-authentication.test.js';
import { runAllTests as runServiceProviderTests } from './02-service-provider-flow.test.js';
import { runAllTests as runCustomerTests } from './03-customer-flow.test.js';
import { runAllTests as runBookingTests } from './04-booking-workflow.test.js';
import { runAllTests as runTicketTests } from './05-ticket-generation.test.js';
import { runAllTests as runInvoiceTests } from './06-invoice-generation.test.js';
import { runAllTests as runErrorHandlingTests } from './07-error-handling.test.js';
import { runAllTests as runBookingManagementTests } from './08-booking-management.test.js';
import { runAllTests as runZohoDisconnectTests } from './09-zoho-disconnect.test.js';
import { CONFIG } from './config.js';

const overallResults = {
  totalPassed: 0,
  totalFailed: 0,
  moduleResults: []
};

async function runAllTestSuites() {
  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                                                              ║');
  console.log('║     BACKEND API COMPREHENSIVE TEST SUITE                    ║');
  console.log('║                                                              ║');
  console.log('║     Testing: Railway Backend                                  ║');
  console.log(`║     URL: ${CONFIG.API_BASE_URL.padEnd(47)}║`);
  console.log('║                                                              ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  const startTime = Date.now();
  
  // Test Suite 1: Authentication
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 1: Authentication & User Management');
  console.log('═'.repeat(62));
  const authSuccess = await runAuthTests();
  overallResults.moduleResults.push({ name: 'Authentication', success: authSuccess });
  if (authSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  // Wait a bit between test suites
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test Suite 2: Service Provider Flow
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 2: Service Provider Flow');
  console.log('═'.repeat(62));
  const serviceProviderSuccess = await runServiceProviderTests();
  overallResults.moduleResults.push({ name: 'Service Provider', success: serviceProviderSuccess });
  if (serviceProviderSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test Suite 3: Customer Flow
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 3: Customer Flow');
  console.log('═'.repeat(62));
  const customerSuccess = await runCustomerTests();
  overallResults.moduleResults.push({ name: 'Customer', success: customerSuccess });
  if (customerSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test Suite 4: Booking Workflow
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 4: Booking Workflow');
  console.log('═'.repeat(62));
  const bookingSuccess = await runBookingTests();
  overallResults.moduleResults.push({ name: 'Booking', success: bookingSuccess });
  if (bookingSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test Suite 5: Ticket Generation
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 5: Ticket Generation & Delivery');
  console.log('═'.repeat(62));
  const ticketSuccess = await runTicketTests();
  overallResults.moduleResults.push({ name: 'Ticket', success: ticketSuccess });
  if (ticketSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Test Suite 6: Invoice Generation
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 6: Invoice Generation');
  console.log('═'.repeat(62));
  const invoiceSuccess = await runInvoiceTests();
  overallResults.moduleResults.push({ name: 'Invoice', success: invoiceSuccess });
  if (invoiceSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test Suite 7: Error Handling
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 7: Error Handling & Edge Cases');
  console.log('═'.repeat(62));
  const errorHandlingSuccess = await runErrorHandlingTests();
  overallResults.moduleResults.push({ name: 'Error Handling', success: errorHandlingSuccess });
  if (errorHandlingSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test Suite 8: Booking Management
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 8: Booking Lifecycle Management');
  console.log('═'.repeat(62));
  const bookingManagementSuccess = await runBookingManagementTests();
  overallResults.moduleResults.push({ name: 'Booking Management', success: bookingManagementSuccess });
  if (bookingManagementSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  await new Promise(resolve => setTimeout(resolve, 1000));
  
  // Test Suite 9: Zoho Disconnect
  console.log('\n' + '═'.repeat(62));
  console.log('TEST SUITE 9: Zoho Disconnect Endpoint');
  console.log('═'.repeat(62));
  const zohoDisconnectSuccess = await runZohoDisconnectTests();
  overallResults.moduleResults.push({ name: 'Zoho Disconnect', success: zohoDisconnectSuccess });
  if (zohoDisconnectSuccess) overallResults.totalPassed++;
  else overallResults.totalFailed++;
  
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);
  
  // Final Summary
  console.log('\n\n');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║                    FINAL TEST SUMMARY                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n');
  
  console.log('Module Results:');
  console.log('─'.repeat(62));
  overallResults.moduleResults.forEach(module => {
    const icon = module.success ? '✅' : '❌';
    const status = module.success ? 'PASSED' : 'FAILED';
    console.log(`  ${icon} ${module.name.padEnd(25)} ${status}`);
  });
  
  console.log('\n');
  console.log('Overall Statistics:');
  console.log('─'.repeat(62));
  console.log(`  ✅ Modules Passed:  ${overallResults.totalPassed}`);
  console.log(`  ❌ Modules Failed:  ${overallResults.totalFailed}`);
  console.log(`  📊 Total Modules:   ${overallResults.moduleResults.length}`);
  console.log(`  ⏱️  Duration:        ${duration}s`);
  console.log(`  🎯 Success Rate:    ${((overallResults.totalPassed / overallResults.moduleResults.length) * 100).toFixed(1)}%`);
  console.log('\n');
  
  if (overallResults.totalFailed === 0) {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  ✅ ALL TESTS PASSED - Backend is working as expected!      ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('\n');
    return true;
  } else {
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║  ⚠️  SOME TESTS FAILED - Review the output above            ║');
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log('\n');
    return false;
  }
}

// Run all tests
runAllTestSuites()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('\n❌ Fatal error running tests:', error);
    process.exit(1);
  });
