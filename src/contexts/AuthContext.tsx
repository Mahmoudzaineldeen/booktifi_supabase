import React, { createContext, useContext, useEffect, useState } from 'react';
import { db } from '../lib/db';
import { User, UserRole, Tenant } from '../types';
import { showNotification } from './NotificationContext';

interface AuthUser {
  id: string;
  email?: string;
  username?: string;
}

const IMPERSONATION_LOG_ID_KEY = 'impersonation_log_id';
const IMPERSONATION_ORIGINAL_SESSION_KEY = 'impersonation_original_session';
const AUTH_LAST_ACTIVITY_KEY = 'auth_last_activity_ms';
const IDLE_TIMEOUT_MS = 60 * 60 * 1000; // 1 hour idle timeout

interface AuthContextType {
  user: AuthUser | null;
  userProfile: User | null;
  tenant: Tenant | null;
  loading: boolean;
  /** RBAC: permission IDs for current user (from role or legacy role) */
  permissions: string[];
  signIn: (email: string, password: string) => Promise<{ error?: Error; userProfile?: User; tenant?: Tenant }>;
  signUp: (email: string, password: string, fullName: string, role: UserRole, tenantId?: string) => Promise<{ error?: Error }>;
  signOut: () => Promise<void>;
  /** Re-read session from localStorage and fetch user profile (e.g. after signup so UI is logged in) */
  refreshSessionFromStorage: () => Promise<void>;
  /** Refetch current user permissions from backend (e.g. after role permissions were updated so UI reflects new access) */
  refetchPermissions: () => Promise<void>;
  hasRole: (roles: UserRole[]) => boolean;
  /** RBAC: whether current user has the given permission */
  hasPermission: (permissionId: string) => boolean;
  /** Apply session from admin impersonation (sets token + user + tenant; optional originalSession + log id for exit) */
  applyImpersonation: (data: {
    user: User;
    tenant: Tenant | null;
    session: { access_token: string };
    impersonation_log_id?: string;
    originalSession?: { access_token: string; userProfile: User; tenant: Tenant | null };
  }) => void;
  /** True when current session is an impersonation (Solution Owner logged in as another user) */
  isImpersonating: boolean;
  /** End impersonation and restore Solution Owner session */
  exitImpersonation: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

// Debug logging helper
const DEBUG = true; // Set to false to disable debug logs
const debugLog = (event: string, data: any) => {
  if (DEBUG) {
    console.log(`[AuthContext] ${event}`, {
      ...data,
      timestamp: new Date().toISOString(),
      stack: new Error().stack?.split('\n').slice(1, 4).join('\n'),
    });
  }
};

function parseJwtExpiryMs(token: string | null): number | null {
  if (!token) return null;
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = atob(parts[1].replace(/-/g, '+').replace(/_/g, '/'));
    const payload = JSON.parse(payloadJson);
    if (!payload?.exp) return null;
    return Number(payload.exp) * 1000;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [userProfile, setUserProfile] = useState<User | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [isImpersonating, setIsImpersonating] = useState(() => {
    if (typeof localStorage === 'undefined') return false;
    return !!(localStorage.getItem(IMPERSONATION_LOG_ID_KEY) && localStorage.getItem(IMPERSONATION_ORIGINAL_SESSION_KEY));
  });
  const fetchingProfileRef = React.useRef<string | null>(null);
  const userProfileRef = React.useRef<User | null>(null);
  const idleCheckIntervalRef = React.useRef<NodeJS.Timeout | null>(null);
  const lastActivityWriteRef = React.useRef<number>(0);
  const sessionExpiryHandledRef = React.useRef(false);

  const markActivity = React.useCallback(() => {
    const now = Date.now();
    if (now - lastActivityWriteRef.current < 15000) return; // throttle writes
    lastActivityWriteRef.current = now;
    try {
      localStorage.setItem(AUTH_LAST_ACTIVITY_KEY, String(now));
    } catch {
      // ignore storage errors
    }
  }, []);

  const getLastActivityMs = React.useCallback(() => {
    const raw = localStorage.getItem(AUTH_LAST_ACTIVITY_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : Date.now();
  }, []);

  // Keep ref in sync with state
  useEffect(() => {
    const prevProfile = userProfileRef.current;
    userProfileRef.current = userProfile;
    
    if (prevProfile !== userProfile) {
      debugLog('UserProfile State Changed', {
        prevId: prevProfile?.id,
        newId: userProfile?.id,
        prevRole: prevProfile?.role,
        newRole: userProfile?.role,
      });
    }
  }, [userProfile]);

  useEffect(() => {
    let isMounted = true;

    debugLog('AuthProvider Mounted', {});

    // Check active session
    db.auth.getSession().then(({ data: { session } }) => {
      if (!isMounted) {
        debugLog('Component Unmounted Before Session Check', {});
        return;
      }
      
      debugLog('Session Check Complete', {
        hasSession: !!session,
        userId: session?.user?.id,
      });
      
      setUser(session?.user ?? null);
      if (session?.user) {
        // Only fetch if we don't have a profile or if the user ID changed
        const currentProfile = userProfileRef.current;
        if (!currentProfile || currentProfile.id !== session.user.id) {
          debugLog('Fetching User Profile', {
            reason: !currentProfile ? 'no_profile' : 'user_id_changed',
            currentProfileId: currentProfile?.id,
            sessionUserId: session.user.id,
          });
          fetchUserProfile(session.user.id);
        } else {
          debugLog('Skipping Profile Fetch', {
            reason: 'profile_exists_and_matches',
            profileId: currentProfile.id,
          });
          setLoading(false);
        }
      } else {
        debugLog('No Session Found', {});
        setLoading(false);
      }
    });

    // Listen for auth changes
    const { data: { subscription } } = db.auth.onAuthStateChange((event, session) => {
      if (!isMounted) {
        debugLog('Component Unmounted Before Auth State Change', { event });
        return;
      }
      
      debugLog('Auth State Change', {
        event,
        hasSession: !!session,
        userId: session?.user?.id,
      });

      // Only handle actual auth events, not token refreshes
      if (event === 'SIGNED_OUT') {
        debugLog('SIGNED_OUT Event', {});
        setUser(null);
        setUserProfile(null);
        setTenant(null);
        setPermissions([]);
        setLoading(false);
        fetchingProfileRef.current = null;
        userProfileRef.current = null;
      } else if (event === 'SIGNED_IN' || event === 'USER_UPDATED') {
        debugLog('SIGNED_IN/USER_UPDATED Event', { event });
        setUser(session?.user ?? null);
        if (session?.user) {
          // Only fetch if we don't have a profile or if the user ID changed
          const currentProfile = userProfileRef.current;
          if (!currentProfile || currentProfile.id !== session.user.id) {
            debugLog('Fetching Profile After Auth Event', {
              reason: !currentProfile ? 'no_profile' : 'user_id_changed',
              currentProfileId: currentProfile?.id,
              sessionUserId: session.user.id,
            });
            fetchUserProfile(session.user.id);
          } else {
            debugLog('Skipping Profile Fetch After Auth Event', {
              reason: 'profile_exists_and_matches',
              profileId: currentProfile.id,
            });
          }
        }
      } else if (event === 'TOKEN_REFRESHED') {
        debugLog('TOKEN_REFRESHED Event', {
          hasSession: !!session,
          userId: session?.user?.id,
          currentUserProfile: !!userProfileRef.current,
        });
        // Token refresh should NEVER clear state - only update if session exists
        // If session is null, it might be a temporary issue, so keep existing state
        if (session?.user) {
          // Session exists, update user but keep profile and tenant
          setUser(session.user);
          // Don't clear or refetch - keep existing userProfile and tenant
        } else {
          // Session is null - this could be a temporary parsing issue
          // NEVER clear state on TOKEN_REFRESHED with null session
          // Only clear if we're absolutely sure there's no session
          const sessionStr = localStorage.getItem('auth_session');
          const token = localStorage.getItem('auth_token');
          
          if (!sessionStr && !token) {
            // No session at all - but still don't clear immediately
            // Wait for explicit SIGNED_OUT event
            debugLog('TOKEN_REFRESHED with no session data - keeping state (waiting for SIGNED_OUT)');
          } else {
            // Session data exists in localStorage - keep state
            debugLog('TOKEN_REFRESHED with null session but localStorage exists - keeping state');
          }
          // Always keep existing state on TOKEN_REFRESHED
        }
      }
    });

    return () => {
      debugLog('AuthProvider Unmounting', {});
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []); // Empty dependency array - only run once on mount

  async function fetchUserProfile(userId: string) {
    // Skip if userId is invalid
    if (!userId || userId === 'unknown' || userId === 'null' || userId === 'undefined') {
      debugLog('Invalid User ID - Skipping Profile Fetch', { userId });
      fetchingProfileRef.current = null;
      setLoading(false);
      return;
    }

    // Prevent duplicate fetches for the same user
    if (fetchingProfileRef.current === userId) {
      debugLog('Duplicate Fetch Prevented', { userId });
      return;
    }

    fetchingProfileRef.current = userId;
    debugLog('Fetching User Profile Started', { userId });

    try {
      // Double-check session exists before fetching
      const sessionCheck = await db.auth.getSession();
      if (!sessionCheck.data?.session) {
        debugLog('No Session During Profile Fetch', { userId });
        // Check localStorage before giving up
        const sessionStr = localStorage.getItem('auth_session');
        const token = localStorage.getItem('auth_token');
        
        if (!sessionStr && !token) {
          // No session at all
          fetchingProfileRef.current = null;
          setLoading(false);
          return;
        } else {
          // Session exists in localStorage but getSession failed
          // This might be a parsing issue - retry once
          debugLog('Session in localStorage but getSession failed - retrying', { userId });
          await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
          const retryCheck = await db.auth.getSession();
          if (!retryCheck.data?.session) {
            fetchingProfileRef.current = null;
            setLoading(false);
            return;
          }
        }
      }

      const { data, error } = await db
        .from('users')
        .select('id, tenant_id, branch_id, email, phone, full_name, full_name_ar, role, role_id, is_active, created_at, updated_at')
        .eq('id', userId)
        .maybeSingle();

      if (error) {
        debugLog('Error Fetching User Profile', { error: error.message, userId });
        fetchingProfileRef.current = null;
        
        // NEVER clear state on fetch error - always keep existing profile
        // Network errors, temporary DB issues, etc. shouldn't cause logout
        const sessionStr = localStorage.getItem('auth_session');
        const token = localStorage.getItem('auth_token');
        
        if (sessionStr || token) {
          // Session exists - keep existing profile
          debugLog('Session Exists After Fetch Error - Keeping Existing Profile', { 
            userId,
            hasExistingProfile: !!userProfileRef.current 
          });
          // Keep existing profile if it exists
          if (userProfileRef.current) {
            // Profile exists, just set loading to false
            setLoading(false);
            return;
          }
        }
        
        // No session and no existing profile - but still don't clear user state
        // Wait for explicit SIGNED_OUT event
        setLoading(false);
        return;
      }

      if (data) {
        // Check if user account is active
        if (data.is_active === false) {
          debugLog('User Account Deactivated', {
            userId: data.id,
            role: data.role,
            email: data.email,
          });
          // Sign out the user if account is deactivated
          await db.auth.signOut();
          setUser(null);
          setUserProfile(null);
          setTenant(null);
          setPermissions([]);
          userProfileRef.current = null;
          fetchingProfileRef.current = null;
          setLoading(false);
          return;
        }

        debugLog('User Profile Fetched Successfully', {
          userId: data.id,
          role: data.role,
          email: data.email,
        });
        setUserProfile(data);

        // Fetch RBAC permissions from backend (uses same JWT as auth)
        if (typeof window !== 'undefined') {
          const token = localStorage.getItem('auth_token');
          if (token) {
            try {
              const { getApiUrl } = await import('../lib/apiUrl');
              const base = getApiUrl().replace(/\/$/, '');
              const res = await fetch(`${base}/roles/permissions/me`, {
                headers: { Authorization: `Bearer ${token}` },
              });
              if (res.ok) {
                const json = await res.json();
                setPermissions(Array.isArray(json.permissions) ? json.permissions : []);
              } else {
                setPermissions([]);
              }
            } catch (_) {
              setPermissions([]);
            }
          } else {
            setPermissions([]);
          }
        }

        if (data.tenant_id) {
          debugLog('Fetching Tenant Data', { tenantId: data.tenant_id });
          const { data: tenantData } = await db
            .from('tenants')
            .select('*')
            .eq('id', data.tenant_id)
            .maybeSingle();

          if (tenantData) {
            debugLog('Tenant Data Fetched Successfully', {
              tenantId: tenantData.id,
              slug: tenantData.slug,
            });
            setTenant(tenantData);
          } else {
            debugLog('Tenant Data Not Found', { tenantId: data.tenant_id });
          }
        }
      } else {
        debugLog('User Profile Not Found', { userId });
        // User not found - check if session still exists before clearing
        const sessionStr = localStorage.getItem('auth_session');
        const token = localStorage.getItem('auth_token');
        
        if (sessionStr || token) {
          // Session exists, don't clear profile - might be a temporary DB issue
          debugLog('Session Exists But Profile Not Found - Keeping Existing Profile', {
            hasExistingProfile: !!userProfileRef.current,
            existingProfileId: userProfileRef.current?.id,
          });
          // Keep existing profile if it exists
          if (!userProfileRef.current) {
            setLoading(false);
          }
        } else {
          // No session, safe to clear
          setUserProfile((prevProfile) => {
            if (!prevProfile) {
              debugLog('Clearing Profile - No Existing Profile And No Session', {});
              setTenant(null);
              return null;
            }
            debugLog('Keeping Existing Profile - No Session But Profile Exists', {
              existingProfileId: prevProfile.id,
            });
            return prevProfile;
          });
        }
      }
    } catch (error: any) {
      debugLog('Exception Fetching User Profile', {
        error: error.message,
        userId,
      });
      fetchingProfileRef.current = null;
      // Don't clear the user profile on exception - keep existing session
      setLoading((prevLoading) => {
        if (prevLoading && !userProfileRef.current) {
          return false;
        }
        return prevLoading;
      });
      return;
    } finally {
      fetchingProfileRef.current = null;
      debugLog('Fetching User Profile Complete', { userId });
      setLoading(false);
    }
  }

  async function signIn(email: string, password: string, forCustomer: boolean = false) {
    debugLog('Sign In Started', { email, forCustomer });
    try {
      const { data: authData, error } = await db.auth.signInWithPassword({
        email,
        password,
        forCustomer,
      });

      if (error) {
        const backendMessage = (error as { error?: string }).error;
        debugLog('Sign In Error', { error: error.message, backendMessage, email, errorCode: (error as { code?: string }).code });
        console.error('Sign in API error:', error);
        
        // Use backend error message when present (e.g. "User role is missing. Cannot create authentication token.")
        let errorMessage =
          backendMessage ||
          (error as Error).message ||
          'Authentication failed';
        
        // Check for server connection errors
        if ((error as { code?: string }).code === 'NETWORK_ERROR' ||
            (error as { code?: string }).code === 'SERVER_NOT_RUNNING' ||
            (error as Error).message?.includes('Cannot connect to server') ||
            (error as Error).message?.includes('Backend server is not running') ||
            (error as Error).message?.includes('ERR_CONNECTION_REFUSED') ||
            (error as Error).message?.includes('Failed to fetch')) {
          errorMessage = 'Backend server is not running. Please start the server:\n\n1. Open terminal\n2. cd to project/server\n3. Run: npm run dev\n\nOr double-click start-server.bat';
        }
        
        return { error: new Error(errorMessage) };
      }

      // The API returns { user, session, tenant }
      // authData structure: { user, tenant, session }
      if (authData?.user) {
        // User data is already in authData.user, no need to fetch again
        const userProfile = authData.user as User;
        const tenantData = authData.tenant || null;
        const session = (authData as { session?: { access_token?: string } }).session;
        if (session?.access_token && typeof localStorage !== 'undefined') {
          localStorage.setItem('auth_token', session.access_token);
        }
        sessionExpiryHandledRef.current = false;
        markActivity();
        debugLog('Sign In Successful', {
          userId: userProfile.id,
          role: userProfile.role,
          hasTenant: !!tenantData,
        });
        
        // Update state immediately
        setUser({ id: userProfile.id, email: userProfile.email, username: userProfile.username });
        setUserProfile(userProfile);
        if (tenantData) {
          setTenant(tenantData);
        }
        // Fetch permissions so menu/features match role (backend reads from role_permissions)
        refetchPermissions();
        
        // Start token refresh interval (refresh before idle expiry)
        startTokenRefreshInterval();
        
        return { userProfile, tenant: tenantData };
      }
      
      debugLog('Sign In Failed - No User Data', { email });
      console.error('No user data in response:', authData);
      return { error: new Error('No user data received from server') };
    } catch (error) {
      debugLog('Sign In Exception', { error: (error as Error).message, email });
      console.error('Sign in exception:', error);
      return { error: error as Error };
    }
  }

  // Token refresh interval reference
  const tokenRefreshIntervalRef = React.useRef<NodeJS.Timeout | null>(null);

  async function handleSessionExpired(message: string) {
    if (sessionExpiryHandledRef.current) return;
    sessionExpiryHandledRef.current = true;
    try {
      showNotification('warning', message);
    } catch {
      // notification is best-effort
    }
    await signOut();
    if (typeof window !== 'undefined' && window.location.pathname !== '/login') {
      window.location.href = '/login';
    }
  }

  function startTokenRefreshInterval() {
    // Clear existing interval if any
    if (tokenRefreshIntervalRef.current) {
      clearInterval(tokenRefreshIntervalRef.current);
    }

    // Refresh token periodically while active (token lifetime ~90 min; refresh every 15 min when active)
    const refreshIntervalMs = 15 * 60 * 1000; // 15 minutes
    tokenRefreshIntervalRef.current = setInterval(async () => {
      try {
        const now = Date.now();
        const idleForMs = now - getLastActivityMs();
        if (idleForMs >= IDLE_TIMEOUT_MS) {
          await handleSessionExpired('Session expired due to inactivity. Please sign in again.');
          return;
        }

        const { data, error } = await db.auth.refreshSession();
        if (error) {
          debugLog('Token refresh failed', { error: error.message });
          const msg = String((error as any)?.message || '').toLowerCase();
          if (msg.includes('expired') || msg.includes('invalid') || msg.includes('unauthorized') || msg.includes('401')) {
            await handleSessionExpired('Your session has expired. Please sign in again.');
          }
        } else if (data) {
          debugLog('Token refreshed successfully', {});
          markActivity();
        }
      } catch (err) {
        debugLog('Token refresh exception', { error: (err as Error).message });
      }
    }, refreshIntervalMs);
  }

  function stopTokenRefreshInterval() {
    if (tokenRefreshIntervalRef.current) {
      clearInterval(tokenRefreshIntervalRef.current);
      tokenRefreshIntervalRef.current = null;
    }
  }

  // Track user activity + enforce idle/session expiry checks.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!userProfileRef.current || !localStorage.getItem('auth_token')) return;

    const activityEvents: Array<keyof WindowEventMap> = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart'];
    const onActivity = () => markActivity();
    activityEvents.forEach((evt) => window.addEventListener(evt, onActivity, { passive: true }));
    document.addEventListener('visibilitychange', onActivity);

    // Ensure key exists for current session.
    if (!localStorage.getItem(AUTH_LAST_ACTIVITY_KEY)) {
      markActivity();
    }

    if (idleCheckIntervalRef.current) clearInterval(idleCheckIntervalRef.current);
    idleCheckIntervalRef.current = setInterval(async () => {
      const token = localStorage.getItem('auth_token');
      if (!token || !userProfileRef.current) return;

      const now = Date.now();
      const idleForMs = now - getLastActivityMs();
      if (idleForMs >= IDLE_TIMEOUT_MS) {
        await handleSessionExpired('Session expired due to inactivity. Please sign in again.');
        return;
      }

      const tokenExpiryMs = parseJwtExpiryMs(token);
      if (tokenExpiryMs && now >= tokenExpiryMs) {
        await handleSessionExpired('Your session has expired. Please sign in again.');
      }
    }, 60000);

    return () => {
      activityEvents.forEach((evt) => window.removeEventListener(evt, onActivity));
      document.removeEventListener('visibilitychange', onActivity);
      if (idleCheckIntervalRef.current) {
        clearInterval(idleCheckIntervalRef.current);
        idleCheckIntervalRef.current = null;
      }
    };
  }, [markActivity, getLastActivityMs, userProfile?.id]);

  async function signUp(
    email: string,
    password: string,
    fullName: string,
    role: UserRole,
    tenantId?: string
  ) {
    try {
      // Create auth user and profile in one step
      const { data: authData, error: authError } = await db.auth.signUp({
        email,
        password,
        full_name: fullName,
        role,
        tenant_id: tenantId,
      });

      if (authError) return { error: authError };

      if (authData?.user) {
        // User profile is created by the backend
        return {};
      }

      return {};
    } catch (error) {
      return { error: error as Error };
    }
  }

  async function signOut() {
    debugLog('Sign Out Started', {});
    stopTokenRefreshInterval();
    if (idleCheckIntervalRef.current) {
      clearInterval(idleCheckIntervalRef.current);
      idleCheckIntervalRef.current = null;
    }
    await db.auth.signOut();
    setUser(null);
    setUserProfile(null);
    setTenant(null);
    userProfileRef.current = null;
    fetchingProfileRef.current = null;
    localStorage.removeItem(AUTH_LAST_ACTIVITY_KEY);
    sessionExpiryHandledRef.current = false;
    debugLog('Sign Out Complete', {});
  }

  function hasRole(roles: UserRole[]): boolean {
    if (!userProfile) return false;
    return roles.includes(userProfile.role);
  }

  function hasPermission(permissionId: string): boolean {
    if (userProfile?.role === 'tenant_admin' || userProfile?.role === 'solution_owner') {
      return true;
    }
    return permissions.includes(permissionId);
  }

  function applyImpersonation(data: {
    user: User;
    tenant: Tenant | null;
    session: { access_token: string };
    impersonation_log_id?: string;
    originalSession?: { access_token: string; userProfile: User; tenant: Tenant | null };
  }) {
    const { user: userProfileData, tenant: tenantData, session, impersonation_log_id, originalSession } = data;
    if (!session?.access_token) return;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('auth_token', session.access_token);
      localStorage.setItem('auth_session', JSON.stringify({ access_token: session.access_token, user: { id: userProfileData.id, email: userProfileData.email } }));
      if (impersonation_log_id && originalSession) {
        localStorage.setItem(IMPERSONATION_LOG_ID_KEY, impersonation_log_id);
        localStorage.setItem(IMPERSONATION_ORIGINAL_SESSION_KEY, JSON.stringify(originalSession));
        setIsImpersonating(true);
      }
    }
    setUser({ id: userProfileData.id, email: userProfileData.email, username: userProfileData.username });
    setUserProfile(userProfileData);
    setTenant(tenantData || null);
    userProfileRef.current = userProfileData;
    sessionExpiryHandledRef.current = false;
    markActivity();
    startTokenRefreshInterval();
    if (session?.access_token && typeof window !== 'undefined') {
      import('../lib/apiUrl').then(({ getApiUrl }) => {
        const base = getApiUrl().replace(/\/$/, '');
        return fetch(`${base}/roles/permissions/me`, {
          headers: { Authorization: `Bearer ${session.access_token}` },
        });
      }).then((res) => (res?.ok ? res.json() : { permissions: [] })).then((json) => {
        setPermissions(Array.isArray(json?.permissions) ? json.permissions : []);
      }).catch(() => setPermissions([]));
    } else setPermissions([]);
  }

  async function exitImpersonation() {
    const logId = typeof localStorage !== 'undefined' ? localStorage.getItem(IMPERSONATION_LOG_ID_KEY) : null;
    const sessionStr = typeof localStorage !== 'undefined' ? localStorage.getItem(IMPERSONATION_ORIGINAL_SESSION_KEY) : null;
    if (!logId || !sessionStr) {
      setIsImpersonating(false);
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(IMPERSONATION_LOG_ID_KEY);
        localStorage.removeItem(IMPERSONATION_ORIGINAL_SESSION_KEY);
      }
      return;
    }
    try {
      const apiUrl = (await import('../lib/apiUrl')).getApiUrl().replace(/\/$/, '');
      const token = localStorage.getItem('auth_token');
      if (token) {
        await fetch(`${apiUrl}/auth/admin/impersonate/end`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ impersonation_log_id: logId }),
        });
      }
    } catch (_) {
      // Best-effort: still restore session
    }
    let original: { access_token: string; userProfile: User; tenant: Tenant | null };
    try {
      original = JSON.parse(sessionStr);
    } catch {
      setIsImpersonating(false);
      localStorage.removeItem(IMPERSONATION_LOG_ID_KEY);
      localStorage.removeItem(IMPERSONATION_ORIGINAL_SESSION_KEY);
      return;
    }
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('auth_token', original.access_token);
      localStorage.setItem('auth_session', JSON.stringify({
        access_token: original.access_token,
        user: { id: original.userProfile.id, email: original.userProfile.email },
      }));
      localStorage.removeItem(IMPERSONATION_LOG_ID_KEY);
      localStorage.removeItem(IMPERSONATION_ORIGINAL_SESSION_KEY);
    }
    setUser({ id: original.userProfile.id, email: original.userProfile.email, username: original.userProfile.username });
    setUserProfile(original.userProfile);
    setTenant(original.tenant || null);
    userProfileRef.current = original.userProfile;
    setIsImpersonating(false);
    sessionExpiryHandledRef.current = false;
    markActivity();
    startTokenRefreshInterval();
  }

  async function refreshSessionFromStorage() {
    const { data: { session } } = await db.auth.getSession();
    if (!session?.user) return;
    setUser(session.user);
    await fetchUserProfile(session.user.id);
  }

  /** Fetch current user permissions from backend (used when role permissions may have changed). */
  async function refetchPermissions() {
    if (typeof window === 'undefined') return;
    const token = localStorage.getItem('auth_token');
    if (!token) {
      setPermissions([]);
      return;
    }
    try {
      const { getApiUrl } = await import('../lib/apiUrl');
      const base = getApiUrl().replace(/\/$/, '');
      const res = await fetch(`${base}/roles/permissions/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const json = await res.json();
        setPermissions(Array.isArray(json.permissions) ? json.permissions : []);
      } else {
        setPermissions([]);
      }
    } catch (_) {
      setPermissions([]);
    }
  }

  // When tab becomes visible, refetch permissions so role permission changes take effect without re-login
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible' && userProfileRef.current && localStorage.getItem('auth_token')) {
        refetchPermissions();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => document.removeEventListener('visibilitychange', onVisibilityChange);
  }, []);

  // Periodic refetch of permissions (e.g. every 60s) so if an admin changed this user's role, they see new access without switching tabs
  useEffect(() => {
    if (!userProfileRef.current || typeof window === 'undefined') return;
    const intervalMs = 60 * 1000;
    const id = setInterval(() => {
      if (document.visibilityState === 'visible' && localStorage.getItem('auth_token')) {
        refetchPermissions();
      }
    }, intervalMs);
    return () => clearInterval(id);
  }, [userProfile?.id]);

  useEffect(() => {
    if (typeof localStorage === 'undefined') return;
    const has = !!localStorage.getItem(IMPERSONATION_LOG_ID_KEY) && !!localStorage.getItem(IMPERSONATION_ORIGINAL_SESSION_KEY);
    setIsImpersonating(has);
  }, []);

  const value = {
    user,
    userProfile,
    tenant,
    loading,
    permissions,
    signIn,
    signUp,
    signOut,
    refreshSessionFromStorage,
    refetchPermissions,
    hasRole,
    hasPermission,
    applyImpersonation,
    isImpersonating,
    exitImpersonation,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

