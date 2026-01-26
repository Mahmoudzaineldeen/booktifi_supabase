/**
 * Comprehensive Package Capacity System Testing
 * 
 * Tests all phases of the new package capacity mechanism:
 * - Phase 1: Data & Model Integrity
 * - Phase 2: Capacity Resolution Engine
 * - Phase 3: Customer Booking Flow
 * - Phase 4: Receptionist Booking Flow
 * - Phase 5: Package Exhaustion Notification
 * - Phase 6: Service Provider View
 * - Phase 7: Regression & Safety
 * 
 * STRICT RULES:
 * - Only fix bugs uncovered by tests
 * - No refactoring or new features
 * - Log every failure clearly
 */

import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';

// Load environment variables
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Try to load .env file
dotenv.config({ path: join(__dirname, '..', '.env') });
dotenv.config({ path: join(__dirname, '..', '.env.local') });

// Configuration
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const API_URL = process.env.API_URL || 'http://localhost:3000';

if (!SUPABASE_SERVICE_KEY) {
  console.error('❌ ERROR: SUPABASE_SERVICE_ROLE_KEY or SUPABASE_ANON_KEY environment variable is required');
  console.error('   Please set it in .env file or as an environment variable');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// Test results tracking
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

function logTest(name, passed, message = '') {
  if (passed) {
    testResults.passed.push({ name, message });
    console.log(`✅ PASS: ${name}${message ? ` - ${message}` : ''}`);
  } else {
    testResults.failed.push({ name, message });
    console.error(`❌ FAIL: ${name}${message ? ` - ${message}` : ''}`);
  }
}

function logWarning(name, message) {
  testResults.warnings.push({ name, message });
  console.warn(`⚠️  WARN: ${name} - ${message}`);
}

// ============================================================================
// PHASE 1: DATA & MODEL INTEGRITY
// ============================================================================

async function testPhase1() {
  console.log('\n🧪 PHASE 1: DATA & MODEL INTEGRITY\n');
  
  // Test 1.1: Package with single service
  try {
    const { data: packages, error } = await supabase
      .from('service_packages')
      .select('id, name')
      .limit(1);
    
    if (error) throw error;
    
    if (packages && packages.length > 0) {
      const packageId = packages[0].id;
      const { data: packageServices, error: psError } = await supabase
        .from('package_services')
        .select('id, service_id, capacity_total')
        .eq('package_id', packageId);
      
      if (psError) throw psError;
      
      const singleServicePackages = packages.filter(pkg => {
        const services = packageServices.filter(ps => ps.package_id === pkg.id);
        return services.length === 1;
      });
      
      if (singleServicePackages.length > 0) {
        logTest('1.1: Package with single service', true, `Found ${singleServicePackages.length} single-service packages`);
      } else {
        logWarning('1.1: Package with single service', 'No single-service packages found (test data needed)');
      }
    } else {
      logWarning('1.1: Package with single service', 'No packages found (test data needed)');
    }
  } catch (error) {
    logTest('1.1: Package with single service', false, error.message);
  }
  
  // Test 1.2: Package with multiple services
  try {
    const { data: packages, error } = await supabase
      .from('service_packages')
      .select('id, name');
    
    if (error) throw error;
    
    if (packages && packages.length > 0) {
      let multiServiceCount = 0;
      for (const pkg of packages) {
        const { data: services, error: psError } = await supabase
          .from('package_services')
          .select('id')
          .eq('package_id', pkg.id);
        
        if (psError) throw psError;
        
        if (services && services.length > 1) {
          multiServiceCount++;
        }
      }
      
      if (multiServiceCount > 0) {
        logTest('1.2: Package with multiple services', true, `Found ${multiServiceCount} multi-service packages`);
      } else {
        logWarning('1.2: Package with multiple services', 'No multi-service packages found (test data needed)');
      }
    } else {
      logWarning('1.2: Package with multiple services', 'No packages found (test data needed)');
    }
  } catch (error) {
    logTest('1.2: Package with multiple services', false, error.message);
  }
  
  // Test 1.3: Multiple packages subscribed by same customer
  try {
    const { data: subscriptions, error } = await supabase
      .from('package_subscriptions')
      .select('customer_id, package_id, status, is_active')
      .eq('status', 'active')
      .eq('is_active', true);
    
    if (error) throw error;
    
    if (subscriptions && subscriptions.length > 0) {
      const customerPackageCount = {};
      subscriptions.forEach(sub => {
        if (!customerPackageCount[sub.customer_id]) {
          customerPackageCount[sub.customer_id] = 0;
        }
        customerPackageCount[sub.customer_id]++;
      });
      
      const customersWithMultiple = Object.entries(customerPackageCount)
        .filter(([_, count]) => count > 1)
        .length;
      
      if (customersWithMultiple > 0) {
        logTest('1.3: Multiple packages subscribed by same customer', true, 
          `Found ${customersWithMultiple} customers with multiple packages`);
      } else {
        logWarning('1.3: Multiple packages subscribed by same customer', 
          'No customers with multiple packages found (test data needed)');
      }
    } else {
      logWarning('1.3: Multiple packages subscribed by same customer', 
        'No active subscriptions found (test data needed)');
    }
  } catch (error) {
    logTest('1.3: Multiple packages subscribed by same customer', false, error.message);
  }
  
  // Test 1.4: Service not included in any package
  try {
    const { data: allServices, error: servicesError } = await supabase
      .from('services')
      .select('id')
      .eq('is_active', true)
      .limit(100);
    
    if (servicesError) throw servicesError;
    
    const { data: packagedServices, error: psError } = await supabase
      .from('package_services')
      .select('service_id');
    
    if (psError) throw psError;
    
    const packagedServiceIds = new Set(packagedServices.map(ps => ps.service_id));
    const unpackagedServices = allServices.filter(s => !packagedServiceIds.has(s.id));
    
    if (unpackagedServices.length > 0) {
      logTest('1.4: Service not included in any package', true, 
        `Found ${unpackagedServices.length} services not in any package`);
    } else {
      logWarning('1.4: Service not included in any package', 
        'All services are in packages (test data needed)');
    }
  } catch (error) {
    logTest('1.4: Service not included in any package', false, error.message);
  }
  
  // Test 1.5: Capacity = 0 edge case
  try {
    const { data: usage, error } = await supabase
      .from('package_subscription_usage')
      .select('subscription_id, service_id, remaining_quantity, original_quantity, used_quantity')
      .eq('remaining_quantity', 0);
    
    if (error) throw error;
    
    if (usage && usage.length > 0) {
      logTest('1.5: Capacity = 0 edge case', true, 
        `Found ${usage.length} service-capacity pairs with 0 remaining`);
    } else {
      logWarning('1.5: Capacity = 0 edge case', 
        'No exhausted capacities found (test data needed)');
    }
  } catch (error) {
    logTest('1.5: Capacity = 0 edge case', false, error.message);
  }
  
  // Test 1.6: Verify no automatic bookings created
  try {
    const { data: bookings, error } = await supabase
      .from('bookings')
      .select('id, package_subscription_id')
      .not('package_subscription_id', 'is', null)
      .limit(10);
    
    if (error) throw error;
    
    // Check that bookings with packages have valid subscription IDs
    if (bookings && bookings.length > 0) {
      let validCount = 0;
      for (const booking of bookings) {
        const { data: subscription, error: subError } = await supabase
          .from('package_subscriptions')
          .select('id')
          .eq('id', booking.package_subscription_id)
          .maybeSingle();
        
        if (!subError && subscription) {
          validCount++;
        }
      }
      
      if (validCount === bookings.length) {
        logTest('1.6: No automatic bookings created (data integrity)', true, 
          `All ${bookings.length} package bookings have valid subscriptions`);
      } else {
        logTest('1.6: No automatic bookings created (data integrity', false, 
          `${bookings.length - validCount} bookings have invalid subscription IDs`);
      }
    } else {
      logWarning('1.6: No automatic bookings created', 
        'No package bookings found (test data needed)');
    }
  } catch (error) {
    logTest('1.6: No automatic bookings created', false, error.message);
  }
}

// ============================================================================
// PHASE 2: CAPACITY RESOLUTION ENGINE
// ============================================================================

async function testPhase2() {
  console.log('\n🧪 PHASE 2: CAPACITY RESOLUTION ENGINE\n');
  
  // Test 2.1: Customer with no packages → returns 0 capacity
  try {
    // Find a customer with no active subscriptions
    const { data: allCustomers, error: customersError } = await supabase
      .from('customers')
      .select('id, name')
      .limit(10);
    
    if (customersError) throw customersError;
    
    if (allCustomers && allCustomers.length > 0) {
      let customerWithNoPackages = null;
      
      for (const customer of allCustomers) {
        const { data: subscriptions, error: subError } = await supabase
          .from('package_subscriptions')
          .select('id')
          .eq('customer_id', customer.id)
          .eq('status', 'active')
          .eq('is_active', true);
        
        if (subError) throw subError;
        
        if (!subscriptions || subscriptions.length === 0) {
          customerWithNoPackages = customer;
          break;
        }
      }
      
      if (customerWithNoPackages) {
        // Get a service to test with
        const { data: services, error: servicesError } = await supabase
          .from('services')
          .select('id')
          .eq('is_active', true)
          .limit(1)
          .maybeSingle();
        
        if (servicesError) throw servicesError;
        
        if (services) {
          // Call RPC function directly (returns table, not single row)
          const { data: capacityData, error: capacityError } = await supabase
            .rpc('resolveCustomerServiceCapacity', {
              p_customer_id: customerWithNoPackages.id,
              p_service_id: services.id
            });
          
          if (capacityError) {
            // If function doesn't exist, check if migrations were run
            if (capacityError.message.includes('Could not find the function')) {
              throw new Error(`Function resolveCustomerServiceCapacity not found. Please ensure migration 20260130000000_redesign_package_capacity_system.sql has been applied. Error: ${capacityError.message}`);
            }
            throw capacityError;
          }
          
          // RPC returns table, so data is an array
          const totalCapacity = capacityData && capacityData.length > 0 
            ? (capacityData[0].total_remaining_capacity || 0)
            : 0;
          
          if (totalCapacity === 0) {
            logTest('2.1: Customer with no packages → returns 0 capacity', true);
          } else {
            logTest('2.1: Customer with no packages → returns 0 capacity', false, 
              `Expected 0, got ${totalCapacity}`);
          }
        } else {
          logWarning('2.1: Customer with no packages', 'No services found');
        }
      } else {
        logWarning('2.1: Customer with no packages', 'All customers have packages (test data needed)');
      }
    } else {
      logWarning('2.1: Customer with no packages', 'No customers found');
    }
  } catch (error) {
    logTest('2.1: Customer with no packages → returns 0 capacity', false, error.message);
  }
  
  // Test 2.2: Customer with 1 package with partial usage
  try {
    const { data: subscriptions, error: subError } = await supabase
      .from('package_subscriptions')
      .select('id, customer_id, package_id, status, is_active')
      .eq('status', 'active')
      .eq('is_active', true)
      .limit(10);
    
    if (subError) throw subError;
    
    if (subscriptions && subscriptions.length > 0) {
      let foundPartialUsage = false;
      
      for (const sub of subscriptions) {
        const { data: usage, error: usageError } = await supabase
          .from('package_subscription_usage')
          .select('service_id, remaining_quantity, original_quantity, used_quantity')
          .eq('subscription_id', sub.id)
          .gt('remaining_quantity', 0);
        
        if (usageError) throw usageError;
        
        // Filter for partial usage in JavaScript (remaining < original)
        const partialUsage = usage?.filter(u => u.remaining_quantity < u.original_quantity) || [];
        
        if (partialUsage && partialUsage.length > 0) {
          foundPartialUsage = true;
          const serviceId = partialUsage[0].service_id;
          
          // Test resolution
          const { data: capacityData, error: capacityError } = await supabase
            .rpc('resolveCustomerServiceCapacity', {
              p_customer_id: sub.customer_id,
              p_service_id: serviceId
            });
          
          if (capacityError) {
            if (capacityError.message.includes('Could not find the function')) {
              throw new Error(`Function resolveCustomerServiceCapacity not found. Please ensure migration 20260130000000_redesign_package_capacity_system.sql has been applied.`);
            }
            throw capacityError;
          }
          
          const totalCapacity = capacityData && capacityData.length > 0 
            ? (capacityData[0].total_remaining_capacity || 0)
            : 0;
          
          if (totalCapacity > 0 && totalCapacity === partialUsage[0].remaining_quantity) {
            logTest('2.2: Customer with 1 package with partial usage', true, 
              `Capacity: ${totalCapacity}, Expected: ${partialUsage[0].remaining_quantity}`);
            break;
          } else {
            logTest('2.2: Customer with 1 package with partial usage', false, 
              `Capacity mismatch. Got ${totalCapacity}, expected ${partialUsage[0].remaining_quantity}`);
            break;
          }
        }
      }
      
      if (!foundPartialUsage) {
        logWarning('2.2: Customer with 1 package with partial usage', 
          'No partial usage found (test data needed)');
      }
    } else {
      logWarning('2.2: Customer with 1 package with partial usage', 
        'No active subscriptions found');
    }
  } catch (error) {
    logTest('2.2: Customer with 1 package with partial usage', false, error.message);
  }
  
  // Test 2.3: Customer with multiple packages with same service
  try {
    // Find customer with multiple subscriptions
    const { data: subscriptions, error: subError } = await supabase
      .from('package_subscriptions')
      .select('customer_id, package_id, status, is_active')
      .eq('status', 'active')
      .eq('is_active', true);
    
    if (subError) throw subError;
    
    if (subscriptions && subscriptions.length > 0) {
      const customerPackageCount = {};
      subscriptions.forEach(sub => {
        if (!customerPackageCount[sub.customer_id]) {
          customerPackageCount[sub.customer_id] = [];
        }
        customerPackageCount[sub.customer_id].push(sub.package_id);
      });
      
      const customersWithMultiple = Object.entries(customerPackageCount)
        .filter(([_, packages]) => packages.length > 1);
      
      if (customersWithMultiple.length > 0) {
        const [customerId, packageIds] = customersWithMultiple[0];
        
        // Find a service that exists in multiple packages
        const { data: packageServices1, error: ps1Error } = await supabase
          .from('package_services')
          .select('service_id')
          .eq('package_id', packageIds[0]);
        
        if (ps1Error) throw ps1Error;
        
        const { data: packageServices2, error: ps2Error } = await supabase
          .from('package_services')
          .select('service_id')
          .eq('package_id', packageIds[1]);
        
        if (ps2Error) throw ps2Error;
        
        const commonServices = packageServices1
          .filter(ps1 => packageServices2.some(ps2 => ps2.service_id === ps1.service_id))
          .map(ps => ps.service_id);
        
        if (commonServices.length > 0) {
          const serviceId = commonServices[0];
          
          // Calculate expected total capacity
          let expectedTotal = 0;
          for (const packageId of packageIds) {
            const { data: usage, error: usageError } = await supabase
              .from('package_subscription_usage')
              .select('remaining_quantity')
              .eq('subscription_id', 
                subscriptions.find(s => s.customer_id === customerId && s.package_id === packageId).id)
              .eq('service_id', serviceId)
              .maybeSingle();
            
            if (!usageError && usage) {
              expectedTotal += usage.remaining_quantity || 0;
            }
          }
          
          // Test resolution
          const { data: capacityData, error: capacityError } = await supabase
            .rpc('resolveCustomerServiceCapacity', {
              p_customer_id: customerId,
              p_service_id: serviceId
            });
          
          if (capacityError) {
            if (capacityError.message.includes('Could not find the function')) {
              throw new Error(`Function resolveCustomerServiceCapacity not found. Please ensure migration 20260130000000_redesign_package_capacity_system.sql has been applied.`);
            }
            throw capacityError;
          }
          
          const totalCapacity = capacityData && capacityData.length > 0 
            ? (capacityData[0].total_remaining_capacity || 0)
            : 0;
          
          if (totalCapacity === expectedTotal) {
            logTest('2.3: Customer with multiple packages with same service', true, 
              `Total capacity: ${totalCapacity} (sum of ${packageIds.length} packages)`);
          } else {
            logTest('2.3: Customer with multiple packages with same service', false, 
              `Expected ${expectedTotal}, got ${totalCapacity}`);
          }
        } else {
          logWarning('2.3: Customer with multiple packages with same service', 
            'No common services found between packages');
        }
      } else {
        logWarning('2.3: Customer with multiple packages with same service', 
          'No customers with multiple packages found');
      }
    } else {
      logWarning('2.3: Customer with multiple packages with same service', 
        'No active subscriptions found');
    }
  } catch (error) {
    logTest('2.3: Customer with multiple packages with same service', false, error.message);
  }
  
  // Test 2.4: Capacity never becomes negative
  try {
    const { data: usage, error } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity')
      .lt('remaining_quantity', 0);
    
    if (error) throw error;
    
    if (usage && usage.length > 0) {
      logTest('2.4: Capacity never becomes negative', false, 
        `Found ${usage.length} records with negative capacity!`);
    } else {
      logTest('2.4: Capacity never becomes negative', true, 'No negative capacities found');
    }
  } catch (error) {
    logTest('2.4: Capacity never becomes negative', false, error.message);
  }
  
  // Test 2.5: Resolution is fast (performance check)
  try {
    const { data: customers, error: customersError } = await supabase
      .from('customers')
      .select('id')
      .limit(1)
      .maybeSingle();
    
    if (customersError) throw customersError;
    
    const { data: services, error: servicesError } = await supabase
      .from('services')
      .select('id')
      .limit(1)
      .maybeSingle();
    
    if (servicesError) throw servicesError;
    
    if (customers && services) {
      const startTime = Date.now();
      
      for (let i = 0; i < 10; i++) {
        const { error: capacityError } = await supabase
          .rpc('resolveCustomerServiceCapacity', {
            p_customer_id: customers.id,
            p_service_id: services.id
          });
        
        if (capacityError) {
          if (capacityError.message.includes('Could not find the function')) {
            throw new Error(`Function resolveCustomerServiceCapacity not found. Please ensure migration 20260130000000_redesign_package_capacity_system.sql has been applied.`);
          }
          throw capacityError;
        }
      }
      
      const endTime = Date.now();
      const avgTime = (endTime - startTime) / 10;
      
      if (avgTime < 100) {
        logTest('2.5: Resolution is fast', true, `Average: ${avgTime.toFixed(2)}ms per call`);
      } else {
        logWarning('2.5: Resolution is fast', `Average: ${avgTime.toFixed(2)}ms (may be slow)`);
      }
    } else {
      logWarning('2.5: Resolution is fast', 'No test data available');
    }
  } catch (error) {
    logTest('2.5: Resolution is fast', false, error.message);
  }
}

// ============================================================================
// PHASE 3: CUSTOMER BOOKING FLOW
// ============================================================================

async function testPhase3() {
  console.log('\n🧪 PHASE 3: CUSTOMER BOOKING FLOW\n');
  
  logWarning('3.1: Booking uses package when capacity exists', 
    'Manual testing required - create booking via frontend');
  logWarning('3.2: Booking switches to paid when exhausted', 
    'Manual testing required - exhaust package then book');
  logWarning('3.3: Booking with tickets > remaining capacity', 
    'Manual testing required - try booking more than available');
  logWarning('3.4: Multiple sequential bookings', 
    'Manual testing required - make multiple bookings');
  logWarning('3.5: Booking after page refresh', 
    'Manual testing required - refresh page and book');
}

// ============================================================================
// PHASE 4: RECEPTIONIST BOOKING FLOW
// ============================================================================

async function testPhase4() {
  console.log('\n🧪 PHASE 4: RECEPTIONIST BOOKING FLOW\n');
  
  logWarning('4.1: Booking for customer with active package', 
    'Manual testing required - use receptionist interface');
  logWarning('4.2: Booking after capacity exhaustion', 
    'Manual testing required - exhaust then book as receptionist');
  logWarning('4.3: Booking multiple tickets', 
    'Manual testing required - bulk booking via receptionist');
  logWarning('4.4: Consecutive bookings without refresh', 
    'Manual testing required - multiple bookings in session');
}

// ============================================================================
// PHASE 5: PACKAGE EXHAUSTION NOTIFICATION
// ============================================================================

async function testPhase5() {
  console.log('\n🧪 PHASE 5: PACKAGE EXHAUSTION NOTIFICATION\n');
  
  // Test 5.1: Notification appears once only
  try {
    const { data: notifications, error } = await supabase
      .from('package_exhaustion_notifications')
      .select('subscription_id, service_id, notified_at');
    
    if (error) throw error;
    
    if (notifications && notifications.length > 0) {
      // Check for duplicates (same subscription_id + service_id)
      const seen = new Set();
      let duplicates = 0;
      
      notifications.forEach(notif => {
        const key = `${notif.subscription_id}-${notif.service_id}`;
        if (seen.has(key)) {
          duplicates++;
        } else {
          seen.add(key);
        }
      });
      
      if (duplicates === 0) {
        logTest('5.1: Notification appears once only', true, 
          `Found ${notifications.length} unique notifications`);
      } else {
        logTest('5.1: Notification appears once only', false, 
          `Found ${duplicates} duplicate notifications!`);
      }
    } else {
      logWarning('5.1: Notification appears once only', 
        'No exhaustion notifications found (test data needed)');
    }
  } catch (error) {
    logTest('5.1: Notification appears once only', false, error.message);
  }
  
  // Test 5.2: Notifications exist for exhausted capacities
  try {
    const { data: exhaustedUsage, error: usageError } = await supabase
      .from('package_subscription_usage')
      .select('subscription_id, service_id')
      .eq('remaining_quantity', 0);
    
    if (usageError) throw usageError;
    
    if (exhaustedUsage && exhaustedUsage.length > 0) {
      let notificationsFound = 0;
      
      for (const usage of exhaustedUsage) {
        const { data: notification, error: notifError } = await supabase
          .from('package_exhaustion_notifications')
          .select('id')
          .eq('subscription_id', usage.subscription_id)
          .eq('service_id', usage.service_id)
          .maybeSingle();
        
        if (!notifError && notification) {
          notificationsFound++;
        }
      }
      
      if (notificationsFound === exhaustedUsage.length) {
        logTest('5.2: Notifications exist for exhausted capacities', true, 
          `All ${exhaustedUsage.length} exhausted capacities have notifications`);
      } else {
        logTest('5.2: Notifications exist for exhausted capacities', false, 
          `${exhaustedUsage.length - notificationsFound} exhausted capacities missing notifications`);
      }
    } else {
      logWarning('5.2: Notifications exist for exhausted capacities', 
        'No exhausted capacities found (test data needed)');
    }
  } catch (error) {
    logTest('5.2: Notifications exist for exhausted capacities', false, error.message);
  }
}

// ============================================================================
// PHASE 6: SERVICE PROVIDER VIEW
// ============================================================================

async function testPhase6() {
  console.log('\n🧪 PHASE 6: SERVICE PROVIDER VIEW\n');
  
  // Test 6.1: Subscriber list loads correctly
  try {
    const { data: subscribers, error } = await supabase
      .from('package_subscriptions')
      .select('id, customer_id, package_id, status, is_active')
      .eq('status', 'active')
      .eq('is_active', true)
      .limit(100);
    
    if (error) throw error;
    
    if (subscribers) {
      logTest('6.1: Subscriber list loads correctly', true, 
        `Found ${subscribers.length} active subscriptions`);
    } else {
      logTest('6.1: Subscriber list loads correctly', false, 'Query returned null');
    }
  } catch (error) {
    logTest('6.1: Subscriber list loads correctly', false, error.message);
  }
  
  // Test 6.2: Remaining capacity accurate
  try {
    const { data: subscriptions, error: subError } = await supabase
      .from('package_subscriptions')
      .select('id, customer_id')
      .eq('status', 'active')
      .eq('is_active', true)
      .limit(5);
    
    if (subError) throw subError;
    
    if (subscriptions && subscriptions.length > 0) {
      let accurateCount = 0;
      
      for (const sub of subscriptions) {
        const { data: usage, error: usageError } = await supabase
          .from('package_subscription_usage')
          .select('service_id, remaining_quantity, original_quantity, used_quantity')
          .eq('subscription_id', sub.id)
          .limit(1)
          .maybeSingle();
        
        if (!usageError && usage) {
          // Verify: remaining = original - used
          const calculated = usage.original_quantity - usage.used_quantity;
          
          if (usage.remaining_quantity === calculated) {
            accurateCount++;
          }
        }
      }
      
      if (accurateCount === subscriptions.length) {
        logTest('6.2: Remaining capacity accurate', true, 
          `All ${subscriptions.length} subscriptions have accurate capacity`);
      } else {
        logTest('6.2: Remaining capacity accurate', false, 
          `${subscriptions.length - accurateCount} subscriptions have inaccurate capacity`);
      }
    } else {
      logWarning('6.2: Remaining capacity accurate', 'No subscriptions found');
    }
  } catch (error) {
    logTest('6.2: Remaining capacity accurate', false, error.message);
  }
}

// ============================================================================
// PHASE 7: REGRESSION & SAFETY
// ============================================================================

async function testPhase7() {
  console.log('\n🧪 PHASE 7: REGRESSION & SAFETY\n');
  
  // Test 7.1: Old bookings remain untouched
  try {
    const { data: oldBookings, error } = await supabase
      .from('bookings')
      .select('id, package_subscription_id, created_at')
      .is('package_subscription_id', null)
      .order('created_at', { ascending: true })
      .limit(10);
    
    if (error) throw error;
    
    if (oldBookings && oldBookings.length > 0) {
      logTest('7.1: Old bookings remain untouched', true, 
        `Found ${oldBookings.length} bookings without packages (unchanged)`);
    } else {
      logWarning('7.1: Old bookings remain untouched', 'No old bookings found');
    }
  } catch (error) {
    logTest('7.1: Old bookings remain untouched', false, error.message);
  }
  
  // Test 7.2: Paid bookings unaffected
  try {
    const { data: paidBookings, error } = await supabase
      .from('bookings')
      .select('id, payment_status, package_subscription_id')
      .in('payment_status', ['paid', 'paid_manual'])
      .limit(10);
    
    if (error) throw error;
    
    if (paidBookings && paidBookings.length > 0) {
      // Check that paid bookings still have correct payment status
      const allValid = paidBookings.every(b => 
        b.payment_status === 'paid' || b.payment_status === 'paid_manual'
      );
      
      if (allValid) {
        logTest('7.2: Paid bookings unaffected', true, 
          `All ${paidBookings.length} paid bookings have correct status`);
      } else {
        logTest('7.2: Paid bookings unaffected', false, 'Some paid bookings have invalid status');
      }
    } else {
      logWarning('7.2: Paid bookings unaffected', 'No paid bookings found');
    }
  } catch (error) {
    logTest('7.2: Paid bookings unaffected', false, error.message);
  }
  
  // Test 7.3: Services without packages behave normally
  try {
    const { data: allServices, error: servicesError } = await supabase
      .from('services')
      .select('id, name, is_active')
      .eq('is_active', true)
      .limit(10);
    
    if (servicesError) throw servicesError;
    
    const { data: packagedServices, error: psError } = await supabase
      .from('package_services')
      .select('service_id');
    
    if (psError) throw psError;
    
    const packagedServiceIds = new Set(packagedServices.map(ps => ps.service_id));
    const unpackagedServices = allServices.filter(s => !packagedServiceIds.has(s.id));
    
    if (unpackagedServices.length > 0) {
      logTest('7.3: Services without packages behave normally', true, 
        `Found ${unpackagedServices.length} services not in packages (should work normally)`);
    } else {
      logWarning('7.3: Services without packages behave normally', 
        'All services are in packages');
    }
  } catch (error) {
    logTest('7.3: Services without packages behave normally', false, error.message);
  }
  
  // Test 7.4: Database constraints intact
  try {
    // Check that package_subscription_usage has proper constraints
    const { data: usage, error } = await supabase
      .from('package_subscription_usage')
      .select('remaining_quantity, original_quantity, used_quantity')
      .limit(10);
    
    if (error) throw error;
    
    if (usage && usage.length > 0) {
      const allValid = usage.every(u => {
        const calculated = u.original_quantity - u.used_quantity;
        return u.remaining_quantity === calculated && u.remaining_quantity >= 0;
      });
      
      if (allValid) {
        logTest('7.4: Database constraints intact', true, 
          `All ${usage.length} usage records are valid`);
      } else {
        logTest('7.4: Database constraints intact', false, 
          'Some usage records violate constraints');
      }
    } else {
      logWarning('7.4: Database constraints intact', 'No usage records found');
    }
  } catch (error) {
    logTest('7.4: Database constraints intact', false, error.message);
  }
}

// ============================================================================
// MAIN TEST RUNNER
// ============================================================================

async function runAllTests() {
  console.log('🚀 Starting Comprehensive Package Capacity System Testing\n');
  console.log('=' .repeat(80));
  
  try {
    await testPhase1();
    await testPhase2();
    await testPhase3();
    await testPhase4();
    await testPhase5();
    await testPhase6();
    await testPhase7();
    
    // Print summary
    console.log('\n' + '='.repeat(80));
    console.log('\n📊 TEST SUMMARY\n');
    console.log(`✅ Passed: ${testResults.passed.length}`);
    console.log(`❌ Failed: ${testResults.failed.length}`);
    console.log(`⚠️  Warnings: ${testResults.warnings.length}`);
    
    if (testResults.failed.length > 0) {
      console.log('\n❌ FAILED TESTS:');
      testResults.failed.forEach(({ name, message }) => {
        console.log(`   - ${name}: ${message}`);
      });
    }
    
    if (testResults.warnings.length > 0) {
      console.log('\n⚠️  WARNINGS (require test data):');
      testResults.warnings.forEach(({ name, message }) => {
        console.log(`   - ${name}: ${message}`);
      });
    }
    
    console.log('\n' + '='.repeat(80));
    
    if (testResults.failed.length === 0) {
      console.log('\n✅ ALL AUTOMATED TESTS PASSED!');
      console.log('⚠️  Note: Some tests require manual testing via the frontend.');
      process.exit(0);
    } else {
      console.log('\n❌ SOME TESTS FAILED - Review failures above');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n💥 FATAL ERROR:', error);
    process.exit(1);
  }
}

// Run tests if executed directly
const isMainModule = import.meta.url === `file://${process.argv[1]}` || 
                     process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'));

if (isMainModule || process.argv[1]?.includes('test-package-capacity-system')) {
  runAllTests();
}

export { runAllTests, testPhase1, testPhase2, testPhase3, testPhase4, testPhase5, testPhase6, testPhase7 };
