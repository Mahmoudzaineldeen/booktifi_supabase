/**
 * Load Test Script for Bookati API
 * Uses k6-style approach (can be adapted to actual k6 script)
 * 
 * To run with k6:
 * k6 run tests/performance/load-test.js
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

// Custom metrics
const errorRate = new Rate('errors');

// Test configuration
export const options = {
  stages: [
    { duration: '2m', target: 50 },   // Ramp up to 50 users
    { duration: '5m', target: 50 },   // Stay at 50 users
    { duration: '2m', target: 100 },  // Ramp up to 100 users
    { duration: '5m', target: 100 },  // Stay at 100 users
    { duration: '2m', target: 0 },    // Ramp down
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests should be below 2s
    http_req_failed: ['rate<0.05'],    // Error rate should be less than 5%
    errors: ['rate<0.1'],
  },
};

const BASE_URL = __ENV.API_URL || 'http://localhost:3001/api';
const TEST_TENANT_SLUG = __ENV.TEST_TENANT_SLUG || 'test-tenant';

export default function () {
  // Test 1: Health check
  let res = http.get(`${BASE_URL}/health`);
  check(res, {
    'health check status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(1);

  // Test 2: Get services (public endpoint)
  res = http.get(`${BASE_URL}/query/select/services?tenant_slug=${TEST_TENANT_SLUG}`);
  check(res, {
    'services list status is 200': (r) => r.status === 200,
    'services list has data': (r) => JSON.parse(r.body).length > 0,
  }) || errorRate.add(1);

  sleep(1);

  // Test 3: Get available slots
  res = http.get(`${BASE_URL}/bookings/slots?tenant_slug=${TEST_TENANT_SLUG}&service_id=test-service-id`);
  check(res, {
    'slots status is 200': (r) => r.status === 200,
  }) || errorRate.add(1);

  sleep(2);
}

export function handleSummary(data) {
  return {
    'stdout': textSummary(data, { indent: ' ', enableColors: true }),
    'load-test-results.json': JSON.stringify(data),
  };
}


