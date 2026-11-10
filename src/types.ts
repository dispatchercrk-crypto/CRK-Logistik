export enum TaskStatus {
  MENUNGGU_BERANGKAT = 'Menunggu Berangkat',
  DALAM_PERJALANAN = 'Dalam Perjalanan',
  DELIVERED = 'Delivered',
  HANDOVER = 'Handover',
  SELESAI = 'Selesai',
}

export function isCompletedTaskStatus(
  status?: TaskStatus | string,
  hasHandoverData = false
): boolean {
  if (hasHandoverData) return true;
  const norm = String(status || '')
    .trim()
    .toLowerCase();
  return norm === 'handover' || norm === 'selesai';
}

export function isActiveTaskStatus(
  status?: TaskStatus | string,
  hasHandoverData = false
): boolean {
  if (isCompletedTaskStatus(status, hasHandoverData)) return false;
  const norm = String(status || '')
    .trim()
    .toLowerCase();
  return (
    norm === 'menunggu berangkat' ||
    norm === 'dalam perjalanan' ||
    norm === 'delivered'
  );
}

export enum UserRole {
  DRIVER = 'DRIVER',
  ADMIN = 'ADMIN',
  ADMIN_VIEW = 'ADMIN_VIEW',
}

export interface AdminViewMaster {
  id: string; // ID Admin View, e.g. AV-001
  name: string; // Nama / Label Admin View (e.g. Manajemen Logistik)
  pin: string; // PIN Admin View (dapat diubah oleh Admin Dispatcher)
  active: boolean; // Status Aktif
  description?: string; // Keterangan hak akses (e.g. Viewer Dashboard Monitoring Saja)
  createdAt?: string;
  updatedAt?: string;
}

export type WhatsAppTargetMode = 'GROUP' | 'DIRECT' | 'DRIVER';

export type VehicleCoolingType = 'Mobil Pendingin' | 'Non Pendingin';

export type WhatsAppEventType =
  | 'SURAT_TUGAS'
  | 'KEBERANGKATAN'
  | 'DELIVERED'
  | 'SERAH_TERIMA'
  | 'UJI_JARINGAN';

export interface DriverMaster {
  id: string; // ID Driver, e.g. DRV-001
  name: string;
  phone: string;
  pin: string;
  licenseType: string;
  active: boolean;
}

export interface VehicleMaster {
  id: string; // Kode Unit, e.g. UNT-001
  plateNumber: string;
  vehicleType: string;
  capacity: string;
  capacityCbm?: string;
  status: 'Siap Jalan' | 'Dalam Tugas' | 'Perawatan';
}

export interface RouteMaster {
  id: string; // Kode Rute / Tujuan, e.g. RT-001
  destination: string;
  picName: string;
  picPhone: string;
}

export interface FleetCardMaster {
  id: string; // ID Fleet Card, e.g. FC-001
  cardNumber: string; // Nomor Kartu Fleet Card
  balance: number; // Saldo Fleet Card (IDR)
  updatedAt?: string;
  needsSheetSync?: boolean;
}

export interface DriverExpense {
  id: string; // ID Pengeluaran, e.g. EXP-176...
  timestamp: string; // Timestamp Otomatis saat Driver menekan Selesai dan Laporkan
  tanggal: string; // YYYY-MM-DD (Tanggal Laporan)
  tanggalPengiriman?: string; // YYYY-MM-DD (Tanggal Pengiriman)
  tujuanPengiriman?: string; // Tujuan Pengiriman
  driverId: string;
  driverName: string;
  plateNumber?: string;
  completedAssignmentNos?: string;
  fleetCardId: string;
  fleetCardNumber: string; // Nomor Kartu Fleet Card yang digunakan
  totalPengirimanBbm: number; // Total Pembelian BBM (IDR)
  fotoStrukBbm?: string; // Local/Server compressed data URI (stripped before Firestore/localStorage)
  fotoStrukBbmUrl?: string; // Google Drive link
  totalPengeluaranTol: number; // Total Pengeluaran Tol (IDR)
  fotoStrukTol?: string; // Local/Server compressed data URI (stripped before Firestore/localStorage)
  fotoStrukTolUrl?: string; // Google Drive link
  totalPengeluaran: number; // totalPengirimanBbm + totalPengeluaranTol
  catatan?: string;
  ownerUid?: string;
  submittedByDriverUid?: string;
  needsSheetSync?: boolean;
}

export interface DepartureReport {
  timestamp: string;
  titikKeberangkatan?: string;
  jenisKendaraan?: VehicleCoolingType;
  kmAwal: number;
  suhuAwal: string;
  bbmAwal: string;
  kondisiKendaraan: string;
  catatanBerangkat: string;
  fotoOdometerBerangkat?: string;
  fotoSuhuBerangkat?: string;
}

export interface DeliveredReport {
  timestamp: string;
  jenisKendaraan?: VehicleCoolingType;
  kmSampai: number;
  suhuSampai: string;
  bbmSampai: string;
  kondisiSampai: string;
  catatanSampai?: string;
  fotoOdometerSampai?: string;
  fotoSuhuSampai?: string;
}

export interface HandoverReport {
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

export interface DriveMediaLinks {
  folderId?: string;
  folderUrl?: string;
  syncedAt?: string;
  fotoOdometerBerangkatUrl?: string;
  fotoSuhuBerangkatUrl?: string;
  fotoOdometerSerahTerimaUrl?: string;
  fotoSuhuSerahTerimaUrl?: string;
  fotoBuktiSerahTerimaUrl?: string;
  tandaTanganPenerimaUrl?: string;
}

export interface Assignment {
  id: string;
  sequenceNumber: number;
  noPenugasan: string;
  noSuratJalanFisik: string;
  kodeSegel: string;
  createdAt: string;
  tanggalTugas: string;
  jadwalJamTiba?: string; // Optional HH:mm target SLA on tanggalTugas
  slaDurationMinutes?: number; // Batas Waktu Standar SLA Countdown (Default: 210 menit / 3.5 Jam)
  deliveredAt?: string;
  driverId: string;
  driverCode?: string;
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
  status: TaskStatus;
  departureData?: DepartureReport;
  deliveredData?: DeliveredReport;
  handoverData?: HandoverReport;
  driveFolderUrl?: string;
  driveMedia?: DriveMediaLinks;
  notes: string;
  ownerUid?: string;
  submittedByDriverUid?: string;
  needsSheetSync?: boolean;
}

export interface WhatsAppNotificationLog {
  id: string;
  timestamp: string;
  eventType: WhatsAppEventType;
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

export interface AppConfig {
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  appsScriptUrl?: string;
  appsScriptBridgeStatus?:
    | 'ACTIVE'
    | 'NEEDS_SCRIPT_UPDATE'
    | 'AUTH_BLOCKED_HTML'
    | 'ERROR'
    | 'NONE';
  serviceAccountConfigured?: boolean;
  serviceAccountEmail?: string;
  serviceAccountStatus?:
    | 'ACTIVE'
    | 'NOT_CONFIGURED'
    | 'PERMISSION_NEEDED'
    | 'ERROR';
  serviceAccountLastError?: string;
  serverSheetSyncMode?:
    | 'SERVICE_ACCOUNT_24_7'
    | 'APPS_SCRIPT_24_7'
    | 'LIVE_CSV_AND_OAUTH'
    | 'OAUTH_AUTO';
  driveRootFolderId?: string;
  driveRootFolderUrl?: string;
  publicPortalBaseUrl?: string;
  lastSyncedAt: string | null;
  dispatcherWaPhone: string;
  whatsappTargetMode: WhatsAppTargetMode;
  whatsappGroupName: string;
  whatsappGroupInviteUrl: string;
  letterPrefix: string;
  lastSequence: number;
  isDefaultPin: boolean;
  adminPin?: string;
  whatsappGatewayConfigured: boolean;
  wasIntentionallyCleared?: boolean;
}

export interface AppStateResponse {
  drivers: DriverMaster[];
  vehicles: VehicleMaster[];
  routes: RouteMaster[];
  fleetCards: FleetCardMaster[];
  driverExpenses: DriverExpense[];
  assignments: Assignment[];
  notifications: WhatsAppNotificationLog[];
  config: AppConfig;
  adminViews?: AdminViewMaster[];
}

export interface ToastMessage {
  id: string;
  type: 'success' | 'error' | 'info';
  title: string;
  description?: string;
  actionLabel?: string;
  actionHref?: string;
}

export type RealtimeEventType =
  | 'state:init'
  | 'state:sync'
  | 'assignment:created'
  | 'assignment:updated'
  | 'assignment:deleted'
  | 'whatsapp:dispatched';

export interface RealtimeEventPayload {
  type: RealtimeEventType;
  eventId: string;
  timestamp: string;
  clientId?: string;
  actorRole?: 'ADMIN' | 'DRIVER' | 'SYSTEM';
  previousStatus?: TaskStatus | string;
  assignment?: Assignment;
  deletedAssignmentId?: string;
  notification?: WhatsAppNotificationLog;
  state: AppStateResponse;
}

export type SheetsSyncHealthState =
  | 'idle'
  | 'healthy'
  | 'retrying'
  | 'degraded';

export interface SheetsSyncHealthStatus {
  state: SheetsSyncHealthState;
  isHtmlProxyInterference?: boolean;
  retryAttempt?: number;
  maxRetries?: number;
  reason?: string;
  updatedAt?: string;
}
