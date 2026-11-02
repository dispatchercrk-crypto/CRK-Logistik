import dotenv from 'dotenv';
import express from 'express';
import fs from 'fs';
import { createServer as createHttpServer } from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import { WebSocket, WebSocketServer } from 'ws';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface DriverRecord {
  id: string;
  name: string;
  phone: string;
  pin: string;
  licenseType: string;
  active: boolean;
}

interface VehicleRecord {
  id: string;
  plateNumber: string;
  vehicleType: string;
  capacity: string;
  capacityCbm?: string;
  status: 'Siap Jalan' | 'Dalam Tugas' | 'Perawatan';
}

interface RouteRecord {
  id: string;
  destination: string;
  picName: string;
  picPhone: string;
}

interface FleetCardRecord {
  id: string;
  cardNumber: string;
  balance: number;
}

interface DriverExpenseRecord {
  id: string;
  timestamp: string;
  tanggal: string;
  tanggalPengiriman?: string;
  tujuanPengiriman?: string;
  driverId: string;
  driverName: string;
  plateNumber: string;
  completedAssignmentNos: string;
  fleetCardId: string;
  fleetCardNumber: string;
  totalPengirimanBbm: number;
  fotoStrukBbm?: string;
  fotoStrukBbmUrl?: string;
  totalPengeluaranTol: number;
  fotoStrukTol?: string;
  fotoStrukTolUrl?: string;
  totalPengeluaran: number;
  catatan: string;
  needsSheetSync?: boolean;
}

interface DepartureData {
  timestamp: string;
  titikKeberangkatan?: string;
  jenisKendaraan?: 'Mobil Pendingin' | 'Non Pendingin';
  kmAwal: number;
  suhuAwal: string;
  bbmAwal: string;
  kondisiKendaraan: string;
  catatanBerangkat: string;
  fotoOdometerBerangkat?: string;
  fotoSuhuBerangkat?: string;
}

interface HandoverData {
  timestamp: string;
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

interface DriveMediaLinks {
  folderId?: string;
  folderUrl?: string;
  fotoOdometerBerangkatUrl?: string;
  fotoSuhuBerangkatUrl?: string;
  fotoOdometerSerahTerimaUrl?: string;
  fotoSuhuSerahTerimaUrl?: string;
  fotoBuktiSerahTerimaUrl?: string;
  tandaTanganPenerimaUrl?: string;
  syncedAt?: string;
}

function mergeDriveMediaLinks(
  primary?: DriveMediaLinks,
  secondary?: DriveMediaLinks
): DriveMediaLinks | undefined {
  if (!primary && !secondary) return undefined;
  const merged: DriveMediaLinks = {
    folderId: primary?.folderId || secondary?.folderId || undefined,
    folderUrl: primary?.folderUrl || secondary?.folderUrl || undefined,
    fotoOdometerBerangkatUrl:
      primary?.fotoOdometerBerangkatUrl ||
      secondary?.fotoOdometerBerangkatUrl ||
      undefined,
    fotoSuhuBerangkatUrl:
      primary?.fotoSuhuBerangkatUrl ||
      secondary?.fotoSuhuBerangkatUrl ||
      undefined,
    fotoOdometerSerahTerimaUrl:
      primary?.fotoOdometerSerahTerimaUrl ||
      secondary?.fotoOdometerSerahTerimaUrl ||
      undefined,
    fotoSuhuSerahTerimaUrl:
      primary?.fotoSuhuSerahTerimaUrl ||
      secondary?.fotoSuhuSerahTerimaUrl ||
      undefined,
    fotoBuktiSerahTerimaUrl:
      primary?.fotoBuktiSerahTerimaUrl ||
      secondary?.fotoBuktiSerahTerimaUrl ||
      undefined,
    tandaTanganPenerimaUrl:
      primary?.tandaTanganPenerimaUrl ||
      secondary?.tandaTanganPenerimaUrl ||
      undefined,
    syncedAt: primary?.syncedAt || secondary?.syncedAt || undefined,
  };
  const hasAny = Object.values(merged).some((v) => Boolean(v));
  return hasAny ? merged : undefined;
}

interface AssignmentRecord {
  id: string;
  sequenceNumber: number;
  noPenugasan: string;
  noSuratJalanFisik: string;
  kodeSegel: string;
  createdAt: string;
  tanggalTugas: string;
  jadwalJamTiba?: string;
  deliveredAt?: string;
  driverId: string;
  driverName: string;
  driverPhone: string;
  vehicleId: string;
  plateNumber: string;
  vehicleType: string;
  originId?: string;
  origin: string;
  routeId: string;
  destination: string;
  purpose: string;
  beratMuatan?: string;
  volumeCbm?: string;
  driveFolderUrl?: string;
  driveMedia?: DriveMediaLinks;
  status:
    | 'Menunggu Berangkat'
    | 'Dalam Perjalanan'
    | 'Delivered'
    | 'Handover'
    | 'Selesai';
  departureData?: DepartureData;
  handoverData?: HandoverData;
  notes: string;
  needsSheetSync?: boolean;
}

interface NotificationRecord {
  id: string;
  timestamp: string;
  eventType:
    | 'SURAT_TUGAS'
    | 'KEBERANGKATAN'
    | 'DELIVERED'
    | 'SERAH_TERIMA'
    | 'UJI_JARINGAN';
  noPenugasan: string;
  assignmentId?: string;
  destination?: string;
  actorRole?: 'ADMIN' | 'DRIVER' | 'SYSTEM';
  summary?: string;
  readByAdmin?: boolean;
  readAt?: string;
  readByDriver?: boolean;
  driverReadAt?: string;
  driverId: string;
  driverName: string;
  plateNumber: string;
  targetPhone: string;
  message: string;
  waDirectUrl: string;
  waGroupUrl: string;
  waDriverUrl?: string;
  networkStatus: 'TERKIRIM_GATEWAY' | 'SIAP_GATEWAY' | 'GAGAL_JARINGAN';
  gatewayDetail: string;
}

interface DeletedTombstonesStore {
  assignments: string[];
  drivers: string[];
  vehicles: string[];
  routes: string[];
  fleetCards: string[];
  driverExpenses: string[];
}

interface PersistentStore {
  adminPin: string;
  isDefaultPin: boolean;
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  appsScriptUrl?: string;
  liveCsvReadable?: boolean;
  driveRootFolderId: string;
  driveRootFolderUrl: string;
  lastSyncedAt: string | null;
  lastSyncedSpreadsheetId?: string;
  syncedDriverIds?: string[];
  syncedVehicleIds?: string[];
  syncedRouteIds?: string[];
  syncedFleetCardIds?: string[];
  syncedAssignmentNos?: string[];
  syncedExpenseIds?: string[];
  unsyncedDriverIds?: string[];
  unsyncedVehicleIds?: string[];
  unsyncedRouteIds?: string[];
  unsyncedFleetCardIds?: string[];
  pendingMasterDeletionPush?: boolean;
  pendingAssignmentDeletionPush?: boolean;
  pendingExpenseDeletionPush?: boolean;
  deletedTombstones?: DeletedTombstonesStore;
  dispatcherWaPhone: string;
  whatsappTargetMode: 'GROUP' | 'DIRECT' | 'DRIVER';
  whatsappGroupName: string;
  whatsappGroupInviteUrl: string;
  publicPortalBaseUrl: string;
  letterPrefix: string;
  lastSequence: number;
  needsMasterSheetSync?: boolean;
  drivers: DriverRecord[];
  vehicles: VehicleRecord[];
  routes: RouteRecord[];
  fleetCards: FleetCardRecord[];
  assignments: AssignmentRecord[];
  driverExpenses: DriverExpenseRecord[];
  notifications: NotificationRecord[];
}

const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'dispatch-store.json');

function getInitialStore(): PersistentStore {
  return {
    adminPin: '123456',
    isDefaultPin: true,
    spreadsheetId: (process.env.GOOGLE_SPREADSHEET_ID || '').trim(),
    spreadsheetTitle: '',
    spreadsheetUrl: '',
    appsScriptUrl: (process.env.GOOGLE_APPS_SCRIPT_URL || '').trim(),
    liveCsvReadable: false,
    driveRootFolderId: '',
    driveRootFolderUrl: '',
    lastSyncedAt: null,
    lastSyncedSpreadsheetId: '',
    syncedDriverIds: [],
    syncedVehicleIds: [],
    syncedRouteIds: [],
    syncedFleetCardIds: [],
    syncedAssignmentNos: [],
    syncedExpenseIds: [],
    unsyncedDriverIds: [],
    unsyncedVehicleIds: [],
    unsyncedRouteIds: [],
    unsyncedFleetCardIds: [],
    pendingMasterDeletionPush: false,
    pendingAssignmentDeletionPush: false,
    pendingExpenseDeletionPush: false,
    deletedTombstones: {
      assignments: [],
      drivers: [],
      vehicles: [],
      routes: [],
      fleetCards: [],
      driverExpenses: [],
    },
    dispatcherWaPhone: (process.env.WHATSAPP_DEFAULT_TARGET || '').trim(),
    whatsappTargetMode: 'GROUP',
    whatsappGroupName: 'Grup Operasional CRK Logistik',
    whatsappGroupInviteUrl: '',
    publicPortalBaseUrl: '',
    letterPrefix: 'ST-CRK',
    lastSequence: 0,
    needsMasterSheetSync: false,
    drivers: [],
    vehicles: [],
    routes: [],
    fleetCards: [],
    assignments: [],
    driverExpenses: [],
    notifications: [],
  };
}

function stripLegacyDriverLinkLine(message: string): string {
  if (!message) return '';
  return message
    .replace(/^Link Khusus Driver\s*:.*(?:\r?\n)?/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function loadStore(): PersistentStore {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    if (!fs.existsSync(STORE_PATH)) {
      const initial = getInitialStore();
      fs.writeFileSync(STORE_PATH, JSON.stringify(initial, null, 2), 'utf-8');
      return initial;
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<PersistentStore>;
    const loadedPin =
      typeof parsed.adminPin === 'string' && parsed.adminPin.trim().length >= 4
        ? parsed.adminPin.trim()
        : '123456';
    const loadedIsDefaultPin =
      loadedPin !== '123456'
        ? false
        : typeof parsed.isDefaultPin === 'boolean'
        ? parsed.isDefaultPin
        : true;
    const rawTombstones = parsed.deletedTombstones;
    return {
      ...getInitialStore(),
      ...parsed,
      adminPin: loadedPin,
      isDefaultPin: loadedIsDefaultPin,
      appsScriptUrl:
        typeof parsed.appsScriptUrl === 'string'
          ? parsed.appsScriptUrl.trim()
          : (process.env.GOOGLE_APPS_SCRIPT_URL || '').trim(),
      liveCsvReadable: Boolean(parsed.liveCsvReadable),
      lastSyncedSpreadsheetId:
        typeof parsed.lastSyncedSpreadsheetId === 'string'
          ? parsed.lastSyncedSpreadsheetId.trim()
          : parsed.lastSyncedAt && parsed.spreadsheetId
          ? String(parsed.spreadsheetId).trim()
          : '',
      syncedDriverIds: Array.isArray(parsed.syncedDriverIds)
        ? parsed.syncedDriverIds
        : [],
      syncedVehicleIds: Array.isArray(parsed.syncedVehicleIds)
        ? parsed.syncedVehicleIds
        : [],
      syncedRouteIds: Array.isArray(parsed.syncedRouteIds)
        ? parsed.syncedRouteIds
        : [],
      syncedFleetCardIds: Array.isArray(parsed.syncedFleetCardIds)
        ? parsed.syncedFleetCardIds
        : [],
      syncedAssignmentNos: Array.isArray(parsed.syncedAssignmentNos)
        ? parsed.syncedAssignmentNos
        : [],
      syncedExpenseIds: Array.isArray(parsed.syncedExpenseIds)
        ? parsed.syncedExpenseIds
        : [],
      unsyncedDriverIds: Array.isArray(parsed.unsyncedDriverIds)
        ? parsed.unsyncedDriverIds
        : [],
      unsyncedVehicleIds: Array.isArray(parsed.unsyncedVehicleIds)
        ? parsed.unsyncedVehicleIds
        : [],
      unsyncedRouteIds: Array.isArray(parsed.unsyncedRouteIds)
        ? parsed.unsyncedRouteIds
        : [],
      unsyncedFleetCardIds: Array.isArray(parsed.unsyncedFleetCardIds)
        ? parsed.unsyncedFleetCardIds
        : [],
      pendingMasterDeletionPush: Boolean(parsed.pendingMasterDeletionPush),
      pendingAssignmentDeletionPush: Boolean(
        parsed.pendingAssignmentDeletionPush
      ),
      pendingExpenseDeletionPush: Boolean(parsed.pendingExpenseDeletionPush),
      deletedTombstones: {
        assignments: Array.isArray(rawTombstones?.assignments)
          ? rawTombstones.assignments.slice(-1000)
          : [],
        drivers: Array.isArray(rawTombstones?.drivers)
          ? rawTombstones.drivers.slice(-500)
          : [],
        vehicles: Array.isArray(rawTombstones?.vehicles)
          ? rawTombstones.vehicles.slice(-500)
          : [],
        routes: Array.isArray(rawTombstones?.routes)
          ? rawTombstones.routes.slice(-500)
          : [],
        fleetCards: Array.isArray(rawTombstones?.fleetCards)
          ? rawTombstones.fleetCards.slice(-500)
          : [],
        driverExpenses: Array.isArray(rawTombstones?.driverExpenses)
          ? rawTombstones.driverExpenses.slice(-1000)
          : [],
      },
      whatsappTargetMode:
        parsed.whatsappTargetMode === 'DIRECT'
          ? 'DIRECT'
          : parsed.whatsappTargetMode === 'DRIVER'
          ? 'DRIVER'
          : 'GROUP',
      whatsappGroupName:
        typeof parsed.whatsappGroupName === 'string'
          ? parsed.whatsappGroupName
          : 'Grup Operasional CRK Logistik',
      whatsappGroupInviteUrl:
        typeof parsed.whatsappGroupInviteUrl === 'string'
          ? parsed.whatsappGroupInviteUrl
          : '',
      publicPortalBaseUrl:
        typeof parsed.publicPortalBaseUrl === 'string'
          ? parsed.publicPortalBaseUrl.trim()
          : '',
      driveRootFolderId:
        typeof parsed.driveRootFolderId === 'string'
          ? parsed.driveRootFolderId.trim()
          : '',
      driveRootFolderUrl:
        typeof parsed.driveRootFolderUrl === 'string'
          ? parsed.driveRootFolderUrl.trim()
          : '',
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers : [],
      vehicles: Array.isArray(parsed.vehicles) ? parsed.vehicles : [],
      routes: Array.isArray(parsed.routes) ? parsed.routes : [],
      fleetCards: Array.isArray(parsed.fleetCards)
        ? parsed.fleetCards.map((fc) => ({
            id: String(fc.id || '').trim().toUpperCase(),
            cardNumber: String(fc.cardNumber || '').trim(),
            balance: Number(fc.balance) || 0,
          }))
        : [],
      assignments: Array.isArray(parsed.assignments)
        ? parsed.assignments.map((a) => ({
            ...a,
            noSuratJalanFisik: a.noSuratJalanFisik || '',
            kodeSegel: a.kodeSegel || '',
            originId: a.originId || '',
            origin: a.origin || 'Menunggu Titik Keberangkatan Driver',
            beratMuatan: a.beratMuatan || undefined,
            volumeCbm: a.volumeCbm || undefined,
            driveFolderUrl:
              a.driveMedia?.folderUrl || a.driveFolderUrl || undefined,
            driveMedia: mergeDriveMediaLinks(a.driveMedia, undefined),
          }))
        : [],
      driverExpenses: Array.isArray(parsed.driverExpenses)
        ? parsed.driverExpenses.map((exp) => {
            const bbm = Math.max(0, Number(exp.totalPengirimanBbm) || 0);
            const tol = Math.max(0, Number(exp.totalPengeluaranTol) || 0);
            return {
              ...exp,
              id: String(exp.id || `EXP-${Date.now()}`).trim(),
              timestamp: String(exp.timestamp || new Date().toISOString()),
              tanggal: String(
                exp.tanggal ||
                  String(exp.timestamp || new Date().toISOString()).slice(0, 10)
              ).trim(),
              driverId: String(exp.driverId || '').trim().toUpperCase(),
              driverName: String(exp.driverName || '').trim(),
              plateNumber: String(exp.plateNumber || '').trim().toUpperCase(),
              completedAssignmentNos: String(
                exp.completedAssignmentNos || ''
              ).trim(),
              fleetCardId: String(exp.fleetCardId || '').trim().toUpperCase(),
              fleetCardNumber: String(exp.fleetCardNumber || '').trim(),
              totalPengirimanBbm: bbm,
              totalPengeluaranTol: tol,
              totalPengeluaran:
                Number(exp.totalPengeluaran) > 0
                  ? Number(exp.totalPengeluaran)
                  : bbm + tol,
              catatan: String(exp.catatan || '').trim(),
            };
          })
        : [],
      notifications: Array.isArray(parsed.notifications)
        ? parsed.notifications.map((n) => {
            const cleanMessage = stripLegacyDriverLinkLine(n.message || '');
            return {
              ...n,
              message: cleanMessage,
              waGroupUrl: buildWaGroupUrl(cleanMessage),
              waDirectUrl: buildWaDirectUrl(n.targetPhone || '', cleanMessage),
              waDriverUrl: buildWaDirectUrl(n.targetPhone || '', cleanMessage),
            };
          })
        : [],
    };
  } catch (err) {
    console.error('Failed to read store, initializing clean store:', err);
    return getInitialStore();
  }
}

let onStoreSavedHook: (() => void) | null = null;

function saveStore(storeObj: PersistentStore, skipRelayPush = false): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(STORE_PATH, JSON.stringify(storeObj, null, 2), 'utf-8');
    if (!skipRelayPush && onStoreSavedHook) {
      onStoreSavedHook();
    }
  } catch (err) {
    console.error('Failed to write store:', err);
  }
}

let store: PersistentStore = loadStore();

function normalizeSyncKey(val?: string | null): string {
  return String(val || '').trim().toLowerCase();
}

function ensureStoreTracking(target: PersistentStore = store): DeletedTombstonesStore {
  if (!target.deletedTombstones) {
    target.deletedTombstones = {
      assignments: [],
      drivers: [],
      vehicles: [],
      routes: [],
      fleetCards: [],
      driverExpenses: [],
    };
  }
  if (!Array.isArray(target.deletedTombstones.fleetCards)) {
    target.deletedTombstones.fleetCards = [];
  }
  if (!Array.isArray(target.deletedTombstones.driverExpenses)) {
    target.deletedTombstones.driverExpenses = [];
  }
  if (!Array.isArray(target.unsyncedDriverIds)) target.unsyncedDriverIds = [];
  if (!Array.isArray(target.unsyncedVehicleIds)) target.unsyncedVehicleIds = [];
  if (!Array.isArray(target.unsyncedRouteIds)) target.unsyncedRouteIds = [];
  if (!Array.isArray(target.unsyncedFleetCardIds)) target.unsyncedFleetCardIds = [];
  if (!Array.isArray(target.syncedDriverIds)) target.syncedDriverIds = [];
  if (!Array.isArray(target.syncedVehicleIds)) target.syncedVehicleIds = [];
  if (!Array.isArray(target.syncedRouteIds)) target.syncedRouteIds = [];
  if (!Array.isArray(target.syncedFleetCardIds)) target.syncedFleetCardIds = [];
  if (!Array.isArray(target.syncedAssignmentNos)) target.syncedAssignmentNos = [];
  if (!Array.isArray(target.syncedExpenseIds)) target.syncedExpenseIds = [];
  if (!Array.isArray(target.fleetCards)) target.fleetCards = [];
  if (!Array.isArray(target.driverExpenses)) target.driverExpenses = [];
  return target.deletedTombstones;
}

function addDeletedTombstones(
  kind: keyof DeletedTombstonesStore,
  keys: Array<string | undefined | null>
): void {
  const tb = ensureStoreTracking();
  const set = new Set(tb[kind].map(normalizeSyncKey).filter(Boolean));
  for (const k of keys) {
    const nk = normalizeSyncKey(k);
    if (nk) set.add(nk);
  }
  tb[kind] = Array.from(set).slice(-1000);
}

function removeDeletedTombstones(
  kind: keyof DeletedTombstonesStore,
  keys: Array<string | undefined | null>
): void {
  const tb = ensureStoreTracking();
  const toRemove = new Set(keys.map(normalizeSyncKey).filter(Boolean));
  if (toRemove.size === 0) return;
  tb[kind] = tb[kind].filter((item) => !toRemove.has(normalizeSyncKey(item)));
}

function isKeyTombstoned(
  kind: keyof DeletedTombstonesStore,
  ...keys: Array<string | undefined | null>
): boolean {
  const tb = ensureStoreTracking();
  if (tb[kind].length === 0) return false;
  const set = new Set(tb[kind].map(normalizeSyncKey));
  return keys.some((k) => {
    const nk = normalizeSyncKey(k);
    return nk ? set.has(nk) : false;
  });
}

function markMasterItemUnsynced(
  kind: 'drivers' | 'vehicles' | 'routes' | 'fleetCards',
  id: string
): void {
  ensureStoreTracking();
  const norm = normalizeSyncKey(id);
  if (!norm) return;
  const prop =
    kind === 'drivers'
      ? 'unsyncedDriverIds'
      : kind === 'vehicles'
      ? 'unsyncedVehicleIds'
      : kind === 'fleetCards'
      ? 'unsyncedFleetCardIds'
      : 'unsyncedRouteIds';
  const set = new Set((store[prop] || []).map(normalizeSyncKey).filter(Boolean));
  set.add(norm);
  store[prop] = Array.from(set);
  store.needsMasterSheetSync = true;
}

function removeMasterItemUnsynced(
  kind: 'drivers' | 'vehicles' | 'routes' | 'fleetCards',
  id: string
): void {
  ensureStoreTracking();
  const norm = normalizeSyncKey(id);
  if (!norm) return;
  const prop =
    kind === 'drivers'
      ? 'unsyncedDriverIds'
      : kind === 'vehicles'
      ? 'unsyncedVehicleIds'
      : kind === 'fleetCards'
      ? 'unsyncedFleetCardIds'
      : 'unsyncedRouteIds';
  store[prop] = (store[prop] || []).filter((k) => normalizeSyncKey(k) !== norm);
}

function snapshotSyncedIdsFromCurrentStore(): void {
  ensureStoreTracking();
  if (store.spreadsheetId) {
    store.lastSyncedSpreadsheetId = store.spreadsheetId.trim();
  }
  store.syncedDriverIds = store.drivers
    .map((d) => normalizeSyncKey(d.id))
    .filter(Boolean);
  store.syncedVehicleIds = store.vehicles
    .map((v) => normalizeSyncKey(v.id))
    .filter(Boolean);
  store.syncedRouteIds = store.routes
    .map((r) => normalizeSyncKey(r.id))
    .filter(Boolean);
  store.syncedFleetCardIds = store.fleetCards
    .map((fc) => normalizeSyncKey(fc.id))
    .filter(Boolean);
  store.syncedAssignmentNos = store.assignments
    .filter((a) => !a.needsSheetSync)
    .map((a) => normalizeSyncKey(a.noPenugasan))
    .filter(Boolean);
  store.syncedExpenseIds = store.driverExpenses
    .filter((e) => !e.needsSheetSync)
    .map((e) => normalizeSyncKey(e.id))
    .filter(Boolean);
}

function extractSequenceFromNo(noPenugasan: string): number {
  const cleaned = String(noPenugasan || '').trim();
  const match = cleaned.match(/(\d+)\s*$/);
  if (match) {
    const num = parseInt(match[1], 10);
    return Number.isFinite(num) ? num : 0;
  }
  return 0;
}

function computeNextSequence(currentStore: PersistentStore): number {
  let maxSeq = currentStore.lastSequence || 0;
  for (const item of currentStore.assignments) {
    if (typeof item.sequenceNumber === 'number' && item.sequenceNumber > maxSeq) {
      maxSeq = item.sequenceNumber;
    }
    const parsedFromNo = extractSequenceFromNo(item.noPenugasan);
    if (parsedFromNo > maxSeq) {
      maxSeq = parsedFromNo;
    }
  }
  return maxSeq + 1;
}

function formatSequentialNo(prefix: string, seq: number, dateStr?: string): string {
  const safePrefix = (prefix || 'ST-CRK').trim().toUpperCase();
  const d = dateStr ? new Date(dateStr) : new Date();
  const year = Number.isNaN(d.getTime()) ? new Date().getFullYear() : d.getFullYear();
  const month = String(
    (Number.isNaN(d.getTime()) ? new Date().getMonth() : d.getMonth()) + 1
  ).padStart(2, '0');
  const paddedSeq = String(seq).padStart(4, '0');
  return `${safePrefix}/${year}/${month}/${paddedSeq}`;
}

function normalizePhone(phone: string): string {
  const token = String(phone || '')
    .split(',')[0]
    .trim();
  if (
    !token ||
    token.includes('@g.us') ||
    token.startsWith('http://') ||
    token.startsWith('https://')
  ) {
    return '';
  }
  const digits = token.replace(/[^\d+]/g, '').trim();
  if (!digits) return '';
  if (digits.startsWith('08')) {
    return '62' + digits.slice(1);
  }
  if (digits.startsWith('+62')) {
    return digits.slice(1);
  }
  if (digits.startsWith('8')) {
    return '62' + digits;
  }
  return digits.replace(/^\+/, '');
}

function buildWaGroupUrl(message: string): string {
  return `https://wa.me/?text=${encodeURIComponent(message)}`;
}

function buildWaDirectUrl(targetPhone: string, message: string): string {
  const cleanPhone = normalizePhone(targetPhone);
  const encoded = encodeURIComponent(message);
  if (cleanPhone) {
    return `https://wa.me/${cleanPhone}?text=${encoded}`;
  }
  return `https://wa.me/?text=${encoded}`;
}

function pinsMatchResilient(storedPin: string, enteredPin: string): boolean {
  const a = String(storedPin ?? '').trim();
  const b = String(enteredPin ?? '').trim();
  if (!a) return true;
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    if (a.replace(/^0+/, '') === b.replace(/^0+/, '') && b.length >= a.length) {
      return true;
    }
  }
  return false;
}

function resolveDriverPhone(driverId: string, fallbackPhone?: string): string {
  const direct = String(fallbackPhone || '').trim();
  if (direct) return direct;
  const cleanId = String(driverId || '').trim().toLowerCase();
  if (!cleanId) return '';
  const found = store.drivers.find(
    (d) => d.id.trim().toLowerCase() === cleanId
  );
  return found?.phone ? String(found.phone).trim() : '';
}

function formatWibTimestamp(isoOrDate?: string): string {
  const d = isoOrDate ? new Date(isoOrDate) : new Date();
  if (Number.isNaN(d.getTime())) return String(isoOrDate || '-');
  return `${d.toLocaleString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })} WIB`;
}

function formatDriverRealtimeWhatsAppMessage(
  asg: AssignmentRecord,
  eventType: NotificationRecord['eventType'],
  groupName?: string
): string {
  const headerByEvent: Record<NotificationRecord['eventType'], string> = {
    SURAT_TUGAS: '*[CRK LOGISTIK — NOTIFIKASI SURAT TUGAS DRIVER REAL-TIME]*',
    KEBERANGKATAN:
      '*[CRK LOGISTIK — NOTIFIKASI KEBERANGKATAN DRIVER REAL-TIME]*',
    DELIVERED:
      '*[CRK LOGISTIK — NOTIFIKASI TIBA DI TUJUAN (DELIVERED) REAL-TIME]*',
    SERAH_TERIMA:
      '*[CRK LOGISTIK — NOTIFIKASI SERAH TERIMA (HANDOVER) REAL-TIME]*',
    UJI_JARINGAN: '*[CRK LOGISTIK — UJI NOTIFIKASI WHATSAPP REAL-TIME]*',
  };

  const dep = asg.departureData;
  const ho = asg.handoverData;
  const jenisKendaraan = dep?.jenisKendaraan || 'Mobil Pendingin';
  const isPendingin = jenisKendaraan !== 'Non Pendingin';
  const titikBerangkat =
    dep?.titikKeberangkatan || asg.origin || 'Menunggu Input Driver';
  const kmDelta =
    dep && ho && ho.kmAkhir >= dep.kmAwal ? ho.kmAkhir - dep.kmAwal : null;

  const departureLines = dep
    ? [
        '*--- DATA KEBERANGKATAN ---*',
        `Waktu Berangkat : ${formatWibTimestamp(dep.timestamp)}`,
        `Titik Keberangkatan : ${titikBerangkat}`,
        `Jenis Armada : ${jenisKendaraan}`,
        `Odometer Awal : ${dep.kmAwal.toLocaleString('id-ID')} km`,
        isPendingin ? `Suhu Monitor Awal : ${dep.suhuAwal || '-'}` : '',
        `BBM Awal : ${dep.bbmAwal || '-'}`,
        `Kondisi Unit : ${dep.kondisiKendaraan || '-'}`,
        isPendingin
          ? `Foto Berangkat : Odometer (${
              dep.fotoOdometerBerangkat ? 'Ada' : '-'
            }), Monitor Pendingin (${dep.fotoSuhuBerangkat ? 'Ada' : '-'})`
          : `Foto Berangkat : Odometer (${
              dep.fotoOdometerBerangkat ? 'Ada' : '-'
            })`,
        dep.catatanBerangkat
          ? `Catatan Berangkat : ${dep.catatanBerangkat}`
          : '',
      ]
    : [
        '*--- DATA KEBERANGKATAN ---*',
        'Status Keberangkatan : Menunggu pengisian laporan keberangkatan Driver',
      ];

  const handoverLines = ho
    ? [
        '*--- DATA SERAH TERIMA (HANDOVER) ---*',
        `Waktu Serah Terima : ${formatWibTimestamp(ho.timestamp)}`,
        `Odometer Akhir : ${ho.kmAkhir.toLocaleString('id-ID')} km${
          kmDelta !== null
            ? ` (Jarak Tempuh: ${kmDelta.toLocaleString('id-ID')} km)`
            : ''
        }`,
        isPendingin ? `Suhu Monitor Akhir : ${ho.suhuAkhir || '-'}` : '',
        `BBM Akhir : ${ho.bbmAkhir || '-'}`,
        `Nama Penerima : ${ho.penerimaNama || '-'}`,
        `Kondisi Akhir : ${ho.kondisiAkhir || '-'}`,
        isPendingin
          ? `Bukti & TTD : Odometer (${
              ho.fotoOdometerSerahTerima ? 'Ada' : '-'
            }), Monitor Pendingin (${
              ho.fotoSuhuSerahTerima ? 'Ada' : '-'
            }), Bukti (${ho.fotoBuktiSerahTerima ? 'Ada' : '-'}), TTD (${
              ho.tandaTanganPenerima ? 'Tersimpan' : '-'
            })`
          : `Bukti & TTD : Odometer (${
              ho.fotoOdometerSerahTerima ? 'Ada' : '-'
            }), Bukti (${ho.fotoBuktiSerahTerima ? 'Ada' : '-'}), TTD (${
              ho.tandaTanganPenerima ? 'Tersimpan' : '-'
            })`,
        ho.catatanSerahTerima
          ? `Catatan Serah Terima : ${ho.catatanSerahTerima}`
          : '',
      ]
    : asg.status === 'Delivered'
    ? [
        '*--- DATA SERAH TERIMA (HANDOVER) ---*',
        `Waktu Tiba (Delivered) : ${formatWibTimestamp(
          asg.deliveredAt || new Date().toISOString()
        )}`,
        'Status Serah Terima : Armada telah tiba di tujuan (Delivered) — siap proses berita acara Handover',
      ]
    : [
        '*--- DATA SERAH TERIMA (HANDOVER) ---*',
        'Status Serah Terima : Menunggu penyelesaian perjalanan & berita acara serah terima',
      ];

  const resolvedPhone = resolveDriverPhone(asg.driverId, asg.driverPhone);
  const sjList = String(asg.noSuratJalanFisik || '')
    .split(/[,;\r\n]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const sjLine =
    sjList.length > 1
      ? `No. Surat Jalan (${sjList.length}) : ${sjList.join(', ')}`
      : sjList.length === 1
      ? `No. Surat Jalan : ${sjList[0]}`
      : '';
  const extraMuatan = [asg.beratMuatan, asg.volumeCbm]
    .filter(Boolean)
    .join(' · ');
  const muatanDisplay = extraMuatan
    ? `${asg.purpose || '-'} (${extraMuatan})`
    : asg.purpose || '-';

  return [
    headerByEvent[eventType] || headerByEvent.KEBERANGKATAN,
    `Waktu Pesan WA : ${formatWibTimestamp()}`,
    groupName ? `Grup Operasional : ${groupName}` : '',
    `No. Penugasan : ${asg.noPenugasan}`,
    `ID Penugasan : ${asg.id}`,
    sjLine,
    asg.kodeSegel ? `Kode Segel : ${asg.kodeSegel}` : '',
    `Jadwal Tugas : ${asg.tanggalTugas}${
      asg.jadwalJamTiba ? ` (Target Tiba ${asg.jadwalJamTiba})` : ''
    }`,
    `Driver : ${asg.driverId} - ${asg.driverName}${
      resolvedPhone ? ` (${resolvedPhone})` : ''
    }`,
    `Armada : ${asg.plateNumber}${
      asg.vehicleType ? ` (${asg.vehicleType})` : ''
    }`,
    dep ? `Jenis Armada : ${jenisKendaraan}` : '',
    `Titik Keberangkatan : ${titikBerangkat}`,
    `Tujuan Pengiriman : ${asg.destination}`,
    `Rute : ${titikBerangkat} -> ${asg.destination}`,
    `Muatan : ${muatanDisplay}`,
    `Status Real-Time : ${asg.status}`,
    asg.notes ? `Instruksi Dispatcher : ${asg.notes}` : '',
    '',
    ...departureLines,
    '',
    ...handoverLines,
  ]
    .filter((line, idx, arr) => {
      if (line !== '') return true;
      return idx > 0 && arr[idx - 1] !== '';
    })
    .join('\n')
    .trim();
}

async function dispatchWhatsAppNetwork(params: {
  eventType:
    | 'SURAT_TUGAS'
    | 'KEBERANGKATAN'
    | 'DELIVERED'
    | 'SERAH_TERIMA'
    | 'UJI_JARINGAN';
  noPenugasan: string;
  assignmentId?: string;
  destination?: string;
  actorRole?: 'ADMIN' | 'DRIVER' | 'SYSTEM';
  summary?: string;
  readByAdmin?: boolean;
  readByDriver?: boolean;
  driverId: string;
  driverName: string;
  plateNumber: string;
  driverPhone?: string;
  targets: string[];
  message: string;
}): Promise<NotificationRecord> {
  const apiUrl = (process.env.WHATSAPP_API_URL || '').trim();
  const apiToken = (process.env.WHATSAPP_API_TOKEN || '').trim();
  const resolvedDriverPhone = normalizePhone(
    resolveDriverPhone(params.driverId, params.driverPhone)
  );
  const cleanedPhoneTargets = Array.from(
    new Set(
      [resolvedDriverPhone, ...params.targets.map(normalizePhone)].filter(
        Boolean
      )
    )
  );
  const groupJidTarget = store.whatsappGroupInviteUrl.includes('@g.us')
    ? store.whatsappGroupInviteUrl.trim()
    : '';
  const gatewayTargets = Array.from(
    new Set([groupJidTarget, ...cleanedPhoneTargets].filter(Boolean))
  );

  const primaryPhone =
    resolvedDriverPhone ||
    cleanedPhoneTargets[0] ||
    normalizePhone(store.dispatcherWaPhone);
  const preferGroup = store.whatsappTargetMode === 'GROUP';
  const preferDriver = store.whatsappTargetMode === 'DRIVER';

  const waGroupUrl = buildWaGroupUrl(params.message);
  const waDriverUrl = buildWaDirectUrl(
    resolvedDriverPhone || primaryPhone,
    params.message
  );
  const waDirectUrl = preferGroup
    ? waGroupUrl
    : preferDriver
    ? waDriverUrl
    : buildWaDirectUrl(primaryPhone, params.message);

  const targetDisplay = preferGroup
    ? store.whatsappGroupName || 'Grup WhatsApp'
    : preferDriver && resolvedDriverPhone
    ? resolvedDriverPhone
    : cleanedPhoneTargets.length > 0
    ? cleanedPhoneTargets.join(', ')
    : store.dispatcherWaPhone || store.whatsappGroupName || 'Grup WhatsApp';

  let networkStatus: 'TERKIRIM_GATEWAY' | 'SIAP_GATEWAY' | 'GAGAL_JARINGAN' =
    'SIAP_GATEWAY';
  let gatewayDetail = preferGroup
    ? `Siap dikirim otomatis ke Grup WhatsApp (${
        store.whatsappGroupName || 'Pilih Grup di WhatsApp'
      }) & WA Driver.`
    : `Siap dikirim otomatis ke WhatsApp Driver${
        resolvedDriverPhone ? ` (${resolvedDriverPhone})` : ''
      } & Dispatcher.`;

  if (apiUrl && gatewayTargets.length > 0) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 6500);
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (apiToken) {
        headers['Authorization'] = apiToken;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          target: gatewayTargets.join(','),
          phone: resolvedDriverPhone || gatewayTargets[0],
          driverPhone: resolvedDriverPhone || undefined,
          group: groupJidTarget || undefined,
          message: params.message,
          eventType: params.eventType,
          noPenugasan: params.noPenugasan,
          driverId: params.driverId,
          driverName: params.driverName,
          plateNumber: params.plateNumber,
        }),
        signal: controller.signal,
      });
      clearTimeout(timeout);

      if (response.ok) {
        networkStatus = 'TERKIRIM_GATEWAY';
        gatewayDetail = `Terkirim otomatis real-time via WhatsApp Gateway (HTTP ${response.status}) ke Driver & Operasional.`;
      } else {
        networkStatus = 'GAGAL_JARINGAN';
        gatewayDetail = `Gateway merespons HTTP ${response.status}. Notifikasi real-time WA Driver/Grup siap dibuka.`;
      }
    } catch (err: unknown) {
      networkStatus = 'GAGAL_JARINGAN';
      const msg = err instanceof Error ? err.message : 'Koneksi gateway gagal';
      gatewayDetail = `Gateway tidak terjangkau (${msg}). Notifikasi real-time WA Driver/Grup siap dibuka.`;
    }
  }

  const record: NotificationRecord = {
    id: `WA-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date().toISOString(),
    eventType: params.eventType,
    noPenugasan: params.noPenugasan,
    assignmentId: params.assignmentId,
    destination: params.destination,
    actorRole: params.actorRole || 'DRIVER',
    summary: params.summary,
    readByAdmin: params.readByAdmin ?? false,
    readByDriver: params.readByDriver ?? false,
    driverId: params.driverId,
    driverName: params.driverName,
    plateNumber: params.plateNumber,
    targetPhone: targetDisplay,
    message: params.message,
    waDirectUrl,
    waGroupUrl,
    waDriverUrl,
    networkStatus,
    gatewayDetail,
  };

  store.notifications = [record, ...store.notifications].slice(0, 200);
  saveStore(store);
  return record;
}

function extractPureBase64AndMimeServer(raw?: string): {
  pureBase64: string;
  mimeType: string;
  ext: 'jpg' | 'png';
} {
  if (!raw || typeof raw !== 'string') {
    return { pureBase64: '', mimeType: 'image/jpeg', ext: 'jpg' };
  }
  const trimmed = raw.trim();
  const dataMatch = trimmed.match(
    /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i
  );
  if (dataMatch) {
    const mime = dataMatch[1].toLowerCase();
    const ext: 'jpg' | 'png' = mime.includes('png') ? 'png' : 'jpg';
    return {
      pureBase64: dataMatch[2].replace(/\s+/g, ''),
      mimeType: mime,
      ext,
    };
  }
  return { pureBase64: '', mimeType: 'image/jpeg', ext: 'jpg' };
}

function extractServerGoogleDriveFolderId(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed) return '';
  const folderMatch = trimmed.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
  if (folderMatch) return folderMatch[1];
  const idParamMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (idParamMatch) return idParamMatch[1];
  if (/^[a-zA-Z0-9_-]{10,}$/.test(trimmed)) return trimmed;
  return '';
}

function buildPublicState() {
  const sortedAssignments = [...store.assignments].sort((a, b) => {
    if (b.sequenceNumber !== a.sequenceNumber) {
      return b.sequenceNumber - a.sequenceNumber;
    }
    return b.createdAt.localeCompare(a.createdAt);
  });

  const sortedDriverExpenses = [...(store.driverExpenses || [])].sort((a, b) =>
    String(b.timestamp || '').localeCompare(String(a.timestamp || ''))
  );

  return {
    drivers: store.drivers,
    vehicles: store.vehicles,
    routes: store.routes,
    fleetCards: store.fleetCards || [],
    assignments: sortedAssignments,
    driverExpenses: sortedDriverExpenses,
    notifications: store.notifications,
    config: {
      spreadsheetId: store.spreadsheetId,
      spreadsheetTitle: store.spreadsheetTitle,
      spreadsheetUrl: store.spreadsheetUrl,
      appsScriptUrl: store.appsScriptUrl || '',
      serverSheetSyncMode: store.appsScriptUrl
        ? ('APPS_SCRIPT_24_7' as const)
        : store.liveCsvReadable
        ? ('LIVE_CSV_AND_OAUTH' as const)
        : ('OAUTH_AUTO' as const),
      driveRootFolderId: store.driveRootFolderId || '',
      driveRootFolderUrl: store.driveRootFolderUrl || '',
      lastSyncedAt: store.lastSyncedAt,
      dispatcherWaPhone: store.dispatcherWaPhone,
      whatsappTargetMode: store.whatsappTargetMode || 'GROUP',
      whatsappGroupName:
        store.whatsappGroupName || 'Grup Operasional CRK Logistik',
      whatsappGroupInviteUrl: store.whatsappGroupInviteUrl || '',
      publicPortalBaseUrl: store.publicPortalBaseUrl || '',
      letterPrefix: store.letterPrefix || 'ST-CRK',
      lastSequence: store.lastSequence,
      isDefaultPin: store.isDefaultPin,
      whatsappGatewayConfigured: Boolean(
        (process.env.WHATSAPP_API_URL || '').trim()
      ),
    },
  };
}

async function startServer() {
  const app = express();
  const httpServer = createHttpServer(app);
  const wss = new WebSocketServer({ noServer: true });
  const PORT = Number(process.env.PORT) || 3000;

  interface TrackedSocket extends WebSocket {
    isAlive?: boolean;
    clientId?: string;
  }

  const getRequestClientId = (req: express.Request): string | undefined => {
    const raw = req.headers['x-client-id'];
    if (typeof raw === 'string' && raw.trim()) return raw.trim();
    return undefined;
  };

  const broadcastRealtime = (params: {
    type:
      | 'state:init'
      | 'state:sync'
      | 'assignment:created'
      | 'assignment:updated'
      | 'assignment:deleted'
      | 'whatsapp:dispatched';
    clientId?: string;
    actorRole?: 'ADMIN' | 'DRIVER' | 'SYSTEM';
    previousStatus?: string;
    assignment?: AssignmentRecord;
    deletedAssignmentId?: string;
    notification?: NotificationRecord;
  }) => {
    const publicState = buildPublicState();
    const payload = JSON.stringify({
      type: params.type,
      eventId: `evt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: new Date().toISOString(),
      clientId: params.clientId,
      actorRole: params.actorRole,
      previousStatus: params.previousStatus,
      assignment: params.assignment,
      deletedAssignmentId: params.deletedAssignmentId,
      notification: params.notification,
      state: publicState,
    });

    for (const client of wss.clients) {
      if (client.readyState === WebSocket.OPEN) {
        try {
          client.send(payload);
        } catch {
          // Ignore transient send error on closing socket
        }
      }
    }
    return publicState;
  };

  wss.on('connection', (ws: TrackedSocket, request) => {
    ws.isAlive = true;
    try {
      const parsedUrl = new URL(request.url || '/ws', 'http://localhost');
      ws.clientId = parsedUrl.searchParams.get('clientId') || undefined;
    } catch {
      ws.clientId = undefined;
    }

    ws.on('pong', () => {
      ws.isAlive = true;
    });

    ws.on('message', () => {
      ws.isAlive = true;
    });

    // Immediately push authoritative real-time state on connect
    try {
      ws.send(
        JSON.stringify({
          type: 'state:init',
          eventId: `evt-init-${Date.now()}`,
          timestamp: new Date().toISOString(),
          actorRole: 'SYSTEM',
          state: buildPublicState(),
        })
      );
    } catch {
      // Ignore send error
    }
  });

  const wsHeartbeat = setInterval(() => {
    for (const rawClient of wss.clients) {
      const client = rawClient as TrackedSocket;
      if (client.isAlive === false) {
        client.terminate();
        continue;
      }
      client.isAlive = false;
      try {
        client.ping();
      } catch {
        client.terminate();
      }
    }
  }, 25000);

  wss.on('close', () => {
    clearInterval(wsHeartbeat);
  });

  httpServer.on('upgrade', (request, socket, head) => {
    try {
      const parsedUrl = new URL(request.url || '/', 'http://localhost');
      if (parsedUrl.pathname === '/ws') {
        wss.handleUpgrade(request, socket, head, (ws) => {
          wss.emit('connection', ws, request);
        });
      }
    } catch {
      // Ignore non-/ws upgrade requests
    }
  });

  // Support compressed Cold Chain camera photos + canvas signatures + full Spreadsheet sync payloads
  app.use(express.json({ limit: '50mb' }));

  app.get('/api/state', (_req, res) => {
    res.json(buildPublicState());
  });

  app.get('/api/driver-link-ping', (_req, res) => {
    res.json({
      ok: true,
      service: 'crk-portal',
      timestamp: new Date().toISOString(),
    });
  });

  const normalizeExternalPortalUrl = (rawUrl?: string): string => {
    const trimmed = String(rawUrl || '').trim();
    if (!trimmed) return '';
    try {
      const candidate = /^https?:\/\//i.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
      const parsedUrl = new URL(candidate);
      if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
        return '';
      }
      return `${parsedUrl.protocol}//${parsedUrl.host}/`;
    } catch {
      return '';
    }
  };

  let lastSeenHost = '';
  app.use((req, _res, next) => {
    const h =
      (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() ||
      req.get('host') ||
      '';
    if (h && !h.startsWith('localhost') && !h.startsWith('127.0.0.1')) {
      lastSeenHost = h;
    }
    next();
  });

  const isRunningInAiStudioDev = (): boolean => {
    const appEnvUrl = String(process.env.APP_URL || '').trim();
    if (appEnvUrl.includes('ais-dev-')) return true;
    if (lastSeenHost.startsWith('ais-dev-')) return true;
    return false;
  };

  const getRelayTargetBaseUrl = (): string => {
    if (!isRunningInAiStudioDev()) return '';
    const normalized = normalizeExternalPortalUrl(store.publicPortalBaseUrl);
    if (!normalized) return '';
    try {
      const u = new URL(normalized);
      if (
        u.hostname.startsWith('ais-dev-') ||
        u.hostname.startsWith('ais-pre-') ||
        u.hostname === 'localhost' ||
        u.hostname === '127.0.0.1' ||
        (lastSeenHost && u.host.toLowerCase() === lastSeenHost.toLowerCase())
      ) {
        return '';
      }
      return normalized;
    } catch {
      return '';
    }
  };

  let relayPushTimer: ReturnType<typeof setTimeout> | null = null;
  let isRelayPushing = false;

  const pushStoreToPublicPortal = async () => {
    const targetBase = getRelayTargetBaseUrl();
    if (!targetBase || isRelayPushing) return;
    isRelayPushing = true;
    try {
      await fetch(`${targetBase}api/sync/reconcile`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-relay-origin': 'ais-dev',
        },
        body: JSON.stringify({
          config: {
            spreadsheetId: store.spreadsheetId,
            spreadsheetTitle: store.spreadsheetTitle,
            spreadsheetUrl: store.spreadsheetUrl,
            driveRootFolderId: store.driveRootFolderId,
            driveRootFolderUrl: store.driveRootFolderUrl,
            dispatcherWaPhone: store.dispatcherWaPhone,
            whatsappTargetMode: store.whatsappTargetMode,
            whatsappGroupName: store.whatsappGroupName,
            whatsappGroupInviteUrl: store.whatsappGroupInviteUrl,
            publicPortalBaseUrl: store.publicPortalBaseUrl,
            letterPrefix: store.letterPrefix,
            lastSequence: store.lastSequence,
          },
          adminPin: store.adminPin,
          isDefaultPin: store.isDefaultPin,
          drivers: store.drivers,
          vehicles: store.vehicles,
          routes: store.routes,
          fleetCards: store.fleetCards,
          assignments: store.assignments,
          driverExpenses: store.driverExpenses,
          replaceCollections: true,
        }),
        signal: AbortSignal.timeout(8000),
      });
    } catch {
      // Ignore transient relay push failure
    } finally {
      isRelayPushing = false;
    }
  };

  onStoreSavedHook = () => {
    if (!getRelayTargetBaseUrl()) return;
    if (relayPushTimer) clearTimeout(relayPushTimer);
    relayPushTimer = setTimeout(() => {
      void pushStoreToPublicPortal();
    }, 350);
  };

  let isRelayPulling = false;
  const relayStatusRank = (s: string): number => {
    if (s === 'Handover' || s === 'Selesai') return 3;
    if (s === 'Delivered') return 2;
    if (s === 'Dalam Perjalanan') return 1;
    return 0;
  };

  const pullDriverUpdatesFromPublicPortal = async () => {
    const targetBase = getRelayTargetBaseUrl();
    if (!targetBase || isRelayPulling) return;
    isRelayPulling = true;
    try {
      const res = await fetch(`${targetBase}api/state`, {
        method: 'GET',
        redirect: 'manual',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(5000),
      });
      if (res.status !== 200) return;
      const remoteState = (await res.json()) as {
        assignments?: AssignmentRecord[];
        notifications?: NotificationRecord[];
      };

      const existingNotifIds = new Set(store.notifications.map((n) => n.id));
      const addedNotifs: NotificationRecord[] = [];
      if (Array.isArray(remoteState.notifications)) {
        for (const rn of remoteState.notifications) {
          if (rn && rn.id && !existingNotifIds.has(rn.id)) {
            const cleanMsg = stripLegacyDriverLinkLine(rn.message || '');
            addedNotifs.push({
              ...rn,
              message: cleanMsg,
              waGroupUrl: buildWaGroupUrl(cleanMsg),
              waDirectUrl: buildWaDirectUrl(rn.targetPhone || '', cleanMsg),
              waDriverUrl: buildWaDirectUrl(rn.targetPhone || '', cleanMsg),
            });
            existingNotifIds.add(rn.id);
          }
        }
      }

      const progressedEvents: Array<{
        previousStatus: string;
        assignment: AssignmentRecord;
        notification?: NotificationRecord;
      }> = [];

      if (Array.isArray(remoteState.assignments)) {
        const remoteById = new Map<string, AssignmentRecord>();
        for (const ra of remoteState.assignments) {
          if (ra && ra.id) remoteById.set(ra.id, ra);
        }

        store.assignments = store.assignments.map((localAsg) => {
          const remoteAsg = remoteById.get(localAsg.id);
          if (!remoteAsg) return localAsg;

          const remoteRank = relayStatusRank(remoteAsg.status);
          const localRank = relayStatusRank(localAsg.status);
          const remoteHasNewDep =
            Boolean(remoteAsg.departureData?.timestamp) &&
            !localAsg.departureData?.timestamp;
          const remoteHasNewHo =
            Boolean(remoteAsg.handoverData?.timestamp) &&
            !localAsg.handoverData?.timestamp;

          if (remoteRank > localRank || remoteHasNewDep || remoteHasNewHo) {
            const previousStatus = localAsg.status;
            const mergedDrive = mergeDriveMediaLinks(
              localAsg.driveMedia,
              remoteAsg.driveMedia
            );
            const mergedAsg: AssignmentRecord = {
              ...localAsg,
              status: remoteRank >= localRank ? remoteAsg.status : localAsg.status,
              origin: remoteAsg.origin || localAsg.origin,
              deliveredAt: remoteAsg.deliveredAt || localAsg.deliveredAt,
              departureData: remoteAsg.departureData || localAsg.departureData,
              handoverData: remoteAsg.handoverData || localAsg.handoverData,
              driveFolderUrl:
                mergedDrive?.folderUrl ||
                localAsg.driveFolderUrl ||
                remoteAsg.driveFolderUrl,
              driveMedia: mergedDrive,
              needsSheetSync: true,
            };

            // Sync vehicle status when Driver departs or finishes handover
            const vIdx = store.vehicles.findIndex(
              (v) =>
                v.id.trim().toLowerCase() ===
                  mergedAsg.vehicleId.trim().toLowerCase() ||
                v.plateNumber.trim().toLowerCase() ===
                  mergedAsg.plateNumber.trim().toLowerCase()
            );
            if (vIdx >= 0) {
              if (
                mergedAsg.status === 'Handover' ||
                mergedAsg.status === 'Selesai'
              ) {
                store.vehicles[vIdx] = {
                  ...store.vehicles[vIdx],
                  status: 'Siap Jalan',
                };
              } else if (
                mergedAsg.status === 'Dalam Perjalanan' ||
                mergedAsg.status === 'Delivered'
              ) {
                store.vehicles[vIdx] = {
                  ...store.vehicles[vIdx],
                  status: 'Dalam Tugas',
                };
              }
            }

            const matchingNotif = addedNotifs.find(
              (n) => n.noPenugasan === mergedAsg.noPenugasan
            );
            progressedEvents.push({
              previousStatus,
              assignment: mergedAsg,
              notification: matchingNotif,
            });
            return mergedAsg;
          }
          return localAsg;
        });
      }

      if (addedNotifs.length > 0 || progressedEvents.length > 0) {
        if (addedNotifs.length > 0) {
          store.notifications = [...addedNotifs, ...store.notifications].slice(
            0,
            250
          );
        }
        saveStore(store, true);

        if (progressedEvents.length > 0) {
          for (const evt of progressedEvents) {
            broadcastRealtime({
              type: 'assignment:updated',
              actorRole: 'DRIVER',
              previousStatus: evt.previousStatus,
              assignment: evt.assignment,
              notification: evt.notification,
            });
          }
        } else {
          broadcastRealtime({
            type: 'state:sync',
            actorRole: 'DRIVER',
          });
        }
      }
    } catch {
      // Ignore transient relay poll failure
    } finally {
      isRelayPulling = false;
    }
  };

  const relayPollInterval = setInterval(() => {
    void pullDriverUpdatesFromPublicPortal();
  }, 5000);

  wss.on('close', () => {
    clearInterval(relayPollInterval);
  });

  let cachedPreProbe: {
    url: string;
    isLive: boolean;
    status: number;
    checkedAt: number;
  } | null = null;

  app.get('/api/driver-link-status', async (req, res) => {
    const forceRefresh = req.query.refresh === '1';
    const queryCustomProvided = typeof req.query.customUrl === 'string';
    const rawCustomCandidate = queryCustomProvided
      ? String(req.query.customUrl || '').trim()
      : String(store.publicPortalBaseUrl || '').trim();

    const envAppHost = (() => {
      try {
        return process.env.APP_URL ? new URL(process.env.APP_URL).host : '';
      } catch {
        return '';
      }
    })();

    const rawHost =
      (req.headers['x-forwarded-host'] as string)?.split(',')[0]?.trim() ||
      req.get('host') ||
      envAppHost ||
      `localhost:${PORT}`;
    const effectiveCheckHost =
      (rawHost.startsWith('localhost') || rawHost.startsWith('127.0.0.1')) &&
      envAppHost
        ? envAppHost
        : rawHost;
    const rawProto =
      (req.headers['x-forwarded-proto'] as string)?.split(',')[0]?.trim() ||
      req.protocol ||
      'http';
    const proto = effectiveCheckHost.endsWith('.run.app') ? 'https' : rawProto;
    const currentOriginUrl = `${proto}://${effectiveCheckHost}/`;
    const isDevHost = effectiveCheckHost.startsWith('ais-dev-');
    const isPreHost = effectiveCheckHost.startsWith('ais-pre-');
    const preUrl = isDevHost
      ? `https://ais-pre-${effectiveCheckHost.slice('ais-dev-'.length)}/`
      : isPreHost
      ? `https://${effectiveCheckHost}/`
      : '';

    let isPreUrlLive = isPreHost;
    if (isDevHost && preUrl) {
      const now = Date.now();
      if (
        !forceRefresh &&
        cachedPreProbe &&
        cachedPreProbe.url === preUrl &&
        now - cachedPreProbe.checkedAt < 12_000
      ) {
        isPreUrlLive = cachedPreProbe.isLive;
      } else {
        try {
          const probeRes = await fetch(preUrl, {
            method: 'GET',
            redirect: 'manual',
            signal: AbortSignal.timeout(3500),
          });
          let bodySnippet = '';
          if (probeRes.status === 404 || probeRes.status === 200) {
            bodySnippet = (await probeRes.text()).slice(0, 600);
          }
          isPreUrlLive =
            probeRes.status !== 404 &&
            probeRes.status !== 403 &&
            probeRes.status < 500 &&
            !bodySnippet.includes('Error: Page not found') &&
            !bodySnippet.includes(
              'The requested URL was not found on this server'
            );
          cachedPreProbe = {
            url: preUrl,
            isLive: isPreUrlLive,
            status: probeRes.status,
            checkedAt: now,
          };
        } catch {
          isPreUrlLive = false;
          cachedPreProbe = {
            url: preUrl,
            isLive: false,
            status: 0,
            checkedAt: now,
          };
        }
      }
    }

    const customBaseUrl = normalizeExternalPortalUrl(rawCustomCandidate);
    type AccessState =
      | 'PUBLIC_OPEN'
      | 'SHARED_GOOGLE_AUTH'
      | 'NEEDS_PUBLIC_SETUP'
      | 'CUSTOM_URL_ERROR';

    let accessState: AccessState = 'NEEDS_PUBLIC_SETUP';
    let isShareReady = false;
    let effectiveBaseUrl = '';
    let statusMessage = '';

    if (rawCustomCandidate) {
      if (!customBaseUrl) {
        accessState = 'CUSTOM_URL_ERROR';
        isShareReady = false;
        statusMessage =
          'Format alamat URL tidak valid. Masukkan alamat lengkap diawali https://...';
      } else {
        const customHost = new URL(customBaseUrl).hostname;
        if (customHost.startsWith('ais-dev-')) {
          accessState = 'CUSTOM_URL_ERROR';
          isShareReady = false;
          statusMessage =
            'Alamat ais-dev-... adalah server editor pribadi Google AI Studio dan selalu menyebabkan Error 403 di HP Driver. Gunakan alamat hasil Deploy Cloud Run atau tombol Share (Public).';
        } else {
          try {
            const pingRes = await fetch(`${customBaseUrl}api/driver-link-ping`, {
              method: 'GET',
              redirect: 'manual',
              signal: AbortSignal.timeout(4000),
            });
            if (pingRes.status === 200) {
              accessState = 'PUBLIC_OPEN';
              isShareReady = true;
              effectiveBaseUrl = customBaseUrl;
              statusMessage =
                'Server Publik Cloud Run aktif & terverifikasi! Driver dapat langsung membuka link di HP apa pun tanpa Error 403/404 dan tanpa perlu login Google.';
              if (store.publicPortalBaseUrl.trim()) {
                void pushStoreToPublicPortal();
              }
            } else if (
              pingRes.status === 301 ||
              pingRes.status === 302 ||
              pingRes.status === 303 ||
              pingRes.status === 307 ||
              pingRes.status === 308
            ) {
              accessState = 'SHARED_GOOGLE_AUTH';
              isShareReady = true;
              effectiveBaseUrl = customBaseUrl;
              statusMessage =
                'Alamat Share aktif. Pastikan izin Share di Google AI Studio disetel ke "Public / Anyone with the link" (bukan Restricted) agar HP Driver tidak terkena Error 403.';
            } else if (pingRes.status === 401 || pingRes.status === 403) {
              accessState = 'CUSTOM_URL_ERROR';
              isShareReady = false;
              statusMessage =
                'Alamat tersebut masih mengembalikan Error 403 (Forbidden). Pastikan saat Deploy Cloud Run opsi "Allow unauthenticated invocations" diaktifkan.';
            } else if (pingRes.status === 404) {
              // Fallback check root HTML in case older container doesn't have /api/driver-link-ping yet
              const rootRes = await fetch(customBaseUrl, {
                method: 'GET',
                redirect: 'manual',
                signal: AbortSignal.timeout(3500),
              });
              const rootSnippet =
                rootRes.status === 200 || rootRes.status === 404
                  ? (await rootRes.text()).slice(0, 600)
                  : '';
              if (
                rootRes.status === 200 &&
                !rootSnippet.includes('Error: Page not found')
              ) {
                accessState = 'PUBLIC_OPEN';
                isShareReady = true;
                effectiveBaseUrl = customBaseUrl;
                statusMessage =
                  'Server Publik Cloud Run aktif & siap diakses oleh HP Driver tanpa Error 403/404.';
                if (store.publicPortalBaseUrl.trim()) {
                  void pushStoreToPublicPortal();
                }
              } else {
                accessState = 'CUSTOM_URL_ERROR';
                isShareReady = false;
                statusMessage =
                  'Alamat tersebut mengembalikan Error 404 (Page not found). Pastikan proses Deploy / Share sudah selesai.';
              }
            } else {
              accessState = 'CUSTOM_URL_ERROR';
              isShareReady = false;
              statusMessage = `Server merespons dengan status HTTP ${pingRes.status}. Pastikan alamat server publik benar.`;
            }
          } catch {
            accessState = 'CUSTOM_URL_ERROR';
            isShareReady = false;
            statusMessage =
              'Tidak dapat menghubungi alamat URL tersebut. Periksa kembali penulisan URL https://...run.app Anda.';
          }
        }
      }
    } else if (!isDevHost && !isPreHost) {
      // Running directly on a deployed Cloud Run service (or standalone server)
      accessState = 'PUBLIC_OPEN';
      isShareReady = true;
      effectiveBaseUrl = currentOriginUrl;
      statusMessage =
        'Aplikasi berjalan langsung di Server Publik. Seluruh Link Khusus Driver siap dibuka di HP mana pun tanpa Error 403/404.';
    } else if (isPreUrlLive && preUrl) {
      accessState = 'SHARED_GOOGLE_AUTH';
      isShareReady = true;
      effectiveBaseUrl = preUrl;
      statusMessage =
        'URL Share aplikasi (ais-pre-...) telah aktif. Pastikan di pengaturan Share Google AI Studio dipilih "Public / Anyone with the link" (bukan Restricted) agar HP Driver tidak terkena Error 403.';
    } else {
      accessState = 'NEEDS_PUBLIC_SETUP';
      isShareReady = false;
      effectiveBaseUrl = '';
      statusMessage =
        'Aplikasi saat ini masih berada di mode Editor Pribadi (ais-dev-...) yang dikunci Google khusus untuk akun pembuat aplikasi, sehingga HP Driver akan ditolak dengan Error 403. Aktifkan Deploy Cloud Run atau Share (Public) di pojok kanan atas layar Google AI Studio.';
    }

    res.json({
      accessState,
      isShareReady,
      statusMessage,
      isDevHost,
      isPreUrlLive,
      preUrl,
      currentOriginUrl,
      customBaseUrl:
        customBaseUrl && !new URL(customBaseUrl).hostname.startsWith('ais-dev-')
          ? customBaseUrl
          : '',
      effectiveBaseUrl,
    });
  });

  app.get('/api/assignments/next-number', (req, res) => {
    const tanggal =
      typeof req.query.tanggal === 'string' ? req.query.tanggal : undefined;
    const nextSeq = computeNextSequence(store);
    const nextNo = formatSequentialNo(store.letterPrefix, nextSeq, tanggal);
    res.json({ sequenceNumber: nextSeq, noPenugasan: nextNo });
  });

  const hydrateMissingAssignmentSnapshot = (
    snap: Partial<AssignmentRecord> | undefined,
    allowOverrideTombstone = false
  ): number => {
    if (!snap || typeof snap !== 'object' || !snap.id || !snap.noPenugasan) {
      return -1;
    }
    if (
      !allowOverrideTombstone &&
      isKeyTombstoned('assignments', snap.id, snap.noPenugasan)
    ) {
      return -1;
    }
    const existingIdx = store.assignments.findIndex(
      (a) =>
        a.id === snap.id ||
        a.noPenugasan.trim().toLowerCase() ===
          String(snap.noPenugasan).trim().toLowerCase()
    );
    if (existingIdx !== -1) return existingIdx;

    const seq = Math.max(
      1,
      Number(snap.sequenceNumber) || extractSequenceFromNo(snap.noPenugasan) || 1
    );
    const restored: AssignmentRecord = {
      id: String(snap.id).trim(),
      sequenceNumber: seq,
      noPenugasan: String(snap.noPenugasan).trim(),
      noSuratJalanFisik: String(snap.noSuratJalanFisik || '').trim(),
      kodeSegel: String(snap.kodeSegel || '').trim(),
      createdAt: String(snap.createdAt || new Date().toISOString()),
      tanggalTugas: String(
        snap.tanggalTugas || new Date().toISOString().slice(0, 10)
      ).trim(),
      jadwalJamTiba: snap.jadwalJamTiba
        ? String(snap.jadwalJamTiba).trim()
        : undefined,
      deliveredAt: snap.deliveredAt,
      driverId: String(snap.driverId || '').trim().toUpperCase(),
      driverName: String(snap.driverName || 'Driver').trim(),
      driverPhone: String(snap.driverPhone || '').trim(),
      vehicleId: String(snap.vehicleId || '').trim().toUpperCase(),
      plateNumber: String(snap.plateNumber || '-').trim().toUpperCase(),
      vehicleType: String(snap.vehicleType || '').trim(),
      originId: String(snap.originId || '').trim(),
      origin:
        String(snap.origin || '').trim() ||
        'Menunggu Titik Keberangkatan Driver',
      routeId: String(snap.routeId || '').trim(),
      destination: String(snap.destination || '-').trim(),
      purpose: String(snap.purpose || '').trim(),
      beratMuatan: snap.beratMuatan
        ? String(snap.beratMuatan).trim()
        : undefined,
      volumeCbm: snap.volumeCbm ? String(snap.volumeCbm).trim() : undefined,
      status:
        snap.status === 'Dalam Perjalanan' ||
        snap.status === 'Delivered' ||
        snap.status === 'Handover' ||
        snap.status === 'Selesai'
          ? snap.status
          : 'Menunggu Berangkat',
      notes: String(snap.notes || '').trim(),
      departureData: snap.departureData,
      handoverData: snap.handoverData,
      driveFolderUrl: snap.driveFolderUrl,
      driveMedia: mergeDriveMediaLinks(snap.driveMedia, undefined),
      needsSheetSync: true,
    };
    store.assignments.push(restored);
    if (seq > store.lastSequence) {
      store.lastSequence = seq;
    }
    return store.assignments.length - 1;
  };

  // Self-healing Driver Link & Offline Task Context Recovery
  app.post('/api/driver/ensure-context', (req, res) => {
    const drvSnap = req.body?.driverSnapshot as Partial<DriverRecord> | undefined;
    const asgSnaps = Array.isArray(req.body?.assignmentSnapshots)
      ? (req.body.assignmentSnapshots as Array<Partial<AssignmentRecord>>)
      : [];

    let mutated = false;

    if (drvSnap && drvSnap.id && drvSnap.name) {
      const cleanId = String(drvSnap.id).trim().toUpperCase();
      const exists = store.drivers.some(
        (d) => d.id.trim().toLowerCase() === cleanId.toLowerCase()
      );
      if (!exists && !isKeyTombstoned('drivers', cleanId)) {
        store.drivers.push({
          id: cleanId,
          name: String(drvSnap.name).trim(),
          phone: String(drvSnap.phone || '').trim(),
          pin: String(drvSnap.pin || '').trim(),
          licenseType: String(drvSnap.licenseType || '').trim(),
          active: drvSnap.active !== false,
        });
        mutated = true;
      }
    }

    // Only auto-restore cached driver assignments when server genuinely cold-started with zero sync history
    // and never when a clean reset / assignment deletion push is pending
    const serverLooksColdStarted =
      store.assignments.length === 0 &&
      store.lastSequence === 0 &&
      !store.lastSyncedAt &&
      !store.lastSyncedSpreadsheetId;
    const isDirectLinkTask = Boolean(req.body?.fromUrlLink);

    if (
      !store.pendingAssignmentDeletionPush &&
      (serverLooksColdStarted || isDirectLinkTask)
    ) {
      for (const snap of asgSnaps) {
        const beforeLen = store.assignments.length;
        hydrateMissingAssignmentSnapshot(snap, false);
        if (store.assignments.length > beforeLen) {
          mutated = true;
        }
      }
    }

    if (mutated) {
      saveStore(store);
      const publicState = broadcastRealtime({
        type: 'state:sync',
        clientId: getRequestClientId(req),
        actorRole: 'SYSTEM',
      });
      res.json({ success: true, restored: true, state: publicState });
      return;
    }

    res.json({ success: true, restored: false, state: buildPublicState() });
  });

  // Resilient Driver Login
  app.post('/api/auth/driver', (req, res) => {
    const driverId = String(req.body?.driverId || '').trim();
    const pin = String(req.body?.pin || '').trim();
    const drvSnap = req.body?.driverSnapshot as Partial<DriverRecord> | undefined;

    if (!driverId) {
      res
        .status(400)
        .json({ error: 'Pilih ID Driver terlebih dahulu dari daftar dropdown.' });
      return;
    }

    let driver = store.drivers.find(
      (d) => d.id.trim().toLowerCase() === driverId.toLowerCase()
    );

    if (!driver && drvSnap && drvSnap.id && drvSnap.name) {
      const snapId = String(drvSnap.id).trim().toUpperCase();
      if (snapId.toLowerCase() === driverId.toLowerCase()) {
        driver = {
          id: snapId,
          name: String(drvSnap.name).trim(),
          phone: String(drvSnap.phone || '').trim(),
          pin: String(drvSnap.pin || '').trim(),
          licenseType: String(drvSnap.licenseType || '').trim(),
          active: drvSnap.active !== false,
        };
        store.drivers.push(driver);
        saveStore(store);
      }
    }

    if (!driver) {
      res.status(404).json({
        error:
          'ID Driver tidak ditemukan. Silakan tekan tombol Sinkronkan Data untuk memuat data terbaru dari Spreadsheet.',
      });
      return;
    }

    if (driver.active === false) {
      res.status(403).json({
        error: `ID Driver ${driver.id} (${driver.name}) berstatus nonaktif. Silakan hubungi Admin Dispatcher.`,
      });
      return;
    }

    if (!pinsMatchResilient(driver.pin, pin)) {
      res.status(401).json({
        error:
          'PIN Driver tidak sesuai. Pastikan angka PIN benar atau hubungi Admin Dispatcher.',
      });
      return;
    }

    res.json({
      success: true,
      driver,
    });
  });

  // Admin Login
  app.post('/api/auth/admin', (req, res) => {
    const pin = String(req.body?.pin || '').trim();
    if (!pin) {
      res.status(400).json({ error: 'Masukkan PIN Admin Dispatcher.' });
      return;
    }

    if (pin !== store.adminPin.trim()) {
      res.status(401).json({ error: 'PIN Admin Dispatcher tidak valid.' });
      return;
    }

    res.json({
      success: true,
      isDefaultPin: store.isDefaultPin,
    });
  });

  // Admin Change Own PIN
  app.put('/api/admin/pin', async (req, res) => {
    const currentPin = String(req.body?.currentPin || '').trim();
    const newPin = String(req.body?.newPin || '').trim();

    if (!currentPin || !newPin) {
      res.status(400).json({ error: 'PIN lama dan PIN baru wajib diisi.' });
      return;
    }

    if (currentPin !== store.adminPin.trim()) {
      res.status(401).json({ error: 'PIN saat ini tidak sesuai.' });
      return;
    }

    if (newPin.length < 4) {
      res
        .status(400)
        .json({ error: 'PIN baru minimal terdiri dari 4 karakter/angka.' });
      return;
    }

    store.adminPin = newPin;
    store.isDefaultPin = false;
    saveStore(store);

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });

    res.json({
      success: true,
      adminPin: store.adminPin,
      state: publicState,
    });
  });

  // Restore permanent customized Admin PIN if server container restarted with factory default
  app.post('/api/admin/pin/restore', (req, res) => {
    const savedPin = String(req.body?.savedPin || '').trim();
    if (!savedPin || savedPin.length < 4 || savedPin === '123456') {
      res.json({
        success: false,
        restored: false,
        adminPin: store.adminPin,
        state: buildPublicState(),
      });
      return;
    }

    if (store.isDefaultPin || store.adminPin.trim() === '123456') {
      store.adminPin = savedPin;
      store.isDefaultPin = false;
      saveStore(store);

      const publicState = broadcastRealtime({
        type: 'state:sync',
        clientId: getRequestClientId(req),
        actorRole: 'SYSTEM',
      });
      res.json({
        success: true,
        restored: true,
        adminPin: store.adminPin,
        state: publicState,
      });
      return;
    }

    res.json({
      success: true,
      restored: false,
      adminPin: store.adminPin,
      state: buildPublicState(),
    });
  });

  // Update Config
  app.put('/api/config', async (req, res) => {
    const {
      spreadsheetId,
      spreadsheetTitle,
      spreadsheetUrl,
      appsScriptUrl,
      driveRootFolderId,
      driveRootFolderUrl,
      dispatcherWaPhone,
      whatsappTargetMode,
      whatsappGroupName,
      whatsappGroupInviteUrl,
      publicPortalBaseUrl,
      letterPrefix,
      lastSyncedAt,
    } = req.body || {};

    if (typeof appsScriptUrl === 'string') {
      store.appsScriptUrl = appsScriptUrl.trim();
    }
    if (typeof spreadsheetUrl === 'string') {
      const nextUrl = spreadsheetUrl.trim();
      store.spreadsheetUrl = nextUrl;
      const extractedMatch = nextUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
      if (extractedMatch?.[1] && !spreadsheetId) {
        store.spreadsheetId = extractedMatch[1];
      }
    }
    if (typeof spreadsheetId === 'string') {
      const nextId = spreadsheetId.trim();
      const prevId = String(store.spreadsheetId || '').trim();
      if (req.body?.resetLocalCache === true) {
        store.drivers = [];
        store.vehicles = [];
        store.routes = [];
        store.fleetCards = [];
        store.assignments = [];
        store.driverExpenses = [];
        store.lastSequence = 0;
      }
      if (nextId !== prevId) {
        store.lastSyncedSpreadsheetId = '';
        store.syncedDriverIds = [];
        store.syncedVehicleIds = [];
        store.syncedRouteIds = [];
        store.syncedFleetCardIds = [];
        store.syncedAssignmentNos = [];
        store.syncedExpenseIds = [];
        store.liveCsvReadable = false;
        if (!nextId) {
          store.lastSyncedAt = null;
        }
      }
      store.spreadsheetId = nextId;
    }
    if (typeof spreadsheetTitle === 'string')
      store.spreadsheetTitle = spreadsheetTitle.trim();
    if (typeof driveRootFolderUrl === 'string') {
      const nextDriveUrl = driveRootFolderUrl.trim();
      store.driveRootFolderUrl = nextDriveUrl;
      const extractedFolderId = extractServerGoogleDriveFolderId(nextDriveUrl);
      if (extractedFolderId && !driveRootFolderId) {
        store.driveRootFolderId = extractedFolderId;
      } else if (!nextDriveUrl && !driveRootFolderId) {
        store.driveRootFolderId = '';
      }
    }
    if (typeof driveRootFolderId === 'string') {
      const cleanId = extractServerGoogleDriveFolderId(driveRootFolderId);
      store.driveRootFolderId = cleanId;
      if (cleanId && !store.driveRootFolderUrl) {
        store.driveRootFolderUrl = `https://drive.google.com/drive/folders/${cleanId}`;
      }
    }
    if (typeof dispatcherWaPhone === 'string')
      store.dispatcherWaPhone = dispatcherWaPhone.trim();
    if (
      whatsappTargetMode === 'GROUP' ||
      whatsappTargetMode === 'DIRECT' ||
      whatsappTargetMode === 'DRIVER'
    ) {
      store.whatsappTargetMode = whatsappTargetMode;
    }
    if (typeof whatsappGroupName === 'string') {
      store.whatsappGroupName = whatsappGroupName.trim();
    }
    if (typeof whatsappGroupInviteUrl === 'string') {
      store.whatsappGroupInviteUrl = whatsappGroupInviteUrl.trim();
    }
    if (typeof publicPortalBaseUrl === 'string') {
      store.publicPortalBaseUrl = publicPortalBaseUrl.trim();
    }
    if (typeof letterPrefix === 'string' && letterPrefix.trim()) {
      store.letterPrefix = letterPrefix.trim().toUpperCase();
    }
    if (lastSyncedAt !== undefined) store.lastSyncedAt = lastSyncedAt;

    saveStore(store);

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      adminPin: store.adminPin,
      state: publicState,
    });
  });

  interface PulledSheetsReconcileInput {
    spreadsheetId?: string;
    spreadsheetTitle?: string;
    spreadsheetUrl?: string;
    appsScriptUrl?: string;
    driveRootFolderId?: string;
    driveRootFolderUrl?: string;
    drivers?: DriverRecord[];
    vehicles?: VehicleRecord[];
    routes?: RouteRecord[];
    fleetCards?: FleetCardRecord[];
    assignments?: AssignmentRecord[];
    driverExpenses?: DriverExpenseRecord[];
    adminPin?: string;
    dispatcherWaPhone?: string;
    whatsappTargetMode?: 'GROUP' | 'DIRECT' | 'DRIVER';
    whatsappGroupName?: string;
    whatsappGroupInviteUrl?: string;
    publicPortalBaseUrl?: string;
    letterPrefix?: string;
    forceReplaceAll?: boolean;
  }

  const reconcilePulledSheetsIntoStore = (
    input: PulledSheetsReconcileInput
  ): {
    hasPendingDriverUpdates: boolean;
    hasPendingMasterUpdates: boolean;
    hasCustomPinToPush: boolean;
    hasSheetDeletionsToPrune: boolean;
    mutated: boolean;
  } => {
    ensureStoreTracking();
    const {
      spreadsheetId,
      spreadsheetTitle,
      spreadsheetUrl,
      appsScriptUrl,
      driveRootFolderId,
      driveRootFolderUrl,
      drivers,
      vehicles,
      routes,
      fleetCards,
      assignments,
      driverExpenses,
      adminPin,
      dispatcherWaPhone,
      whatsappTargetMode,
      whatsappGroupName,
      whatsappGroupInviteUrl,
      publicPortalBaseUrl,
      letterPrefix,
      forceReplaceAll,
    } = input;

    const beforeSig = JSON.stringify({
      d: store.drivers,
      v: store.vehicles,
      r: store.routes,
      fc: store.fleetCards,
      a: store.assignments.map((x) => ({
        id: x.id,
        no: x.noPenugasan,
        st: x.status,
        dt: x.tanggalTugas,
        dr: x.driverId,
        pl: x.plateNumber,
        ds: x.destination,
        ns: Boolean(x.needsSheetSync),
      })),
      ex: store.driverExpenses.map((e) => ({
        id: e.id,
        fc: e.fleetCardNumber,
        tot: e.totalPengeluaran,
        ns: Boolean(e.needsSheetSync),
      })),
    });

    const targetSheetId =
      typeof spreadsheetId === 'string' && spreadsheetId.trim()
        ? spreadsheetId.trim()
        : store.spreadsheetId;

    const sameSyncedSheet =
      Boolean(targetSheetId) &&
      (store.lastSyncedSpreadsheetId === targetSheetId ||
        (store.spreadsheetId === targetSheetId && Boolean(store.lastSyncedAt)));

    const sheetIsCompletelyEmpty =
      (!Array.isArray(drivers) || drivers.length === 0) &&
      (!Array.isArray(vehicles) || vehicles.length === 0) &&
      (!Array.isArray(routes) || routes.length === 0) &&
      (!Array.isArray(fleetCards) || fleetCards.length === 0) &&
      (!Array.isArray(assignments) || assignments.length === 0) &&
      (!Array.isArray(driverExpenses) || driverExpenses.length === 0);

    const hasSyncedThisSheetBefore =
      forceReplaceAll === true ||
      sameSyncedSheet ||
      (store.syncedAssignmentNos?.length || 0) > 0 ||
      (store.syncedExpenseIds?.length || 0) > 0 ||
      (store.syncedDriverIds?.length || 0) > 0 ||
      (store.syncedVehicleIds?.length || 0) > 0 ||
      (store.syncedRouteIds?.length || 0) > 0 ||
      (store.syncedFleetCardIds?.length || 0) > 0 ||
      !sheetIsCompletelyEmpty;

    if (typeof spreadsheetId === 'string' && spreadsheetId.trim()) {
      store.spreadsheetId = spreadsheetId.trim();
    }
    if (typeof spreadsheetTitle === 'string' && spreadsheetTitle.trim()) {
      store.spreadsheetTitle = spreadsheetTitle.trim();
    }
    if (typeof spreadsheetUrl === 'string' && spreadsheetUrl.trim()) {
      store.spreadsheetUrl = spreadsheetUrl.trim();
    }
    if (typeof appsScriptUrl === 'string' && appsScriptUrl.trim()) {
      store.appsScriptUrl = appsScriptUrl.trim();
    }
    if (typeof driveRootFolderId === 'string' && driveRootFolderId.trim()) {
      store.driveRootFolderId = driveRootFolderId.trim();
    }
    if (typeof driveRootFolderUrl === 'string' && driveRootFolderUrl.trim()) {
      store.driveRootFolderUrl = driveRootFolderUrl.trim();
    }
    if (typeof dispatcherWaPhone === 'string' && dispatcherWaPhone.trim()) {
      store.dispatcherWaPhone = dispatcherWaPhone.trim();
    }
    if (
      whatsappTargetMode === 'GROUP' ||
      whatsappTargetMode === 'DIRECT' ||
      whatsappTargetMode === 'DRIVER'
    ) {
      store.whatsappTargetMode = whatsappTargetMode;
    }
    if (typeof whatsappGroupName === 'string' && whatsappGroupName.trim()) {
      store.whatsappGroupName = whatsappGroupName.trim();
    }
    if (
      typeof whatsappGroupInviteUrl === 'string' &&
      whatsappGroupInviteUrl.trim()
    ) {
      store.whatsappGroupInviteUrl = whatsappGroupInviteUrl.trim();
    }
    if (
      typeof publicPortalBaseUrl === 'string' &&
      publicPortalBaseUrl.trim()
    ) {
      store.publicPortalBaseUrl = publicPortalBaseUrl.trim();
    }
    if (typeof letterPrefix === 'string' && letterPrefix.trim()) {
      store.letterPrefix = letterPrefix.trim().toUpperCase();
    }

    let hasCustomPinToPush = false;
    const incomingSheetPin =
      typeof adminPin === 'string' ? adminPin.trim() : '';
    if (incomingSheetPin.length >= 4 && incomingSheetPin !== '123456') {
      store.adminPin = incomingSheetPin;
      store.isDefaultPin = false;
    } else if (!store.isDefaultPin && store.adminPin.trim() !== '123456') {
      hasCustomPinToPush = true;
    }

    let hasPendingMasterUpdates = Boolean(store.pendingMasterDeletionPush);
    let hasSheetDeletionsToPrune = false;

    const unsyncedDriverSet = new Set(
      (store.unsyncedDriverIds || []).map(normalizeSyncKey)
    );
    const unsyncedVehicleSet = new Set(
      (store.unsyncedVehicleIds || []).map(normalizeSyncKey)
    );
    const unsyncedRouteSet = new Set(
      (store.unsyncedRouteIds || []).map(normalizeSyncKey)
    );
    const unsyncedFleetCardSet = new Set(
      (store.unsyncedFleetCardIds || []).map(normalizeSyncKey)
    );
    const syncedAsgNoSet = new Set(
      (store.syncedAssignmentNos || []).map(normalizeSyncKey)
    );
    const syncedExpIdSet = new Set(
      (store.syncedExpenseIds || []).map(normalizeSyncKey)
    );

    if (Array.isArray(drivers)) {
      if (forceReplaceAll === true) {
        store.drivers = drivers;
        store.unsyncedDriverIds = [];
      } else if (
        !hasSyncedThisSheetBefore &&
        drivers.length === 0 &&
        store.drivers.length > 0
      ) {
        // Brand-new blank Spreadsheet connected for the first time: export initial local drivers
        hasPendingMasterUpdates = true;
      } else {
        const localById = new Map<string, DriverRecord>();
        for (const ld of store.drivers) {
          localById.set(normalizeSyncKey(ld.id), ld);
        }
        const mergedMap = new Map<string, DriverRecord>();
        for (const sd of drivers) {
          const nk = normalizeSyncKey(sd.id);
          if (!nk) continue;
          if (
            store.pendingMasterDeletionPush &&
            !localById.has(nk) &&
            isKeyTombstoned('drivers', nk)
          ) {
            hasPendingMasterUpdates = true;
            continue;
          }
          removeDeletedTombstones('drivers', [nk]);
          if (unsyncedDriverSet.has(nk) && localById.has(nk)) {
            mergedMap.set(nk, localById.get(nk)!);
            hasPendingMasterUpdates = true;
          } else {
            mergedMap.set(nk, sd);
          }
        }
        for (const [nk, ld] of localById.entries()) {
          if (!mergedMap.has(nk)) {
            if (unsyncedDriverSet.has(nk)) {
              mergedMap.set(nk, ld);
              hasPendingMasterUpdates = true;
            } else {
              // Deleted directly in Google Spreadsheet!
              addDeletedTombstones('drivers', [ld.id]);
              hasSheetDeletionsToPrune = true;
            }
          }
        }
        store.drivers = Array.from(mergedMap.values());
      }
    }

    if (Array.isArray(vehicles)) {
      if (forceReplaceAll === true) {
        store.vehicles = vehicles;
        store.unsyncedVehicleIds = [];
      } else if (
        !hasSyncedThisSheetBefore &&
        vehicles.length === 0 &&
        store.vehicles.length > 0
      ) {
        hasPendingMasterUpdates = true;
      } else {
        const localById = new Map<string, VehicleRecord>();
        for (const lv of store.vehicles) {
          localById.set(normalizeSyncKey(lv.id), lv);
        }
        const mergedMap = new Map<string, VehicleRecord>();
        for (const sv of vehicles) {
          const nk = normalizeSyncKey(sv.id);
          if (!nk) continue;
          if (
            store.pendingMasterDeletionPush &&
            !localById.has(nk) &&
            isKeyTombstoned('vehicles', nk)
          ) {
            hasPendingMasterUpdates = true;
            continue;
          }
          removeDeletedTombstones('vehicles', [nk]);
          if (unsyncedVehicleSet.has(nk) && localById.has(nk)) {
            mergedMap.set(nk, localById.get(nk)!);
            hasPendingMasterUpdates = true;
          } else {
            mergedMap.set(nk, {
              ...sv,
              capacityCbm: sv.capacityCbm || localById.get(nk)?.capacityCbm,
            });
          }
        }
        for (const [nk, lv] of localById.entries()) {
          if (!mergedMap.has(nk)) {
            if (unsyncedVehicleSet.has(nk)) {
              mergedMap.set(nk, lv);
              hasPendingMasterUpdates = true;
            } else {
              addDeletedTombstones('vehicles', [lv.id]);
              hasSheetDeletionsToPrune = true;
            }
          }
        }
        store.vehicles = Array.from(mergedMap.values());
      }
    }

    if (Array.isArray(routes)) {
      if (forceReplaceAll === true) {
        store.routes = routes;
        store.unsyncedRouteIds = [];
      } else if (
        !hasSyncedThisSheetBefore &&
        routes.length === 0 &&
        store.routes.length > 0
      ) {
        hasPendingMasterUpdates = true;
      } else {
        const localById = new Map<string, RouteRecord>();
        for (const lr of store.routes) {
          localById.set(normalizeSyncKey(lr.id), lr);
        }
        const mergedMap = new Map<string, RouteRecord>();
        for (const sr of routes) {
          const nk = normalizeSyncKey(sr.id);
          if (!nk) continue;
          if (
            store.pendingMasterDeletionPush &&
            !localById.has(nk) &&
            isKeyTombstoned('routes', nk)
          ) {
            hasPendingMasterUpdates = true;
            continue;
          }
          removeDeletedTombstones('routes', [nk]);
          if (unsyncedRouteSet.has(nk) && localById.has(nk)) {
            mergedMap.set(nk, localById.get(nk)!);
            hasPendingMasterUpdates = true;
          } else {
            mergedMap.set(nk, sr);
          }
        }
        for (const [nk, lr] of localById.entries()) {
          if (!mergedMap.has(nk)) {
            if (unsyncedRouteSet.has(nk)) {
              mergedMap.set(nk, lr);
              hasPendingMasterUpdates = true;
            } else {
              addDeletedTombstones('routes', [lr.id]);
              hasSheetDeletionsToPrune = true;
            }
          }
        }
        store.routes = Array.from(mergedMap.values());
      }
    }

    if (Array.isArray(fleetCards)) {
      if (forceReplaceAll === true) {
        store.fleetCards = fleetCards;
        store.unsyncedFleetCardIds = [];
      } else if (
        (!hasSyncedThisSheetBefore ||
          (store.syncedFleetCardIds?.length || 0) === 0) &&
        fleetCards.length === 0 &&
        store.fleetCards.length > 0
      ) {
        hasPendingMasterUpdates = true;
      } else {
        const localById = new Map<string, FleetCardRecord>();
        for (const lfc of store.fleetCards) {
          localById.set(normalizeSyncKey(lfc.id), lfc);
        }
        const mergedMap = new Map<string, FleetCardRecord>();
        for (const sfc of fleetCards) {
          const nk = normalizeSyncKey(sfc.id);
          if (!nk) continue;
          if (
            store.pendingMasterDeletionPush &&
            !localById.has(nk) &&
            isKeyTombstoned('fleetCards', nk)
          ) {
            hasPendingMasterUpdates = true;
            continue;
          }
          removeDeletedTombstones('fleetCards', [nk]);
          if (unsyncedFleetCardSet.has(nk) && localById.has(nk)) {
            mergedMap.set(nk, localById.get(nk)!);
            hasPendingMasterUpdates = true;
          } else {
            mergedMap.set(nk, {
              id: String(sfc.id || '').trim().toUpperCase(),
              cardNumber: String(sfc.cardNumber || '').trim(),
              balance: Number(sfc.balance) || 0,
            });
          }
        }
        for (const [nk, lfc] of localById.entries()) {
          if (!mergedMap.has(nk)) {
            if (unsyncedFleetCardSet.has(nk)) {
              mergedMap.set(nk, lfc);
              hasPendingMasterUpdates = true;
            } else {
              addDeletedTombstones('fleetCards', [lfc.id]);
              hasSheetDeletionsToPrune = true;
            }
          }
        }
        store.fleetCards = Array.from(mergedMap.values());
      }
    }

    let hasPendingDriverUpdates = Boolean(
      store.pendingAssignmentDeletionPush || store.pendingExpenseDeletionPush
    );
    if (Array.isArray(assignments)) {
      if (
        forceReplaceAll !== true &&
        !hasSyncedThisSheetBefore &&
        assignments.length === 0 &&
        store.assignments.length > 0
      ) {
        // Brand-new blank Spreadsheet connected for the first time: export initial local assignments
        hasPendingDriverUpdates = true;
        store.assignments = store.assignments.map((a) => ({
          ...a,
          needsSheetSync: true,
        }));
      } else {
        const localByNo = new Map<string, AssignmentRecord>();
        for (const localItem of store.assignments) {
          localByNo.set(normalizeSyncKey(localItem.noPenugasan), localItem);
        }

        const usedLocalNos = new Set<string>();
        const merged: AssignmentRecord[] = [];

        for (const sheetItem of assignments) {
          const normNo = normalizeSyncKey(sheetItem.noPenugasan);
          if (!normNo) continue;
          if (
            store.pendingAssignmentDeletionPush &&
            !localByNo.has(normNo) &&
            isKeyTombstoned('assignments', sheetItem.id, sheetItem.noPenugasan)
          ) {
            hasPendingDriverUpdates = true;
            continue;
          }
          removeDeletedTombstones('assignments', [
            sheetItem.id,
            sheetItem.noPenugasan,
          ]);
          const existingLocal = localByNo.get(normNo);
          if (existingLocal) {
            usedLocalNos.add(normNo);
            if (existingLocal.needsSheetSync) {
              hasPendingDriverUpdates = true;
              const mergedPendingDrive = mergeDriveMediaLinks(
                existingLocal.driveMedia,
                sheetItem.driveMedia
              );
              merged.push({
                ...existingLocal,
                driveFolderUrl:
                  mergedPendingDrive?.folderUrl ||
                  existingLocal.driveFolderUrl ||
                  sheetItem.driveFolderUrl,
                driveMedia: mergedPendingDrive,
              });
              continue;
            }
            const mergedDrive = mergeDriveMediaLinks(
              existingLocal.driveMedia,
              sheetItem.driveMedia
            );
            const localHasMoreDriveLinks =
              Boolean(existingLocal.driveMedia?.fotoOdometerBerangkatUrl) &&
              !sheetItem.driveMedia?.fotoOdometerBerangkatUrl;
            if (localHasMoreDriveLinks) {
              hasPendingDriverUpdates = true;
            }
            merged.push({
              ...sheetItem,
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
              handoverData: sheetItem.handoverData
                ? {
                    ...sheetItem.handoverData,
                    fotoOdometerSerahTerima:
                      existingLocal.handoverData?.fotoOdometerSerahTerima,
                    fotoSuhuSerahTerima:
                      existingLocal.handoverData?.fotoSuhuSerahTerima,
                    fotoBuktiSerahTerima:
                      existingLocal.handoverData?.fotoBuktiSerahTerima,
                    tandaTanganPenerima:
                      existingLocal.handoverData?.tandaTanganPenerima,
                  }
                : existingLocal.handoverData,
              needsSheetSync: localHasMoreDriveLinks,
            });
          } else {
            merged.push({
              ...sheetItem,
              needsSheetSync: false,
            });
          }
        }

        for (const [normNo, localItem] of localByNo.entries()) {
          if (!usedLocalNos.has(normNo)) {
            const wasPreviouslyInSheet = syncedAsgNoSet.has(normNo);
            if (
              forceReplaceAll !== true &&
              localItem.needsSheetSync &&
              !wasPreviouslyInSheet
            ) {
              // Newly created in App and not yet pushed to Google Spreadsheet -> preserve & push
              hasPendingDriverUpdates = true;
              merged.push(localItem);
            } else {
              // Row was deleted in Google Spreadsheet -> remove from App & record tombstone!
              addDeletedTombstones('assignments', [
                localItem.id,
                localItem.noPenugasan,
              ]);
              hasSheetDeletionsToPrune = true;
            }
          }
        }

        store.assignments = merged;
      }
    }

    if (Array.isArray(driverExpenses)) {
      if (
        forceReplaceAll !== true &&
        (!hasSyncedThisSheetBefore ||
          (store.syncedExpenseIds?.length || 0) === 0) &&
        driverExpenses.length === 0 &&
        store.driverExpenses.length > 0
      ) {
        hasPendingDriverUpdates = true;
        store.driverExpenses = store.driverExpenses.map((e) => ({
          ...e,
          needsSheetSync: true,
        }));
      } else {
        const localExpById = new Map<string, DriverExpenseRecord>();
        for (const le of store.driverExpenses) {
          localExpById.set(normalizeSyncKey(le.id), le);
        }
        const usedLocalExpIds = new Set<string>();
        const mergedExpenses: DriverExpenseRecord[] = [];

        for (const sheetExp of driverExpenses) {
          const normId = normalizeSyncKey(sheetExp.id);
          if (!normId) continue;
          if (
            store.pendingExpenseDeletionPush &&
            !localExpById.has(normId) &&
            isKeyTombstoned('driverExpenses', sheetExp.id)
          ) {
            hasPendingDriverUpdates = true;
            continue;
          }
          removeDeletedTombstones('driverExpenses', [sheetExp.id]);
          const existingLocal = localExpById.get(normId);
          if (existingLocal) {
            usedLocalExpIds.add(normId);
            if (existingLocal.needsSheetSync) {
              hasPendingDriverUpdates = true;
              mergedExpenses.push({
                ...existingLocal,
                fotoStrukBbmUrl:
                  existingLocal.fotoStrukBbmUrl || sheetExp.fotoStrukBbmUrl,
                fotoStrukTolUrl:
                  existingLocal.fotoStrukTolUrl || sheetExp.fotoStrukTolUrl,
              });
              continue;
            }
            const localHasNewDriveLinks =
              (Boolean(existingLocal.fotoStrukBbmUrl) &&
                !sheetExp.fotoStrukBbmUrl) ||
              (Boolean(existingLocal.fotoStrukTolUrl) &&
                !sheetExp.fotoStrukTolUrl);
            if (localHasNewDriveLinks) {
              hasPendingDriverUpdates = true;
            }
            mergedExpenses.push({
              ...sheetExp,
              tanggalPengiriman:
                sheetExp.tanggalPengiriman || existingLocal.tanggalPengiriman,
              tujuanPengiriman:
                sheetExp.tujuanPengiriman || existingLocal.tujuanPengiriman,
              fotoStrukBbm: existingLocal.fotoStrukBbm,
              fotoStrukBbmUrl:
                sheetExp.fotoStrukBbmUrl || existingLocal.fotoStrukBbmUrl,
              fotoStrukTol: existingLocal.fotoStrukTol,
              fotoStrukTolUrl:
                sheetExp.fotoStrukTolUrl || existingLocal.fotoStrukTolUrl,
              needsSheetSync: localHasNewDriveLinks,
            });
          } else {
            mergedExpenses.push({
              ...sheetExp,
              needsSheetSync: false,
            });
          }
        }

        for (const [normId, localExp] of localExpById.entries()) {
          if (!usedLocalExpIds.has(normId)) {
            const wasPreviouslyInSheet = syncedExpIdSet.has(normId);
            if (
              forceReplaceAll !== true &&
              localExp.needsSheetSync &&
              !wasPreviouslyInSheet
            ) {
              hasPendingDriverUpdates = true;
              mergedExpenses.push(localExp);
            } else {
              addDeletedTombstones('driverExpenses', [localExp.id]);
              hasSheetDeletionsToPrune = true;
            }
          }
        }

        store.driverExpenses = mergedExpenses;
      }
    }

    if (store.assignments.length === 0 && store.pendingAssignmentDeletionPush) {
      store.lastSequence = 0;
    } else {
      let maxSeq = store.lastSequence || 0;
      for (const a of store.assignments) {
        const s = Math.max(
          a.sequenceNumber || 0,
          extractSequenceFromNo(a.noPenugasan)
        );
        if (s > maxSeq) maxSeq = s;
      }
      store.lastSequence = maxSeq;
    }
    store.lastSyncedAt = new Date().toISOString();
    if (store.spreadsheetId) {
      store.lastSyncedSpreadsheetId = store.spreadsheetId.trim();
    }

    // Record authoritative synced IDs from pulled Sheet + non-pending items
    store.syncedDriverIds = store.drivers
      .filter((d) => !unsyncedDriverSet.has(normalizeSyncKey(d.id)))
      .map((d) => normalizeSyncKey(d.id))
      .filter(Boolean);
    store.syncedVehicleIds = store.vehicles
      .filter((v) => !unsyncedVehicleSet.has(normalizeSyncKey(v.id)))
      .map((v) => normalizeSyncKey(v.id))
      .filter(Boolean);
    store.syncedRouteIds = store.routes
      .filter((r) => !unsyncedRouteSet.has(normalizeSyncKey(r.id)))
      .map((r) => normalizeSyncKey(r.id))
      .filter(Boolean);
    store.syncedFleetCardIds = store.fleetCards
      .filter((fc) => !unsyncedFleetCardSet.has(normalizeSyncKey(fc.id)))
      .map((fc) => normalizeSyncKey(fc.id))
      .filter(Boolean);
    store.syncedAssignmentNos = store.assignments
      .filter((a) => !a.needsSheetSync)
      .map((a) => normalizeSyncKey(a.noPenugasan))
      .filter(Boolean);
    store.syncedExpenseIds = store.driverExpenses
      .filter((e) => !e.needsSheetSync)
      .map((e) => normalizeSyncKey(e.id))
      .filter(Boolean);

    if (!hasPendingMasterUpdates) {
      store.needsMasterSheetSync = false;
    }

    const afterSig = JSON.stringify({
      d: store.drivers,
      v: store.vehicles,
      r: store.routes,
      fc: store.fleetCards,
      a: store.assignments.map((x) => ({
        id: x.id,
        no: x.noPenugasan,
        st: x.status,
        dt: x.tanggalTugas,
        dr: x.driverId,
        pl: x.plateNumber,
        ds: x.destination,
        ns: Boolean(x.needsSheetSync),
      })),
      ex: store.driverExpenses.map((e) => ({
        id: e.id,
        fc: e.fleetCardNumber,
        tot: e.totalPengeluaran,
        ns: Boolean(e.needsSheetSync),
      })),
    });

    return {
      hasPendingDriverUpdates,
      hasPendingMasterUpdates,
      hasCustomPinToPush,
      hasSheetDeletionsToPrune,
      mutated: beforeSig !== afterSig || hasSheetDeletionsToPrune,
    };
  };

  // Sync from Google Sheets while respecting two-way deletions, preserving local photos/signatures & permanent custom Admin PIN
  app.post('/api/sync/from-sheets', (req, res) => {
    const result = reconcilePulledSheetsIntoStore(req.body || {});
    saveStore(store);
    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'SYSTEM',
    });
    res.json({
      success: true,
      hasPendingDriverUpdates: result.hasPendingDriverUpdates,
      hasPendingMasterUpdates: result.hasPendingMasterUpdates,
      hasCustomPinToPush: result.hasCustomPinToPush,
      hasSheetDeletionsToPrune: result.hasSheetDeletionsToPrune,
      adminPin: store.adminPin,
      state: publicState,
    });
  });

  // RFC 4180 CSV parser for server-side zero-auth live Spreadsheet pull (`gviz/tq?tqx=out:csv`)
  const parseCsvRowsServer = (csvText: string): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
      const ch = csvText[i];
      if (inQuotes) {
        if (ch === '"') {
          if (csvText[i + 1] === '"') {
            currentCell += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          currentCell += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ',') {
          currentRow.push(currentCell);
          currentCell = '';
        } else if (ch === '\r') {
          if (csvText[i + 1] === '\n') i++;
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = '';
        } else if (ch === '\n') {
          currentRow.push(currentCell);
          rows.push(currentRow);
          currentRow = [];
          currentCell = '';
        } else {
          currentCell += ch;
        }
      }
    }
    if (currentCell.length > 0 || currentRow.length > 0) {
      currentRow.push(currentCell);
      rows.push(currentRow);
    }
    return rows;
  };

  const parseServerStatus = (raw?: string): AssignmentRecord['status'] => {
    const norm = String(raw || '').trim().toLowerCase();
    if (norm === 'dalam perjalanan') return 'Dalam Perjalanan';
    if (norm === 'delivered') return 'Delivered';
    if (norm === 'handover') return 'Handover';
    if (norm === 'selesai') return 'Selesai';
    return 'Menunggu Berangkat';
  };

  const parseIdrCellServer = (raw?: string | number): number => {
    if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
    const str = String(raw ?? '').trim();
    if (!str) return 0;
    const isNeg = str.startsWith('-') || str.includes('(-');
    const digitsOnly = str.replace(/[^\d]/g, '');
    if (!digitsOnly) return 0;
    const num = Number(digitsOnly);
    if (!Number.isFinite(num)) return 0;
    return isNeg ? -num : num;
  };

  const parseRawTabMatricesToPayload = (
    spreadsheetId: string,
    matrices: {
      driverAll: string[][];
      vehicleAll: string[][];
      routeAll: string[][];
      fleetCardAll?: string[][];
      assignmentAll: string[][];
      expenseAll?: string[][];
      configAll: string[][];
      title?: string;
    }
  ): PulledSheetsReconcileInput => {
    const {
      driverAll,
      vehicleAll,
      routeAll,
      fleetCardAll,
      assignmentAll,
      expenseAll,
      configAll,
    } = matrices;

    const drvHeader = (driverAll[0] || []).map((h) => String(h || '').toLowerCase());
    const drvHasLegacyPlateCol = drvHeader.some(
      (h) => h.includes('polisi') || h.includes('plat')
    );
    const drivers: DriverRecord[] = driverAll
      .slice(1)
      .filter(
        (row) =>
          row &&
          (String(row[0] || '').trim() !== '' || String(row[1] || '').trim() !== '')
      )
      .map((row, idx) => {
        const licIdx = drvHasLegacyPlateCol ? 5 : 4;
        const statusIdx = drvHasLegacyPlateCol ? 6 : 5;
        return {
          id: String(row[0] || `DRV-${String(idx + 1).padStart(3, '0')}`)
            .trim()
            .toUpperCase(),
          name: String(row[1] || '').trim(),
          phone: String(row[2] || '').trim(),
          pin: String(row[3] || '').trim(),
          licenseType: String(row[licIdx] || 'SIM B1').trim(),
          active: String(row[statusIdx] ?? 'Aktif').toLowerCase() !== 'nonaktif',
        };
      });

    const vehHeader = (vehicleAll[0] || []).map((h) => String(h || '').toLowerCase());
    const vehStatusIdx = vehHeader.findIndex((h) => h.includes('status'));
    const vehCbmIdx = vehHeader.findIndex(
      (h) =>
        h.includes('cbm') ||
        h.includes('kubik') ||
        h.includes('m3') ||
        h.includes('volume')
    );
    const vehicles: VehicleRecord[] = vehicleAll
      .slice(1)
      .filter(
        (row) =>
          row &&
          (String(row[0] || '').trim() !== '' || String(row[1] || '').trim() !== '')
      )
      .map((row, idx) => {
        const sIdx = vehStatusIdx >= 0 ? vehStatusIdx : row.length >= 6 ? 5 : 4;
        const rawStatus = String(row[sIdx] || 'Siap Jalan').trim();
        const status: VehicleRecord['status'] =
          rawStatus === 'Dalam Tugas' || rawStatus === 'Perawatan'
            ? rawStatus
            : 'Siap Jalan';
        const rawCbm =
          vehCbmIdx >= 0 ? String(row[vehCbmIdx] || '').trim() : '';
        return {
          id: String(row[0] || `UNT-${String(idx + 1).padStart(3, '0')}`)
            .trim()
            .toUpperCase(),
          plateNumber: String(row[1] || '').trim().toUpperCase(),
          vehicleType: String(row[2] || '').trim(),
          capacity: String(row[3] || '').trim(),
          capacityCbm: rawCbm || undefined,
          status,
        };
      });

    const routeHeader = (routeAll[0] || []).map((h) => String(h || '').toLowerCase());
    const isLegacyRoute = routeHeader.some((h) => h.includes('asal'));
    const routes: RouteRecord[] = routeAll
      .slice(1)
      .filter((row) => row && String(row[0] || '').trim() !== '')
      .map((row) =>
        isLegacyRoute
          ? {
              id: String(row[0] || '').trim().toUpperCase(),
              destination: String(row[2] || row[1] || '').trim(),
              picName: String(row[4] || '').trim(),
              picPhone: String(row[5] || '').trim(),
            }
          : {
              id: String(row[0] || '').trim().toUpperCase(),
              destination: String(row[1] || '').trim(),
              picName: String(row[2] || '').trim(),
              picPhone: String(row[3] || '').trim(),
            }
      );

    const asgHeader = (assignmentAll[0] || []).map((h) =>
      String(h || '').toLowerCase()
    );
    const isNewColdChainSchema = asgHeader.some((h) =>
      h.includes('surat jalan fisik')
    );

    const assignments: AssignmentRecord[] = assignmentAll
      .slice(1)
      .filter((row) => row && String(row[2] || '').trim() !== '')
      .map((row, index) => {
        const noPenugasan = String(row[2] || '').trim();
        const seqNum =
          Number(row[1]) || extractSequenceFromNo(noPenugasan) || index + 1;

        if (isNewColdChainSchema) {
          const rawCol12 = String(row[12] || '').trim();
          const parsedJenisKendaraan: 'Mobil Pendingin' | 'Non Pendingin' | undefined =
            rawCol12 === 'Mobil Pendingin' || rawCol12 === 'Non Pendingin'
              ? rawCol12
              : undefined;
          const parsedTitik = String(row[13] || '').trim();
          const resolvedOrigin =
            parsedTitik || 'Menunggu Titik Keberangkatan Driver';
          const hasDeparture =
            String(row[18] || '').trim() !== '' ||
            String(row[19] || '').trim() !== '';
          const hasHandover =
            String(row[25] || '').trim() !== '' ||
            String(row[26] || '').trim() !== '';

          const driveFolderUrlCol = String(row[37] || '').trim();
          const fotoOdoBerangkatUrl = String(row[38] || '').trim();
          const fotoSuhuBerangkatUrl = String(row[39] || '').trim();
          const fotoOdoHoUrl = String(row[40] || '').trim();
          const fotoSuhuHoUrl = String(row[41] || '').trim();
          const fotoBuktiHoUrl = String(row[42] || '').trim();
          const ttdPenerimaUrl = String(row[43] || '').trim();
          const folderIdMatch = driveFolderUrlCol.match(
            /\/folders\/([a-zA-Z0-9_-]+)/
          );
          const hasAnyDriveLinks = Boolean(
            driveFolderUrlCol ||
              fotoOdoBerangkatUrl ||
              fotoSuhuBerangkatUrl ||
              fotoOdoHoUrl ||
              fotoSuhuHoUrl ||
              fotoBuktiHoUrl ||
              ttdPenerimaUrl
          );

          return {
            id: String(row[0] || `ASG-SHEET-${seqNum}`).trim(),
            sequenceNumber: seqNum,
            noPenugasan,
            noSuratJalanFisik: String(row[3] || '').trim(),
            kodeSegel: String(row[4] || '').trim().toUpperCase(),
            tanggalTugas: String(row[5] || '').trim(),
            jadwalJamTiba: String(row[35] || '').trim() || undefined,
            driverId: String(row[6] || '').trim().toUpperCase(),
            driverName: String(row[7] || '').trim(),
            driverPhone: String(row[8] || '').trim(),
            vehicleId: String(row[9] || '').trim().toUpperCase(),
            plateNumber: String(row[10] || '').trim().toUpperCase(),
            vehicleType: String(row[11] || '').trim(),
            originId: parsedJenisKendaraan ? '' : rawCol12.toUpperCase(),
            origin: resolvedOrigin,
            routeId: String(row[14] || '').trim().toUpperCase(),
            destination: String(row[15] || '').trim(),
            purpose: String(row[16] || '').trim(),
            beratMuatan: String(row[36] || '').trim() || undefined,
            volumeCbm: String(row[45] || '').trim() || undefined,
            status: parseServerStatus(row[17]),
            deliveredAt: String(row[44] || '').trim() || undefined,
            departureData: hasDeparture
              ? {
                  timestamp: String(row[18] || ''),
                  titikKeberangkatan:
                    parsedTitik &&
                    parsedTitik !== 'Menunggu Titik Keberangkatan Driver'
                      ? parsedTitik
                      : undefined,
                  jenisKendaraan: parsedJenisKendaraan || 'Mobil Pendingin',
                  kmAwal:
                    Number(String(row[19] || '0').replace(/[^\d.-]/g, '')) || 0,
                  suhuAwal: String(row[20] || ''),
                  bbmAwal: String(row[21] || ''),
                  kondisiKendaraan: String(row[22] || ''),
                  catatanBerangkat: String(row[23] || ''),
                }
              : undefined,
            handoverData: hasHandover
              ? {
                  timestamp: String(row[25] || ''),
                  kmAkhir:
                    Number(String(row[26] || '0').replace(/[^\d.-]/g, '')) || 0,
                  suhuAkhir: String(row[27] || ''),
                  bbmAkhir: String(row[28] || ''),
                  penerimaNama: String(row[29] || ''),
                  kondisiAkhir: String(row[30] || ''),
                  catatanSerahTerima: String(row[31] || ''),
                }
              : undefined,
            driveFolderUrl: driveFolderUrlCol || undefined,
            driveMedia: hasAnyDriveLinks
              ? {
                  folderId: folderIdMatch ? folderIdMatch[1] : undefined,
                  folderUrl: driveFolderUrlCol || undefined,
                  fotoOdometerBerangkatUrl: fotoOdoBerangkatUrl || undefined,
                  fotoSuhuBerangkatUrl: fotoSuhuBerangkatUrl || undefined,
                  fotoOdometerSerahTerimaUrl: fotoOdoHoUrl || undefined,
                  fotoSuhuSerahTerimaUrl: fotoSuhuHoUrl || undefined,
                  fotoBuktiSerahTerimaUrl: fotoBuktiHoUrl || undefined,
                  tandaTanganPenerimaUrl: ttdPenerimaUrl || undefined,
                }
              : undefined,
            notes: String(row[33] || '').trim(),
            createdAt: String(row[34] || new Date().toISOString()).trim(),
            needsSheetSync: false,
          };
        }

        const hasDeparture =
          String(row[15] || '').trim() !== '' ||
          String(row[16] || '').trim() !== '';
        const hasHandover =
          String(row[20] || '').trim() !== '' ||
          String(row[21] || '').trim() !== '';
        const legacyOrigin =
          String(row[11] || '').trim() || 'Menunggu Titik Keberangkatan Driver';

        return {
          id: String(row[0] || `ASG-SHEET-${seqNum}`).trim(),
          sequenceNumber: seqNum,
          noPenugasan,
          noSuratJalanFisik: '',
          kodeSegel: '',
          tanggalTugas: String(row[3] || '').trim(),
          driverId: String(row[4] || '').trim().toUpperCase(),
          driverName: String(row[5] || '').trim(),
          driverPhone: String(row[6] || '').trim(),
          vehicleId: String(row[7] || '').trim().toUpperCase(),
          plateNumber: String(row[8] || '').trim().toUpperCase(),
          vehicleType: String(row[9] || '').trim(),
          originId: '',
          origin: legacyOrigin,
          routeId: String(row[10] || '').trim().toUpperCase(),
          destination: String(row[12] || '').trim(),
          purpose: String(row[13] || '').trim(),
          status: parseServerStatus(row[14]),
          departureData: hasDeparture
            ? {
                timestamp: String(row[15] || ''),
                titikKeberangkatan:
                  legacyOrigin !== 'Menunggu Titik Keberangkatan Driver'
                    ? legacyOrigin
                    : undefined,
                jenisKendaraan: 'Mobil Pendingin',
                kmAwal:
                  Number(String(row[16] || '0').replace(/[^\d.-]/g, '')) || 0,
                suhuAwal: '',
                bbmAwal: String(row[17] || ''),
                kondisiKendaraan: String(row[18] || ''),
                catatanBerangkat: String(row[19] || ''),
              }
            : undefined,
          handoverData: hasHandover
            ? {
                timestamp: String(row[20] || ''),
                kmAkhir:
                  Number(String(row[21] || '0').replace(/[^\d.-]/g, '')) || 0,
                suhuAkhir: '',
                bbmAkhir: String(row[22] || ''),
                penerimaNama: String(row[23] || ''),
                kondisiAkhir: String(row[24] || ''),
                catatanSerahTerima: String(row[25] || ''),
              }
            : undefined,
          notes: String(row[26] || '').trim(),
          createdAt: String(row[27] || new Date().toISOString()).trim(),
          needsSheetSync: false,
        };
      });

    let adminPin: string | undefined;
    let dispatcherWaPhone: string | undefined;
    let whatsappTargetMode: 'GROUP' | 'DIRECT' | 'DRIVER' | undefined;
    let whatsappGroupName: string | undefined;
    let whatsappGroupInviteUrl: string | undefined;
    let letterPrefix: string | undefined;
    let publicPortalBaseUrl: string | undefined;
    let appsScriptUrl: string | undefined;
    let driveRootFolderId: string | undefined;
    let driveRootFolderUrl: string | undefined;

    for (const row of configAll.slice(1)) {
      const k = String(row[0] || '').trim().toLowerCase();
      const v = String(row[1] || '').trim();
      if (k === 'admin_pin' && v) adminPin = v;
      if (k === 'dispatcher_wa' && v !== undefined) dispatcherWaPhone = v;
      if (
        k === 'whatsapp_target_mode' &&
        (v === 'GROUP' || v === 'DIRECT' || v === 'DRIVER')
      ) {
        whatsappTargetMode = v;
      }
      if (k === 'whatsapp_group_name' && v !== undefined) whatsappGroupName = v;
      if (k === 'whatsapp_group_invite' && v !== undefined) {
        whatsappGroupInviteUrl = v;
      }
      if (k === 'letter_prefix' && v) letterPrefix = v;
      if (k === 'public_portal_url' && v !== undefined) publicPortalBaseUrl = v;
      if (k === 'apps_script_url' && v !== undefined) appsScriptUrl = v;
      if (k === 'drive_root_folder_id' && v) driveRootFolderId = v;
      if (k === 'drive_root_folder_url' && v) driveRootFolderUrl = v;
    }

    const fleetCards: FleetCardRecord[] | undefined = Array.isArray(fleetCardAll)
      ? fleetCardAll
          .slice(1)
          .filter(
            (row) =>
              row &&
              (String(row[0] || '').trim() !== '' ||
                String(row[1] || '').trim() !== '')
          )
          .map((row, idx) => ({
            id: String(row[0] || `FC-${String(idx + 1).padStart(3, '0')}`)
              .trim()
              .toUpperCase(),
            cardNumber: String(row[1] || '').trim(),
            balance: parseIdrCellServer(row[2]),
          }))
      : undefined;

    const driverExpenses: DriverExpenseRecord[] | undefined = Array.isArray(
      expenseAll
    )
      ? expenseAll
          .slice(1)
          .filter(
            (row) =>
              row &&
              (String(row[0] || '').trim() !== '' ||
                String(row[8] || '').trim() !== '')
          )
          .map((row, idx) => {
            const bbm = Math.max(0, parseIdrCellServer(row[9]));
            const tol = Math.max(0, parseIdrCellServer(row[11]));
            const rawTot = Math.max(0, parseIdrCellServer(row[13]));
            const ts = String(row[1] || new Date().toISOString()).trim();
            const rawTgl = String(row[2] || ts.slice(0, 10)).trim();
            const rawTglKirim = String(row[15] || '').trim();
            const rawTujuanKirim = String(row[16] || '').trim();
            return {
              id: String(row[0] || `EXP-SHEET-${idx + 1}`).trim(),
              timestamp: ts,
              tanggal: rawTgl,
              tanggalPengiriman: rawTglKirim || rawTgl,
              tujuanPengiriman: rawTujuanKirim || undefined,
              driverId: String(row[3] || '').trim().toUpperCase(),
              driverName: String(row[4] || '').trim(),
              plateNumber: String(row[5] || '').trim().toUpperCase(),
              completedAssignmentNos: String(row[6] || '').trim(),
              fleetCardId: String(row[7] || '').trim().toUpperCase(),
              fleetCardNumber: String(row[8] || '').trim(),
              totalPengirimanBbm: bbm,
              fotoStrukBbmUrl: String(row[10] || '').trim() || undefined,
              totalPengeluaranTol: tol,
              fotoStrukTolUrl: String(row[12] || '').trim() || undefined,
              totalPengeluaran: rawTot > 0 ? rawTot : bbm + tol,
              catatan: String(row[14] || '').trim(),
              needsSheetSync: false,
            };
          })
      : undefined;

    return {
      spreadsheetId,
      spreadsheetTitle: matrices.title || store.spreadsheetTitle || '',
      spreadsheetUrl:
        store.spreadsheetUrl ||
        `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
      appsScriptUrl,
      driveRootFolderId,
      driveRootFolderUrl,
      drivers,
      vehicles,
      routes,
      fleetCards,
      assignments,
      driverExpenses,
      adminPin,
      dispatcherWaPhone,
      whatsappTargetMode,
      whatsappGroupName,
      whatsappGroupInviteUrl,
      publicPortalBaseUrl,
      letterPrefix,
    };
  };

  const buildAssignmentRowForSheetBridge = (a: AssignmentRecord): Array<string | number> => {
    const depMediaStatus = [
      a.driveMedia?.fotoOdometerBerangkatUrl
        ? 'Odo:Drive'
        : a.departureData?.fotoOdometerBerangkat
        ? 'Odo:Ada'
        : '',
      a.driveMedia?.fotoSuhuBerangkatUrl
        ? 'Suhu:Drive'
        : a.departureData?.fotoSuhuBerangkat
        ? 'Suhu:Ada'
        : '',
    ]
      .filter(Boolean)
      .join(', ');

    const hoMediaStatus = [
      a.driveMedia?.fotoOdometerSerahTerimaUrl
        ? 'Odo:Drive'
        : a.handoverData?.fotoOdometerSerahTerima
        ? 'Odo:Ada'
        : '',
      a.driveMedia?.fotoSuhuSerahTerimaUrl
        ? 'Suhu:Drive'
        : a.handoverData?.fotoSuhuSerahTerima
        ? 'Suhu:Ada'
        : '',
      a.driveMedia?.fotoBuktiSerahTerimaUrl
        ? 'Bukti:Drive'
        : a.handoverData?.fotoBuktiSerahTerima
        ? 'Bukti:Ada'
        : '',
      a.driveMedia?.tandaTanganPenerimaUrl
        ? 'TTD:Drive'
        : a.handoverData?.tandaTanganPenerima
        ? 'TTD:Ada'
        : '',
    ]
      .filter(Boolean)
      .join(', ');

    return [
      a.id,
      a.sequenceNumber,
      a.noPenugasan,
      a.noSuratJalanFisik || '',
      a.kodeSegel || '',
      a.tanggalTugas,
      a.driverId,
      a.driverName,
      a.driverPhone,
      a.vehicleId,
      a.plateNumber,
      a.vehicleType,
      a.departureData?.jenisKendaraan || '',
      a.departureData?.titikKeberangkatan || a.origin || '',
      a.routeId,
      a.destination,
      a.purpose,
      a.status,
      a.departureData?.timestamp || '',
      a.departureData?.kmAwal ?? '',
      a.departureData?.suhuAwal || '',
      a.departureData?.bbmAwal || '',
      a.departureData?.kondisiKendaraan || '',
      a.departureData?.catatanBerangkat || '',
      depMediaStatus,
      a.handoverData?.timestamp || '',
      a.handoverData?.kmAkhir ?? '',
      a.handoverData?.suhuAkhir || '',
      a.handoverData?.bbmAkhir || '',
      a.handoverData?.penerimaNama || '',
      a.handoverData?.kondisiAkhir || '',
      a.handoverData?.catatanSerahTerima || '',
      hoMediaStatus,
      a.notes || '',
      a.createdAt,
      a.jadwalJamTiba || '',
      a.beratMuatan || '',
      a.driveMedia?.folderUrl || a.driveFolderUrl || '',
      a.driveMedia?.fotoOdometerBerangkatUrl || '',
      a.driveMedia?.fotoSuhuBerangkatUrl || '',
      a.driveMedia?.fotoOdometerSerahTerimaUrl || '',
      a.driveMedia?.fotoSuhuSerahTerimaUrl || '',
      a.driveMedia?.fotoBuktiSerahTerimaUrl || '',
      a.driveMedia?.tandaTanganPenerimaUrl || '',
      a.deliveredAt || '',
      a.volumeCbm || '',
    ];
  };

  let serverSheetSyncInFlight = false;

  const pushStateViaAppsScriptBridge = async (): Promise<boolean> => {
    const bridgeUrl = String(store.appsScriptUrl || '').trim();
    const sheetId = String(store.spreadsheetId || '').trim();
    if (!bridgeUrl || !sheetId || !/^https:\/\/script\.google\.com\//i.test(bridgeUrl)) {
      return false;
    }
    try {
      const sortedAssignments = [...store.assignments].sort(
        (a, b) => a.sequenceNumber - b.sequenceNumber
      );
      const resp = await fetch(bridgeUrl, {
        method: 'POST',
        redirect: 'follow',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'push_all',
          spreadsheetId: sheetId,
          driversRows: store.drivers.map((d) => [
            d.id,
            d.name,
            d.phone,
            d.pin,
            d.licenseType,
            d.active ? 'Aktif' : 'Nonaktif',
          ]),
          vehiclesRows: store.vehicles.map((v) => [
            v.id,
            v.plateNumber,
            v.vehicleType,
            v.capacity,
            v.capacityCbm || '',
            v.status,
          ]),
          routesRows: store.routes.map((r) => [
            r.id,
            r.destination,
            r.picName,
            r.picPhone,
          ]),
          fleetCardsRows: store.fleetCards.map((fc) => [
            fc.id,
            fc.cardNumber,
            String(Math.round(Number(fc.balance) || 0)),
          ]),
          assignmentsRows: sortedAssignments.map(buildAssignmentRowForSheetBridge),
          driverExpensesRows: [...store.driverExpenses]
            .sort((a, b) =>
              String(a.timestamp || '').localeCompare(String(b.timestamp || ''))
            )
            .map((e) => [
              e.id,
              e.timestamp,
              e.tanggal,
              e.driverId,
              e.driverName,
              e.plateNumber || '',
              e.completedAssignmentNos || '',
              e.fleetCardId || '',
              e.fleetCardNumber,
              String(Math.round(Number(e.totalPengirimanBbm) || 0)),
              e.fotoStrukBbmUrl || '',
              String(Math.round(Number(e.totalPengeluaranTol) || 0)),
              e.fotoStrukTolUrl || '',
              String(
                Math.round(
                  Number(e.totalPengeluaran) ||
                    (Number(e.totalPengirimanBbm) || 0) +
                      (Number(e.totalPengeluaranTol) || 0)
                )
              ),
              e.catatan || '',
              e.tanggalPengiriman || e.tanggal || '',
              e.tujuanPengiriman || '',
            ]),
          configRows: [
            ['admin_pin', store.adminPin],
            ['dispatcher_wa', store.dispatcherWaPhone],
            ['whatsapp_target_mode', store.whatsappTargetMode || 'GROUP'],
            ['whatsapp_group_name', store.whatsappGroupName || ''],
            ['whatsapp_group_invite', store.whatsappGroupInviteUrl || ''],
            ['letter_prefix', store.letterPrefix || 'ST-CRK'],
            ['public_portal_url', store.publicPortalBaseUrl || ''],
            ['apps_script_url', store.appsScriptUrl || ''],
            ['drive_root_folder_id', store.driveRootFolderId || ''],
            ['drive_root_folder_url', store.driveRootFolderUrl || ''],
          ],
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!resp.ok) return false;
      const text = await resp.text();
      if (text.trim().startsWith('<')) return false;
      const parsed = JSON.parse(text) as { ok?: boolean; success?: boolean };
      if (parsed?.ok || parsed?.success) {
        store.needsMasterSheetSync = false;
        store.pendingMasterDeletionPush = false;
        store.pendingAssignmentDeletionPush = false;
        store.pendingExpenseDeletionPush = false;
        store.unsyncedDriverIds = [];
        store.unsyncedVehicleIds = [];
        store.unsyncedRouteIds = [];
        store.unsyncedFleetCardIds = [];
        store.assignments = store.assignments.map((a) => ({
          ...a,
          needsSheetSync: false,
        }));
        store.driverExpenses = store.driverExpenses.map((e) => ({
          ...e,
          needsSheetSync: false,
        }));
        store.lastSyncedAt = new Date().toISOString();
        snapshotSyncedIdsFromCurrentStore();
        saveStore(store);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  };

  const pullSpreadsheetFromServerAuto = async (): Promise<{
    ok: boolean;
    source?: 'APPS_SCRIPT' | 'LIVE_CSV';
    hasSheetDeletionsToPrune?: boolean;
    mutated?: boolean;
  }> => {
    const sheetId = String(store.spreadsheetId || '').trim();
    if (!sheetId || serverSheetSyncInFlight) {
      return { ok: false };
    }
    serverSheetSyncInFlight = true;
    try {
      const bridgeUrl = String(store.appsScriptUrl || '').trim();
      if (bridgeUrl && /^https:\/\/script\.google\.com\//i.test(bridgeUrl)) {
        try {
          const sep = bridgeUrl.includes('?') ? '&' : '?';
          const pullRes = await fetch(
            `${bridgeUrl}${sep}action=pull_all&spreadsheetId=${encodeURIComponent(
              sheetId
            )}&_t=${Date.now()}`,
            {
              method: 'GET',
              redirect: 'follow',
              headers: { Accept: 'application/json' },
              signal: AbortSignal.timeout(10000),
            }
          );
          if (pullRes.ok) {
            const rawText = await pullRes.text();
            if (!rawText.trim().startsWith('<')) {
              const bridgeJson = JSON.parse(rawText) as {
                ok?: boolean;
                title?: string;
                Master_Driver?: string[][];
                Master_Armada?: string[][];
                Master_Rute?: string[][];
                Master_Fleet_Card?: string[][];
                Surat_Tugas?: string[][];
                Pengeluaran_Driver?: string[][];
                Konfigurasi?: string[][];
              };
              if (bridgeJson?.ok && Array.isArray(bridgeJson.Surat_Tugas)) {
                const payload = parseRawTabMatricesToPayload(sheetId, {
                  driverAll: bridgeJson.Master_Driver || [],
                  vehicleAll: bridgeJson.Master_Armada || [],
                  routeAll: bridgeJson.Master_Rute || [],
                  fleetCardAll: Array.isArray(bridgeJson.Master_Fleet_Card)
                    ? bridgeJson.Master_Fleet_Card
                    : undefined,
                  assignmentAll: bridgeJson.Surat_Tugas || [],
                  expenseAll: Array.isArray(bridgeJson.Pengeluaran_Driver)
                    ? bridgeJson.Pengeluaran_Driver
                    : undefined,
                  configAll: bridgeJson.Konfigurasi || [],
                  title: bridgeJson.title,
                });
                const rec = reconcilePulledSheetsIntoStore(payload);
                if (
                  rec.hasPendingDriverUpdates ||
                  rec.hasPendingMasterUpdates ||
                  rec.hasCustomPinToPush
                ) {
                  await pushStateViaAppsScriptBridge();
                } else {
                  saveStore(store);
                }
                if (rec.mutated) {
                  broadcastRealtime({
                    type: 'state:sync',
                    actorRole: 'SYSTEM',
                  });
                }
                return {
                  ok: true,
                  source: 'APPS_SCRIPT',
                  hasSheetDeletionsToPrune: rec.hasSheetDeletionsToPrune,
                  mutated: rec.mutated,
                };
              }
            }
          }
        } catch {
          // Fall back to direct gviz CSV check below
        }
      }

      // Direct Zero-Auth Live CSV Pull (`gviz/tq?tqx=out:csv`) when Sheet allows link viewing
      const fetchTabCsv = async (tabName: string): Promise<string[][] | null> => {
        const url = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(
          sheetId
        )}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(
          tabName
        )}&_t=${Date.now()}`;
        const r = await fetch(url, {
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(7000),
        });
        if (!r.ok) return null;
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        const body = await r.text();
        const trimmedStart = body.trimStart().slice(0, 60).toLowerCase();
        if (
          ct.includes('text/html') ||
          trimmedStart.startsWith('<!doctype') ||
          trimmedStart.startsWith('<html')
        ) {
          return null;
        }
        return parseCsvRowsServer(body);
      };

      const [
        driverAll,
        vehicleAll,
        routeAll,
        fleetCardAll,
        assignmentAll,
        expenseAll,
        configAll,
      ] = await Promise.all([
        fetchTabCsv('Master_Driver'),
        fetchTabCsv('Master_Armada'),
        fetchTabCsv('Master_Rute'),
        fetchTabCsv('Master_Fleet_Card'),
        fetchTabCsv('Surat_Tugas'),
        fetchTabCsv('Pengeluaran_Driver'),
        fetchTabCsv('Konfigurasi'),
      ]);

      // Validate authentic Spreadsheet headers before trusting CSV output
      const asgHdr = (assignmentAll?.[0] || [])
        .map((c) => String(c || '').toLowerCase())
        .join('|');
      const drvHdr = (driverAll?.[0] || [])
        .map((c) => String(c || '').toLowerCase())
        .join('|');
      if (
        !assignmentAll ||
        !driverAll ||
        !vehicleAll ||
        !routeAll ||
        !asgHdr.includes('penugasan') ||
        !drvHdr.includes('driver')
      ) {
        store.liveCsvReadable = false;
        return { ok: false };
      }

      const fcHdr = (fleetCardAll?.[0] || [])
        .map((c) => String(c || '').toLowerCase())
        .join('|');
      const expHdr = (expenseAll?.[0] || [])
        .map((c) => String(c || '').toLowerCase())
        .join('|');

      store.liveCsvReadable = true;
      const payload = parseRawTabMatricesToPayload(sheetId, {
        driverAll,
        vehicleAll,
        routeAll,
        fleetCardAll:
          fleetCardAll && fcHdr.includes('fleet') ? fleetCardAll : undefined,
        assignmentAll,
        expenseAll:
          expenseAll && (expHdr.includes('bbm') || expHdr.includes('fleet'))
            ? expenseAll
            : undefined,
        configAll: configAll || [],
      });
      const rec = reconcilePulledSheetsIntoStore(payload);
      saveStore(store);
      if (rec.mutated) {
        broadcastRealtime({
          type: 'state:sync',
          actorRole: 'SYSTEM',
        });
      }
      return {
        ok: true,
        source: 'LIVE_CSV',
        hasSheetDeletionsToPrune: rec.hasSheetDeletionsToPrune,
        mutated: rec.mutated,
      };
    } catch {
      return { ok: false };
    } finally {
      serverSheetSyncInFlight = false;
    }
  };

  const triggerServerAppsScriptPushIfConfigured = (): void => {
    const bridgeUrl = String(store.appsScriptUrl || '').trim();
    if (!bridgeUrl || !store.spreadsheetId) return;
    void (async () => {
      await pullSpreadsheetFromServerAuto();
      await pushStateViaAppsScriptBridge();
    })();
  };

  // Endpoint for immediate zero-click Spreadsheet reconciliation on F5 / Driver Portal refresh
  app.post('/api/sheets/auto-sync', async (_req, res) => {
    const syncOut = await pullSpreadsheetFromServerAuto();
    res.json({
      success: syncOut.ok,
      source: syncOut.source || null,
      hasSheetDeletionsToPrune: Boolean(syncOut.hasSheetDeletionsToPrune),
      mutated: Boolean(syncOut.mutated),
      state: buildPublicState(),
    });
  });

  // Permanent 15-second background server Spreadsheet auto-sync poller
  const serverSheetsAutoPollInterval = setInterval(() => {
    if (store.spreadsheetId) {
      void pullSpreadsheetFromServerAuto();
    }
  }, 15000);

  wss.on('close', () => {
    clearInterval(serverSheetsAutoPollInterval);
  });

  // Hydrate & reconcile server state with Cloud Firestore while rejecting tombstoned deletions & preserving local photos
  app.post('/api/sync/from-firestore', (req, res) => {
    ensureStoreTracking();
    const {
      config: cloudConfig,
      drivers,
      vehicles,
      routes,
      fleetCards,
      assignments,
      driverExpenses,
      replaceCollections,
    } = req.body || {};

    let hasLocalUpdatesForCloud = false;
    let hasExtraneousCloudDocsToPrune = false;

    if (cloudConfig && typeof cloudConfig === 'object') {
      if (
        typeof cloudConfig.spreadsheetId === 'string' &&
        (cloudConfig.spreadsheetId.trim() || !store.spreadsheetId)
      ) {
        store.spreadsheetId = cloudConfig.spreadsheetId.trim();
      }
      if (
        typeof cloudConfig.spreadsheetTitle === 'string' &&
        (cloudConfig.spreadsheetTitle.trim() || !store.spreadsheetTitle)
      ) {
        store.spreadsheetTitle = cloudConfig.spreadsheetTitle.trim();
      }
      if (
        typeof cloudConfig.spreadsheetUrl === 'string' &&
        (cloudConfig.spreadsheetUrl.trim() || !store.spreadsheetUrl)
      ) {
        store.spreadsheetUrl = cloudConfig.spreadsheetUrl.trim();
      }
      if (
        typeof cloudConfig.driveRootFolderId === 'string' &&
        (cloudConfig.driveRootFolderId.trim() || !store.driveRootFolderId)
      ) {
        store.driveRootFolderId = cloudConfig.driveRootFolderId.trim();
      }
      if (
        typeof cloudConfig.driveRootFolderUrl === 'string' &&
        (cloudConfig.driveRootFolderUrl.trim() || !store.driveRootFolderUrl)
      ) {
        store.driveRootFolderUrl = cloudConfig.driveRootFolderUrl.trim();
      }
      if (
        typeof cloudConfig.dispatcherWaPhone === 'string' &&
        (cloudConfig.dispatcherWaPhone.trim() || !store.dispatcherWaPhone)
      ) {
        store.dispatcherWaPhone = cloudConfig.dispatcherWaPhone.trim();
      }
      if (
        cloudConfig.whatsappTargetMode === 'GROUP' ||
        cloudConfig.whatsappTargetMode === 'DIRECT' ||
        cloudConfig.whatsappTargetMode === 'DRIVER'
      ) {
        store.whatsappTargetMode = cloudConfig.whatsappTargetMode;
      }
      if (
        typeof cloudConfig.whatsappGroupName === 'string' &&
        cloudConfig.whatsappGroupName.trim()
      ) {
        store.whatsappGroupName = cloudConfig.whatsappGroupName.trim();
      }
      if (typeof cloudConfig.whatsappGroupInviteUrl === 'string') {
        store.whatsappGroupInviteUrl = cloudConfig.whatsappGroupInviteUrl.trim();
      }
      if (
        typeof cloudConfig.publicPortalBaseUrl === 'string' &&
        (cloudConfig.publicPortalBaseUrl.trim() || !store.publicPortalBaseUrl)
      ) {
        store.publicPortalBaseUrl = cloudConfig.publicPortalBaseUrl.trim();
      }
      if (
        typeof cloudConfig.letterPrefix === 'string' &&
        cloudConfig.letterPrefix.trim()
      ) {
        store.letterPrefix = cloudConfig.letterPrefix.trim().toUpperCase();
      }
      if (
        store.assignments.length === 0 &&
        store.pendingAssignmentDeletionPush
      ) {
        store.lastSequence = 0;
        if (
          typeof cloudConfig.lastSequence === 'number' &&
          cloudConfig.lastSequence > 0
        ) {
          hasLocalUpdatesForCloud = true;
        }
      } else if (
        typeof cloudConfig.lastSequence === 'number' &&
        cloudConfig.lastSequence > store.lastSequence
      ) {
        store.lastSequence = cloudConfig.lastSequence;
      }
      if (
        typeof cloudConfig.adminPin === 'string' &&
        cloudConfig.adminPin.trim().length >= 4 &&
        cloudConfig.adminPin.trim() !== '123456'
      ) {
        store.adminPin = cloudConfig.adminPin.trim();
        store.isDefaultPin = false;
      } else if (!store.isDefaultPin && store.adminPin.trim() !== '123456') {
        hasLocalUpdatesForCloud = true;
      }
    }

    if (Array.isArray(drivers)) {
      const localDriverMap = new Map<string, DriverRecord>();
      for (const d of store.drivers) {
        localDriverMap.set(d.id.trim().toLowerCase(), d);
      }
      const nextDrivers: DriverRecord[] = [];
      for (const cloudDrv of drivers as DriverRecord[]) {
        const cleanId = String(cloudDrv.id || '').trim();
        if (!cleanId) continue;
        if (isKeyTombstoned('drivers', cleanId)) {
          hasExtraneousCloudDocsToPrune = true;
          continue;
        }
        const existingLocal = localDriverMap.get(cleanId.toLowerCase());
        nextDrivers.push({
          id: cleanId,
          name: String(cloudDrv.name || '').trim(),
          phone:
            cloudDrv.phone !== undefined && cloudDrv.phone !== ''
              ? String(cloudDrv.phone)
              : existingLocal?.phone || '',
          pin:
            cloudDrv.pin !== undefined && cloudDrv.pin !== ''
              ? String(cloudDrv.pin)
              : existingLocal?.pin || '',
          licenseType: String(cloudDrv.licenseType || ''),
          active: cloudDrv.active !== false,
        });
      }

      if (!replaceCollections) {
        const cloudIds = new Set(
          nextDrivers.map((d) => d.id.trim().toLowerCase())
        );
        for (const localDrv of store.drivers) {
          if (!cloudIds.has(localDrv.id.trim().toLowerCase())) {
            nextDrivers.push(localDrv);
            hasLocalUpdatesForCloud = true;
          }
        }
      }
      store.drivers = nextDrivers;
    }

    if (Array.isArray(vehicles)) {
      const localVehicleMap = new Map<string, VehicleRecord>();
      for (const v of store.vehicles) {
        localVehicleMap.set(v.id.trim().toLowerCase(), v);
      }
      const nextVehicles: VehicleRecord[] = [];
      for (const cv of vehicles as VehicleRecord[]) {
        if (isKeyTombstoned('vehicles', cv.id)) {
          hasExtraneousCloudDocsToPrune = true;
          continue;
        }
        const localMatch = localVehicleMap.get(cv.id.trim().toLowerCase());
        if (!cv.capacityCbm && localMatch?.capacityCbm) {
          hasLocalUpdatesForCloud = true;
        }
        nextVehicles.push({
          ...cv,
          capacityCbm: cv.capacityCbm || localMatch?.capacityCbm,
        });
      }
      if (!replaceCollections) {
        const cloudIds = new Set(
          nextVehicles.map((v) => String(v.id || '').trim().toLowerCase())
        );
        for (const localVeh of store.vehicles) {
          if (!cloudIds.has(localVeh.id.trim().toLowerCase())) {
            nextVehicles.push(localVeh);
            hasLocalUpdatesForCloud = true;
          }
        }
      } else {
        for (let i = 0; i < nextVehicles.length; i++) {
          const localVeh = localVehicleMap.get(
            nextVehicles[i].id.trim().toLowerCase()
          );
          const hasUnsyncedAsg = store.assignments.some(
            (a) =>
              a.needsSheetSync &&
              a.plateNumber.trim().toLowerCase() ===
                nextVehicles[i].plateNumber.trim().toLowerCase()
          );
          if (localVeh && hasUnsyncedAsg && localVeh.status !== nextVehicles[i].status) {
            nextVehicles[i] = { ...nextVehicles[i], status: localVeh.status };
            hasLocalUpdatesForCloud = true;
          }
        }
      }
      store.vehicles = nextVehicles;
    }

    if (Array.isArray(routes)) {
      const nextRoutes: RouteRecord[] = [];
      for (const cr of routes as RouteRecord[]) {
        if (isKeyTombstoned('routes', cr.id)) {
          hasExtraneousCloudDocsToPrune = true;
          continue;
        }
        nextRoutes.push(cr);
      }
      if (!replaceCollections) {
        const cloudIds = new Set(
          nextRoutes.map((r) => String(r.id || '').trim().toLowerCase())
        );
        for (const localRt of store.routes) {
          if (!cloudIds.has(localRt.id.trim().toLowerCase())) {
            nextRoutes.push(localRt);
            hasLocalUpdatesForCloud = true;
          }
        }
      }
      store.routes = nextRoutes;
    }

    if (Array.isArray(fleetCards)) {
      const localCardMap = new Map<string, FleetCardRecord>();
      for (const fc of store.fleetCards) {
        localCardMap.set(fc.id.trim().toLowerCase(), fc);
      }
      const unsyncedFcSet = new Set(
        (store.unsyncedFleetCardIds || []).map(normalizeSyncKey)
      );
      const nextFleetCards: FleetCardRecord[] = [];
      for (const cfc of fleetCards as FleetCardRecord[]) {
        const cleanId = String(cfc.id || '').trim().toUpperCase();
        if (!cleanId) continue;
        if (isKeyTombstoned('fleetCards', cleanId)) {
          hasExtraneousCloudDocsToPrune = true;
          continue;
        }
        const localMatch = localCardMap.get(cleanId.toLowerCase());
        if (unsyncedFcSet.has(normalizeSyncKey(cleanId)) && localMatch) {
          nextFleetCards.push(localMatch);
          hasLocalUpdatesForCloud = true;
        } else {
          nextFleetCards.push({
            id: cleanId,
            cardNumber: String(cfc.cardNumber || '').trim(),
            balance: Number(cfc.balance) || 0,
          });
        }
      }
      if (!replaceCollections) {
        const cloudIds = new Set(
          nextFleetCards.map((fc) => fc.id.trim().toLowerCase())
        );
        for (const localFc of store.fleetCards) {
          if (!cloudIds.has(localFc.id.trim().toLowerCase())) {
            nextFleetCards.push(localFc);
            hasLocalUpdatesForCloud = true;
          }
        }
      } else {
        const cloudIds = new Set(
          nextFleetCards.map((fc) => fc.id.trim().toLowerCase())
        );
        for (const localFc of store.fleetCards) {
          if (
            !cloudIds.has(localFc.id.trim().toLowerCase()) &&
            unsyncedFcSet.has(normalizeSyncKey(localFc.id))
          ) {
            nextFleetCards.push(localFc);
            hasLocalUpdatesForCloud = true;
          }
        }
      }
      store.fleetCards = nextFleetCards;
    }

    const statusRank = (s: string): number => {
      if (s === 'Handover' || s === 'Selesai') return 3;
      if (s === 'Delivered') return 2;
      if (s === 'Dalam Perjalanan') return 1;
      return 0;
    };

    if (Array.isArray(assignments)) {
      const localById = new Map<string, AssignmentRecord>();
      for (const localItem of store.assignments) {
        localById.set(localItem.id, localItem);
      }

      const usedLocalIds = new Set<string>();
      const mergedAssignments: AssignmentRecord[] = [];
      for (const cloudItem of assignments as AssignmentRecord[]) {
        if (
          isKeyTombstoned(
            'assignments',
            cloudItem.id,
            cloudItem.noPenugasan
          )
        ) {
          hasExtraneousCloudDocsToPrune = true;
          continue;
        }
        const existingLocal = localById.get(cloudItem.id);
        if (existingLocal) {
          usedLocalIds.add(existingLocal.id);
          if (
            existingLocal.needsSheetSync ||
            statusRank(existingLocal.status) > statusRank(cloudItem.status)
          ) {
            hasLocalUpdatesForCloud = true;
            const mergedPendingDrive = mergeDriveMediaLinks(
              existingLocal.driveMedia,
              cloudItem.driveMedia
            );
            mergedAssignments.push({
              ...existingLocal,
              driveFolderUrl:
                mergedPendingDrive?.folderUrl ||
                existingLocal.driveFolderUrl ||
                cloudItem.driveFolderUrl,
              driveMedia: mergedPendingDrive,
            });
            continue;
          }
          const mergedDrive = mergeDriveMediaLinks(
            existingLocal.driveMedia,
            cloudItem.driveMedia
          );
          mergedAssignments.push({
            ...cloudItem,
            createdAt: existingLocal.createdAt || cloudItem.createdAt,
            deliveredAt: cloudItem.deliveredAt || existingLocal.deliveredAt,
            beratMuatan: cloudItem.beratMuatan || existingLocal.beratMuatan,
            volumeCbm: cloudItem.volumeCbm || existingLocal.volumeCbm,
            driveFolderUrl:
              mergedDrive?.folderUrl ||
              cloudItem.driveFolderUrl ||
              existingLocal.driveFolderUrl,
            driveMedia: mergedDrive,
            departureData: cloudItem.departureData
              ? {
                  ...cloudItem.departureData,
                  titikKeberangkatan:
                    cloudItem.departureData.titikKeberangkatan ||
                    existingLocal.departureData?.titikKeberangkatan,
                  jenisKendaraan:
                    cloudItem.departureData.jenisKendaraan ||
                    existingLocal.departureData?.jenisKendaraan,
                  fotoOdometerBerangkat:
                    cloudItem.departureData.fotoOdometerBerangkat ||
                    existingLocal.departureData?.fotoOdometerBerangkat,
                  fotoSuhuBerangkat:
                    cloudItem.departureData.fotoSuhuBerangkat ||
                    existingLocal.departureData?.fotoSuhuBerangkat,
                }
              : existingLocal.departureData,
            handoverData: cloudItem.handoverData
              ? {
                  ...cloudItem.handoverData,
                  fotoOdometerSerahTerima:
                    cloudItem.handoverData.fotoOdometerSerahTerima ||
                    existingLocal.handoverData?.fotoOdometerSerahTerima,
                  fotoSuhuSerahTerima:
                    cloudItem.handoverData.fotoSuhuSerahTerima ||
                    existingLocal.handoverData?.fotoSuhuSerahTerima,
                  fotoBuktiSerahTerima:
                    cloudItem.handoverData.fotoBuktiSerahTerima ||
                    existingLocal.handoverData?.fotoBuktiSerahTerima,
                  tandaTanganPenerima:
                    cloudItem.handoverData.tandaTanganPenerima ||
                    existingLocal.handoverData?.tandaTanganPenerima,
                }
              : existingLocal.handoverData,
            needsSheetSync: existingLocal.needsSheetSync ?? false,
          });
        } else {
          mergedAssignments.push({
            ...cloudItem,
            needsSheetSync: false,
          });
        }
      }

      if (!replaceCollections) {
        for (const [localId, localItem] of localById.entries()) {
          if (!usedLocalIds.has(localId)) {
            mergedAssignments.push(localItem);
            hasLocalUpdatesForCloud = true;
          }
        }
      } else {
        for (const [localId, localItem] of localById.entries()) {
          if (!usedLocalIds.has(localId) && localItem.needsSheetSync) {
            mergedAssignments.push(localItem);
            hasLocalUpdatesForCloud = true;
          }
        }
      }

      store.assignments = mergedAssignments;
    }

    if (Array.isArray(driverExpenses)) {
      const localExpById = new Map<string, DriverExpenseRecord>();
      for (const le of store.driverExpenses) {
        localExpById.set(le.id, le);
      }
      const usedLocalExpIds = new Set<string>();
      const mergedExpenses: DriverExpenseRecord[] = [];

      for (const cloudExp of driverExpenses as DriverExpenseRecord[]) {
        if (isKeyTombstoned('driverExpenses', cloudExp.id)) {
          hasExtraneousCloudDocsToPrune = true;
          continue;
        }
        const existingLocal = localExpById.get(cloudExp.id);
        if (existingLocal) {
          usedLocalExpIds.add(existingLocal.id);
          if (existingLocal.needsSheetSync) {
            hasLocalUpdatesForCloud = true;
            mergedExpenses.push({
              ...existingLocal,
              fotoStrukBbmUrl:
                existingLocal.fotoStrukBbmUrl || cloudExp.fotoStrukBbmUrl,
              fotoStrukTolUrl:
                existingLocal.fotoStrukTolUrl || cloudExp.fotoStrukTolUrl,
            });
            continue;
          }
          mergedExpenses.push({
            ...cloudExp,
            tanggalPengiriman:
              cloudExp.tanggalPengiriman || existingLocal.tanggalPengiriman,
            tujuanPengiriman:
              cloudExp.tujuanPengiriman || existingLocal.tujuanPengiriman,
            fotoStrukBbm:
              cloudExp.fotoStrukBbm || existingLocal.fotoStrukBbm,
            fotoStrukBbmUrl:
              cloudExp.fotoStrukBbmUrl || existingLocal.fotoStrukBbmUrl,
            fotoStrukTol:
              cloudExp.fotoStrukTol || existingLocal.fotoStrukTol,
            fotoStrukTolUrl:
              cloudExp.fotoStrukTolUrl || existingLocal.fotoStrukTolUrl,
            needsSheetSync: existingLocal.needsSheetSync ?? false,
          });
        } else {
          mergedExpenses.push({
            ...cloudExp,
            needsSheetSync: false,
          });
        }
      }

      if (!replaceCollections) {
        for (const [localId, localExp] of localExpById.entries()) {
          if (!usedLocalExpIds.has(localId)) {
            mergedExpenses.push(localExp);
            hasLocalUpdatesForCloud = true;
          }
        }
      } else {
        for (const [localId, localExp] of localExpById.entries()) {
          if (!usedLocalExpIds.has(localId) && localExp.needsSheetSync) {
            mergedExpenses.push(localExp);
            hasLocalUpdatesForCloud = true;
          }
        }
      }

      store.driverExpenses = mergedExpenses;
    }

    if (store.assignments.length === 0 && store.pendingAssignmentDeletionPush) {
      store.lastSequence = 0;
    } else {
      let maxSeq = store.lastSequence || 0;
      for (const a of store.assignments) {
        const s = Math.max(
          a.sequenceNumber || 0,
          extractSequenceFromNo(a.noPenugasan)
        );
        if (s > maxSeq) maxSeq = s;
      }
      store.lastSequence = maxSeq;
    }

    const isFromRelay = req.headers['x-relay-origin'] === 'ais-dev';
    saveStore(store, isFromRelay);
    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'SYSTEM',
    });
    res.json({
      success: true,
      hasLocalUpdatesForCloud,
      hasExtraneousCloudDocsToPrune,
      adminPin: store.adminPin,
      state: publicState,
    });
  });

  app.post('/api/sync/mark-pushed', (req, res) => {
    store.needsMasterSheetSync = false;
    store.pendingMasterDeletionPush = false;
    store.pendingAssignmentDeletionPush = false;
    store.pendingExpenseDeletionPush = false;
    store.unsyncedDriverIds = [];
    store.unsyncedVehicleIds = [];
    store.unsyncedRouteIds = [];
    store.unsyncedFleetCardIds = [];
    store.assignments = store.assignments.map((a) => ({
      ...a,
      needsSheetSync: false,
    }));
    store.driverExpenses = store.driverExpenses.map((e) => ({
      ...e,
      needsSheetSync: false,
    }));
    store.lastSyncedAt = new Date().toISOString();
    snapshotSyncedIdsFromCurrentStore();
    saveStore(store);
    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'SYSTEM',
    });
    res.json({ success: true, state: publicState });
  });

  // Save Google Drive photo archive metadata & folder URLs into assignments
  app.post('/api/assignments/drive-media', (req, res) => {
    const { driveRootFolderId, driveRootFolderUrl, updates } = req.body || {};

    if (typeof driveRootFolderId === 'string' && driveRootFolderId.trim()) {
      store.driveRootFolderId = driveRootFolderId.trim();
    }
    if (typeof driveRootFolderUrl === 'string' && driveRootFolderUrl.trim()) {
      store.driveRootFolderUrl = driveRootFolderUrl.trim();
    }

    const updatedAssignments: AssignmentRecord[] = [];
    if (Array.isArray(updates)) {
      for (const item of updates) {
        const assignmentId = String(item?.assignmentId || '').trim();
        if (!assignmentId) continue;
        const idx = store.assignments.findIndex((a) => a.id === assignmentId);
        if (idx === -1) continue;

        const existing = store.assignments[idx];
        const incomingMedia =
          item?.driveMedia && typeof item.driveMedia === 'object'
            ? (item.driveMedia as DriveMediaLinks)
            : undefined;
        const nextMedia = mergeDriveMediaLinks(
          incomingMedia,
          existing.driveMedia
        );
        const nextFolderUrl =
          String(
            item?.driveFolderUrl ||
              nextMedia?.folderUrl ||
              existing.driveFolderUrl ||
              ''
          ).trim() || undefined;

        store.assignments[idx] = {
          ...existing,
          driveFolderUrl: nextFolderUrl,
          driveMedia: nextMedia,
          needsSheetSync: true,
        };
        updatedAssignments.push(store.assignments[idx]);
      }
    }

    saveStore(store);
    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });

    res.json({
      success: true,
      updatedAssignments,
      state: publicState,
    });
  });

  // Serve crisp binary Driver Photos & Recipient Signatures directly from server storage
  // Guarantees 100% cross-device visibility in Admin Dashboard, Print PDF, Spreadsheet Links & Make.com
  app.get('/api/assignments/:id/media/:slot', (req, res) => {
    const rawId = String(req.params.id || '').trim();
    const slot = String(req.params.slot || '').trim().toLowerCase();
    const assignment = store.assignments.find(
      (a) =>
        a.id === rawId ||
        a.noPenugasan.trim().toLowerCase() === rawId.toLowerCase()
    );
    if (!assignment) {
      res.status(404).json({ error: 'Surat Tugas tidak ditemukan.' });
      return;
    }

    let rawDataUrl = '';
    let fallbackDriveUrl = '';
    switch (slot) {
      case 'odo-berangkat':
      case 'foto-odometer-berangkat':
        rawDataUrl = assignment.departureData?.fotoOdometerBerangkat || '';
        fallbackDriveUrl =
          assignment.driveMedia?.fotoOdometerBerangkatUrl || '';
        break;
      case 'suhu-berangkat':
      case 'foto-suhu-berangkat':
        rawDataUrl = assignment.departureData?.fotoSuhuBerangkat || '';
        fallbackDriveUrl = assignment.driveMedia?.fotoSuhuBerangkatUrl || '';
        break;
      case 'odo-serahterima':
      case 'foto-odometer-serahterima':
        rawDataUrl = assignment.handoverData?.fotoOdometerSerahTerima || '';
        fallbackDriveUrl =
          assignment.driveMedia?.fotoOdometerSerahTerimaUrl || '';
        break;
      case 'suhu-serahterima':
      case 'foto-suhu-serahterima':
        rawDataUrl = assignment.handoverData?.fotoSuhuSerahTerima || '';
        fallbackDriveUrl =
          assignment.driveMedia?.fotoSuhuSerahTerimaUrl || '';
        break;
      case 'bukti-serahterima':
      case 'foto-bukti-serahterima':
        rawDataUrl = assignment.handoverData?.fotoBuktiSerahTerima || '';
        fallbackDriveUrl =
          assignment.driveMedia?.fotoBuktiSerahTerimaUrl || '';
        break;
      case 'ttd-penerima':
      case 'tanda-tangan-penerima':
        rawDataUrl = assignment.handoverData?.tandaTanganPenerima || '';
        fallbackDriveUrl =
          assignment.driveMedia?.tandaTanganPenerimaUrl || '';
        break;
      default:
        res.status(400).json({ error: 'Slot media tidak dikenali.' });
        return;
    }

    if (rawDataUrl && rawDataUrl.startsWith('data:image/')) {
      const parsed = extractPureBase64AndMimeServer(rawDataUrl);
      if (parsed.pureBase64) {
        const buffer = Buffer.from(parsed.pureBase64, 'base64');
        res.setHeader('Content-Type', parsed.mimeType);
        res.setHeader('Content-Length', String(buffer.length));
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).send(buffer);
        return;
      }
    }

    if (rawDataUrl && /^https?:\/\//i.test(rawDataUrl)) {
      res.redirect(302, rawDataUrl);
      return;
    }

    if (fallbackDriveUrl && /^https?:\/\//i.test(fallbackDriveUrl)) {
      res.redirect(302, fallbackDriveUrl);
      return;
    }

    res.status(404).json({ error: 'Foto belum diunggah pada slot ini.' });
  });

  // Master Data: Drivers CRUD (without No. Polisi Default)
  app.post('/api/master/drivers', async (req, res) => {
    const id = String(req.body?.id || '').trim().toUpperCase();
    const name = String(req.body?.name || '').trim();
    const phone = String(req.body?.phone || '').trim();
    const pin = String(req.body?.pin || '').trim();
    const licenseType = String(req.body?.licenseType || 'SIM B1').trim();
    const active = req.body?.active !== false;

    if (!id || !name) {
      res.status(400).json({ error: 'ID Driver dan Nama Driver wajib diisi.' });
      return;
    }

    if (store.drivers.some((d) => d.id.toLowerCase() === id.toLowerCase())) {
      res
        .status(409)
        .json({ error: `ID Driver ${id} sudah terdaftar di Master Data.` });
      return;
    }

    const createdDriver: DriverRecord = {
      id,
      name,
      phone,
      pin,
      licenseType,
      active,
    };
    removeDeletedTombstones('drivers', [id]);
    store.drivers.push(createdDriver);
    markMasterItemUnsynced('drivers', id);
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  app.put('/api/master/drivers/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const idx = store.drivers.findIndex((d) => d.id.toLowerCase() === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'Data Driver tidak ditemukan.' });
      return;
    }

    const updatedId = String(req.body?.id || store.drivers[idx].id)
      .trim()
      .toUpperCase();
    const duplicate = store.drivers.find(
      (d, i) => i !== idx && d.id.toLowerCase() === updatedId.toLowerCase()
    );
    if (duplicate) {
      res
        .status(409)
        .json({ error: `ID Driver ${updatedId} sudah digunakan driver lain.` });
      return;
    }

    const previousId = store.drivers[idx].id;
    const updatedDriver: DriverRecord = {
      id: updatedId,
      name: String(req.body?.name ?? store.drivers[idx].name).trim(),
      phone: String(req.body?.phone ?? store.drivers[idx].phone).trim(),
      pin: String(req.body?.pin ?? store.drivers[idx].pin).trim(),
      licenseType: String(
        req.body?.licenseType ?? store.drivers[idx].licenseType
      ).trim(),
      active:
        req.body?.active !== undefined
          ? Boolean(req.body.active)
          : store.drivers[idx].active,
    };
    if (previousId.toLowerCase() !== updatedId.toLowerCase()) {
      removeMasterItemUnsynced('drivers', previousId);
      addDeletedTombstones('drivers', [previousId]);
      store.pendingMasterDeletionPush = true;
    }
    removeDeletedTombstones('drivers', [updatedId]);
    store.drivers[idx] = updatedDriver;
    markMasterItemUnsynced('drivers', updatedId);

    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  app.delete('/api/master/drivers/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const deletedDriver = store.drivers.find(
      (d) => d.id.toLowerCase() === targetId
    );
    if (!deletedDriver) {
      res.status(404).json({ error: 'Data Driver tidak ditemukan.' });
      return;
    }
    store.drivers = store.drivers.filter((d) => d.id.toLowerCase() !== targetId);
    removeMasterItemUnsynced('drivers', deletedDriver.id);
    addDeletedTombstones('drivers', [deletedDriver.id]);
    store.pendingMasterDeletionPush = true;
    store.needsMasterSheetSync = true;
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  // Master Data: Vehicles CRUD (with Kapasitas CBM)
  app.post('/api/master/vehicles', async (req, res) => {
    const id = String(req.body?.id || '').trim().toUpperCase();
    const plateNumber = String(req.body?.plateNumber || '').trim().toUpperCase();
    const vehicleType = String(req.body?.vehicleType || '').trim();
    const capacity = String(req.body?.capacity || '').trim();
    const capacityCbm = String(req.body?.capacityCbm || '').trim();
    const status =
      (req.body?.status as VehicleRecord['status']) || 'Siap Jalan';

    if (!id || !plateNumber) {
      res
        .status(400)
        .json({ error: 'Kode Unit dan Nomor Polisi wajib diisi.' });
      return;
    }

    if (store.vehicles.some((v) => v.id.toLowerCase() === id.toLowerCase())) {
      res.status(409).json({ error: `Kode Unit ${id} sudah terdaftar.` });
      return;
    }

    const createdVehicle: VehicleRecord = {
      id,
      plateNumber,
      vehicleType,
      capacity,
      capacityCbm: capacityCbm || undefined,
      status,
    };
    removeDeletedTombstones('vehicles', [id]);
    store.vehicles.push(createdVehicle);
    markMasterItemUnsynced('vehicles', id);
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  app.put('/api/master/vehicles/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const idx = store.vehicles.findIndex((v) => v.id.toLowerCase() === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'Data Armada tidak ditemukan.' });
      return;
    }

    const updatedId = String(req.body?.id || store.vehicles[idx].id)
      .trim()
      .toUpperCase();
    const duplicate = store.vehicles.find(
      (v, i) => i !== idx && v.id.toLowerCase() === updatedId.toLowerCase()
    );
    if (duplicate) {
      res
        .status(409)
        .json({ error: `Kode Unit ${updatedId} sudah digunakan unit lain.` });
      return;
    }

    const previousId = store.vehicles[idx].id;
    const nextCapacityCbm =
      req.body?.capacityCbm !== undefined
        ? String(req.body.capacityCbm || '').trim() || undefined
        : store.vehicles[idx].capacityCbm;
    const updatedVehicle: VehicleRecord = {
      id: updatedId,
      plateNumber: String(
        req.body?.plateNumber ?? store.vehicles[idx].plateNumber
      )
        .trim()
        .toUpperCase(),
      vehicleType: String(
        req.body?.vehicleType ?? store.vehicles[idx].vehicleType
      ).trim(),
      capacity: String(
        req.body?.capacity ?? store.vehicles[idx].capacity
      ).trim(),
      capacityCbm: nextCapacityCbm,
      status:
        (req.body?.status as VehicleRecord['status']) ||
        store.vehicles[idx].status,
    };
    if (previousId.toLowerCase() !== updatedId.toLowerCase()) {
      removeMasterItemUnsynced('vehicles', previousId);
      addDeletedTombstones('vehicles', [previousId]);
      store.pendingMasterDeletionPush = true;
    }
    removeDeletedTombstones('vehicles', [updatedId]);
    store.vehicles[idx] = updatedVehicle;
    markMasterItemUnsynced('vehicles', updatedId);

    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  app.delete('/api/master/vehicles/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const deletedVehicle = store.vehicles.find(
      (v) => v.id.toLowerCase() === targetId
    );
    if (!deletedVehicle) {
      res.status(404).json({ error: 'Data Armada tidak ditemukan.' });
      return;
    }
    store.vehicles = store.vehicles.filter(
      (v) => v.id.toLowerCase() !== targetId
    );
    removeMasterItemUnsynced('vehicles', deletedVehicle.id);
    addDeletedTombstones('vehicles', [deletedVehicle.id]);
    store.pendingMasterDeletionPush = true;
    store.needsMasterSheetSync = true;
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  // Master Data: Routes / Tujuan CRUD
  app.post('/api/master/routes', async (req, res) => {
    const id = String(req.body?.id || '').trim().toUpperCase();
    const destination = String(req.body?.destination || '').trim();
    const picName = String(req.body?.picName || '').trim();
    const picPhone = String(req.body?.picPhone || '').trim();

    if (!id || !destination) {
      res
        .status(400)
        .json({ error: 'Kode Rute dan Lokasi Tujuan wajib diisi.' });
      return;
    }

    if (store.routes.some((r) => r.id.toLowerCase() === id.toLowerCase())) {
      res.status(409).json({ error: `Kode Rute ${id} sudah terdaftar.` });
      return;
    }

    const createdRoute: RouteRecord = { id, destination, picName, picPhone };
    removeDeletedTombstones('routes', [id]);
    store.routes.push(createdRoute);
    markMasterItemUnsynced('routes', id);
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  app.put('/api/master/routes/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const idx = store.routes.findIndex((r) => r.id.toLowerCase() === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'Data Rute tidak ditemukan.' });
      return;
    }

    const updatedId = String(req.body?.id || store.routes[idx].id)
      .trim()
      .toUpperCase();
    const duplicate = store.routes.find(
      (r, i) => i !== idx && r.id.toLowerCase() === updatedId.toLowerCase()
    );
    if (duplicate) {
      res
        .status(409)
        .json({ error: `Kode Rute ${updatedId} sudah digunakan rute lain.` });
      return;
    }

    const previousId = store.routes[idx].id;
    const updatedRoute: RouteRecord = {
      id: updatedId,
      destination: String(
        req.body?.destination ?? store.routes[idx].destination
      ).trim(),
      picName: String(req.body?.picName ?? store.routes[idx].picName).trim(),
      picPhone: String(req.body?.picPhone ?? store.routes[idx].picPhone).trim(),
    };
    if (previousId.toLowerCase() !== updatedId.toLowerCase()) {
      removeMasterItemUnsynced('routes', previousId);
      addDeletedTombstones('routes', [previousId]);
      store.pendingMasterDeletionPush = true;
    }
    removeDeletedTombstones('routes', [updatedId]);
    store.routes[idx] = updatedRoute;
    markMasterItemUnsynced('routes', updatedId);

    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  app.delete('/api/master/routes/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const deletedRoute = store.routes.find(
      (r) => r.id.toLowerCase() === targetId
    );
    if (!deletedRoute) {
      res.status(404).json({ error: 'Data Rute tidak ditemukan.' });
      return;
    }
    store.routes = store.routes.filter((r) => r.id.toLowerCase() !== targetId);
    removeMasterItemUnsynced('routes', deletedRoute.id);
    addDeletedTombstones('routes', [deletedRoute.id]);
    store.pendingMasterDeletionPush = true;
    store.needsMasterSheetSync = true;
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  // Master Data: Fleet Cards CRUD + Top-Up Saldo
  app.post('/api/master/fleet-cards', async (req, res) => {
    const id = String(req.body?.id || '').trim().toUpperCase();
    const cardNumber = String(req.body?.cardNumber || '').trim();
    const balance = Math.round(Number(req.body?.balance) || 0);

    if (!id || !cardNumber) {
      res.status(400).json({
        error: 'ID Fleet Card dan Nomor Kartu Fleet Card wajib diisi.',
      });
      return;
    }

    if (store.fleetCards.some((fc) => fc.id.toLowerCase() === id.toLowerCase())) {
      res.status(409).json({
        error: `ID Fleet Card ${id} sudah terdaftar di Master Kartu Fleet Card.`,
      });
      return;
    }

    if (
      store.fleetCards.some(
        (fc) =>
          fc.cardNumber.replace(/\s+/g, '').toLowerCase() ===
          cardNumber.replace(/\s+/g, '').toLowerCase()
      )
    ) {
      res.status(409).json({
        error: `Nomor Kartu Fleet Card ${cardNumber} sudah terdaftar.`,
      });
      return;
    }

    const createdCard: FleetCardRecord = {
      id,
      cardNumber,
      balance,
    };
    removeDeletedTombstones('fleetCards', [id]);
    store.fleetCards.push(createdCard);
    markMasterItemUnsynced('fleetCards', id);
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      fleetCard: createdCard,
      state: publicState,
    });
  });

  app.put('/api/master/fleet-cards/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const idx = store.fleetCards.findIndex(
      (fc) => fc.id.toLowerCase() === targetId
    );
    if (idx === -1) {
      res.status(404).json({ error: 'Data Kartu Fleet Card tidak ditemukan.' });
      return;
    }

    const updatedId = String(req.body?.id || store.fleetCards[idx].id)
      .trim()
      .toUpperCase();
    const updatedCardNumber = String(
      req.body?.cardNumber ?? store.fleetCards[idx].cardNumber
    ).trim();
    const updatedBalance =
      req.body?.balance !== undefined
        ? Math.round(Number(req.body.balance) || 0)
        : store.fleetCards[idx].balance;

    if (!updatedId || !updatedCardNumber) {
      res.status(400).json({
        error: 'ID Fleet Card dan Nomor Kartu Fleet Card wajib diisi.',
      });
      return;
    }

    const dupId = store.fleetCards.find(
      (fc, i) => i !== idx && fc.id.toLowerCase() === updatedId.toLowerCase()
    );
    if (dupId) {
      res.status(409).json({
        error: `ID Fleet Card ${updatedId} sudah digunakan kartu lain.`,
      });
      return;
    }

    const dupNo = store.fleetCards.find(
      (fc, i) =>
        i !== idx &&
        fc.cardNumber.replace(/\s+/g, '').toLowerCase() ===
          updatedCardNumber.replace(/\s+/g, '').toLowerCase()
    );
    if (dupNo) {
      res.status(409).json({
        error: `Nomor Kartu Fleet Card ${updatedCardNumber} sudah digunakan kartu lain.`,
      });
      return;
    }

    const previousId = store.fleetCards[idx].id;
    const updatedCard: FleetCardRecord = {
      id: updatedId,
      cardNumber: updatedCardNumber,
      balance: updatedBalance,
    };

    if (previousId.toLowerCase() !== updatedId.toLowerCase()) {
      removeMasterItemUnsynced('fleetCards', previousId);
      addDeletedTombstones('fleetCards', [previousId]);
      store.pendingMasterDeletionPush = true;
    }
    removeDeletedTombstones('fleetCards', [updatedId]);
    store.fleetCards[idx] = updatedCard;
    markMasterItemUnsynced('fleetCards', updatedId);

    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      fleetCard: updatedCard,
      state: publicState,
    });
  });

  app.post('/api/master/fleet-cards/:id/topup', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const idx = store.fleetCards.findIndex(
      (fc) => fc.id.toLowerCase() === targetId
    );
    if (idx === -1) {
      res.status(404).json({ error: 'Data Kartu Fleet Card tidak ditemukan.' });
      return;
    }

    const addAmount = Math.round(Number(req.body?.addAmount) || 0);
    if (!Number.isFinite(addAmount) || addAmount <= 0) {
      res.status(400).json({
        error: 'Nominal Tambah Saldo harus lebih besar dari Rp 0.',
      });
      return;
    }

    const nextBalance = Math.round(
      (Number(store.fleetCards[idx].balance) || 0) + addAmount
    );
    store.fleetCards[idx] = {
      ...store.fleetCards[idx],
      balance: nextBalance,
    };
    markMasterItemUnsynced('fleetCards', store.fleetCards[idx].id);

    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      fleetCard: store.fleetCards[idx],
      state: publicState,
    });
  });

  app.put('/api/master/fleet-cards/:id/balance', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const idx = store.fleetCards.findIndex(
      (fc) => fc.id.toLowerCase() === targetId
    );
    if (idx === -1) {
      res.status(404).json({ error: 'Data Kartu Fleet Card tidak ditemukan.' });
      return;
    }

    const rawBalance = Number(req.body?.balance);
    if (!Number.isFinite(rawBalance)) {
      res.status(400).json({
        error: 'Nominal Saldo Fleet Card tidak valid.',
      });
      return;
    }

    const nextBalance = Math.round(rawBalance);
    store.fleetCards[idx] = {
      ...store.fleetCards[idx],
      balance: nextBalance,
    };
    markMasterItemUnsynced('fleetCards', store.fleetCards[idx].id);

    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      fleetCard: store.fleetCards[idx],
      state: publicState,
    });
  });

  app.delete('/api/master/fleet-cards/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim().toLowerCase();
    const deletedCard = store.fleetCards.find(
      (fc) => fc.id.toLowerCase() === targetId
    );
    if (!deletedCard) {
      res.status(404).json({ error: 'Data Kartu Fleet Card tidak ditemukan.' });
      return;
    }
    store.fleetCards = store.fleetCards.filter(
      (fc) => fc.id.toLowerCase() !== targetId
    );
    removeMasterItemUnsynced('fleetCards', deletedCard.id);
    addDeletedTombstones('fleetCards', [deletedCard.id]);
    store.pendingMasterDeletionPush = true;
    store.needsMasterSheetSync = true;
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  // Data Pengeluaran Driver (Sheet Pengeluaran_Driver) + Auto Fleet Card Balance Deduction + Receipt Media
  app.post('/api/driver-expenses', async (req, res) => {
    const driverId = String(req.body?.driverId || '').trim().toUpperCase();
    const driverName = String(req.body?.driverName || '').trim();
    const plateNumber = String(req.body?.plateNumber || '').trim().toUpperCase();
    const completedAssignmentNos = String(
      req.body?.completedAssignmentNos || ''
    ).trim();
    const rawFleetCardId = String(req.body?.fleetCardId || '')
      .trim()
      .toUpperCase();
    const rawFleetCardNumber = String(req.body?.fleetCardNumber || '').trim();
    const totalPengirimanBbm = Math.max(
      0,
      Math.round(Number(req.body?.totalPengirimanBbm) || 0)
    );
    const totalPengeluaranTol = Math.max(
      0,
      Math.round(Number(req.body?.totalPengeluaranTol) || 0)
    );
    const fotoStrukBbm = String(req.body?.fotoStrukBbm || '').trim();
    const fotoStrukTol = String(req.body?.fotoStrukTol || '').trim();
    const catatan = String(req.body?.catatan || '').trim();
    const rawTanggalPengiriman = String(
      req.body?.tanggalPengiriman || ''
    ).trim();
    const tujuanPengiriman = String(req.body?.tujuanPengiriman || '').trim();

    if (!driverId || !driverName) {
      res.status(400).json({ error: 'Identitas Driver wajib diisi.' });
      return;
    }

    const matchedCardIdx = store.fleetCards.findIndex(
      (fc) =>
        (rawFleetCardId &&
          fc.id.toLowerCase() === rawFleetCardId.toLowerCase()) ||
        (rawFleetCardNumber &&
          fc.cardNumber.replace(/\s+/g, '').toLowerCase() ===
            rawFleetCardNumber.replace(/\s+/g, '').toLowerCase())
    );

    const resolvedCard =
      matchedCardIdx >= 0 ? store.fleetCards[matchedCardIdx] : undefined;
    const resolvedCardNumber = resolvedCard
      ? resolvedCard.cardNumber
      : rawFleetCardNumber;
    const resolvedCardId = resolvedCard
      ? resolvedCard.id
      : rawFleetCardId || 'MANUAL';

    if (!resolvedCardNumber) {
      res.status(400).json({
        error: 'Nomor Kartu Fleet Card yang digunakan wajib dipilih dari Master Kartu Fleet Card.',
      });
      return;
    }

    if (totalPengirimanBbm <= 0 && totalPengeluaranTol <= 0) {
      res.status(400).json({
        error:
          'Masukkan nominal Total Pembelian BBM atau Total Pengeluaran Tol minimal salah satu lebih dari Rp 0.',
      });
      return;
    }

    const requestedExpenseId = String(req.body?.id || '').trim();
    if (requestedExpenseId) {
      const existingExp = store.driverExpenses.find(
        (e) => e.id.toLowerCase() === requestedExpenseId.toLowerCase()
      );
      if (existingExp) {
        res.json({
          success: true,
          expense: existingExp,
          updatedFleetCard:
            matchedCardIdx >= 0 ? store.fleetCards[matchedCardIdx] : null,
          state: buildPublicState(),
        });
        return;
      }
    }

    const rawClientTimestamp = String(req.body?.timestamp || '').trim();
    const parsedClientDate = rawClientTimestamp
      ? new Date(rawClientTimestamp)
      : null;
    const now =
      parsedClientDate && !Number.isNaN(parsedClientDate.getTime())
        ? parsedClientDate
        : new Date();
    const nowIso = now.toISOString();
    const wibDateParts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const effectiveTanggalPengiriman = rawTanggalPengiriman || wibDateParts;
    const totalPengeluaran = totalPengirimanBbm + totalPengeluaranTol;

    if (matchedCardIdx >= 0) {
      store.fleetCards[matchedCardIdx] = {
        ...store.fleetCards[matchedCardIdx],
        balance: Math.round(
          (Number(store.fleetCards[matchedCardIdx].balance) || 0) -
            totalPengeluaran
        ),
      };
      markMasterItemUnsynced('fleetCards', store.fleetCards[matchedCardIdx].id);
    }

    const createdExpense: DriverExpenseRecord = {
      id:
        requestedExpenseId ||
        `EXP-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`,
      timestamp: nowIso,
      tanggal: wibDateParts,
      tanggalPengiriman: effectiveTanggalPengiriman,
      tujuanPengiriman: tujuanPengiriman || undefined,
      driverId,
      driverName,
      plateNumber,
      completedAssignmentNos,
      fleetCardId: resolvedCardId,
      fleetCardNumber: resolvedCardNumber,
      totalPengirimanBbm,
      fotoStrukBbm: fotoStrukBbm || undefined,
      totalPengeluaranTol,
      fotoStrukTol: fotoStrukTol || undefined,
      totalPengeluaran,
      catatan,
      needsSheetSync: true,
    };

    removeDeletedTombstones('driverExpenses', [createdExpense.id]);
    store.driverExpenses.unshift(createdExpense);
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'DRIVER',
    });

    res.json({
      success: true,
      expense: createdExpense,
      updatedFleetCard:
        matchedCardIdx >= 0 ? store.fleetCards[matchedCardIdx] : null,
      state: publicState,
    });
  });

  app.delete('/api/driver-expenses/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim();
    const deletedExpense = store.driverExpenses.find((e) => e.id === targetId);
    if (!deletedExpense) {
      res
        .status(404)
        .json({ error: 'Data Pengeluaran Driver tidak ditemukan.' });
      return;
    }

    const restoreBalance = req.query.restoreBalance !== 'false';
    if (restoreBalance && deletedExpense.totalPengeluaran > 0) {
      const cardIdx = store.fleetCards.findIndex(
        (fc) =>
          (deletedExpense.fleetCardId &&
            fc.id.toLowerCase() ===
              deletedExpense.fleetCardId.toLowerCase()) ||
          (deletedExpense.fleetCardNumber &&
            fc.cardNumber.replace(/\s+/g, '').toLowerCase() ===
              deletedExpense.fleetCardNumber.replace(/\s+/g, '').toLowerCase())
      );
      if (cardIdx >= 0) {
        store.fleetCards[cardIdx] = {
          ...store.fleetCards[cardIdx],
          balance: Math.round(
            (Number(store.fleetCards[cardIdx].balance) || 0) +
              deletedExpense.totalPengeluaran
          ),
        };
        markMasterItemUnsynced('fleetCards', store.fleetCards[cardIdx].id);
      }
    }

    store.driverExpenses = store.driverExpenses.filter(
      (e) => e.id !== targetId
    );
    addDeletedTombstones('driverExpenses', [deletedExpense.id]);
    store.syncedExpenseIds = (store.syncedExpenseIds || []).filter(
      (id) => normalizeSyncKey(id) !== normalizeSyncKey(deletedExpense.id)
    );
    store.pendingExpenseDeletionPush = true;
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });

    res.json({
      success: true,
      state: publicState,
    });
  });

  app.post('/api/driver-expenses/drive-media', (req, res) => {
    const { driveRootFolderId, driveRootFolderUrl, updates } = req.body || {};

    if (typeof driveRootFolderId === 'string' && driveRootFolderId.trim()) {
      store.driveRootFolderId = driveRootFolderId.trim();
    }
    if (typeof driveRootFolderUrl === 'string' && driveRootFolderUrl.trim()) {
      store.driveRootFolderUrl = driveRootFolderUrl.trim();
    }

    const updatedExpenses: DriverExpenseRecord[] = [];
    if (Array.isArray(updates)) {
      for (const item of updates) {
        const expenseId = String(item?.expenseId || '').trim();
        if (!expenseId) continue;
        const idx = store.driverExpenses.findIndex((e) => e.id === expenseId);
        if (idx === -1) continue;
        const existing = store.driverExpenses[idx];
        store.driverExpenses[idx] = {
          ...existing,
          fotoStrukBbmUrl:
            String(item?.fotoStrukBbmUrl || existing.fotoStrukBbmUrl || '').trim() ||
            undefined,
          fotoStrukTolUrl:
            String(item?.fotoStrukTolUrl || existing.fotoStrukTolUrl || '').trim() ||
            undefined,
          needsSheetSync: true,
        };
        updatedExpenses.push(store.driverExpenses[idx]);
      }
    }

    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });

    res.json({
      success: true,
      updatedExpenses,
      state: publicState,
    });
  });

  app.get('/api/driver-expenses/:id/media/:slot', (req, res) => {
    const rawId = String(req.params.id || '').trim();
    const slot = String(req.params.slot || '').trim().toLowerCase();
    const expense = store.driverExpenses.find((e) => e.id === rawId);
    if (!expense) {
      res.status(404).json({ error: 'Data Pengeluaran tidak ditemukan.' });
      return;
    }

    let rawDataUrl = '';
    let fallbackDriveUrl = '';
    if (slot === 'struk-bbm' || slot === 'bbm') {
      rawDataUrl = expense.fotoStrukBbm || '';
      fallbackDriveUrl = expense.fotoStrukBbmUrl || '';
    } else if (slot === 'struk-tol' || slot === 'tol') {
      rawDataUrl = expense.fotoStrukTol || '';
      fallbackDriveUrl = expense.fotoStrukTolUrl || '';
    } else {
      res.status(400).json({ error: 'Slot struk pengeluaran tidak dikenali.' });
      return;
    }

    if (rawDataUrl && rawDataUrl.startsWith('data:image/')) {
      const parsed = extractPureBase64AndMimeServer(rawDataUrl);
      if (parsed.pureBase64) {
        const buffer = Buffer.from(parsed.pureBase64, 'base64');
        res.setHeader('Content-Type', parsed.mimeType);
        res.setHeader('Content-Length', String(buffer.length));
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).send(buffer);
        return;
      }
    }

    if (rawDataUrl && /^https?:\/\//i.test(rawDataUrl)) {
      res.redirect(302, rawDataUrl);
      return;
    }

    if (fallbackDriveUrl && /^https?:\/\//i.test(fallbackDriveUrl)) {
      res.redirect(302, fallbackDriveUrl);
      return;
    }

    res.status(404).json({ error: 'Foto struk belum diunggah pada slot ini.' });
  });

  // Assignments CRUD + Real-Time Automatic Driver WhatsApp Notification
  app.post('/api/assignments', async (req, res) => {
    const {
      tanggalTugas,
      jadwalJamTiba,
      noSuratJalanFisik,
      kodeSegel,
      driverId,
      driverName,
      driverPhone,
      vehicleId,
      plateNumber,
      vehicleType,
      originId,
      origin,
      routeId,
      destination,
      purpose,
      beratMuatan,
      volumeCbm,
      notes,
    } = req.body || {};

    if (!driverId || !driverName || !plateNumber || !destination) {
      res.status(400).json({
        error:
          'Driver, Kendaraan (No. Polisi), dan Lokasi Tujuan wajib dilengkapi.',
      });
      return;
    }

    const nextSeq = computeNextSequence(store);
    const dateVal = String(
      tanggalTugas || new Date().toISOString().slice(0, 10)
    ).trim();
    const sequentialNo = formatSequentialNo(store.letterPrefix, nextSeq, dateVal);
    const jamTibaClean = String(jadwalJamTiba || '').trim();
    const resolvedDriverPhone = resolveDriverPhone(
      String(driverId).trim(),
      String(driverPhone || '').trim()
    );
    const initialOrigin =
      String(origin || '').trim() || 'Menunggu Titik Keberangkatan Driver';
    const beratMuatanClean = String(beratMuatan || '').trim();
    const volumeCbmClean = String(volumeCbm || '').trim();

    const newAssignment: AssignmentRecord = {
      id: `ASG-${Date.now()}-${nextSeq}`,
      sequenceNumber: nextSeq,
      noPenugasan: sequentialNo,
      noSuratJalanFisik: String(noSuratJalanFisik || '').trim(),
      kodeSegel: String(kodeSegel || '').trim().toUpperCase(),
      createdAt: new Date().toISOString(),
      tanggalTugas: dateVal,
      jadwalJamTiba: jamTibaClean || undefined,
      driverId: String(driverId).trim(),
      driverName: String(driverName).trim(),
      driverPhone: resolvedDriverPhone,
      vehicleId: String(vehicleId || '').trim(),
      plateNumber: String(plateNumber).trim().toUpperCase(),
      vehicleType: String(vehicleType || '').trim(),
      originId: String(originId || '').trim(),
      origin: initialOrigin,
      routeId: String(routeId || '').trim(),
      destination: String(destination).trim(),
      purpose: String(purpose || '').trim(),
      beratMuatan: beratMuatanClean || undefined,
      volumeCbm: volumeCbmClean || undefined,
      status: 'Menunggu Berangkat',
      notes: String(notes || '').trim(),
      needsSheetSync: true,
    };

    removeDeletedTombstones('assignments', [
      newAssignment.id,
      newAssignment.noPenugasan,
    ]);
    store.lastSequence = nextSeq;
    store.assignments.push(newAssignment);
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const routeObj = store.routes.find((r) => r.id === newAssignment.routeId);
    const waMessage = formatDriverRealtimeWhatsAppMessage(
      newAssignment,
      'SURAT_TUGAS',
      store.whatsappGroupName
    );

    const targets = [
      resolvedDriverPhone,
      store.dispatcherWaPhone,
      routeObj?.picPhone || '',
    ].filter(Boolean);

    const notification = await dispatchWhatsAppNetwork({
      eventType: 'SURAT_TUGAS',
      noPenugasan: newAssignment.noPenugasan,
      assignmentId: newAssignment.id,
      destination: newAssignment.destination,
      actorRole: 'ADMIN',
      summary: `Tugas baru diterbitkan untuk ${newAssignment.driverName} (${newAssignment.plateNumber}) menuju ${newAssignment.destination}.`,
      readByAdmin: false,
      driverId: newAssignment.driverId,
      driverName: newAssignment.driverName,
      plateNumber: newAssignment.plateNumber,
      driverPhone: resolvedDriverPhone,
      targets,
      message: waMessage,
    });

    const publicState = broadcastRealtime({
      type: 'assignment:created',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
      assignment: newAssignment,
      notification,
    });

    res.json({
      success: true,
      assignment: newAssignment,
      notification,
      state: publicState,
    });
  });

  app.put('/api/assignments/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim();
    const idx = store.assignments.findIndex((a) => a.id === targetId);
    if (idx === -1) {
      res.status(404).json({ error: 'Surat Tugas tidak ditemukan.' });
      return;
    }

    const existing = store.assignments[idx];
    const previousStatus = existing.status;
    const nextDriverId = String(req.body?.driverId ?? existing.driverId).trim();
    const nextDriverPhone = resolveDriverPhone(
      nextDriverId,
      String(req.body?.driverPhone ?? existing.driverPhone).trim()
    );
    const nextStatus =
      (req.body?.status as AssignmentRecord['status']) || existing.status;

    const updated: AssignmentRecord = {
      ...existing,
      tanggalTugas: String(req.body?.tanggalTugas ?? existing.tanggalTugas).trim(),
      jadwalJamTiba:
        req.body?.jadwalJamTiba !== undefined
          ? String(req.body.jadwalJamTiba || '').trim() || undefined
          : existing.jadwalJamTiba,
      deliveredAt:
        nextStatus === 'Delivered' && !existing.deliveredAt
          ? new Date().toISOString()
          : existing.deliveredAt,
      noSuratJalanFisik: String(
        req.body?.noSuratJalanFisik ?? existing.noSuratJalanFisik
      ).trim(),
      kodeSegel: String(req.body?.kodeSegel ?? existing.kodeSegel)
        .trim()
        .toUpperCase(),
      driverId: nextDriverId,
      driverName: String(req.body?.driverName ?? existing.driverName).trim(),
      driverPhone: nextDriverPhone,
      vehicleId: String(req.body?.vehicleId ?? existing.vehicleId).trim(),
      plateNumber: String(req.body?.plateNumber ?? existing.plateNumber)
        .trim()
        .toUpperCase(),
      vehicleType: String(req.body?.vehicleType ?? existing.vehicleType).trim(),
      originId: String(req.body?.originId ?? existing.originId ?? '').trim(),
      origin:
        String(req.body?.origin ?? existing.origin).trim() ||
        'Menunggu Titik Keberangkatan Driver',
      routeId: String(req.body?.routeId ?? existing.routeId).trim(),
      destination: String(req.body?.destination ?? existing.destination).trim(),
      purpose: String(req.body?.purpose ?? existing.purpose).trim(),
      beratMuatan:
        req.body?.beratMuatan !== undefined
          ? String(req.body.beratMuatan || '').trim() || undefined
          : existing.beratMuatan,
      volumeCbm:
        req.body?.volumeCbm !== undefined
          ? String(req.body.volumeCbm || '').trim() || undefined
          : existing.volumeCbm,
      status: nextStatus,
      notes: String(req.body?.notes ?? existing.notes).trim(),
    };

    let depUpdated = false;
    if (req.body?.kmAwal !== undefined && req.body?.kmAwal !== '') {
      depUpdated = true;
      const updatedJenisKendaraan: 'Mobil Pendingin' | 'Non Pendingin' =
        req.body?.jenisKendaraan === 'Non Pendingin' ||
        (req.body?.jenisKendaraan === undefined &&
          existing.departureData?.jenisKendaraan === 'Non Pendingin')
          ? 'Non Pendingin'
          : 'Mobil Pendingin';
      const updatedTitik =
        String(
          req.body?.titikKeberangkatan ??
            req.body?.origin ??
            existing.departureData?.titikKeberangkatan ??
            updated.origin
        ).trim() || updated.origin;
      updated.origin = updatedTitik;
      updated.departureData = {
        timestamp: existing.departureData?.timestamp || new Date().toISOString(),
        titikKeberangkatan: updatedTitik,
        jenisKendaraan: updatedJenisKendaraan,
        kmAwal: Number(req.body.kmAwal) || 0,
        suhuAwal:
          updatedJenisKendaraan === 'Mobil Pendingin'
            ? String(
                req.body?.suhuAwal ?? existing.departureData?.suhuAwal ?? ''
              )
            : '',
        bbmAwal: String(
          req.body?.bbmAwal ?? existing.departureData?.bbmAwal ?? 'Penuh'
        ),
        kondisiKendaraan: String(
          req.body?.kondisiKendaraan ??
            existing.departureData?.kondisiKendaraan ??
            (updatedJenisKendaraan === 'Mobil Pendingin'
              ? 'Pendingin Normal'
              : 'Unit Kendaraan Normal & Siap Jalan')
        ),
        catatanBerangkat: String(
          req.body?.catatanBerangkat ??
            existing.departureData?.catatanBerangkat ??
            ''
        ),
        fotoOdometerBerangkat: existing.departureData?.fotoOdometerBerangkat,
        fotoSuhuBerangkat:
          updatedJenisKendaraan === 'Mobil Pendingin'
            ? existing.departureData?.fotoSuhuBerangkat
            : undefined,
      };
    } else if (existing.departureData && req.body?.origin !== undefined) {
      const nextTitik = String(req.body.origin || '').trim();
      if (nextTitik) {
        updated.departureData = {
          ...existing.departureData,
          titikKeberangkatan: nextTitik,
        };
      }
    }

    let hoUpdated = false;
    if (req.body?.kmAkhir !== undefined && req.body?.kmAkhir !== '') {
      hoUpdated = true;
      updated.handoverData = {
        timestamp: existing.handoverData?.timestamp || new Date().toISOString(),
        kmAkhir: Number(req.body.kmAkhir) || 0,
        suhuAkhir: String(
          req.body?.suhuAkhir ?? existing.handoverData?.suhuAkhir ?? ''
        ),
        bbmAkhir: String(
          req.body?.bbmAkhir ?? existing.handoverData?.bbmAkhir ?? '1/2'
        ),
        penerimaNama: String(
          req.body?.penerimaNama ?? existing.handoverData?.penerimaNama ?? ''
        ),
        kondisiAkhir: String(
          req.body?.kondisiAkhir ??
            existing.handoverData?.kondisiAkhir ??
            'Rantai Dingin Terjaga'
        ),
        catatanSerahTerima: String(
          req.body?.catatanSerahTerima ??
            existing.handoverData?.catatanSerahTerima ??
            ''
        ),
        fotoOdometerSerahTerima: existing.handoverData?.fotoOdometerSerahTerima,
        fotoSuhuSerahTerima: existing.handoverData?.fotoSuhuSerahTerima,
        fotoBuktiSerahTerima: existing.handoverData?.fotoBuktiSerahTerima,
        tandaTanganPenerima: existing.handoverData?.tandaTanganPenerima,
      };
    }

    const vehicleIdx = store.vehicles.findIndex(
      (v) =>
        v.id.toLowerCase() === updated.vehicleId.toLowerCase() ||
        v.plateNumber.toLowerCase() === updated.plateNumber.toLowerCase()
    );
    if (vehicleIdx !== -1) {
      if (updated.status === 'Handover' || updated.status === 'Selesai') {
        store.vehicles[vehicleIdx].status = 'Siap Jalan';
      } else if (
        updated.status === 'Dalam Perjalanan' ||
        updated.status === 'Delivered'
      ) {
        store.vehicles[vehicleIdx].status = 'Dalam Tugas';
      }
    }

    updated.needsSheetSync = true;
    store.assignments[idx] = updated;
    saveStore(store);

    let notification: NotificationRecord | undefined;
    const statusOrDataChanged =
      previousStatus !== updated.status ||
      depUpdated ||
      hoUpdated ||
      existing.driverId !== updated.driverId ||
      existing.plateNumber !== updated.plateNumber ||
      existing.destination !== updated.destination ||
      existing.tanggalTugas !== updated.tanggalTugas ||
      (existing.jadwalJamTiba || '') !== (updated.jadwalJamTiba || '') ||
      (existing.beratMuatan || '') !== (updated.beratMuatan || '') ||
      (existing.volumeCbm || '') !== (updated.volumeCbm || '') ||
      existing.notes !== updated.notes ||
      existing.kodeSegel !== updated.kodeSegel ||
      existing.noSuratJalanFisik !== updated.noSuratJalanFisik;

    if (statusOrDataChanged) {
      const eventType: NotificationRecord['eventType'] =
        updated.status === 'Handover' || updated.status === 'Selesai'
          ? 'SERAH_TERIMA'
          : updated.status === 'Delivered'
          ? 'DELIVERED'
          : updated.status === 'Dalam Perjalanan'
          ? 'KEBERANGKATAN'
          : 'SURAT_TUGAS';
      const routeObj = store.routes.find((r) => r.id === updated.routeId);
      const waMessage = formatDriverRealtimeWhatsAppMessage(
        updated,
        eventType,
        store.whatsappGroupName
      );
      const updateSummary =
        previousStatus !== updated.status
          ? `Status penugasan ${updated.noPenugasan} (${updated.driverName} · ${updated.plateNumber}) diperbarui ke ${updated.status}.`
          : `Detail penugasan ${updated.noPenugasan} (${updated.plateNumber} menuju ${updated.destination}) diperbarui oleh Dispatcher.`;
      notification = await dispatchWhatsAppNetwork({
        eventType,
        noPenugasan: updated.noPenugasan,
        assignmentId: updated.id,
        destination: updated.destination,
        actorRole: 'ADMIN',
        summary: updateSummary,
        readByAdmin: false,
        readByDriver: false,
        driverId: updated.driverId,
        driverName: updated.driverName,
        plateNumber: updated.plateNumber,
        driverPhone: updated.driverPhone,
        targets: [
          updated.driverPhone,
          store.dispatcherWaPhone,
          routeObj?.picPhone || '',
        ].filter(Boolean),
        message: waMessage,
      });
    }

    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'assignment:updated',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
      previousStatus,
      assignment: updated,
      notification,
    });

    res.json({
      success: true,
      assignment: updated,
      notification,
      state: publicState,
    });
  });

  app.delete('/api/assignments/:id', async (req, res) => {
    const targetId = String(req.params.id || '').trim();
    const deletedAssignment = store.assignments.find((a) => a.id !== '' && a.id === targetId);
    if (!deletedAssignment) {
      res.status(404).json({ error: 'Surat Tugas tidak ditemukan.' });
      return;
    }
    store.assignments = store.assignments.filter((a) => a.id !== targetId);
    addDeletedTombstones('assignments', [
      deletedAssignment.id,
      deletedAssignment.noPenugasan,
    ]);
    store.syncedAssignmentNos = (store.syncedAssignmentNos || []).filter(
      (no) => normalizeSyncKey(no) !== normalizeSyncKey(deletedAssignment.noPenugasan)
    );
    store.pendingAssignmentDeletionPush = true;
    if (store.assignments.length === 0) {
      store.lastSequence = 0;
    }
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'assignment:deleted',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
      deletedAssignmentId: targetId,
    });
    res.json({
      success: true,
      state: publicState,
    });
  });

  // Role Driver: Submit Cold Chain Departure Data + Real-time Timestamp + Photos + Automatic WA
  app.post('/api/assignments/:id/departure', async (req, res) => {
    const targetId = String(req.params.id || '').trim();
    let idx = store.assignments.findIndex((a) => a.id === targetId);
    if (idx === -1 && req.body?.assignmentSnapshot) {
      idx = hydrateMissingAssignmentSnapshot(req.body.assignmentSnapshot);
    }
    if (idx === -1) {
      res.status(404).json({ error: 'Surat Tugas tidak ditemukan.' });
      return;
    }

    const assignment = store.assignments[idx];
    const previousStatus = assignment.status;
    const titikKeberangkatan = String(
      req.body?.titikKeberangkatan || ''
    ).trim();
    const jenisKendaraan: 'Mobil Pendingin' | 'Non Pendingin' =
      req.body?.jenisKendaraan === 'Non Pendingin'
        ? 'Non Pendingin'
        : 'Mobil Pendingin';
    const isPendingin = jenisKendaraan === 'Mobil Pendingin';

    const kmAwal = Number(req.body?.kmAwal);
    const suhuAwal = isPendingin ? String(req.body?.suhuAwal || '').trim() : '';
    const bbmAwal = String(req.body?.bbmAwal || 'Penuh (Full)').trim();
    const kondisiKendaraan = String(
      req.body?.kondisiKendaraan ||
        (isPendingin
          ? 'Thermo Pendingin Normal'
          : 'Unit Kendaraan Normal & Siap Jalan')
    ).trim();
    const catatanBerangkat = String(req.body?.catatanBerangkat || '').trim();
    const fotoOdometerBerangkat = String(
      req.body?.fotoOdometerBerangkat || ''
    ).trim();
    const fotoSuhuBerangkat = isPendingin
      ? String(req.body?.fotoSuhuBerangkat || '').trim()
      : '';

    if (!titikKeberangkatan) {
      res.status(400).json({
        error: 'Titik Keberangkatan Driver wajib diisi pada formulir keberangkatan.',
      });
      return;
    }

    if (!Number.isFinite(kmAwal) || kmAwal < 0) {
      res
        .status(400)
        .json({ error: 'Odometer KM Awal wajib diisi dengan angka valid.' });
      return;
    }

    if (isPendingin && !suhuAwal) {
      res.status(400).json({
        error:
          'Suhu Monitor Keberangkatan wajib diisi manual untuk Mobil Pendingin.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    assignment.driverPhone = resolveDriverPhone(
      assignment.driverId,
      assignment.driverPhone
    );
    assignment.origin = titikKeberangkatan;
    assignment.status = 'Dalam Perjalanan';
    assignment.departureData = {
      timestamp: nowIso,
      titikKeberangkatan,
      jenisKendaraan,
      kmAwal,
      suhuAwal,
      bbmAwal,
      kondisiKendaraan,
      catatanBerangkat,
      fotoOdometerBerangkat: fotoOdometerBerangkat || undefined,
      fotoSuhuBerangkat: isPendingin && fotoSuhuBerangkat ? fotoSuhuBerangkat : undefined,
    };
    if (assignment.driveMedia && (fotoOdometerBerangkat || fotoSuhuBerangkat)) {
      assignment.driveMedia = {
        ...assignment.driveMedia,
        fotoOdometerBerangkatUrl: fotoOdometerBerangkat
          ? undefined
          : assignment.driveMedia.fotoOdometerBerangkatUrl,
        fotoSuhuBerangkatUrl: fotoSuhuBerangkat
          ? undefined
          : assignment.driveMedia.fotoSuhuBerangkatUrl,
      };
    }
    assignment.needsSheetSync = true;

    const vehicleIdx = store.vehicles.findIndex(
      (v) =>
        v.id.toLowerCase() === assignment.vehicleId.toLowerCase() ||
        v.plateNumber.toLowerCase() === assignment.plateNumber.toLowerCase()
    );
    if (vehicleIdx !== -1) {
      store.vehicles[vehicleIdx].status = 'Dalam Tugas';
    }

    saveStore(store);

    const routeObj = store.routes.find((r) => r.id === assignment.routeId);
    const targets = [
      assignment.driverPhone,
      store.dispatcherWaPhone,
      routeObj?.picPhone || '',
    ].filter(Boolean);

    const waMessage = formatDriverRealtimeWhatsAppMessage(
      assignment,
      'KEBERANGKATAN',
      store.whatsappGroupName
    );

    const notification = await dispatchWhatsAppNetwork({
      eventType: 'KEBERANGKATAN',
      noPenugasan: assignment.noPenugasan,
      assignmentId: assignment.id,
      destination: assignment.destination,
      actorRole: 'DRIVER',
      summary: `${assignment.driverName} (${assignment.plateNumber}) mulai berangkat dari ${titikKeberangkatan} menuju ${assignment.destination} (KM ${kmAwal.toLocaleString('id-ID')}${suhuAwal ? `, Suhu ${suhuAwal}` : ''}).`,
      readByAdmin: false,
      driverId: assignment.driverId,
      driverName: assignment.driverName,
      plateNumber: assignment.plateNumber,
      driverPhone: assignment.driverPhone,
      targets,
      message: waMessage,
    });

    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'assignment:updated',
      clientId: getRequestClientId(req),
      actorRole: 'DRIVER',
      previousStatus,
      assignment,
      notification,
    });

    res.json({
      success: true,
      assignment,
      notification,
      state: publicState,
    });
  });

  // Role Driver: Confirm Arrival at Destination ('Delivered') + Real-Time Admin Toast & Driver WA
  app.post('/api/assignments/:id/delivered', async (req, res) => {
    const targetId = String(req.params.id || '').trim();
    let idx = store.assignments.findIndex((a) => a.id === targetId);
    if (idx === -1 && req.body?.assignmentSnapshot) {
      idx = hydrateMissingAssignmentSnapshot(req.body.assignmentSnapshot);
    }
    if (idx === -1) {
      res.status(404).json({ error: 'Surat Tugas tidak ditemukan.' });
      return;
    }

    const assignment = store.assignments[idx];
    const previousStatus = assignment.status;
    const catatanTiba = String(req.body?.catatanTiba || '').trim();
    const nowIso = new Date().toISOString();

    assignment.driverPhone = resolveDriverPhone(
      assignment.driverId,
      assignment.driverPhone
    );
    assignment.status = 'Delivered';
    assignment.deliveredAt = nowIso;
    if (catatanTiba) {
      assignment.notes = assignment.notes
        ? `${assignment.notes} | Tiba: ${catatanTiba}`
        : `Tiba: ${catatanTiba}`;
    }
    assignment.needsSheetSync = true;

    saveStore(store);

    const routeObj = store.routes.find((r) => r.id === assignment.routeId);
    const targets = [
      assignment.driverPhone,
      store.dispatcherWaPhone,
      routeObj?.picPhone || '',
    ].filter(Boolean);

    const waMessage = formatDriverRealtimeWhatsAppMessage(
      assignment,
      'DELIVERED',
      store.whatsappGroupName
    );

    const notification = await dispatchWhatsAppNetwork({
      eventType: 'DELIVERED',
      noPenugasan: assignment.noPenugasan,
      assignmentId: assignment.id,
      destination: assignment.destination,
      actorRole: 'DRIVER',
      summary: `${assignment.driverName} (${assignment.plateNumber}) telah tiba di lokasi tujuan ${assignment.destination}.`,
      readByAdmin: false,
      driverId: assignment.driverId,
      driverName: assignment.driverName,
      plateNumber: assignment.plateNumber,
      driverPhone: assignment.driverPhone,
      targets,
      message: waMessage,
    });

    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'assignment:updated',
      clientId: getRequestClientId(req),
      actorRole: 'DRIVER',
      previousStatus,
      assignment,
      notification,
    });

    res.json({
      success: true,
      assignment,
      notification,
      state: publicState,
    });
  });

  // Role Driver: Submit Cold Chain Handover Data ('Handover') + Real-time Timestamp + Photos + Signature + Automatic WA
  app.post('/api/assignments/:id/handover', async (req, res) => {
    const targetId = String(req.params.id || '').trim();
    let idx = store.assignments.findIndex((a) => a.id === targetId);
    if (idx === -1 && req.body?.assignmentSnapshot) {
      idx = hydrateMissingAssignmentSnapshot(req.body.assignmentSnapshot);
    }
    if (idx === -1) {
      res.status(404).json({ error: 'Surat Tugas tidak ditemukan.' });
      return;
    }

    const assignment = store.assignments[idx];
    const previousStatus = assignment.status;
    const effectiveJenisKendaraan: 'Mobil Pendingin' | 'Non Pendingin' =
      assignment.departureData?.jenisKendaraan === 'Non Pendingin' ||
      (assignment.departureData?.jenisKendaraan === undefined &&
        req.body?.jenisKendaraan === 'Non Pendingin')
        ? 'Non Pendingin'
        : 'Mobil Pendingin';
    const isPendingin = effectiveJenisKendaraan === 'Mobil Pendingin';

    const kmAkhir = Number(req.body?.kmAkhir);
    const suhuAkhir = isPendingin
      ? String(req.body?.suhuAkhir || '').trim()
      : '';
    const bbmAkhir = String(req.body?.bbmAkhir || '1/2 Tangki').trim();
    const penerimaNama = String(req.body?.penerimaNama || '').trim();
    const kondisiAkhir = String(
      req.body?.kondisiAkhir ||
        (isPendingin
          ? 'Suhu & Segel Utuh - Lengkap'
          : 'Segel & Muatan Utuh - Lengkap')
    ).trim();
    const catatanSerahTerima = String(
      req.body?.catatanSerahTerima || ''
    ).trim();
    const fotoOdometerSerahTerima = String(
      req.body?.fotoOdometerSerahTerima || ''
    ).trim();
    const fotoSuhuSerahTerima = isPendingin
      ? String(req.body?.fotoSuhuSerahTerima || '').trim()
      : '';
    const fotoBuktiSerahTerima = String(
      req.body?.fotoBuktiSerahTerima || ''
    ).trim();
    const tandaTanganPenerima = String(
      req.body?.tandaTanganPenerima || ''
    ).trim();

    if (!Number.isFinite(kmAkhir) || kmAkhir < 0) {
      res
        .status(400)
        .json({ error: 'Odometer KM Akhir wajib diisi dengan angka valid.' });
      return;
    }

    const kmAwal = assignment.departureData?.kmAwal ?? 0;
    if (kmAwal > 0 && kmAkhir < kmAwal) {
      res.status(400).json({
        error: `KM Akhir (${kmAkhir}) tidak boleh lebih kecil dari KM Awal (${kmAwal}).`,
      });
      return;
    }

    if (!penerimaNama) {
      res.status(400).json({ error: 'Nama Penerima Serah Terima wajib diisi.' });
      return;
    }

    if (isPendingin && !suhuAkhir) {
      res.status(400).json({
        error:
          'Suhu Monitor Serah Terima wajib diisi manual untuk Mobil Pendingin.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    assignment.driverPhone = resolveDriverPhone(
      assignment.driverId,
      assignment.driverPhone
    );
    assignment.status = 'Handover';
    if (!assignment.deliveredAt) {
      assignment.deliveredAt = nowIso;
    }
    if (assignment.departureData && !assignment.departureData.jenisKendaraan) {
      assignment.departureData.jenisKendaraan = effectiveJenisKendaraan;
    }
    assignment.handoverData = {
      timestamp: nowIso,
      kmAkhir,
      suhuAkhir,
      bbmAkhir,
      penerimaNama,
      kondisiAkhir,
      catatanSerahTerima,
      fotoOdometerSerahTerima: fotoOdometerSerahTerima || undefined,
      fotoSuhuSerahTerima:
        isPendingin && fotoSuhuSerahTerima ? fotoSuhuSerahTerima : undefined,
      fotoBuktiSerahTerima: fotoBuktiSerahTerima || undefined,
      tandaTanganPenerima: tandaTanganPenerima || undefined,
    };
    if (
      assignment.driveMedia &&
      (fotoOdometerSerahTerima ||
        fotoSuhuSerahTerima ||
        fotoBuktiSerahTerima ||
        tandaTanganPenerima)
    ) {
      assignment.driveMedia = {
        ...assignment.driveMedia,
        fotoOdometerSerahTerimaUrl: fotoOdometerSerahTerima
          ? undefined
          : assignment.driveMedia.fotoOdometerSerahTerimaUrl,
        fotoSuhuSerahTerimaUrl: fotoSuhuSerahTerima
          ? undefined
          : assignment.driveMedia.fotoSuhuSerahTerimaUrl,
        fotoBuktiSerahTerimaUrl: fotoBuktiSerahTerima
          ? undefined
          : assignment.driveMedia.fotoBuktiSerahTerimaUrl,
        tandaTanganPenerimaUrl: tandaTanganPenerima
          ? undefined
          : assignment.driveMedia.tandaTanganPenerimaUrl,
      };
    }
    assignment.needsSheetSync = true;

    const vehicleIdx = store.vehicles.findIndex(
      (v) =>
        v.id.toLowerCase() === assignment.vehicleId.toLowerCase() ||
        v.plateNumber.toLowerCase() === assignment.plateNumber.toLowerCase()
    );
    if (vehicleIdx !== -1) {
      store.vehicles[vehicleIdx].status = 'Siap Jalan';
    }

    saveStore(store);

    const routeObj = store.routes.find((r) => r.id === assignment.routeId);
    const targets = [
      assignment.driverPhone,
      store.dispatcherWaPhone,
      routeObj?.picPhone || '',
    ].filter(Boolean);

    const waMessage = formatDriverRealtimeWhatsAppMessage(
      assignment,
      'SERAH_TERIMA',
      store.whatsappGroupName
    );

    const notification = await dispatchWhatsAppNetwork({
      eventType: 'SERAH_TERIMA',
      noPenugasan: assignment.noPenugasan,
      assignmentId: assignment.id,
      destination: assignment.destination,
      actorRole: 'DRIVER',
      summary: `Serah terima muatan ${assignment.plateNumber} oleh ${assignment.driverName} kepada ${penerimaNama} di ${assignment.destination} selesai.`,
      readByAdmin: false,
      driverId: assignment.driverId,
      driverName: assignment.driverName,
      plateNumber: assignment.plateNumber,
      driverPhone: assignment.driverPhone,
      targets,
      message: waMessage,
    });

    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'assignment:updated',
      clientId: getRequestClientId(req),
      actorRole: 'DRIVER',
      previousStatus,
      assignment,
      notification,
    });

    res.json({
      success: true,
      assignment,
      notification,
      state: publicState,
    });
  });

  app.post('/api/whatsapp/test', async (req, res) => {
    const target = String(
      req.body?.targetPhone || store.dispatcherWaPhone || ''
    ).trim();

    const message = [
      '*[CRK LOGISTIK DELIVERY SISTEM — UJI PESAN WHATSAPP REAL-TIME]*',
      `Waktu Pesan WA : ${formatWibTimestamp()}`,
      store.whatsappGroupName
        ? `Grup Operasional : ${store.whatsappGroupName}`
        : '',
      'Status : Notifikasi otomatis WhatsApp Driver (Data Keberangkatan & Serah Terima) serta Grup siap digunakan.',
    ]
      .filter(Boolean)
      .join('\n');

    const notification = await dispatchWhatsAppNetwork({
      eventType: 'UJI_JARINGAN',
      noPenugasan: '-',
      actorRole: 'ADMIN',
      summary: 'Uji jaringan pesan WhatsApp real-time oleh Admin Dispatcher.',
      readByAdmin: true,
      driverId: 'ADMIN',
      driverName: 'Admin Dispatcher',
      plateNumber: '-',
      targets: target ? [target] : [],
      message,
    });

    const publicState = broadcastRealtime({
      type: 'whatsapp:dispatched',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
      notification,
    });

    res.json({
      success: true,
      notification,
      state: publicState,
    });
  });

  // Mark In-App Real-Time Notifications as Read for Admin Dispatcher or Driver
  app.put('/api/notifications/read', (req, res) => {
    const ids = Array.isArray(req.body?.ids)
      ? req.body.ids
          .map((id: unknown) => String(id || '').trim())
          .filter(Boolean)
      : [];
    const markAll = Boolean(req.body?.markAll);
    const readerRole: 'ADMIN' | 'DRIVER' =
      req.body?.readerRole === 'DRIVER' ? 'DRIVER' : 'ADMIN';
    const normDriverId = String(req.body?.driverId || '')
      .trim()
      .toLowerCase();
    const nowIso = new Date().toISOString();
    const idSet = new Set<string>(ids);
    let updatedCount = 0;

    store.notifications = store.notifications.map((n) => {
      if (readerRole === 'DRIVER') {
        const belongsToDriver =
          !normDriverId || n.driverId.trim().toLowerCase() === normDriverId;
        if (
          belongsToDriver &&
          (markAll || idSet.has(n.id)) &&
          !n.readByDriver
        ) {
          updatedCount += 1;
          return {
            ...n,
            readByDriver: true,
            driverReadAt: nowIso,
          };
        }
        return n;
      }

      if ((markAll || idSet.has(n.id)) && !n.readByAdmin) {
        updatedCount += 1;
        return {
          ...n,
          readByAdmin: true,
          readAt: nowIso,
        };
      }
      return n;
    });

    if (updatedCount > 0) {
      saveStore(store, true);
      const publicState = broadcastRealtime({
        type: 'state:sync',
        clientId: getRequestClientId(req),
        actorRole: readerRole,
      });
      res.json({ success: true, updatedCount, state: publicState });
      return;
    }

    res.json({ success: true, updatedCount: 0, state: buildPublicState() });
  });

  // Clean Reset: Wipe all Surat Tugas & operational notifications while preserving Master Data & Config
  app.post('/api/system/reset', (req, res) => {
    const tombstoneKeys: string[] = [
      'asg-1793341807277-1',
      'asg-1793343367383-2',
      'st-crk/2026/10/0001',
      'st-crk/2026/10/0002',
    ];
    for (const a of store.assignments) {
      if (a.id) tombstoneKeys.push(a.id);
      if (a.noPenugasan) tombstoneKeys.push(a.noPenugasan);
    }
    addDeletedTombstones('assignments', tombstoneKeys);
    store.assignments = [];
    store.notifications = [];
    store.syncedAssignmentNos = [];
    store.lastSequence = 0;
    store.pendingAssignmentDeletionPush = true;
    store.vehicles = store.vehicles.map((v) =>
      v.status === 'Dalam Tugas' ? { ...v, status: 'Siap Jalan' } : v
    );
    saveStore(store);
    triggerServerAppsScriptPushIfConfigured();

    const publicState = broadcastRealtime({
      type: 'state:sync',
      clientId: getRequestClientId(req),
      actorRole: 'ADMIN',
    });

    res.json({
      success: true,
      state: publicState,
    });
  });

  // Guarantee unmatched /api/* routes NEVER fall through to Vite SPA or index.html (`<!doctype html>`)
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: `Endpoint API tidak ditemukan: ${req.method} ${req.originalUrl}`,
    });
  });

  // Guarantee body-parser errors (e.g. 413 PayloadTooLarge, malformed JSON) on /api/* ALWAYS return JSON instead of HTML
  app.use(
    (
      err: Error & { status?: number; statusCode?: number; type?: string },
      req: express.Request,
      res: express.Response,
      next: express.NextFunction
    ) => {
      if (req.originalUrl.startsWith('/api')) {
        const status =
          err.status ||
          err.statusCode ||
          (err.type === 'entity.too.large' ? 413 : 500);
        res.status(status).json({
          error:
            status === 413
              ? 'Ukuran data laporan/sinkronisasi terlalu besar (melewati batas 50MB).'
              : err.message || 'Kesalahan internal server API.',
        });
        return;
      }
      next(err);
    }
  );

  // Serve clean Service Worker directly for both /sw.js and legacy /dev-sw.js so browsers self-heal instantly
  app.get(['/sw.js', '/dev-sw.js'], (_req, res) => {
    const publicSwPath = path.join(__dirname, 'public', 'sw.js');
    const distSwPath = path.join(process.cwd(), 'dist', 'sw.js');
    const swFilePath = fs.existsSync(publicSwPath) ? publicSwPath : distSwPath;
    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
    res.setHeader('Service-Worker-Allowed', '/');
    if (fs.existsSync(swFilePath)) {
      res.sendFile(swFilePath);
      return;
    }
    res
      .status(200)
      .send(
        "self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',(e)=>e.waitUntil(self.clients.claim()));self.addEventListener('fetch',()=>{});"
      );
  });

  // Ensure /driver or /driver/... routes always serve the SPA entry cleanly without 404
  app.use((req, _res, next) => {
    if (
      req.method === 'GET' &&
      (req.path === '/driver' || req.path.startsWith('/driver/'))
    ) {
      const qIdx = req.url.indexOf('?');
      req.url = '/' + (qIdx !== -1 ? req.url.slice(qIdx) : '');
    }
    next();
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const hmrDisabled =
      process.env.DISABLE_HMR === 'true' ||
      Boolean(process.env.APP_URL) ||
      Boolean(process.env.K_SERVICE);
    const vite = await createViteServer({
      plugins: [
        {
          name: 'suppress-disabled-hmr-websocket',
          enforce: 'post',
          transform(code, id) {
            if (!id.includes('vite/dist/client/client.mjs')) return null;
            if (hmrDisabled) {
              return {
                code: code
                  .replace(
                    'console.debug("[vite] connecting...");',
                    '/* HMR disabled in Cloud Run / AI Studio */'
                  )
                  .replace(
                    'const createWebSocketModuleRunnerTransport = (options) => {',
                    'const createWebSocketModuleRunnerTransport = () => ({ async connect() {}, disconnect() {}, send() {} }); const _unusedWsTransport = (options) => {'
                  ),
                map: null,
              };
            }
            return {
              code: code.replace(
                'transport.connect(createHMRHandler(handleMessage));',
                'Promise.resolve(transport.connect(createHMRHandler(handleMessage))).catch(() => {});'
              ),
              map: null,
            };
          },
        },
      ],
      server: {
        middlewareMode: true,
        ws: hmrDisabled ? false : undefined,
        hmr: hmrDisabled ? false : { server: httpServer, path: '/__vite_hmr' },
        watch: hmrDisabled ? null : {},
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(
      `CRK Logistik Delivery Sistem (HTTP + WS /ws) listening on http://localhost:${PORT}`
    );
  });
}

startServer();
