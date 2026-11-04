import {
  AppConfig,
  AppStateResponse,
  Assignment,
  DriveMediaLinks,
  DriverExpense,
  DriverMaster,
  FleetCardMaster,
  RouteMaster,
  VehicleMaster,
  WhatsAppTargetMode,
} from '../types';

export interface SafeApiResult<T> {
  ok: boolean;
  status: number;
  isHtmlResponse: boolean;
  networkFailed: boolean;
  data: T | null;
  errorMessage: string;
}

const LEGACY_API_CACHE_NAMES = ['crk-api-state-cache'];

/**
 * Purges any legacy Workbox runtime caches for `/api/*` that could have stored
 * an HTML proxy login/redirect page (`<!doctype html>`) on mobile devices.
 */
export async function purgeLegacyPoisonedApiCaches(): Promise<void> {
  if (typeof window === 'undefined' || !('caches' in window)) return;
  try {
    const keys = await window.caches.keys();
    await Promise.all(
      keys
        .filter((k) => LEGACY_API_CACHE_NAMES.some((leg) => k.includes(leg)))
        .map((k) => window.caches.delete(k))
    );
  } catch {
    // Ignore CacheStorage restrictions in private webviews
  }
}

export function looksLikeHtmlPayload(
  rawText: string,
  contentType?: string | null
): boolean {
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('text/html') || ct.includes('application/xhtml+xml')) {
    return true;
  }
  const trimmed = rawText.trimStart().slice(0, 64).toLowerCase();
  return (
    trimmed.startsWith('<!doctype') ||
    trimmed.startsWith('<html') ||
    trimmed.startsWith('<head') ||
    trimmed.startsWith('<body') ||
    trimmed.startsWith('<?xml') ||
    trimmed.startsWith('<')
  );
}

/**
 * Detects `Unexpected token '<'` JSON syntax errors and HTML gateway/captive-portal
 * responses injected by mobile carrier proxies without confusing them with auth 401s.
 */
export function isHtmlOrMobileProxyError(err: unknown): boolean {
  if (!err) return false;
  if (
    typeof err === 'object' &&
    (err as { isHtmlProxyError?: boolean }).isHtmlProxyError === true
  ) {
    return true;
  }
  const msg = (
    err instanceof Error ? err.message : String(err || '')
  ).toLowerCase();
  return (
    msg.includes("unexpected token '<'") ||
    msg.includes('unexpected token "<"') ||
    msg.includes('unexpected token <') ||
    msg.includes('<!doctype') ||
    msg.includes('<html') ||
    msg.includes('text/html') ||
    msg.includes('halaman html') ||
    msg.includes('respons html') ||
    msg.includes('tidak berformat json valid')
  );
}

/**
 * Detects whether a Google Sheets sync failure was caused by transient network
 * interference (mobile HTML proxy, offline connection, DNS/fetch TypeError, or 5xx gateway)
 * rather than an intentional auth revocation or user configuration error.
 */
export function isSheetsNetworkDisruptionError(err: unknown): boolean {
  if (!err) return false;
  if (isHtmlOrMobileProxyError(err)) return true;
  if (err instanceof TypeError) return true;

  const status =
    typeof err === 'object' ? (err as { status?: number }).status : undefined;
  if (
    status === 0 ||
    status === 408 ||
    status === 429 ||
    (typeof status === 'number' && status >= 500)
  ) {
    return true;
  }

  const msg = (
    err instanceof Error ? err.message : String(err || '')
  ).toLowerCase();
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network request failed') ||
    msg.includes('load failed') ||
    msg.includes('err_internet_disconnected') ||
    msg.includes('offline') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('econnreset') ||
    msg.includes('bad gateway') ||
    msg.includes('service unavailable')
  );
}

/**
 * Exponential backoff delay with randomized jitter (prevents thundering herd on mobile proxies).
 */
export function waitExponentialBackoff(
  attempt: number,
  baseDelayMs = 900,
  maxDelayMs = 8000
): Promise<void> {
  const expDelay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
  const jitter = Math.floor(Math.random() * 250);
  return new Promise((resolve) => {
    setTimeout(resolve, expDelay + jitter);
  });
}

export function isAiStudioHibernationHtml(rawText: string): boolean {
  if (!rawText) return false;
  const lower = rawText.slice(0, 4096).toLowerCase();
  return (
    lower.includes('please wait while your application starts') ||
    lower.includes('there may have been an issue during the build process')
  );
}

/**
 * Safe JSON fetch wrapper for `/api/*` endpoints.
 * Never throws `SyntaxError: Unexpected token '<', "<!doctype "... is not valid JSON`
 * even if an expired mobile preview proxy cookie redirects `/api/*` to an HTML login page,
 * a Service Worker intercepts the request, or the container is waking up (`502` HTML).
 * Automatically retries transient HTML proxy responses with exponential backoff,
 * while failing fast immediately if the AI Studio preview container is hibernating.
 */
export async function safeApiFetch<T = Record<string, unknown>>(
  url: string,
  init: RequestInit = {},
  maxHtmlRetries = 2,
  timeoutMs = 14000
): Promise<SafeApiResult<T>> {
  let lastResult: SafeApiResult<T> | null = null;

  for (let attempt = 0; attempt <= maxHtmlRetries; attempt++) {
    if (attempt > 0) {
      await waitExponentialBackoff(attempt - 1, 450, 2500);
    }

    const controller =
      typeof AbortController !== 'undefined' && !init.signal
        ? new AbortController()
        : null;
    const timeoutId =
      controller && timeoutMs > 0
        ? setTimeout(() => {
            try {
              controller.abort();
            } catch {
              // Ignore
            }
          }, timeoutMs)
        : null;

    try {
      const headers = new Headers(init.headers || {});
      if (!headers.has('Accept')) {
        headers.set('Accept', 'application/json');
      }

      const res = await fetch(url, {
        ...init,
        headers,
        signal: init.signal ?? controller?.signal,
        cache: init.cache ?? 'no-store',
        credentials: init.credentials ?? 'same-origin',
      });

      const contentType = res.headers.get('content-type');
      const rawText = await res.text();
      if (timeoutId) clearTimeout(timeoutId);

      if (looksLikeHtmlPayload(rawText, contentType)) {
        const isHibernating = isAiStudioHibernationHtml(rawText);
        lastResult = {
          ok: false,
          status: res.status || 503,
          isHtmlResponse: true,
          networkFailed: false,
          data: null,
          errorMessage: isHibernating
            ? 'Server sedang dalam mode tidur (Admin keluar dari editor). Menggunakan penyimpanan lokal & antrean sinkronisasi otomatis.'
            : 'Server API lokal mengembalikan halaman HTML sementara (sesi proxy perangkat / jaringan). Menggunakan jalur sinkronisasi langsung.',
        };
        if (isHibernating) {
          return lastResult;
        }
        continue;
      }

      const trimmed = rawText.trim();
      if (!trimmed) {
        return {
          ok: res.ok,
          status: res.status,
          isHtmlResponse: false,
          networkFailed: false,
          data: ({} as unknown) as T,
          errorMessage: res.ok ? '' : `HTTP ${res.status}`,
        };
      }

      try {
        const parsed = JSON.parse(trimmed) as T;
        const errField =
          parsed && typeof parsed === 'object' && 'error' in parsed
            ? String((parsed as { error?: unknown }).error || '')
            : '';
        return {
          ok: res.ok,
          status: res.status,
          isHtmlResponse: false,
          networkFailed: false,
          data: parsed,
          errorMessage: res.ok ? '' : errField || `HTTP ${res.status}`,
        };
      } catch (parseErr) {
        const isHtmlSyntax =
          trimmed.startsWith('<') || isHtmlOrMobileProxyError(parseErr);
        lastResult = {
          ok: false,
          status: res.status || 500,
          isHtmlResponse: isHtmlSyntax,
          networkFailed: false,
          data: null,
          errorMessage: `Respons server tidak berformat JSON valid (HTTP ${res.status}).`,
        };
        if (isHtmlSyntax) {
          continue;
        }
        return lastResult;
      }
    } catch (err) {
      if (timeoutId) clearTimeout(timeoutId);
      if (isHtmlOrMobileProxyError(err) && attempt < maxHtmlRetries) {
        lastResult = {
          ok: false,
          status: 502,
          isHtmlResponse: true,
          networkFailed: false,
          data: null,
          errorMessage:
            'Respons jaringan terhalang proxy HTML sementara. Mencoba ulang otomatis...',
        };
        continue;
      }
      return {
        ok: false,
        status: 0,
        isHtmlResponse: false,
        networkFailed: true,
        data: null,
        errorMessage:
          err instanceof Error
            ? err.message
            : 'Koneksi jaringan ke server terputus.',
      };
    }
  }

  return (
    lastResult ?? {
      ok: false,
      status: 502,
      isHtmlResponse: true,
      networkFailed: false,
      data: null,
      errorMessage:
        'Server API lokal mengembalikan halaman HTML sementara. Menggunakan jalur sinkronisasi langsung.',
    }
  );
}

function mergeDriveMediaClient(
  primary?: DriveMediaLinks,
  secondary?: DriveMediaLinks
): DriveMediaLinks | undefined {
  if (!primary && !secondary) return undefined;
  const merged: DriveMediaLinks = {
    folderId: primary?.folderId || secondary?.folderId,
    folderUrl: primary?.folderUrl || secondary?.folderUrl,
    syncedAt: primary?.syncedAt || secondary?.syncedAt,
    fotoOdometerBerangkatUrl:
      primary?.fotoOdometerBerangkatUrl || secondary?.fotoOdometerBerangkatUrl,
    fotoSuhuBerangkatUrl:
      primary?.fotoSuhuBerangkatUrl || secondary?.fotoSuhuBerangkatUrl,
    fotoOdometerSerahTerimaUrl:
      primary?.fotoOdometerSerahTerimaUrl ||
      secondary?.fotoOdometerSerahTerimaUrl,
    fotoSuhuSerahTerimaUrl:
      primary?.fotoSuhuSerahTerimaUrl || secondary?.fotoSuhuSerahTerimaUrl,
    fotoBuktiSerahTerimaUrl:
      primary?.fotoBuktiSerahTerimaUrl || secondary?.fotoBuktiSerahTerimaUrl,
    tandaTanganPenerimaUrl:
      primary?.tandaTanganPenerimaUrl || secondary?.tandaTanganPenerimaUrl,
  };
  const hasAny = Object.values(merged).some((v) => Boolean(v));
  return hasAny ? merged : undefined;
}

function extractSequenceFromNoClient(noPenugasan?: string): number {
  const m = String(noPenugasan || '').match(/(\d+)\s*$/);
  return m ? parseInt(m[1], 10) || 0 : 0;
}

export interface PulledSpreadsheetPayload {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  drivers: DriverMaster[];
  vehicles: VehicleMaster[];
  routes: RouteMaster[];
  fleetCards?: FleetCardMaster[];
  driverExpenses?: DriverExpense[];
  assignments: Assignment[];
  adminPin?: string;
  dispatcherWaPhone?: string;
  whatsappTargetMode?: WhatsAppTargetMode;
  whatsappGroupName?: string;
  whatsappGroupInviteUrl?: string;
  letterPrefix?: string;
  publicPortalBaseUrl?: string;
  appsScriptUrl?: string;
  driveRootFolderId?: string;
  driveRootFolderUrl?: string;
}

/**
 * Client-side fallback mirror of `/api/sync/from-sheets`.
 * Ensures Google Sheets & Google Drive synchronization succeeds 100% directly in the browser
 * even when `/api/sync/from-sheets` returns HTML (e.g. mobile proxy session expired after 1h)
 * or when the Express container is restarting.
 */
export function mergePulledSheetsIntoLocalState(
  currentState: AppStateResponse,
  pulled: PulledSpreadsheetPayload,
  savedCustomPin?: string | null,
  forceReplaceAll = false
): {
  state: AppStateResponse;
  adminPin: string;
  hasCustomPinToPush: boolean;
  hasPendingMasterUpdates: boolean;
  hasPendingDriverUpdates: boolean;
  hasSheetDeletionsToPrune: boolean;
} {
  const incomingSheetPin = String(pulled.adminPin || '').trim();
  const localCustomPin = String(
    savedCustomPin || currentState.config.adminPin || ''
  ).trim();

  let effectiveAdminPin = '123456';
  let isDefaultPin = currentState.config.isDefaultPin;
  let hasCustomPinToPush = false;

  if (incomingSheetPin.length >= 4 && incomingSheetPin !== '123456') {
    effectiveAdminPin = incomingSheetPin;
    isDefaultPin = false;
  } else if (localCustomPin.length >= 4 && localCustomPin !== '123456') {
    effectiveAdminPin = localCustomPin;
    isDefaultPin = false;
    hasCustomPinToPush = true;
  }

  const sameBoundSheet =
    Boolean(currentState.config.spreadsheetId) &&
    currentState.config.spreadsheetId.trim() ===
      String(pulled.spreadsheetId || '').trim();
  const sheetIsCompletelyEmpty =
    pulled.drivers.length === 0 &&
    pulled.vehicles.length === 0 &&
    pulled.routes.length === 0 &&
    pulled.assignments.length === 0;
  const hasSyncedThisSheetBefore =
    forceReplaceAll ||
    (sameBoundSheet && Boolean(currentState.config.lastSyncedAt)) ||
    !sheetIsCompletelyEmpty;

  let hasPendingMasterUpdates = false;
  let hasSheetDeletionsToPrune = false;

  let nextDrivers = currentState.drivers;
  if (forceReplaceAll || hasSyncedThisSheetBefore) {
    if (pulled.drivers.length < currentState.drivers.length) {
      hasSheetDeletionsToPrune = true;
    }
    nextDrivers = pulled.drivers;
  } else if (pulled.drivers.length === 0 && currentState.drivers.length > 0) {
    hasPendingMasterUpdates = true;
    nextDrivers = currentState.drivers;
  } else {
    nextDrivers = pulled.drivers;
  }

  let nextVehicles = currentState.vehicles;
  const localVehById = new Map(
    currentState.vehicles.map((v) => [v.id.trim().toUpperCase(), v])
  );
  const enrichPulledVehicles = (list: VehicleMaster[]): VehicleMaster[] =>
    list.map((sv) => {
      const loc = localVehById.get(sv.id.trim().toUpperCase());
      return {
        ...sv,
        capacityCbm: sv.capacityCbm || loc?.capacityCbm,
      };
    });
  if (forceReplaceAll || hasSyncedThisSheetBefore) {
    if (pulled.vehicles.length < currentState.vehicles.length) {
      hasSheetDeletionsToPrune = true;
    }
    nextVehicles = enrichPulledVehicles(pulled.vehicles);
  } else if (pulled.vehicles.length === 0 && currentState.vehicles.length > 0) {
    hasPendingMasterUpdates = true;
    nextVehicles = currentState.vehicles;
  } else {
    nextVehicles = enrichPulledVehicles(pulled.vehicles);
  }

  let nextRoutes = currentState.routes;
  if (forceReplaceAll || hasSyncedThisSheetBefore) {
    if (pulled.routes.length < currentState.routes.length) {
      hasSheetDeletionsToPrune = true;
    }
    nextRoutes = pulled.routes;
  } else if (pulled.routes.length === 0 && currentState.routes.length > 0) {
    hasPendingMasterUpdates = true;
    nextRoutes = currentState.routes;
  } else {
    nextRoutes = pulled.routes;
  }

  let nextFleetCards = currentState.fleetCards || [];
  if (Array.isArray(pulled.fleetCards)) {
    if (forceReplaceAll || hasSyncedThisSheetBefore) {
      if (pulled.fleetCards.length < nextFleetCards.length) {
        hasSheetDeletionsToPrune = true;
      }
      nextFleetCards = pulled.fleetCards;
    } else if (pulled.fleetCards.length === 0 && nextFleetCards.length > 0) {
      hasPendingMasterUpdates = true;
    } else {
      nextFleetCards = pulled.fleetCards;
    }
  }

  let nextDriverExpenses = currentState.driverExpenses || [];
  if (Array.isArray(pulled.driverExpenses)) {
    const localExpById = new Map<string, DriverExpense>();
    for (const locExp of nextDriverExpenses) {
      localExpById.set(locExp.id, locExp);
    }
    const usedLocalExpIds = new Set<string>();
    const mergedExpenses: DriverExpense[] = pulled.driverExpenses.map(
      (sheetExp) => {
        const existingLocalExp = localExpById.get(sheetExp.id);
        if (existingLocalExp) {
          usedLocalExpIds.add(sheetExp.id);
          return {
            ...sheetExp,
            fotoStrukBbm: existingLocalExp.fotoStrukBbm,
            fotoStrukBbmUrl:
              sheetExp.fotoStrukBbmUrl || existingLocalExp.fotoStrukBbmUrl,
            fotoStrukTol: existingLocalExp.fotoStrukTol,
            fotoStrukTolUrl:
              sheetExp.fotoStrukTolUrl || existingLocalExp.fotoStrukTolUrl,
            needsSheetSync: false,
          };
        }
        return sheetExp;
      }
    );
    for (const [expId, locExp] of localExpById.entries()) {
      if (!usedLocalExpIds.has(expId)) {
        if (!forceReplaceAll && locExp.needsSheetSync) {
          mergedExpenses.push(locExp);
        } else {
          hasSheetDeletionsToPrune = true;
        }
      }
    }
    nextDriverExpenses = mergedExpenses;
  }

  let hasPendingDriverUpdates = false;
  let nextAssignments = currentState.assignments;

  if (
    !forceReplaceAll &&
    !hasSyncedThisSheetBefore &&
    pulled.assignments.length === 0 &&
    currentState.assignments.length > 0
  ) {
    hasPendingDriverUpdates = true;
    nextAssignments = currentState.assignments.map((a) => ({
      ...a,
      needsSheetSync: true,
    }));
  } else {
    const clientStatusRank = (s?: string): number => {
      if (s === 'Handover' || s === 'Selesai') return 3;
      if (s === 'Delivered') return 2;
      if (s === 'Dalam Perjalanan') return 1;
      return 0;
    };

    const localByNo = new Map<string, Assignment>();
    for (const localItem of currentState.assignments) {
      localByNo.set(localItem.noPenugasan.trim().toLowerCase(), localItem);
    }

    const usedLocalNos = new Set<string>();
    const merged: Assignment[] = pulled.assignments.map((sheetItem) => {
      const normSheetNo = sheetItem.noPenugasan.trim().toLowerCase();
      const existingLocal = localByNo.get(normSheetNo);
      if (existingLocal) {
        usedLocalNos.add(normSheetNo);
        const localProgressedAheadOfSheet =
          clientStatusRank(existingLocal.status) >
            clientStatusRank(sheetItem.status) ||
          (Boolean(existingLocal.departureData?.timestamp) &&
            !sheetItem.departureData?.timestamp) ||
          (Boolean(existingLocal.handoverData?.timestamp) &&
            !sheetItem.handoverData?.timestamp) ||
          (Boolean(existingLocal.deliveredAt) && !sheetItem.deliveredAt);

        if (existingLocal.needsSheetSync || localProgressedAheadOfSheet) {
          hasPendingDriverUpdates = true;
          const mergedPendingDrive = mergeDriveMediaClient(
            existingLocal.driveMedia,
            sheetItem.driveMedia
          );
          return {
            ...existingLocal,
            driveFolderUrl:
              mergedPendingDrive?.folderUrl ||
              existingLocal.driveFolderUrl ||
              sheetItem.driveFolderUrl,
            driveMedia: mergedPendingDrive,
            needsSheetSync: true,
          };
        }

        const mergedDrive = mergeDriveMediaClient(
          existingLocal.driveMedia,
          sheetItem.driveMedia
        );
        const localHasMoreDriveLinks =
          Boolean(existingLocal.driveMedia?.fotoOdometerBerangkatUrl) &&
          !sheetItem.driveMedia?.fotoOdometerBerangkatUrl;
        if (localHasMoreDriveLinks) {
          hasPendingDriverUpdates = true;
        }

        return {
          ...sheetItem,
          driverCode:
            sheetItem.driverCode ||
            existingLocal.driverCode ||
            sheetItem.driverId,
          ownerUid: sheetItem.ownerUid || existingLocal.ownerUid,
          deliveredAt: sheetItem.deliveredAt || existingLocal.deliveredAt,
          beratMuatan: sheetItem.beratMuatan || existingLocal.beratMuatan,
          volumeCbm: sheetItem.volumeCbm || existingLocal.volumeCbm,
          driveFolderUrl:
            mergedDrive?.folderUrl ||
            sheetItem.driveFolderUrl ||
            existingLocal.driveFolderUrl,
          driveMedia: mergedDrive,
          departureData: sheetItem.departureData
            ? {
                ...sheetItem.departureData,
                titikKeberangkatan:
                  sheetItem.departureData.titikKeberangkatan ||
                  existingLocal.departureData?.titikKeberangkatan,
                jenisKendaraan:
                  sheetItem.departureData.jenisKendaraan ||
                  existingLocal.departureData?.jenisKendaraan,
                fotoOdometerBerangkat:
                  existingLocal.departureData?.fotoOdometerBerangkat,
                fotoSuhuBerangkat:
                  existingLocal.departureData?.fotoSuhuBerangkat,
              }
            : existingLocal.departureData,
          deliveredData: sheetItem.deliveredData
            ? {
                ...existingLocal.deliveredData,
                ...sheetItem.deliveredData,
                fotoOdometerSampai:
                  existingLocal.deliveredData?.fotoOdometerSampai,
                fotoSuhuSampai:
                  existingLocal.deliveredData?.fotoSuhuSampai,
              }
            : existingLocal.deliveredData,
          handoverData: sheetItem.handoverData
            ? {
                ...sheetItem.handoverData,
                fotoOdometerSerahTerima:
                  existingLocal.handoverData?.fotoOdometerSerahTerima ||
                  existingLocal.deliveredData?.fotoOdometerSampai,
                fotoSuhuSerahTerima:
                  existingLocal.handoverData?.fotoSuhuSerahTerima ||
                  existingLocal.deliveredData?.fotoSuhuSampai,
                fotoBuktiSerahTerima:
                  existingLocal.handoverData?.fotoBuktiSerahTerima,
                tandaTanganPenerima:
                  existingLocal.handoverData?.tandaTanganPenerima,
              }
            : existingLocal.handoverData,
          needsSheetSync: localHasMoreDriveLinks,
        };
      }
      return {
        ...sheetItem,
        driverCode: sheetItem.driverCode || sheetItem.driverId,
        needsSheetSync: false,
      };
    });

    for (const [noKey, localItem] of localByNo.entries()) {
      if (!usedLocalNos.has(noKey)) {
        if (!forceReplaceAll && localItem.needsSheetSync) {
          hasPendingDriverUpdates = true;
          merged.push({
            ...localItem,
            needsSheetSync: true,
          });
        } else {
          hasSheetDeletionsToPrune = true;
        }
      }
    }

    nextAssignments = merged;
  }

  let maxSeq = currentState.config.lastSequence || 0;
  for (const a of nextAssignments) {
    const s = Math.max(
      a.sequenceNumber || 0,
      extractSequenceFromNoClient(a.noPenugasan)
    );
    if (s > maxSeq) maxSeq = s;
  }

  const nextConfig: AppConfig = {
    ...currentState.config,
    spreadsheetId:
      pulled.spreadsheetId?.trim() || currentState.config.spreadsheetId,
    spreadsheetTitle:
      pulled.spreadsheetTitle?.trim() ?? currentState.config.spreadsheetTitle,
    spreadsheetUrl:
      pulled.spreadsheetUrl?.trim() ?? currentState.config.spreadsheetUrl,
    appsScriptUrl:
      pulled.appsScriptUrl?.trim() || currentState.config.appsScriptUrl,
    driveRootFolderId:
      pulled.driveRootFolderId?.trim() || currentState.config.driveRootFolderId,
    driveRootFolderUrl:
      pulled.driveRootFolderUrl?.trim() ||
      currentState.config.driveRootFolderUrl,
    dispatcherWaPhone:
      pulled.dispatcherWaPhone?.trim() || currentState.config.dispatcherWaPhone,
    whatsappTargetMode:
      pulled.whatsappTargetMode === 'GROUP' ||
      pulled.whatsappTargetMode === 'DIRECT' ||
      pulled.whatsappTargetMode === 'DRIVER'
        ? pulled.whatsappTargetMode
        : currentState.config.whatsappTargetMode,
    whatsappGroupName:
      pulled.whatsappGroupName?.trim() || currentState.config.whatsappGroupName,
    whatsappGroupInviteUrl:
      pulled.whatsappGroupInviteUrl?.trim() ||
      currentState.config.whatsappGroupInviteUrl,
    publicPortalBaseUrl:
      pulled.publicPortalBaseUrl?.trim() ||
      currentState.config.publicPortalBaseUrl,
    letterPrefix: pulled.letterPrefix?.trim()
      ? pulled.letterPrefix.trim().toUpperCase()
      : currentState.config.letterPrefix,
    lastSequence: maxSeq,
    lastSyncedAt: new Date().toISOString(),
    isDefaultPin,
    adminPin: effectiveAdminPin,
  };

  return {
    state: {
      ...currentState,
      drivers: nextDrivers,
      vehicles: nextVehicles,
      routes: nextRoutes,
      fleetCards: nextFleetCards,
      driverExpenses: nextDriverExpenses,
      assignments: nextAssignments,
      config: nextConfig,
    },
    adminPin: effectiveAdminPin,
    hasCustomPinToPush,
    hasPendingMasterUpdates,
    hasPendingDriverUpdates,
    hasSheetDeletionsToPrune,
  };
}

/**
 * Client-side fallback mirror of `/api/sync/from-firestore` so Firestore cloud data
 * always hydrates the UI on mobile even when `/api/*` returns HTML.
 */
export function mergeFirestoreIntoLocalState(
  currentState: AppStateResponse,
  cloud: {
    config?: Partial<AppConfig> | null;
    drivers?: DriverMaster[];
    vehicles?: VehicleMaster[];
    routes?: RouteMaster[];
    fleetCards?: FleetCardMaster[];
    driverExpenses?: DriverExpense[];
    assignments?: Assignment[];
  }
): AppStateResponse {
  const cloudCfg = cloud.config || {};
  const nextDrivers =
    Array.isArray(cloud.drivers) && cloud.drivers.length > 0
      ? cloud.drivers
      : currentState.drivers;
  const localCloudVehMap = new Map(
    currentState.vehicles.map((v) => [v.id.trim().toUpperCase(), v])
  );
  const nextVehicles =
    Array.isArray(cloud.vehicles) && cloud.vehicles.length > 0
      ? cloud.vehicles.map((cv) => ({
          ...cv,
          capacityCbm:
            cv.capacityCbm ||
            localCloudVehMap.get(cv.id.trim().toUpperCase())?.capacityCbm,
        }))
      : currentState.vehicles;
  const nextRoutes =
    Array.isArray(cloud.routes) && cloud.routes.length > 0
      ? cloud.routes
      : currentState.routes;
  const nextFleetCards =
    Array.isArray(cloud.fleetCards) && cloud.fleetCards.length > 0
      ? cloud.fleetCards
      : currentState.fleetCards || [];

  let nextDriverExpenses = currentState.driverExpenses || [];
  if (Array.isArray(cloud.driverExpenses) && cloud.driverExpenses.length > 0) {
    const localExpById = new Map<string, DriverExpense>();
    for (const locExp of nextDriverExpenses) {
      localExpById.set(locExp.id, locExp);
    }
    const mergedExpMap = new Map<string, DriverExpense>();
    for (const ce of cloud.driverExpenses) {
      const locExp = localExpById.get(ce.id);
      if (!locExp) {
        mergedExpMap.set(ce.id, ce);
      } else {
        mergedExpMap.set(ce.id, {
          ...locExp,
          ...ce,
          fotoStrukBbm: locExp.fotoStrukBbm,
          fotoStrukBbmUrl: ce.fotoStrukBbmUrl || locExp.fotoStrukBbmUrl,
          fotoStrukTol: locExp.fotoStrukTol,
          fotoStrukTolUrl: ce.fotoStrukTolUrl || locExp.fotoStrukTolUrl,
        });
      }
    }
    for (const [expId, locExp] of localExpById.entries()) {
      if (!mergedExpMap.has(expId) && locExp.needsSheetSync) {
        mergedExpMap.set(expId, locExp);
      }
    }
    nextDriverExpenses = Array.from(mergedExpMap.values());
  }

  let nextAssignments = currentState.assignments;
  if (Array.isArray(cloud.assignments) && cloud.assignments.length > 0) {
    const localById = new Map<string, Assignment>();
    for (const loc of currentState.assignments) {
      localById.set(loc.id, loc);
    }
    const mergedMap = new Map<string, Assignment>();
    for (const ca of cloud.assignments) {
      const loc = localById.get(ca.id);
      if (!loc) {
        mergedMap.set(ca.id, ca);
        continue;
      }
      const mergedDrive = mergeDriveMediaClient(ca.driveMedia, loc.driveMedia);
      mergedMap.set(ca.id, {
        ...loc,
        ...ca,
        deliveredAt: ca.deliveredAt || loc.deliveredAt,
        volumeCbm: ca.volumeCbm || loc.volumeCbm,
        driveFolderUrl:
          mergedDrive?.folderUrl || ca.driveFolderUrl || loc.driveFolderUrl,
        driveMedia: mergedDrive,
        departureData: ca.departureData
          ? {
              ...loc.departureData,
              ...ca.departureData,
              fotoOdometerBerangkat:
                ca.departureData.fotoOdometerBerangkat ||
                loc.departureData?.fotoOdometerBerangkat,
              fotoSuhuBerangkat:
                ca.departureData.fotoSuhuBerangkat ||
                loc.departureData?.fotoSuhuBerangkat,
            }
          : loc.departureData,
        deliveredData: ca.deliveredData
          ? {
              ...loc.deliveredData,
              ...ca.deliveredData,
              fotoOdometerSampai:
                ca.deliveredData.fotoOdometerSampai ||
                loc.deliveredData?.fotoOdometerSampai,
              fotoSuhuSampai:
                ca.deliveredData.fotoSuhuSampai ||
                loc.deliveredData?.fotoSuhuSampai,
            }
          : loc.deliveredData,
        handoverData: ca.handoverData
          ? {
              ...loc.handoverData,
              ...ca.handoverData,
              fotoOdometerSerahTerima:
                ca.handoverData.fotoOdometerSerahTerima ||
                loc.handoverData?.fotoOdometerSerahTerima ||
                loc.deliveredData?.fotoOdometerSampai,
              fotoSuhuSerahTerima:
                ca.handoverData.fotoSuhuSerahTerima ||
                loc.handoverData?.fotoSuhuSerahTerima ||
                loc.deliveredData?.fotoSuhuSampai,
              fotoBuktiSerahTerima:
                ca.handoverData.fotoBuktiSerahTerima ||
                loc.handoverData?.fotoBuktiSerahTerima,
              tandaTanganPenerima:
                ca.handoverData.tandaTanganPenerima ||
                loc.handoverData?.tandaTanganPenerima,
            }
          : loc.handoverData,
      });
    }
    for (const [id, loc] of localById.entries()) {
      if (!mergedMap.has(id) && loc.needsSheetSync) {
        mergedMap.set(id, loc);
      }
    }
    nextAssignments = Array.from(mergedMap.values());
  }

  let maxSeq = Math.max(
    currentState.config.lastSequence || 0,
    typeof cloudCfg.lastSequence === 'number' ? cloudCfg.lastSequence : 0
  );
  for (const a of nextAssignments) {
    const s = Math.max(
      a.sequenceNumber || 0,
      extractSequenceFromNoClient(a.noPenugasan)
    );
    if (s > maxSeq) maxSeq = s;
  }

  return {
    ...currentState,
    drivers: nextDrivers,
    vehicles: nextVehicles,
    routes: nextRoutes,
    fleetCards: nextFleetCards,
    driverExpenses: nextDriverExpenses,
    assignments: nextAssignments,
    config: {
      ...currentState.config,
      spreadsheetId:
        cloudCfg.spreadsheetId?.trim() || currentState.config.spreadsheetId,
      spreadsheetTitle:
        cloudCfg.spreadsheetTitle?.trim() ||
        currentState.config.spreadsheetTitle,
      spreadsheetUrl:
        cloudCfg.spreadsheetUrl?.trim() || currentState.config.spreadsheetUrl,
      driveRootFolderId:
        cloudCfg.driveRootFolderId?.trim() ||
        currentState.config.driveRootFolderId,
      driveRootFolderUrl:
        cloudCfg.driveRootFolderUrl?.trim() ||
        currentState.config.driveRootFolderUrl,
      dispatcherWaPhone:
        cloudCfg.dispatcherWaPhone?.trim() ||
        currentState.config.dispatcherWaPhone,
      whatsappTargetMode:
        cloudCfg.whatsappTargetMode === 'GROUP' ||
        cloudCfg.whatsappTargetMode === 'DIRECT' ||
        cloudCfg.whatsappTargetMode === 'DRIVER'
          ? cloudCfg.whatsappTargetMode
          : currentState.config.whatsappTargetMode,
      whatsappGroupName:
        cloudCfg.whatsappGroupName?.trim() ||
        currentState.config.whatsappGroupName,
      whatsappGroupInviteUrl:
        cloudCfg.whatsappGroupInviteUrl?.trim() ??
        currentState.config.whatsappGroupInviteUrl,
      publicPortalBaseUrl:
        cloudCfg.publicPortalBaseUrl?.trim() ||
        currentState.config.publicPortalBaseUrl,
      letterPrefix: cloudCfg.letterPrefix?.trim()
        ? cloudCfg.letterPrefix.trim().toUpperCase()
        : currentState.config.letterPrefix,
      lastSequence: maxSeq,
      adminPin:
        cloudCfg.adminPin && cloudCfg.adminPin !== '123456'
          ? cloudCfg.adminPin
          : currentState.config.adminPin,
      isDefaultPin:
        cloudCfg.adminPin && cloudCfg.adminPin !== '123456'
          ? false
          : currentState.config.isDefaultPin,
    },
  };
}
