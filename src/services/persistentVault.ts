import {
  AdminViewMaster,
  AppStateResponse,
  Assignment,
  DriverExpense,
  DriverMaster,
  UserRole,
} from '../types';

const DB_NAME = 'crk_logistik_persistent_vault_v1';
const DB_VERSION = 1;
const STORE_KV = 'kv_store';

const KEY_SESSION = 'portal_session_v2';
const KEY_WORKSPACE = 'workspace_full_snapshot_v2';
const KEY_DRIVER_TASKS_PREFIX = 'driver_tasks_cache_v2:';
const KEY_SURAT_TUGAS_IDB_PREFIX = 'surat_tugas_snapshot_v1:';
const KEY_DRIVER_DRAFT_PREFIX = 'driver_form_draft_v2:';
const KEY_PENDING_SYNC_PHOTOS_PREFIX = 'pending_report_photos_v1:';
const KEY_SPREADSHEET_BINDING = 'permanent_spreadsheet_binding_v1';

export const SURAT_TUGAS_LOCAL_CACHE_PREFIX = 'surat_tugas_cache_';
export const PORTAL_SESSION_STORAGE_KEY = 'crk_portal_session_v1';
export const SAVED_DRIVER_UID_STORAGE_KEY = 'saved_driver_uid';
export const PORTAL_SESSION_COOKIE_KEY = 'crk_portal_session_cookie_v1';
export const SPREADSHEET_BINDING_STORAGE_KEY =
  'crk_permanent_spreadsheet_binding_v1';
export const SPREADSHEET_BINDING_COOKIE_KEY =
  'crk_permanent_sheet_cookie_v1';
// 10-year (3,650 days) rolling session so mobile Drivers & Admins stay logged in permanently until manual Logout
export const PORTAL_SESSION_TTL_MS = 3650 * 24 * 60 * 60 * 1000;
// RFC 6265bis maximum browser cookie lifetime (400 days in seconds)
const COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;

export interface PermanentSpreadsheetBinding {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  appsScriptUrl?: string;
  driveRootFolderId?: string;
  driveRootFolderUrl?: string;
  connectedEmail?: string;
  lastSyncedAt?: string | null;
  savedAtMs: number;
}

export interface SavedPortalSession {
  role: UserRole;
  driverId?: string;
  driverSnapshot?: DriverMaster;
  adminViewId?: string;
  adminViewSnapshot?: AdminViewMaster;
  startedAtMs?: number;
  savedAtMs?: number;
}

export interface AdminSessionHealthSnapshot {
  isActive: boolean;
  startedAtMs: number | null;
  lastRenewedAtMs: number | null;
  expiresAtMs: number | null;
  layers: {
    localStorage: boolean;
    sessionStorage: boolean;
    cookie: boolean;
    indexedDb: boolean;
  };
}

export interface DriverFormDraft {
  assignmentId: string;
  updatedAtMs: number;
  titikKeberangkatan?: string;
  jenisKendaraan?: 'Mobil Pendingin' | 'Non Pendingin';
  kmAwal?: string;
  suhuAwal?: string;
  bbmAwal?: string;
  kondisiKendaraan?: string;
  catatanBerangkat?: string;
  fotoOdometerBerangkat?: string;
  fotoSuhuBerangkat?: string;
  deliveredJenisKendaraan?: 'Mobil Pendingin' | 'Non Pendingin';
  kmSampai?: string;
  suhuSampai?: string;
  bbmSampai?: string;
  kondisiSampai?: string;
  catatanSampai?: string;
  fotoOdometerSampai?: string;
  fotoSuhuSampai?: string;
  handoverJenisKendaraan?: 'Mobil Pendingin' | 'Non Pendingin';
  kmAkhir?: string;
  suhuAkhir?: string;
  bbmAkhir?: string;
  penerimaNama?: string;
  kondisiAkhir?: string;
  catatanSerahTerima?: string;
  fotoOdometerSerahTerima?: string;
  fotoSuhuSerahTerima?: string;
  fotoBuktiSerahTerima?: string;
  tandaTanganPenerima?: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve(null);
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = window.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_KV)) {
          db.createObjectStore(STORE_KV);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

async function idbGet<T>(key: string): Promise<T | null> {
  const db = await openVaultDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KV, 'readonly');
      const store = tx.objectStore(STORE_KV);
      const req = store.get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      store.put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDelete(key: string): Promise<void> {
  const db = await openVaultDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KV, 'readwrite');
      const store = tx.objectStore(STORE_KV);
      store.delete(key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

// Request browser persistent storage quota on mobile so OS does not evict IndexedDB/localStorage
if (
  typeof navigator !== 'undefined' &&
  navigator.storage &&
  typeof navigator.storage.persist === 'function'
) {
  void navigator.storage.persist().catch(() => {
    // Ignore if browser auto-manages persistence
  });
}

function readCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const prefix = `${name}=`;
  const parts = document.cookie ? document.cookie.split('; ') : [];
  for (const part of parts) {
    if (part.startsWith(prefix)) {
      try {
        return decodeURIComponent(part.slice(prefix.length));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function writeSessionCookie(rawJson: string | null): void {
  if (typeof document === 'undefined') return;
  try {
    const secureFlag =
      typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? '; Secure'
        : '';
    if (!rawJson) {
      document.cookie = `${PORTAL_SESSION_COOKIE_KEY}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax${secureFlag}`;
    } else {
      const expiresUtc = new Date(
        Date.now() + COOKIE_MAX_AGE_SECONDS * 1000
      ).toUTCString();
      document.cookie = `${PORTAL_SESSION_COOKIE_KEY}=${encodeURIComponent(
        rawJson
      )}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Expires=${expiresUtc}; path=/; SameSite=Lax${secureFlag}`;
    }
  } catch {
    // Ignore cookie write restrictions
  }
}

export function persistPortalSessionEverywhere(
  session: SavedPortalSession | null
): void {
  if (typeof window === 'undefined') return;
  if (!session) {
    try {
      window.localStorage.removeItem(PORTAL_SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
    try {
      window.sessionStorage.removeItem(PORTAL_SESSION_STORAGE_KEY);
    } catch {
      // Ignore
    }
    writeSessionCookie(null);
    void idbDelete(KEY_SESSION);
    return;
  }

  const nowMs = Date.now();
  const existingSync = readPortalSessionSyncWithoutHeal();
  const preservedStartMs =
    session.startedAtMs ||
    (existingSync && existingSync.role === session.role
      ? existingSync.startedAtMs || existingSync.savedAtMs
      : undefined) ||
    nowMs;

  const enriched: SavedPortalSession = {
    ...session,
    startedAtMs: preservedStartMs,
    savedAtMs: nowMs,
  };
  const serialized = JSON.stringify(enriched);

  try {
    window.localStorage.setItem(PORTAL_SESSION_STORAGE_KEY, serialized);
    if (enriched.role === UserRole.DRIVER && enriched.driverId) {
      window.localStorage.setItem(
        SAVED_DRIVER_UID_STORAGE_KEY,
        enriched.driverId.trim()
      );
    }
  } catch {
    // Ignore quota errors
  }
  try {
    window.sessionStorage.setItem(PORTAL_SESSION_STORAGE_KEY, serialized);
    if (enriched.role === UserRole.DRIVER && enriched.driverId) {
      window.sessionStorage.setItem(
        SAVED_DRIVER_UID_STORAGE_KEY,
        enriched.driverId.trim()
      );
    }
  } catch {
    // Ignore quota errors
  }

  const cookiePayload: SavedPortalSession = {
    role: enriched.role,
    driverId: enriched.driverId,
    driverSnapshot: enriched.driverSnapshot
      ? {
          id: enriched.driverSnapshot.id,
          name: enriched.driverSnapshot.name,
          phone: enriched.driverSnapshot.phone,
          pin: '',
          licenseType: enriched.driverSnapshot.licenseType,
          active: enriched.driverSnapshot.active,
        }
      : undefined,
    startedAtMs: enriched.startedAtMs,
    savedAtMs: enriched.savedAtMs,
  };
  writeSessionCookie(JSON.stringify(cookiePayload));
  void idbSet(KEY_SESSION, enriched);
}

function parseSessionObject(
  parsed: Partial<SavedPortalSession> | null | undefined
): SavedPortalSession | null {
  if (!parsed || typeof parsed !== 'object') return null;
  if (
    typeof parsed.savedAtMs === 'number' &&
    Date.now() - parsed.savedAtMs > PORTAL_SESSION_TTL_MS
  ) {
    return null;
  }
  if (parsed.role === UserRole.ADMIN) {
    return {
      role: UserRole.ADMIN,
      startedAtMs: parsed.startedAtMs || parsed.savedAtMs,
      savedAtMs: parsed.savedAtMs,
    };
  }
  if (parsed.role === UserRole.DRIVER && parsed.driverId) {
    const cleanId = String(parsed.driverId).trim();
    const snap =
      parsed.driverSnapshot &&
      typeof parsed.driverSnapshot === 'object' &&
      parsed.driverSnapshot.id
        ? (parsed.driverSnapshot as DriverMaster)
        : undefined;
    return {
      role: UserRole.DRIVER,
      driverId: cleanId,
      driverSnapshot: snap,
      startedAtMs: parsed.startedAtMs || parsed.savedAtMs,
      savedAtMs: parsed.savedAtMs,
    };
  }
  if (parsed.role === UserRole.ADMIN_VIEW) {
    const cleanId = String(parsed.adminViewId || '').trim();
    const snap =
      parsed.adminViewSnapshot &&
      typeof parsed.adminViewSnapshot === 'object' &&
      parsed.adminViewSnapshot.id
        ? (parsed.adminViewSnapshot as AdminViewMaster)
        : undefined;
    return {
      role: UserRole.ADMIN_VIEW,
      adminViewId: cleanId,
      adminViewSnapshot: snap,
      startedAtMs: parsed.startedAtMs || parsed.savedAtMs,
      savedAtMs: parsed.savedAtMs,
    };
  }
  return null;
}

export async function inspectActiveAdminSessionHealth(): Promise<AdminSessionHealthSnapshot> {
  if (typeof window === 'undefined') {
    return {
      isActive: false,
      startedAtMs: null,
      lastRenewedAtMs: null,
      expiresAtMs: null,
      layers: {
        localStorage: false,
        sessionStorage: false,
        cookie: false,
        indexedDb: false,
      },
    };
  }

  let hasLocal = false;
  let hasSession = false;
  let hasCookie = false;
  let hasIdb = false;

  try {
    const rawL = window.localStorage.getItem(PORTAL_SESSION_STORAGE_KEY);
    hasLocal = Boolean(
      rawL && parseSessionObject(JSON.parse(rawL))?.role === UserRole.ADMIN
    );
  } catch {
    hasLocal = false;
  }

  try {
    const rawS = window.sessionStorage.getItem(PORTAL_SESSION_STORAGE_KEY);
    hasSession = Boolean(
      rawS && parseSessionObject(JSON.parse(rawS))?.role === UserRole.ADMIN
    );
  } catch {
    hasSession = false;
  }

  try {
    const rawC = readCookieValue(PORTAL_SESSION_COOKIE_KEY);
    hasCookie = Boolean(
      rawC && parseSessionObject(JSON.parse(rawC))?.role === UserRole.ADMIN
    );
  } catch {
    hasCookie = false;
  }

  const idbVal = await idbGet<Partial<SavedPortalSession>>(KEY_SESSION);
  const parsedIdb = parseSessionObject(idbVal);
  hasIdb = Boolean(parsedIdb?.role === UserRole.ADMIN);

  const activeSession =
    readPortalSessionSyncWithoutHeal() ||
    (parsedIdb?.role === UserRole.ADMIN ? parsedIdb : null);
  const isAdmin = activeSession?.role === UserRole.ADMIN;
  const lastRenewedAtMs = isAdmin ? activeSession?.savedAtMs ?? Date.now() : null;
  const startedAtMs = isAdmin
    ? activeSession?.startedAtMs ?? lastRenewedAtMs
    : null;

  return {
    isActive: Boolean(isAdmin),
    startedAtMs,
    lastRenewedAtMs,
    expiresAtMs: lastRenewedAtMs ? lastRenewedAtMs + PORTAL_SESSION_TTL_MS : null,
    layers: {
      localStorage: hasLocal,
      sessionStorage: hasSession,
      cookie: hasCookie,
      indexedDb: hasIdb,
    },
  };
}

function readPortalSessionSyncWithoutHeal(): SavedPortalSession | null {
  if (typeof window === 'undefined') return null;
  const candidates: (string | null)[] = [];
  try {
    candidates.push(window.localStorage.getItem(PORTAL_SESSION_STORAGE_KEY));
  } catch {
    candidates.push(null);
  }
  try {
    candidates.push(window.sessionStorage.getItem(PORTAL_SESSION_STORAGE_KEY));
  } catch {
    candidates.push(null);
  }
  candidates.push(readCookieValue(PORTAL_SESSION_COOKIE_KEY));

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const validated = parseSessionObject(
        JSON.parse(raw) as Partial<SavedPortalSession>
      );
      if (validated) return validated;
    } catch {
      // Try next storage layer
    }
  }
  return null;
}

export function readPortalSessionSync(): SavedPortalSession | null {
  if (typeof window === 'undefined') return null;
  let fromLocal: string | null = null;
  let fromSession: string | null = null;
  let fromCookie: string | null = null;

  try {
    fromLocal = window.localStorage.getItem(PORTAL_SESSION_STORAGE_KEY);
  } catch {
    fromLocal = null;
  }
  try {
    fromSession = window.sessionStorage.getItem(PORTAL_SESSION_STORAGE_KEY);
  } catch {
    fromSession = null;
  }
  fromCookie = readCookieValue(PORTAL_SESSION_COOKIE_KEY);

  const validated = readPortalSessionSyncWithoutHeal();
  if (!validated) return null;

  // Auto-heal any missing sync storage layer (e.g. sessionStorage cleared when mobile browser tab closed)
  if (!fromLocal || !fromSession || !fromCookie) {
    persistPortalSessionEverywhere(validated);
  }
  return validated;
}

/**
 * Silently extends the sliding 10-year session window across all 4 browser layers
 * (LocalStorage, SessionStorage, Cookie, IndexedDB) for both Admin and Driver accounts.
 */
export function touchPortalSessionSlidingRenewal(
  minIntervalMs = 5 * 60 * 1000
): boolean {
  const active = readPortalSessionSyncWithoutHeal();
  if (!active) return false;
  const now = Date.now();
  if (active.savedAtMs && now - active.savedAtMs < minIntervalMs) {
    return false;
  }
  persistPortalSessionEverywhere(active);
  return true;
}

export async function readPortalSessionAsync(): Promise<SavedPortalSession | null> {
  const syncResult = readPortalSessionSync();
  if (syncResult) {
    // Ensure IndexedDB layer is also mirrored in sync
    void idbGet<Partial<SavedPortalSession>>(KEY_SESSION).then((idbExisting) => {
      if (!parseSessionObject(idbExisting)) {
        void idbSet(KEY_SESSION, syncResult);
      }
    });
    return syncResult;
  }
  const fromIdb = await idbGet<Partial<SavedPortalSession>>(KEY_SESSION);
  const validated = parseSessionObject(fromIdb);
  if (validated) {
    // Re-mirror back into localStorage + sessionStorage + cookie if browser cleared sync storage
    persistPortalSessionEverywhere(validated);
  }
  return validated;
}

/**
 * Saves the FULL workspace snapshot (including high-res base64 Driver photos) in IndexedDB
 * so photos & assignments survive refreshes, offline intervals, and server cold starts.
 */
export async function saveFullWorkspaceToVault(
  state: AppStateResponse,
  allowEmptyOverwrite = false
): Promise<void> {
  const existing = await idbGet<AppStateResponse>(KEY_WORKSPACE);
  const hasAuthoritativeHistory =
    allowEmptyOverwrite ||
    Boolean(state.config.spreadsheetId) ||
    Boolean(state.config.lastSyncedAt) ||
    (state.config.lastSequence || 0) > 0 ||
    Boolean(existing?.config?.lastSyncedAt);

  const hasAny =
    hasAuthoritativeHistory ||
    state.drivers.length > 0 ||
    state.vehicles.length > 0 ||
    state.routes.length > 0 ||
    (state.fleetCards?.length || 0) > 0 ||
    (state.driverExpenses?.length || 0) > 0 ||
    state.assignments.length > 0;
  if (!hasAny) return;

  let mergedAssignments = state.assignments;
  let mergedExpenses = state.driverExpenses || [];

  // Never lose locally cached base64 photos for surviving assignments, and prune deleted assignments from individual caches
  if (existing && Array.isArray(existing.assignments) && existing.assignments.length > 0) {
    const incomingIds = new Set(state.assignments.map((a) => a.id));
    const prevById = new Map<string, Assignment>();
    const affectedDriverIds = new Set<string>();

    for (const oldAsg of existing.assignments) {
      prevById.set(oldAsg.id, oldAsg);
      if (!incomingIds.has(oldAsg.id) && oldAsg.id) {
        // Assignment was deleted in App or Google Spreadsheet: purge individual task caches so it cannot resurrect
        void idbDelete(`${KEY_SURAT_TUGAS_IDB_PREFIX}${oldAsg.id}`);
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem(
              `${SURAT_TUGAS_LOCAL_CACHE_PREFIX}${oldAsg.id}`
            );
          } catch {
            // Ignore
          }
        }
        if (oldAsg.driverId) {
          affectedDriverIds.add(oldAsg.driverId.trim().toUpperCase());
        }
      }
    }

    for (const drvId of affectedDriverIds) {
      const survivingForDriver = state.assignments.filter(
        (a) => a.driverId.trim().toUpperCase() === drvId
      );
      void idbSet(`${KEY_DRIVER_TASKS_PREFIX}${drvId}`, survivingForDriver);
      if (typeof window !== 'undefined') {
        try {
          if (survivingForDriver.length === 0) {
            window.localStorage.removeItem(`${KEY_DRIVER_TASKS_PREFIX}${drvId}`);
          } else {
            window.localStorage.setItem(
              `${KEY_DRIVER_TASKS_PREFIX}${drvId}`,
              JSON.stringify(
                survivingForDriver.map((a) => stripHeavyPhotosFromAssignment(a))
              )
            );
          }
        } catch {
          // Ignore
        }
      }
    }

    mergedAssignments = state.assignments.map((asg) => {
      const prev = prevById.get(asg.id);
      if (!prev) return asg;
      return {
        ...asg,
        departureData: asg.departureData
          ? {
              ...asg.departureData,
              fotoOdometerBerangkat:
                asg.departureData.fotoOdometerBerangkat ||
                prev.departureData?.fotoOdometerBerangkat,
              fotoSuhuBerangkat:
                asg.departureData.fotoSuhuBerangkat ||
                prev.departureData?.fotoSuhuBerangkat,
            }
          : prev.departureData && asg.status !== 'Menunggu Berangkat'
          ? prev.departureData
          : asg.departureData,
        deliveredData: asg.deliveredData
          ? {
              ...asg.deliveredData,
              fotoOdometerSampai:
                asg.deliveredData.fotoOdometerSampai ||
                prev.deliveredData?.fotoOdometerSampai,
              fotoSuhuSampai:
                asg.deliveredData.fotoSuhuSampai ||
                prev.deliveredData?.fotoSuhuSampai,
            }
          : prev.deliveredData &&
            (asg.status === 'Delivered' ||
              asg.status === 'Handover' ||
              asg.status === 'Selesai')
          ? prev.deliveredData
          : asg.deliveredData,
        handoverData: asg.handoverData
          ? {
              ...asg.handoverData,
              fotoOdometerSerahTerima:
                asg.handoverData.fotoOdometerSerahTerima ||
                prev.handoverData?.fotoOdometerSerahTerima ||
                asg.deliveredData?.fotoOdometerSampai ||
                prev.deliveredData?.fotoOdometerSampai,
              fotoSuhuSerahTerima:
                asg.handoverData.fotoSuhuSerahTerima ||
                prev.handoverData?.fotoSuhuSerahTerima ||
                asg.deliveredData?.fotoSuhuSampai ||
                prev.deliveredData?.fotoSuhuSampai,
              fotoBuktiSerahTerima:
                asg.handoverData.fotoBuktiSerahTerima ||
                prev.handoverData?.fotoBuktiSerahTerima,
              tandaTanganPenerima:
                asg.handoverData.tandaTanganPenerima ||
                prev.handoverData?.tandaTanganPenerima,
            }
          : asg.handoverData,
      };
    });
  }

  if (
    existing &&
    Array.isArray(existing.driverExpenses) &&
    existing.driverExpenses.length > 0
  ) {
    const prevExpById = new Map<string, DriverExpense>();
    for (const oldExp of existing.driverExpenses) {
      prevExpById.set(oldExp.id, oldExp);
    }
    mergedExpenses = mergedExpenses.map((exp) => {
      const prev = prevExpById.get(exp.id);
      if (!prev) return exp;
      return {
        ...exp,
        fotoStrukBbm: exp.fotoStrukBbm || prev.fotoStrukBbm,
        fotoStrukBbmUrl: exp.fotoStrukBbmUrl || prev.fotoStrukBbmUrl,
        fotoStrukTol: exp.fotoStrukTol || prev.fotoStrukTol,
        fotoStrukTolUrl: exp.fotoStrukTolUrl || prev.fotoStrukTolUrl,
      };
    });
  }

  await idbSet<AppStateResponse>(KEY_WORKSPACE, {
    ...state,
    assignments: mergedAssignments,
    driverExpenses: mergedExpenses,
  });
}

export async function readFullWorkspaceFromVault(): Promise<AppStateResponse | null> {
  return idbGet<AppStateResponse>(KEY_WORKSPACE);
}

/**
 * Look up cached base64 photos for a specific assignment from IndexedDB (used by PrintableAssignmentModal).
 */
export async function readCachedAssignmentMediaFromVault(
  assignmentId: string
): Promise<Pick<
  Assignment,
  'departureData' | 'deliveredData' | 'handoverData'
> | null> {
  const ws = await idbGet<AppStateResponse>(KEY_WORKSPACE);
  if (!ws || !Array.isArray(ws.assignments)) return null;
  const found = ws.assignments.find((a) => a.id === assignmentId);
  if (!found) return null;
  return {
    departureData: found.departureData,
    deliveredData: found.deliveredData,
    handoverData: found.handoverData,
  };
}

function stripHeavyPhotosFromAssignment(a: Assignment): Assignment {
  return {
    ...a,
    departureData: a.departureData
      ? {
          ...a.departureData,
          fotoOdometerBerangkat: undefined,
          fotoSuhuBerangkat: undefined,
        }
      : undefined,
    deliveredData: a.deliveredData
      ? {
          ...a.deliveredData,
          fotoOdometerSampai: undefined,
          fotoSuhuSampai: undefined,
        }
      : undefined,
    handoverData: a.handoverData
      ? {
          ...a.handoverData,
          fotoOdometerSerahTerima: undefined,
          fotoSuhuSerahTerima: undefined,
          fotoBuktiSerahTerima: undefined,
          tandaTanganPenerima: undefined,
        }
      : undefined,
  };
}

/**
 * Caches a single Surat Tugas snapshot in BOTH localStorage and IndexedDB
 * with an explicit `driverCode` string so `dataSuratTugasAsli.driverCode` is guaranteed
 * available even if the Driver's 1-hour Firebase ID Token session expires.
 */
export async function cacheSuratTugasSnapshotLocally(
  assignment: Assignment,
  fallbackDriverId = ''
): Promise<Assignment & { driverCode: string }> {
  const savedUid =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(SAVED_DRIVER_UID_STORAGE_KEY)?.trim() || ''
      : '';
  const resolvedDriverCode = (
    assignment.driverCode ||
    assignment.driverId ||
    fallbackDriverId ||
    savedUid ||
    'DRV-000'
  ).trim();

  const fullWithCode: Assignment & { driverCode: string } = {
    ...assignment,
    driverId: assignment.driverId || resolvedDriverCode,
    driverCode: resolvedDriverCode,
  };

  if (typeof window !== 'undefined' && assignment.id) {
    try {
      const compactWithCode = stripHeavyPhotosFromAssignment(fullWithCode);
      window.localStorage.setItem(
        `${SURAT_TUGAS_LOCAL_CACHE_PREFIX}${assignment.id}`,
        JSON.stringify(compactWithCode)
      );
    } catch {
      // Ignore localStorage quota limits; IndexedDB holds full snapshot below
    }
  }

  if (assignment.id) {
    await idbSet<Assignment>(
      `${KEY_SURAT_TUGAS_IDB_PREFIX}${assignment.id}`,
      fullWithCode
    );
  }

  return fullWithCode;
}

/**
 * Reads cached Surat Tugas (`dataSuratTugasAsli`) from IndexedDB / localStorage
 * and merges with any live task state while strictly guaranteeing a non-empty `driverCode`
 * from the original Surat Tugas cache before session expiration.
 */
export async function resolveCachedSuratTugasAsli(
  assignmentId: string,
  fallbackDriverId = '',
  liveTask?: Assignment
): Promise<Assignment & { driverCode: string }> {
  let cachedTask: Assignment | null = null;

  if (assignmentId) {
    cachedTask = await idbGet<Assignment>(
      `${KEY_SURAT_TUGAS_IDB_PREFIX}${assignmentId}`
    );
  }

  if (!cachedTask && typeof window !== 'undefined' && assignmentId) {
    try {
      const rawLocal = window.localStorage.getItem(
        `${SURAT_TUGAS_LOCAL_CACHE_PREFIX}${assignmentId}`
      );
      if (rawLocal) {
        const parsed = JSON.parse(rawLocal) as Assignment;
        if (parsed && typeof parsed === 'object' && parsed.id) {
          cachedTask = parsed;
        }
      }
    } catch {
      cachedTask = null;
    }
  }

  if (!cachedTask && fallbackDriverId) {
    const driverCache = await readDriverAssignmentsCacheAsync(fallbackDriverId);
    cachedTask = driverCache.find((a) => a.id === assignmentId) || null;
  }

  if (!cachedTask && assignmentId) {
    const ws = await idbGet<AppStateResponse>(KEY_WORKSPACE);
    if (ws && Array.isArray(ws.assignments)) {
      cachedTask = ws.assignments.find((a) => a.id === assignmentId) || null;
    }
  }

  const savedUid =
    typeof window !== 'undefined'
      ? window.localStorage.getItem(SAVED_DRIVER_UID_STORAGE_KEY)?.trim() || ''
      : '';

  // Prioritize the cached original Surat Tugas `driverCode` so Tier 2 validation
  // (`incoming().submittedByDriverUid == existing().driverCode`) always matches verbatim.
  const guaranteedDriverCode = (
    cachedTask?.driverCode ||
    liveTask?.driverCode ||
    cachedTask?.driverId ||
    liveTask?.driverId ||
    savedUid ||
    fallbackDriverId ||
    'DRV-000'
  ).trim();

  const base: Assignment = liveTask
    ? {
        ...(cachedTask || {}),
        ...liveTask,
        ownerUid: liveTask.ownerUid || cachedTask?.ownerUid,
        departureData: liveTask.departureData || cachedTask?.departureData,
        deliveredData: liveTask.deliveredData || cachedTask?.deliveredData,
        handoverData: liveTask.handoverData || cachedTask?.handoverData,
        driveMedia: liveTask.driveMedia || cachedTask?.driveMedia,
        driveFolderUrl: liveTask.driveFolderUrl || cachedTask?.driveFolderUrl,
      }
    : cachedTask || {
        id: assignmentId,
        sequenceNumber: 1,
        noPenugasan: assignmentId,
        noSuratJalanFisik: '',
        kodeSegel: '',
        tanggalTugas: new Date().toISOString().slice(0, 10),
        jadwalJamTiba: '',
        driverId: guaranteedDriverCode,
        driverCode: guaranteedDriverCode,
        driverName: guaranteedDriverCode,
        driverPhone: '',
        vehicleId: '',
        plateNumber: '-',
        vehicleType: '',
        origin: 'Menunggu Titik Keberangkatan Driver',
        routeId: '',
        destination: '-',
        purpose: '',
        notes: '',
        status: 'Menunggu Berangkat' as Assignment['status'],
        createdAt: new Date().toISOString(),
      };

  const resolved: Assignment & { driverCode: string } = {
    ...base,
    driverId: base.driverId || guaranteedDriverCode,
    driverCode: guaranteedDriverCode,
  };

  // Refresh local cache with guaranteed `driverCode`
  void cacheSuratTugasSnapshotLocally(resolved, fallbackDriverId);

  return resolved;
}

/**
 * Dedicated per-Driver assignment cache so a Driver's active Surat Tugas never vanishes
 * on mobile even if a Cloud Run container cold-starts while Admin is offline.
 */
export async function saveDriverAssignmentsCache(
  driverId: string,
  assignments: Assignment[]
): Promise<void> {
  const cleanId = driverId.trim().toUpperCase();
  if (!cleanId || assignments.length === 0) return;

  const enrichedAssignments = assignments.map((a) => {
    const exactCode = (a.driverCode || a.driverId || driverId).trim();
    return {
      ...a,
      driverCode: exactCode,
    };
  });

  await idbSet<Assignment[]>(
    `${KEY_DRIVER_TASKS_PREFIX}${cleanId}`,
    enrichedAssignments
  );

  for (const asg of enrichedAssignments) {
    if (asg.id) {
      await idbSet<Assignment>(`${KEY_SURAT_TUGAS_IDB_PREFIX}${asg.id}`, asg);
    }
  }

  try {
    const light = enrichedAssignments.map((a) =>
      stripHeavyPhotosFromAssignment(a)
    );
    window.localStorage.setItem(
      `${KEY_DRIVER_TASKS_PREFIX}${cleanId}`,
      JSON.stringify(light)
    );
    for (const item of light) {
      if (item.id) {
        window.localStorage.setItem(
          `${SURAT_TUGAS_LOCAL_CACHE_PREFIX}${item.id}`,
          JSON.stringify(item)
        );
      }
    }
  } catch {
    // Ignore localStorage quota
  }
}

export function readDriverAssignmentsCacheSync(driverId: string): Assignment[] {
  if (typeof window === 'undefined') return [];
  const cleanId = driverId.trim().toUpperCase();
  if (!cleanId) return [];
  try {
    const raw = window.localStorage.getItem(
      `${KEY_DRIVER_TASKS_PREFIX}${cleanId}`
    );
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as Assignment[]) : [];
  } catch {
    return [];
  }
}

export async function readDriverAssignmentsCacheAsync(
  driverId: string
): Promise<Assignment[]> {
  const cleanId = driverId.trim().toUpperCase();
  if (!cleanId) return [];
  const fromIdb = await idbGet<Assignment[]>(
    `${KEY_DRIVER_TASKS_PREFIX}${cleanId}`
  );
  if (Array.isArray(fromIdb) && fromIdb.length > 0) {
    return fromIdb;
  }
  return readDriverAssignmentsCacheSync(cleanId);
}

/**
 * Saves/loads in-progress Driver report form inputs & camera photos in IndexedDB
 * so accidental mobile pull-to-refresh never loses typed KM, temperature, or captured photos.
 */
export async function saveDriverFormDraft(
  assignmentId: string,
  draft: DriverFormDraft
): Promise<void> {
  if (!assignmentId) return;
  await idbSet<DriverFormDraft>(`${KEY_DRIVER_DRAFT_PREFIX}${assignmentId}`, {
    ...draft,
    assignmentId,
    updatedAtMs: Date.now(),
  });
}

export async function readDriverFormDraft(
  assignmentId: string
): Promise<DriverFormDraft | null> {
  if (!assignmentId) return null;
  return idbGet<DriverFormDraft>(`${KEY_DRIVER_DRAFT_PREFIX}${assignmentId}`);
}

export async function clearDriverFormDraft(
  assignmentId: string
): Promise<void> {
  if (!assignmentId) return;
  await idbDelete(`${KEY_DRIVER_DRAFT_PREFIX}${assignmentId}`);
}

export interface PendingSyncPhotoBundle {
  fotoOdometerBerangkat?: string;
  fotoSuhuBerangkat?: string;
  fotoOdometerSampai?: string;
  fotoSuhuSampai?: string;
  fotoOdometerSerahTerima?: string;
  fotoSuhuSerahTerima?: string;
  fotoBuktiSerahTerima?: string;
  tandaTanganPenerima?: string;
}

export async function savePendingReportPhotosToVault(
  queueId: string,
  photos: PendingSyncPhotoBundle
): Promise<void> {
  if (!queueId) return;
  await idbSet<PendingSyncPhotoBundle>(
    `${KEY_PENDING_SYNC_PHOTOS_PREFIX}${queueId}`,
    photos
  );
}

export async function readPendingReportPhotosFromVault(
  queueId: string
): Promise<PendingSyncPhotoBundle | null> {
  if (!queueId) return null;
  return idbGet<PendingSyncPhotoBundle>(
    `${KEY_PENDING_SYNC_PHOTOS_PREFIX}${queueId}`
  );
}

export async function deletePendingReportPhotosFromVault(
  queueId: string
): Promise<void> {
  if (!queueId) return;
  await idbDelete(`${KEY_PENDING_SYNC_PHOTOS_PREFIX}${queueId}`);
}

function writeSpreadsheetBindingCookie(rawJson: string | null): void {
  if (typeof document === 'undefined') return;
  try {
    const secureFlag =
      typeof window !== 'undefined' && window.location.protocol === 'https:'
        ? '; Secure'
        : '';
    if (!rawJson) {
      document.cookie = `${SPREADSHEET_BINDING_COOKIE_KEY}=; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax${secureFlag}`;
    } else {
      const expiresUtc = new Date(
        Date.now() + COOKIE_MAX_AGE_SECONDS * 1000
      ).toUTCString();
      document.cookie = `${SPREADSHEET_BINDING_COOKIE_KEY}=${encodeURIComponent(
        rawJson
      )}; Max-Age=${COOKIE_MAX_AGE_SECONDS}; Expires=${expiresUtc}; path=/; SameSite=Lax${secureFlag}`;
    }
  } catch {
    // Ignore cookie write restrictions
  }
}

function parseSpreadsheetBinding(
  candidate: Partial<PermanentSpreadsheetBinding> | null | undefined
): PermanentSpreadsheetBinding | null {
  if (!candidate || typeof candidate !== 'object') return null;
  const id = String(candidate.spreadsheetId || '').trim();
  if (!id) return null;
  return {
    spreadsheetId: id,
    spreadsheetTitle: String(candidate.spreadsheetTitle || '').trim(),
    spreadsheetUrl:
      String(candidate.spreadsheetUrl || '').trim() ||
      `https://docs.google.com/spreadsheets/d/${id}/edit`,
    appsScriptUrl: String(candidate.appsScriptUrl || '').trim() || undefined,
    driveRootFolderId: String(candidate.driveRootFolderId || '').trim() || undefined,
    driveRootFolderUrl:
      String(candidate.driveRootFolderUrl || '').trim() || undefined,
    connectedEmail: String(candidate.connectedEmail || '').trim() || undefined,
    lastSyncedAt: candidate.lastSyncedAt || null,
    savedAtMs:
      typeof candidate.savedAtMs === 'number' ? candidate.savedAtMs : Date.now(),
  };
}

/**
 * Permanently saves the bound Google Spreadsheet metadata across 4 browser storage layers
 * (LocalStorage + SessionStorage + 400-day Cookie + IndexedDB). Never stores OAuth tokens.
 */
export function persistPermanentSpreadsheetBinding(
  input: Omit<PermanentSpreadsheetBinding, 'savedAtMs'> & { savedAtMs?: number }
): void {
  if (typeof window === 'undefined') return;
  const normalized = parseSpreadsheetBinding({
    ...input,
    savedAtMs: input.savedAtMs || Date.now(),
  });
  if (!normalized) return;

  const existing = readSpreadsheetBindingSyncWithoutHeal();
  const merged: PermanentSpreadsheetBinding = {
    spreadsheetId: normalized.spreadsheetId,
    spreadsheetTitle:
      normalized.spreadsheetTitle ||
      (existing?.spreadsheetId === normalized.spreadsheetId
        ? existing.spreadsheetTitle
        : '') ||
      '',
    spreadsheetUrl: normalized.spreadsheetUrl,
    appsScriptUrl:
      input.appsScriptUrl !== undefined
        ? normalized.appsScriptUrl
        : existing?.appsScriptUrl,
    driveRootFolderId:
      normalized.driveRootFolderId || existing?.driveRootFolderId,
    driveRootFolderUrl:
      normalized.driveRootFolderUrl || existing?.driveRootFolderUrl,
    connectedEmail: normalized.connectedEmail || existing?.connectedEmail,
    lastSyncedAt: normalized.lastSyncedAt ?? existing?.lastSyncedAt ?? null,
    savedAtMs: Date.now(),
  };

  const serialized = JSON.stringify(merged);
  try {
    window.localStorage.setItem(SPREADSHEET_BINDING_STORAGE_KEY, serialized);
  } catch {
    // Ignore quota errors
  }
  try {
    window.sessionStorage.setItem(SPREADSHEET_BINDING_STORAGE_KEY, serialized);
  } catch {
    // Ignore quota errors
  }
  writeSpreadsheetBindingCookie(serialized);
  void idbSet(KEY_SPREADSHEET_BINDING, merged);
}

function readSpreadsheetBindingSyncWithoutHeal(): PermanentSpreadsheetBinding | null {
  if (typeof window === 'undefined') return null;
  const candidates: Array<string | null> = [];
  try {
    candidates.push(window.localStorage.getItem(SPREADSHEET_BINDING_STORAGE_KEY));
  } catch {
    // Ignore
  }
  try {
    candidates.push(
      window.sessionStorage.getItem(SPREADSHEET_BINDING_STORAGE_KEY)
    );
  } catch {
    // Ignore
  }
  candidates.push(readCookieValue(SPREADSHEET_BINDING_COOKIE_KEY));

  for (const raw of candidates) {
    if (!raw) continue;
    try {
      const parsed = parseSpreadsheetBinding(
        JSON.parse(raw) as Partial<PermanentSpreadsheetBinding>
      );
      if (parsed) return parsed;
    } catch {
      // Try next layer
    }
  }
  return null;
}

export function readPermanentSpreadsheetBindingSync(): PermanentSpreadsheetBinding | null {
  const found = readSpreadsheetBindingSyncWithoutHeal();
  if (found) {
    const serialized = JSON.stringify(found);
    try {
      if (!window.localStorage.getItem(SPREADSHEET_BINDING_STORAGE_KEY)) {
        window.localStorage.setItem(SPREADSHEET_BINDING_STORAGE_KEY, serialized);
      }
    } catch {
      // Ignore
    }
    try {
      if (!window.sessionStorage.getItem(SPREADSHEET_BINDING_STORAGE_KEY)) {
        window.sessionStorage.setItem(
          SPREADSHEET_BINDING_STORAGE_KEY,
          serialized
        );
      }
    } catch {
      // Ignore
    }
  }
  return found;
}

export async function readPermanentSpreadsheetBindingAsync(): Promise<PermanentSpreadsheetBinding | null> {
  const syncFound = readPermanentSpreadsheetBindingSync();
  if (syncFound) return syncFound;
  const fromIdb = parseSpreadsheetBinding(
    await idbGet<Partial<PermanentSpreadsheetBinding>>(KEY_SPREADSHEET_BINDING)
  );
  if (fromIdb) {
    persistPermanentSpreadsheetBinding(fromIdb);
    return fromIdb;
  }
  return null;
}

export function clearPermanentSpreadsheetBinding(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(SPREADSHEET_BINDING_STORAGE_KEY);
  } catch {
    // Ignore
  }
  try {
    window.sessionStorage.removeItem(SPREADSHEET_BINDING_STORAGE_KEY);
  } catch {
    // Ignore
  }
  writeSpreadsheetBindingCookie(null);
  void idbDelete(KEY_SPREADSHEET_BINDING);
}

export const CLEAN_START_MARKER = 'crk_clean_surat_tugas_v2026_11_02_v2';
export const PENDING_CLOUD_ASSIGNMENT_PURGE_KEY =
  'crk_pending_cloud_assignment_purge_v2';
const WORKSPACE_BACKUP_LOCAL_KEY = 'crk_workspace_backup_v1';
const LEGACY_MAKE_STORAGE_KEYS = [
  'crk_make_webhook_pending_queue_v1',
  'crk_client_webhook_logs_v1',
];

async function idbGetAllKeys(): Promise<string[]> {
  const db = await openVaultDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_KV, 'readonly');
      const store = tx.objectStore(STORE_KV);
      const req = store.getAllKeys();
      req.onsuccess = () =>
        resolve((req.result || []).map((k) => String(k)));
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

function purgeStorageKeysByPrefixes(
  storage: Storage,
  prefixes: string[],
  exactKeys: string[] = []
): void {
  try {
    for (const k of exactKeys) {
      storage.removeItem(k);
    }
    const toRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      if (prefixes.some((p) => key.startsWith(p))) {
        toRemove.push(key);
      }
    }
    for (const key of toRemove) {
      storage.removeItem(key);
    }
  } catch {
    // Ignore storage access errors
  }
}

/**
 * Purges all cached Surat Tugas, driver form drafts, and pending offline report sync queues
 * across LocalStorage, SessionStorage, and IndexedDB while preserving Master Data,
 * Admin PIN, login session, and bound Spreadsheet config.
 */
export async function purgeAssignmentsClientCacheOnly(): Promise<void> {
  if (typeof window === 'undefined') return;

  const assignmentPrefixes = [
    SURAT_TUGAS_LOCAL_CACHE_PREFIX,
    KEY_DRIVER_TASKS_PREFIX,
    KEY_DRIVER_DRAFT_PREFIX,
    'pending_report_sync_',
    'crk_make_',
    'crk_client_webhook',
  ];
  const exactQueueKeys = [
    ...LEGACY_MAKE_STORAGE_KEYS,
    'crk_pending_report_sync_queue_v2',
    'crk_pending_report_sync_queue_v1',
    'crk_pending_item_retry_statuses_v1',
  ];

  purgeStorageKeysByPrefixes(
    window.localStorage,
    assignmentPrefixes,
    exactQueueKeys
  );
  purgeStorageKeysByPrefixes(
    window.sessionStorage,
    assignmentPrefixes,
    exactQueueKeys
  );

  try {
    const rawBackup = window.localStorage.getItem(WORKSPACE_BACKUP_LOCAL_KEY);
    if (rawBackup) {
      const parsed = JSON.parse(rawBackup) as {
        config?: Record<string, unknown>;
        drivers?: unknown[];
        vehicles?: Array<Record<string, unknown>>;
        routes?: unknown[];
        assignments?: unknown[];
      };
      if (parsed && typeof parsed === 'object') {
        parsed.assignments = [];
        if (parsed.config && typeof parsed.config === 'object') {
          parsed.config.lastSequence = 0;
          delete parsed.config.webhookUrl;
          delete parsed.config.lastWebhookDispatch;
        }
        if (Array.isArray(parsed.vehicles)) {
          parsed.vehicles = parsed.vehicles.map((v) => ({
            ...v,
            status: v.status === 'Dalam Tugas' ? 'Siap Jalan' : v.status,
          }));
        }
        window.localStorage.setItem(
          WORKSPACE_BACKUP_LOCAL_KEY,
          JSON.stringify(parsed)
        );
      }
    }
  } catch {
    try {
      window.localStorage.removeItem(WORKSPACE_BACKUP_LOCAL_KEY);
    } catch {
      // Ignore
    }
  }

  const keys = await idbGetAllKeys();
  for (const key of keys) {
    if (
      key.startsWith(KEY_SURAT_TUGAS_IDB_PREFIX) ||
      key.startsWith(KEY_DRIVER_TASKS_PREFIX) ||
      key.startsWith(KEY_DRIVER_DRAFT_PREFIX) ||
      key.startsWith(KEY_PENDING_SYNC_PHOTOS_PREFIX)
    ) {
      await idbDelete(key);
    }
  }

  const ws = await idbGet<AppStateResponse>(KEY_WORKSPACE);
  if (ws) {
    await idbSet<AppStateResponse>(KEY_WORKSPACE, {
      ...ws,
      assignments: [],
      notifications: [],
      vehicles: Array.isArray(ws.vehicles)
        ? ws.vehicles.map((v) => ({
            ...v,
            status: v.status === 'Dalam Tugas' ? 'Siap Jalan' : v.status,
          }))
        : [],
      config: {
        ...ws.config,
        lastSequence: 0,
      },
    });
  }
}

/**
 * One-time clean start purge for Surat Tugas caches & legacy Make.com artifacts
 * while preserving Master Data, Admin PIN, login session, and bound Spreadsheet config.
 */
export function runCleanStartAssignmentPurgeOnce(): boolean {
  if (typeof window === 'undefined') return false;

  // Always strip any leftover Make.com webhook storage keys
  purgeStorageKeysByPrefixes(
    window.localStorage,
    ['crk_make_', 'crk_client_webhook'],
    LEGACY_MAKE_STORAGE_KEYS
  );

  try {
    window.localStorage.setItem(CLEAN_START_MARKER, '1');
    // Clear any stuck cloud/server purge flag so refreshing never wipes Surat Tugas
    window.localStorage.removeItem(PENDING_CLOUD_ASSIGNMENT_PURGE_KEY);
  } catch {
    // Ignore storage quota errors
  }

  return false;
}

function isCompletedOlderThanMs(
  asg: Partial<Assignment> | null | undefined,
  nowMs: number,
  maxAgeMs: number
): boolean {
  if (!asg || typeof asg !== 'object') return false;
  const statusNorm = String(asg.status || '')
    .trim()
    .toLowerCase();
  const isCompleted =
    statusNorm === 'handover' ||
    statusNorm === 'selesai' ||
    Boolean(asg.handoverData?.penerimaNama);
  if (!isCompleted) return false;

  const candidateTs =
    asg.handoverData?.timestamp ||
    asg.deliveredAt ||
    asg.departureData?.timestamp ||
    asg.createdAt ||
    (asg.tanggalTugas ? `${asg.tanggalTugas}T00:00:00` : '');
  if (!candidateTs) return false;

  const parsedMs = Date.parse(candidateTs);
  if (!Number.isFinite(parsedMs)) return false;
  return nowMs - parsedMs > maxAgeMs;
}

/**
 * Automatically prunes local browser cache (localStorage + IndexedDB) for Surat Tugas
 * that have been in 'Handover' or 'Selesai' status for more than 7 days to keep device memory light.
 */
export async function pruneCompletedAssignmentsCacheOlderThan7Days(
  maxAgeMs: number = 7 * 24 * 60 * 60 * 1000
): Promise<number> {
  if (typeof window === 'undefined') return 0;
  const nowMs = Date.now();
  const expiredIds = new Set<string>();

  try {
    const keysToInspect: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k) keysToInspect.push(k);
    }

    for (const key of keysToInspect) {
      if (key.startsWith(SURAT_TUGAS_LOCAL_CACHE_PREFIX)) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          const parsed = JSON.parse(raw) as Partial<Assignment>;
          if (isCompletedOlderThanMs(parsed, nowMs, maxAgeMs)) {
            const id =
              parsed.id || key.slice(SURAT_TUGAS_LOCAL_CACHE_PREFIX.length);
            if (id) expiredIds.add(id);
            window.localStorage.removeItem(key);
          }
        } catch {
          // Ignore malformed entry
        }
      } else if (key.startsWith(KEY_DRIVER_TASKS_PREFIX)) {
        const raw = window.localStorage.getItem(key);
        if (!raw) continue;
        try {
          const list = JSON.parse(raw) as Assignment[];
          if (Array.isArray(list)) {
            const kept = list.filter((item) => {
              const expired = isCompletedOlderThanMs(item, nowMs, maxAgeMs);
              if (expired && item?.id) expiredIds.add(item.id);
              return !expired;
            });
            if (kept.length !== list.length) {
              if (kept.length === 0) {
                window.localStorage.removeItem(key);
              } else {
                window.localStorage.setItem(key, JSON.stringify(kept));
              }
            }
          }
        } catch {
          // Ignore
        }
      }
    }

    const rawBackup = window.localStorage.getItem(WORKSPACE_BACKUP_LOCAL_KEY);
    if (rawBackup) {
      try {
        const parsedBackup = JSON.parse(rawBackup) as {
          assignments?: Assignment[];
          [k: string]: unknown;
        };
        if (parsedBackup && Array.isArray(parsedBackup.assignments)) {
          const kept = parsedBackup.assignments.filter((a) => {
            const expired = isCompletedOlderThanMs(a, nowMs, maxAgeMs);
            if (expired && a?.id) expiredIds.add(a.id);
            return !expired;
          });
          if (kept.length !== parsedBackup.assignments.length) {
            parsedBackup.assignments = kept;
            window.localStorage.setItem(
              WORKSPACE_BACKUP_LOCAL_KEY,
              JSON.stringify(parsedBackup)
            );
          }
        }
      } catch {
        // Ignore
      }
    }
  } catch {
    // Ignore localStorage quota/access errors
  }

  // Prune IndexedDB snapshots, drafts, pending photos, driver task lists, and heavy cached photos
  try {
    const idbKeys = await idbGetAllKeys();
    for (const key of idbKeys) {
      if (key.startsWith(KEY_SURAT_TUGAS_IDB_PREFIX)) {
        const id = key.slice(KEY_SURAT_TUGAS_IDB_PREFIX.length);
        const snap = await idbGet<Partial<Assignment>>(key);
        if (
          expiredIds.has(id) ||
          isCompletedOlderThanMs(snap, nowMs, maxAgeMs)
        ) {
          if (id) expiredIds.add(id);
          await idbDelete(key);
        }
      } else if (key.startsWith(KEY_DRIVER_TASKS_PREFIX)) {
        const list = await idbGet<Assignment[]>(key);
        if (Array.isArray(list)) {
          const kept = list.filter((item) => {
            const expired = isCompletedOlderThanMs(item, nowMs, maxAgeMs);
            if (expired && item?.id) expiredIds.add(item.id);
            return !expired;
          });
          if (kept.length !== list.length) {
            if (kept.length === 0) {
              await idbDelete(key);
            } else {
              await idbSet(key, kept);
            }
          }
        }
      }
    }

    for (const id of expiredIds) {
      await idbDelete(`${KEY_DRIVER_DRAFT_PREFIX}${id}`);
      try {
        window.localStorage.removeItem(`${KEY_DRIVER_DRAFT_PREFIX}${id}`);
        window.localStorage.removeItem(`pending_report_sync_${id}`);
      } catch {
        // Ignore
      }
      for (const key of idbKeys) {
        if (key.startsWith(`${KEY_PENDING_SYNC_PHOTOS_PREFIX}${id}__`)) {
          await idbDelete(key);
        }
      }
    }

    const ws = await idbGet<AppStateResponse>(KEY_WORKSPACE);
    if (ws && Array.isArray(ws.assignments) && ws.assignments.length > 0) {
      let wsChanged = false;
      const prunedWsAssignments = ws.assignments.filter((a) => {
        const expired = isCompletedOlderThanMs(a, nowMs, maxAgeMs);
        if (expired) {
          wsChanged = true;
          if (a?.id) expiredIds.add(a.id);
        }
        return !expired;
      });
      if (wsChanged) {
        await idbSet<AppStateResponse>(KEY_WORKSPACE, {
          ...ws,
          assignments: prunedWsAssignments,
        });
      }
    }
  } catch {
    // Ignore IDB errors
  }

  return expiredIds.size;
}

function deleteIdbDatabaseWithTimeout(
  dbName: string,
  timeoutMs = 700
): Promise<void> {
  if (typeof window === 'undefined' || !('indexedDB' in window)) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    const timer = window.setTimeout(finish, timeoutMs);
    try {
      const req = window.indexedDB.deleteDatabase(dbName);
      req.onsuccess = () => {
        window.clearTimeout(timer);
        finish();
      };
      req.onerror = () => {
        window.clearTimeout(timer);
        finish();
      };
      req.onblocked = () => {
        window.clearTimeout(timer);
        finish();
      };
    } catch {
      window.clearTimeout(timer);
      finish();
    }
  });
}

/**
 * Full client-side reset triggered by Admin 'Reset Aplikasi' button:
 * clears localStorage, sessionStorage, cookies, Cache Storage, and IndexedDB
 * (including Vault & Firebase Firestore local persistence caches).
 */
export async function resetAllApplicationClientStorage(): Promise<void> {
  if (typeof window === 'undefined') return;

  try {
    writeSessionCookie(null);
    writeSpreadsheetBindingCookie(null);
  } catch {
    // Ignore
  }

  try {
    window.localStorage.clear();
    window.localStorage.setItem(CLEAN_START_MARKER, '1');
  } catch {
    // Ignore
  }

  try {
    window.sessionStorage.clear();
  } catch {
    // Ignore
  }

  if ('caches' in window) {
    try {
      const cacheNames = await window.caches.keys();
      await Promise.all(
        cacheNames.map((name) => window.caches.delete(name).catch(() => false))
      );
    } catch {
      // Ignore
    }
  }

  try {
    if (dbPromise) {
      const openDb = await dbPromise.catch(() => null);
      openDb?.close();
      dbPromise = null;
    }
  } catch {
    dbPromise = null;
  }

  const dbNamesToDelete = new Set<string>([DB_NAME]);
  try {
    const idbFactory = window.indexedDB as IDBFactory & {
      databases?: () => Promise<Array<{ name?: string }>>;
    };
    if (typeof idbFactory.databases === 'function') {
      const dbs = await idbFactory.databases();
      for (const info of dbs) {
        if (info?.name) {
          dbNamesToDelete.add(info.name);
        }
      }
    }
  } catch {
    // Fallback to known DB names
  }

  await Promise.all(
    Array.from(dbNamesToDelete).map((name) =>
      deleteIdbDatabaseWithTimeout(name, 700)
    )
  );
}



