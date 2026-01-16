/**
 * Test Setup File
 * Runs before all tests
 */

import { beforeAll, afterAll } from 'vitest';

// Mock localStorage for Node environment
const localStorageMock = {
  getItem: (key: string) => null,
  setItem: (key: string, value: string) => {},
  removeItem: (key: string) => {},
  clear: () => {},
  length: 0,
  key: (index: number) => null,
};

// Setup test environment
beforeAll(() => {
  // Set test environment variables
  process.env.NODE_ENV = 'test';
  process.env.VITE_SUPABASE_URL = process.env.VITE_SUPABASE_URL || 'http://localhost:54321';
  process.env.VITE_SUPABASE_ANON_KEY = process.env.VITE_SUPABASE_ANON_KEY || 'test-key';
  
  // Mock localStorage globally
  global.localStorage = localStorageMock as any;
});

// Cleanup after all tests
afterAll(() => {
  // Cleanup if needed
});

