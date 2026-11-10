import { useCallback, useEffect, useRef, useState } from 'react';
import { User } from 'firebase/auth';
import {
  AdminViewMaster,
  AppStateResponse,
  Assignment,
  DriverExpense,
  DriverMaster,
  FleetCardMaster,
  RouteMaster,
  TaskStatus,
  ToastMessage,
  UserRole,
  VehicleCoolingType,
  VehicleMaster,
  WhatsAppNotificationLog,
  WhatsAppTargetMode,
} from './types';
import {
  buildRealtimeWhatsAppUrlForAssignment,
  launchWhatsAppUrl,
  resolveWhatsAppUrlForMode,
} from './utils/whatsapp';
import {
  REALTIME_CLIENT_ID,
  realtimeSocket,
} from './services/realtimeSocket';
import {
  auth,
  clearAccessToken,
  ensureValidAccessToken,
  getAccessToken,
  getSavedDriverUidFallback,
  googleSignIn,
  hasBoundGoogleWorkspaceAccount,
  initAuth,
  logoutGoogle,
  persistSavedDriverUid,
  refreshFirebaseSessionSilently,
  subscribeGoogleTokenState,
} from './services/googleAuth';
import {
  PENDING_CLOUD_ASSIGNMENT_PURGE_KEY,
  SavedPortalSession,
  clearPermanentSpreadsheetBinding,
  persistPermanentSpreadsheetBinding,
  persistPortalSessionEverywhere,
  pruneCompletedAssignmentsCacheOlderThan7Days,
  purgeAssignmentsClientCacheOnly,
  readDriverAssignmentsCacheAsync,
  readFullWorkspaceFromVault,
  readPermanentSpreadsheetBindingAsync,
  readPermanentSpreadsheetBindingSync,
  readPortalSessionAsync,
  readPortalSessionSync,
  resetAllApplicationClientStorage,
  runCleanStartAssignmentPurgeOnce,
  saveFullWorkspaceToVault,
  touchPortalSessionSlidingRenewal,
} from './services/persistentVault';
import {
  clearPerAssignmentPendingSyncRecord,
  deleteAllAssignmentsFromFirestore,
  deleteAssignmentFromFirestore,
  deleteDriverExpenseFromFirestore,
  deleteDriverFromFirestore,
  deleteFleetCardFromFirestore,
  deleteRouteFromFirestore,
  deleteVehicleFromFirestore,
  DriverDeliveredSubmitPayload,
  enqueuePendingReportSync,
  hydratePendingReportSyncItem,
  PENDING_REPORT_SYNC_ITEM_PREFIX,
  PendingReportSyncItem,
  pullWorkspaceFromFirestore,
  readLocalStoragePendingReportSyncEntries,
  reconcileFullStateToFirestore,
  removePendingReportSyncItem,
  setPendingItemRetryStatus,
  submitDriverReportToFirestore,
  submitReportToFirestoreWithOfflineRecovery,
  subscribeToFirestoreWorkspace,
  upsertAssignmentInFirestore,
  upsertConfigInFirestore,
  upsertDriverExpenseInFirestore,
  upsertDriverInFirestore,
  upsertFleetCardInFirestore,
  upsertRouteInFirestore,
  upsertVehicleInFirestore,
  warmAuthTokenNonBlocking,
} from './services/firestoreSync';
import {
  createNewDatabaseSpreadsheet,
  extractSpreadsheetId,
  pullAllFromSpreadsheet,
  pushAssignmentsToSpreadsheet,
  pushConfigToSpreadsheet,
  pushDriverExpensesToSpreadsheet,
  pushDriverMutationViaBrowserBridge,
  pushDriversToSpreadsheet,
  pushFleetCardsToSpreadsheet,
  pushRoutesToSpreadsheet,
  pushVehiclesToSpreadsheet,
} from './services/sheetsSync';
import {
  summarizeFleetPhotoDriveStats,
  syncAllAssignmentsPhotosToDrive,
  syncDriverExpensesPhotosToDrive,
} from './services/driveSync';
import { LoginPage } from './components/LoginPage';
import { AdminPortal } from './components/AdminPortal';
import {
  DriverExpenseSubmitPayload,
  DriverPortal,
  DriverSubmitSyncMeta,
} from './components/DriverPortal';
import { ToastContainer } from './components/ToastContainer';
import {
  parseDriverUrlParams,
  refreshDriverLinkStatus,
  setCustomDriverPortalBaseUrl,
  setEmbeddedSheetConfigSnapshot,
} from './utils/driverLink';
import {
  isHtmlOrMobileProxyError,
  mergeFirestoreIntoLocalState,
  mergePulledSheetsIntoLocalState,
  purgeLegacyPoisonedApiCaches,
  safeApiFetch,
  waitExponentialBackoff,
} from './utils/safeFetchJson';

const MAX_SHEETS_HTML_PROXY_RETRIES = 3;

const CUSTOM_ADMIN_PIN_STORAGE_KEY = 'crk_custom_admin_pin';
const WORKSPACE_BACKUP_STORAGE_KEY = 'crk_workspace_backup_v1';

const persistPortalSession = persistPortalSessionEverywhere;
const readSavedPortalSession = readPortalSessionSync;

interface WorkspaceBackupPayload {
  config: Partial<AppStateResponse['config']>;
  drivers: DriverMaster[];
  vehicles: VehicleMaster[];
  routes: RouteMaster[];
  fleetCards: FleetCardMaster[];
  driverExpenses: DriverExpense[];
  assignments: Assignment[];
  adminViews?: AdminViewMaster[];
}

function saveWorkspaceBackupLocally(state: AppStateResponse): void {
  if (typeof window === 'undefined') return;
  const hasAuthoritativeEmptyState =
    Boolean(state.config.spreadsheetId) ||
    Boolean(state.config.lastSyncedAt) ||
    (state.config.lastSequence || 0) > 0 ||
    Boolean(window.localStorage.getItem(WORKSPACE_BACKUP_STORAGE_KEY));
  const hasAnyData =
    hasAuthoritativeEmptyState ||
    state.drivers.length > 0 ||
    state.vehicles.length > 0 ||
    state.routes.length > 0 ||
    (state.fleetCards?.length || 0) > 0 ||
    (state.driverExpenses?.length || 0) > 0 ||
    state.assignments.length > 0;
  if (!hasAnyData) return;

  try {
    // Strip heavy base64 images from localStorage backup so it never exceeds browser storage quota
    const lightAssignments: Assignment[] = state.assignments.map((a) => ({
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
    }));

    const lightExpenses: DriverExpense[] = (state.driverExpenses || []).map(
      (e) => ({
        ...e,
        fotoStrukBbm: undefined,
        fotoStrukTol: undefined,
      })
    );

    const payload: WorkspaceBackupPayload = {
      config: state.config,
      drivers: state.drivers,
      vehicles: state.vehicles,
      routes: state.routes,
      fleetCards: state.fleetCards || [],
      driverExpenses: lightExpenses,
      assignments: lightAssignments,
      adminViews: state.adminViews || [],
    };
    window.localStorage.setItem(
      WORKSPACE_BACKUP_STORAGE_KEY,
      JSON.stringify(payload)
    );
  } catch {
    // Ignore storage quota errors
  }
}

function readWorkspaceBackupLocally(): WorkspaceBackupPayload | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(WORKSPACE_BACKUP_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<WorkspaceBackupPayload>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      config: parsed.config || {},
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
      vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
      routes: Array.isArray(parsed.routes) ? parsed.routes : [],
      fleetCards: Array.isArray(parsed.fleetCards) ? parsed.fleetCards : [],
      driverExpenses: Array.isArray(parsed.driverExpenses)
        ? parsed.driverExpenses
        : [],
      assignments: Array.isArray(parsed.assignments) ? parsed.assignments : [],
    };
  } catch {
    return null;
  }
}

function getSavedCustomPin(): string {
  if (typeof window === 'undefined') return '';
  const raw = (window.localStorage.getItem(CUSTOM_ADMIN_PIN_STORAGE_KEY) || '').trim();
  if (raw.length >= 4 && raw !== '123456') {
    return raw;
  }
  return '';
}

function persistCustomPinLocally(pin?: string): void {
  if (typeof window === 'undefined' || !pin) return;
  const trimmed = pin.trim();
  if (trimmed.length >= 4 && trimmed !== '123456') {
    window.localStorage.setItem(CUSTOM_ADMIN_PIN_STORAGE_KEY, trimmed);
  }
}

const CLEAN_START_PURGED_ON_BOOT = runCleanStartAssignmentPurgeOnce();

const PENDING_DRIVER_EXPENSES_QUEUE_KEY = 'crk_pending_driver_expenses_v1';

function readPendingDriverExpensesQueue(): DriverExpense[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(PENDING_DRIVER_EXPENSES_QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DriverExpense[]) : [];
  } catch {
    return [];
  }
}

function writePendingDriverExpensesQueue(items: DriverExpense[]): void {
  if (typeof window === 'undefined') return;
  try {
    if (items.length === 0) {
      window.localStorage.removeItem(PENDING_DRIVER_EXPENSES_QUEUE_KEY);
      return;
    }
    try {
      window.localStorage.setItem(
        PENDING_DRIVER_EXPENSES_QUEUE_KEY,
        JSON.stringify(items)
      );
    } catch {
      // Strip heavy base64 images in localStorage index if quota is tight (full images remain in IndexedDB Vault)
      const light = items.map((item) => ({
        ...item,
        fotoStrukBbm: undefined,
        fotoStrukTol: undefined,
      }));
      window.localStorage.setItem(
        PENDING_DRIVER_EXPENSES_QUEUE_KEY,
        JSON.stringify(light)
      );
    }
  } catch {
    // Ignore storage quota restrictions
  }
}

function enqueuePendingDriverExpense(expense: DriverExpense): void {
  const existing = readPendingDriverExpensesQueue().filter(
    (e) => e.id !== expense.id
  );
  writePendingDriverExpensesQueue([expense, ...existing]);
}

function removePendingDriverExpense(expenseId: string): void {
  const next = readPendingDriverExpensesQueue().filter(
    (e) => e.id !== expenseId
  );
  writePendingDriverExpensesQueue(next);
}

const INITIAL_STATE: AppStateResponse = {
  drivers: [],
  vehicles: [],
  routes: [],
  fleetCards: [],
  driverExpenses: [],
  assignments: [],
  notifications: [],
  adminViews: [],
  config: {
    spreadsheetId: '',
    spreadsheetTitle: '',
    spreadsheetUrl: '',
    lastSyncedAt: null,
    dispatcherWaPhone: '',
    whatsappTargetMode: 'GROUP',
    whatsappGroupName: 'Grup Operasional CRK Logistik',
    whatsappGroupInviteUrl: '',
    letterPrefix: 'ST-CRK',
    lastSequence: 0,
    isDefaultPin: true,
    whatsappGatewayConfigured: false,
  },
};

export default function App() {
  const [appState, setAppState] = useState<AppStateResponse>(() => {
    const boundSheet = readPermanentSpreadsheetBindingSync();
    const localBackup = readWorkspaceBackupLocally();
    const baseConfig: AppStateResponse['config'] = {
      ...INITIAL_STATE.config,
      ...(localBackup?.config || {}),
      spreadsheetId:
        localBackup?.config?.spreadsheetId || boundSheet?.spreadsheetId || '',
      spreadsheetTitle:
        localBackup?.config?.spreadsheetTitle ||
        boundSheet?.spreadsheetTitle ||
        '',
      spreadsheetUrl:
        localBackup?.config?.spreadsheetUrl || boundSheet?.spreadsheetUrl || '',
      appsScriptUrl:
        localBackup?.config?.appsScriptUrl || boundSheet?.appsScriptUrl,
      driveRootFolderId:
        localBackup?.config?.driveRootFolderId || boundSheet?.driveRootFolderId,
      driveRootFolderUrl:
        localBackup?.config?.driveRootFolderUrl ||
        boundSheet?.driveRootFolderUrl,
      lastSyncedAt:
        localBackup?.config?.lastSyncedAt ?? boundSheet?.lastSyncedAt ?? null,
    };
    if (!localBackup && !boundSheet) return INITIAL_STATE;
    if (
      localBackup?.config?.wasIntentionallyCleared ||
      (localBackup?.assignments?.length === 0 && localBackup?.drivers?.length === 0)
    ) {
      return INITIAL_STATE;
    }
    return {
      ...INITIAL_STATE,
      drivers: localBackup?.drivers || [],
      vehicles: localBackup?.vehicles || [],
      routes: localBackup?.routes || [],
      fleetCards: localBackup?.fleetCards || [],
      driverExpenses: localBackup?.driverExpenses || [],
      assignments: localBackup?.assignments || [],
      adminViews: localBackup?.adminViews || [],
      config: baseConfig,
    };
  });
  const [loadingInitial, setLoadingInitial] = useState<boolean>(() => {
    const savedSess = readSavedPortalSession();
    if (savedSess) return false;
    const localBackup = readWorkspaceBackupLocally();
    return !(localBackup && (localBackup.drivers?.length || 0) > 0);
  });
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [isDriveSyncing, setIsDriveSyncing] = useState<boolean>(false);

  const [driverUrlParams] = useState(() => parseDriverUrlParams());
  const [initialSavedSession] = useState<SavedPortalSession | null>(() => {
    const saved = readSavedPortalSession();
    const urlParams = parseDriverUrlParams();
    if (!saved) return null;
    if (urlParams.isDriverMode) {
      if (
        saved.role === UserRole.DRIVER &&
        saved.driverId &&
        (!urlParams.driverId ||
          saved.driverId.toLowerCase() === urlParams.driverId.toLowerCase())
      ) {
        return saved;
      }
      return null;
    }
    return saved;
  });

  const sessionRestoredRef = useRef<boolean>(false);

  const [sessionRole, setSessionRole] = useState<UserRole | null>(() => {
    if (!initialSavedSession) return null;
    if (initialSavedSession.role === UserRole.ADMIN) return UserRole.ADMIN;
    if (initialSavedSession.role === UserRole.ADMIN_VIEW) return UserRole.ADMIN_VIEW;
    if (
      initialSavedSession.role === UserRole.DRIVER &&
      initialSavedSession.driverSnapshot
    ) {
      return UserRole.DRIVER;
    }
    return null;
  });
  const [loggedInDriver, setLoggedInDriver] = useState<DriverMaster | null>(
    () =>
      initialSavedSession?.role === UserRole.DRIVER
        ? initialSavedSession.driverSnapshot || null
        : null
  );
  const [loggedInAdminView, setLoggedInAdminView] = useState<AdminViewMaster | null>(
    () =>
      initialSavedSession?.role === UserRole.ADMIN_VIEW
        ? initialSavedSession.adminViewSnapshot || null
        : null
  );

  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState<boolean>(false);
  const [hasGoogleToken, setHasGoogleToken] = useState<boolean>(false);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const syncInFlightRef = useRef<boolean>(false);
  const driveSyncInFlightRef = useRef<boolean>(false);
  const cloudMutationLockRef = useRef<boolean>(false);
  const cloudTaskQueueRef = useRef<Promise<void>>(Promise.resolve());
  const cloudPendingCountRef = useRef<number>(0);

  const sessionRoleRef = useRef<UserRole | null>(sessionRole);
  const loggedInDriverRef = useRef<DriverMaster | null>(loggedInDriver);
  const googleUserRef = useRef<User | null>(googleUser);
  const appStateRef = useRef<AppStateResponse>(appState);

  const prevStatusMapRef = useRef<Map<string, string>>(new Map());
  const statusMapInitializedRef = useRef<boolean>(false);
  const notifiedTransitionKeysRef = useRef<Set<string>>(new Set());
  const notifiedDriverWaIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    sessionRoleRef.current = sessionRole;
  }, [sessionRole]);

  useEffect(() => {
    loggedInDriverRef.current = loggedInDriver;
  }, [loggedInDriver]);

  useEffect(() => {
    googleUserRef.current = googleUser;
  }, [googleUser]);

  useEffect(() => {
    appStateRef.current = appState;
  }, [appState]);

  const getActiveConfigSnapshot = useCallback((): {
    spreadsheetId?: string;
    appsScriptUrl?: string;
  } => {
    const permanent = readPermanentSpreadsheetBindingSync();
    const spreadsheetId =
      appStateRef.current.config?.spreadsheetId ||
      driverUrlParams.embeddedConfig?.spreadsheetId ||
      permanent?.spreadsheetId ||
      undefined;
    const appsScriptUrl =
      appStateRef.current.config?.appsScriptUrl ||
      driverUrlParams.embeddedConfig?.appsScriptUrl ||
      permanent?.appsScriptUrl ||
      undefined;
    return { spreadsheetId, appsScriptUrl };
  }, [driverUrlParams.embeddedConfig]);

  const addToast = useCallback(
    (
      type: ToastMessage['type'],
      title: string,
      description?: string,
      options?: {
        actionLabel?: string;
        actionHref?: string;
        durationMs?: number;
      }
    ) => {
      const id = `toast-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      setToasts((prev) => [
        ...prev,
        {
          id,
          type,
          title,
          description,
          actionLabel: options?.actionLabel,
          actionHref: options?.actionHref,
        },
      ]);
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, options?.durationMs ?? 5500);
    },
    []
  );

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const applyIncomingState = useCallback(
    (
      nextState: AppStateResponse,
      options?: {
        explicitAssignment?: Assignment;
        explicitPreviousStatus?: string;
      }
    ) => {
      const prevMap = prevStatusMapRef.current;
      const isAdminActive =
        sessionRoleRef.current === UserRole.ADMIN ||
        sessionRoleRef.current === UserRole.ADMIN_VIEW;
      const activeDriver =
        sessionRoleRef.current === UserRole.DRIVER
          ? loggedInDriverRef.current
          : null;

      if (!statusMapInitializedRef.current) {
        for (const a of nextState.assignments) {
          prevMap.set(a.id, a.status);
        }
        statusMapInitializedRef.current = true;
      } else {
        for (const a of nextState.assignments) {
          const priorStatus =
            options?.explicitAssignment?.id === a.id &&
            options?.explicitPreviousStatus !== undefined
              ? options.explicitPreviousStatus
              : prevMap.get(a.id);

          if (
            isAdminActive &&
            priorStatus !== a.status &&
            (a.status === TaskStatus.DALAM_PERJALANAN ||
              a.status === TaskStatus.DELIVERED ||
              a.status === TaskStatus.HANDOVER)
          ) {
            const dedupeKey = `admin:${a.id}:${a.status}:${
              a.handoverData?.timestamp ||
              a.deliveredAt ||
              a.departureData?.timestamp ||
              ''
            }`;
            if (!notifiedTransitionKeysRef.current.has(dedupeKey)) {
              notifiedTransitionKeysRef.current.add(dedupeKey);
              if (a.status === TaskStatus.DALAM_PERJALANAN) {
                addToast(
                  'info',
                  `Notifikasi Real-Time: Armada Berangkat (${a.noPenugasan})`,
                  `Armada ${a.plateNumber} — Driver ${a.driverName} berangkat menuju ${a.destination}.`,
                  { durationMs: 6500 }
                );
              } else if (a.status === TaskStatus.DELIVERED) {
                addToast(
                  'info',
                  `Notifikasi Real-Time: Delivered (${a.noPenugasan})`,
                  `Armada ${a.plateNumber} — Driver ${a.driverName} telah tiba di tujuan (${a.destination}).`,
                  { durationMs: 7000 }
                );
              } else if (a.status === TaskStatus.HANDOVER) {
                addToast(
                  'success',
                  `Notifikasi Real-Time: Handover (${a.noPenugasan})`,
                  `Serah terima muatan ${a.plateNumber} oleh ${a.driverName}${
                    a.handoverData?.penerimaNama
                      ? ` kepada ${a.handoverData.penerimaNama}`
                      : ''
                  } telah selesai.`,
                  { durationMs: 7000 }
                );
              }
            }
          }

          if (
            activeDriver &&
            priorStatus === undefined &&
            a.driverId.trim().toLowerCase() ===
              activeDriver.id.trim().toLowerCase() &&
            a.status === TaskStatus.MENUNGGU_BERANGKAT
          ) {
            const drvDedupeKey = `driver:new:${a.id}:${a.noPenugasan}`;
            if (!notifiedTransitionKeysRef.current.has(drvDedupeKey)) {
              notifiedTransitionKeysRef.current.add(drvDedupeKey);
              addToast(
                'info',
                `Surat Tugas Baru: ${a.noPenugasan}`,
                `Armada ${a.plateNumber} menuju ${a.destination}. Buka tugas untuk mengisi Keberangkatan.`,
                { durationMs: 7500 }
              );
            }
          }

          prevMap.set(a.id, a.status);
        }
      }

      // Preserve any cached local base64 receipt photos AND any pending offline Driver Expenses not yet flushed to a waking server
      const prevExpensesById = new Map<string, DriverExpense>(
        (appStateRef.current.driverExpenses || []).map((e) => [e.id, e])
      );
      const incomingExpIds = new Set<string>();
      const normalizedExpenses: DriverExpense[] = Array.isArray(
        nextState.driverExpenses
      )
        ? nextState.driverExpenses.map((exp) => {
            incomingExpIds.add(exp.id);
            const prevExp = prevExpensesById.get(exp.id);
            if (!prevExp) return exp;
            return {
              ...exp,
              fotoStrukBbm: exp.fotoStrukBbm || prevExp.fotoStrukBbm,
              fotoStrukBbmUrl: exp.fotoStrukBbmUrl || prevExp.fotoStrukBbmUrl,
              fotoStrukTol: exp.fotoStrukTol || prevExp.fotoStrukTol,
              fotoStrukTolUrl: exp.fotoStrukTolUrl || prevExp.fotoStrukTolUrl,
            };
          })
        : [];

      const pendingQueuedExpenses = readPendingDriverExpensesQueue();
      for (const queuedExp of pendingQueuedExpenses) {
        if (!incomingExpIds.has(queuedExp.id)) {
          const prevFull = prevExpensesById.get(queuedExp.id);
          normalizedExpenses.unshift({
            ...queuedExp,
            fotoStrukBbm: prevFull?.fotoStrukBbm || queuedExp.fotoStrukBbm,
            fotoStrukTol: prevFull?.fotoStrukTol || queuedExp.fotoStrukTol,
            needsSheetSync: true,
          });
          incomingExpIds.add(queuedExp.id);
        }
      }

      const statusRank = (st?: string): number => {
        if (st === TaskStatus.HANDOVER || st === TaskStatus.SELESAI) return 3;
        if (st === TaskStatus.DELIVERED) return 2;
        if (st === TaskStatus.DALAM_PERJALANAN) return 1;
        return 0;
      };
      const pendingReportEntries = readLocalStoragePendingReportSyncEntries();
      const pendingAsgById = new Map<string, Assignment>();
      for (const entry of pendingReportEntries) {
        if (!entry.item.serverSynced && entry.item.assignmentSnapshot?.id) {
          const prevSnap = pendingAsgById.get(entry.item.assignmentSnapshot.id);
          if (
            !prevSnap ||
            statusRank(entry.item.assignmentSnapshot.status) >=
              statusRank(prevSnap.status)
          ) {
            pendingAsgById.set(
              entry.item.assignmentSnapshot.id,
              entry.item.assignmentSnapshot
            );
          }
        }
      }
      const prevAsgById = new Map<string, Assignment>(
        (appStateRef.current.assignments || []).map((a) => [a.id, a])
      );
      const normalizedAssignments: Assignment[] = Array.isArray(
        nextState.assignments
      )
        ? nextState.assignments.map((incAsg) => {
            const pendingSnap = pendingAsgById.get(incAsg.id);
            if (
              pendingSnap &&
              statusRank(pendingSnap.status) > statusRank(incAsg.status)
            ) {
              const prevLocal = prevAsgById.get(incAsg.id);
              return {
                ...incAsg,
                ...pendingSnap,
                departureData: pendingSnap.departureData
                  ? {
                      ...prevLocal?.departureData,
                      ...pendingSnap.departureData,
                    }
                  : incAsg.departureData,
                deliveredData: pendingSnap.deliveredData
                  ? {
                      ...prevLocal?.deliveredData,
                      ...pendingSnap.deliveredData,
                    }
                  : incAsg.deliveredData,
                handoverData: pendingSnap.handoverData
                  ? {
                      ...prevLocal?.handoverData,
                      ...pendingSnap.handoverData,
                    }
                  : incAsg.handoverData,
                needsSheetSync: true,
              };
            }
            return incAsg;
          })
        : [];

      let hydratedNextState: AppStateResponse = {
        ...nextState,
        assignments: normalizedAssignments,
        fleetCards: Array.isArray(nextState.fleetCards)
          ? nextState.fleetCards
          : [],
        driverExpenses: normalizedExpenses,
        adminViews: Array.isArray(nextState.adminViews)
          ? nextState.adminViews
          : appStateRef.current.adminViews || [],
      };
      const incomingSheetId = String(
        nextState.config?.spreadsheetId || ''
      ).trim();
      const permanentBound = readPermanentSpreadsheetBindingSync();
      if (incomingSheetId) {
        const effectiveAppsScriptUrl =
          nextState.config.appsScriptUrl ||
          (permanentBound?.spreadsheetId === incomingSheetId
            ? permanentBound.appsScriptUrl
            : undefined);
        if (effectiveAppsScriptUrl && !nextState.config.appsScriptUrl) {
          hydratedNextState = {
            ...nextState,
            config: {
              ...nextState.config,
              appsScriptUrl: effectiveAppsScriptUrl,
            },
          };
        }
        persistPermanentSpreadsheetBinding({
          spreadsheetId: incomingSheetId,
          spreadsheetTitle: hydratedNextState.config.spreadsheetTitle || '',
          spreadsheetUrl:
            hydratedNextState.config.spreadsheetUrl ||
            `https://docs.google.com/spreadsheets/d/${incomingSheetId}/edit`,
          appsScriptUrl: hydratedNextState.config.appsScriptUrl,
          driveRootFolderId: hydratedNextState.config.driveRootFolderId,
          driveRootFolderUrl: hydratedNextState.config.driveRootFolderUrl,
          connectedEmail: googleUserRef.current?.email || undefined,
          lastSyncedAt: hydratedNextState.config.lastSyncedAt,
        });
      } else if (permanentBound?.spreadsheetId) {
        hydratedNextState = {
          ...nextState,
          config: {
            ...nextState.config,
            spreadsheetId: permanentBound.spreadsheetId,
            spreadsheetTitle:
              nextState.config.spreadsheetTitle ||
              permanentBound.spreadsheetTitle,
            spreadsheetUrl:
              nextState.config.spreadsheetUrl ||
              permanentBound.spreadsheetUrl,
            appsScriptUrl:
              nextState.config.appsScriptUrl || permanentBound.appsScriptUrl,
            driveRootFolderId:
              nextState.config.driveRootFolderId ||
              permanentBound.driveRootFolderId,
            driveRootFolderUrl:
              nextState.config.driveRootFolderUrl ||
              permanentBound.driveRootFolderUrl,
            lastSyncedAt:
              nextState.config.lastSyncedAt ||
              permanentBound.lastSyncedAt ||
              null,
          },
        };
      }

      setCustomDriverPortalBaseUrl(hydratedNextState.config?.publicPortalBaseUrl);
      setEmbeddedSheetConfigSnapshot(
        hydratedNextState.config?.spreadsheetId,
        hydratedNextState.config?.appsScriptUrl
      );
      appStateRef.current = hydratedNextState;
      setAppState(hydratedNextState);
      saveWorkspaceBackupLocally(hydratedNextState);
      const allowVaultEmptyOverwrite = Boolean(
        hydratedNextState.config?.spreadsheetId ||
          hydratedNextState.config?.lastSyncedAt ||
          (hydratedNextState.config?.lastSequence || 0) > 0
      );
      void saveFullWorkspaceToVault(hydratedNextState, allowVaultEmptyOverwrite);
    },
    [addToast]
  );

  const handleSheetsAuthError = useCallback(
    (err: unknown) => {
      const status = (err as { status?: number })?.status;
      const isHtmlProxyErr = isHtmlOrMobileProxyError(err);
      const rawMsg =
        err instanceof Error ? err.message : 'Kesalahan Google Sheets API';

      if (isHtmlProxyErr) {
        // Never invalidate login session or OAuth token on mobile carrier/captive HTML responses
        addToast(
          'info',
          'Jaringan Mobile Mengembalikan Respons HTML',
          'Proxy jaringan seluler masih mengembalikan halaman HTML setelah percobaan ulang otomatis. Sesi login Admin dan data Cloud tetap aktif serta aman.'
        );
        return;
      }

      if (status === 401) {
        clearAccessToken();
        setHasGoogleToken(false);
        addToast(
          'info',
          'Sesi Spreadsheet Tetap Terikat Permanen',
          'Seluruh data Anda tersimpan permanen di Aplikasi & Cloud. Klik "Sinkron Spreadsheets" untuk melanjutkan tulis otomatis ke Google Sheets.'
        );
      } else {
        addToast('error', 'Sinkronisasi Spreadsheet Gagal', rawMsg);
      }
    },
    [addToast]
  );

  const runCloudTask = useCallback(
    (task: () => Promise<void>): Promise<void> => {
      cloudPendingCountRef.current += 1;
      cloudMutationLockRef.current = true;

      const queued = cloudTaskQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          try {
            await task();
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (msg.includes('Quota exceeded')) {
              addToast(
                'error',
                'Kuota Cloud Harian Tercapai',
                'Kuota penyimpanan cloud gratis hari ini penuh dan akan disetel ulang besok.'
              );
            }
          } finally {
            cloudPendingCountRef.current = Math.max(
              0,
              cloudPendingCountRef.current - 1
            );
            if (cloudPendingCountRef.current === 0) {
              cloudMutationLockRef.current = false;
            }
          }
        });

      cloudTaskQueueRef.current = queued;
      return queued;
    },
    [addToast]
  );

  const fetchServerState =
    useCallback(async (): Promise<AppStateResponse | null> => {
      try {
        const res = await safeApiFetch<AppStateResponse>('/api/state');
        if (!res.ok || !res.data) {
          // Fallback to IndexedDB vault or localStorage backup if /api/state returned HTML (e.g. expired mobile preview proxy cookie) or offline
          const idbVault = await readFullWorkspaceFromVault();
          const backup = idbVault || readWorkspaceBackupLocally();
          if (backup) {
            const fallbackState: AppStateResponse = {
              ...appStateRef.current,
              drivers:
                backup.drivers && backup.drivers.length > 0
                  ? backup.drivers
                  : appStateRef.current.drivers,
              vehicles:
                backup.vehicles && backup.vehicles.length > 0
                  ? backup.vehicles
                  : appStateRef.current.vehicles,
              routes:
                backup.routes && backup.routes.length > 0
                  ? backup.routes
                  : appStateRef.current.routes,
              fleetCards:
                backup.fleetCards && backup.fleetCards.length > 0
                  ? backup.fleetCards
                  : appStateRef.current.fleetCards,
              driverExpenses:
                backup.driverExpenses && backup.driverExpenses.length > 0
                  ? backup.driverExpenses
                  : appStateRef.current.driverExpenses,
              assignments:
                backup.assignments && backup.assignments.length > 0
                  ? backup.assignments
                  : appStateRef.current.assignments,
              config: {
                ...appStateRef.current.config,
                ...(backup.config || {}),
              },
            };
            applyIncomingState(fallbackState);
            return fallbackState;
          }
          return null;
        }
        let data = res.data;

        if (
          data.config?.wasIntentionallyCleared ||
          (data.assignments.length === 0 && data.drivers.length === 0)
        ) {
          void resetAllApplicationClientStorage();
        }

        // Permanent Admin PIN restoration if container restarted with default PIN
        const savedCustomPin = getSavedCustomPin();
        if (data.config?.isDefaultPin && savedCustomPin) {
          const restoreRes = await safeApiFetch<{ state?: AppStateResponse }>(
            '/api/admin/pin/restore',
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ savedPin: savedCustomPin }),
            }
          );
          if (restoreRes.ok && restoreRes.data?.state) {
            data = restoreRes.data.state;
          }
        }

        // 1. Self-heal server permanent Spreadsheet binding FIRST if container cold-started without spreadsheetId or appsScriptUrl
        const savedSheetBinding = await readPermanentSpreadsheetBindingAsync();
        const candidateSheetId =
          savedSheetBinding?.spreadsheetId ||
          driverUrlParams.embeddedConfig?.spreadsheetId ||
          '';
        const candidateBridgeUrl =
          savedSheetBinding?.appsScriptUrl ||
          driverUrlParams.embeddedConfig?.appsScriptUrl ||
          '';
        const serverMissingSheetId = !String(
          data.config?.spreadsheetId || ''
        ).trim();
        const serverMissingBridgeUrl =
          Boolean(candidateBridgeUrl) &&
          !String(data.config?.appsScriptUrl || '').trim();

        if (
          candidateSheetId &&
          (serverMissingSheetId || serverMissingBridgeUrl)
        ) {
          const healSheetRes = await safeApiFetch<{
            state?: AppStateResponse;
          }>('/api/config', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              spreadsheetId:
                data.config?.spreadsheetId || candidateSheetId,
              spreadsheetTitle:
                data.config?.spreadsheetTitle ||
                savedSheetBinding?.spreadsheetTitle,
              spreadsheetUrl:
                data.config?.spreadsheetUrl || savedSheetBinding?.spreadsheetUrl,
              appsScriptUrl:
                data.config?.appsScriptUrl || candidateBridgeUrl,
              driveRootFolderId:
                data.config?.driveRootFolderId ||
                savedSheetBinding?.driveRootFolderId,
              driveRootFolderUrl:
                data.config?.driveRootFolderUrl ||
                savedSheetBinding?.driveRootFolderUrl,
              lastSyncedAt:
                data.config?.lastSyncedAt ||
                savedSheetBinding?.lastSyncedAt ||
                undefined,
              resetLocalCache: false,
            }),
          });
          if (healSheetRes.ok && healSheetRes.data?.state) {
            data = healSheetRes.data.state;
          } else {
            data = {
              ...data,
              config: {
                ...data.config,
                spreadsheetId:
                  data.config?.spreadsheetId || candidateSheetId,
                spreadsheetTitle:
                  data.config?.spreadsheetTitle ||
                  savedSheetBinding?.spreadsheetTitle ||
                  '',
                spreadsheetUrl:
                  data.config?.spreadsheetUrl ||
                  savedSheetBinding?.spreadsheetUrl ||
                  '',
                appsScriptUrl:
                  data.config?.appsScriptUrl || candidateBridgeUrl,
                driveRootFolderId:
                  data.config?.driveRootFolderId ||
                  savedSheetBinding?.driveRootFolderId,
                driveRootFolderUrl:
                  data.config?.driveRootFolderUrl ||
                  savedSheetBinding?.driveRootFolderUrl,
                lastSyncedAt:
                  data.config.lastSyncedAt ||
                  savedSheetBinding?.lastSyncedAt ||
                  null,
              },
            };
          }
        }

        // 2. Zero-click Server Auto-Sync with Google Spreadsheet on F5 refresh when client OAuth token isn't active yet
        // Ensures rows deleted directly in Google Spreadsheet are immediately pruned before UI renders
        if (String(data.config?.spreadsheetId || '').trim() && !getAccessToken()) {
          const autoSyncRes = await safeApiFetch<{
            success?: boolean;
            hasSheetDeletionsToPrune?: boolean;
            state?: AppStateResponse;
          }>('/api/sheets/auto-sync', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Client-Id': REALTIME_CLIENT_ID,
            },
            body: JSON.stringify({
              configSnapshot: getActiveConfigSnapshot(),
            }),
          });
          if (autoSyncRes.ok && autoSyncRes.data?.state) {
            data = autoSyncRes.data.state;
            if (
              autoSyncRes.data.hasSheetDeletionsToPrune &&
              googleUserRef.current?.emailVerified
            ) {
              const customPin = getSavedCustomPin() || undefined;
              const syncedSnapshot = data;
              void runCloudTask(() =>
                reconcileFullStateToFirestore(
                  googleUserRef.current!,
                  syncedSnapshot,
                  true,
                  customPin
                )
              );
            }
          }
        }

        // 3. Cold-boot emergency data restoration ONLY when server is a genuinely uninitialized blank container
        // NEVER restore from vault if lastSyncedAt or lastSequence > 0 exists (prevents resurrecting rows deleted in Spreadsheet!)
        const isTrueBrandNewColdBoot =
          !data.config?.wasIntentionallyCleared &&
          data.drivers.length === 0 &&
          data.vehicles.length === 0 &&
          data.routes.length === 0 &&
          (data.fleetCards?.length || 0) === 0 &&
          (data.driverExpenses?.length || 0) === 0 &&
          data.assignments.length === 0 &&
          !data.config?.lastSyncedAt &&
          (data.config?.lastSequence || 0) === 0;

        if (isTrueBrandNewColdBoot) {
          const idbVault = await readFullWorkspaceFromVault();
          const backup = idbVault || readWorkspaceBackupLocally();
          if (
            backup &&
            ((backup.drivers?.length || 0) > 0 ||
              (backup.vehicles?.length || 0) > 0 ||
              (backup.routes?.length || 0) > 0 ||
              (backup.fleetCards?.length || 0) > 0 ||
              (backup.driverExpenses?.length || 0) > 0 ||
              (backup.assignments?.length || 0) > 0)
          ) {
            const hydrateRes = await safeApiFetch<{ state?: AppStateResponse }>(
              '/api/sync/from-firestore',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Client-Id': REALTIME_CLIENT_ID,
                },
                body: JSON.stringify({
                  config: backup.config,
                  drivers: backup.drivers,
                  vehicles: backup.vehicles,
                  routes: backup.routes,
                  fleetCards: backup.fleetCards || [],
                  driverExpenses: backup.driverExpenses || [],
                  assignments: backup.assignments,
                  replaceCollections: false,
                }),
              }
            );
            if (hydrateRes.ok && hydrateRes.data?.state) {
              data = hydrateRes.data.state;
            } else {
              data = mergeFirestoreIntoLocalState(data, backup);
            }
          }
        }

        // 4. Ensure unsynced Surat Tugas & Driver progress in client Vault/cache self-heal onto server
        // (Server strictly rejects tombstoned deletions & items previously synced and deleted in Google Sheets)
        const activeDriverId =
          loggedInDriverRef.current?.id ||
          driverUrlParams.driverId ||
          readSavedPortalSession()?.driverId ||
          '';
        const [vaultForRecovery, cachedDriverTasks] = await Promise.all([
          !isTrueBrandNewColdBoot ? readFullWorkspaceFromVault() : Promise.resolve(null),
          activeDriverId
            ? readDriverAssignmentsCacheAsync(activeDriverId)
            : Promise.resolve([]),
        ]);
        const localBackupForRecovery = !isTrueBrandNewColdBoot
          ? vaultForRecovery || readWorkspaceBackupLocally()
          : null;
        const embeddedTaskObj: Assignment | null = driverUrlParams.embeddedTask
          ? {
              ...driverUrlParams.embeddedTask,
              notes: driverUrlParams.embeddedTask.notes ?? '',
              routeId: '',
              createdAt: new Date().toISOString(),
            }
          : null;

        const serverById = new Map(data.assignments.map((a) => [a.id, a]));
        const serverByNo = new Map(
          data.assignments.map((a) => [a.noPenugasan.trim().toLowerCase(), a])
        );
        const queuedRecoveryKeys = new Set<string>();
        const missingDriverSnapshots: Assignment[] = [];

        const maybeQueueSnapshot = (cand?: Assignment | null) => {
          if (!cand || !cand.id || !cand.noPenugasan) return;
          const normNo = cand.noPenugasan.trim().toLowerCase();
          if (queuedRecoveryKeys.has(cand.id) || queuedRecoveryKeys.has(normNo)) {
            return;
          }
          const serverMatch =
            serverById.get(cand.id) || serverByNo.get(normNo);
          if (!serverMatch) {
            missingDriverSnapshots.push(cand);
            queuedRecoveryKeys.add(cand.id);
            queuedRecoveryKeys.add(normNo);
            return;
          }
          const rank = (s?: string) =>
            s === 'Handover' || s === 'Selesai'
              ? 3
              : s === 'Delivered'
              ? 2
              : s === 'Dalam Perjalanan'
              ? 1
              : 0;
          if (
            rank(cand.status) > rank(serverMatch.status) ||
            (Boolean(cand.departureData?.timestamp) &&
              !serverMatch.departureData?.timestamp) ||
            (Boolean(cand.deliveredData?.timestamp) &&
              !serverMatch.deliveredData?.timestamp) ||
            (Boolean(cand.handoverData?.timestamp) &&
              !serverMatch.handoverData?.timestamp)
          ) {
            missingDriverSnapshots.push(cand);
            queuedRecoveryKeys.add(cand.id);
            queuedRecoveryKeys.add(normNo);
          }
        };

        maybeQueueSnapshot(embeddedTaskObj);
        for (const inMemTask of appStateRef.current.assignments) {
          maybeQueueSnapshot(inMemTask);
        }
        for (const cachedTask of cachedDriverTasks) {
          maybeQueueSnapshot(cachedTask);
        }
        for (const vaultTask of localBackupForRecovery?.assignments || []) {
          maybeQueueSnapshot(vaultTask);
        }

        const candidateDriverSnap =
          isTrueBrandNewColdBoot || driverUrlParams.embeddedDriver
            ? loggedInDriverRef.current ||
              readSavedPortalSession()?.driverSnapshot ||
              (driverUrlParams.embeddedDriver
                ? {
                    ...driverUrlParams.embeddedDriver,
                    pin: '',
                    active: true,
                  }
                : undefined)
            : undefined;

        const driverMissingOnServer = Boolean(
          candidateDriverSnap &&
            !data.drivers.some(
              (d) => d.id.toLowerCase() === candidateDriverSnap.id.toLowerCase()
            )
        );

        if (missingDriverSnapshots.length > 0 || driverMissingOnServer) {
          const ensureRes = await safeApiFetch<{ state?: AppStateResponse }>(
            '/api/driver/ensure-context',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Client-Id': REALTIME_CLIENT_ID,
              },
              body: JSON.stringify({
                driverSnapshot: candidateDriverSnap,
                assignmentSnapshots: missingDriverSnapshots,
                recoverUnsynced: true,
                fromUrlLink: Boolean(
                  driverUrlParams.embeddedDriver || driverUrlParams.embeddedTask
                ),
                configSnapshot: getActiveConfigSnapshot(),
              }),
            }
          );
          if (ensureRes.ok && ensureRes.data?.state) {
            data = ensureRes.data.state;
          }
        }

        applyIncomingState(data);
        return data;
      } catch {
        return null;
      } finally {
        setLoadingInitial(false);
      }
    }, [applyIncomingState, driverUrlParams, getActiveConfigSnapshot, runCloudTask]);

  const handleSyncPhotosToDrive = useCallback(
    async (options?: {
      silent?: boolean;
      overwriteExisting?: boolean;
      explicitAssignments?: Assignment[];
      explicitRootFolderId?: string;
      explicitSpreadsheetId?: string;
    }): Promise<boolean> => {
      const silent = Boolean(options?.silent);
      const token = await ensureValidAccessToken();
      if (!token) {
        if (hasGoogleToken) {
          setHasGoogleToken(false);
        }
        if (!silent) {
          addToast(
            'info',
            'Hubungkan Sesi Google Terlebih Dahulu',
            'Klik "Sign in with Google" atau "Perbarui Sinkron Sheets" pada menu Spreadsheets agar foto diunggah ke Google Drive Anda.'
          );
        }
        return false;
      }

      if (driveSyncInFlightRef.current) return false;

      const sourceAssignments =
        options?.explicitAssignments ?? appStateRef.current.assignments;
      const sourceExpenses = appStateRef.current.driverExpenses || [];
      const statsBefore = summarizeFleetPhotoDriveStats(sourceAssignments);
      const pendingExpensePhotos = sourceExpenses.reduce((acc, exp) => {
        const bbmPending =
          exp.fotoStrukBbm &&
          exp.fotoStrukBbm.startsWith('data:image/') &&
          (options?.overwriteExisting || !exp.fotoStrukBbmUrl)
            ? 1
            : 0;
        const tolPending =
          exp.fotoStrukTol &&
          exp.fotoStrukTol.startsWith('data:image/') &&
          (options?.overwriteExisting || !exp.fotoStrukTolUrl)
            ? 1
            : 0;
        return acc + bbmPending + tolPending;
      }, 0);

      if (
        statsBefore.pendingPhotos === 0 &&
        pendingExpensePhotos === 0 &&
        !options?.overwriteExisting
      ) {
        if (!silent) {
          addToast(
            'info',
            'Foto Sudah Tersinkron di Google Drive',
            statsBefore.totalPhotos > 0
              ? `Seluruh foto pengiriman & struk pengeluaran sudah tersimpan rapi di Google Drive dan Spreadsheet.`
              : 'Belum ada foto keberangkatan, serah terima, atau struk pengeluaran baru untuk diunggah.'
          );
        }
        return true;
      }

      driveSyncInFlightRef.current = true;
      setIsDriveSyncing(true);

      try {
        const cachedRootId =
          options?.explicitRootFolderId ??
          appStateRef.current.config.driveRootFolderId;
        const driveOut = await syncAllAssignmentsPhotosToDrive(
          token,
          sourceAssignments,
          {
            cachedRootFolderId: cachedRootId || undefined,
            overwriteExisting: options?.overwriteExisting,
          }
        );

        const expenseDriveOut = await syncDriverExpensesPhotosToDrive(
          token,
          sourceExpenses,
          {
            cachedRootFolderId: driveOut.rootFolder.id || cachedRootId || undefined,
            overwriteExisting: options?.overwriteExisting,
          }
        );

        const updatesList = driveOut.results.map((u) => ({
          assignmentId: u.assignmentId,
          driveFolderUrl: u.folderUrl,
          driveMedia: {
            folderId: u.folderId,
            folderUrl: u.folderUrl,
            syncedAt: u.syncedAt,
            ...u.mediaUrls,
          },
        }));

        const saveRes = await safeApiFetch<{ state?: AppStateResponse }>(
          '/api/assignments/drive-media',
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Client-Id': REALTIME_CLIENT_ID,
            },
            body: JSON.stringify({
              driveRootFolderId: driveOut.rootFolder.id,
              driveRootFolderUrl: driveOut.rootFolder.webViewLink,
              updates: updatesList,
            }),
          }
        );

        let latestState = appStateRef.current;
        if (saveRes.ok && saveRes.data?.state) {
          latestState = saveRes.data.state;
          applyIncomingState(latestState);
        } else {
          // Local merge fallback when /api/* returns HTML on mobile
          const updatesMap = new Map(
            updatesList.map((item) => [item.assignmentId, item])
          );
          latestState = {
            ...appStateRef.current,
            config: {
              ...appStateRef.current.config,
              driveRootFolderId: driveOut.rootFolder.id,
              driveRootFolderUrl: driveOut.rootFolder.webViewLink,
            },
            assignments: appStateRef.current.assignments.map((asg) => {
              const upd = updatesMap.get(asg.id);
              if (!upd) return asg;
              return {
                ...asg,
                driveFolderUrl: upd.driveFolderUrl || asg.driveFolderUrl,
                driveMedia: {
                  ...(asg.driveMedia || {}),
                  ...upd.driveMedia,
                },
              };
            }),
          };
          applyIncomingState(latestState);
        }

        if (expenseDriveOut.results.length > 0) {
          const expSaveRes = await safeApiFetch<{ state?: AppStateResponse }>(
            '/api/driver-expenses/drive-media',
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Client-Id': REALTIME_CLIENT_ID,
              },
              body: JSON.stringify({
                updates: expenseDriveOut.results,
              }),
            }
          );
          if (expSaveRes.ok && expSaveRes.data?.state) {
            latestState = expSaveRes.data.state;
            applyIncomingState(latestState);
          } else {
            const expMap = new Map(
              expenseDriveOut.results.map((r) => [r.expenseId, r])
            );
            latestState = {
              ...latestState,
              driverExpenses: latestState.driverExpenses.map((exp) => {
                const upd = expMap.get(exp.id);
                if (!upd) return exp;
                return {
                  ...exp,
                  fotoStrukBbmUrl: upd.fotoStrukBbmUrl || exp.fotoStrukBbmUrl,
                  fotoStrukTolUrl: upd.fotoStrukTolUrl || exp.fotoStrukTolUrl,
                };
              }),
            };
            applyIncomingState(latestState);
          }
        }

        const activeUser = googleUserRef.current;
        if (activeUser?.emailVerified) {
          const updatedIds = new Set(
            driveOut.results.map((u) => u.assignmentId)
          );
          const updatedExpIds = new Set(
            expenseDriveOut.results.map((u) => u.expenseId)
          );
          const customPin = getSavedCustomPin() || undefined;
          void runCloudTask(async () => {
            await upsertConfigInFirestore(
              activeUser,
              latestState.config,
              customPin
            );
            for (const asg of latestState.assignments) {
              if (updatedIds.has(asg.id)) {
                await upsertAssignmentInFirestore(activeUser, asg);
              }
            }
            for (const exp of latestState.driverExpenses) {
              if (updatedExpIds.has(exp.id)) {
                await upsertDriverExpenseInFirestore(activeUser, exp);
              }
            }
          });
        }

        const sheetId = extractSpreadsheetId(
          options?.explicitSpreadsheetId ?? latestState.config.spreadsheetId
        );
        if (
          sheetId &&
          (driveOut.results.length > 0 || expenseDriveOut.results.length > 0)
        ) {
          try {
            if (driveOut.results.length > 0) {
              await pushAssignmentsToSpreadsheet(
                token,
                sheetId,
                latestState.assignments,
                false
              );
            }
            if (expenseDriveOut.results.length > 0) {
              await pushDriverExpensesToSpreadsheet(
                token,
                sheetId,
                latestState.driverExpenses,
                false
              );
            }
            const markRes = await safeApiFetch<{ state?: AppStateResponse }>(
              '/api/sync/mark-pushed',
              {
                method: 'POST',
                headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
              }
            );
            if (markRes.ok && markRes.data?.state) {
              latestState = markRes.data.state;
              applyIncomingState(latestState);
            }
          } catch {
            // Will retry on next scheduled Sheets sync
          }
        }

        const totalUploadedCombined =
          driveOut.totalUploadedFiles + expenseDriveOut.totalUploadedFiles;

        if (!silent || totalUploadedCombined > 0) {
          addToast(
            'success',
            'Foto Tersimpan di Google Drive',
            `${totalUploadedCombined} foto berhasil diunggah ke folder Google Drive & link tersimpan di Spreadsheet.`,
            driveOut.rootFolder.webViewLink
              ? {
                  actionLabel: 'Buka Google Drive',
                  actionHref: driveOut.rootFolder.webViewLink,
                }
              : undefined
          );
        }
        return true;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const isHtmlProxyErr = isHtmlOrMobileProxyError(err);
        if (status === 401 && !isHtmlProxyErr) {
          clearAccessToken();
          setHasGoogleToken(false);
        }
        if (!silent) {
          if (isHtmlProxyErr) {
            addToast(
              'info',
              'Unggah Drive Tertunda oleh Proxy Mobile',
              'Proxy jaringan seluler mengembalikan halaman HTML sementara. Sesi login tetap aktif dan foto akan disinkronkan otomatis saat jaringan stabil.'
            );
          } else {
            const msg =
              err instanceof Error
                ? err.message
                : 'Gagal mengunggah foto ke Google Drive.';
            addToast('error', 'Sinkronisasi Google Drive Gagal', msg);
          }
        }
        return false;
      } finally {
        driveSyncInFlightRef.current = false;
        setIsDriveSyncing(false);
      }
    },
    [hasGoogleToken, addToast, applyIncomingState, runCloudTask]
  );

  const syncWithGoogleSheets = useCallback(
    async (
      explicitSpreadsheetId?: string,
      silent = false,
      forceReplaceAll = false,
      explicitAccessToken?: string | null
    ): Promise<boolean> => {
      const token = explicitAccessToken || (await ensureValidAccessToken());
      if (!token && hasGoogleToken) {
        setHasGoogleToken(false);
      }
      const targetSheetId = extractSpreadsheetId(
        explicitSpreadsheetId ??
          (appStateRef.current.config.spreadsheetId ||
            readPermanentSpreadsheetBindingSync()?.spreadsheetId ||
            '')
      );

      if (!token || !targetSheetId) {
        if (token && !targetSheetId) {
          void handleSyncPhotosToDrive({ silent: true });
        }
        if (!token && targetSheetId) {
          const autoSyncRes = await safeApiFetch<{
            success?: boolean;
            source?: string | null;
            hasSheetDeletionsToPrune?: boolean;
            state?: AppStateResponse;
          }>('/api/sheets/auto-sync', {
            method: 'POST',
            headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
          });
          if (autoSyncRes.ok && autoSyncRes.data?.state) {
            const autoState = autoSyncRes.data.state;
            applyIncomingState(autoState);
            if (googleUser?.emailVerified) {
              const customPin = getSavedCustomPin() || undefined;
              const shouldPrune = Boolean(
                autoSyncRes.data.hasSheetDeletionsToPrune
              );
              void runCloudTask(() =>
                reconcileFullStateToFirestore(
                  googleUser,
                  autoState,
                  shouldPrune,
                  customPin
                )
              );
            }
            if (!silent) {
              if (autoSyncRes.data.success) {
                addToast(
                  'success',
                  'Sinkronisasi Otomatis Spreadsheet Aktif',
                  'Data Aplikasi, Cloud, dan penghapusan baris Spreadsheet telah diselaraskan.'
                );
              } else {
                addToast(
                  'info',
                  'Database Cloud & Spreadsheet Terikat Permanen',
                  'Seluruh perubahan telah diantrekan otomatis dan aman di Cloud.'
                );
              }
            }
            return true;
          }
        }
        const latest = await fetchServerState();
        if (latest && googleUser?.emailVerified) {
          const customPin = getSavedCustomPin() || undefined;
          void runCloudTask(() =>
            reconcileFullStateToFirestore(googleUser, latest, false, customPin)
          );
        }
        if (!silent) {
          if (!token && targetSheetId) {
            addToast(
              'info',
              'Database Cloud & Spreadsheet Terikat Permanen',
              'Seluruh perubahan telah diantrekan otomatis dan aman di Cloud.'
            );
          } else if (latest) {
            addToast('info', 'Data Diperbarui', 'Status terbaru berhasil dimuat.');
          }
        }
        return Boolean(latest);
      }

      if (syncInFlightRef.current) return false;
      syncInFlightRef.current = true;
      setIsSyncing(true);
      if (!hasGoogleToken) {
        setHasGoogleToken(true);
      }

      let activeToken = token;
      let lastError: unknown = null;

      try {
        for (
          let attempt = 0;
          attempt <= MAX_SHEETS_HTML_PROXY_RETRIES;
          attempt++
        ) {
          if (attempt > 0) {
            // Clean up any poisoned HTML cache entry and silently warm Firebase auth (zero popups, login intact)
            await purgeLegacyPoisonedApiCaches();
            void refreshFirebaseSessionSilently();
            await waitExponentialBackoff(attempt - 1, 1000, 8000);
            const refreshedToken = await ensureValidAccessToken();
            if (refreshedToken) {
              activeToken = refreshedToken;
            }
          }

          try {
            const pulled = await pullAllFromSpreadsheet(
              activeToken,
              targetSheetId
            );

            const mirrorRes = await safeApiFetch<{
              state?: AppStateResponse;
              adminPin?: string;
              hasCustomPinToPush?: boolean;
              hasPendingMasterUpdates?: boolean;
              hasPendingDriverUpdates?: boolean;
              hasSheetDeletionsToPrune?: boolean;
            }>('/api/sync/from-sheets', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Client-Id': REALTIME_CLIENT_ID,
              },
              body: JSON.stringify({
                ...pulled,
                forceReplaceAll,
              }),
            });

            // If /api/sync/from-sheets succeeded with JSON, use server-reconciled state;
            // otherwise (e.g. mobile proxy session returned HTML `<!doctype html>` after 1h),
            // seamlessly reconcile directly in the browser so Google Sheets & Drive sync NEVER fails!
            const reconciled =
              mirrorRes.ok && mirrorRes.data?.state
                ? {
                    state: mirrorRes.data.state,
                    adminPin:
                      mirrorRes.data.adminPin || getSavedCustomPin() || '123456',
                    hasCustomPinToPush: Boolean(mirrorRes.data.hasCustomPinToPush),
                    hasPendingMasterUpdates: Boolean(
                      mirrorRes.data.hasPendingMasterUpdates
                    ),
                    hasPendingDriverUpdates: Boolean(
                      mirrorRes.data.hasPendingDriverUpdates
                    ),
                    hasSheetDeletionsToPrune: Boolean(
                      mirrorRes.data.hasSheetDeletionsToPrune
                    ),
                  }
                : mergePulledSheetsIntoLocalState(
                    appStateRef.current,
                    pulled,
                    getSavedCustomPin(),
                    forceReplaceAll
                  );

            let nextState = reconciled.state;
            if (reconciled.adminPin && reconciled.adminPin !== '123456') {
              persistCustomPinLocally(reconciled.adminPin);
            }
            applyIncomingState(nextState);

            // Automatically upload any pending Driver photos & Expense receipt photos to Google Drive BEFORE pushing Sheets
            let hasNewDriveLinksToPush = false;
            const driveStats = summarizeFleetPhotoDriveStats(
              nextState.assignments
            );
            const hasPendingExpenseReceipts = (
              nextState.driverExpenses || []
            ).some(
              (exp) =>
                (exp.fotoStrukBbm &&
                  exp.fotoStrukBbm.startsWith('data:image/') &&
                  !exp.fotoStrukBbmUrl) ||
                (exp.fotoStrukTol &&
                  exp.fotoStrukTol.startsWith('data:image/') &&
                  !exp.fotoStrukTolUrl)
            );

            if (
              (driveStats.pendingPhotos > 0 || hasPendingExpenseReceipts) &&
              !driveSyncInFlightRef.current
            ) {
              driveSyncInFlightRef.current = true;
              setIsDriveSyncing(true);
              try {
                let effectiveRootId =
                  nextState.config.driveRootFolderId || undefined;

                if (driveStats.pendingPhotos > 0) {
                  const driveOut = await syncAllAssignmentsPhotosToDrive(
                    activeToken,
                    nextState.assignments,
                    {
                      cachedRootFolderId: effectiveRootId,
                    }
                  );
                  effectiveRootId = driveOut.rootFolder.id || effectiveRootId;
                  const updatesList = driveOut.results.map((u) => ({
                    assignmentId: u.assignmentId,
                    driveFolderUrl: u.folderUrl,
                    driveMedia: {
                      folderId: u.folderId,
                      folderUrl: u.folderUrl,
                      syncedAt: u.syncedAt,
                      ...u.mediaUrls,
                    },
                  }));
                  const saveDriveRes = await safeApiFetch<{
                    state?: AppStateResponse;
                  }>('/api/assignments/drive-media', {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      'X-Client-Id': REALTIME_CLIENT_ID,
                    },
                    body: JSON.stringify({
                      driveRootFolderId: driveOut.rootFolder.id,
                      driveRootFolderUrl: driveOut.rootFolder.webViewLink,
                      updates: updatesList,
                    }),
                  });
                  if (saveDriveRes.ok && saveDriveRes.data?.state) {
                    nextState = saveDriveRes.data.state;
                    applyIncomingState(nextState);
                  } else if (updatesList.length > 0) {
                    const updatesMap = new Map(
                      updatesList.map((item) => [item.assignmentId, item])
                    );
                    nextState = {
                      ...nextState,
                      config: {
                        ...nextState.config,
                        driveRootFolderId: driveOut.rootFolder.id,
                        driveRootFolderUrl: driveOut.rootFolder.webViewLink,
                      },
                      assignments: nextState.assignments.map((asg) => {
                        const upd = updatesMap.get(asg.id);
                        if (!upd) return asg;
                        return {
                          ...asg,
                          driveFolderUrl:
                            upd.driveFolderUrl || asg.driveFolderUrl,
                          driveMedia: {
                            ...(asg.driveMedia || {}),
                            ...upd.driveMedia,
                          },
                        };
                      }),
                    };
                    applyIncomingState(nextState);
                  }
                  if (driveOut.results.length > 0) {
                    hasNewDriveLinksToPush = true;
                  }
                }

                if (hasPendingExpenseReceipts) {
                  const expDriveOut = await syncDriverExpensesPhotosToDrive(
                    activeToken,
                    nextState.driverExpenses,
                    {
                      cachedRootFolderId: effectiveRootId,
                    }
                  );
                  if (expDriveOut.results.length > 0) {
                    const saveExpDriveRes = await safeApiFetch<{
                      state?: AppStateResponse;
                    }>('/api/driver-expenses/drive-media', {
                      method: 'POST',
                      headers: {
                        'Content-Type': 'application/json',
                        'X-Client-Id': REALTIME_CLIENT_ID,
                      },
                      body: JSON.stringify({
                        updates: expDriveOut.results,
                      }),
                    });
                    if (saveExpDriveRes.ok && saveExpDriveRes.data?.state) {
                      nextState = saveExpDriveRes.data.state;
                      applyIncomingState(nextState);
                    } else {
                      const expMap = new Map(
                        expDriveOut.results.map((r) => [r.expenseId, r])
                      );
                      nextState = {
                        ...nextState,
                        config: {
                          ...nextState.config,
                          driveRootFolderId:
                            expDriveOut.rootFolder.id ||
                            nextState.config.driveRootFolderId,
                          driveRootFolderUrl:
                            expDriveOut.rootFolder.webViewLink ||
                            nextState.config.driveRootFolderUrl,
                        },
                        driverExpenses: nextState.driverExpenses.map((exp) => {
                          const upd = expMap.get(exp.id);
                          if (!upd) return exp;
                          return {
                            ...exp,
                            fotoStrukBbmUrl:
                              upd.fotoStrukBbmUrl || exp.fotoStrukBbmUrl,
                            fotoStrukTolUrl:
                              upd.fotoStrukTolUrl || exp.fotoStrukTolUrl,
                          };
                        }),
                      };
                      applyIncomingState(nextState);
                    }
                    hasNewDriveLinksToPush = true;
                  }
                }
              } catch {
                // Non-blocking: Spreadsheet sync still proceeds even if Drive upload encounters transient error
              } finally {
                driveSyncInFlightRef.current = false;
                setIsDriveSyncing(false);
              }
            }

            const appsScriptUrlOutOfSync =
              String(nextState.config.appsScriptUrl || '').trim() !==
              String(pulled.appsScriptUrl || '').trim();
            if (
              reconciled.hasCustomPinToPush ||
              hasNewDriveLinksToPush ||
              appsScriptUrlOutOfSync
            ) {
              await pushConfigToSpreadsheet(activeToken, targetSheetId, {
                adminPin:
                  reconciled.adminPin || getSavedCustomPin() || '123456',
                dispatcherWaPhone: nextState.config.dispatcherWaPhone,
                whatsappTargetMode: nextState.config.whatsappTargetMode,
                whatsappGroupName: nextState.config.whatsappGroupName,
                whatsappGroupInviteUrl: nextState.config.whatsappGroupInviteUrl,
                letterPrefix: nextState.config.letterPrefix,
                publicPortalBaseUrl: nextState.config.publicPortalBaseUrl,
                appsScriptUrl: nextState.config.appsScriptUrl,
                driveRootFolderId: nextState.config.driveRootFolderId,
                driveRootFolderUrl: nextState.config.driveRootFolderUrl,
              });
            }

            if (reconciled.hasPendingMasterUpdates) {
              await pushDriversToSpreadsheet(
                activeToken,
                targetSheetId,
                nextState.drivers,
                true
              );
              await pushVehiclesToSpreadsheet(
                activeToken,
                targetSheetId,
                nextState.vehicles,
                true
              );
              await pushRoutesToSpreadsheet(
                activeToken,
                targetSheetId,
                nextState.routes,
                true
              );
              await pushFleetCardsToSpreadsheet(
                activeToken,
                targetSheetId,
                nextState.fleetCards,
                true
              );
            }

            // Push Surat_Tugas & Pengeluaran_Driver whenever App has unpushed updates OR Spreadsheet rows differ from reconciled canonical state
            const pulledAsgByNo = new Map(
              pulled.assignments.map((a) => [
                a.noPenugasan.trim().toLowerCase(),
                a,
              ])
            );
            const sheetAssignmentsMismatch =
              pulled.assignments.length !== nextState.assignments.length ||
              nextState.assignments.some((asg) => {
                if (asg.needsSheetSync) return true;
                const inSheet = pulledAsgByNo.get(
                  asg.noPenugasan.trim().toLowerCase()
                );
                if (!inSheet) return true;
                return (
                  inSheet.status !== asg.status ||
                  (inSheet.origin || '') !== (asg.origin || '') ||
                  (inSheet.kodeSegel || '') !== (asg.kodeSegel || '') ||
                  (inSheet.noSuratJalanFisik || '') !==
                    (asg.noSuratJalanFisik || '') ||
                  Boolean(asg.departureData?.timestamp) !==
                    Boolean(inSheet.departureData?.timestamp) ||
                  Boolean(asg.handoverData?.timestamp) !==
                    Boolean(inSheet.handoverData?.timestamp)
                );
              });

            const pulledExpById = new Set(
              (pulled.driverExpenses || []).map((e) =>
                e.id.trim().toLowerCase()
              )
            );
            const sheetExpensesMismatch =
              (pulled.driverExpenses || []).length !==
                (nextState.driverExpenses || []).length ||
              (nextState.driverExpenses || []).some(
                (e) =>
                  Boolean(e.needsSheetSync) ||
                  !pulledExpById.has(e.id.trim().toLowerCase())
              );

            const shouldPushOperationalTabs =
              reconciled.hasPendingDriverUpdates ||
              hasNewDriveLinksToPush ||
              sheetAssignmentsMismatch ||
              sheetExpensesMismatch;

            if (shouldPushOperationalTabs) {
              await pushAssignmentsToSpreadsheet(
                activeToken,
                targetSheetId,
                nextState.assignments,
                true
              );
              await pushDriverExpensesToSpreadsheet(
                activeToken,
                targetSheetId,
                nextState.driverExpenses,
                true
              );
              await pushFleetCardsToSpreadsheet(
                activeToken,
                targetSheetId,
                nextState.fleetCards,
                true
              );
              if (
                reconciled.hasPendingDriverUpdates ||
                sheetAssignmentsMismatch
              ) {
                await pushVehiclesToSpreadsheet(
                  activeToken,
                  targetSheetId,
                  nextState.vehicles,
                  true
                );
              }
            }

            if (
              reconciled.hasPendingMasterUpdates ||
              shouldPushOperationalTabs
            ) {
              const markRes = await safeApiFetch<{ state?: AppStateResponse }>(
                '/api/sync/mark-pushed',
                {
                  method: 'POST',
                  headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
                }
              );
              if (markRes.ok && markRes.data?.state) {
                nextState = markRes.data.state;
                applyIncomingState(nextState);
              } else {
                nextState = {
                  ...nextState,
                  assignments: nextState.assignments.map((a) => ({
                    ...a,
                    needsSheetSync: false,
                  })),
                  driverExpenses: nextState.driverExpenses.map((e) => ({
                    ...e,
                    needsSheetSync: false,
                  })),
                  fleetCards: nextState.fleetCards.map((fc) => ({
                    ...fc,
                    needsSheetSync: false,
                  })),
                };
                applyIncomingState(nextState);
              }
            }

            if (googleUser?.emailVerified) {
              const effectiveCustomPin =
                (reconciled.adminPin && reconciled.adminPin !== '123456'
                  ? reconciled.adminPin
                  : getSavedCustomPin()) || undefined;
              // Prune extraneous Firestore documents (pruneExtraneous = true) so any row deleted in Google Spreadsheet
              // is permanently removed from Cloud Firestore as well!
              void runCloudTask(() =>
                reconcileFullStateToFirestore(
                  googleUser,
                  nextState,
                  true,
                  effectiveCustomPin
                )
              );
            }

            if (!silent) {
              addToast(
                'success',
                'Sinkronisasi Spreadsheets & Drive Berhasil',
                `Terhubung dengan "${pulled.spreadsheetTitle}".`
              );
            }
            return true;
          } catch (attemptErr) {
            lastError = attemptErr;
            if (
              isHtmlOrMobileProxyError(attemptErr) &&
              attempt < MAX_SHEETS_HTML_PROXY_RETRIES
            ) {
              continue;
            }
            throw attemptErr;
          }
        }
        throw lastError;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        const isHtmlProxyErr = isHtmlOrMobileProxyError(err);

        // Only clear OAuth token on genuine JSON 401 responses from Google APIs;
        // NEVER disturb login state or OAuth token on transient 403 rate limits or mobile HTML proxy responses.
        if (status === 401 && !isHtmlProxyErr) {
          clearAccessToken();
          setHasGoogleToken(false);
        } else if (isHtmlProxyErr && googleUser?.emailVerified) {
          // Keep Cloud Firestore & local vault synchronized seamlessly even when mobile proxy blocks Sheets
          const customPin = getSavedCustomPin() || undefined;
          void runCloudTask(() =>
            reconcileFullStateToFirestore(
              googleUser,
              appStateRef.current,
              false,
              customPin
            )
          );
        }

        if (!silent) {
          handleSheetsAuthError(err);
        }
        return false;
      } finally {
        syncInFlightRef.current = false;
        setIsSyncing(false);
      }
    },
    [
      appState.config.spreadsheetId,
      googleUser,
      hasGoogleToken,
      addToast,
      applyIncomingState,
      fetchServerState,
      handleSheetsAuthError,
      handleSyncPhotosToDrive,
      runCloudTask,
    ]
  );

  const syncWithGoogleSheetsRef = useRef(syncWithGoogleSheets);
  syncWithGoogleSheetsRef.current = syncWithGoogleSheets;

  // Real-Time WebSocket Subscription (/ws) for sub-second sync across Admin & Driver
  useEffect(() => {
    const unsubscribeWs = realtimeSocket.subscribe((event) => {
      setLoadingInitial(false);
      applyIncomingState(event.state, {
        explicitAssignment: event.assignment,
        explicitPreviousStatus: event.previousStatus,
      });

      const isFromOtherClient = event.clientId !== REALTIME_CLIENT_ID;

      // Real-Time Cloud, Google Drive & Sheets Bridge when Driver submits updates or Expense Reports while Admin is signed in
      if (isFromOtherClient && event.actorRole === 'DRIVER') {
        const activeUser = googleUserRef.current;
        const changedAsg = event.assignment;
        if (activeUser?.emailVerified) {
          void runCloudTask(async () => {
            if (changedAsg) {
              await upsertAssignmentInFirestore(activeUser, changedAsg);
              for (const veh of event.state.vehicles) {
                await upsertVehicleInFirestore(activeUser, veh);
              }
            }
            for (const exp of event.state.driverExpenses || []) {
              if (exp.needsSheetSync) {
                await upsertDriverExpenseInFirestore(activeUser, exp);
              }
            }
            for (const fc of event.state.fleetCards || []) {
              if (fc.needsSheetSync) {
                await upsertFleetCardInFirestore(activeUser, fc);
              }
            }
          });
        }

        const sheetId = event.state.config.spreadsheetId;
        if (googleUserRef.current || getAccessToken()) {
          void (async () => {
            try {
              const token = await ensureValidAccessToken();
              if (!token) return;
              const pendingStats = summarizeFleetPhotoDriveStats(
                event.state.assignments
              );
              const pendingExpReceipts = (
                event.state.driverExpenses || []
              ).some(
                (e) =>
                  (e.fotoStrukBbm &&
                    e.fotoStrukBbm.startsWith('data:image/') &&
                    !e.fotoStrukBbmUrl) ||
                  (e.fotoStrukTol &&
                    e.fotoStrukTol.startsWith('data:image/') &&
                    !e.fotoStrukTolUrl)
              );

              if (pendingStats.pendingPhotos > 0 || pendingExpReceipts) {
                await handleSyncPhotosToDrive({
                  silent: true,
                  explicitAssignments: event.state.assignments,
                  explicitSpreadsheetId: sheetId,
                });
              } else if (sheetId && !syncInFlightRef.current) {
                if (changedAsg) {
                  await pushAssignmentsToSpreadsheet(
                    token,
                    sheetId,
                    event.state.assignments
                  );
                  await pushVehiclesToSpreadsheet(
                    token,
                    sheetId,
                    event.state.vehicles
                  );
                }
                if (
                  (event.state.driverExpenses || []).some(
                    (e) => e.needsSheetSync
                  )
                ) {
                  await pushDriverExpensesToSpreadsheet(
                    token,
                    sheetId,
                    event.state.driverExpenses || []
                  );
                  await pushFleetCardsToSpreadsheet(
                    token,
                    sheetId,
                    event.state.fleetCards || []
                  );
                }
                await fetch('/api/sync/mark-pushed', {
                  method: 'POST',
                  headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
                });
              }
            } catch {
              // Next scheduled sync will reconcile if transient error occurs
            }
          })();
        }
      }

      // Real-Time Automatic WhatsApp Notification for Role Driver
      const currentDriver = loggedInDriverRef.current;
      if (
        isFromOtherClient &&
        sessionRoleRef.current === UserRole.DRIVER &&
        currentDriver &&
        event.notification &&
        event.notification.driverId.trim().toLowerCase() ===
          currentDriver.id.trim().toLowerCase()
      ) {
        const notif = event.notification;
        if (!notifiedDriverWaIdsRef.current.has(notif.id)) {
          notifiedDriverWaIdsRef.current.add(notif.id);
          const targetMode: WhatsAppTargetMode = currentDriver.phone
            ? 'DRIVER'
            : event.state.config.whatsappTargetMode || 'GROUP';
          const driverWaUrl = event.assignment
            ? buildRealtimeWhatsAppUrlForAssignment(
                {
                  ...event.assignment,
                  driverPhone:
                    currentDriver.phone || event.assignment.driverPhone,
                },
                targetMode,
                event.state.config.whatsappGroupName,
                event.state.config.dispatcherWaPhone,
                notif.eventType
              ).url
            : resolveWhatsAppUrlForMode(
                notif,
                targetMode,
                currentDriver.phone,
                event.state.config.dispatcherWaPhone
              );

          const eventLabel =
            notif.eventType === 'SURAT_TUGAS'
              ? 'Surat Tugas Baru'
              : notif.eventType === 'KEBERANGKATAN'
              ? 'Data Keberangkatan'
              : notif.eventType === 'DELIVERED'
              ? 'Konfirmasi Delivered'
              : 'Data Serah Terima';

          addToast(
            'info',
            `Notifikasi WA Otomatis: ${eventLabel}`,
            `${notif.noPenugasan} (${notif.plateNumber}) — Data Keberangkatan & Serah Terima siap di WhatsApp.`,
            {
              actionLabel: 'Buka WhatsApp',
              actionHref: driverWaUrl,
              durationMs: 8000,
            }
          );

          const autoWaPref =
            typeof window !== 'undefined'
              ? window.localStorage.getItem('crk_driver_auto_wa') !== 'false'
              : true;
          if (autoWaPref) {
            launchWhatsAppUrl(driverWaUrl);
          }
        }
      }
    });

    return () => {
      unsubscribeWs();
    };
  }, [addToast, applyIncomingState, runCloudTask]);

  useEffect(() => {
    void purgeLegacyPoisonedApiCaches();
    void pruneCompletedAssignmentsCacheOlderThan7Days();
    // Hydrate IndexedDB Vault immediately in parallel so offline/hibernated mobile boots in <80ms with full photos
    void readFullWorkspaceFromVault().then((vault) => {
      if (!vault) return;
      if (
        appStateRef.current.drivers.length === 0 &&
        (vault.drivers?.length || 0) > 0
      ) {
        applyIncomingState({
          ...appStateRef.current,
          drivers: vault.drivers || appStateRef.current.drivers,
          vehicles: vault.vehicles || appStateRef.current.vehicles,
          routes: vault.routes || appStateRef.current.routes,
          fleetCards: vault.fleetCards || appStateRef.current.fleetCards,
          driverExpenses:
            vault.driverExpenses || appStateRef.current.driverExpenses,
          assignments: vault.assignments || appStateRef.current.assignments,
          config: {
            ...appStateRef.current.config,
            ...(vault.config || {}),
          },
        });
        setLoadingInitial(false);
      }
    });

    void (async () => {
      try {
        window.localStorage.removeItem(PENDING_CLOUD_ASSIGNMENT_PURGE_KEY);
      } catch {
        // Ignore storage restrictions
      }
      await fetchServerState();
    })();
    void refreshDriverLinkStatus();

    const pruneIntervalId = window.setInterval(() => {
      void pruneCompletedAssignmentsCacheOlderThan7Days();
    }, 6 * 60 * 60 * 1000);

    // Async IndexedDB session fallback if mobile browser cleared sync storage
    void readPortalSessionAsync().then((asyncSaved) => {
      if (!asyncSaved || sessionRoleRef.current !== null) return;
      if (driverUrlParams.isDriverMode) {
        if (
          asyncSaved.role === UserRole.DRIVER &&
          asyncSaved.driverSnapshot &&
          (!driverUrlParams.driverId ||
            asyncSaved.driverId?.toLowerCase() ===
              driverUrlParams.driverId.toLowerCase())
        ) {
          setLoggedInDriver(asyncSaved.driverSnapshot);
          setSessionRole(UserRole.DRIVER);
        }
        return;
      }
      if (asyncSaved.role === UserRole.ADMIN) {
        setSessionRole(UserRole.ADMIN);
      } else if (
        asyncSaved.role === UserRole.DRIVER &&
        asyncSaved.driverSnapshot
      ) {
        setLoggedInDriver(asyncSaved.driverSnapshot);
        setSessionRole(UserRole.DRIVER);
      }
    });

    const unsubTokenState = subscribeGoogleTokenState((valid, user) => {
      setHasGoogleToken(valid);
      if (user) {
        setGoogleUser(user);
      }
    });

    const unsubscribe = initAuth(
      (user) => {
        setGoogleUser(user);
        setHasGoogleToken(true);
        setAuthReady(true);
      },
      (user) => {
        setGoogleUser(user);
        setHasGoogleToken(Boolean(getAccessToken()));
        setAuthReady(true);
      }
    );
    return () => {
      unsubTokenState();
      unsubscribe();
    };
  }, [fetchServerState, driverUrlParams]);

  // Real-time Firestore Cloud Persistence (gated strictly on authReady & verified user)
  useEffect(() => {
    if (!authReady || !googleUser || !googleUser.emailVerified) {
      return;
    }

    let cancelled = false;
    let unsubscribeListeners: (() => void) | null = null;

    const bootstrapAndListen = async () => {
      try {
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.removeItem(PENDING_CLOUD_ASSIGNMENT_PURGE_KEY);
          } catch {
            // Ignore
          }
        }

        // Ensure Express server reconciles live Google Spreadsheet deletions BEFORE Firestore hydrates,
        // so stale Cloud Firestore docs that were deleted in Spreadsheet get tombstoned & pruned immediately!
        const boundSheetOnBoot =
          appStateRef.current.config.spreadsheetId ||
          readPermanentSpreadsheetBindingSync()?.spreadsheetId ||
          '';
        if (boundSheetOnBoot && !getAccessToken()) {
          await safeApiFetch('/api/sheets/auto-sync', {
            method: 'POST',
            headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
          });
        }

        const [serverRes, cloudWorkspace] = await Promise.all([
          safeApiFetch<AppStateResponse>('/api/state').then((r) =>
            r.ok ? r.data : null
          ),
          pullWorkspaceFromFirestore(googleUser),
        ]);

        if (cancelled || !cloudWorkspace) return;

        if (cloudWorkspace.hasAnyCloudData) {
          if (
            cloudWorkspace.config?.adminPin &&
            cloudWorkspace.config.adminPin !== '123456'
          ) {
            persistCustomPinLocally(cloudWorkspace.config.adminPin);
          }

          const hydrateRes = await safeApiFetch<{
            state?: AppStateResponse;
            adminPin?: string;
            hasLocalUpdatesForCloud?: boolean;
            hasExtraneousCloudDocsToPrune?: boolean;
          }>('/api/sync/from-firestore', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Client-Id': REALTIME_CLIENT_ID,
            },
            body: JSON.stringify({
              config: cloudWorkspace.config,
              drivers: cloudWorkspace.drivers,
              vehicles: cloudWorkspace.vehicles,
              routes: cloudWorkspace.routes,
              fleetCards: cloudWorkspace.fleetCards,
              driverExpenses: cloudWorkspace.driverExpenses,
              assignments: cloudWorkspace.assignments,
              replaceCollections: false,
            }),
          });

          if (hydrateRes.ok && hydrateRes.data) {
            const hydrateJson = hydrateRes.data;
            if (hydrateJson.adminPin && hydrateJson.adminPin !== '123456') {
              persistCustomPinLocally(hydrateJson.adminPin);
            }
            if (!cancelled && hydrateJson.state) {
              applyIncomingState(hydrateJson.state);
              if (
                hydrateJson.hasLocalUpdatesForCloud ||
                hydrateJson.hasExtraneousCloudDocsToPrune
              ) {
                const effectivePin =
                  (hydrateJson.adminPin && hydrateJson.adminPin !== '123456'
                    ? hydrateJson.adminPin
                    : getSavedCustomPin()) || undefined;
                const shouldPruneCloud = Boolean(
                  hydrateJson.hasExtraneousCloudDocsToPrune
                );
                await runCloudTask(() =>
                  reconcileFullStateToFirestore(
                    googleUser,
                    hydrateJson.state as AppStateResponse,
                    shouldPruneCloud,
                    effectivePin
                  )
                );
              }
              if (
                hydrateJson.state.config.spreadsheetId &&
                (hydrateJson.state.assignments.some((a) => a.needsSheetSync) ||
                  (hydrateJson.state.driverExpenses || []).some(
                    (e) => e.needsSheetSync
                  ))
              ) {
                void syncWithGoogleSheetsRef.current(
                  hydrateJson.state.config.spreadsheetId,
                  true
                );
              }
            }
          } else if (!cancelled) {
            // Hydrate UI directly from Firestore when /api/* returns HTML on mobile
            const mergedFromCloud = mergeFirestoreIntoLocalState(
              appStateRef.current,
              cloudWorkspace
            );
            applyIncomingState(mergedFromCloud);
          }
        } else if (serverRes) {
          const customPin = getSavedCustomPin() || undefined;
          await runCloudTask(() =>
            reconcileFullStateToFirestore(
              googleUser,
              serverRes,
              false,
              customPin
            )
          );
        }

        if (cancelled) return;

        unsubscribeListeners = subscribeToFirestoreWorkspace(
          googleUser,
          (partial) => {
            if (cancelled || cloudMutationLockRef.current) return;
            if (
              partial.config?.adminPin &&
              partial.config.adminPin !== '123456'
            ) {
              persistCustomPinLocally(partial.config.adminPin);
            }
            void (async () => {
              try {
                const syncRes = await safeApiFetch<{
                  state?: AppStateResponse;
                  adminPin?: string;
                  hasLocalUpdatesForCloud?: boolean;
                  hasExtraneousCloudDocsToPrune?: boolean;
                }>('/api/sync/from-firestore', {
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'X-Client-Id': REALTIME_CLIENT_ID,
                  },
                  body: JSON.stringify({
                    ...partial,
                    replaceCollections: false,
                  }),
                });
                if (syncRes.ok && syncRes.data) {
                  const syncJson = syncRes.data;
                  if (syncJson.adminPin && syncJson.adminPin !== '123456') {
                    persistCustomPinLocally(syncJson.adminPin);
                  }
                  if (!cancelled && syncJson.state) {
                    applyIncomingState(syncJson.state);
                    if (
                      syncJson.hasLocalUpdatesForCloud ||
                      syncJson.hasExtraneousCloudDocsToPrune
                    ) {
                      const effectivePin =
                        (syncJson.adminPin && syncJson.adminPin !== '123456'
                          ? syncJson.adminPin
                          : getSavedCustomPin()) || undefined;
                      const shouldPruneLiveCloud = Boolean(
                        syncJson.hasExtraneousCloudDocsToPrune
                      );
                      await runCloudTask(() =>
                        reconcileFullStateToFirestore(
                          googleUser,
                          syncJson.state as AppStateResponse,
                          shouldPruneLiveCloud,
                          effectivePin
                        )
                      );
                    }
                    if (
                      syncJson.state.config.spreadsheetId &&
                      (syncJson.state.assignments.some(
                        (a) => a.needsSheetSync
                      ) ||
                        (syncJson.state.driverExpenses || []).some(
                          (e) => e.needsSheetSync
                        ))
                    ) {
                      void syncWithGoogleSheetsRef.current(
                        syncJson.state.config.spreadsheetId,
                        true
                      );
                    }
                  }
                } else if (!cancelled) {
                  const mergedLive = mergeFirestoreIntoLocalState(
                    appStateRef.current,
                    partial
                  );
                  applyIncomingState(mergedLive);
                }
              } catch {
                // Ignore transient network errors when hydrating local express mirror
              }
            })();
          }
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (msg.includes('Quota exceeded')) {
          addToast(
            'error',
            'Kuota Cloud Harian Tercapai',
            'Kuota penyimpanan cloud gratis hari ini penuh dan akan disetel ulang besok.'
          );
        }
      }
    };

    void bootstrapAndListen();

    return () => {
      cancelled = true;
      if (unsubscribeListeners) {
        unsubscribeListeners();
      }
    };
  }, [authReady, googleUser, addToast, applyIncomingState, runCloudTask]);

  useEffect(() => {
    if (appState.config.spreadsheetId) {
      void syncWithGoogleSheets(appState.config.spreadsheetId, true);
    } else if (hasGoogleToken) {
      void handleSyncPhotosToDrive({ silent: true });
    }

    const checkAndSyncServerProgress = async () => {
      if (appStateRef.current.config.spreadsheetId) {
        await syncWithGoogleSheets(
          appStateRef.current.config.spreadsheetId,
          true
        );
      }
      const latest = await fetchServerState();
      if ((hasGoogleToken || getAccessToken()) && latest) {
        const pendingPhotos = summarizeFleetPhotoDriveStats(
          latest.assignments
        ).pendingPhotos;
        const pendingExpReceipts = (latest.driverExpenses || []).some(
          (e) =>
            (e.fotoStrukBbm &&
              e.fotoStrukBbm.startsWith('data:image/') &&
              !e.fotoStrukBbmUrl) ||
            (e.fotoStrukTol &&
              e.fotoStrukTol.startsWith('data:image/') &&
              !e.fotoStrukTolUrl)
        );
        if (pendingPhotos > 0 || pendingExpReceipts) {
          await handleSyncPhotosToDrive({
            silent: true,
            explicitAssignments: latest.assignments,
            explicitSpreadsheetId: latest.config.spreadsheetId,
          });
        }
      }
      if (
        latest &&
        googleUser?.emailVerified &&
        (latest.assignments.some((a) => a.needsSheetSync) ||
          (latest.driverExpenses || []).some((e) => e.needsSheetSync) ||
          (latest.fleetCards || []).some((fc) => fc.needsSheetSync))
      ) {
        void runCloudTask(async () => {
          for (const asg of latest.assignments) {
            if (asg.needsSheetSync) {
              await upsertAssignmentInFirestore(googleUser, asg);
            }
          }
          for (const exp of latest.driverExpenses || []) {
            if (exp.needsSheetSync) {
              await upsertDriverExpenseInFirestore(googleUser, exp);
            }
          }
          for (const fc of latest.fleetCards || []) {
            if (fc.needsSheetSync) {
              await upsertFleetCardInFirestore(googleUser, fc);
            }
          }
          for (const veh of latest.vehicles) {
            await upsertVehicleInFirestore(googleUser, veh);
          }
        });
      }
    };

    const interval = setInterval(() => {
      if (appStateRef.current.config.spreadsheetId) {
        void syncWithGoogleSheets(
          appStateRef.current.config.spreadsheetId,
          true
        );
      } else {
        void checkAndSyncServerProgress();
      }
    }, 18000);

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        if (appStateRef.current.config.spreadsheetId) {
          void syncWithGoogleSheets(
            appStateRef.current.config.spreadsheetId,
            true
          );
        } else {
          void checkAndSyncServerProgress();
        }
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [
    hasGoogleToken,
    googleUser,
    appState.config.spreadsheetId,
    syncWithGoogleSheets,
    handleSyncPhotosToDrive,
    fetchServerState,
    runCloudTask,
  ]);

  // Restore & refresh persistent portal session (Admin or Driver) across browser/iframe reloads
  useEffect(() => {
    if (loadingInitial || sessionRestoredRef.current) return;
    const saved = readSavedPortalSession();

    // If opened via Link Khusus Driver (?role=driver&driver=DRV-XXX)
    if (driverUrlParams.isDriverMode) {
      if (driverUrlParams.driverId) {
        persistSavedDriverUid(driverUrlParams.driverId);
      }
      if (
        saved?.role === UserRole.DRIVER &&
        saved.driverId &&
        (!driverUrlParams.driverId ||
          saved.driverId.toLowerCase() ===
            driverUrlParams.driverId.toLowerCase())
      ) {
        const matched = appState.drivers.find(
          (d) => d.id.toLowerCase() === saved.driverId!.toLowerCase()
        );
        if (matched && matched.active !== false) {
          sessionRestoredRef.current = true;
          setLoggedInDriver(matched);
          setSessionRole(UserRole.DRIVER);
          persistPortalSession({
            role: UserRole.DRIVER,
            driverId: matched.id,
            driverSnapshot: matched,
          });
        } else if (matched && matched.active === false) {
          sessionRestoredRef.current = true;
          persistPortalSession(null);
          setLoggedInDriver(null);
          setSessionRole(null);
        } else if (saved.driverSnapshot && appState.drivers.length === 0) {
          // Keep driver logged in using snapshot while drivers list finishes hydrating
          setLoggedInDriver(saved.driverSnapshot);
          setSessionRole(UserRole.DRIVER);
        } else if (appState.drivers.length > 0 && !saved.driverSnapshot) {
          sessionRestoredRef.current = true;
        }
      } else {
        sessionRestoredRef.current = true;
      }
      return;
    }

    if (!saved) {
      sessionRestoredRef.current = true;
      return;
    }

    if (saved.role === UserRole.ADMIN) {
      sessionRestoredRef.current = true;
      for (const a of appState.assignments) {
        prevStatusMapRef.current.set(a.id, a.status);
      }
      statusMapInitializedRef.current = true;
      setSessionRole(UserRole.ADMIN);
      persistPortalSession({ role: UserRole.ADMIN });
      return;
    }

    if (saved.role === UserRole.DRIVER && saved.driverId) {
      const matched = appState.drivers.find(
        (d) => d.id.toLowerCase() === saved.driverId!.toLowerCase()
      );
      if (matched && matched.active !== false) {
        sessionRestoredRef.current = true;
        setLoggedInDriver(matched);
        setSessionRole(UserRole.DRIVER);
        persistPortalSession({
          role: UserRole.DRIVER,
          driverId: matched.id,
          driverSnapshot: matched,
        });
      } else if (matched && matched.active === false) {
        sessionRestoredRef.current = true;
        persistPortalSession(null);
        setLoggedInDriver(null);
        setSessionRole(null);
      } else if (saved.driverSnapshot && appState.drivers.length === 0) {
        setLoggedInDriver(saved.driverSnapshot);
        setSessionRole(UserRole.DRIVER);
      } else if (appState.drivers.length > 0 && !saved.driverSnapshot) {
        sessionRestoredRef.current = true;
      }
    }
  }, [loadingInitial, appState.drivers, appState.assignments, driverUrlParams]);

  useEffect(() => {
    if (loggedInDriver) {
      const updated = appState.drivers.find(
        (d) => d.id.toLowerCase() === loggedInDriver.id.toLowerCase()
      );
      if (updated && updated !== loggedInDriver) {
        setLoggedInDriver(updated);
        if (sessionRole === UserRole.DRIVER) {
          persistPortalSession({
            role: UserRole.DRIVER,
            driverId: updated.id,
            driverSnapshot: updated,
          });
        }
      }
    }
  }, [appState.drivers, loggedInDriver, sessionRole]);

  /**
   * Must ONLY be called synchronously at the start of an explicit Admin button click.
   * If in-memory token is already active, returns immediately with zero popups.
   * If browser tab was freshly reopened, seamlessly re-establishes Google Workspace token in 1 click.
   */
  const ensureAdminInteractiveSheetsToken = async (): Promise<string | null> => {
    const existing = getAccessToken();
    if (existing) return existing;
    try {
      const result = await googleSignIn(false);
      if (result?.accessToken) {
        setGoogleUser(result.user);
        setHasGoogleToken(true);
        return result.accessToken;
      }
    } catch {
      // User dismissed popup; fallback gracefully to Cloud/Server state
    }
    return null;
  };

  const handleManualAdminSync = async (): Promise<void> => {
    const boundSheetId = extractSpreadsheetId(
      appStateRef.current.config.spreadsheetId ||
        readPermanentSpreadsheetBindingSync()?.spreadsheetId ||
        ''
    );
    let token = getAccessToken();
    if (
      !token &&
      boundSheetId &&
      !appStateRef.current.config.serviceAccountConfigured &&
      !appStateRef.current.config.appsScriptUrl &&
      (googleUserRef.current || hasBoundGoogleWorkspaceAccount())
    ) {
      token = await ensureAdminInteractiveSheetsToken();
    }
    await syncWithGoogleSheets(boundSheetId || undefined, false, false, token);
  };

  const handleGoogleLogin = async () => {
    try {
      const result = await googleSignIn(false);
      if (result) {
        setGoogleUser(result.user);
        setHasGoogleToken(true);
        const boundSheetId =
          appStateRef.current.config.spreadsheetId ||
          readPermanentSpreadsheetBindingSync()?.spreadsheetId ||
          '';
        addToast(
          'success',
          'Sesi Permanen Google & Spreadsheet Aktif',
          `Terhubung sebagai ${result.user.email}. Sinkronisasi otomatis Cloud, Google Drive & Google Sheets berjalan permanen.`
        );
        if (boundSheetId) {
          await syncWithGoogleSheets(
            boundSheetId,
            false,
            false,
            result.accessToken
          );
        } else {
          await handleSyncPhotosToDrive({ silent: true });
        }
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Login Google dibatalkan.';
      addToast('error', 'Gagal Menghubungkan Google', msg);
    }
  };

  const handleGoogleLogout = async () => {
    await logoutGoogle();
    setGoogleUser(null);
    setHasGoogleToken(false);
    addToast(
      'info',
      'Akun Google Diputus',
      'Akun Google diputus. Ikatan ID Spreadsheet dan seluruh data operasional tetap tersimpan aman.'
    );
  };

  const handleDisconnectSpreadsheet = async (): Promise<void> => {
    clearPermanentSpreadsheetBinding();
    const cfgRes = await safeApiFetch<{ state?: AppStateResponse }>(
      '/api/config',
      {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId: '',
          spreadsheetTitle: '',
          spreadsheetUrl: '',
          resetLocalCache: false,
        }),
      }
    );
    const nextState: AppStateResponse =
      cfgRes.ok && cfgRes.data?.state
        ? cfgRes.data.state
        : {
            ...appStateRef.current,
            config: {
              ...appStateRef.current.config,
              spreadsheetId: '',
              spreadsheetTitle: '',
              spreadsheetUrl: '',
            },
          };
    applyIncomingState(nextState);
    if (googleUserRef.current?.emailVerified) {
      const customPin = getSavedCustomPin() || undefined;
      void runCloudTask(() =>
        upsertConfigInFirestore(
          googleUserRef.current!,
          nextState.config,
          customPin
        )
      );
    }
    addToast(
      'info',
      'Ikatan Spreadsheet Dilepas',
      'Anda dapat menghubungkan Spreadsheet baru kapan saja. Seluruh data di Aplikasi & Cloud tetap utuh.'
    );
  };

  const handleConnectSpreadsheet = async (input: string): Promise<boolean> => {
    const extractedId = extractSpreadsheetId(input);
    if (!extractedId) {
      addToast(
        'error',
        'ID Spreadsheet Tidak Valid',
        'Periksa kembali URL Google Sheets.'
      );
      return false;
    }

    const isSwitchingToDifferentSheet = Boolean(
      appStateRef.current.config.spreadsheetId &&
        appStateRef.current.config.spreadsheetId.trim() !== extractedId
    );

    if (
      appStateRef.current.config.serviceAccountConfigured &&
      !getAccessToken()
    ) {
      setIsSyncing(true);
      try {
        await safeApiFetch('/api/config', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            spreadsheetId: extractedId,
            spreadsheetTitle: isSwitchingToDifferentSheet
              ? ''
              : appStateRef.current.config.spreadsheetTitle || '',
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${extractedId}/edit`,
            resetLocalCache: isSwitchingToDifferentSheet,
          }),
        });
        const verifyRes = await safeApiFetch<{
          ok?: boolean;
          message?: string;
          error?: string;
          state?: AppStateResponse;
        }>('/api/service-account/verify', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': REALTIME_CLIENT_ID,
          },
          body: JSON.stringify({}),
        });
        if (verifyRes.data?.state) {
          applyIncomingState(verifyRes.data.state);
        }
        if (verifyRes.ok && verifyRes.data?.ok) {
          persistPermanentSpreadsheetBinding({
            spreadsheetId: extractedId,
            spreadsheetTitle:
              verifyRes.data.state?.config.spreadsheetTitle || '',
            spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${extractedId}/edit`,
            driveRootFolderId:
              verifyRes.data.state?.config.driveRootFolderId,
            driveRootFolderUrl:
              verifyRes.data.state?.config.driveRootFolderUrl,
            lastSyncedAt:
              verifyRes.data.state?.config.lastSyncedAt ||
              new Date().toISOString(),
          });
          addToast(
            'success',
            'Spreadsheet Terhubung via Service Account 24/7',
            verifyRes.data.message ||
              'Spreadsheet berhasil diikat dan disinkronkan dua arah.'
          );
          return true;
        }
        addToast(
          'error',
          'Periksa Izin Editor Service Account',
          verifyRes.data?.error ||
            verifyRes.errorMessage ||
            'Pastikan email Service Account sudah dibagikan akses Editor di Google Spreadsheet.'
        );
        return false;
      } finally {
        setIsSyncing(false);
      }
    }

    const token = await ensureAdminInteractiveSheetsToken();
    if (!token) {
      addToast(
        'error',
        'Autentikasi Google Diperlukan',
        'Konfirmasi akun Google Anda pada jendela login agar Spreadsheet terikat secara permanen.'
      );
      return false;
    }

    // Pre-persist permanent binding immediately so it never drops
    persistPermanentSpreadsheetBinding({
      spreadsheetId: extractedId,
      spreadsheetTitle:
        isSwitchingToDifferentSheet
          ? ''
          : appStateRef.current.config.spreadsheetTitle || '',
      spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${extractedId}/edit`,
      driveRootFolderId: appStateRef.current.config.driveRootFolderId,
      driveRootFolderUrl: appStateRef.current.config.driveRootFolderUrl,
      connectedEmail: auth.currentUser?.email || googleUserRef.current?.email || undefined,
      lastSyncedAt: appStateRef.current.config.lastSyncedAt,
    });

    // Pull & validate FIRST without wiping local cache beforehand!
    const ok = await syncWithGoogleSheets(
      extractedId,
      false,
      isSwitchingToDifferentSheet,
      token
    );
    const activeUser = auth.currentUser || googleUserRef.current;
    if (ok && activeUser?.emailVerified) {
      const customPin = getSavedCustomPin() || undefined;
      void runCloudTask(() =>
        upsertConfigInFirestore(
          activeUser,
          appStateRef.current.config,
          customPin
        )
      );
    }
    return ok;
  };

  const handleCreateSpreadsheet = async (
    customTitle: string
  ): Promise<boolean> => {
    const token = await ensureAdminInteractiveSheetsToken();
    if (!token) {
      addToast(
        'error',
        'Autentikasi Google Diperlukan',
        'Konfirmasi akun Google Anda untuk membuat database Google Spreadsheet baru.'
      );
      return false;
    }

    setIsSyncing(true);
    try {
      const created = await createNewDatabaseSpreadsheet(token, customTitle);
      const nowIso = new Date().toISOString();
      // Preserve all existing Master Data & Assignments and export them into the new Spreadsheet!
      const cfgRes = await safeApiFetch<{
        state?: AppStateResponse;
        adminPin?: string;
      }>('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          spreadsheetId: created.spreadsheetId,
          spreadsheetTitle: created.title,
          spreadsheetUrl: created.url,
          lastSyncedAt: nowIso,
          resetLocalCache: false,
        }),
      });

      const nextState: AppStateResponse =
        cfgRes.ok && cfgRes.data?.state
          ? cfgRes.data.state
          : {
              ...appStateRef.current,
              config: {
                ...appStateRef.current.config,
                spreadsheetId: created.spreadsheetId,
                spreadsheetTitle: created.title,
                spreadsheetUrl: created.url,
                lastSyncedAt: nowIso,
              },
            };

      const serverPin = cfgRes.data?.adminPin;
      const activePin =
        (serverPin && serverPin !== '123456'
          ? serverPin
          : getSavedCustomPin()) ||
        serverPin ||
        '123456';
      persistCustomPinLocally(activePin);
      applyIncomingState(nextState);

      await pushConfigToSpreadsheet(token, created.spreadsheetId, {
        adminPin: activePin,
        dispatcherWaPhone: nextState.config.dispatcherWaPhone || '',
        whatsappTargetMode: nextState.config.whatsappTargetMode || 'GROUP',
        whatsappGroupName:
          nextState.config.whatsappGroupName || 'Grup Operasional CRK Logistik',
        whatsappGroupInviteUrl: nextState.config.whatsappGroupInviteUrl || '',
        letterPrefix: nextState.config.letterPrefix || 'ST-CRK',
        publicPortalBaseUrl: nextState.config.publicPortalBaseUrl || '',
      });

      // Immediately back up any existing app records into the new Spreadsheet
      if (nextState.drivers.length > 0) {
        await pushDriversToSpreadsheet(
          token,
          created.spreadsheetId,
          nextState.drivers,
          false
        );
      }
      if (nextState.vehicles.length > 0) {
        await pushVehiclesToSpreadsheet(
          token,
          created.spreadsheetId,
          nextState.vehicles,
          false
        );
      }
      if (nextState.routes.length > 0) {
        await pushRoutesToSpreadsheet(
          token,
          created.spreadsheetId,
          nextState.routes,
          false
        );
      }
      if (nextState.fleetCards.length > 0) {
        await pushFleetCardsToSpreadsheet(
          token,
          created.spreadsheetId,
          nextState.fleetCards,
          false
        );
      }
      if (nextState.driverExpenses.length > 0) {
        await pushDriverExpensesToSpreadsheet(
          token,
          created.spreadsheetId,
          nextState.driverExpenses,
          false
        );
      }
      if (nextState.assignments.length > 0) {
        await pushAssignmentsToSpreadsheet(
          token,
          created.spreadsheetId,
          nextState.assignments,
          false
        );
      }

      await safeApiFetch('/api/sync/mark-pushed', {
        method: 'POST',
        headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
      });

      if (googleUser?.emailVerified) {
        void runCloudTask(() =>
          reconcileFullStateToFirestore(
            googleUser,
            nextState,
            false,
            activePin !== '123456' ? activePin : undefined
          )
        );
      }

      addToast(
        'success',
        'Spreadsheet Database Baru Dibuat',
        `File "${created.title}" siap digunakan dan seluruh data tersinkronisasi.`
      );
      return true;
    } catch (err) {
      handleSheetsAuthError(err);
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const pushToSheetsIfActive = async (
    kind:
      | 'drivers'
      | 'vehicles'
      | 'routes'
      | 'fleetCards'
      | 'driverExpenses'
      | 'assignments',
    nextState: AppStateResponse,
    allowEmptyOverwrite = false
  ) => {
    const sheetId = extractSpreadsheetId(nextState.config.spreadsheetId);
    if (!sheetId) return;
    const token = await ensureValidAccessToken();
    if (!token) {
      if (hasGoogleToken) {
        setHasGoogleToken(false);
      }
      if (
        nextState.config.appsScriptUrl ||
        nextState.config.serviceAccountConfigured
      ) {
        await safeApiFetch('/api/sheets/auto-sync', {
          method: 'POST',
          headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
        });
      }
      return;
    }

    try {
      setIsSyncing(true);
      for (
        let attempt = 0;
        attempt <= MAX_SHEETS_HTML_PROXY_RETRIES;
        attempt++
      ) {
        if (attempt > 0) {
          await purgeLegacyPoisonedApiCaches();
          await waitExponentialBackoff(attempt - 1, 900, 6000);
        }
        try {
          if (kind === 'drivers') {
            await pushDriversToSpreadsheet(
              token,
              sheetId,
              nextState.drivers,
              allowEmptyOverwrite
            );
          } else if (kind === 'vehicles') {
            await pushVehiclesToSpreadsheet(
              token,
              sheetId,
              nextState.vehicles,
              allowEmptyOverwrite
            );
          } else if (kind === 'routes') {
            await pushRoutesToSpreadsheet(
              token,
              sheetId,
              nextState.routes,
              allowEmptyOverwrite
            );
          } else if (kind === 'fleetCards') {
            await pushFleetCardsToSpreadsheet(
              token,
              sheetId,
              nextState.fleetCards,
              allowEmptyOverwrite
            );
          } else if (kind === 'driverExpenses') {
            await pushDriverExpensesToSpreadsheet(
              token,
              sheetId,
              nextState.driverExpenses,
              allowEmptyOverwrite
            );
          } else if (kind === 'assignments') {
            await pushAssignmentsToSpreadsheet(
              token,
              sheetId,
              nextState.assignments,
              allowEmptyOverwrite
            );
          }
          break;
        } catch (attemptErr) {
          if (
            isHtmlOrMobileProxyError(attemptErr) &&
            attempt < MAX_SHEETS_HTML_PROXY_RETRIES
          ) {
            continue;
          }
          throw attemptErr;
        }
      }
      await safeApiFetch('/api/sync/mark-pushed', {
        method: 'POST',
        headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
      });
    } catch (err) {
      handleSheetsAuthError(err);
    } finally {
      setIsSyncing(false);
    }
  };

  const handleCreateAssignment = async (
    payload: Partial<Assignment>,
    waTargetMode: WhatsAppTargetMode
  ): Promise<WhatsAppNotificationLog | null> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        assignment: Assignment;
        notification: WhatsAppNotificationLog;
        state: AppStateResponse;
      }>('/api/assignments', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': REALTIME_CLIENT_ID,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menerbitkan Surat Tugas',
          res.errorMessage || 'Gagal menerbitkan Surat Tugas.'
        );
        return null;
      }
      const data = res.data;
      const notif = data.notification;

      applyIncomingState(data.state);

      let targetUrl = '';
      if (notif && data.assignment) {
        const built = buildRealtimeWhatsAppUrlForAssignment(
          data.assignment,
          waTargetMode,
          data.state?.config?.whatsappGroupName,
          data.state?.config?.dispatcherWaPhone,
          notif.eventType
        );
        targetUrl = built.url;
        launchWhatsAppUrl(targetUrl);
      }

      addToast(
        'success',
        'Surat Tugas Diterbitkan & Tersimpan Permanen',
        `Nomor ${data.assignment.noPenugasan} berhasil disimpan ke Cloud & Spreadsheet.`,
        targetUrl
          ? { actionLabel: 'Buka WhatsApp', actionHref: targetUrl }
          : undefined
      );

      void (async () => {
        try {
          if (googleUser?.emailVerified) {
            const customPin = getSavedCustomPin() || undefined;
            await runCloudTask(async () => {
              await upsertAssignmentInFirestore(googleUser, data.assignment);
              await upsertConfigInFirestore(
                googleUser,
                data.state.config,
                customPin
              );
              for (const veh of data.state.vehicles) {
                await upsertVehicleInFirestore(googleUser, veh);
              }
            });
          }
          await pushToSheetsIfActive('assignments', data.state);
        } catch {
          // Handled via server bridge / next background sync
        }
      })();

      return notif;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menyimpan Surat Tugas.');
      return null;
    }
  };

  const handleUpdateAssignment = async (
    id: string,
    payload: Partial<Assignment> & {
      kmAwal?: number | '';
      suhuAwal?: string;
      kmAkhir?: number | '';
      suhuAkhir?: string;
      penerimaNama?: string;
    }
  ): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        assignment: Assignment;
        state: AppStateResponse;
      }>(`/api/assignments/${encodeURIComponent(id)}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': REALTIME_CLIENT_ID,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Memperbarui Surat Tugas',
          res.errorMessage || 'Gagal memperbarui Surat Tugas.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state, {
        explicitAssignment: data.assignment,
      });

      if (googleUser?.emailVerified) {
        void runCloudTask(async () => {
          await upsertAssignmentInFirestore(googleUser, data.assignment);
          for (const veh of data.state.vehicles) {
            await upsertVehicleInFirestore(googleUser, veh);
          }
        });
      }

      await pushToSheetsIfActive('assignments', data.state);
      addToast(
        'success',
        'Surat Tugas Diperbarui',
        `${data.assignment.noPenugasan} telah diperbarui secara real-time.`
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal memperbarui Surat Tugas.');
      return false;
    }
  };

  const handleDeleteAssignment = async (id: string): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(`/api/assignments/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menghapus Surat Tugas',
          res.errorMessage || 'Gagal menghapus Surat Tugas.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(async () => {
          await deleteAssignmentFromFirestore(googleUser, id);
          for (const veh of data.state.vehicles) {
            await upsertVehicleInFirestore(googleUser, veh);
          }
        });
      }

      await pushToSheetsIfActive('assignments', data.state, true);
      addToast(
        'success',
        'Surat Tugas Dihapus',
        'Data telah dihapus dari sistem & cloud.'
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menghapus Surat Tugas.');
      return false;
    }
  };

  const handleSaveDriver = async (
    mode: 'create' | 'edit',
    originalId: string,
    driver: DriverMaster
  ): Promise<boolean> => {
    try {
      const url =
        mode === 'create'
          ? '/api/master/drivers'
          : `/api/master/drivers/${encodeURIComponent(originalId)}`;
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(driver),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menyimpan Driver',
          res.errorMessage || 'Gagal menyimpan Driver.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() =>
          upsertDriverInFirestore(
            googleUser,
            driver,
            mode === 'edit' ? originalId : undefined
          )
        );
      }

      await pushToSheetsIfActive('drivers', data.state, false);
      addToast(
        'success',
        mode === 'create' ? 'Driver Ditambahkan' : 'Driver Diperbarui',
        `${driver.id} — ${driver.name} tersinkronisasi.`
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menyimpan Master Driver.');
      return false;
    }
  };

  const handleDeleteDriver = async (id: string): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(`/api/master/drivers/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menghapus Driver',
          res.errorMessage || 'Gagal menghapus Driver.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() => deleteDriverFromFirestore(googleUser, id));
      }

      await pushToSheetsIfActive('drivers', data.state, true);
      addToast('success', 'Driver Dihapus', `ID Driver ${id} telah dihapus.`);
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menghapus Master Driver.');
      return false;
    }
  };

  const handleSaveVehicle = async (
    mode: 'create' | 'edit',
    originalId: string,
    vehicle: VehicleMaster
  ): Promise<boolean> => {
    try {
      const url =
        mode === 'create'
          ? '/api/master/vehicles'
          : `/api/master/vehicles/${encodeURIComponent(originalId)}`;
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(vehicle),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menyimpan Armada',
          res.errorMessage || 'Gagal menyimpan Armada.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() =>
          upsertVehicleInFirestore(
            googleUser,
            vehicle,
            mode === 'edit' ? originalId : undefined
          )
        );
      }

      await pushToSheetsIfActive('vehicles', data.state, false);
      addToast(
        'success',
        mode === 'create' ? 'Armada Ditambahkan' : 'Armada Diperbarui',
        `${vehicle.plateNumber} tersinkronisasi.`
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menyimpan Master Armada.');
      return false;
    }
  };

  const handleDeleteVehicle = async (id: string): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(`/api/master/vehicles/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menghapus Armada',
          res.errorMessage || 'Gagal menghapus Armada.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() => deleteVehicleFromFirestore(googleUser, id));
      }

      await pushToSheetsIfActive('vehicles', data.state, true);
      addToast('success', 'Armada Dihapus', `Unit ${id} telah dihapus.`);
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menghapus Master Armada.');
      return false;
    }
  };

  const handleSaveRoute = async (
    mode: 'create' | 'edit',
    originalId: string,
    route: RouteMaster
  ): Promise<boolean> => {
    try {
      const url =
        mode === 'create'
          ? '/api/master/routes'
          : `/api/master/routes/${encodeURIComponent(originalId)}`;
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(route),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menyimpan Rute',
          res.errorMessage || 'Gagal menyimpan Rute.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() =>
          upsertRouteInFirestore(
            googleUser,
            route,
            mode === 'edit' ? originalId : undefined
          )
        );
      }

      await pushToSheetsIfActive('routes', data.state, false);
      addToast(
        'success',
        mode === 'create' ? 'Rute Ditambahkan' : 'Rute Diperbarui',
        `${route.destination} tersinkronisasi.`
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menyimpan Master Rute.');
      return false;
    }
  };

  const handleDeleteRoute = async (id: string): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(`/api/master/routes/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menghapus Rute',
          res.errorMessage || 'Gagal menghapus Rute.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() => deleteRouteFromFirestore(googleUser, id));
      }

      await pushToSheetsIfActive('routes', data.state, true);
      addToast('success', 'Rute Dihapus', `Kode Rute ${id} telah dihapus.`);
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menghapus Master Rute.');
      return false;
    }
  };

  const handleSaveFleetCard = async (
    mode: 'create' | 'edit',
    originalId: string,
    card: FleetCardMaster
  ): Promise<boolean> => {
    try {
      const url =
        mode === 'create'
          ? '/api/master/fleet-cards'
          : `/api/master/fleet-cards/${encodeURIComponent(originalId)}`;
      const res = await safeApiFetch<{
        error?: string;
        fleetCard?: FleetCardMaster;
        state: AppStateResponse;
      }>(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': REALTIME_CLIENT_ID,
        },
        body: JSON.stringify(card),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menyimpan Fleet Card',
          res.errorMessage || 'Gagal menyimpan Master Kartu Fleet Card.'
        );
        return false;
      }
      const data = res.data;
      const savedCard = data.fleetCard || card;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() =>
          upsertFleetCardInFirestore(
            googleUser,
            savedCard,
            mode === 'edit' ? originalId : undefined
          )
        );
      }

      await pushToSheetsIfActive('fleetCards', data.state, false);
      addToast(
        'success',
        mode === 'create'
          ? 'Kartu Fleet Card Ditambahkan'
          : 'Kartu Fleet Card Diperbarui',
        `Kartu ${savedCard.cardNumber} (${savedCard.id}) tersinkronisasi.`
      );
      return true;
    } catch {
      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal menyimpan Master Kartu Fleet Card.'
      );
      return false;
    }
  };

  const handleTopUpFleetCard = async (
    id: string,
    addAmount: number
  ): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        fleetCard?: FleetCardMaster;
        state: AppStateResponse;
      }>(`/api/master/fleet-cards/${encodeURIComponent(id)}/topup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': REALTIME_CLIENT_ID,
        },
        body: JSON.stringify({ addAmount }),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menambah Saldo Fleet Card',
          res.errorMessage || 'Gagal menambah saldo Fleet Card.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      const updatedCard =
        data.fleetCard ||
        data.state.fleetCards.find(
          (fc) => fc.id.toLowerCase() === id.toLowerCase()
        );
      if (googleUser?.emailVerified && updatedCard) {
        void runCloudTask(() =>
          upsertFleetCardInFirestore(googleUser, updatedCard)
        );
      }

      await pushToSheetsIfActive('fleetCards', data.state, false);
      addToast(
        'success',
        'Saldo Fleet Card Ditambahkan',
        `Top-up berhasil pada kartu ${updatedCard?.cardNumber || id}.`
      );
      return true;
    } catch {
      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal menambah saldo Fleet Card.'
      );
      return false;
    }
  };

  const handleUpdateFleetCardBalance = async (
    id: string,
    newBalance: number
  ): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        fleetCard?: FleetCardMaster;
        state: AppStateResponse;
      }>(`/api/master/fleet-cards/${encodeURIComponent(id)}/balance`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': REALTIME_CLIENT_ID,
        },
        body: JSON.stringify({ balance: newBalance }),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Update Saldo Fleet Card',
          res.errorMessage || 'Gagal memperbarui saldo Fleet Card.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      const updatedCard =
        data.fleetCard ||
        data.state.fleetCards.find(
          (fc) => fc.id.toLowerCase() === id.toLowerCase()
        );
      if (googleUser?.emailVerified && updatedCard) {
        void runCloudTask(() =>
          upsertFleetCardInFirestore(googleUser, updatedCard)
        );
      }

      await pushToSheetsIfActive('fleetCards', data.state, false);
      addToast(
        'success',
        'Saldo Fleet Card Diperbarui',
        `Saldo kartu ${updatedCard?.cardNumber || id} berhasil diperbarui.`
      );
      return true;
    } catch {
      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal memperbarui saldo Fleet Card.'
      );
      return false;
    }
  };

  const handleDeleteFleetCard = async (id: string): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(`/api/master/fleet-cards/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menghapus Fleet Card',
          res.errorMessage || 'Gagal menghapus Fleet Card.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() => deleteFleetCardFromFirestore(googleUser, id));
      }

      await pushToSheetsIfActive('fleetCards', data.state, true);
      addToast(
        'success',
        'Fleet Card Dihapus',
        `Kartu Fleet Card ${id} telah dihapus.`
      );
      return true;
    } catch {
      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal menghapus Master Kartu Fleet Card.'
      );
      return false;
    }
  };

  const handleSaveAdminView = async (
    mode: 'create' | 'edit',
    originalId: string,
    adminView: AdminViewMaster
  ): Promise<boolean> => {
    try {
      const url =
        mode === 'create'
          ? '/api/master/admin-views'
          : `/api/master/admin-views/${encodeURIComponent(originalId)}`;
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(url, {
        method: mode === 'create' ? 'POST' : 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(adminView),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menyimpan Admin View',
          res.errorMessage || 'Gagal menyimpan Master Admin View.'
        );
        return false;
      }
      applyIncomingState(res.data.state);
      addToast(
        'success',
        mode === 'create' ? 'Admin View Ditambahkan' : 'Admin View Diperbarui',
        `${adminView.id} — ${adminView.name} tersimpan di Master Admin View.`
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menyimpan Master Admin View.');
      return false;
    }
  };

  const handleChangeAdminViewPin = async (
    id: string,
    newPin: string
  ): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(`/api/master/admin-views/${encodeURIComponent(id)}/pin`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: newPin }),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Mengubah PIN',
          res.errorMessage || 'Gagal mengubah PIN Admin View.'
        );
        return false;
      }
      applyIncomingState(res.data.state);
      addToast(
        'success',
        'PIN Admin View Berhasil Diubah',
        `PIN untuk ${id} berhasil diperbarui oleh Dispatcher.`
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal memperbarui PIN Admin View.');
      return false;
    }
  };

  const handleDeleteAdminView = async (id: string): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(`/api/master/admin-views/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menghapus Admin View',
          res.errorMessage || 'Gagal menghapus Admin View.'
        );
        return false;
      }
      applyIncomingState(res.data.state);
      addToast(
        'success',
        'Admin View Dihapus',
        `Akun Admin View ${id} telah dihapus dari Master Data.`
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menghapus Master Admin View.');
      return false;
    }
  };

  const handleSubmitDriverExpense = async (
    payload: DriverExpenseSubmitPayload
  ): Promise<boolean> => {
    const activeDriver = loggedInDriverRef.current;
    if (!activeDriver) {
      addToast(
        'error',
        'Sesi Driver Tidak Ditemukan',
        'Silakan masuk kembali ke Portal Driver.'
      );
      return false;
    }

    const driverUid = getSavedDriverUidFallback(activeDriver.id);
    const nowIso = new Date().toISOString();
    const clientExpenseId = `EXP-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;
    const totalPengirimanBbm = Math.max(
      0,
      Number(payload.totalPengirimanBbm) || 0
    );
    const totalPengeluaranTol = Math.max(
      0,
      Number(payload.totalPengeluaranTol) || 0
    );
    const totalPengeluaran = totalPengirimanBbm + totalPengeluaranTol;

    const buildOptimisticExpenseState = (): {
      createdExpense: DriverExpense;
      latestState: AppStateResponse;
    } => {
      const createdExpense: DriverExpense = {
        id: clientExpenseId,
        timestamp: nowIso,
        tanggal: nowIso.slice(0, 10),
        tanggalPengiriman: payload.tanggalPengiriman || nowIso.slice(0, 10),
        tujuanPengiriman: payload.tujuanPengiriman || '',
        driverId: activeDriver.id,
        driverName: activeDriver.name,
        plateNumber: payload.plateNumber || '',
        completedAssignmentNos: payload.completedAssignmentNos || '',
        fleetCardId: payload.fleetCardId || '',
        fleetCardNumber: payload.fleetCardNumber,
        totalPengirimanBbm,
        fotoStrukBbm: payload.fotoStrukBbm,
        totalPengeluaranTol,
        fotoStrukTol: payload.fotoStrukTol,
        totalPengeluaran,
        catatan: payload.catatan || '',
        submittedByDriverUid: driverUid,
        needsSheetSync: true,
      };
      const updatedCards = (appStateRef.current.fleetCards || []).map((fc) => {
        const matched =
          (payload.fleetCardId &&
            fc.id.toLowerCase() === payload.fleetCardId.toLowerCase()) ||
          fc.cardNumber.trim().toLowerCase() ===
            payload.fleetCardNumber.trim().toLowerCase();
        if (!matched) return fc;
        return {
          ...fc,
          balance: fc.balance - totalPengeluaran,
          updatedAt: nowIso,
          needsSheetSync: true,
        };
      });
      const latestState: AppStateResponse = {
        ...appStateRef.current,
        fleetCards: updatedCards,
        driverExpenses: [
          createdExpense,
          ...(appStateRef.current.driverExpenses || []).filter(
            (e) => e.id !== clientExpenseId
          ),
        ],
      };
      return { createdExpense, latestState };
    };

    const matchedFleetCardSnapshot = (appStateRef.current.fleetCards || []).find(
      (fc) =>
        (payload.fleetCardId &&
          fc.id.toLowerCase() === payload.fleetCardId.toLowerCase()) ||
        fc.cardNumber.trim().toLowerCase() ===
          payload.fleetCardNumber.trim().toLowerCase()
    );
    const activeConfigSnap = getActiveConfigSnapshot();

    try {
      const res = await safeApiFetch<{
        error?: string;
        expense?: DriverExpense;
        state?: AppStateResponse;
      }>(
        '/api/driver-expenses',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': REALTIME_CLIENT_ID,
          },
          body: JSON.stringify({
            ...payload,
            id: clientExpenseId,
            timestamp: nowIso,
            driverId: activeDriver.id,
            driverName: activeDriver.name,
            submittedByDriverUid: driverUid,
            fleetCardSnapshot: matchedFleetCardSnapshot,
            configSnapshot: activeConfigSnap,
          }),
        },
        1,
        10000
      );

      let latestState: AppStateResponse;
      let createdExpense: DriverExpense;
      let queuedForWakeup = false;

      if (res.ok && res.data?.state && res.data?.expense) {
        removePendingDriverExpense(clientExpenseId);
        latestState = {
          ...res.data.state,
          driverExpenses: res.data.state.driverExpenses.map((exp) =>
            exp.id === res.data!.expense!.id
              ? {
                  ...exp,
                  fotoStrukBbm: payload.fotoStrukBbm || exp.fotoStrukBbm,
                  fotoStrukTol: payload.fotoStrukTol || exp.fotoStrukTol,
                }
              : exp
          ),
        };
        createdExpense = {
          ...res.data.expense,
          fotoStrukBbm: payload.fotoStrukBbm || res.data.expense.fotoStrukBbm,
          fotoStrukTol: payload.fotoStrukTol || res.data.expense.fotoStrukTol,
        };
      } else if (!res.ok && !res.isHtmlResponse && !res.networkFailed) {
        addToast(
          'error',
          'Gagal Melaporkan Pengeluaran',
          res.errorMessage || 'Periksa kembali data pengeluaran Anda.'
        );
        return false;
      } else {
        // Resilient fallback if server is hibernating or mobile network returned proxy HTML
        const built = buildOptimisticExpenseState();
        createdExpense = built.createdExpense;
        latestState = built.latestState;
        const bridgedOk = await pushDriverMutationViaBrowserBridge({
          appsScriptUrl: activeConfigSnap.appsScriptUrl,
          spreadsheetId: activeConfigSnap.spreadsheetId,
          createdExpense,
        });
        if (!bridgedOk) {
          enqueuePendingDriverExpense(createdExpense);
          queuedForWakeup = true;
        }
      }

      applyIncomingState(latestState);

      const fsUser = auth.currentUser || googleUserRef.current;
      if (fsUser) {
        const matchedCard = latestState.fleetCards.find(
          (fc) =>
            (createdExpense.fleetCardId &&
              fc.id.toLowerCase() ===
                createdExpense.fleetCardId.toLowerCase()) ||
            fc.cardNumber.trim().toLowerCase() ===
              createdExpense.fleetCardNumber.trim().toLowerCase()
        );
        void runCloudTask(async () => {
          await upsertDriverExpenseInFirestore(fsUser, createdExpense);
          if (matchedCard && fsUser.emailVerified) {
            await upsertFleetCardInFirestore(fsUser, matchedCard);
          }
        });
      }

      if (!queuedForWakeup && getAccessToken()) {
        void handleSyncPhotosToDrive({
          silent: true,
          explicitSpreadsheetId: latestState.config.spreadsheetId,
        });
        void pushToSheetsIfActive('driverExpenses', latestState, false);
        void pushToSheetsIfActive('fleetCards', latestState, false);
      }

      addToast(
        queuedForWakeup ? 'info' : 'success',
        queuedForWakeup
          ? 'Laporan Pengeluaran Aman Tersimpan di HP'
          : 'Laporan Pengeluaran Berhasil Disimpan',
        queuedForWakeup
          ? `Kartu ${createdExpense.fleetCardNumber} tercatat di HP & otomatis tersinkron ke Admin begitu server aktif kembali.`
          : `Pengeluaran pada kartu ${createdExpense.fleetCardNumber} tercatat otomatis ke Pengeluaran_Driver.`
      );
      return true;
    } catch {
      const built = buildOptimisticExpenseState();
      const bridgedOk = await pushDriverMutationViaBrowserBridge({
        appsScriptUrl: activeConfigSnap.appsScriptUrl,
        spreadsheetId: activeConfigSnap.spreadsheetId,
        createdExpense: built.createdExpense,
      });
      if (!bridgedOk) {
        enqueuePendingDriverExpense(built.createdExpense);
      }
      applyIncomingState(built.latestState);
      addToast(
        bridgedOk ? 'success' : 'info',
        bridgedOk
          ? 'Laporan Pengeluaran Berhasil Disimpan'
          : 'Laporan Pengeluaran Aman Tersimpan di HP',
        bridgedOk
          ? `Pengeluaran kartu ${built.createdExpense.fleetCardNumber} berhasil tersimpan langsung ke Database Spreadsheet.`
          : `Koneksi terganggu. Pengeluaran kartu ${built.createdExpense.fleetCardNumber} tersimpan di HP dan otomatis dikirim saat server aktif.`
      );
      return true;
    }
  };

  const handleDeleteDriverExpense = async (id: string): Promise<boolean> => {
    try {
      const targetExp = (appStateRef.current.driverExpenses || []).find(
        (e) => e.id === id
      );
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>(`/api/driver-expenses/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menghapus Pengeluaran',
          res.errorMessage || 'Gagal menghapus data pengeluaran Driver.'
        );
        return false;
      }
      const data = res.data;
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(async () => {
          await deleteDriverExpenseFromFirestore(googleUser, id);
          if (targetExp) {
            const restoredCard = data.state.fleetCards.find(
              (fc) =>
                (targetExp.fleetCardId &&
                  fc.id.toLowerCase() ===
                    targetExp.fleetCardId.toLowerCase()) ||
                fc.cardNumber.trim().toLowerCase() ===
                  targetExp.fleetCardNumber.trim().toLowerCase()
            );
            if (restoredCard) {
              await upsertFleetCardInFirestore(googleUser, restoredCard);
            }
          }
        });
      }

      await pushToSheetsIfActive('driverExpenses', data.state, true);
      await pushToSheetsIfActive('fleetCards', data.state, false);
      addToast(
        'success',
        'Data Pengeluaran Dihapus',
        `Laporan ${id} dihapus & saldo kartu Fleet Card telah disesuaikan kembali.`
      );
      return true;
    } catch {
      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal menghapus data pengeluaran Driver.'
      );
      return false;
    }
  };

  const handleSaveOperationalSettings = async (settings: {
    dispatcherWaPhone: string;
    whatsappTargetMode: WhatsAppTargetMode;
    whatsappGroupName: string;
    whatsappGroupInviteUrl: string;
    letterPrefix: string;
    publicPortalBaseUrl?: string;
  }): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        adminPin?: string;
        state: AppStateResponse;
      }>('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menyimpan Pengaturan',
          res.errorMessage || 'Gagal menyimpan pengaturan.'
        );
        return false;
      }
      const data = res.data;
      if (data.adminPin && data.adminPin !== '123456') {
        persistCustomPinLocally(data.adminPin);
      }
      setCustomDriverPortalBaseUrl(data.state.config?.publicPortalBaseUrl);
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        const customPin =
          (data.adminPin && data.adminPin !== '123456'
            ? data.adminPin
            : getSavedCustomPin()) || undefined;
        void runCloudTask(() =>
          upsertConfigInFirestore(googleUser, data.state.config, customPin)
        );
      }

      const sheetId = extractSpreadsheetId(data.state.config.spreadsheetId);
      const token = sheetId ? await ensureValidAccessToken() : null;
      if (token && sheetId) {
        await pushConfigToSpreadsheet(token, sheetId, {
          adminPin: data.adminPin || getSavedCustomPin() || '123456',
          dispatcherWaPhone: settings.dispatcherWaPhone,
          whatsappTargetMode: settings.whatsappTargetMode,
          whatsappGroupName: settings.whatsappGroupName,
          whatsappGroupInviteUrl: settings.whatsappGroupInviteUrl,
          letterPrefix: settings.letterPrefix,
          publicPortalBaseUrl:
            settings.publicPortalBaseUrl ??
            data.state.config.publicPortalBaseUrl,
          appsScriptUrl: data.state.config.appsScriptUrl,
          driveRootFolderId: data.state.config.driveRootFolderId,
          driveRootFolderUrl: data.state.config.driveRootFolderUrl,
        });
      }

      addToast(
        'success',
        'Pengaturan Disimpan',
        'Konfigurasi operasional berhasil diperbarui.'
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal menyimpan pengaturan.');
      return false;
    }
  };

  const handleSaveAppsScriptUrl = async (urlInput: string): Promise<boolean> => {
    const cleanUrl = urlInput.trim();
    if (cleanUrl && !/^https:\/\/script\.google\.com\/macros\/s\//i.test(cleanUrl)) {
      addToast(
        'error',
        'URL Web App Tidak Valid',
        'Masukkan URL Deployment Google Apps Script berakhiran /exec (https://script.google.com/macros/s/.../exec).'
      );
      return false;
    }

    try {
      setIsSyncing(true);
      const res = await safeApiFetch<{
        error?: string;
        adminPin?: string;
        state: AppStateResponse;
      }>('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appsScriptUrl: cleanUrl,
          resetLocalCache: false,
        }),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Menyimpan Bridge Permanen',
          res.errorMessage || 'Gagal menyimpan URL Google Apps Script.'
        );
        return false;
      }

      let latestState = res.data.state;
      applyIncomingState(latestState);

      const sheetId = extractSpreadsheetId(latestState.config.spreadsheetId);
      const token = sheetId ? await ensureValidAccessToken() : null;
      if (token && sheetId) {
        try {
          await pushConfigToSpreadsheet(token, sheetId, {
            adminPin: res.data.adminPin || getSavedCustomPin() || '123456',
            dispatcherWaPhone: latestState.config.dispatcherWaPhone,
            whatsappTargetMode: latestState.config.whatsappTargetMode,
            whatsappGroupName: latestState.config.whatsappGroupName,
            whatsappGroupInviteUrl: latestState.config.whatsappGroupInviteUrl,
            letterPrefix: latestState.config.letterPrefix,
            publicPortalBaseUrl: latestState.config.publicPortalBaseUrl,
            appsScriptUrl: cleanUrl,
            driveRootFolderId: latestState.config.driveRootFolderId,
            driveRootFolderUrl: latestState.config.driveRootFolderUrl,
          });
        } catch {
          // Bridge auto-sync below will also write Konfigurasi
        }
      }

      if (cleanUrl && sheetId) {
        const verifySync = await safeApiFetch<{
          success?: boolean;
          hasSheetDeletionsToPrune?: boolean;
          state?: AppStateResponse;
        }>('/api/sheets/auto-sync', {
          method: 'POST',
          headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
        });
        if (verifySync.ok && verifySync.data?.state) {
          latestState = verifySync.data.state;
          applyIncomingState(latestState);
          if (googleUser?.emailVerified) {
            const customPin = getSavedCustomPin() || undefined;
            void runCloudTask(() =>
              reconcileFullStateToFirestore(
                googleUser,
                latestState,
                Boolean(verifySync.data?.hasSheetDeletionsToPrune),
                customPin
              )
            );
          }
        }
      }

      const bridgeStatus = latestState.config.appsScriptBridgeStatus;
      addToast(
        !cleanUrl || bridgeStatus === 'ACTIVE' ? 'success' : 'info',
        !cleanUrl
          ? 'Bridge Apps Script Dinonaktifkan'
          : bridgeStatus === 'ACTIVE'
          ? 'Sinkronisasi Permanen 24/7 Aktif'
          : bridgeStatus === 'NEEDS_SCRIPT_UPDATE'
          ? 'URL Tersimpan · Perbarui Isi Kode.gs'
          : 'URL Tersimpan · Periksa Izin Akses Deployment',
        !cleanUrl
          ? 'URL Google Apps Script telah dihapus dari konfigurasi.'
          : bridgeStatus === 'ACTIVE'
          ? 'Aplikasi dan Google Spreadsheet kini tersinkronisasi dua arah otomatis secara permanen tanpa perlu sinkron ulang.'
          : bridgeStatus === 'NEEDS_SCRIPT_UPDATE'
          ? 'Izin Siapa saja sudah aktif, namun Kode.gs masih versi lama. Salin Kode Apps Script terbaru lalu Deploy -> Kelola deployment -> Edit -> Versi baru.'
          : 'URL tersimpan. Pastikan izin Who has access disetel ke Siapa saja (Anyone).'
      );
      return true;
    } catch {
      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal mengaktifkan Bridge Google Apps Script.'
      );
      return false;
    } finally {
      setIsSyncing(false);
    }
  };

  const handleTestWhatsAppNetwork = async (targetPhone: string) => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        state: AppStateResponse;
      }>('/api/whatsapp/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetPhone }),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Uji WhatsApp Gagal',
          res.errorMessage || 'Uji WhatsApp gagal.'
        );
        return;
      }
      applyIncomingState(res.data.state);
      addToast(
        'success',
        'Pesan Uji WhatsApp Siap',
        'Klik tombol Kirim ke Grup WA atau WA Nomor pada riwayat di bawah.'
      );
    } catch {
      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal membuat pesan uji WhatsApp.'
      );
    }
  };

  const handleChangeAdminPin = async (
    currentPin: string,
    newPin: string
  ): Promise<boolean> => {
    try {
      const res = await safeApiFetch<{
        error?: string;
        adminPin?: string;
        state: AppStateResponse;
      }>('/api/admin/pin', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPin, newPin }),
      });
      if (!res.ok || !res.data?.state) {
        addToast(
          'error',
          'Gagal Mengubah PIN',
          res.errorMessage || 'Gagal mengubah PIN.'
        );
        return false;
      }
      const data = res.data;

      const effectiveNewPin = String(data.adminPin || newPin).trim();
      persistCustomPinLocally(effectiveNewPin);
      applyIncomingState(data.state);

      if (googleUser?.emailVerified) {
        void runCloudTask(() =>
          upsertConfigInFirestore(
            googleUser,
            data.state.config,
            effectiveNewPin
          )
        );
      }

      const sheetId = extractSpreadsheetId(data.state.config.spreadsheetId);
      const token = sheetId ? await ensureValidAccessToken() : null;
      if (token && sheetId) {
        await pushConfigToSpreadsheet(token, sheetId, {
          adminPin: effectiveNewPin,
          dispatcherWaPhone: data.state.config.dispatcherWaPhone,
          whatsappTargetMode: data.state.config.whatsappTargetMode,
          whatsappGroupName: data.state.config.whatsappGroupName,
          whatsappGroupInviteUrl: data.state.config.whatsappGroupInviteUrl,
          letterPrefix: data.state.config.letterPrefix,
          publicPortalBaseUrl: data.state.config.publicPortalBaseUrl,
        });
      }

      addToast(
        'success',
        'PIN Admin Dispatcher Tersimpan Permanen',
        'PIN baru Anda telah aktif secara permanen dan tidak akan kembali ke PIN Default.'
      );
      return true;
    } catch {
      addToast('error', 'Kesalahan Jaringan', 'Gagal memperbarui PIN Admin.');
      return false;
    }
  };

  const handleDriverDeparture = async (
    assignmentId: string,
    payload: {
      titikKeberangkatan: string;
      jenisKendaraan: VehicleCoolingType;
      kmAwal: number;
      suhuAwal: string;
      bbmAwal: string;
      kondisiKendaraan: string;
      catatanBerangkat: string;
      fotoOdometerBerangkat?: string;
      fotoSuhuBerangkat?: string;
    },
    waTargetMode: WhatsAppTargetMode,
    autoOpenWa = true,
    explicitSnapshot?: Assignment,
    syncMeta?: DriverSubmitSyncMeta
  ): Promise<WhatsAppNotificationLog | null> => {
    const assignmentSnapshot =
      syncMeta?.resolvedAssignment ||
      explicitSnapshot ||
      appStateRef.current.assignments.find((a) => a.id === assignmentId);
    const fallbackDriverUid = getSavedDriverUidFallback(
      assignmentSnapshot?.driverCode ||
        loggedInDriver?.id ||
        assignmentSnapshot?.driverId
    );

    try {
      // 1. Bounded non-blocking token warmup (never stalls mobile report submission)
      if (!syncMeta?.firestoreAlreadySynced && auth.currentUser) {
        await warmAuthTokenNonBlocking(700);
      }

      const activeConfigSnap = getActiveConfigSnapshot();
      const res = await safeApiFetch<{
        error?: string;
        assignment: Assignment;
        notification: WhatsAppNotificationLog;
        state: AppStateResponse;
      }>(
        `/api/assignments/${encodeURIComponent(assignmentId)}/departure`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': REALTIME_CLIENT_ID,
          },
          body: JSON.stringify({
            ...payload,
            submittedByDriverUid: fallbackDriverUid,
            assignmentSnapshot,
            configSnapshot: activeConfigSnap,
          }),
        },
        0,
        6000
      );
      if (!res.ok || !res.data?.state) {
        if (
          res.isHtmlResponse ||
          res.networkFailed ||
          syncMeta?.firestoreAlreadySynced ||
          syncMeta?.firestoreQueuedInPortal
        ) {
          throw new Error(
            res.errorMessage || 'Server sementara tidak terjangkau'
          );
        }
        addToast(
          'error',
          'Gagal Mengirim Data Keberangkatan',
          res.errorMessage || 'Gagal mengirim data keberangkatan.'
        );
        return null;
      }
      const data = res.data;
      removePendingReportSyncItem(`${assignmentId}__KEBERANGKATAN`);
      clearPerAssignmentPendingSyncRecord(assignmentId);

      const notif = data.notification as WhatsAppNotificationLog;
      let targetUrl = '';
      let freshMessage = notif?.message || '';
      if (notif && data.assignment) {
        notifiedDriverWaIdsRef.current.add(notif.id);
        const built = buildRealtimeWhatsAppUrlForAssignment(
          {
            ...data.assignment,
            driverPhone:
              loggedInDriver?.phone || data.assignment.driverPhone || '',
          },
          waTargetMode,
          data.state?.config?.whatsappGroupName,
          data.state?.config?.dispatcherWaPhone,
          'KEBERANGKATAN'
        );
        targetUrl = built.url;
        freshMessage = built.message;
        if (autoOpenWa) {
          launchWhatsAppUrl(targetUrl);
        }
      }

      applyIncomingState(data.state, {
        explicitAssignment: data.assignment,
      });

      const exactDriverCode =
        assignmentSnapshot?.driverCode ||
        assignmentSnapshot?.driverId ||
        fallbackDriverUid;

      // Sync to Firestore in background without blocking UI
      if (data.assignment) {
        if (syncMeta?.firestoreAlreadySynced) {
          if (googleUser?.emailVerified) {
            void runCloudTask(async () => {
              for (const veh of (data.state as AppStateResponse).vehicles) {
                await upsertVehicleInFirestore(googleUser, veh);
              }
            });
          }
        } else {
          void submitDriverReportToFirestore({
            assignment: {
              ...data.assignment,
              driverCode:
                data.assignment.driverCode ||
                exactDriverCode ||
                data.assignment.driverId,
              ownerUid: data.assignment.ownerUid || assignmentSnapshot?.ownerUid,
            },
            stage: 'KEBERANGKATAN',
            serverSynced: true,
            skipQueueOnFailure: true,
            departurePayload: payload,
          }).then((fsSync) => {
            if (fsSync.syncedToFirestore && googleUser?.emailVerified) {
              void runCloudTask(async () => {
                for (const veh of (data.state as AppStateResponse).vehicles) {
                  await upsertVehicleInFirestore(googleUser, veh);
                }
              });
            }
          });
        }
      }

      addToast(
        'success',
        autoOpenWa
          ? 'Keberangkatan Tersimpan — Siap Kirim WhatsApp'
          : 'Data Keberangkatan Tersimpan Real-Time',
        waTargetMode === 'GROUP'
          ? 'Notifikasi keberangkatan real-time siap dikirim ke Grup WhatsApp.'
          : waTargetMode === 'DRIVER'
          ? 'Notifikasi WhatsApp real-time siap dikirim ke nomor Driver.'
          : 'Notifikasi WhatsApp real-time siap dikirim ke Dispatcher.',
        targetUrl
          ? { actionLabel: 'Buka WhatsApp', actionHref: targetUrl }
          : undefined
      );

      void (async () => {
        try {
          const token =
            googleUser || getAccessToken()
              ? await ensureValidAccessToken()
              : null;
          const sheetId = data.state.config.spreadsheetId;
          if (token) {
            const pendingPhotos = summarizeFleetPhotoDriveStats(
              data.state.assignments
            ).pendingPhotos;
            if (pendingPhotos > 0) {
              void handleSyncPhotosToDrive({
                silent: true,
                explicitAssignments: data.state.assignments,
                explicitSpreadsheetId: sheetId,
              });
            } else if (sheetId) {
              await pushAssignmentsToSpreadsheet(
                token,
                sheetId,
                data.state.assignments
              );
              await pushVehiclesToSpreadsheet(
                token,
                sheetId,
                data.state.vehicles
              );
              await fetch('/api/sync/mark-pushed', {
                method: 'POST',
                headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
              });
            }
          }
        } catch {
          // Will be pushed via server bridge / next background sync
        }
      })();

      return notif ? { ...notif, message: freshMessage } : null;
    } catch (error) {
      // Browser-direct Apps Script fallback + Pending Sync Queue when server/network fails on Driver phone
      if (assignmentSnapshot) {
        const nowIso = new Date().toISOString();
        const optimisticAssignment: Assignment = {
          ...assignmentSnapshot,
          origin: payload.titikKeberangkatan,
          status: TaskStatus.DALAM_PERJALANAN,
          departureData: {
            timestamp: nowIso,
            titikKeberangkatan: payload.titikKeberangkatan,
            jenisKendaraan: payload.jenisKendaraan,
            kmAwal: payload.kmAwal,
            suhuAwal: payload.suhuAwal,
            bbmAwal: payload.bbmAwal,
            kondisiKendaraan: payload.kondisiKendaraan,
            catatanBerangkat: payload.catatanBerangkat,
            fotoOdometerBerangkat: payload.fotoOdometerBerangkat,
            fotoSuhuBerangkat: payload.fotoSuhuBerangkat,
          },
          needsSheetSync: true,
        };

        const exactOfflineDriverCode =
          optimisticAssignment.driverCode ||
          optimisticAssignment.driverId ||
          fallbackDriverUid;

        // Immediately queue locally & update UI + open WhatsApp without blocking on slow mobile bridge
        enqueuePendingReportSync(
          {
            assignmentId,
            noPenugasan: optimisticAssignment.noPenugasan,
            driverId: optimisticAssignment.driverId,
            submittedByDriverUid: exactOfflineDriverCode,
            usedFallbackIdentity: !auth.currentUser,
            stage: 'KEBERANGKATAN',
            serverSynced: false,
            firestoreSynced: Boolean(syncMeta?.firestoreAlreadySynced),
            departurePayload: payload,
            assignmentSnapshot: {
              ...optimisticAssignment,
              driverCode: exactOfflineDriverCode,
            },
          },
          error
        );

        const nextAssignments = appStateRef.current.assignments.some(
          (a) => a.id === assignmentId
        )
          ? appStateRef.current.assignments.map((a) =>
              a.id === assignmentId ? optimisticAssignment : a
            )
          : [optimisticAssignment, ...appStateRef.current.assignments];
        applyIncomingState(
          {
            ...appStateRef.current,
            assignments: nextAssignments,
          },
          { explicitAssignment: optimisticAssignment }
        );

        const built = buildRealtimeWhatsAppUrlForAssignment(
          {
            ...optimisticAssignment,
            driverPhone:
              loggedInDriver?.phone || optimisticAssignment.driverPhone || '',
          },
          waTargetMode,
          appStateRef.current.config?.whatsappGroupName,
          appStateRef.current.config?.dispatcherWaPhone,
          'KEBERANGKATAN'
        );
        if (autoOpenWa && built.url) {
          launchWhatsAppUrl(built.url);
        }

        const activeConfigSnap = getActiveConfigSnapshot();
        void pushDriverMutationViaBrowserBridge({
          appsScriptUrl: activeConfigSnap.appsScriptUrl,
          spreadsheetId: activeConfigSnap.spreadsheetId,
          updatedAssignment: optimisticAssignment,
          updatedVehicleStatus: {
            vehicleId: optimisticAssignment.vehicleId,
            plateNumber: optimisticAssignment.plateNumber,
            status: 'Dalam Tugas',
          },
        }).then((bridgedOk) => {
          if (bridgedOk) {
            removePendingReportSyncItem(`${assignmentId}__KEBERANGKATAN`);
            clearPerAssignmentPendingSyncRecord(assignmentId);
          }
        });

        if (!syncMeta?.firestoreQueuedInPortal) {
          addToast(
            syncMeta?.firestoreAlreadySynced ? 'success' : 'info',
            syncMeta?.firestoreAlreadySynced
              ? 'Laporan Masuk ke Database Cloud'
              : 'Laporan Aman Tersimpan — Siap Kirim WhatsApp',
            syncMeta?.firestoreAlreadySynced
              ? 'Data keberangkatan telah tersimpan langsung di Firestore Database.'
              : 'Laporan disimpan di memori HP & otomatis disinkronkan ke Spreadsheet di latar belakang.',
            built.url
              ? { actionLabel: 'Buka WhatsApp', actionHref: built.url }
              : undefined
          );
        }

        return {
          id: `local-wa-${Date.now()}`,
          timestamp: nowIso,
          eventType: 'KEBERANGKATAN',
          noPenugasan: optimisticAssignment.noPenugasan,
          driverId: optimisticAssignment.driverId,
          driverName: optimisticAssignment.driverName,
          plateNumber: optimisticAssignment.plateNumber,
          targetPhone: optimisticAssignment.driverPhone || '',
          message: built.message,
          waDirectUrl: built.url,
          waGroupUrl: built.url,
          networkStatus: 'SIAP_GATEWAY',
          gatewayDetail: 'Tersimpan di memori lokal HP (Pending Sync Queue)',
        };
      }

      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal mengirim data keberangkatan.'
      );
      return null;
    }
  };

  const handleDriverDelivered = async (
    assignmentId: string,
    deliveredInput: DriverDeliveredSubmitPayload | string,
    waTargetMode: WhatsAppTargetMode,
    autoOpenWa = true,
    explicitSnapshot?: Assignment,
    syncMeta?: DriverSubmitSyncMeta
  ): Promise<WhatsAppNotificationLog | null> => {
    const assignmentSnapshot =
      syncMeta?.resolvedAssignment ||
      explicitSnapshot ||
      appStateRef.current.assignments.find((a) => a.id === assignmentId);
    const fallbackDriverUid = getSavedDriverUidFallback(
      assignmentSnapshot?.driverCode ||
        loggedInDriver?.id ||
        assignmentSnapshot?.driverId
    );

    const effectiveCooling: VehicleCoolingType =
      (typeof deliveredInput === 'object' && deliveredInput?.jenisKendaraan) ||
      assignmentSnapshot?.departureData?.jenisKendaraan ||
      'Mobil Pendingin';
    const isPendingin = effectiveCooling !== 'Non Pendingin';
    const deliveredPayload: DriverDeliveredSubmitPayload =
      typeof deliveredInput === 'string'
        ? {
            jenisKendaraan: effectiveCooling,
            kmSampai:
              assignmentSnapshot?.deliveredData?.kmSampai ??
              assignmentSnapshot?.departureData?.kmAwal ??
              0,
            suhuSampai: isPendingin
              ? assignmentSnapshot?.deliveredData?.suhuSampai ||
                assignmentSnapshot?.departureData?.suhuAwal ||
                ''
              : '',
            bbmSampai:
              assignmentSnapshot?.deliveredData?.bbmSampai || '1/2 Tangki',
            kondisiSampai:
              assignmentSnapshot?.deliveredData?.kondisiSampai ||
              (isPendingin
                ? 'Suhu & Segel Utuh - Lengkap'
                : 'Segel & Muatan Utuh - Lengkap'),
            catatanSampai: deliveredInput,
            fotoOdometerSampai:
              assignmentSnapshot?.deliveredData?.fotoOdometerSampai,
            fotoSuhuSampai: isPendingin
              ? assignmentSnapshot?.deliveredData?.fotoSuhuSampai
              : undefined,
          }
        : deliveredInput;

    try {
      if (!syncMeta?.firestoreAlreadySynced && auth.currentUser) {
        await warmAuthTokenNonBlocking(700);
      }

      const activeConfigSnap = getActiveConfigSnapshot();
      const res = await safeApiFetch<{
        error?: string;
        assignment: Assignment;
        notification: WhatsAppNotificationLog;
        state: AppStateResponse;
      }>(
        `/api/assignments/${encodeURIComponent(assignmentId)}/delivered`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': REALTIME_CLIENT_ID,
          },
          body: JSON.stringify({
            ...deliveredPayload,
            catatanTiba: deliveredPayload.catatanSampai,
            submittedByDriverUid: fallbackDriverUid,
            assignmentSnapshot,
            configSnapshot: activeConfigSnap,
          }),
        },
        0,
        6000
      );
      if (!res.ok || !res.data?.state) {
        if (
          res.isHtmlResponse ||
          res.networkFailed ||
          syncMeta?.firestoreAlreadySynced ||
          syncMeta?.firestoreQueuedInPortal
        ) {
          throw new Error(
            res.errorMessage || 'Server sementara tidak terjangkau'
          );
        }
        addToast(
          'error',
          'Gagal Menyimpan Data Delivered (Sampai)',
          res.errorMessage || 'Gagal menyimpan data Delivered.'
        );
        return null;
      }
      const data = res.data;
      removePendingReportSyncItem(`${assignmentId}__DELIVERED`);
      clearPerAssignmentPendingSyncRecord(assignmentId);

      const notif = data.notification as WhatsAppNotificationLog;
      let targetUrl = '';
      let freshMessage = notif?.message || '';
      if (notif && data.assignment) {
        notifiedDriverWaIdsRef.current.add(notif.id);
        const built = buildRealtimeWhatsAppUrlForAssignment(
          {
            ...data.assignment,
            driverPhone:
              loggedInDriver?.phone || data.assignment.driverPhone || '',
          },
          waTargetMode,
          data.state?.config?.whatsappGroupName,
          data.state?.config?.dispatcherWaPhone,
          'DELIVERED'
        );
        targetUrl = built.url;
        freshMessage = built.message;
        if (autoOpenWa) {
          launchWhatsAppUrl(targetUrl);
        }
      }

      applyIncomingState(data.state, {
        explicitAssignment: data.assignment,
      });

      if (data.assignment) {
        if (syncMeta?.firestoreAlreadySynced) {
          if (googleUser?.emailVerified) {
            void runCloudTask(async () => {
              for (const veh of (data.state as AppStateResponse).vehicles) {
                await upsertVehicleInFirestore(googleUser, veh);
              }
            });
          }
        } else {
          const exactDriverCode =
            assignmentSnapshot?.driverCode ||
            assignmentSnapshot?.driverId ||
            fallbackDriverUid;
          void submitDriverReportToFirestore({
            assignment: {
              ...data.assignment,
              driverCode:
                data.assignment.driverCode ||
                exactDriverCode ||
                data.assignment.driverId,
              ownerUid: data.assignment.ownerUid || assignmentSnapshot?.ownerUid,
            },
            stage: 'DELIVERED',
            serverSynced: true,
            skipQueueOnFailure: true,
            deliveredCatatan: deliveredPayload.catatanSampai,
            deliveredPayload,
          }).then((fsSync) => {
            if (fsSync.syncedToFirestore && googleUser?.emailVerified) {
              void runCloudTask(async () => {
                for (const veh of (data.state as AppStateResponse).vehicles) {
                  await upsertVehicleInFirestore(googleUser, veh);
                }
              });
            }
          });
        }
      }

      addToast(
        'success',
        autoOpenWa
          ? 'Data Delivered (Sampai) Tersimpan — Siap Kirim WA'
          : 'Data Delivered (Sampai) Tersimpan Real-Time',
        `Armada ${data.assignment.plateNumber} tercatat tiba di ${data.assignment.destination} dan siap lanjut Berita Acara Handover.`,
        targetUrl
          ? { actionLabel: 'Buka WhatsApp', actionHref: targetUrl }
          : undefined
      );

      void (async () => {
        try {
          const sheetId = data.state.config.spreadsheetId;
          const token =
            googleUser || getAccessToken()
              ? await ensureValidAccessToken()
              : null;
          if (token) {
            const pendingPhotos = summarizeFleetPhotoDriveStats(
              data.state.assignments
            ).pendingPhotos;
            if (pendingPhotos > 0) {
              void handleSyncPhotosToDrive({
                silent: true,
                explicitAssignments: data.state.assignments,
                explicitSpreadsheetId: sheetId,
              });
            } else if (sheetId) {
              await pushAssignmentsToSpreadsheet(
                token,
                sheetId,
                data.state.assignments
              );
              await fetch('/api/sync/mark-pushed', {
                method: 'POST',
                headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
              });
            }
          }
        } catch {
          // Will be pushed via server bridge / next background sync
        }
      })();

      return notif ? { ...notif, message: freshMessage } : null;
    } catch (error) {
      if (assignmentSnapshot) {
        const nowIso = new Date().toISOString();
        const optimisticAssignment: Assignment = {
          ...assignmentSnapshot,
          status: TaskStatus.DELIVERED,
          deliveredAt: nowIso,
          deliveredData: {
            timestamp: nowIso,
            jenisKendaraan: deliveredPayload.jenisKendaraan || effectiveCooling,
            kmSampai: deliveredPayload.kmSampai,
            suhuSampai: deliveredPayload.suhuSampai,
            bbmSampai: deliveredPayload.bbmSampai,
            kondisiSampai: deliveredPayload.kondisiSampai,
            catatanSampai: deliveredPayload.catatanSampai,
            fotoOdometerSampai: deliveredPayload.fotoOdometerSampai,
            fotoSuhuSampai: deliveredPayload.fotoSuhuSampai,
          },
          needsSheetSync: true,
        };

        const exactOfflineDriverCode =
          optimisticAssignment.driverCode ||
          optimisticAssignment.driverId ||
          fallbackDriverUid;

        // Immediately queue locally & update UI + open WhatsApp without blocking on slow mobile bridge
        enqueuePendingReportSync(
          {
            assignmentId,
            noPenugasan: optimisticAssignment.noPenugasan,
            driverId: optimisticAssignment.driverId,
            submittedByDriverUid: exactOfflineDriverCode,
            usedFallbackIdentity: !auth.currentUser,
            stage: 'DELIVERED',
            serverSynced: false,
            firestoreSynced: Boolean(syncMeta?.firestoreAlreadySynced),
            deliveredCatatan: deliveredPayload.catatanSampai,
            deliveredPayload,
            assignmentSnapshot: {
              ...optimisticAssignment,
              driverCode: exactOfflineDriverCode,
            },
          },
          error
        );

        const nextAssignments = appStateRef.current.assignments.some(
          (a) => a.id === assignmentId
        )
          ? appStateRef.current.assignments.map((a) =>
              a.id === assignmentId ? optimisticAssignment : a
            )
          : [optimisticAssignment, ...appStateRef.current.assignments];
        applyIncomingState(
          {
            ...appStateRef.current,
            assignments: nextAssignments,
          },
          { explicitAssignment: optimisticAssignment }
        );

        const built = buildRealtimeWhatsAppUrlForAssignment(
          {
            ...optimisticAssignment,
            driverPhone:
              loggedInDriver?.phone || optimisticAssignment.driverPhone || '',
          },
          waTargetMode,
          appStateRef.current.config?.whatsappGroupName,
          appStateRef.current.config?.dispatcherWaPhone,
          'DELIVERED'
        );
        if (autoOpenWa && built.url) {
          launchWhatsAppUrl(built.url);
        }

        const activeConfigSnap = getActiveConfigSnapshot();
        void pushDriverMutationViaBrowserBridge({
          appsScriptUrl: activeConfigSnap.appsScriptUrl,
          spreadsheetId: activeConfigSnap.spreadsheetId,
          updatedAssignment: optimisticAssignment,
        }).then((bridgedOk) => {
          if (bridgedOk) {
            removePendingReportSyncItem(`${assignmentId}__DELIVERED`);
            clearPerAssignmentPendingSyncRecord(assignmentId);
          }
        });

        if (!syncMeta?.firestoreQueuedInPortal) {
          addToast(
            syncMeta?.firestoreAlreadySynced ? 'success' : 'info',
            syncMeta?.firestoreAlreadySynced
              ? 'Data Delivered Masuk ke Database Cloud'
              : 'Data Delivered Tersimpan — Siap Kirim WhatsApp',
            syncMeta?.firestoreAlreadySynced
              ? 'Data Delivered (Sampai) telah tersimpan langsung di Firestore Database.'
              : 'Data Delivered disimpan di memori HP & otomatis disinkronkan ke Spreadsheet di latar belakang.',
            built.url
              ? { actionLabel: 'Buka WhatsApp', actionHref: built.url }
              : undefined
          );
        }

        return {
          id: `local-wa-${Date.now()}`,
          timestamp: nowIso,
          eventType: 'DELIVERED',
          noPenugasan: optimisticAssignment.noPenugasan,
          driverId: optimisticAssignment.driverId,
          driverName: optimisticAssignment.driverName,
          plateNumber: optimisticAssignment.plateNumber,
          targetPhone: optimisticAssignment.driverPhone || '',
          message: built.message,
          waDirectUrl: built.url,
          waGroupUrl: built.url,
          networkStatus: 'SIAP_GATEWAY',
          gatewayDetail: 'Tersimpan di memori lokal HP (Pending Sync Queue)',
        };
      }

      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal memperbarui status Delivered.'
      );
      return null;
    }
  };

  const handleDriverHandover = async (
    assignmentId: string,
    payload: {
      jenisKendaraan?: VehicleCoolingType;
      kmAkhir: number;
      suhuAkhir: string;
      bbmAkhir: string;
      penerimaNama: string;
      kondisiAkhir: string;
      catatanSerahTerima: string;
      fotoOdometerSerahTerima?: string;
      fotoSuhuSerahTerima?: string;
      fotoBuktiSerahTerima?: string;
      tandaTanganPenerima?: string;
    },
    waTargetMode: WhatsAppTargetMode,
    autoOpenWa = true,
    explicitSnapshot?: Assignment,
    syncMeta?: DriverSubmitSyncMeta
  ): Promise<WhatsAppNotificationLog | null> => {
    const assignmentSnapshot =
      syncMeta?.resolvedAssignment ||
      explicitSnapshot ||
      appStateRef.current.assignments.find((a) => a.id === assignmentId);
    const fallbackDriverUid = getSavedDriverUidFallback(
      assignmentSnapshot?.driverCode ||
        loggedInDriver?.id ||
        assignmentSnapshot?.driverId
    );

    try {
      // 1. Bounded non-blocking token warmup (never stalls mobile report submission)
      if (!syncMeta?.firestoreAlreadySynced && auth.currentUser) {
        await warmAuthTokenNonBlocking(700);
      }

      const activeConfigSnap = getActiveConfigSnapshot();
      const res = await safeApiFetch<{
        error?: string;
        assignment: Assignment;
        notification: WhatsAppNotificationLog;
        state: AppStateResponse;
      }>(
        `/api/assignments/${encodeURIComponent(assignmentId)}/handover`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Client-Id': REALTIME_CLIENT_ID,
          },
          body: JSON.stringify({
            ...payload,
            submittedByDriverUid: fallbackDriverUid,
            assignmentSnapshot,
            configSnapshot: activeConfigSnap,
          }),
        },
        0,
        6000
      );
      if (!res.ok || !res.data?.state) {
        if (
          res.isHtmlResponse ||
          res.networkFailed ||
          syncMeta?.firestoreAlreadySynced ||
          syncMeta?.firestoreQueuedInPortal
        ) {
          throw new Error(
            res.errorMessage || 'Server sementara tidak terjangkau'
          );
        }
        addToast(
          'error',
          'Gagal Mengirim Berita Acara Serah Terima',
          res.errorMessage || 'Gagal mengirim berita acara serah terima.'
        );
        return null;
      }
      const data = res.data;
      removePendingReportSyncItem(`${assignmentId}__SERAH_TERIMA`);
      clearPerAssignmentPendingSyncRecord(assignmentId);

      const notif = data.notification as WhatsAppNotificationLog;
      let targetUrl = '';
      let freshMessage = notif?.message || '';
      if (notif && data.assignment) {
        notifiedDriverWaIdsRef.current.add(notif.id);
        const built = buildRealtimeWhatsAppUrlForAssignment(
          {
            ...data.assignment,
            driverPhone:
              loggedInDriver?.phone || data.assignment.driverPhone || '',
          },
          waTargetMode,
          data.state?.config?.whatsappGroupName,
          data.state?.config?.dispatcherWaPhone,
          'SERAH_TERIMA'
        );
        targetUrl = built.url;
        freshMessage = built.message;
        if (autoOpenWa) {
          launchWhatsAppUrl(targetUrl);
        }
      }

      applyIncomingState(data.state, {
        explicitAssignment: data.assignment,
      });

      // Sync to Firestore in background without blocking UI
      if (data.assignment) {
        if (syncMeta?.firestoreAlreadySynced) {
          if (googleUser?.emailVerified) {
            void runCloudTask(async () => {
              for (const veh of (data.state as AppStateResponse).vehicles) {
                await upsertVehicleInFirestore(googleUser, veh);
              }
            });
          }
        } else {
          const exactDriverCode =
            assignmentSnapshot?.driverCode ||
            assignmentSnapshot?.driverId ||
            fallbackDriverUid;
          void submitDriverReportToFirestore({
            assignment: {
              ...data.assignment,
              driverCode:
                data.assignment.driverCode ||
                exactDriverCode ||
                data.assignment.driverId,
              ownerUid: data.assignment.ownerUid || assignmentSnapshot?.ownerUid,
            },
            stage: 'SERAH_TERIMA',
            serverSynced: true,
            skipQueueOnFailure: true,
            handoverPayload: payload,
          }).then((fsSync) => {
            if (fsSync.syncedToFirestore && googleUser?.emailVerified) {
              void runCloudTask(async () => {
                for (const veh of (data.state as AppStateResponse).vehicles) {
                  await upsertVehicleInFirestore(googleUser, veh);
                }
              });
            }
          });
        }
      }

      addToast(
        'success',
        autoOpenWa
          ? 'Berita Acara Handover Selesai — Siap Kirim WA'
          : 'Berita Acara Handover Tersimpan Real-Time',
        waTargetMode === 'GROUP'
          ? 'Notifikasi lengkap Berita Acara Serah Terima siap dikirim ke Grup WA.'
          : waTargetMode === 'DRIVER'
          ? 'Notifikasi WhatsApp lengkap siap dikirim ke nomor Driver.'
          : 'Notifikasi WhatsApp lengkap siap dikirim ke Dispatcher.',
        targetUrl
          ? { actionLabel: 'Buka WhatsApp', actionHref: targetUrl }
          : undefined
      );

      void (async () => {
        try {
          const token =
            googleUser || getAccessToken()
              ? await ensureValidAccessToken()
              : null;
          const sheetId = data.state.config.spreadsheetId;
          if (token) {
            const pendingPhotos = summarizeFleetPhotoDriveStats(
              data.state.assignments
            ).pendingPhotos;
            if (pendingPhotos > 0) {
              void handleSyncPhotosToDrive({
                silent: true,
                explicitAssignments: data.state.assignments,
                explicitSpreadsheetId: sheetId,
              });
            } else if (sheetId) {
              await pushAssignmentsToSpreadsheet(
                token,
                sheetId,
                data.state.assignments
              );
              await pushVehiclesToSpreadsheet(
                token,
                sheetId,
                data.state.vehicles
              );
              await fetch('/api/sync/mark-pushed', {
                method: 'POST',
                headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
              });
            }
          }
        } catch {
          // Will be pushed via server bridge / next background sync
        }
      })();

      return notif ? { ...notif, message: freshMessage } : null;
    } catch (error) {
      if (assignmentSnapshot) {
        const nowIso = new Date().toISOString();
        const optimisticAssignment: Assignment = {
          ...assignmentSnapshot,
          status: TaskStatus.HANDOVER,
          deliveredAt: assignmentSnapshot.deliveredAt || nowIso,
          handoverData: {
            timestamp: nowIso,
            kmAkhir: payload.kmAkhir,
            suhuAkhir: payload.suhuAkhir,
            bbmAkhir: payload.bbmAkhir,
            penerimaNama: payload.penerimaNama,
            kondisiAkhir: payload.kondisiAkhir,
            catatanSerahTerima: payload.catatanSerahTerima,
            fotoOdometerSerahTerima: payload.fotoOdometerSerahTerima,
            fotoSuhuSerahTerima: payload.fotoSuhuSerahTerima,
            fotoBuktiSerahTerima: payload.fotoBuktiSerahTerima,
            tandaTanganPenerima: payload.tandaTanganPenerima,
          },
          needsSheetSync: true,
        };

        const otherStillActive = appStateRef.current.assignments.some(
          (a) =>
            a.id !== assignmentId &&
            (a.vehicleId === optimisticAssignment.vehicleId ||
              a.plateNumber.trim().toLowerCase() ===
                optimisticAssignment.plateNumber.trim().toLowerCase()) &&
            (a.status === TaskStatus.MENUNGGU_BERANGKAT ||
              a.status === TaskStatus.DALAM_PERJALANAN ||
              a.status === TaskStatus.DELIVERED)
        );
        const exactOfflineDriverCode =
          optimisticAssignment.driverCode ||
          optimisticAssignment.driverId ||
          fallbackDriverUid;

        // Immediately queue locally & update UI + open WhatsApp without blocking on slow mobile bridge
        enqueuePendingReportSync(
          {
            assignmentId,
            noPenugasan: optimisticAssignment.noPenugasan,
            driverId: optimisticAssignment.driverId,
            submittedByDriverUid: exactOfflineDriverCode,
            usedFallbackIdentity: !auth.currentUser,
            stage: 'SERAH_TERIMA',
            serverSynced: false,
            firestoreSynced: Boolean(syncMeta?.firestoreAlreadySynced),
            handoverPayload: payload,
            assignmentSnapshot: {
              ...optimisticAssignment,
              driverCode: exactOfflineDriverCode,
            },
          },
          error
        );

        const nextAssignments = appStateRef.current.assignments.some(
          (a) => a.id === assignmentId
        )
          ? appStateRef.current.assignments.map((a) =>
              a.id === assignmentId ? optimisticAssignment : a
            )
          : [optimisticAssignment, ...appStateRef.current.assignments];
        applyIncomingState(
          {
            ...appStateRef.current,
            assignments: nextAssignments,
          },
          { explicitAssignment: optimisticAssignment }
        );

        const built = buildRealtimeWhatsAppUrlForAssignment(
          {
            ...optimisticAssignment,
            driverPhone:
              loggedInDriver?.phone || optimisticAssignment.driverPhone || '',
          },
          waTargetMode,
          appStateRef.current.config?.whatsappGroupName,
          appStateRef.current.config?.dispatcherWaPhone,
          'SERAH_TERIMA'
        );
        if (autoOpenWa && built.url) {
          launchWhatsAppUrl(built.url);
        }

        const activeConfigSnap = getActiveConfigSnapshot();
        void pushDriverMutationViaBrowserBridge({
          appsScriptUrl: activeConfigSnap.appsScriptUrl,
          spreadsheetId: activeConfigSnap.spreadsheetId,
          updatedAssignment: optimisticAssignment,
          updatedVehicleStatus: otherStillActive
            ? undefined
            : {
                vehicleId: optimisticAssignment.vehicleId,
                plateNumber: optimisticAssignment.plateNumber,
                status: 'Siap Jalan',
              },
        }).then((bridgedOk) => {
          if (bridgedOk) {
            removePendingReportSyncItem(`${assignmentId}__SERAH_TERIMA`);
            clearPerAssignmentPendingSyncRecord(assignmentId);
          }
        });

        if (!syncMeta?.firestoreQueuedInPortal) {
          addToast(
            syncMeta?.firestoreAlreadySynced ? 'success' : 'info',
            syncMeta?.firestoreAlreadySynced
              ? 'Laporan Serah Terima Masuk ke Database Cloud'
              : 'Berita Acara Handover Tersimpan — Siap Kirim WhatsApp',
            syncMeta?.firestoreAlreadySynced
              ? 'Data serah terima telah tersimpan langsung di Firestore Database.'
              : 'Berita Acara disimpan di memori HP & otomatis disinkronkan ke Spreadsheet di latar belakang.',
            built.url
              ? { actionLabel: 'Buka WhatsApp', actionHref: built.url }
              : undefined
          );
        }

        return {
          id: `local-wa-${Date.now()}`,
          timestamp: nowIso,
          eventType: 'SERAH_TERIMA',
          noPenugasan: optimisticAssignment.noPenugasan,
          driverId: optimisticAssignment.driverId,
          driverName: optimisticAssignment.driverName,
          plateNumber: optimisticAssignment.plateNumber,
          targetPhone: optimisticAssignment.driverPhone || '',
          message: built.message,
          waDirectUrl: built.url,
          waGroupUrl: built.url,
          networkStatus: 'SIAP_GATEWAY',
          gatewayDetail: 'Tersimpan di memori lokal HP (Pending Sync Queue)',
        };
      }

      addToast(
        'error',
        'Kesalahan Jaringan',
        'Gagal mengirim data serah terima.'
      );
      return null;
    }
  };

  const isFlushingPendingRef = useRef<boolean>(false);
  const activeSingleRetryIdsRef = useRef<Set<string>>(new Set());

  const processPendingSyncEntry = useCallback(
    async (
      storageKey: string,
      rawItem: PendingReportSyncItem
    ): Promise<boolean> => {
      setPendingItemRetryStatus(
        rawItem.queueId,
        'retrying',
        'Menghubungi Server & Cloud Database...'
      );

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        await new Promise((r) => setTimeout(r, 350));
        setPendingItemRetryStatus(
          rawItem.queueId,
          'failed',
          'Perangkat masih luring (tanpa sinyal). Otomatis dikirim saat sinyal kembali.'
        );
        return false;
      }

      const item = await hydratePendingReportSyncItem(rawItem);
      let latestAssignment = item.assignmentSnapshot;
      let serverOk = item.serverSynced;
      const activeConfigSnap = getActiveConfigSnapshot();

      if (!serverOk) {
        try {
          const endpoint =
            item.stage === 'KEBERANGKATAN'
              ? `/api/assignments/${encodeURIComponent(
                  item.assignmentId
                )}/departure`
              : item.stage === 'DELIVERED'
              ? `/api/assignments/${encodeURIComponent(
                  item.assignmentId
                )}/delivered`
              : `/api/assignments/${encodeURIComponent(
                  item.assignmentId
                )}/handover`;

          const reqBody =
            item.stage === 'KEBERANGKATAN'
              ? {
                  ...item.departurePayload,
                  submittedByDriverUid: item.submittedByDriverUid,
                  assignmentSnapshot: item.assignmentSnapshot,
                  configSnapshot: activeConfigSnap,
                }
              : item.stage === 'DELIVERED'
              ? {
                  ...item.deliveredPayload,
                  catatanTiba:
                    item.deliveredPayload?.catatanSampai ||
                    item.deliveredCatatan ||
                    '',
                  submittedByDriverUid: item.submittedByDriverUid,
                  assignmentSnapshot: item.assignmentSnapshot,
                  configSnapshot: activeConfigSnap,
                }
              : {
                  ...item.handoverPayload,
                  submittedByDriverUid: item.submittedByDriverUid,
                  assignmentSnapshot: item.assignmentSnapshot,
                  configSnapshot: activeConfigSnap,
                };

          const res = await safeApiFetch<{
            assignment?: Assignment;
            state?: AppStateResponse;
          }>(endpoint, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Client-Id': REALTIME_CLIENT_ID,
            },
            body: JSON.stringify(reqBody),
          });
          if (res.ok && res.data) {
            const data = res.data;
            serverOk = true;
            if (data.assignment) {
              latestAssignment = {
                ...data.assignment,
                driverCode:
                  data.assignment.driverCode ||
                  item.assignmentSnapshot.driverCode ||
                  data.assignment.driverId,
                ownerUid:
                  data.assignment.ownerUid ||
                  item.assignmentSnapshot.ownerUid,
              };
            }
            if (data.state) {
              applyIncomingState(data.state, {
                explicitAssignment: data.assignment,
              });
            }
          }
        } catch {
          serverOk = false;
        }
      }

      // Re-execute `submitReportToFirestoreWithOfflineRecovery` (skip re-queueing when server + Spreadsheet sync already succeeded)
      const fsResult = await submitReportToFirestoreWithOfflineRecovery({
        assignmentId: item.assignmentId,
        fallbackDriverId: item.driverId,
        stage: item.stage,
        candidateAssignment: {
          ...latestAssignment,
          driverCode:
            latestAssignment.driverCode ||
            item.assignmentSnapshot.driverCode ||
            latestAssignment.driverId,
          ownerUid:
            latestAssignment.ownerUid || item.assignmentSnapshot.ownerUid,
        },
        departurePayload: item.departurePayload,
        deliveredCatatan: item.deliveredCatatan,
        deliveredPayload: item.deliveredPayload,
        handoverPayload: item.handoverPayload,
        serverSynced: serverOk,
        skipQueueOnFailure: serverOk,
      });

      if (serverOk || fsResult.syncedToFirestore) {
        if (typeof window !== 'undefined') {
          try {
            if (
              storageKey &&
              storageKey.startsWith(PENDING_REPORT_SYNC_ITEM_PREFIX)
            ) {
              window.localStorage.removeItem(storageKey);
            }
            window.localStorage.removeItem(
              `${PENDING_REPORT_SYNC_ITEM_PREFIX}${item.assignmentId}`
            );
          } catch {
            // Ignore storage restrictions
          }
        }
        clearPerAssignmentPendingSyncRecord(item.assignmentId);
        removePendingReportSyncItem(item.queueId);
        return true;
      }

      setPendingItemRetryStatus(
        rawItem.queueId,
        'failed',
        'Koneksi jaringan belum stabil. Data tetap aman di memori HP.'
      );
      return false;
    },
    [applyIncomingState, getActiveConfigSnapshot]
  );

  const retrySinglePendingReportItem = useCallback(
    async (queueId: string, silent = false): Promise<boolean> => {
      if (!queueId || activeSingleRetryIdsRef.current.has(queueId)) {
        return false;
      }
      const pendingEntries = readLocalStoragePendingReportSyncEntries();
      const target = pendingEntries.find((e) => e.item.queueId === queueId);
      if (!target) return true;

      activeSingleRetryIdsRef.current.add(queueId);
      try {
        const ok = await processPendingSyncEntry(
          target.storageKey,
          target.item
        );
        if (ok && !silent) {
          addToast(
            'success',
            `Laporan ${target.item.noPenugasan} Terkirim`,
            `Tahap ${
              target.item.stage === 'KEBERANGKATAN'
                ? 'Keberangkatan'
                : target.item.stage === 'DELIVERED'
                ? 'Konfirmasi Tiba'
                : 'Serah Terima'
            } berhasil disinkronkan ke Server & Spreadsheet.`
          );
        } else if (!ok && !silent) {
          addToast(
            'info',
            `Menunggu Sinyal (${target.item.noPenugasan})`,
            typeof navigator !== 'undefined' && !navigator.onLine
              ? 'HP masih luring (tanpa sinyal). Laporan aman di memori HP dan otomatis terkirim saat sinyal pulih.'
              : 'Jaringan belum stabil. Laporan aman tersimpan dan siap dicoba ulang.'
          );
        }
        return ok;
      } finally {
        activeSingleRetryIdsRef.current.delete(queueId);
      }
    },
    [addToast, processPendingSyncEntry]
  );

  const flushPendingReportSyncQueue = useCallback(
    async (silent = true): Promise<number> => {
      if (isFlushingPendingRef.current) return 0;

      // Read all remaining `'pending_report_sync_'` keys + queued offline Driver Expenses
      const pendingEntries = readLocalStoragePendingReportSyncEntries();
      const pendingExpenses = readPendingDriverExpensesQueue();
      const totalPendingCount = pendingEntries.length + pendingExpenses.length;
      if (totalPendingCount === 0) return 0;

      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        if (!silent) {
          for (const { item } of pendingEntries) {
            setPendingItemRetryStatus(
              item.queueId,
              'failed',
              'Perangkat sedang luring (tanpa sinyal). Otomatis dikirim saat sinyal kembali.'
            );
          }
          addToast(
            'info',
            'Perangkat Sedang Luring (Tanpa Sinyal)',
            `${totalPendingCount} laporan tetap aman di memori HP dan otomatis dikirim begitu sinyal internet kembali.`
          );
        }
        return 0;
      }

      isFlushingPendingRef.current = true;
      let syncedCount = 0;

      try {
        for (const { storageKey, item: rawItem } of pendingEntries) {
          if (activeSingleRetryIdsRef.current.has(rawItem.queueId)) continue;
          const ok = await processPendingSyncEntry(storageKey, rawItem);
          if (ok) {
            syncedCount += 1;
          }
        }

        if (pendingExpenses.length > 0) {
          const vaultSnap = await readFullWorkspaceFromVault().catch(() => null);
          const vaultExpMap = new Map<string, DriverExpense>(
            (vaultSnap?.driverExpenses || []).map((e) => [e.id, e])
          );
          const memExpMap = new Map<string, DriverExpense>(
            (appStateRef.current.driverExpenses || []).map((e) => [e.id, e])
          );
          const activeConfigSnap = getActiveConfigSnapshot();

          for (const queuedExp of pendingExpenses) {
            const fullExp =
              memExpMap.get(queuedExp.id) ||
              vaultExpMap.get(queuedExp.id) ||
              queuedExp;
            const matchedFleetCardSnapshot = (
              appStateRef.current.fleetCards || []
            ).find(
              (fc) =>
                (fullExp.fleetCardId &&
                  fc.id.toLowerCase() === fullExp.fleetCardId.toLowerCase()) ||
                fc.cardNumber.trim().toLowerCase() ===
                  fullExp.fleetCardNumber.trim().toLowerCase()
            );
            const res = await safeApiFetch<{
              expense?: DriverExpense;
              state?: AppStateResponse;
            }>(
              '/api/driver-expenses',
              {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Client-Id': REALTIME_CLIENT_ID,
                },
                body: JSON.stringify({
                  ...fullExp,
                  fleetCardSnapshot: matchedFleetCardSnapshot,
                  configSnapshot: activeConfigSnap,
                }),
              },
              0
            );
            if (res.ok && res.data?.state) {
              removePendingDriverExpense(queuedExp.id);
              applyIncomingState(res.data.state);
              syncedCount += 1;
            }
          }
        }

        if (syncedCount > 0 && !silent) {
          addToast(
            'success',
            'Sinkronisasi Otomatis Berhasil',
            `${syncedCount} laporan dari memori lokal HP berhasil terkirim ke database dan memori lokal telah dibersihkan.`
          );
        } else if (syncedCount === 0 && !silent) {
          addToast(
            'info',
            'Laporan Masih Tersimpan di Memori Lokal',
            'Koneksi ke server belum aktif. Data tetap aman di memori HP dan akan dicoba kembali otomatis.'
          );
        }
        return syncedCount;
      } finally {
        isFlushingPendingRef.current = false;
      }
    },
    [addToast, applyIncomingState, getActiveConfigSnapshot, processPendingSyncEntry]
  );

  // Background Auto-Retry Sync: listens to `window.addEventListener('online')`, WebSocket wake-up, AND a 30s recovery pulse
  // so container hibernation (when Admin closes AI Studio) or cellular signal gaps recover automatically.
  useEffect(() => {
    if (typeof navigator === 'undefined' || navigator.onLine) {
      void flushPendingReportSyncQueue(true);
    }

    const handleOnlineAutoRetry = () => {
      void flushPendingReportSyncQueue(false);
    };

    const unsubWakeupFlush = realtimeSocket.subscribe((ev) => {
      if (ev.type === 'state:init') {
        void flushPendingReportSyncQueue(true);
      }
    });

    const recoveryTimer = window.setInterval(() => {
      if (typeof navigator === 'undefined' || navigator.onLine) {
        const remaining = readLocalStoragePendingReportSyncEntries();
        const remainingExp = readPendingDriverExpensesQueue();
        if (remaining.length > 0 || remainingExp.length > 0) {
          void flushPendingReportSyncQueue(true);
        }
      }
    }, 30 * 1000);

    window.addEventListener('online', handleOnlineAutoRetry);
    return () => {
      unsubWakeupFlush();
      window.clearInterval(recoveryTimer);
      window.removeEventListener('online', handleOnlineAutoRetry);
    };
  }, [flushPendingReportSyncQueue, googleUser]);

  // Permanent Multi-Year Sliding Keep-Alive for BOTH Admin Dispatcher & Driver Sessions
  // (3,650-day / 10-year rolling renewal across LocalStorage, SessionStorage, 400-day Cookie & IndexedDB)
  useEffect(() => {
    if (sessionRole === null) return;

    const renewPortalSessionSilently = () => {
      if (sessionRole === UserRole.ADMIN) {
        persistPortalSession({ role: UserRole.ADMIN });
      } else if (
        sessionRole === UserRole.DRIVER &&
        loggedInDriverRef.current
      ) {
        persistSavedDriverUid(loggedInDriverRef.current.id);
        persistPortalSession({
          role: UserRole.DRIVER,
          driverId: loggedInDriverRef.current.id,
          driverSnapshot: loggedInDriverRef.current,
        });
      }
      void refreshFirebaseSessionSilently(false);
    };

    const handleUserActivity = () => {
      touchPortalSessionSlidingRenewal(5 * 60 * 1000);
    };

    renewPortalSessionSilently();
    const keepAliveTimer = window.setInterval(
      renewPortalSessionSilently,
      10 * 60 * 1000
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        renewPortalSessionSilently();
      }
    };

    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('pageshow', renewPortalSessionSilently);
    window.addEventListener('focus', renewPortalSessionSilently);
    window.addEventListener('online', renewPortalSessionSilently);
    window.addEventListener('pointerdown', handleUserActivity, {
      passive: true,
    });
    window.addEventListener('keydown', handleUserActivity, { passive: true });

    return () => {
      window.clearInterval(keepAliveTimer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('pageshow', renewPortalSessionSilently);
      window.removeEventListener('focus', renewPortalSessionSilently);
      window.removeEventListener('online', renewPortalSessionSilently);
      window.removeEventListener('pointerdown', handleUserActivity);
      window.removeEventListener('keydown', handleUserActivity);
    };
  }, [sessionRole]);

  const handleRefreshAdminSession = useCallback(async () => {
    persistPortalSession({ role: UserRole.ADMIN });
    await refreshFirebaseSessionSilently(true);
    const token = getAccessToken();
    setHasGoogleToken(Boolean(token));
    addToast(
      'success',
      'Sesi Permanen Admin Dispatcher Diperpanjang',
      'Sesi 10 tahun bergulir (LocalStorage, SessionStorage, Cookie 400 Hari & IndexedDB) serta token autentikasi berhasil diperbarui.'
    );
  }, [addToast]);

  const handleResetApplication = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await safeApiFetch<{
        success?: boolean;
        state?: AppStateResponse;
      }>('/api/system/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': REALTIME_CLIENT_ID,
        },
      });

      const resetState = res.data?.state;
      const customPin = getSavedCustomPin() || undefined;

      if (googleUser?.emailVerified) {
        try {
          await deleteAllAssignmentsFromFirestore(googleUser);
          if (resetState) {
            await upsertConfigInFirestore(
              googleUser,
              { ...resetState.config, lastSequence: 0 },
              customPin
            );
            for (const veh of resetState.vehicles) {
              await upsertVehicleInFirestore(googleUser, veh);
            }
          }
        } catch {
          // Best-effort Firestore cleanup before local storage wipe
        }
      }

      const sheetId = extractSpreadsheetId(
        resetState?.config.spreadsheetId || appStateRef.current.config.spreadsheetId
      );
      const token =
        sheetId && (googleUser || getAccessToken())
          ? await ensureValidAccessToken()
          : null;
      if (token && sheetId) {
        try {
          await pushAssignmentsToSpreadsheet(token, sheetId, [], true);
          if (resetState?.vehicles) {
            await pushVehiclesToSpreadsheet(token, sheetId, resetState.vehicles, false);
          }
          await safeApiFetch('/api/sync/mark-pushed', {
            method: 'POST',
            headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
          });
        } catch {
          // Server pendingAssignmentDeletionPush prevents resurrection on next sync
        }
      }

      writePendingDriverExpensesQueue([]);
      await resetAllApplicationClientStorage();
      window.location.reload();
    } catch {
      writePendingDriverExpensesQueue([]);
      await resetAllApplicationClientStorage();
      window.location.reload();
    }
  }, [googleUser]);

  const handlePurgeAssignmentsCache = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await safeApiFetch<{
        success?: boolean;
        state?: AppStateResponse;
      }>('/api/system/reset', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Client-Id': REALTIME_CLIENT_ID,
        },
      });

      const resetState = res.data?.state;
      const customPin = getSavedCustomPin() || undefined;

      if (googleUser?.emailVerified) {
        try {
          await deleteAllAssignmentsFromFirestore(googleUser);
          if (resetState) {
            await upsertConfigInFirestore(
              googleUser,
              { ...resetState.config, lastSequence: 0 },
              customPin
            );
            for (const veh of resetState.vehicles) {
              await upsertVehicleInFirestore(googleUser, veh);
            }
          }
          if (typeof window !== 'undefined') {
            window.localStorage.removeItem(PENDING_CLOUD_ASSIGNMENT_PURGE_KEY);
          }
        } catch {
          if (typeof window !== 'undefined') {
            window.localStorage.setItem(
              PENDING_CLOUD_ASSIGNMENT_PURGE_KEY,
              '1'
            );
          }
        }
      } else if (typeof window !== 'undefined') {
        window.localStorage.setItem(PENDING_CLOUD_ASSIGNMENT_PURGE_KEY, '1');
      }

      const sheetId = extractSpreadsheetId(
        resetState?.config.spreadsheetId ||
          appStateRef.current.config.spreadsheetId
      );
      const token =
        sheetId && (googleUser || getAccessToken())
          ? await ensureValidAccessToken()
          : null;
      if (token && sheetId) {
        try {
          await pushAssignmentsToSpreadsheet(token, sheetId, [], true);
          if (resetState?.vehicles) {
            await pushVehiclesToSpreadsheet(
              token,
              sheetId,
              resetState.vehicles,
              false
            );
          }
          await safeApiFetch('/api/sync/mark-pushed', {
            method: 'POST',
            headers: { 'X-Client-Id': REALTIME_CLIENT_ID },
          });
        } catch {
          // Server pendingAssignmentDeletionPush prevents resurrection on next sync
        }
      }

      await purgeAssignmentsClientCacheOnly();
      if (resetState) {
        applyIncomingState(resetState);
      }
      addToast(
        'success',
        'Cache Surat Tugas Dibersihkan',
        'Seluruh Surat Tugas mulai dari data kosong (urutan 0). Data Master Driver, Armada, dan Rute tetap tersimpan.'
      );
    } finally {
      setIsSyncing(false);
    }
  }, [addToast, applyIncomingState, googleUser]);

  const handleCopyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      addToast('success', 'Berhasil Disalin', `${label} disalin ke papan klip.`);
    } catch {
      addToast('error', 'Gagal Menyalin', 'Tidak dapat mengakses clipboard.');
    }
  };

  return (
    <>
      {loadingInitial && (sessionRole === null || (sessionRole === UserRole.DRIVER && !loggedInDriver)) && (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="w-full max-w-sm space-y-3 text-center">
            <div className="mx-auto h-6 w-48 animate-pulse rounded bg-slate-200" />
            <div className="mx-auto h-4 w-64 animate-pulse rounded bg-slate-200" />
          </div>
        </div>
      )}

      {!loadingInitial && sessionRole === null && (
        <LoginPage
          drivers={appState.drivers}
          vehicles={appState.vehicles}
          assignments={appState.assignments}
          config={appState.config}
          adminViews={appState.adminViews || []}
          googleUser={googleUser}
          hasGoogleToken={hasGoogleToken}
          isSyncing={isSyncing}
          initialDriverMode={driverUrlParams.isDriverMode}
          initialDriverId={driverUrlParams.driverId}
          initialTaskKey={driverUrlParams.taskKey}
          embeddedDriver={driverUrlParams.embeddedDriver}
          onRefreshSync={async () => {
            await syncWithGoogleSheets(undefined, false);
          }}
          onGoogleLogin={handleGoogleLogin}
          onDriverLoginSuccess={(driver) => {
            persistSavedDriverUid(driver.id);
            setLoggedInDriver(driver);
            setSessionRole(UserRole.DRIVER);
            persistPortalSession({
              role: UserRole.DRIVER,
              driverId: driver.id,
              driverSnapshot: driver,
            });
            addToast(
              'success',
              `Selamat Datang, ${driver.name}`,
              `Sesi Driver (${driver.id}) aktif permanen & diperpanjang otomatis hingga Anda menekan Keluar.`
            );
          }}
          onAdminLoginSuccess={() => {
            for (const a of appStateRef.current.assignments) {
              prevStatusMapRef.current.set(a.id, a.status);
            }
            statusMapInitializedRef.current = true;
            setSessionRole(UserRole.ADMIN);
            persistPortalSession({ role: UserRole.ADMIN });
            addToast(
              'success',
              'CRK LOGISTIK DELIVERY SISTEM',
              'Sesi Admin Dispatcher aktif permanen (10 tahun bergulir) & tidak akan keluar otomatis hingga Anda menekan Keluar.'
            );
          }}
          onAdminViewLoginSuccess={(adminView) => {
            for (const a of appStateRef.current.assignments) {
              prevStatusMapRef.current.set(a.id, a.status);
            }
            statusMapInitializedRef.current = true;
            setLoggedInAdminView(adminView);
            setSessionRole(UserRole.ADMIN_VIEW);
            persistPortalSession({
              role: UserRole.ADMIN_VIEW,
              adminViewId: adminView.id,
              adminViewSnapshot: adminView,
            });
            addToast(
              'success',
              `Portal Admin View: ${adminView.name}`,
              'Mode Monitoring aktif (Hanya Lihat). Dasbor operasional siap dipantau.'
            );
          }}
        />
      )}

      {sessionRole === UserRole.DRIVER && loggedInDriver && (
        <DriverPortal
          driver={loggedInDriver}
          vehicles={appState.vehicles}
          assignments={appState.assignments}
          notifications={appState.notifications}
          routes={appState.routes}
          fleetCards={appState.fleetCards}
          driverExpenses={appState.driverExpenses}
          config={appState.config}
          isSyncing={isSyncing}
          initialTaskKey={driverUrlParams.taskKey}
          embeddedTask={driverUrlParams.embeddedTask}
          onRefreshSync={async () => {
            await flushPendingReportSyncQueue(false);
            await syncWithGoogleSheets(undefined, false);
          }}
          onRetryPendingSync={async () => {
            await flushPendingReportSyncQueue(false);
          }}
          onRetrySinglePendingSync={async (queueId: string) => {
            return retrySinglePendingReportItem(queueId, false);
          }}
          onNotify={addToast}
          onSubmitDeparture={handleDriverDeparture}
          onSubmitDelivered={handleDriverDelivered}
          onSubmitHandover={handleDriverHandover}
          onSubmitDriverExpense={handleSubmitDriverExpense}
          onCopyText={handleCopyText}
          onLogout={() => {
            persistPortalSession(null);
            setSessionRole(null);
            setLoggedInDriver(null);
          }}
        />
      )}

      {(sessionRole === UserRole.ADMIN || sessionRole === UserRole.ADMIN_VIEW) && (
        <AdminPortal
          drivers={appState.drivers}
          vehicles={appState.vehicles}
          routes={appState.routes}
          fleetCards={appState.fleetCards}
          driverExpenses={appState.driverExpenses}
          assignments={appState.assignments}
          notifications={appState.notifications}
          config={appState.config}
          googleUser={googleUser}
          hasGoogleToken={hasGoogleToken}
          isSyncing={isSyncing}
          isDriveSyncing={isDriveSyncing}
          isReadOnlyView={sessionRole === UserRole.ADMIN_VIEW}
          currentAdminViewUser={loggedInAdminView}
          adminViews={appState.adminViews || []}
          onSaveAdminView={handleSaveAdminView}
          onChangeAdminViewPin={handleChangeAdminViewPin}
          onDeleteAdminView={handleDeleteAdminView}
          onGoogleLogin={handleGoogleLogin}
          onGoogleLogout={handleGoogleLogout}
          onManualSync={handleManualAdminSync}
          onSyncPhotosToDrive={async () => {
            if (!getAccessToken()) {
              await ensureAdminInteractiveSheetsToken();
            }
            return handleSyncPhotosToDrive({ silent: false });
          }}
          onConnectSpreadsheet={handleConnectSpreadsheet}
          onCreateSpreadsheet={handleCreateSpreadsheet}
          onDisconnectSpreadsheet={handleDisconnectSpreadsheet}
          onCreateAssignment={handleCreateAssignment}
          onUpdateAssignment={handleUpdateAssignment}
          onDeleteAssignment={handleDeleteAssignment}
          onSaveDriver={handleSaveDriver}
          onDeleteDriver={handleDeleteDriver}
          onSaveVehicle={handleSaveVehicle}
          onDeleteVehicle={handleDeleteVehicle}
          onSaveRoute={handleSaveRoute}
          onDeleteRoute={handleDeleteRoute}
          onSaveFleetCard={handleSaveFleetCard}
          onTopUpFleetCard={handleTopUpFleetCard}
          onUpdateFleetCardBalance={handleUpdateFleetCardBalance}
          onDeleteFleetCard={handleDeleteFleetCard}
          onDeleteDriverExpense={handleDeleteDriverExpense}
          onNotify={addToast}
          onSaveOperationalSettings={handleSaveOperationalSettings}
          onSaveAppsScriptUrl={handleSaveAppsScriptUrl}
          onTestWhatsAppNetwork={handleTestWhatsAppNetwork}
          onChangeAdminPin={handleChangeAdminPin}
          onRefreshAdminSession={handleRefreshAdminSession}
          onPurgeAssignmentsCache={handlePurgeAssignmentsCache}
          onResetApplication={handleResetApplication}
          onCopyText={handleCopyText}
          onLogout={() => {
            persistPortalSession(null);
            setSessionRole(null);
            setLoggedInAdminView(null);
          }}
        />
      )}

      <div className="no-print">
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    </>
  );
}
