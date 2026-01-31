/**
 * Short-term in-memory cache for employee-based availability.
 * Key: tenantId:serviceId:dateStr — cache is scoped per tenant (never shared across tenants).
 * TTL: 90 seconds. Invalidated on booking create/cancel, shift edit, employee assign/unassign.
 */

const TTL_MS = 90 * 1000; // 90 seconds

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function cacheKey(tenantId: string, serviceId: string, dateStr: string): string {
  return `employee_availability:${tenantId}:${serviceId}:${dateStr}`;
}

/**
 * Get cached result for employee availability. Returns undefined on miss or expiry.
 */
export function getEmployeeAvailabilityCached<T>(
  tenantId: string,
  serviceId: string,
  dateStr: string
): T | undefined {
  const key = cacheKey(tenantId, serviceId, dateStr);
  const entry = cache.get(key) as CacheEntry<T> | undefined;
  if (!entry || Date.now() > entry.expiresAt) {
    if (entry) cache.delete(key);
    return undefined;
  }
  return entry.data;
}

/**
 * Set cached result for employee availability.
 */
export function setEmployeeAvailabilityCached<T>(
  tenantId: string,
  serviceId: string,
  dateStr: string,
  data: T
): void {
  const key = cacheKey(tenantId, serviceId, dateStr);
  cache.set(key, { data, expiresAt: Date.now() + TTL_MS });
}

/**
 * Invalidate cache for a specific service/date (e.g. after booking created/cancelled).
 * Call with serviceId and dateStr when you know them; otherwise use invalidateForService or invalidateForTenant.
 */
export function invalidateEmployeeAvailability(
  tenantId: string,
  serviceId?: string,
  dateStr?: string
): void {
  if (!serviceId && !dateStr) {
    // Invalidate all entries for this tenant
    for (const key of cache.keys()) {
      if (key.startsWith(`employee_availability:${tenantId}:`)) cache.delete(key);
    }
    return;
  }
  if (serviceId && dateStr) {
    cache.delete(cacheKey(tenantId, serviceId, dateStr));
    return;
  }
  if (serviceId) {
    for (const key of cache.keys()) {
      if (key.startsWith(`employee_availability:${tenantId}:${serviceId}:`)) cache.delete(key);
    }
  }
}

/**
 * Invalidate all cache entries for a tenant (e.g. after shift edit or employee assign/unassign).
 */
export function invalidateEmployeeAvailabilityForTenant(tenantId: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(`employee_availability:${tenantId}:`)) cache.delete(key);
  }
}
