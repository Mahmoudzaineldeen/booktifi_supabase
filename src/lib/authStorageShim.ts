const AUTH_STORAGE_KEYS = new Set([
  'auth_token',
  'auth_session',
  'user_data',
  'supabase.auth.token',
  'impersonation_log_id',
  'impersonation_original_session',
  'auth_last_activity_ms',
]);

let shimInstalled = false;

function isAuthKey(key: string): boolean {
  return AUTH_STORAGE_KEYS.has(key);
}

export function installAuthStorageShim(): void {
  if (typeof window === 'undefined' || shimInstalled) return;

  const local = window.localStorage;
  const session = window.sessionStorage;

  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  Storage.prototype.getItem = function patchedGetItem(key: string): string | null {
    if (this === local && isAuthKey(key)) {
      const scopedValue = originalGetItem.call(session, key);
      if (scopedValue !== null) return scopedValue;

      // One-time migration path from legacy localStorage sessions.
      const legacyValue = originalGetItem.call(local, key);
      if (legacyValue !== null) {
        originalSetItem.call(session, key, legacyValue);
        originalRemoveItem.call(local, key);
      }
      return legacyValue;
    }
    return originalGetItem.call(this, key);
  };

  Storage.prototype.setItem = function patchedSetItem(key: string, value: string): void {
    if (this === local && isAuthKey(key)) {
      // Keep auth/session data isolated per tab/window.
      originalSetItem.call(session, key, value);
      originalRemoveItem.call(local, key);
      return;
    }
    originalSetItem.call(this, key, value);
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key: string): void {
    if (this === local && isAuthKey(key)) {
      originalRemoveItem.call(session, key);
      originalRemoveItem.call(local, key);
      return;
    }
    originalRemoveItem.call(this, key);
  };

  shimInstalled = true;
}

installAuthStorageShim();
