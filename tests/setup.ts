/**
 * Test Setup File
 * Runs before all tests
 *
 * Loads env files so integration tests (e.g. trial-expiry, pricing-tags) see
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from server/.env before test modules read process.env.
 */

import path from 'path';
import { fileURLToPath } from 'url';
import { config as loadEnv } from 'dotenv';
import { beforeAll, afterAll } from 'vitest';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv({ path: path.resolve(__dirname, '../.env') });
loadEnv({ path: path.resolve(__dirname, '../.env.local') });
loadEnv({ path: path.resolve(__dirname, '../server/.env'), override: true });

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

