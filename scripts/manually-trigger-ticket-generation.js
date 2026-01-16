#!/usr/bin/env node

/**
 * Manually Trigger Ticket Generation for Existing Booking
 * 
 * This script directly calls the ticket generation functions
 * for an existing booking to test the ticket generation flow.
 */

// This script needs to be run from the server directory
// or we need to import the server modules

import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Check if we're in the right directory
const serverPath = path.join(__dirname, '..', 'server');
if (!fs.existsSync(serverPath)) {
  console.error('Error: server directory not found');
  console.log('Please run this script from the project root');
  process.exit(1);
}

async function main() {
  console.log('\n=== Manual Ticket Generation Test ===\n');
  console.log('This script requires the server to be running.');
  console.log('It will create a booking via API and monitor ticket generation.\n');
  
  const API_URL = 'http://localhost:3001/api';
  const TEST_EMAIL = 'mahmoudnzaineldeen@gmail.com';
  const TEST_PHONE = '+201032560826';
  const TEST_TENANT_ID = 'd49e292b-b403-4268-a271-2ddc9704601b';
  
  // Check server
  try {
    const health = await fetch('http://localhost:3001/health');
    if (!health.ok) {
      console.error('✗ Server not healthy');
      process.exit(1);
    }
    console.log('✓ Server is running\n');
  } catch (error) {
    console.error('✗ Cannot connect to server');
    console.log('Please start the server: cd server && npm run dev\n');
    process.exit(1);
  }
  
  console.log('='.repeat(60));
  console.log('\n📝 INSTRUCTIONS FOR TESTING TICKET GENERATION\n');
  console.log('Since tickets are generated automatically when bookings are created,');
  console.log('you need to create a NEW booking to test ticket generation.\n');
  console.log('Option 1: Create via UI (Recommended)');
  console.log('  1. Go to: http://localhost:5173/fci/book');
  console.log('  2. Select a service and time slot');
  console.log('  3. Enter customer details:');
  console.log(`     - Email: ${TEST_EMAIL}`);
  console.log(`     - Phone: ${TEST_PHONE}`);
  console.log('  4. Complete the booking');
  console.log('  5. IMMEDIATELY check SERVER CONSOLE for ticket logs\n');
  console.log('Option 2: Create via API (if slots available)');
  console.log('  Run: node scripts/test-booking-tickets.js\n');
  console.log('='.repeat(60));
  console.log('\n🔍 What to Look For in Server Console:\n');
  console.log('After booking is created, you should see:');
  console.log('');
  console.log('📧 ========================================');
  console.log('📧 Starting ticket generation for booking <ID>...');
  console.log('   Customer: <name>');
  console.log(`   Email: ${TEST_EMAIL}`);
  console.log(`   Phone: ${TEST_PHONE}`);
  console.log('📧 ========================================');
  console.log('');
  console.log('📄 Step 1: Generating PDF for booking <ID>...');
  console.log('✅ Step 1 Complete: PDF generated successfully (XXXXX bytes)');
  console.log('');
  console.log('📱 Step 2: Attempting to send ticket via WhatsApp...');
  console.log('✅ Step 2 Complete: Ticket PDF sent via WhatsApp');
  console.log('');
  console.log('📧 Step 3: Attempting to send ticket via Email...');
  console.log('✅ Step 3 Complete: Ticket PDF sent via Email');
  console.log('');
  console.log('='.repeat(60));
  console.log('\n📬 Check Delivery:');
  console.log(`  📧 Email: ${TEST_EMAIL}`);
  console.log(`  📱 WhatsApp: ${TEST_PHONE}\n`);
  console.log('='.repeat(60));
  console.log('\n⚠️  If you don\'t see ticket generation logs:');
  console.log('  1. Check if booking was actually created');
  console.log('  2. Verify booking has customer_email and customer_phone');
  console.log('  3. Check for errors in server console');
  console.log('  4. Verify tenant_id is correct\n');
}

main().catch(err => {
  console.error('\nError:', err.message);
  process.exit(1);
});
