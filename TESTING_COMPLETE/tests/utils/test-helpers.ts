/**
 * Test Helper Utilities
 * Common functions for testing Bookati platform
 */

import { db } from '../../src/lib/db';

export interface TestUser {
  id: string;
  email: string;
  password: string;
  role: 'tenant_admin' | 'receptionist' | 'employee' | 'customer';
  tenant_id?: string;
}

export interface TestTenant {
  id: string;
  slug: string;
  name: string;
}

export interface TestService {
  id: string;
  tenant_id: string;
  name: string;
  base_price: number;
  duration_minutes: number;
}

/**
 * Create a test tenant
 */
export async function createTestTenant(name: string, slug: string): Promise<TestTenant> {
  const { data, error } = await db
    .from('tenants')
    .insert({
      name,
      slug,
      industry: 'test',
      is_active: true,
      public_page_enabled: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data as TestTenant;
}

/**
 * Create a test user
 */
export async function createTestUser(
  email: string,
  password: string,
  role: TestUser['role'],
  tenantId?: string
): Promise<TestUser> {
  // Note: In real implementation, this would use the auth API
  // This is a simplified version for testing
  const { data, error } = await db
    .from('users')
    .insert({
      email,
      full_name: `Test ${role}`,
      role,
      tenant_id: tenantId,
      is_active: true,
    })
    .select()
    .single();

  if (error) throw error;
  return { ...data, password } as TestUser;
}

/**
 * Create a test service
 */
export async function createTestService(
  tenantId: string,
  name: string,
  price: number = 100,
  duration: number = 60
): Promise<TestService> {
  const { data, error } = await db
    .from('services')
    .insert({
      tenant_id: tenantId,
      name,
      base_price: price,
      duration_minutes: duration,
      capacity_per_slot: 1,
      is_active: true,
      is_public: true,
    })
    .select()
    .single();

  if (error) throw error;
  return data as TestService;
}

/**
 * Clean up test data
 */
export async function cleanupTestData(tenantId: string): Promise<void> {
  // Delete in reverse order of dependencies
  await db.from('bookings').delete().eq('tenant_id', tenantId);
  await db.from('services').delete().eq('tenant_id', tenantId);
  await db.from('users').delete().eq('tenant_id', tenantId);
  await db.from('tenants').delete().eq('id', tenantId);
}

/**
 * Wait for async operation to complete
 */
export function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Generate random test data
 */
export function randomString(length: number = 8): string {
  return Math.random().toString(36).substring(2, length + 2);
}

export function randomEmail(): string {
  return `test-${randomString()}@test.com`;
}

export function randomPhone(): string {
  return `+96650${Math.floor(Math.random() * 10000000)}`;
}

/**
 * Assert booking was created correctly
 */
export function assertBooking(booking: any): void {
  expect(booking).toBeDefined();
  expect(booking.id).toBeDefined();
  expect(booking.tenant_id).toBeDefined();
  expect(booking.service_id).toBeDefined();
  expect(booking.slot_id).toBeDefined();
  expect(booking.customer_name).toBeDefined();
  expect(booking.customer_phone).toBeDefined();
  expect(booking.status).toBeDefined();
  expect(['pending', 'confirmed', 'cancelled', 'completed']).toContain(booking.status);
}

/**
 * Assert slot capacity was updated correctly
 */
export async function assertSlotCapacity(
  slotId: string,
  expectedCapacity: number
): Promise<void> {
  const { data, error } = await db
    .from('time_slots')
    .select('remaining_capacity')
    .eq('id', slotId)
    .single();

  if (error) throw error;
  expect(data?.remaining_capacity).toBe(expectedCapacity);
}

