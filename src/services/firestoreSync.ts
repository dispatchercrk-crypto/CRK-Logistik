import { User } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import {
  AppConfig,
  AppStateResponse,
  Assignment,
  DriverExpense,
  DriverMaster,
  FleetCardMaster,
  RouteMaster,
  TaskStatus,
  VehicleCoolingType,
  VehicleMaster,
} from '../types';
import {
  auth,
  db,
  getSavedDriverUidFallback,
  persistSavedDriverUid,
} from './googleAuth';
import {
  cacheSuratTugasSnapshotLocally,
  deletePendingReportPhotosFromVault,
  PendingSyncPhotoBundle,
  readPendingReportPhotosFromVault,
  resolveCachedSuratTugasAsli,
  savePendingReportPhotosToVault,
} from './persistentVault';

// ============================================================================
// 1. Mandatory Firestore Error Handler (Synced with Firebase Integration Skill)
// ============================================================================

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

// ============================================================================
// 2. Boot-Time Connection Validation
// ============================================================================

async function testConnection(): Promise<void> {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('the client is offline')
    ) {
      console.error('Please check your Firebase configuration.');
    }
  }
}
void testConnection();

// ============================================================================
// 3. Schema Validation & Sanitization Constants (Synced verbatim with firebase-blueprint.json)
// ============================================================================

export const BLUEPRINT_ID_PATTERN = /^[a-zA-Z0-9_\-]+$/;
const BOOTSTRAP_ADMIN_EMAIL = 'dispatchercrk@gmail.com';

const MAX_LEN = {
  DOC_ID: 128,
  CODE_ID: 64,
  ADMIN_EMAIL: 160,
  DRIVER_NAME: 120,
  DRIVER_LICENSE: 40,
  DRIVER_PHONE: 40,
  DRIVER_PIN: 32,
  VEHICLE_PLATE: 32,
  VEHICLE_TYPE: 100,
  VEHICLE_CAPACITY: 80,
  VEHICLE_CAPACITY_CBM: 64,
  VEHICLE_STATUS: 32,
  ROUTE_DEST: 200,
  ROUTE_PIC_NAME: 120,
  ROUTE_PIC_PHONE: 40,
  FLEET_CARD_NUM: 80,
  EXP_COMPLETED_NOS: 500,
  EXP_TUJUAN: 240,
  EXP_CATATAN: 500,
  EXP_DRIVE_URL: 300,
  ASG_NO_PENUGASAN: 80,
  ASG_SURAT_JALAN: 500,
  ASG_SEGEL: 64,
  ASG_TANGGAL: 32,
  ASG_JADWAL_TIBA: 16,
  ASG_PURPOSE: 240,
  ASG_BERAT_MUATAN: 64,
  ASG_VOLUME_CBM: 64,
  ASG_TIMESTAMP: 64,
  ASG_JENIS_KENDARAAN: 32,
  ASG_SUHU: 32,
  ASG_BBM: 32,
  ASG_KONDISI: 120,
  ASG_DRIVE_ID: 160,
  ASG_DRIVE_URL: 300,
  ASG_NOTES: 500,
  CFG_SHEET_ID: 160,
  CFG_SHEET_TITLE: 200,
  CFG_SHEET_URL: 300,
  CFG_DRIVE_ID: 160,
  CFG_DRIVE_URL: 300,
  CFG_PORTAL_URL: 300,
  CFG_WA_PHONE: 64,
  CFG_WA_GROUP_NAME: 120,
  CFG_WA_GROUP_URL: 300,
  CFG_PREFIX: 32,
} as const;

export function sanitizeFirestoreId(
  raw: string,
  maxLength: number = MAX_LEN.CODE_ID,
  fallbackPrefix = 'ID'
): string {
  const cleaned = String(raw || '')
    .trim()
    .replace(/[^a-zA-Z0-9_\-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, maxLength);
  if (cleaned.length >= 1 && BLUEPRINT_ID_PATTERN.test(cleaned)) {
    return cleaned;
  }
  return `${fallbackPrefix}-${Date.now()}`.slice(0, maxLength);
}

function clampString(
  val: unknown,
  maxLength: number,
  requiredFallback?: string
): string {
  const trimmed = String(val ?? '').trim().slice(0, maxLength);
  if (requiredFallback !== undefined && trimmed.length === 0) {
    return requiredFallback.slice(0, maxLength);
  }
  return trimmed;
}

const DELIVERED_AT_NOTES_TAG_REGEX = /\s*\[DLV:([^\]]+)\]\s*/g;

function extractDeliveredAtFromFirestoreNotes(rawNotes: string | undefined): {
  cleanNotes: string;
  deliveredAt?: string;
} {
  const text = String(rawNotes || '');
  let extracted: string | undefined;
  const cleanNotes = text
    .replace(DELIVERED_AT_NOTES_TAG_REGEX, (_match, isoCandidate: string) => {
      const candidate = String(isoCandidate || '').trim();
      if (candidate) {
        extracted = candidate;
      }
      return ' ';
    })
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    cleanNotes,
    deliveredAt: extracted,
  };
}

function embedDeliveredAtInFirestoreNotes(
  rawNotes: string | undefined,
  deliveredAt: string | undefined
): string {
  const { cleanNotes, deliveredAt: existingEmbedded } =
    extractDeliveredAtFromFirestoreNotes(rawNotes);
  const resolvedDeliveredAt = clampString(
    deliveredAt || existingEmbedded || '',
    MAX_LEN.ASG_TIMESTAMP
  );
  if (!resolvedDeliveredAt) {
    return clampString(cleanNotes, MAX_LEN.ASG_NOTES);
  }
  const suffix = `[DLV:${resolvedDeliveredAt}]`;
  if (!cleanNotes) {
    return clampString(suffix, MAX_LEN.ASG_NOTES);
  }
  const maxBodyLen = Math.max(0, MAX_LEN.ASG_NOTES - suffix.length - 1);
  return `${cleanNotes.slice(0, maxBodyLen).trim()} ${suffix}`;
}

function canSyncWithUser(user: User | null | undefined): user is User {
  return Boolean(
    user &&
      user.uid &&
      BLUEPRINT_ID_PATTERN.test(user.uid) &&
      user.emailVerified === true
  );
}

function timestampToIso(ts: unknown): string {
  if (ts instanceof Timestamp) {
    return ts.toDate().toISOString();
  }
  if (
    ts &&
    typeof ts === 'object' &&
    'toDate' in ts &&
    typeof (ts as { toDate: () => Date }).toDate === 'function'
  ) {
    return (ts as { toDate: () => Date }).toDate().toISOString();
  }
  return new Date().toISOString();
}

function shallowFieldsEqual(
  existingData: Record<string, unknown>,
  nextFields: Record<string, unknown>
): boolean {
  for (const [key, val] of Object.entries(nextFields)) {
    if (existingData[key] !== val) {
      return false;
    }
  }
  return true;
}

const firestoreDocLocks = new Map<string, Promise<unknown>>();

function withFirestoreDocLock<T>(
  lockKey: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = firestoreDocLocks.get(lockKey) ?? Promise.resolve();
  const next = previous
    .catch(() => undefined)
    .then(task);
  const tracked = next.finally(() => {
    if (firestoreDocLocks.get(lockKey) === tracked) {
      firestoreDocLocks.delete(lockKey);
    }
  });
  firestoreDocLocks.set(lockKey, tracked);
  return next;
}

function resolveActiveSyncUser(candidate: User | null | undefined): User | null {
  if (auth.currentUser && canSyncWithUser(auth.currentUser)) {
    return auth.currentUser;
  }
  if (canSyncWithUser(candidate)) {
    return candidate;
  }
  return null;
}

function isPermissionDeniedError(error: unknown): boolean {
  const code = (error as { code?: string })?.code || '';
  const msg = error instanceof Error ? error.message : String(error || '');
  return (
    code === 'permission-denied' ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('PERMISSION_DENIED')
  );
}

// ============================================================================
// 4. Individual Entity Upsert & Delete Operations
// ============================================================================

export async function ensureAdminBootstrapRecord(user: User): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const normalizedEmail = String(activeUser.email || '')
    .trim()
    .toLowerCase();
  if (normalizedEmail !== BOOTSTRAP_ADMIN_EMAIL) return;

  const adminPath = `admins/${activeUser.uid}`;
  await withFirestoreDocLock(adminPath, async () => {
    const adminRef = doc(db, 'admins', activeUser.uid);
    let snap;
    try {
      snap = await getDoc(adminRef);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, adminPath);
    }

    if (!snap.exists()) {
      try {
        await setDoc(adminRef, {
          uid: activeUser.uid,
          email: clampString(
            normalizedEmail,
            MAX_LEN.ADMIN_EMAIL,
            BOOTSTRAP_ADMIN_EMAIL
          ),
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          try {
            const serverSnap = await getDocFromServer(adminRef);
            if (serverSnap.exists()) return;
          } catch {
            // Fall through to report genuine error
          }
        }
        handleFirestoreError(error, OperationType.CREATE, adminPath);
      }
    }
  });
}

export async function upsertDriverInFirestore(
  user: User | null,
  driver: DriverMaster,
  previousId?: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;

  const docId = sanitizeFirestoreId(driver.id, MAX_LEN.CODE_ID, 'DRV');
  if (previousId) {
    const oldDocId = sanitizeFirestoreId(previousId, MAX_LEN.CODE_ID, 'DRV');
    if (oldDocId !== docId) {
      await deleteDriverFromFirestore(activeUser, oldDocId);
    }
  }

  const publicPath = `drivers/${docId}`;
  const secretPath = `drivers/${docId}/private/credentials`;

  await withFirestoreDocLock(publicPath, async () => {
    const publicRef = doc(db, 'drivers', docId);
    const secretRef = doc(db, 'drivers', docId, 'private', 'credentials');

    let publicSnap;
    try {
      publicSnap = await getDoc(publicRef);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, publicPath);
    }

    const mutablePublic = {
      name: clampString(driver.name, MAX_LEN.DRIVER_NAME, docId),
      licenseType: clampString(driver.licenseType, MAX_LEN.DRIVER_LICENSE),
      active: driver.active !== false,
    };
    const mutableSecret = {
      phone: clampString(driver.phone, MAX_LEN.DRIVER_PHONE),
      pin: clampString(driver.pin, MAX_LEN.DRIVER_PIN),
    };

    if (!publicSnap.exists()) {
      const batch = writeBatch(db);
      batch.set(publicRef, {
        id: docId,
        ...mutablePublic,
        ownerUid: activeUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      batch.set(secretRef, {
        driverId: docId,
        ...mutableSecret,
        ownerUid: activeUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      try {
        await batch.commit();
        return;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          try {
            const serverSnap = await getDocFromServer(publicRef);
            if (!serverSnap.exists()) {
              handleFirestoreError(error, OperationType.CREATE, publicPath);
            }
            publicSnap = serverSnap;
          } catch {
            // Document exists under a different ownerUid; skip overwriting foreign doc
            return;
          }
        } else {
          handleFirestoreError(error, OperationType.CREATE, publicPath);
        }
      }
    }

    if (
      publicSnap.data()?.ownerUid &&
      publicSnap.data()?.ownerUid !== activeUser.uid
    ) {
      return;
    }

    let secretSnap;
    try {
      secretSnap = await getDoc(secretRef);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, secretPath);
    }

    const publicUnchanged = shallowFieldsEqual(
      publicSnap.data() as Record<string, unknown>,
      mutablePublic
    );
    const secretUnchanged =
      secretSnap.exists() &&
      shallowFieldsEqual(
        secretSnap.data() as Record<string, unknown>,
        mutableSecret
      );

    if (publicUnchanged && secretUnchanged) return;

    const batch = writeBatch(db);
    if (!publicUnchanged) {
      batch.update(publicRef, {
        ...mutablePublic,
        updatedAt: serverTimestamp(),
      });
    }
    if (!secretSnap.exists()) {
      batch.set(secretRef, {
        driverId: docId,
        ...mutableSecret,
        ownerUid: activeUser.uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else if (!secretUnchanged) {
      batch.update(secretRef, {
        ...mutableSecret,
        updatedAt: serverTimestamp(),
      });
    }

    try {
      await batch.commit();
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, publicPath);
    }
  });
}

export async function deleteDriverFromFirestore(
  user: User | null,
  driverId: string
): Promise<void> {
  if (!canSyncWithUser(user)) return;
  const docId = sanitizeFirestoreId(driverId, MAX_LEN.CODE_ID, 'DRV');
  const publicPath = `drivers/${docId}`;
  const secretPath = `drivers/${docId}/private/credentials`;
  const publicRef = doc(db, 'drivers', docId);
  const secretRef = doc(db, 'drivers', docId, 'private', 'credentials');

  let publicSnap;
  try {
    publicSnap = await getDoc(publicRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, publicPath);
  }
  if (!publicSnap.exists()) return;

  let secretSnap;
  try {
    secretSnap = await getDoc(secretRef);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, secretPath);
  }

  const batch = writeBatch(db);
  if (secretSnap.exists()) {
    batch.delete(secretRef);
  }
  batch.delete(publicRef);
  try {
    await batch.commit();
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, publicPath);
  }
}

export async function upsertVehicleInFirestore(
  user: User | null,
  vehicle: VehicleMaster,
  previousId?: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const docId = sanitizeFirestoreId(vehicle.id, MAX_LEN.CODE_ID, 'UNT');
  if (previousId) {
    const oldDocId = sanitizeFirestoreId(previousId, MAX_LEN.CODE_ID, 'UNT');
    if (oldDocId !== docId) {
      await deleteVehicleFromFirestore(activeUser, oldDocId);
    }
  }

  const path = `vehicles/${docId}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'vehicles', docId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, path);
    }

    const validStatus: VehicleMaster['status'] =
      vehicle.status === 'Dalam Tugas' || vehicle.status === 'Perawatan'
        ? vehicle.status
        : 'Siap Jalan';

    const mutableFields = {
      plateNumber: clampString(vehicle.plateNumber, MAX_LEN.VEHICLE_PLATE, '-'),
      vehicleType: clampString(vehicle.vehicleType, MAX_LEN.VEHICLE_TYPE),
      capacity: clampString(vehicle.capacity, MAX_LEN.VEHICLE_CAPACITY),
      ...(vehicle.capacityCbm !== undefined
        ? {
            capacityCbm: clampString(
              vehicle.capacityCbm,
              MAX_LEN.VEHICLE_CAPACITY_CBM
            ),
          }
        : {}),
      status: validStatus,
    };

    if (!snap.exists()) {
      try {
        await setDoc(ref, {
          id: docId,
          ...mutableFields,
          ownerUid: activeUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          try {
            const serverSnap = await getDocFromServer(ref);
            if (!serverSnap.exists()) {
              handleFirestoreError(error, OperationType.CREATE, path);
            }
            snap = serverSnap;
          } catch {
            return;
          }
        } else {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
    }

    const existingData = snap.data() as Record<string, unknown>;
    if (existingData.ownerUid && existingData.ownerUid !== activeUser.uid) {
      return;
    }

    if (shallowFieldsEqual(existingData, mutableFields)) {
      return;
    }

    try {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  });
}

export async function deleteVehicleFromFirestore(
  user: User | null,
  vehicleId: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const docId = sanitizeFirestoreId(vehicleId, MAX_LEN.CODE_ID, 'UNT');
  const path = `vehicles/${docId}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'vehicles', docId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, path);
    }
    if (!snap.exists()) return;
    try {
      await deleteDoc(ref);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  });
}

export async function upsertRouteInFirestore(
  user: User | null,
  route: RouteMaster,
  previousId?: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const docId = sanitizeFirestoreId(route.id, MAX_LEN.CODE_ID, 'RT');
  if (previousId) {
    const oldDocId = sanitizeFirestoreId(previousId, MAX_LEN.CODE_ID, 'RT');
    if (oldDocId !== docId) {
      await deleteRouteFromFirestore(activeUser, oldDocId);
    }
  }

  const path = `routes/${docId}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'routes', docId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, path);
    }

    const mutableFields = {
      destination: clampString(route.destination, MAX_LEN.ROUTE_DEST, '-'),
      picName: clampString(route.picName, MAX_LEN.ROUTE_PIC_NAME),
      picPhone: clampString(route.picPhone, MAX_LEN.ROUTE_PIC_PHONE),
    };

    if (!snap.exists()) {
      try {
        await setDoc(ref, {
          id: docId,
          ...mutableFields,
          ownerUid: activeUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          try {
            const serverSnap = await getDocFromServer(ref);
            if (!serverSnap.exists()) {
              handleFirestoreError(error, OperationType.CREATE, path);
            }
            snap = serverSnap;
          } catch {
            return;
          }
        } else {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
    }

    const existingData = snap.data() as Record<string, unknown>;
    if (existingData.ownerUid && existingData.ownerUid !== activeUser.uid) {
      return;
    }

    if (shallowFieldsEqual(existingData, mutableFields)) {
      return;
    }

    try {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  });
}

export async function deleteRouteFromFirestore(
  user: User | null,
  routeId: string
): Promise<void> {
  if (!canSyncWithUser(user)) return;
  const docId = sanitizeFirestoreId(routeId, MAX_LEN.CODE_ID, 'RT');
  const path = `routes/${docId}`;
  const ref = doc(db, 'routes', docId);
  let snap;
  try {
    snap = await getDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
  if (!snap.exists()) return;
  try {
    await deleteDoc(ref);
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function upsertFleetCardInFirestore(
  user: User | null,
  fleetCard: FleetCardMaster,
  previousId?: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const docId = sanitizeFirestoreId(fleetCard.id, MAX_LEN.CODE_ID, 'FC');
  if (previousId) {
    const oldDocId = sanitizeFirestoreId(previousId, MAX_LEN.CODE_ID, 'FC');
    if (oldDocId !== docId) {
      await deleteFleetCardFromFirestore(activeUser, oldDocId);
    }
  }

  const path = `fleet_cards/${docId}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'fleet_cards', docId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, path);
    }

    const safeBalance = Number.isFinite(Number(fleetCard.balance))
      ? Math.round(Number(fleetCard.balance))
      : 0;
    const mutableFields = {
      cardNumber: clampString(
        fleetCard.cardNumber,
        MAX_LEN.FLEET_CARD_NUM,
        docId
      ),
      balance: safeBalance,
    };

    if (!snap.exists()) {
      try {
        await setDoc(ref, {
          id: docId,
          ...mutableFields,
          ownerUid: activeUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          try {
            const serverSnap = await getDocFromServer(ref);
            if (!serverSnap.exists()) {
              handleFirestoreError(error, OperationType.CREATE, path);
            }
            snap = serverSnap;
          } catch {
            return;
          }
        } else {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
    }

    const existingData = snap.data() as Record<string, unknown>;
    if (existingData.ownerUid && existingData.ownerUid !== activeUser.uid) {
      return;
    }

    if (shallowFieldsEqual(existingData, mutableFields)) {
      return;
    }

    try {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  });
}

export async function deleteFleetCardFromFirestore(
  user: User | null,
  fleetCardId: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const docId = sanitizeFirestoreId(fleetCardId, MAX_LEN.CODE_ID, 'FC');
  const path = `fleet_cards/${docId}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'fleet_cards', docId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, path);
    }
    if (!snap.exists()) return;
    try {
      await deleteDoc(ref);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  });
}

export async function upsertDriverExpenseInFirestore(
  user: User | null,
  expense: DriverExpense
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const docId = sanitizeFirestoreId(expense.id, MAX_LEN.DOC_ID, 'EXP');
  const path = `driver_expenses/${docId}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'driver_expenses', docId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, path);
    }

    const safeBbm = Math.max(
      0,
      Math.round(Number(expense.totalPengirimanBbm) || 0)
    );
    const safeTol = Math.max(
      0,
      Math.round(Number(expense.totalPengeluaranTol) || 0)
    );
    const safeTotal = Math.max(
      0,
      Math.round(Number(expense.totalPengeluaran) || safeBbm + safeTol)
    );

    const mutableFields = {
      timestamp: clampString(
        expense.timestamp,
        MAX_LEN.ASG_TIMESTAMP,
        new Date().toISOString()
      ),
      tanggal: clampString(
        expense.tanggal,
        MAX_LEN.ASG_TANGGAL,
        new Date().toISOString().slice(0, 10)
      ),
      tanggalPengiriman: clampString(
        expense.tanggalPengiriman || expense.tanggal,
        MAX_LEN.ASG_TANGGAL
      ),
      tujuanPengiriman: clampString(
        expense.tujuanPengiriman,
        MAX_LEN.EXP_TUJUAN
      ),
      driverCode: clampString(expense.driverId, MAX_LEN.CODE_ID, 'DRV-000'),
      driverName: clampString(expense.driverName, MAX_LEN.DRIVER_NAME, '-'),
      plateNumber: clampString(expense.plateNumber, MAX_LEN.VEHICLE_PLATE),
      completedAssignmentNos: clampString(
        expense.completedAssignmentNos,
        MAX_LEN.EXP_COMPLETED_NOS
      ),
      fleetCardId: clampString(expense.fleetCardId, MAX_LEN.CODE_ID, '-'),
      fleetCardNumber: clampString(
        expense.fleetCardNumber,
        MAX_LEN.FLEET_CARD_NUM,
        '-'
      ),
      totalPengirimanBbm: safeBbm,
      ...(expense.fotoStrukBbmUrl !== undefined
        ? {
            fotoStrukBbmUrl: clampString(
              expense.fotoStrukBbmUrl,
              MAX_LEN.EXP_DRIVE_URL
            ),
          }
        : {}),
      totalPengeluaranTol: safeTol,
      ...(expense.fotoStrukTolUrl !== undefined
        ? {
            fotoStrukTolUrl: clampString(
              expense.fotoStrukTolUrl,
              MAX_LEN.EXP_DRIVE_URL
            ),
          }
        : {}),
      totalPengeluaran: safeTotal,
      catatan: clampString(expense.catatan, MAX_LEN.EXP_CATATAN),
    };

    if (!snap.exists()) {
      try {
        await setDoc(ref, {
          id: docId,
          ...mutableFields,
          ownerUid: activeUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          try {
            const serverSnap = await getDocFromServer(ref);
            if (!serverSnap.exists()) {
              handleFirestoreError(error, OperationType.CREATE, path);
            }
            snap = serverSnap;
          } catch {
            return;
          }
        } else {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
    }

    const existingData = snap.data() as Record<string, unknown>;
    if (existingData.ownerUid && existingData.ownerUid !== activeUser.uid) {
      return;
    }

    if (shallowFieldsEqual(existingData, mutableFields)) {
      return;
    }

    try {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  });
}

export async function deleteDriverExpenseFromFirestore(
  user: User | null,
  expenseId: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const docId = sanitizeFirestoreId(expenseId, MAX_LEN.DOC_ID, 'EXP');
  const path = `driver_expenses/${docId}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'driver_expenses', docId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, path);
    }
    if (!snap.exists()) return;
    try {
      await deleteDoc(ref);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  });
}

export async function upsertAssignmentInFirestore(
  user: User | null,
  assignment: Assignment
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  try {
    await activeUser.getIdToken(false);
  } catch {
    // Proceed with cached auth session
  }

  const docId = sanitizeFirestoreId(assignment.id, MAX_LEN.DOC_ID, 'asg');
  const path = `assignments/${docId}`;

  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'assignments', docId);

    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) {
        // Document exists under another Google account's ownerUid; skip overwriting foreign doc
        return;
      }
      handleFirestoreError(error, OperationType.GET, path);
    }

    const validStatus: TaskStatus =
      assignment.status === TaskStatus.DALAM_PERJALANAN ||
      assignment.status === TaskStatus.DELIVERED ||
      assignment.status === TaskStatus.HANDOVER ||
      assignment.status === TaskStatus.SELESAI
        ? assignment.status
        : TaskStatus.MENUNGGU_BERANGKAT;

    const seqNum = Math.max(
      1,
      Math.floor(Number(assignment.sequenceNumber) || 1)
    );
    const depKm =
      typeof assignment.departureData?.kmAwal === 'number' &&
      Number.isFinite(assignment.departureData.kmAwal)
        ? assignment.departureData.kmAwal
        : -1;
    const hoKm =
      typeof assignment.handoverData?.kmAkhir === 'number' &&
      Number.isFinite(assignment.handoverData.kmAkhir)
        ? assignment.handoverData.kmAkhir
        : -1;

    const rawJenis = assignment.departureData?.jenisKendaraan;
    const validJenisKendaraan =
      rawJenis === 'Mobil Pendingin' || rawJenis === 'Non Pendingin'
        ? rawJenis
        : '';
    const resolvedOrigin = clampString(
      assignment.departureData?.titikKeberangkatan || assignment.origin,
      MAX_LEN.ROUTE_DEST,
      'Menunggu Titik Keberangkatan Driver'
    );

    const mutableFields = {
      noSuratJalanFisik: clampString(
        assignment.noSuratJalanFisik,
        MAX_LEN.ASG_SURAT_JALAN
      ),
      kodeSegel: clampString(assignment.kodeSegel, MAX_LEN.ASG_SEGEL),
      tanggalTugas: clampString(
        assignment.tanggalTugas,
        MAX_LEN.ASG_TANGGAL,
        new Date().toISOString().slice(0, 10)
      ),
      jadwalJamTiba: clampString(
        assignment.jadwalJamTiba,
        MAX_LEN.ASG_JADWAL_TIBA
      ),
      driverCode: clampString(
        assignment.driverId || assignment.driverCode,
        MAX_LEN.CODE_ID,
        'DRV-000'
      ),
      driverName: clampString(assignment.driverName, MAX_LEN.DRIVER_NAME, '-'),
      driverPhone: clampString(assignment.driverPhone, MAX_LEN.DRIVER_PHONE),
      vehicleCode: clampString(assignment.vehicleId, MAX_LEN.CODE_ID),
      plateNumber: clampString(
        assignment.plateNumber,
        MAX_LEN.VEHICLE_PLATE,
        '-'
      ),
      vehicleType: clampString(assignment.vehicleType, MAX_LEN.VEHICLE_TYPE),
      originCode: clampString(assignment.originId, MAX_LEN.CODE_ID),
      origin: resolvedOrigin,
      routeCode: clampString(assignment.routeId, MAX_LEN.CODE_ID),
      destination: clampString(assignment.destination, MAX_LEN.ROUTE_DEST, '-'),
      purpose: clampString(assignment.purpose, MAX_LEN.ASG_PURPOSE),
      ...(assignment.beratMuatan !== undefined
        ? {
            beratMuatan: clampString(
              assignment.beratMuatan,
              MAX_LEN.ASG_BERAT_MUATAN
            ),
          }
        : {}),
      ...(assignment.volumeCbm !== undefined
        ? {
            volumeCbm: clampString(
              assignment.volumeCbm,
              MAX_LEN.ASG_VOLUME_CBM
            ),
          }
        : {}),
      status: validStatus,
      depTimestamp: clampString(
        assignment.departureData?.timestamp,
        MAX_LEN.ASG_TIMESTAMP
      ),
      depTitikBerangkat: clampString(
        assignment.departureData?.titikKeberangkatan,
        MAX_LEN.ROUTE_DEST
      ),
      depJenisKendaraan: validJenisKendaraan,
      depKmAwal: depKm,
      depSuhuAwal: clampString(
        assignment.departureData?.suhuAwal,
        MAX_LEN.ASG_SUHU
      ),
      depBbmAwal: clampString(
        assignment.departureData?.bbmAwal,
        MAX_LEN.ASG_BBM
      ),
      depKondisi: clampString(
        assignment.departureData?.kondisiKendaraan,
        MAX_LEN.ASG_KONDISI
      ),
      depCatatan: clampString(
        assignment.departureData?.catatanBerangkat,
        MAX_LEN.ASG_NOTES
      ),
      hoTimestamp: clampString(
        assignment.handoverData?.timestamp,
        MAX_LEN.ASG_TIMESTAMP
      ),
      hoKmAkhir: hoKm,
      hoSuhuAkhir: clampString(
        assignment.handoverData?.suhuAkhir,
        MAX_LEN.ASG_SUHU
      ),
      hoBbmAkhir: clampString(
        assignment.handoverData?.bbmAkhir,
        MAX_LEN.ASG_BBM
      ),
      hoPenerima: clampString(
        assignment.handoverData?.penerimaNama,
        MAX_LEN.DRIVER_NAME
      ),
      hoKondisi: clampString(
        assignment.handoverData?.kondisiAkhir,
        MAX_LEN.ASG_KONDISI
      ),
      hoCatatan: clampString(
        assignment.handoverData?.catatanSerahTerima,
        MAX_LEN.ASG_NOTES
      ),
      ...(assignment.driveMedia?.folderId !== undefined
        ? {
            driveFolderId: clampString(
              assignment.driveMedia.folderId,
              MAX_LEN.ASG_DRIVE_ID
            ),
          }
        : {}),
      ...((assignment.driveMedia?.folderUrl || assignment.driveFolderUrl) !==
      undefined
        ? {
            driveFolderUrl: clampString(
              assignment.driveMedia?.folderUrl || assignment.driveFolderUrl,
              MAX_LEN.ASG_DRIVE_URL
            ),
          }
        : {}),
      ...(assignment.driveMedia?.fotoOdometerBerangkatUrl !== undefined
        ? {
            depOdoFotoUrl: clampString(
              assignment.driveMedia.fotoOdometerBerangkatUrl,
              MAX_LEN.ASG_DRIVE_URL
            ),
          }
        : {}),
      ...(assignment.driveMedia?.fotoSuhuBerangkatUrl !== undefined
        ? {
            depSuhuFotoUrl: clampString(
              assignment.driveMedia.fotoSuhuBerangkatUrl,
              MAX_LEN.ASG_DRIVE_URL
            ),
          }
        : {}),
      ...(assignment.driveMedia?.fotoOdometerSerahTerimaUrl !== undefined
        ? {
            hoOdoFotoUrl: clampString(
              assignment.driveMedia.fotoOdometerSerahTerimaUrl,
              MAX_LEN.ASG_DRIVE_URL
            ),
          }
        : {}),
      ...(assignment.driveMedia?.fotoSuhuSerahTerimaUrl !== undefined
        ? {
            hoSuhuFotoUrl: clampString(
              assignment.driveMedia.fotoSuhuSerahTerimaUrl,
              MAX_LEN.ASG_DRIVE_URL
            ),
          }
        : {}),
      ...(assignment.driveMedia?.fotoBuktiSerahTerimaUrl !== undefined
        ? {
            hoBuktiFotoUrl: clampString(
              assignment.driveMedia.fotoBuktiSerahTerimaUrl,
              MAX_LEN.ASG_DRIVE_URL
            ),
          }
        : {}),
      ...(assignment.driveMedia?.tandaTanganPenerimaUrl !== undefined
        ? {
            hoTtdUrl: clampString(
              assignment.driveMedia.tandaTanganPenerimaUrl,
              MAX_LEN.ASG_DRIVE_URL
            ),
          }
        : {}),
      ...(assignment.driveMedia?.syncedAt !== undefined
        ? {
            driveSyncedAt: clampString(
              assignment.driveMedia.syncedAt,
              MAX_LEN.ASG_TIMESTAMP
            ),
          }
        : {}),
      notes: embedDeliveredAtInFirestoreNotes(
        assignment.notes,
        assignment.deliveredAt
      ),
    };

    if (!snap.exists()) {
      try {
        await setDoc(ref, {
          id: docId,
          sequenceNumber: seqNum,
          noPenugasan: clampString(
            assignment.noPenugasan,
            MAX_LEN.ASG_NO_PENUGASAN,
            `ST-CRK/${seqNum}`
          ),
          ...mutableFields,
          ownerUid: activeUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          // Re-verify directly against server in case local cache was stale or a concurrent write already created this doc
          try {
            const serverSnap = await getDocFromServer(ref);
            if (!serverSnap.exists()) {
              handleFirestoreError(error, OperationType.CREATE, path);
            }
            snap = serverSnap;
          } catch {
            // Document exists on server under a different Google account's ownerUid; skip overwriting foreign doc
            return;
          }
        } else {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
    }

    const existingData = snap.data() as Record<string, unknown>;
    if (existingData.ownerUid && existingData.ownerUid !== activeUser.uid) {
      return;
    }

    if (shallowFieldsEqual(existingData, mutableFields)) {
      return;
    }

    // Respect terminal state locking if existing is 'Selesai' or 'Handover' and current user is not bootstrap admin,
    // while still allowing Action D (attaching Google Drive photo archive URLs without mutating operational fields)
    if (
      (existingData.status === TaskStatus.SELESAI ||
        existingData.status === TaskStatus.HANDOVER) &&
      String(activeUser.email || '').trim().toLowerCase() !==
        BOOTSTRAP_ADMIN_EMAIL
    ) {
      const archivePatch: Record<string, unknown> = {};
      const archiveKeys = [
        'driveFolderId',
        'driveFolderUrl',
        'depOdoFotoUrl',
        'depSuhuFotoUrl',
        'hoOdoFotoUrl',
        'hoSuhuFotoUrl',
        'hoBuktiFotoUrl',
        'hoTtdUrl',
        'driveSyncedAt',
      ] as const;
      for (const k of archiveKeys) {
        const val = (mutableFields as Record<string, unknown>)[k];
        if (val !== undefined && existingData[k] !== val) {
          archivePatch[k] = val;
        }
      }
      if (Object.keys(archivePatch).length === 0) {
        return;
      }
      try {
        await updateDoc(ref, {
          ...archivePatch,
          updatedAt: serverTimestamp(),
        });
      } catch (error) {
        handleFirestoreError(error, OperationType.UPDATE, path);
      }
      return;
    }

    try {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  });
}

export async function deleteAssignmentFromFirestore(
  user: User | null,
  assignmentId: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const docId = sanitizeFirestoreId(assignmentId, MAX_LEN.DOC_ID, 'asg');
  const path = `assignments/${docId}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'assignments', docId);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      if (isPermissionDeniedError(error)) return;
      handleFirestoreError(error, OperationType.GET, path);
    }
    if (!snap.exists()) return;
    try {
      await deleteDoc(ref);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  });
}

export async function deleteAllAssignmentsFromFirestore(
  user: User | null
): Promise<number> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return 0;
  let deletedCount = 0;
  try {
    const snap = await getDocs(
      query(collection(db, 'assignments'), where('ownerUid', '==', activeUser.uid))
    );
    for (const d of snap.docs) {
      try {
        await deleteDoc(doc(db, 'assignments', d.id));
        deletedCount += 1;
      } catch {
        // Ignore individual doc delete failure during full reset
      }
    }
  } catch {
    // Ignore list failure if offline or unauthenticated
  }
  return deletedCount;
}

export async function upsertConfigInFirestore(
  user: User | null,
  config: AppConfig,
  explicitAdminPin?: string
): Promise<void> {
  const activeUser = resolveActiveSyncUser(user);
  if (!activeUser) return;
  const path = `configs/${activeUser.uid}`;
  await withFirestoreDocLock(path, async () => {
    const ref = doc(db, 'configs', activeUser.uid);
    let snap;
    try {
      snap = await getDoc(ref);
    } catch (error) {
      handleFirestoreError(error, OperationType.GET, path);
    }

    const existingData = snap.exists()
      ? (snap.data() as Record<string, unknown>)
      : null;
    const existingCloudPin = String(existingData?.adminPin || '').trim();

    // Never downgrade an already customized PIN back to factory default '123456'
    const rawCandidatePin =
      explicitAdminPin !== undefined
        ? explicitAdminPin
        : config.adminPin !== undefined
        ? config.adminPin
        : existingCloudPin;
    const trimmedCandidatePin = clampString(rawCandidatePin, MAX_LEN.DRIVER_PIN);
    const effectivePin =
      existingCloudPin.length >= 4 &&
      existingCloudPin !== '123456' &&
      (!trimmedCandidatePin || trimmedCandidatePin === '123456')
        ? existingCloudPin
        : trimmedCandidatePin;

    const effectiveIsDefaultPin =
      effectivePin.length >= 4 && effectivePin !== '123456'
        ? false
        : existingData && existingData.isDefaultPin === false
        ? false
        : config.isDefaultPin !== false;

    const mutableFields = {
      spreadsheetId: clampString(config.spreadsheetId, MAX_LEN.CFG_SHEET_ID),
      spreadsheetTitle: clampString(
        config.spreadsheetTitle,
        MAX_LEN.CFG_SHEET_TITLE
      ),
      spreadsheetUrl: clampString(config.spreadsheetUrl, MAX_LEN.CFG_SHEET_URL),
      ...(config.driveRootFolderId !== undefined
        ? {
            driveRootFolderId: clampString(
              config.driveRootFolderId,
              MAX_LEN.CFG_DRIVE_ID
            ),
          }
        : {}),
      ...(config.driveRootFolderUrl !== undefined
        ? {
            driveRootFolderUrl: clampString(
              config.driveRootFolderUrl,
              MAX_LEN.CFG_DRIVE_URL
            ),
          }
        : {}),
      ...(config.publicPortalBaseUrl !== undefined
        ? {
            publicPortalBaseUrl: clampString(
              config.publicPortalBaseUrl,
              MAX_LEN.CFG_PORTAL_URL
            ),
          }
        : {}),
      dispatcherWaPhone: clampString(
        config.dispatcherWaPhone,
        MAX_LEN.CFG_WA_PHONE
      ),
      whatsappTargetMode:
        config.whatsappTargetMode === 'DIRECT'
          ? ('DIRECT' as const)
          : config.whatsappTargetMode === 'DRIVER'
          ? ('DRIVER' as const)
          : ('GROUP' as const),
      whatsappGroupName: clampString(
        config.whatsappGroupName,
        MAX_LEN.CFG_WA_GROUP_NAME
      ),
      whatsappGroupInviteUrl: clampString(
        config.whatsappGroupInviteUrl,
        MAX_LEN.CFG_WA_GROUP_URL
      ),
      letterPrefix: clampString(
        config.letterPrefix,
        MAX_LEN.CFG_PREFIX,
        'ST-CRK'
      ),
      lastSequence: Math.max(0, Math.floor(Number(config.lastSequence) || 0)),
      adminPin: effectivePin,
      isDefaultPin: effectiveIsDefaultPin,
    };

    if (!snap.exists()) {
      try {
        await setDoc(ref, {
          ...mutableFields,
          ownerUid: activeUser.uid,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        return;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          try {
            const serverSnap = await getDocFromServer(ref);
            if (!serverSnap.exists()) {
              handleFirestoreError(error, OperationType.CREATE, path);
            }
            snap = serverSnap;
          } catch {
            handleFirestoreError(error, OperationType.CREATE, path);
          }
        } else {
          handleFirestoreError(error, OperationType.CREATE, path);
        }
      }
    }

    if (
      shallowFieldsEqual(snap.data() as Record<string, unknown>, mutableFields)
    ) {
      return;
    }

    try {
      await updateDoc(ref, {
        ...mutableFields,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  });
}

// ============================================================================
// 5. Full Workspace Pull, Reconcile & Real-Time Listeners
// ============================================================================

export interface FirestoreWorkspaceSnapshot {
  hasAnyCloudData: boolean;
  config: Partial<AppConfig> | null;
  drivers: DriverMaster[];
  vehicles: VehicleMaster[];
  routes: RouteMaster[];
  fleetCards: FleetCardMaster[];
  driverExpenses: DriverExpense[];
  assignments: Assignment[];
}

function mapDocToDriverExpense(data: Record<string, unknown>): DriverExpense {
  const bbm =
    typeof data.totalPengirimanBbm === 'number' &&
    Number.isFinite(data.totalPengirimanBbm)
      ? Math.max(0, Math.round(data.totalPengirimanBbm))
      : 0;
  const tol =
    typeof data.totalPengeluaranTol === 'number' &&
    Number.isFinite(data.totalPengeluaranTol)
      ? Math.max(0, Math.round(data.totalPengeluaranTol))
      : 0;
  const total =
    typeof data.totalPengeluaran === 'number' &&
    Number.isFinite(data.totalPengeluaran)
      ? Math.max(0, Math.round(data.totalPengeluaran))
      : bbm + tol;
  return {
    id: String(data.id || ''),
    timestamp: String(data.timestamp || ''),
    tanggal: String(data.tanggal || ''),
    tanggalPengiriman:
      typeof data.tanggalPengiriman === 'string' &&
      data.tanggalPengiriman.trim()
        ? data.tanggalPengiriman.trim()
        : undefined,
    tujuanPengiriman:
      typeof data.tujuanPengiriman === 'string' && data.tujuanPengiriman.trim()
        ? data.tujuanPengiriman.trim()
        : undefined,
    driverId: String(data.driverCode || ''),
    driverName: String(data.driverName || ''),
    plateNumber:
      typeof data.plateNumber === 'string' && data.plateNumber.trim()
        ? data.plateNumber.trim()
        : undefined,
    completedAssignmentNos:
      typeof data.completedAssignmentNos === 'string' &&
      data.completedAssignmentNos.trim()
        ? data.completedAssignmentNos.trim()
        : undefined,
    fleetCardId: String(data.fleetCardId || '-'),
    fleetCardNumber: String(data.fleetCardNumber || ''),
    totalPengirimanBbm: bbm,
    fotoStrukBbmUrl:
      typeof data.fotoStrukBbmUrl === 'string' && data.fotoStrukBbmUrl.trim()
        ? data.fotoStrukBbmUrl.trim()
        : undefined,
    totalPengeluaranTol: tol,
    fotoStrukTolUrl:
      typeof data.fotoStrukTolUrl === 'string' && data.fotoStrukTolUrl.trim()
        ? data.fotoStrukTolUrl.trim()
        : undefined,
    totalPengeluaran: total,
    catatan:
      typeof data.catatan === 'string' && data.catatan.trim()
        ? data.catatan.trim()
        : undefined,
    ownerUid:
      typeof data.ownerUid === 'string' && data.ownerUid.trim()
        ? data.ownerUid.trim()
        : undefined,
  };
}

function mapDocToAssignment(data: Record<string, unknown>): Assignment {
  const depTimestamp = String(data.depTimestamp || '');
  const depTitikBerangkat = String(data.depTitikBerangkat || '');
  const rawDepJenis = String(data.depJenisKendaraan || '');
  const depJenisKendaraan: VehicleCoolingType | undefined =
    rawDepJenis === 'Mobil Pendingin' || rawDepJenis === 'Non Pendingin'
      ? rawDepJenis
      : undefined;

  const depKmAwal =
    typeof data.depKmAwal === 'number' && data.depKmAwal >= 0
      ? data.depKmAwal
      : 0;
  const hasDeparture =
    depTimestamp.length > 0 ||
    depTitikBerangkat.length > 0 ||
    (typeof data.depKmAwal === 'number' && data.depKmAwal >= 0) ||
    String(data.depSuhuAwal || '').length > 0;

  const hoTimestamp = String(data.hoTimestamp || '');
  const hoKmAkhir =
    typeof data.hoKmAkhir === 'number' && data.hoKmAkhir >= 0
      ? data.hoKmAkhir
      : 0;
  const hasHandover =
    hoTimestamp.length > 0 ||
    (typeof data.hoKmAkhir === 'number' && data.hoKmAkhir >= 0) ||
    String(data.hoPenerima || '').length > 0;

  const rawStatus = String(data.status || '');
  const status: TaskStatus =
    rawStatus === TaskStatus.SELESAI
      ? TaskStatus.SELESAI
      : rawStatus === TaskStatus.HANDOVER
      ? TaskStatus.HANDOVER
      : rawStatus === TaskStatus.DELIVERED
      ? TaskStatus.DELIVERED
      : rawStatus === TaskStatus.DALAM_PERJALANAN
      ? TaskStatus.DALAM_PERJALANAN
      : TaskStatus.MENUNGGU_BERANGKAT;

  const originText =
    depTitikBerangkat ||
    String(data.origin || '') ||
    'Menunggu Titik Keberangkatan Driver';

  return {
    id: String(data.id || ''),
    sequenceNumber: Math.max(1, Math.floor(Number(data.sequenceNumber) || 1)),
    noPenugasan: String(data.noPenugasan || ''),
    noSuratJalanFisik: String(data.noSuratJalanFisik || ''),
    kodeSegel: String(data.kodeSegel || ''),
    createdAt: timestampToIso(data.createdAt),
    tanggalTugas: String(data.tanggalTugas || ''),
    jadwalJamTiba: String(data.jadwalJamTiba || ''),
    driverId: String(data.driverCode || ''),
    driverCode: String(data.driverCode || ''),
    driverName: String(data.driverName || ''),
    driverPhone: String(data.driverPhone || ''),
    vehicleId: String(data.vehicleCode || ''),
    plateNumber: String(data.plateNumber || ''),
    vehicleType: String(data.vehicleType || ''),
    originId: String(data.originCode || ''),
    origin: originText,
    routeId: String(data.routeCode || ''),
    destination: String(data.destination || ''),
    purpose: String(data.purpose || ''),
    beratMuatan:
      typeof data.beratMuatan === 'string' && data.beratMuatan.trim()
        ? data.beratMuatan.trim()
        : undefined,
    volumeCbm:
      typeof data.volumeCbm === 'string' && data.volumeCbm.trim()
        ? data.volumeCbm.trim()
        : undefined,
    status,
    deliveredAt:
      extractDeliveredAtFromFirestoreNotes(String(data.notes || ''))
        .deliveredAt ||
      (typeof data.deliveredAt === 'string' && data.deliveredAt.trim()
        ? data.deliveredAt.trim()
        : status === TaskStatus.DELIVERED && data.updatedAt
        ? timestampToIso(data.updatedAt)
        : undefined),
    departureData: hasDeparture
      ? {
          timestamp: depTimestamp,
          titikKeberangkatan:
            depTitikBerangkat ||
            (originText !== 'Menunggu Titik Keberangkatan Driver'
              ? originText
              : undefined),
          jenisKendaraan: depJenisKendaraan || 'Mobil Pendingin',
          kmAwal: depKmAwal,
          suhuAwal: String(data.depSuhuAwal || ''),
          bbmAwal: String(data.depBbmAwal || ''),
          kondisiKendaraan: String(data.depKondisi || ''),
          catatanBerangkat: String(data.depCatatan || ''),
        }
      : undefined,
    handoverData: hasHandover
      ? {
          timestamp: hoTimestamp,
          kmAkhir: hoKmAkhir,
          suhuAkhir: String(data.hoSuhuAkhir || ''),
          bbmAkhir: String(data.hoBbmAkhir || ''),
          penerimaNama: String(data.hoPenerima || ''),
          kondisiAkhir: String(data.hoKondisi || ''),
          catatanSerahTerima: String(data.hoCatatan || ''),
        }
      : undefined,
    driveFolderUrl:
      typeof data.driveFolderUrl === 'string' && data.driveFolderUrl.trim()
        ? data.driveFolderUrl.trim()
        : undefined,
    driveMedia:
      (typeof data.driveFolderId === 'string' && data.driveFolderId.trim()) ||
      (typeof data.driveFolderUrl === 'string' && data.driveFolderUrl.trim()) ||
      (typeof data.depOdoFotoUrl === 'string' && data.depOdoFotoUrl.trim()) ||
      (typeof data.depSuhuFotoUrl === 'string' && data.depSuhuFotoUrl.trim()) ||
      (typeof data.hoOdoFotoUrl === 'string' && data.hoOdoFotoUrl.trim()) ||
      (typeof data.hoSuhuFotoUrl === 'string' && data.hoSuhuFotoUrl.trim()) ||
      (typeof data.hoBuktiFotoUrl === 'string' && data.hoBuktiFotoUrl.trim()) ||
      (typeof data.hoTtdUrl === 'string' && data.hoTtdUrl.trim())
        ? {
            folderId:
              typeof data.driveFolderId === 'string' &&
              data.driveFolderId.trim()
                ? data.driveFolderId.trim()
                : undefined,
            folderUrl:
              typeof data.driveFolderUrl === 'string' &&
              data.driveFolderUrl.trim()
                ? data.driveFolderUrl.trim()
                : undefined,
            fotoOdometerBerangkatUrl:
              typeof data.depOdoFotoUrl === 'string' &&
              data.depOdoFotoUrl.trim()
                ? data.depOdoFotoUrl.trim()
                : undefined,
            fotoSuhuBerangkatUrl:
              typeof data.depSuhuFotoUrl === 'string' &&
              data.depSuhuFotoUrl.trim()
                ? data.depSuhuFotoUrl.trim()
                : undefined,
            fotoOdometerSerahTerimaUrl:
              typeof data.hoOdoFotoUrl === 'string' && data.hoOdoFotoUrl.trim()
                ? data.hoOdoFotoUrl.trim()
                : undefined,
            fotoSuhuSerahTerimaUrl:
              typeof data.hoSuhuFotoUrl === 'string' &&
              data.hoSuhuFotoUrl.trim()
                ? data.hoSuhuFotoUrl.trim()
                : undefined,
            fotoBuktiSerahTerimaUrl:
              typeof data.hoBuktiFotoUrl === 'string' &&
              data.hoBuktiFotoUrl.trim()
                ? data.hoBuktiFotoUrl.trim()
                : undefined,
            tandaTanganPenerimaUrl:
              typeof data.hoTtdUrl === 'string' && data.hoTtdUrl.trim()
                ? data.hoTtdUrl.trim()
                : undefined,
            syncedAt:
              typeof data.driveSyncedAt === 'string' &&
              data.driveSyncedAt.trim()
                ? data.driveSyncedAt.trim()
                : undefined,
          }
        : undefined,
    notes: extractDeliveredAtFromFirestoreNotes(String(data.notes || ''))
      .cleanNotes,
    ownerUid:
      typeof data.ownerUid === 'string' && data.ownerUid.trim()
        ? data.ownerUid.trim()
        : undefined,
    submittedByDriverUid:
      typeof data.submittedByDriverUid === 'string' &&
      data.submittedByDriverUid.trim()
        ? data.submittedByDriverUid.trim()
        : undefined,
  };
}

async function hydrateDriverSecrets(
  driverDocs: Array<Record<string, unknown>>
): Promise<DriverMaster[]> {
  return Promise.all(
    driverDocs.map(async (pub) => {
      const drvId = String(pub.id || '');
      const secretPath = `drivers/${drvId}/private/credentials`;
      let phone = '';
      let pin = '';
      try {
        const secretSnap = await getDoc(
          doc(db, 'drivers', drvId, 'private', 'credentials')
        );
        if (secretSnap.exists()) {
          const secData = secretSnap.data();
          phone = String(secData.phone || '');
          pin = String(secData.pin || '');
        }
      } catch (error) {
        handleFirestoreError(error, OperationType.GET, secretPath);
      }
      return {
        id: drvId,
        name: String(pub.name || ''),
        phone,
        pin,
        licenseType: String(pub.licenseType || ''),
        active: pub.active !== false,
      };
    })
  );
}

export async function pullWorkspaceFromFirestore(
  user: User
): Promise<FirestoreWorkspaceSnapshot | null> {
  if (!canSyncWithUser(user)) return null;

  await ensureAdminBootstrapRecord(user);

  const ownerFilter = where('ownerUid', '==', user.uid);
  const configPath = `configs/${user.uid}`;

  let configSnap;
  try {
    configSnap = await getDoc(doc(db, 'configs', user.uid));
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, configPath);
  }

  let driversSnap;
  try {
    driversSnap = await getDocs(query(collection(db, 'drivers'), ownerFilter));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'drivers');
  }

  let vehiclesSnap;
  try {
    vehiclesSnap = await getDocs(
      query(collection(db, 'vehicles'), ownerFilter)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'vehicles');
  }

  let routesSnap;
  try {
    routesSnap = await getDocs(query(collection(db, 'routes'), ownerFilter));
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'routes');
  }

  let fleetCardsSnap;
  try {
    fleetCardsSnap = await getDocs(
      query(collection(db, 'fleet_cards'), ownerFilter)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'fleet_cards');
  }

  let driverExpensesSnap;
  try {
    driverExpensesSnap = await getDocs(
      query(collection(db, 'driver_expenses'), ownerFilter)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'driver_expenses');
  }

  let assignmentsSnap;
  try {
    assignmentsSnap = await getDocs(
      query(collection(db, 'assignments'), ownerFilter)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'assignments');
  }

  const drivers = await hydrateDriverSecrets(
    driversSnap.docs.map((d) => d.data() as Record<string, unknown>)
  );

  const vehicles: VehicleMaster[] = vehiclesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: String(data.id || d.id),
      plateNumber: String(data.plateNumber || ''),
      vehicleType: String(data.vehicleType || ''),
      capacity: String(data.capacity || ''),
      capacityCbm:
        typeof data.capacityCbm === 'string' && data.capacityCbm.trim()
          ? data.capacityCbm.trim()
          : undefined,
      status:
        data.status === 'Dalam Tugas' || data.status === 'Perawatan'
          ? data.status
          : 'Siap Jalan',
    };
  });

  const routes: RouteMaster[] = routesSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: String(data.id || d.id),
      destination: String(data.destination || ''),
      picName: String(data.picName || ''),
      picPhone: String(data.picPhone || ''),
    };
  });

  const fleetCards: FleetCardMaster[] = fleetCardsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: String(data.id || d.id),
      cardNumber: String(data.cardNumber || ''),
      balance:
        typeof data.balance === 'number' && Number.isFinite(data.balance)
          ? Math.round(data.balance)
          : 0,
    };
  });

  const driverExpenses: DriverExpense[] = driverExpensesSnap.docs.map((d) =>
    mapDocToDriverExpense(d.data() as Record<string, unknown>)
  );

  const assignments: Assignment[] = assignmentsSnap.docs.map((d) =>
    mapDocToAssignment(d.data() as Record<string, unknown>)
  );

  let config: Partial<AppConfig> | null = null;
  if (configSnap.exists()) {
    const cfg = configSnap.data();
    const pulledPin =
      typeof cfg.adminPin === 'string' && cfg.adminPin.trim()
        ? cfg.adminPin.trim()
        : undefined;
    config = {
      spreadsheetId: String(cfg.spreadsheetId || ''),
      spreadsheetTitle: String(cfg.spreadsheetTitle || ''),
      spreadsheetUrl: String(cfg.spreadsheetUrl || ''),
      driveRootFolderId:
        typeof cfg.driveRootFolderId === 'string'
          ? cfg.driveRootFolderId
          : undefined,
      driveRootFolderUrl:
        typeof cfg.driveRootFolderUrl === 'string'
          ? cfg.driveRootFolderUrl
          : undefined,
      publicPortalBaseUrl:
        typeof cfg.publicPortalBaseUrl === 'string'
          ? cfg.publicPortalBaseUrl
          : undefined,
      dispatcherWaPhone: String(cfg.dispatcherWaPhone || ''),
      whatsappTargetMode:
        cfg.whatsappTargetMode === 'DIRECT'
          ? 'DIRECT'
          : cfg.whatsappTargetMode === 'DRIVER'
          ? 'DRIVER'
          : 'GROUP',
      whatsappGroupName: String(cfg.whatsappGroupName || ''),
      whatsappGroupInviteUrl: String(cfg.whatsappGroupInviteUrl || ''),
      letterPrefix: String(cfg.letterPrefix || 'ST-CRK'),
      lastSequence: Math.max(0, Math.floor(Number(cfg.lastSequence) || 0)),
      adminPin: pulledPin,
      isDefaultPin:
        typeof cfg.isDefaultPin === 'boolean' ? cfg.isDefaultPin : undefined,
    };
  }

  const hasAnyCloudData =
    configSnap.exists() ||
    drivers.length > 0 ||
    vehicles.length > 0 ||
    routes.length > 0 ||
    fleetCards.length > 0 ||
    driverExpenses.length > 0 ||
    assignments.length > 0;

  return {
    hasAnyCloudData,
    config,
    drivers,
    vehicles,
    routes,
    fleetCards,
    driverExpenses,
    assignments,
  };
}

export async function reconcileFullStateToFirestore(
  user: User | null,
  state: AppStateResponse,
  pruneExtraneous = false,
  explicitAdminPin?: string
): Promise<void> {
  if (!canSyncWithUser(user)) return;

  await ensureAdminBootstrapRecord(user);
  await upsertConfigInFirestore(user, state.config, explicitAdminPin);

  for (const drv of state.drivers) {
    await upsertDriverInFirestore(user, drv);
  }
  for (const veh of state.vehicles) {
    await upsertVehicleInFirestore(user, veh);
  }
  for (const rt of state.routes) {
    await upsertRouteInFirestore(user, rt);
  }
  for (const fc of state.fleetCards || []) {
    await upsertFleetCardInFirestore(user, fc);
  }
  for (const exp of state.driverExpenses || []) {
    await upsertDriverExpenseInFirestore(user, exp);
  }
  for (const asg of state.assignments) {
    await upsertAssignmentInFirestore(user, asg);
  }

  if (pruneExtraneous) {
    const currentCloud = await pullWorkspaceFromFirestore(user);
    if (!currentCloud) return;

    const validDriverIds = new Set(
      state.drivers.map((d) => sanitizeFirestoreId(d.id, MAX_LEN.CODE_ID, 'DRV'))
    );
    for (const cDrv of currentCloud.drivers) {
      if (!validDriverIds.has(cDrv.id)) {
        await deleteDriverFromFirestore(user, cDrv.id);
      }
    }

    const validVehicleIds = new Set(
      state.vehicles.map((v) =>
        sanitizeFirestoreId(v.id, MAX_LEN.CODE_ID, 'UNT')
      )
    );
    for (const cVeh of currentCloud.vehicles) {
      if (!validVehicleIds.has(cVeh.id)) {
        await deleteVehicleFromFirestore(user, cVeh.id);
      }
    }

    const validRouteIds = new Set(
      state.routes.map((r) => sanitizeFirestoreId(r.id, MAX_LEN.CODE_ID, 'RT'))
    );
    for (const cRt of currentCloud.routes) {
      if (!validRouteIds.has(cRt.id)) {
        await deleteRouteFromFirestore(user, cRt.id);
      }
    }

    const validFleetCardIds = new Set(
      (state.fleetCards || []).map((fc) =>
        sanitizeFirestoreId(fc.id, MAX_LEN.CODE_ID, 'FC')
      )
    );
    for (const cFc of currentCloud.fleetCards) {
      if (!validFleetCardIds.has(cFc.id)) {
        await deleteFleetCardFromFirestore(user, cFc.id);
      }
    }

    const validExpIds = new Set(
      (state.driverExpenses || []).map((e) =>
        sanitizeFirestoreId(e.id, MAX_LEN.DOC_ID, 'EXP')
      )
    );
    for (const cExp of currentCloud.driverExpenses) {
      if (!validExpIds.has(cExp.id)) {
        await deleteDriverExpenseFromFirestore(user, cExp.id);
      }
    }

    const validAsgIds = new Set(
      state.assignments.map((a) =>
        sanitizeFirestoreId(a.id, MAX_LEN.DOC_ID, 'asg')
      )
    );
    for (const cAsg of currentCloud.assignments) {
      if (!validAsgIds.has(cAsg.id)) {
        await deleteAssignmentFromFirestore(user, cAsg.id);
      }
    }
  }
}

export function subscribeToFirestoreWorkspace(
  user: User,
  onUpdate: (partial: Partial<FirestoreWorkspaceSnapshot>) => void
): () => void {
  if (!canSyncWithUser(user)) {
    return () => undefined;
  }

  const ownerFilter = where('ownerUid', '==', user.uid);
  const unsubscribes: Array<() => void> = [];

  unsubscribes.push(
    onSnapshot(
      doc(db, 'configs', user.uid),
      (snap) => {
        if (snap.metadata.hasPendingWrites || !snap.exists()) return;
        const cfg = snap.data();
        const pulledPin =
          typeof cfg.adminPin === 'string' && cfg.adminPin.trim()
            ? cfg.adminPin.trim()
            : undefined;
        onUpdate({
          config: {
            spreadsheetId: String(cfg.spreadsheetId || ''),
            spreadsheetTitle: String(cfg.spreadsheetTitle || ''),
            spreadsheetUrl: String(cfg.spreadsheetUrl || ''),
            driveRootFolderId:
              typeof cfg.driveRootFolderId === 'string'
                ? cfg.driveRootFolderId
                : undefined,
            driveRootFolderUrl:
              typeof cfg.driveRootFolderUrl === 'string'
                ? cfg.driveRootFolderUrl
                : undefined,
            publicPortalBaseUrl:
              typeof cfg.publicPortalBaseUrl === 'string'
                ? cfg.publicPortalBaseUrl
                : undefined,
            dispatcherWaPhone: String(cfg.dispatcherWaPhone || ''),
            whatsappTargetMode:
              cfg.whatsappTargetMode === 'DIRECT'
                ? 'DIRECT'
                : cfg.whatsappTargetMode === 'DRIVER'
                ? 'DRIVER'
                : 'GROUP',
            whatsappGroupName: String(cfg.whatsappGroupName || ''),
            whatsappGroupInviteUrl: String(cfg.whatsappGroupInviteUrl || ''),
            letterPrefix: String(cfg.letterPrefix || 'ST-CRK'),
            lastSequence: Math.max(0, Math.floor(Number(cfg.lastSequence) || 0)),
            adminPin: pulledPin,
            isDefaultPin:
              typeof cfg.isDefaultPin === 'boolean'
                ? cfg.isDefaultPin
                : undefined,
          },
        });
      },
      (error) => {
        handleFirestoreError(error, OperationType.GET, `configs/${user.uid}`);
      }
    )
  );

  unsubscribes.push(
    onSnapshot(
      query(collection(db, 'drivers'), ownerFilter),
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        void hydrateDriverSecrets(
          snap.docs.map((d) => d.data() as Record<string, unknown>)
        )
          .then((drivers) => {
            onUpdate({ drivers });
          })
          .catch(() => {
            // Transient parent deletion between list snapshot and secret fetch is resolved by next snapshot
          });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'drivers');
      }
    )
  );

  unsubscribes.push(
    onSnapshot(
      query(collection(db, 'vehicles'), ownerFilter),
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const vehicles: VehicleMaster[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            plateNumber: String(data.plateNumber || ''),
            vehicleType: String(data.vehicleType || ''),
            capacity: String(data.capacity || ''),
            capacityCbm:
              typeof data.capacityCbm === 'string' && data.capacityCbm.trim()
                ? data.capacityCbm.trim()
                : undefined,
            status:
              data.status === 'Dalam Tugas' || data.status === 'Perawatan'
                ? data.status
                : 'Siap Jalan',
          };
        });
        onUpdate({ vehicles });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'vehicles');
      }
    )
  );

  unsubscribes.push(
    onSnapshot(
      query(collection(db, 'routes'), ownerFilter),
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const routes: RouteMaster[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            destination: String(data.destination || ''),
            picName: String(data.picName || ''),
            picPhone: String(data.picPhone || ''),
          };
        });
        onUpdate({ routes });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'routes');
      }
    )
  );

  unsubscribes.push(
    onSnapshot(
      query(collection(db, 'fleet_cards'), ownerFilter),
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const fleetCards: FleetCardMaster[] = snap.docs.map((d) => {
          const data = d.data();
          return {
            id: String(data.id || d.id),
            cardNumber: String(data.cardNumber || ''),
            balance:
              typeof data.balance === 'number' && Number.isFinite(data.balance)
                ? Math.round(data.balance)
                : 0,
          };
        });
        onUpdate({ fleetCards });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'fleet_cards');
      }
    )
  );

  unsubscribes.push(
    onSnapshot(
      query(collection(db, 'driver_expenses'), ownerFilter),
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const driverExpenses: DriverExpense[] = snap.docs.map((d) =>
          mapDocToDriverExpense(d.data() as Record<string, unknown>)
        );
        onUpdate({ driverExpenses });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'driver_expenses');
      }
    )
  );

  unsubscribes.push(
    onSnapshot(
      query(collection(db, 'assignments'), ownerFilter),
      (snap) => {
        if (snap.metadata.hasPendingWrites) return;
        const assignments: Assignment[] = snap.docs.map((d) =>
          mapDocToAssignment(d.data() as Record<string, unknown>)
        );
        onUpdate({ assignments });
      },
      (error) => {
        handleFirestoreError(error, OperationType.LIST, 'assignments');
      }
    )
  );

  return () => {
    for (const unsub of unsubscribes) {
      unsub();
    }
  };
}

// ============================================================================
// 6. Portal Driver Resilient Report Submission + Fallback Identity + Pending Sync Queue
// ============================================================================

export const PENDING_REPORT_SYNC_KEY = 'pending_report_sync';
export const PENDING_REPORT_SYNC_ITEM_PREFIX = 'pending_report_sync_';

export type DriverReportStage = 'KEBERANGKATAN' | 'DELIVERED' | 'SERAH_TERIMA';

export interface DriverDepartureSubmitPayload {
  titikKeberangkatan: string;
  jenisKendaraan: VehicleCoolingType;
  kmAwal: number;
  suhuAwal: string;
  bbmAwal: string;
  kondisiKendaraan: string;
  catatanBerangkat: string;
  fotoOdometerBerangkat?: string;
  fotoSuhuBerangkat?: string;
}

export interface DriverHandoverSubmitPayload {
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
}

export interface PendingReportSyncItem {
  queueId: string;
  assignmentId: string;
  noPenugasan: string;
  driverId: string;
  submittedByDriverUid: string;
  usedFallbackIdentity: boolean;
  stage: DriverReportStage;
  serverSynced: boolean;
  firestoreSynced: boolean;
  photosStoredInVault?: boolean;
  createdAt: string;
  updatedAt: string;
  attemptCount: number;
  lastError: string;
  departurePayload?: DriverDepartureSubmitPayload;
  deliveredCatatan?: string;
  handoverPayload?: DriverHandoverSubmitPayload;
  assignmentSnapshot: Assignment;
}

export type PendingItemRetryPhase = 'idle' | 'retrying' | 'synced' | 'failed';

export interface PendingItemRetryStatus {
  queueId: string;
  phase: PendingItemRetryPhase;
  updatedAtMs: number;
  message?: string;
}

type PendingQueueListener = (items: PendingReportSyncItem[]) => void;
const pendingQueueListeners = new Set<PendingQueueListener>();

type PendingItemRetryStatusListener = (
  statuses: Record<string, PendingItemRetryStatus>
) => void;
const pendingItemRetryListeners = new Set<PendingItemRetryStatusListener>();
const pendingItemRetryStatuses = new Map<string, PendingItemRetryStatus>();

function snapshotPendingItemRetryStatuses(): Record<
  string,
  PendingItemRetryStatus
> {
  const out: Record<string, PendingItemRetryStatus> = {};
  for (const [k, v] of pendingItemRetryStatuses.entries()) {
    out[k] = v;
  }
  return out;
}

function notifyPendingItemRetryListeners(): void {
  const snapshot = snapshotPendingItemRetryStatuses();
  for (const listener of pendingItemRetryListeners) {
    try {
      listener(snapshot);
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function setPendingItemRetryStatus(
  queueId: string,
  phase: PendingItemRetryPhase,
  message?: string
): void {
  if (!queueId) return;
  pendingItemRetryStatuses.set(queueId, {
    queueId,
    phase,
    updatedAtMs: Date.now(),
    message,
  });
  notifyPendingItemRetryListeners();
}

export function clearPendingItemRetryStatus(queueId: string): void {
  if (!queueId) return;
  if (pendingItemRetryStatuses.delete(queueId)) {
    notifyPendingItemRetryListeners();
  }
}

export function readPendingItemRetryStatuses(): Record<
  string,
  PendingItemRetryStatus
> {
  return snapshotPendingItemRetryStatuses();
}

export function subscribePendingItemRetryStatuses(
  listener: PendingItemRetryStatusListener
): () => void {
  pendingItemRetryListeners.add(listener);
  return () => {
    pendingItemRetryListeners.delete(listener);
  };
}

export function humanizePendingSyncError(
  rawError: string | undefined,
  isOnline = true
): string {
  if (!isOnline) {
    return 'Perangkat sedang luring (tanpa sinyal internet). Otomatis dikirim saat sinyal kembali.';
  }
  const text = String(rawError || '').trim();
  if (!text) {
    return 'Menunggu giliran sinkronisasi ke Cloud Database.';
  }
  let extracted = text;
  if (text.startsWith('{') && text.includes('"error"')) {
    try {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed.error) {
        extracted = parsed.error;
      }
    } catch {
      // Keep original text
    }
  }
  const lower = extracted.toLowerCase();
  if (
    lower.includes('offline') ||
    lower.includes('network') ||
    lower.includes('failed to fetch') ||
    lower.includes('unavailable')
  ) {
    return 'Jaringan ke server/cloud belum stabil. Siap dicoba ulang.';
  }
  if (lower.includes('html') || lower.includes('<!doctype')) {
    return 'Jaringan seluler mengembalikan halaman portal operator. Siap dicoba ulang.';
  }
  if (lower.includes('quota')) {
    return 'Kuota harian database tercapai sementara. Aman tersimpan di memori HP.';
  }
  if (lower.includes('permission') || lower.includes('insufficient')) {
    return 'Menunggu sinkronisasi dokumen Surat Tugas utama di Cloud.';
  }
  if (lower.includes('deadline') || lower.includes('timeout')) {
    return 'Waktu koneksi habis karena sinyal lemah. Siap dicoba ulang.';
  }
  return extracted.length > 110 ? `${extracted.slice(0, 107)}...` : extracted;
}

function notifyPendingQueueListeners(items: PendingReportSyncItem[]): void {
  for (const listener of pendingQueueListeners) {
    try {
      listener(items);
    } catch {
      // Ignore subscriber errors
    }
  }
}

export function subscribePendingReportSyncQueue(
  listener: PendingQueueListener
): () => void {
  pendingQueueListeners.add(listener);
  return () => {
    pendingQueueListeners.delete(listener);
  };
}

export function readPendingReportSyncQueue(): PendingReportSyncItem[] {
  if (typeof window === 'undefined') return [];
  const byQueueId = new Map<string, PendingReportSyncItem>();

  try {
    const raw = window.localStorage.getItem(PENDING_REPORT_SYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          if (
            item &&
            typeof item === 'object' &&
            item.queueId &&
            item.assignmentId
          ) {
            byQueueId.set(item.queueId, item as PendingReportSyncItem);
          }
        }
      }
    }
  } catch {
    // Ignore parse error on primary queue key
  }

  // Also scan per-assignment keys (`pending_report_sync_` + assignmentId)
  try {
    for (let idx = 0; idx < window.localStorage.length; idx += 1) {
      const key = window.localStorage.key(idx);
      if (!key || !key.startsWith(PENDING_REPORT_SYNC_ITEM_PREFIX)) continue;
      const rawPerAsg = window.localStorage.getItem(key);
      if (!rawPerAsg) continue;
      const parsedItem = JSON.parse(rawPerAsg);
      if (
        parsedItem &&
        typeof parsedItem === 'object' &&
        parsedItem.queueId &&
        parsedItem.assignmentId &&
        !byQueueId.has(parsedItem.queueId)
      ) {
        byQueueId.set(parsedItem.queueId, parsedItem as PendingReportSyncItem);
      }
    }
  } catch {
    // Ignore storage iteration restrictions
  }

  return Array.from(byQueueId.values());
}

/**
 * Scans `window.localStorage` directly for all remaining `'pending_report_sync_'` keys
 * (plus any remaining items in `'pending_report_sync'`) so Background Auto-Retry Sync
 * can re-execute `submitReportToFirestoreWithOfflineRecovery` and clean up `localStorage`.
 */
export function readLocalStoragePendingReportSyncEntries(): {
  storageKey: string;
  item: PendingReportSyncItem;
}[] {
  if (typeof window === 'undefined') return [];
  const entriesByAssignmentStage = new Map<
    string,
    { storageKey: string; item: PendingReportSyncItem }
  >();

  try {
    for (let idx = 0; idx < window.localStorage.length; idx += 1) {
      const key = window.localStorage.key(idx);
      if (!key || !key.startsWith(PENDING_REPORT_SYNC_ITEM_PREFIX)) continue;

      const rawValue = window.localStorage.getItem(key);
      if (!rawValue) continue;

      try {
        const parsed = JSON.parse(rawValue) as Partial<PendingReportSyncItem>;
        const inferredAssignmentId =
          parsed.assignmentId ||
          key.slice(PENDING_REPORT_SYNC_ITEM_PREFIX.length);
        if (!inferredAssignmentId || !parsed.assignmentSnapshot) continue;

        const inferredStage: DriverReportStage =
          parsed.stage === 'DELIVERED' || parsed.stage === 'SERAH_TERIMA'
            ? parsed.stage
            : 'KEBERANGKATAN';
        const queueId =
          parsed.queueId || `${inferredAssignmentId}__${inferredStage}`;

        const normalizedItem: PendingReportSyncItem = {
          queueId,
          assignmentId: inferredAssignmentId,
          noPenugasan:
            parsed.noPenugasan ||
            parsed.assignmentSnapshot.noPenugasan ||
            inferredAssignmentId,
          driverId:
            parsed.driverId ||
            parsed.assignmentSnapshot.driverId ||
            parsed.submittedByDriverUid ||
            'DRV-000',
          submittedByDriverUid:
            parsed.submittedByDriverUid ||
            parsed.assignmentSnapshot.driverCode ||
            parsed.assignmentSnapshot.driverId ||
            'DRV-000',
          usedFallbackIdentity: Boolean(parsed.usedFallbackIdentity),
          stage: inferredStage,
          serverSynced: Boolean(parsed.serverSynced),
          firestoreSynced: Boolean(parsed.firestoreSynced),
          photosStoredInVault: Boolean(parsed.photosStoredInVault),
          createdAt: parsed.createdAt || new Date().toISOString(),
          updatedAt: parsed.updatedAt || new Date().toISOString(),
          attemptCount:
            typeof parsed.attemptCount === 'number' ? parsed.attemptCount : 1,
          lastError: parsed.lastError || '',
          departurePayload: parsed.departurePayload,
          deliveredCatatan: parsed.deliveredCatatan,
          handoverPayload: parsed.handoverPayload,
          assignmentSnapshot: parsed.assignmentSnapshot,
        };

        entriesByAssignmentStage.set(queueId, {
          storageKey: key,
          item: normalizedItem,
        });
      } catch {
        // Remove corrupted unparseable entry so phone storage does not stay polluted
        try {
          window.localStorage.removeItem(key);
        } catch {
          // Ignore
        }
      }
    }
  } catch {
    // Ignore storage iteration restrictions
  }

  for (const queuedItem of readPendingReportSyncQueue()) {
    if (!entriesByAssignmentStage.has(queuedItem.queueId)) {
      entriesByAssignmentStage.set(queuedItem.queueId, {
        storageKey: `${PENDING_REPORT_SYNC_ITEM_PREFIX}${queuedItem.assignmentId}`,
        item: queuedItem,
      });
    }
  }

  return Array.from(entriesByAssignmentStage.values());
}

function stripHeavyPhotosFromQueueItem(
  item: PendingReportSyncItem
): {
  compactItem: PendingReportSyncItem;
  extractedPhotos: PendingSyncPhotoBundle | null;
} {
  const photos: PendingSyncPhotoBundle = {
    fotoOdometerBerangkat:
      item.departurePayload?.fotoOdometerBerangkat ||
      item.assignmentSnapshot.departureData?.fotoOdometerBerangkat,
    fotoSuhuBerangkat:
      item.departurePayload?.fotoSuhuBerangkat ||
      item.assignmentSnapshot.departureData?.fotoSuhuBerangkat,
    fotoOdometerSerahTerima:
      item.handoverPayload?.fotoOdometerSerahTerima ||
      item.assignmentSnapshot.handoverData?.fotoOdometerSerahTerima,
    fotoSuhuSerahTerima:
      item.handoverPayload?.fotoSuhuSerahTerima ||
      item.assignmentSnapshot.handoverData?.fotoSuhuSerahTerima,
    fotoBuktiSerahTerima:
      item.handoverPayload?.fotoBuktiSerahTerima ||
      item.assignmentSnapshot.handoverData?.fotoBuktiSerahTerima,
    tandaTanganPenerima:
      item.handoverPayload?.tandaTanganPenerima ||
      item.assignmentSnapshot.handoverData?.tandaTanganPenerima,
  };

  const hasAnyPhoto = Object.values(photos).some((v) => Boolean(v));
  const compactSnapshot: Assignment = {
    ...item.assignmentSnapshot,
    departureData: item.assignmentSnapshot.departureData
      ? {
          ...item.assignmentSnapshot.departureData,
          fotoOdometerBerangkat: undefined,
          fotoSuhuBerangkat: undefined,
        }
      : undefined,
    handoverData: item.assignmentSnapshot.handoverData
      ? {
          ...item.assignmentSnapshot.handoverData,
          fotoOdometerSerahTerima: undefined,
          fotoSuhuSerahTerima: undefined,
          fotoBuktiSerahTerima: undefined,
          tandaTanganPenerima: undefined,
        }
      : undefined,
  };

  return {
    compactItem: {
      ...item,
      photosStoredInVault: hasAnyPhoto,
      departurePayload: item.departurePayload
        ? {
            ...item.departurePayload,
            fotoOdometerBerangkat: undefined,
            fotoSuhuBerangkat: undefined,
          }
        : undefined,
      handoverPayload: item.handoverPayload
        ? {
            ...item.handoverPayload,
            fotoOdometerSerahTerima: undefined,
            fotoSuhuSerahTerima: undefined,
            fotoBuktiSerahTerima: undefined,
            tandaTanganPenerima: undefined,
          }
        : undefined,
      assignmentSnapshot: compactSnapshot,
    },
    extractedPhotos: hasAnyPhoto ? photos : null,
  };
}

function writePendingReportSyncQueue(items: PendingReportSyncItem[]): void {
  if (typeof window === 'undefined') return;
  if (items.length === 0) {
    try {
      window.localStorage.removeItem(PENDING_REPORT_SYNC_KEY);
    } catch {
      // Ignore
    }
    notifyPendingQueueListeners([]);
    return;
  }

  try {
    window.localStorage.setItem(PENDING_REPORT_SYNC_KEY, JSON.stringify(items));
    notifyPendingQueueListeners(items);
  } catch {
    // Fallback if base64 camera photos exceed 5MB localStorage quota on mobile:
    // keep full photos safely in IndexedDB and store compact payload in `pending_report_sync`
    const compacted = items.map((entry) => {
      const { compactItem, extractedPhotos } =
        stripHeavyPhotosFromQueueItem(entry);
      if (extractedPhotos) {
        void savePendingReportPhotosToVault(entry.queueId, extractedPhotos);
      }
      return compactItem;
    });
    try {
      window.localStorage.setItem(
        PENDING_REPORT_SYNC_KEY,
        JSON.stringify(compacted)
      );
    } catch {
      // Ignore if storage completely locked
    }
    notifyPendingQueueListeners(compacted);
  }
}

export function writePerAssignmentPendingSyncRecord(
  assignmentId: string,
  item: PendingReportSyncItem
): void {
  if (typeof window === 'undefined' || !assignmentId) return;
  const perAssignmentKey = `${PENDING_REPORT_SYNC_ITEM_PREFIX}${assignmentId}`;
  try {
    window.localStorage.setItem(perAssignmentKey, JSON.stringify(item));
  } catch {
    const { compactItem, extractedPhotos } = stripHeavyPhotosFromQueueItem(item);
    if (extractedPhotos) {
      void savePendingReportPhotosToVault(item.queueId, extractedPhotos);
    }
    try {
      window.localStorage.setItem(perAssignmentKey, JSON.stringify(compactItem));
    } catch {
      // Ignore if storage completely locked
    }
  }
}

export function clearPerAssignmentPendingSyncRecord(
  assignmentId: string
): void {
  if (typeof window === 'undefined' || !assignmentId) return;
  try {
    window.localStorage.removeItem(
      `${PENDING_REPORT_SYNC_ITEM_PREFIX}${assignmentId}`
    );
  } catch {
    // Ignore storage restrictions
  }
}

export function enqueuePendingReportSync(
  entry: Omit<
    PendingReportSyncItem,
    'queueId' | 'createdAt' | 'updatedAt' | 'attemptCount' | 'lastError'
  >,
  error: unknown
): PendingReportSyncItem {
  const errorMsg =
    error instanceof Error
      ? error.message
      : String(error || 'Koneksi / autentikasi sedang offline');
  const current = readPendingReportSyncQueue();
  const queueId = `${entry.assignmentId}__${entry.stage}`;
  const existingIdx = current.findIndex((i) => i.queueId === queueId);
  const nowIso = new Date().toISOString();

  const nextItem: PendingReportSyncItem = {
    ...entry,
    queueId,
    createdAt: existingIdx >= 0 ? current[existingIdx].createdAt : nowIso,
    updatedAt: nowIso,
    attemptCount:
      existingIdx >= 0 ? (current[existingIdx].attemptCount || 0) + 1 : 1,
    lastError: errorMsg.slice(0, 300),
  };

  // Always preserve photos in IndexedDB vault as an extra safety net
  const { extractedPhotos } = stripHeavyPhotosFromQueueItem(nextItem);
  if (extractedPhotos) {
    void savePendingReportPhotosToVault(queueId, extractedPhotos);
  }

  // Also save per-assignment key `pending_report_sync_` + assignmentId as required
  writePerAssignmentPendingSyncRecord(entry.assignmentId, nextItem);

  const updatedQueue =
    existingIdx >= 0
      ? current.map((item, idx) => (idx === existingIdx ? nextItem : item))
      : [...current, nextItem];

  writePendingReportSyncQueue(updatedQueue);
  return nextItem;
}

export async function hydratePendingReportSyncItem(
  item: PendingReportSyncItem
): Promise<PendingReportSyncItem> {
  if (!item.photosStoredInVault) return item;
  const photos = await readPendingReportPhotosFromVault(item.queueId);
  if (!photos) return item;

  return {
    ...item,
    departurePayload: item.departurePayload
      ? {
          ...item.departurePayload,
          fotoOdometerBerangkat:
            item.departurePayload.fotoOdometerBerangkat ||
            photos.fotoOdometerBerangkat,
          fotoSuhuBerangkat:
            item.departurePayload.fotoSuhuBerangkat || photos.fotoSuhuBerangkat,
        }
      : undefined,
    handoverPayload: item.handoverPayload
      ? {
          ...item.handoverPayload,
          fotoOdometerSerahTerima:
            item.handoverPayload.fotoOdometerSerahTerima ||
            photos.fotoOdometerSerahTerima,
          fotoSuhuSerahTerima:
            item.handoverPayload.fotoSuhuSerahTerima ||
            photos.fotoSuhuSerahTerima,
          fotoBuktiSerahTerima:
            item.handoverPayload.fotoBuktiSerahTerima ||
            photos.fotoBuktiSerahTerima,
          tandaTanganPenerima:
            item.handoverPayload.tandaTanganPenerima ||
            photos.tandaTanganPenerima,
        }
      : undefined,
    assignmentSnapshot: {
      ...item.assignmentSnapshot,
      departureData: item.assignmentSnapshot.departureData
        ? {
            ...item.assignmentSnapshot.departureData,
            fotoOdometerBerangkat:
              item.assignmentSnapshot.departureData.fotoOdometerBerangkat ||
              photos.fotoOdometerBerangkat,
            fotoSuhuBerangkat:
              item.assignmentSnapshot.departureData.fotoSuhuBerangkat ||
              photos.fotoSuhuBerangkat,
          }
        : undefined,
      handoverData: item.assignmentSnapshot.handoverData
        ? {
            ...item.assignmentSnapshot.handoverData,
            fotoOdometerSerahTerima:
              item.assignmentSnapshot.handoverData.fotoOdometerSerahTerima ||
              photos.fotoOdometerSerahTerima,
            fotoSuhuSerahTerima:
              item.assignmentSnapshot.handoverData.fotoSuhuSerahTerima ||
              photos.fotoSuhuSerahTerima,
            fotoBuktiSerahTerima:
              item.assignmentSnapshot.handoverData.fotoBuktiSerahTerima ||
              photos.fotoBuktiSerahTerima,
            tandaTanganPenerima:
              item.assignmentSnapshot.handoverData.tandaTanganPenerima ||
              photos.tandaTanganPenerima,
          }
        : undefined,
    },
  };
}

export function removePendingReportSyncItem(queueId: string): void {
  const current = readPendingReportSyncQueue();
  const removedTarget = current.find((i) => i.queueId === queueId);
  const filtered = current.filter((i) => i.queueId !== queueId);

  const assignmentIdFromQueueId =
    removedTarget?.assignmentId || queueId.split('__')[0] || '';
  if (assignmentIdFromQueueId) {
    const stillHasOtherStage = filtered.some(
      (i) => i.assignmentId === assignmentIdFromQueueId
    );
    if (!stillHasOtherStage) {
      clearPerAssignmentPendingSyncRecord(assignmentIdFromQueueId);
    } else {
      const remaining = filtered.find(
        (i) => i.assignmentId === assignmentIdFromQueueId
      );
      if (remaining) {
        writePerAssignmentPendingSyncRecord(assignmentIdFromQueueId, remaining);
      }
    }
  }

  writePendingReportSyncQueue(filtered);
  clearPendingItemRetryStatus(queueId);
  void deletePendingReportPhotosFromVault(queueId);
}

export function sanitizeAssignmentFirestoreId(assignmentId: string): string {
  return sanitizeFirestoreId(assignmentId, MAX_LEN.DOC_ID, 'asg');
}

export function resolveValidTier2Status(
  dataSuratTugasAsli: Assignment,
  stage: DriverReportStage
): TaskStatus {
  return dataSuratTugasAsli.status === TaskStatus.DALAM_PERJALANAN ||
    dataSuratTugasAsli.status === TaskStatus.DELIVERED ||
    dataSuratTugasAsli.status === TaskStatus.HANDOVER ||
    dataSuratTugasAsli.status === TaskStatus.SELESAI
    ? dataSuratTugasAsli.status
    : stage === 'SERAH_TERIMA'
    ? TaskStatus.HANDOVER
    : stage === 'DELIVERED'
    ? TaskStatus.DELIVERED
    : TaskStatus.DALAM_PERJALANAN;
}

/**
 * Exact flat field keys permitted by `firestore.rules` Tier 2 `.affectedKeys().hasOnly([...])`
 * (alongside `submittedByDriverUid` and `updatedAt`).
 */
export const TIER2_ALLOWED_DRIVER_FIELD_KEYS = [
  'status',
  'origin',
  'notes',
  'depTimestamp',
  'depTitikBerangkat',
  'depJenisKendaraan',
  'depKmAwal',
  'depSuhuAwal',
  'depBbmAwal',
  'depKondisi',
  'depCatatan',
  'hoTimestamp',
  'hoKmAkhir',
  'hoSuhuAkhir',
  'hoBbmAkhir',
  'hoPenerima',
  'hoKondisi',
  'hoCatatan',
  'driveFolderId',
  'driveFolderUrl',
  'depOdoFotoUrl',
  'depSuhuFotoUrl',
  'hoOdoFotoUrl',
  'hoSuhuFotoUrl',
  'hoBuktiFotoUrl',
  'hoTtdUrl',
  'driveSyncedAt',
] as const;

export type Tier2AllowedDriverFieldKey =
  (typeof TIER2_ALLOWED_DRIVER_FIELD_KEYS)[number];

const TIER2_NUMERIC_FIELD_SET = new Set<string>(['depKmAwal', 'hoKmAkhir']);

const TIER2_STRING_MAX_LEN: Record<string, number> = {
  origin: MAX_LEN.ROUTE_DEST, // 200 (also requires size >= 1)
  notes: MAX_LEN.ASG_NOTES, // 500
  depTimestamp: MAX_LEN.ASG_TIMESTAMP, // 64
  depTitikBerangkat: MAX_LEN.ROUTE_DEST, // 200
  depJenisKendaraan: MAX_LEN.ASG_JENIS_KENDARAAN, // 32
  depSuhuAwal: MAX_LEN.ASG_SUHU, // 32
  depBbmAwal: MAX_LEN.ASG_BBM, // 32
  depKondisi: MAX_LEN.ASG_KONDISI, // 120
  depCatatan: MAX_LEN.ASG_NOTES, // 500
  hoTimestamp: MAX_LEN.ASG_TIMESTAMP, // 64
  hoSuhuAkhir: MAX_LEN.ASG_SUHU, // 32
  hoBbmAkhir: MAX_LEN.ASG_BBM, // 32
  hoPenerima: MAX_LEN.DRIVER_NAME, // 120
  hoKondisi: MAX_LEN.ASG_KONDISI, // 120
  hoCatatan: MAX_LEN.ASG_NOTES, // 500
  driveFolderId: MAX_LEN.ASG_DRIVE_ID, // 160
  driveFolderUrl: MAX_LEN.ASG_DRIVE_URL, // 300
  depOdoFotoUrl: MAX_LEN.ASG_DRIVE_URL, // 300
  depSuhuFotoUrl: MAX_LEN.ASG_DRIVE_URL, // 300
  hoOdoFotoUrl: MAX_LEN.ASG_DRIVE_URL, // 300
  hoSuhuFotoUrl: MAX_LEN.ASG_DRIVE_URL, // 300
  hoBuktiFotoUrl: MAX_LEN.ASG_DRIVE_URL, // 300
  hoTtdUrl: MAX_LEN.ASG_DRIVE_URL, // 300
  driveSyncedAt: MAX_LEN.ASG_TIMESTAMP, // 64
};

/**
 * Strictly sanitizes and flattens candidate Driver report fields so:
 * 1. The output is GUARANTEED flat (1-level `Record<string, string | number>` — zero nested objects or arrays).
 * 2. Every key is strictly whitelisted against `firestore.rules` Tier 2 `.affectedKeys().hasOnly([...])`
 *    (excluding `status`, `submittedByDriverUid`, `ownerUid`, and `updatedAt` so those are controlled explicitly).
 * 3. Every value satisfies `isValidAssignmentDoc` type and length rules in `firestore.rules`.
 */
export function sanitizeTier2FormAndPhotoFields(
  candidate: Record<string, unknown>
): Record<string, string | number> {
  const sanitized: Record<string, string | number> = {};
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    return sanitized;
  }

  for (const key of TIER2_ALLOWED_DRIVER_FIELD_KEYS) {
    if (key === 'status') continue;
    if (!Object.prototype.hasOwnProperty.call(candidate, key)) continue;

    const rawVal = candidate[key];
    // Reject undefined, null, nested objects, arrays, booleans, or functions
    if (
      rawVal === undefined ||
      rawVal === null ||
      typeof rawVal === 'object' ||
      typeof rawVal === 'function' ||
      typeof rawVal === 'boolean'
    ) {
      continue;
    }

    if (TIER2_NUMERIC_FIELD_SET.has(key)) {
      if (typeof rawVal === 'number' && Number.isFinite(rawVal)) {
        sanitized[key] = rawVal;
      }
      continue;
    }

    const maxLen = TIER2_STRING_MAX_LEN[key];
    if (maxLen === undefined || typeof rawVal !== 'string') continue;

    if (key === 'depJenisKendaraan') {
      sanitized[key] =
        rawVal === 'Mobil Pendingin' || rawVal === 'Non Pendingin'
          ? rawVal
          : '';
      continue;
    }

    const clamped = clampString(rawVal, maxLen);
    if (key === 'origin') {
      // `firestore.rules` requires `data.origin.size() >= 1`
      if (clamped.length >= 1) {
        sanitized[key] = clamped;
      }
      continue;
    }

    sanitized[key] = clamped;
  }

  return sanitized;
}

/**
 * Builds the exact flat Tier 2 `driverFormAndPhotoUrlFields` object for `updateDoc`
 * (excluding `status`, `submittedByDriverUid`, `ownerUid`, and `updatedAt`),
 * guaranteeing zero nested objects, zero unauthorized keys, and full compliance with `firestore.rules`.
 */
export function buildDriverFormAndPhotoUrlFields(
  dataSuratTugasAsli: Assignment,
  stage: DriverReportStage
): Record<string, string | number> {
  const includeDepartureFields =
    stage === 'KEBERANGKATAN' || Boolean(dataSuratTugasAsli.departureData);
  const includeHandoverFields =
    stage === 'SERAH_TERIMA' || Boolean(dataSuratTugasAsli.handoverData);

  const depKm =
    typeof dataSuratTugasAsli.departureData?.kmAwal === 'number' &&
    Number.isFinite(dataSuratTugasAsli.departureData.kmAwal)
      ? dataSuratTugasAsli.departureData.kmAwal
      : -1;
  const hoKm =
    typeof dataSuratTugasAsli.handoverData?.kmAkhir === 'number' &&
    Number.isFinite(dataSuratTugasAsli.handoverData.kmAkhir)
      ? dataSuratTugasAsli.handoverData.kmAkhir
      : -1;

  const rawJenis = dataSuratTugasAsli.departureData?.jenisKendaraan;
  const validJenisKendaraan =
    rawJenis === 'Mobil Pendingin' || rawJenis === 'Non Pendingin'
      ? rawJenis
      : '';
  const resolvedOrigin = clampString(
    dataSuratTugasAsli.departureData?.titikKeberangkatan ||
      dataSuratTugasAsli.origin,
    MAX_LEN.ROUTE_DEST,
    'Menunggu Titik Keberangkatan Driver'
  );

  const rawFields: Record<string, unknown> = {
    ...(stage === 'DELIVERED' ||
    Boolean(dataSuratTugasAsli.notes) ||
    Boolean(dataSuratTugasAsli.deliveredAt)
      ? {
          notes: embedDeliveredAtInFirestoreNotes(
            dataSuratTugasAsli.notes,
            dataSuratTugasAsli.deliveredAt
          ),
        }
      : {}),
    ...(includeDepartureFields
      ? {
          origin: resolvedOrigin,
          depTimestamp: clampString(
            dataSuratTugasAsli.departureData?.timestamp,
            MAX_LEN.ASG_TIMESTAMP
          ),
          depTitikBerangkat: clampString(
            dataSuratTugasAsli.departureData?.titikKeberangkatan,
            MAX_LEN.ROUTE_DEST
          ),
          depJenisKendaraan: validJenisKendaraan,
          depKmAwal: depKm,
          depSuhuAwal: clampString(
            dataSuratTugasAsli.departureData?.suhuAwal,
            MAX_LEN.ASG_SUHU
          ),
          depBbmAwal: clampString(
            dataSuratTugasAsli.departureData?.bbmAwal,
            MAX_LEN.ASG_BBM
          ),
          depKondisi: clampString(
            dataSuratTugasAsli.departureData?.kondisiKendaraan,
            MAX_LEN.ASG_KONDISI
          ),
          depCatatan: clampString(
            dataSuratTugasAsli.departureData?.catatanBerangkat,
            MAX_LEN.ASG_NOTES
          ),
        }
      : {}),
    ...(includeHandoverFields
      ? {
          hoTimestamp: clampString(
            dataSuratTugasAsli.handoverData?.timestamp,
            MAX_LEN.ASG_TIMESTAMP
          ),
          hoKmAkhir: hoKm,
          hoSuhuAkhir: clampString(
            dataSuratTugasAsli.handoverData?.suhuAkhir,
            MAX_LEN.ASG_SUHU
          ),
          hoBbmAkhir: clampString(
            dataSuratTugasAsli.handoverData?.bbmAkhir,
            MAX_LEN.ASG_BBM
          ),
          hoPenerima: clampString(
            dataSuratTugasAsli.handoverData?.penerimaNama,
            MAX_LEN.DRIVER_NAME
          ),
          hoKondisi: clampString(
            dataSuratTugasAsli.handoverData?.kondisiAkhir,
            MAX_LEN.ASG_KONDISI
          ),
          hoCatatan: clampString(
            dataSuratTugasAsli.handoverData?.catatanSerahTerima,
            MAX_LEN.ASG_NOTES
          ),
        }
      : {}),
    // Include Google Drive photo URLs (flat top-level string keys) whenever present on the assignment
    ...(dataSuratTugasAsli.driveMedia?.folderId !== undefined
      ? {
          driveFolderId: clampString(
            dataSuratTugasAsli.driveMedia.folderId,
            MAX_LEN.ASG_DRIVE_ID
          ),
        }
      : {}),
    ...((dataSuratTugasAsli.driveMedia?.folderUrl ||
      dataSuratTugasAsli.driveFolderUrl) !== undefined
      ? {
          driveFolderUrl: clampString(
            dataSuratTugasAsli.driveMedia?.folderUrl ||
              dataSuratTugasAsli.driveFolderUrl,
            MAX_LEN.ASG_DRIVE_URL
          ),
        }
      : {}),
    ...(dataSuratTugasAsli.driveMedia?.fotoOdometerBerangkatUrl !== undefined
      ? {
          depOdoFotoUrl: clampString(
            dataSuratTugasAsli.driveMedia.fotoOdometerBerangkatUrl,
            MAX_LEN.ASG_DRIVE_URL
          ),
        }
      : {}),
    ...(dataSuratTugasAsli.driveMedia?.fotoSuhuBerangkatUrl !== undefined
      ? {
          depSuhuFotoUrl: clampString(
            dataSuratTugasAsli.driveMedia.fotoSuhuBerangkatUrl,
            MAX_LEN.ASG_DRIVE_URL
          ),
        }
      : {}),
    ...(dataSuratTugasAsli.driveMedia?.fotoOdometerSerahTerimaUrl !== undefined
      ? {
          hoOdoFotoUrl: clampString(
            dataSuratTugasAsli.driveMedia.fotoOdometerSerahTerimaUrl,
            MAX_LEN.ASG_DRIVE_URL
          ),
        }
      : {}),
    ...(dataSuratTugasAsli.driveMedia?.fotoSuhuSerahTerimaUrl !== undefined
      ? {
          hoSuhuFotoUrl: clampString(
            dataSuratTugasAsli.driveMedia.fotoSuhuSerahTerimaUrl,
            MAX_LEN.ASG_DRIVE_URL
          ),
        }
      : {}),
    ...(dataSuratTugasAsli.driveMedia?.fotoBuktiSerahTerimaUrl !== undefined
      ? {
          hoBuktiFotoUrl: clampString(
            dataSuratTugasAsli.driveMedia.fotoBuktiSerahTerimaUrl,
            MAX_LEN.ASG_DRIVE_URL
          ),
        }
      : {}),
    ...(dataSuratTugasAsli.driveMedia?.tandaTanganPenerimaUrl !== undefined
      ? {
          hoTtdUrl: clampString(
            dataSuratTugasAsli.driveMedia.tandaTanganPenerimaUrl,
            MAX_LEN.ASG_DRIVE_URL
          ),
        }
      : {}),
    ...(dataSuratTugasAsli.driveMedia?.syncedAt !== undefined
      ? {
          driveSyncedAt: clampString(
            dataSuratTugasAsli.driveMedia.syncedAt,
            MAX_LEN.ASG_TIMESTAMP
          ),
        }
      : {}),
  };

  return sanitizeTier2FormAndPhotoFields(rawFields);
}

function buildDriverStageFirestorePatch(
  dataSuratTugasAsli: Assignment,
  exactDriverCode: string,
  stage: DriverReportStage
): Record<string, unknown> {
  const validStatus = resolveValidTier2Status(dataSuratTugasAsli, stage);
  const sanitizedFlatFields = sanitizeTier2FormAndPhotoFields(
    buildDriverFormAndPhotoUrlFields(dataSuratTugasAsli, stage)
  );

  return {
    status: validStatus,
    submittedByDriverUid: clampString(
      exactDriverCode,
      MAX_LEN.CODE_ID,
      'DRV-000'
    ),
    ...sanitizedFlatFields,
    updatedAt: serverTimestamp(),
  };
}

export interface SubmitDriverReportFirestoreResult {
  syncedToFirestore: boolean;
  queuedLocally: boolean;
  senderDriverUid: string;
  usedFallbackIdentity: boolean;
  errorMessage?: string;
}

/**
 * Submits a Driver report (`KEBERANGKATAN`, `DELIVERED`, or `SERAH_TERIMA`) to Firestore:
 * - Forces Firebase token refresh (`await auth.currentUser.getIdToken(true)`) if session exists.
 * - Sets `submittedByDriverUid` strictly equal to `dataSuratTugasAsli.driverCode` (with `saved_driver_uid` fallback).
 * - Never deletes or modifies `ownerUid` on the original Surat Tugas document.
 * - Forces `updatedAt: serverTimestamp()` from `firebase/firestore` to pass `incoming().updatedAt == request.time`.
 * - Enqueues into `localStorage('pending_report_sync')` inside `catch (error)` if offline or rejected.
 */
export async function submitDriverReportToFirestore(params: {
  assignment: Assignment;
  stage: DriverReportStage;
  serverSynced: boolean;
  departurePayload?: DriverDepartureSubmitPayload;
  deliveredCatatan?: string;
  handoverPayload?: DriverHandoverSubmitPayload;
}): Promise<SubmitDriverReportFirestoreResult> {
  const {
    assignment: dataSuratTugasAsli,
    stage,
    serverSynced,
    departurePayload,
    deliveredCatatan,
    handoverPayload,
  } = params;

  const assignmentId = sanitizeFirestoreId(
    dataSuratTugasAsli.id,
    MAX_LEN.DOC_ID,
    'asg'
  );
  const path = `assignments/${assignmentId}`;
  const assignmentRef = doc(db, 'assignments', assignmentId);

  const rawSavedDriverUid =
    typeof window !== 'undefined'
      ? window.localStorage.getItem('saved_driver_uid')?.trim() || ''
      : '';

  // Criterion 1: `submittedByDriverUid` MUST match the exact `driverCode` string on `dataSuratTugasAsli`
  const exactDriverCode = clampString(
    dataSuratTugasAsli.driverCode ||
      dataSuratTugasAsli.driverId ||
      rawSavedDriverUid ||
      getSavedDriverUidFallback(dataSuratTugasAsli.driverId),
    MAX_LEN.CODE_ID,
    'DRV-000'
  );

  if (exactDriverCode) {
    persistSavedDriverUid(exactDriverCode);
  }

  let usedFallbackIdentity = false;

  try {
    // Wake up dormant mobile Firebase Auth session before updateDoc
    if (auth.currentUser) {
      await auth.currentUser.getIdToken(true);
    } else {
      usedFallbackIdentity = true;
    }

    const updatePayload = buildDriverStageFirestorePatch(
      dataSuratTugasAsli,
      exactDriverCode,
      stage
    );

    if (auth.currentUser && canSyncWithUser(auth.currentUser)) {
      let snap;
      try {
        snap = await getDoc(assignmentRef);
      } catch {
        snap = null;
      }

      if (snap && snap.exists()) {
        const existingDoc = snap.data() as Record<string, unknown>;
        const cloudDriverCode =
          typeof existingDoc.driverCode === 'string' &&
          existingDoc.driverCode.trim()
            ? existingDoc.driverCode.trim()
            : exactDriverCode;

        const verifiedPayload: Record<string, unknown> = {
          ...updatePayload,
          submittedByDriverUid: clampString(
            cloudDriverCode,
            MAX_LEN.CODE_ID,
            exactDriverCode
          ),
          updatedAt: serverTimestamp(),
        };
        delete verifiedPayload.ownerUid;

        try {
          await updateDoc(assignmentRef, verifiedPayload);
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      } else if (snap && !snap.exists()) {
        // Document not yet created in Firestore and current user is verified owner -> create full doc
        await upsertAssignmentInFirestore(auth.currentUser, {
          ...dataSuratTugasAsli,
          driverCode: exactDriverCode,
          submittedByDriverUid: exactDriverCode,
        });
      } else {
        // Signed in with non-owner Google account -> Tier 2 updateDoc preserving original ownerUid
        try {
          await updateDoc(assignmentRef, {
            ...updatePayload,
            submittedByDriverUid: exactDriverCode,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      }
    } else {
      // Link Khusus Driver when session token is expired/null:
      // Direct `updateDoc` keeping original `ownerUid` untouched, setting `submittedByDriverUid = dataSuratTugasAsli.driverCode`,
      // and forcing `updatedAt: serverTimestamp()`
      try {
        await updateDoc(assignmentRef, {
          ...updatePayload,
          submittedByDriverUid: exactDriverCode,
          updatedAt: serverTimestamp(),
        });
      } catch (err) {
        handleFirestoreError(err, OperationType.UPDATE, path);
      }
    }

    removePendingReportSyncItem(`${dataSuratTugasAsli.id}__${stage}`);

    return {
      syncedToFirestore: true,
      queuedLocally: false,
      senderDriverUid: exactDriverCode,
      usedFallbackIdentity,
    };
  } catch (error) {
    enqueuePendingReportSync(
      {
        assignmentId: dataSuratTugasAsli.id,
        noPenugasan: dataSuratTugasAsli.noPenugasan,
        driverId: dataSuratTugasAsli.driverId,
        submittedByDriverUid: exactDriverCode,
        usedFallbackIdentity: !auth.currentUser,
        stage,
        serverSynced,
        firestoreSynced: false,
        departurePayload,
        deliveredCatatan,
        handoverPayload,
        assignmentSnapshot: {
          ...dataSuratTugasAsli,
          driverCode: exactDriverCode,
          submittedByDriverUid: exactDriverCode,
        },
      },
      error
    );

    const errMsg = error instanceof Error ? error.message : String(error);
    return {
      syncedToFirestore: false,
      queuedLocally: true,
      senderDriverUid: exactDriverCode,
      usedFallbackIdentity: !auth.currentUser,
      errorMessage: errMsg,
    };
  }
}

export interface OfflineRecoverySubmitResult {
  syncedToFirestore: boolean;
  queuedOffline: boolean;
  resolvedAssignment: Assignment & { driverCode: string };
}

/**
 * Shared Tier 2 Firestore submission + Offline Recovery function used by both:
 * - Portal Driver submit buttons (`DriverPortal.tsx`), and
 * - Global Background Auto-Retry Sync (`window.addEventListener('online')` in `App.tsx`).
 *
 * When `updateDoc` succeeds, automatically removes `'pending_report_sync_' + assignmentId`
 * and cleans up the Pending Sync Queue from `localStorage`.
 */
export async function submitReportToFirestoreWithOfflineRecovery(params: {
  assignmentId: string;
  fallbackDriverId?: string;
  stage: DriverReportStage;
  candidateAssignment: Assignment;
  departurePayload?: DriverDepartureSubmitPayload;
  deliveredCatatan?: string;
  handoverPayload?: DriverHandoverSubmitPayload;
  serverSynced?: boolean;
}): Promise<OfflineRecoverySubmitResult> {
  const {
    assignmentId,
    fallbackDriverId = '',
    stage,
    candidateAssignment,
    departurePayload,
    deliveredCatatan,
    handoverPayload,
    serverSynced = false,
  } = params;

  // Read `dataSuratTugasAsli` (with guaranteed `driverCode`) from localStorage / IndexedDB cache
  const dataSuratTugasAsli = await resolveCachedSuratTugasAsli(
    assignmentId,
    fallbackDriverId || candidateAssignment.driverId || '',
    candidateAssignment
  );

  persistSavedDriverUid(dataSuratTugasAsli.driverCode);

  const validStatus = resolveValidTier2Status(dataSuratTugasAsli, stage);
  const rawDriverFormAndPhotoUrlFields = buildDriverFormAndPhotoUrlFields(
    dataSuratTugasAsli,
    stage
  );

  // Strict pre-updateDoc guard: 100% flat 1-level primitive object with only Tier 2 allowed keys
  const allowedSpreadKeySet = new Set<string>(
    TIER2_ALLOWED_DRIVER_FIELD_KEYS.filter((k) => k !== 'status')
  );
  const driverFormAndPhotoUrlFields: Record<string, string | number> = {};
  for (const [key, val] of Object.entries(
    sanitizeTier2FormAndPhotoFields(rawDriverFormAndPhotoUrlFields)
  )) {
    if (
      allowedSpreadKeySet.has(key) &&
      (typeof val === 'string' ||
        (typeof val === 'number' && Number.isFinite(val)))
    ) {
      driverFormAndPhotoUrlFields[key] = val;
    }
  }

  try {
    // Force Refresh Token right before `updateDoc` runs
    if (auth.currentUser) {
      try {
        await auth.currentUser.getIdToken(true);
      } catch (e) {
        console.log(
          'Sesi Auth mati suri, melanjutkan pengiriman dengan mode fallback identitas lokal.'
        );
      }
    } else {
      getSavedDriverUidFallback(dataSuratTugasAsli.driverCode);
    }

    const firestoreDocId = sanitizeAssignmentFirestoreId(assignmentId);
    const assignmentRef = doc(db, 'assignments', firestoreDocId);

    await updateDoc(assignmentRef, {
      status: validStatus,
      submittedByDriverUid: dataSuratTugasAsli.driverCode,
      ...driverFormAndPhotoUrlFields,
      updatedAt: serverTimestamp(),
    });

    // Clean up `'pending_report_sync_' + assignmentId` and queue item from phone localStorage on success
    removePendingReportSyncItem(`${assignmentId}__${stage}`);
    clearPerAssignmentPendingSyncRecord(assignmentId);

    const updatedCached = await cacheSuratTugasSnapshotLocally(
      {
        ...dataSuratTugasAsli,
        status: validStatus,
      },
      fallbackDriverId || dataSuratTugasAsli.driverCode
    );

    return {
      syncedToFirestore: true,
      queuedOffline: false,
      resolvedAssignment: updatedCached,
    };
  } catch (error) {
    const queuedItem = enqueuePendingReportSync(
      {
        assignmentId,
        noPenugasan: dataSuratTugasAsli.noPenugasan,
        driverId: dataSuratTugasAsli.driverId || fallbackDriverId || 'DRV-000',
        submittedByDriverUid: dataSuratTugasAsli.driverCode,
        usedFallbackIdentity: !auth.currentUser,
        stage,
        serverSynced,
        firestoreSynced: false,
        departurePayload,
        deliveredCatatan,
        handoverPayload,
        assignmentSnapshot: {
          ...dataSuratTugasAsli,
          status: validStatus,
          driverCode: dataSuratTugasAsli.driverCode,
          submittedByDriverUid: dataSuratTugasAsli.driverCode,
        },
      },
      error
    );

    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(
          `${PENDING_REPORT_SYNC_ITEM_PREFIX}${assignmentId}`,
          JSON.stringify({
            ...queuedItem,
            firestoreUpdatePayloadPreview: {
              status: validStatus,
              submittedByDriverUid: dataSuratTugasAsli.driverCode,
              ...driverFormAndPhotoUrlFields,
            },
          })
        );
      } catch {
        // Compact metadata is already saved by `enqueuePendingReportSync` and photos are in IndexedDB
      }
    }

    const optimisticCached = await cacheSuratTugasSnapshotLocally(
      {
        ...dataSuratTugasAsli,
        status: validStatus,
      },
      fallbackDriverId || dataSuratTugasAsli.driverCode
    );

    return {
      syncedToFirestore: false,
      queuedOffline: true,
      resolvedAssignment: optimisticCached,
    };
  }
}


