/**
 * Backend API Test Configuration
 * Centralized configuration for all backend tests
 */

export const CONFIG = {
  // Railway Backend URL
  API_BASE_URL: 'https://booktifisupabase-production.up.railway.app/api',
  
  // Test Accounts
  ACCOUNTS: {
    SERVICE_PROVIDER: {
      email: 'mahmoudnzaineldeen@gmail.com',
      password: '111111',
      role: 'tenant_admin',
      expectedRole: 'tenant_admin'
    },
    CUSTOMER: {
      email: 'kaptifidev@gmail.com',
      password: '111111',
      role: 'customer',
      expectedRole: 'customer'
    },
    CASHIER: {
      email: 'cash@gmail.com',
      password: '111111',
      role: 'cashier',
      expectedRole: 'cashier'
    },
    RECEPTIONIST: {
      email: 'receptionist@test.com',
      password: 'test123',
      role: 'receptionist',
      expectedRole: 'receptionist'
    }
  },
  
  // Test Timeouts
  TIMEOUTS: {
    SHORT: 5000,    // 5 seconds
    MEDIUM: 15000,  // 15 seconds
    LONG: 30000,    // 30 seconds (for cold starts)
    VERY_LONG: 60000 // 60 seconds (for complex operations)
  },
  
  // Test Data
  TEST_DATA: {
    // Will be populated during tests
    serviceProviderToken: null,
    customerToken: null,
    serviceProviderId: null,
    customerId: null,
    tenantId: null,
    serviceId: null,
    bookingId: null,
    ticketId: null,
    invoiceId: null
  }
};

/**
 * Helper: Make API request
 */
export async function apiRequest(endpoint, options = {}) {
  const url = `${CONFIG.API_BASE_URL}${endpoint}`;
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      ...(CONFIG.TEST_DATA.serviceProviderToken && { 
        'Authorization': `Bearer ${CONFIG.TEST_DATA.serviceProviderToken}` 
      }),
      ...options.headers
    }
  };
  
  const response = await fetch(url, {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...options.headers
    }
  });
  
  const data = await response.json().catch(() => ({ error: 'Invalid JSON response' }));
  
  return {
    status: response.status,
    ok: response.ok,
    data,
    headers: response.headers
  };
}

/**
 * Helper: Wait for async operation
 */
export function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Helper: Log test result
 */
export function logTest(name, passed, message = '') {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}${message ? `: ${message}` : ''}`);
  return passed;
}
