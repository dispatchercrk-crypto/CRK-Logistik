import { getApps, initializeApp } from 'firebase/app';
import {
  Auth,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  initializeAuth,
  onAuthStateChanged,
  onIdTokenChanged,
  setPersistence,
  signInWithPopup,
  User,
} from 'firebase/auth';
import {
  Firestore,
  getFirestore,
  initializeFirestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';

export const SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/drive.file',
];

export const app =
  getApps().length > 0 ? getApps()[0] : initializeApp(firebaseConfig);

function createFirestoreInstance(): Firestore {
  try {
    return initializeFirestore(
      app,
      {
        experimentalForceLongPolling: true,
      },
      firebaseConfig.firestoreDatabaseId
    );
  } catch {
    return getFirestore(app, firebaseConfig.firestoreDatabaseId);
  }
}

export const db = createFirestoreInstance();

function createPersistentAuth(): Auth {
  try {
    return initializeAuth(app, {
      persistence: [indexedDBLocalPersistence, browserLocalPersistence],
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  } catch {
    const fallbackAuth = getAuth(app);
    void setPersistence(fallbackAuth, indexedDBLocalPersistence).catch(() => {
      void setPersistence(fallbackAuth, browserLocalPersistence).catch(() => {
        // Ignore if environment manages storage internally
      });
    });
    return fallbackAuth;
  }
}

export const auth = createPersistentAuth();

const EMAIL_HINT_STORAGE_KEY = 'crk_google_email_hint';
const GOOGLE_CONNECTED_FLAG_KEY = 'crk_google_workspace_connected';
export const SAVED_DRIVER_UID_KEY = 'saved_driver_uid';
export const SAVED_FIREBASE_UID_KEY = 'saved_firebase_uid';

// Firebase ID tokens expire every 60m; refresh silently every 25m via Firebase Refresh Token (HTTP, zero popups)
const FIREBASE_ID_TOKEN_REFRESH_INTERVAL_MS = 25 * 60 * 1000;

let isSigningIn = false;
// Store Google OAuth access token strictly in memory (NEVER in localStorage, sessionStorage, Cookie, or IndexedDB)
let cachedAccessToken: string | null = null;
let tokenExpiresAtMs = 0;
let tokenExpiryTimer: number | null = null;
let backgroundDaemonStarted = false;

type TokenStateSubscriber = (hasValidToken: boolean, user: User | null) => void;
const tokenSubscribers = new Set<TokenStateSubscriber>();

export function subscribeGoogleTokenState(
  listener: TokenStateSubscriber
): () => void {
  tokenSubscribers.add(listener);
  return () => {
    tokenSubscribers.delete(listener);
  };
}

function notifyTokenSubscribers(): void {
  const valid = Boolean(getAccessToken());
  const currentUser = auth.currentUser;
  for (const sub of tokenSubscribers) {
    try {
      sub(valid, currentUser);
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function getStoredGoogleEmailHint(): string {
  if (typeof window === 'undefined') return '';
  try {
    return (
      auth.currentUser?.email ||
      window.localStorage.getItem(EMAIL_HINT_STORAGE_KEY) ||
      ''
    ).trim();
  } catch {
    return auth.currentUser?.email?.trim() || '';
  }
}

export function hasBoundGoogleWorkspaceAccount(): boolean {
  if (typeof window === 'undefined') return Boolean(auth.currentUser);
  if (auth.currentUser) return true;
  try {
    return (
      window.localStorage.getItem(GOOGLE_CONNECTED_FLAG_KEY) === '1' ||
      Boolean(window.localStorage.getItem(EMAIL_HINT_STORAGE_KEY)?.trim())
    );
  } catch {
    return false;
  }
}

function scheduleInMemoryTokenExpiry(expiresInSec: number): void {
  if (typeof window === 'undefined') return;
  if (tokenExpiryTimer !== null) {
    window.clearTimeout(tokenExpiryTimer);
    tokenExpiryTimer = null;
  }
  const notifyDelayMs = Math.max(60, expiresInSec - 30) * 1000;
  tokenExpiryTimer = window.setTimeout(() => {
    cachedAccessToken = null;
    tokenExpiresAtMs = 0;
    tokenExpiryTimer = null;
    notifyTokenSubscribers();
  }, notifyDelayMs);
}

function setInMemoryAccessToken(token: string, expiresInSec = 3600): void {
  const safeTtlSec =
    Number.isFinite(expiresInSec) && expiresInSec > 120 ? expiresInSec : 3600;
  cachedAccessToken = token;
  tokenExpiresAtMs = Date.now() + safeTtlSec * 1000;
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(GOOGLE_CONNECTED_FLAG_KEY, '1');
    } catch {
      // Ignore
    }
  }
  scheduleInMemoryTokenExpiry(safeTtlSec);
  notifyTokenSubscribers();
}

function createGoogleProvider(emailHint?: string | null): GoogleAuthProvider {
  const provider = new GoogleAuthProvider();
  for (const scope of SCOPES) {
    provider.addScope(scope);
  }
  const hint = (emailHint || getStoredGoogleEmailHint()).trim();
  if (hint) {
    provider.setCustomParameters({
      login_hint: hint,
    });
  } else {
    provider.setCustomParameters({
      prompt: 'select_account',
    });
  }
  return provider;
}

/**
 * Silently refreshes the Firebase Auth ID Token in the background using Firebase's
 * built-in HTTP Refresh Token (persisted in IndexedDB) so the 1-hour expiry NEVER logs out
 * mobile or desktop users and NEVER opens any browser popup window.
 */
export async function refreshFirebaseSessionSilently(
  forceRefresh = true
): Promise<string | null> {
  const user = auth.currentUser;
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    // Transient offline/network hiccup on mobile: NEVER sign out or clear session!
    try {
      return await user.getIdToken(false);
    } catch {
      return null;
    }
  }
}

/**
 * Persists the Driver's identity UID (`saved_driver_uid`) into localStorage & sessionStorage
 * so Link Khusus Driver submissions always have a reliable Fallback Identity even if
 * `auth.currentUser` becomes null after prolonged mobile inactivity.
 */
export function persistSavedDriverUid(driverUid: string): void {
  if (typeof window === 'undefined') return;
  const cleaned = String(driverUid || '').trim();
  if (!cleaned) return;
  try {
    window.localStorage.setItem(SAVED_DRIVER_UID_KEY, cleaned);
  } catch {
    // Ignore storage quota errors
  }
  try {
    window.sessionStorage.setItem(SAVED_DRIVER_UID_KEY, cleaned);
  } catch {
    // Ignore storage quota errors
  }
}

/**
 * Resolves the Fallback Identity UID for Driver report submissions when `auth.currentUser` is null.
 */
export function getSavedDriverUidFallback(explicitDriverId?: string): string {
  if (typeof window !== 'undefined') {
    try {
      const fromLocal = window.localStorage.getItem(SAVED_DRIVER_UID_KEY)?.trim();
      if (fromLocal) return fromLocal;
    } catch {
      // Ignore
    }
    try {
      const fromSession = window.sessionStorage
        .getItem(SAVED_DRIVER_UID_KEY)
        ?.trim();
      if (fromSession) {
        persistSavedDriverUid(fromSession);
        return fromSession;
      }
    } catch {
      // Ignore
    }
  }

  const candidate = String(explicitDriverId || '').trim();
  if (candidate) {
    persistSavedDriverUid(candidate);
  }
  return candidate;
}

/**
 * Ensures a valid Firebase Auth ID Token right before Driver report submission.
 */
export async function forceRefreshFirebaseTokenBeforeSubmit(): Promise<string | null> {
  if (!auth.currentUser) {
    return null;
  }
  return auth.currentUser.getIdToken(true);
}

/**
 * Zero-popup background check for an active in-memory Google Workspace OAuth access token.
 * Never invokes `window.open` or GIS popup flows in the background, preventing browser popup-blocker errors.
 */
export async function silentReconnectWorkspaceToken(): Promise<string | null> {
  return getAccessToken();
}

function ensureGlobalKeepAliveDaemon(): void {
  if (backgroundDaemonStarted || typeof window === 'undefined') return;
  backgroundDaemonStarted = true;

  // Periodic background renewal of Firebase ID Token (100% HTTP, zero popups)
  window.setInterval(() => {
    void refreshFirebaseSessionSilently(true);
  }, FIREBASE_ID_TOKEN_REFRESH_INTERVAL_MS);

  const handleWakeUp = () => {
    if (document.visibilityState && document.visibilityState !== 'visible') {
      return;
    }
    void refreshFirebaseSessionSilently(false);
  };

  document.addEventListener('visibilitychange', handleWakeUp);
  window.addEventListener('pageshow', handleWakeUp);
  window.addEventListener('online', () => {
    void refreshFirebaseSessionSilently(true);
  });
  window.addEventListener('focus', handleWakeUp);
}

/**
 * Global Firebase Auth & ID Token observer.
 * Uses BOTH `onIdTokenChanged` and `onAuthStateChanged` so 1-hour ID token rotations
 * happen seamlessly in the background via Firebase Refresh Token without ever logging out
 * Admin or Driver sessions or triggering blocked popups.
 */
export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthWithoutSheetsToken?: (user: User | null) => void
) => {
  ensureGlobalKeepAliveDaemon();

  const handleUserChange = (user: User | null) => {
    if (user) {
      if (typeof window !== 'undefined') {
        try {
          if (user.email) {
            window.localStorage.setItem(EMAIL_HINT_STORAGE_KEY, user.email);
          }
          if (user.uid) {
            window.localStorage.setItem(SAVED_FIREBASE_UID_KEY, user.uid);
          }
          window.localStorage.setItem(GOOGLE_CONNECTED_FLAG_KEY, '1');
        } catch {
          // Ignore storage restrictions
        }
      }

      // Ensure fresh Firebase ID token asynchronously in background (HTTP only, never opens popup)
      void refreshFirebaseSessionSilently(false);

      const activeToken = getAccessToken();
      if (activeToken) {
        if (onAuthSuccess) onAuthSuccess(user, activeToken);
      } else if (!isSigningIn) {
        if (onAuthWithoutSheetsToken) onAuthWithoutSheetsToken(user);
      }
    } else {
      cachedAccessToken = null;
      tokenExpiresAtMs = 0;
      if (tokenExpiryTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(tokenExpiryTimer);
        tokenExpiryTimer = null;
      }
      if (onAuthWithoutSheetsToken) onAuthWithoutSheetsToken(null);
    }
  };

  // Primary listener: catches login, logout, AND every 1-hour background ID token refresh
  const unsubIdToken = onIdTokenChanged(auth, (user: User | null) => {
    handleUserChange(user);
  });

  // Companion global auth state listener to clear in-memory token on sign-out
  const unsubAuthState = onAuthStateChanged(auth, (user: User | null) => {
    if (!user && !isSigningIn) {
      cachedAccessToken = null;
      tokenExpiresAtMs = 0;
      if (tokenExpiryTimer !== null && typeof window !== 'undefined') {
        window.clearTimeout(tokenExpiryTimer);
        tokenExpiryTimer = null;
      }
    }
  });

  return () => {
    unsubIdToken();
    unsubAuthState();
  };
};

/**
 * Must ONLY be called synchronously from a direct user button click handler.
 */
export const googleSignIn = async (
  forceSelectAccount = false
): Promise<{
  user: User;
  accessToken: string;
} | null> => {
  // Never attempt to open an OAuth popup if browser userActivation is explicitly inactive
  if (typeof navigator !== 'undefined') {
    const ua = (
      navigator as Navigator & { userActivation?: { isActive?: boolean } }
    ).userActivation;
    if (ua && ua.isActive === false) {
      return null;
    }
  }

  try {
    isSigningIn = true;
    const provider = forceSelectAccount
      ? (() => {
          const p = new GoogleAuthProvider();
          for (const scope of SCOPES) p.addScope(scope);
          p.setCustomParameters({ prompt: 'select_account' });
          return p;
        })()
      : createGoogleProvider(auth.currentUser?.email);

    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Gagal memperoleh token akses Google Workspace.');
    }

    if (typeof window !== 'undefined' && result.user.email) {
      try {
        window.localStorage.setItem(EMAIL_HINT_STORAGE_KEY, result.user.email);
      } catch {
        // Ignore
      }
    }
    const tokenResponse = (
      result as unknown as {
        _tokenResponse?: { oauthExpireIn?: number };
      }
    )._tokenResponse;
    const rawExpiresIn =
      typeof tokenResponse?.oauthExpireIn === 'number' &&
      tokenResponse.oauthExpireIn > 300
        ? tokenResponse.oauthExpireIn
        : 3600;

    setInMemoryAccessToken(credential.accessToken, rawExpiresIn);
    return { user: result.user, accessToken: credential.accessToken };
  } catch (error) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = (): string | null => {
  if (
    cachedAccessToken &&
    tokenExpiresAtMs > 0 &&
    Date.now() > tokenExpiresAtMs - 30 * 1000
  ) {
    cachedAccessToken = null;
    tokenExpiresAtMs = 0;
  }
  return cachedAccessToken;
};

/**
 * Returns the active in-memory OAuth token without ever opening any browser popup window.
 */
export const ensureValidAccessToken = async (): Promise<string | null> => {
  return getAccessToken();
};

export const clearAccessToken = (): void => {
  cachedAccessToken = null;
  tokenExpiresAtMs = 0;
  if (tokenExpiryTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(tokenExpiryTimer);
    tokenExpiryTimer = null;
  }
  notifyTokenSubscribers();
};

export const logoutGoogle = async (): Promise<void> => {
  await auth.signOut();
  cachedAccessToken = null;
  tokenExpiresAtMs = 0;
  if (tokenExpiryTimer !== null && typeof window !== 'undefined') {
    window.clearTimeout(tokenExpiryTimer);
    tokenExpiryTimer = null;
  }
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(EMAIL_HINT_STORAGE_KEY);
      window.localStorage.setItem(GOOGLE_CONNECTED_FLAG_KEY, '0');
      window.localStorage.removeItem(GOOGLE_CONNECTED_FLAG_KEY);
    } catch {
      // Ignore
    }
  }
  notifyTokenSubscribers();
};
