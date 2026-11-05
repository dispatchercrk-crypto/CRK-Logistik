import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Award,
  Box,
  Calculator,
  CheckCircle2,
  ClipboardList,
  Clock,
  Copy,
  CreditCard,
  Database,
  Download,
  Edit3,
  ExternalLink,
  FileSpreadsheet,
  FolderOpen,
  HardDrive,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  Navigation,
  PackageCheck,
  Phone,
  Plus,
  Printer,
  Receipt,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Snowflake,
  Trash2,
  Users,
  Wallet,
  X,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  AppConfig,
  Assignment,
  DriverExpense,
  DriverMaster,
  FleetCardMaster,
  RouteMaster,
  TaskStatus,
  VehicleMaster,
  WhatsAppNotificationLog,
  WhatsAppTargetMode,
  isActiveTaskStatus,
  isCompletedTaskStatus,
} from '../types';
import {
  DriverLinkProbeStatus,
  buildDriverPortalLink,
  buildGeneralDriverPortalWaMessage,
  buildPersonalDriverLinkWaMessage,
  isDriverPortalShareReady,
  refreshDriverLinkStatus,
} from '../utils/driverLink';
import {
  buildRealtimeWhatsAppUrlForAssignment,
  buildWhatsAppDirectUrl,
  buildWhatsAppGroupUrl,
  launchWhatsAppUrl,
  resolveAssignmentStatusTimeline,
  resolveWhatsAppUrlForMode,
  stripDriverLinkFromWaMessage,
} from '../utils/whatsapp';
import {
  calculateBoxCbmFromCm,
  evaluateActiveUnitsCbmSummary,
  evaluateAssignmentLoadUtilization,
  evaluateAssignmentOtd,
  formatCbmValue,
  formatDatabaseTimestamp,
  formatDurationMinutes,
  formatRealTimeTimestamp,
  parseCbmNumeric,
  parseSuratJalanList,
  serializeSuratJalanList,
} from '../utils/media';
import {
  DashboardChartsSection,
  DriverPerformanceView,
  FleetCardExpenseVisualizationSection,
  LoadUtilizationSection,
  OnTimeDeliverySummarySection,
  formatIdrCurrency,
  useLoadUtilizationStats,
} from './AnalyticsAndPerformance';
import {
  countAssignmentPhotos,
  summarizeFleetPhotoDriveStats,
} from '../services/driveSync';
import { ConfirmModal } from './ConfirmModal';
import { DailyOperationalSummaryPanel } from './DailyOperationalSummaryPanel';
import {
  AssignmentStatusTimelineView,
  FleetStatusHistoryModal,
} from './FleetStatusHistoryModal';
import { GoogleSignInButton } from './GoogleSignInButton';
import { PrintableAssignmentModal } from './PrintableAssignmentModal';
import { PWAInstallButton } from './PWAInstallButton';
import {
  NotificationBell,
  PortalBellNotificationItem,
} from './NotificationBell';
import {
  AdminSessionHealthSnapshot,
  inspectActiveAdminSessionHealth,
} from '../services/persistentVault';
import { safeApiFetch } from '../utils/safeFetchJson';
import {
  ExpensePdfPeriodMode,
  downloadFleetCardExpensePdfReport,
  resolveExpenseEffectiveDate,
} from '../utils/expensePdfReport';

type AdminMenuTab =
  | 'surat_tugas'
  | 'driver_performance'
  | 'master_data'
  | 'master_fleet_card'
  | 'pengeluaran_driver'
  | 'notifikasi_wa'
  | 'spreadsheets'
  | 'ubah_pin';

type MasterSubTab = 'drivers' | 'vehicles' | 'routes';

function buildPermanentAppsScriptCode(defaultSpreadsheetId?: string): string {
  const safeSheetId = String(defaultSpreadsheetId || '').trim();
  return `/**
 * CRK LOGISTIK DELIVERY SISTEM — Bridge Sinkronisasi Dua Arah Permanen 24/7
 * Cara Pasang / Update:
 * 1. Buka project Google Apps Script Anda -> pilih file Kode.gs (atau Code.gs)
 * 2. Hapus seluruh isi Kode.gs lama, tempelkan seluruh kode ini, lalu tekan Simpan (Ctrl+S)
 * 3. Klik Terapkan (Deploy) -> Kelola deployment -> klik ikon Pensil (Edit)
 * 4. Pada kolom Versi (Version), pilih "Versi baru" (New version), pastikan Akses: "Siapa saja" -> klik Terapkan
 */

var SPREADSHEET_ID = '${safeSheetId}';

var TAB_HEADERS = {
  Master_Driver: ['ID Driver', 'Nama Driver', 'No. WhatsApp', 'PIN Login Driver', 'Jenis SIM', 'Status Aktif'],
  Master_Armada: ['Kode Unit', 'Nomor Polisi', 'Jenis / Tipe Armada', 'Kapasitas Muatan', 'Status Unit', 'Kapasitas CBM'],
  Master_Rute: ['Kode Rute', 'Lokasi Tujuan Pengiriman', 'Nama PIC Tujuan', 'No. WA PIC Tujuan'],
  Master_Fleet_Card: ['ID Fleet Card', 'Nomor Kartu Fleet Card', 'Saldo Fleet Card'],
  Pengeluaran_Driver: [
    'ID Pengeluaran', 'Timestamp Otomatis', 'Tanggal', 'ID Driver', 'Nama Driver',
    'No. Polisi', 'No. Surat Tugas Selesai', 'ID Fleet Card', 'Nomor Kartu Fleet Card',
    'Total Pembelian BBM', 'Link Foto Struk BBM', 'Total Pengeluaran Tol',
    'Link Foto Struk Tol', 'Total Pengeluaran', 'Catatan',
    'Tanggal Pengiriman', 'Tujuan Pengiriman'
  ],
  Surat_Tugas: [
    'ID Internal', 'Urutan', 'No. Penugasan', 'No. Surat Jalan Fisik', 'Kode Segel', 'Tanggal Tugas',
    'ID Driver', 'Nama Driver', 'WA Driver', 'Kode Unit', 'Nomor Polisi', 'Tipe Armada',
    'Jenis Kendaraan (Pendingin/Non)', 'Titik Keberangkatan Driver', 'Kode Rute Tujuan', 'Tujuan Pengiriman',
    'Keperluan / Muatan', 'Status Pengiriman', 'Waktu Berangkat (Real-time)', 'KM Awal',
    'Suhu Monitor Keberangkatan', 'BBM Awal', 'Kondisi Berangkat', 'Catatan Berangkat',
    'Dokumentasi Foto Berangkat', 'Waktu Serah Terima (Real-time)', 'KM Akhir', 'Suhu Monitor Serah Terima',
    'BBM Akhir', 'Nama Penerima Serah Terima', 'Kondisi Akhir', 'Catatan Serah Terima',
    'Bukti Foto & TTD Digital', 'Instruksi Dispatcher', 'Dibuat Pada', 'Jadwal Jam Tiba', 'Berat / Volume Muatan',
    'Link Folder Google Drive', 'Link Foto Odometer Keberangkatan', 'Link Foto Suhu Keberangkatan',
    'Link Foto Odometer Serah Terima', 'Link Foto Suhu Serah Terima', 'Link Foto Bukti Serah Terima',
    'Link Tanda Tangan Penerima', 'Waktu Tiba (Delivered)', 'Volume Muatan (CBM)'
  ],
  Konfigurasi: ['Kunci Konfigurasi', 'Nilai']
};

function openTargetSpreadsheet_(spreadsheetId) {
  var targetId = String(spreadsheetId || SPREADSHEET_ID || '').trim();
  if (targetId) {
    return SpreadsheetApp.openById(targetId);
  }
  return SpreadsheetApp.getActiveSpreadsheet();
}`;
}

const PERMANENT_APPS_SCRIPT_BODY = `

function ensureSheetWithHeaders_(ss, tabName) {
  var headers = TAB_HEADERS[tabName];
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  if (sheet.getLastRow() === 0 && headers && headers.length > 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }
  return sheet;
}

function readSheetDisplayMatrix_(ss, tabName) {
  var sheet = ensureSheetWithHeaders_(ss, tabName);
  var lastRow = sheet.getLastRow();
  var lastCol = Math.max(sheet.getLastColumn(), (TAB_HEADERS[tabName] || []).length);
  if (lastRow === 0 || lastCol === 0) return [TAB_HEADERS[tabName] || []];
  return sheet.getRange(1, 1, lastRow, lastCol).getDisplayValues();
}

function writeSheetRowsClean_(ss, tabName, rows) {
  var headers = TAB_HEADERS[tabName];
  var sheet = ensureSheetWithHeaders_(ss, tabName);
  var maxCols = Math.max(sheet.getLastColumn(), headers.length);
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);

  var existingLastRow = sheet.getLastRow();
  if (existingLastRow >= 2) {
    sheet.getRange(2, 1, existingLastRow - 1, maxCols).clearContent();
  }

  if (Array.isArray(rows) && rows.length > 0) {
    var normalized = rows.map(function (r) {
      var line = [];
      for (var i = 0; i < headers.length; i++) {
        line.push(r && r[i] !== undefined && r[i] !== null ? String(r[i]) : '');
      }
      return line;
    });
    var dataRange = sheet.getRange(2, 1, normalized.length, headers.length);
    dataRange.setNumberFormat('@');
    dataRange.setValues(normalized);
  }
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    var sheetId = (e && e.parameter && e.parameter.spreadsheetId) || '';
    var ss = openTargetSpreadsheet_(sheetId);
    return jsonOut_({
      ok: true,
      title: ss.getName(),
      Master_Driver: readSheetDisplayMatrix_(ss, 'Master_Driver'),
      Master_Armada: readSheetDisplayMatrix_(ss, 'Master_Armada'),
      Master_Rute: readSheetDisplayMatrix_(ss, 'Master_Rute'),
      Master_Fleet_Card: readSheetDisplayMatrix_(ss, 'Master_Fleet_Card'),
      Pengeluaran_Driver: readSheetDisplayMatrix_(ss, 'Pengeluaran_Driver'),
      Surat_Tugas: readSheetDisplayMatrix_(ss, 'Surat_Tugas'),
      Konfigurasi: readSheetDisplayMatrix_(ss, 'Konfigurasi')
    });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    var body = JSON.parse(raw);
    var ss = openTargetSpreadsheet_(body.spreadsheetId);

    if (Array.isArray(body.driversRows)) {
      writeSheetRowsClean_(ss, 'Master_Driver', body.driversRows);
    }
    if (Array.isArray(body.vehiclesRows)) {
      writeSheetRowsClean_(ss, 'Master_Armada', body.vehiclesRows);
    }
    if (Array.isArray(body.routesRows)) {
      writeSheetRowsClean_(ss, 'Master_Rute', body.routesRows);
    }
    if (Array.isArray(body.fleetCardsRows)) {
      writeSheetRowsClean_(ss, 'Master_Fleet_Card', body.fleetCardsRows);
    }
    if (Array.isArray(body.driverExpensesRows)) {
      writeSheetRowsClean_(ss, 'Pengeluaran_Driver', body.driverExpensesRows);
    }
    if (Array.isArray(body.assignmentsRows)) {
      writeSheetRowsClean_(ss, 'Surat_Tugas', body.assignmentsRows);
    }
    if (Array.isArray(body.configRows)) {
      writeSheetRowsClean_(ss, 'Konfigurasi', body.configRows);
    }

    SpreadsheetApp.flush();
    return jsonOut_({ ok: true, updatedAt: new Date().toISOString() });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}
`;

interface AdminPortalProps {
  drivers: DriverMaster[];
  vehicles: VehicleMaster[];
  routes: RouteMaster[];
  fleetCards: FleetCardMaster[];
  driverExpenses: DriverExpense[];
  assignments: Assignment[];
  notifications: WhatsAppNotificationLog[];
  config: AppConfig;
  googleUser: User | null;
  hasGoogleToken: boolean;
  isSyncing: boolean;
  isDriveSyncing?: boolean;
  onGoogleLogin: () => Promise<void>;
  onGoogleLogout: () => Promise<void>;
  onManualSync: () => Promise<void>;
  onSyncPhotosToDrive?: () => Promise<boolean>;
  onConnectSpreadsheet: (spreadsheetInput: string) => Promise<boolean>;
  onCreateSpreadsheet: (customTitle: string) => Promise<boolean>;
  onDisconnectSpreadsheet?: () => Promise<void>;
  onCreateAssignment: (
    payload: Partial<Assignment>,
    waTargetMode: WhatsAppTargetMode
  ) => Promise<WhatsAppNotificationLog | null>;
  onUpdateAssignment: (
    id: string,
    payload: Partial<Assignment> & {
      kmAwal?: number | '';
      suhuAwal?: string;
      kmAkhir?: number | '';
      suhuAkhir?: string;
      penerimaNama?: string;
    }
  ) => Promise<boolean>;
  onDeleteAssignment: (id: string) => Promise<boolean>;
  onSaveDriver: (
    mode: 'create' | 'edit',
    originalId: string,
    driver: DriverMaster
  ) => Promise<boolean>;
  onDeleteDriver: (id: string) => Promise<boolean>;
  onSaveVehicle: (
    mode: 'create' | 'edit',
    originalId: string,
    vehicle: VehicleMaster
  ) => Promise<boolean>;
  onDeleteVehicle: (id: string) => Promise<boolean>;
  onSaveRoute: (
    mode: 'create' | 'edit',
    originalId: string,
    route: RouteMaster
  ) => Promise<boolean>;
  onDeleteRoute: (id: string) => Promise<boolean>;
  onSaveFleetCard: (
    mode: 'create' | 'edit',
    originalId: string,
    card: FleetCardMaster
  ) => Promise<boolean>;
  onTopUpFleetCard: (id: string, addAmount: number) => Promise<boolean>;
  onUpdateFleetCardBalance: (id: string, newBalance: number) => Promise<boolean>;
  onDeleteFleetCard: (id: string) => Promise<boolean>;
  onDeleteDriverExpense: (id: string) => Promise<boolean>;
  onSaveOperationalSettings: (settings: {
    dispatcherWaPhone: string;
    whatsappTargetMode: WhatsAppTargetMode;
    whatsappGroupName: string;
    whatsappGroupInviteUrl: string;
    letterPrefix: string;
    publicPortalBaseUrl?: string;
  }) => Promise<boolean>;
  onSaveAppsScriptUrl?: (url: string) => Promise<boolean>;
  onTestWhatsAppNetwork: (targetPhone: string) => Promise<void>;
  onChangeAdminPin: (currentPin: string, newPin: string) => Promise<boolean>;
  onRefreshAdminSession?: () => Promise<void>;
  onPurgeAssignmentsCache?: () => Promise<void>;
  onResetApplication?: () => Promise<void>;
  onNotify?: (
    type: 'success' | 'error' | 'info',
    title: string,
    description?: string
  ) => void;
  onCopyText: (text: string, label: string) => void;
  onLogout: () => void;
}

export const AdminPortal: React.FC<AdminPortalProps> = ({
  drivers,
  vehicles,
  routes,
  fleetCards,
  driverExpenses,
  assignments,
  notifications,
  config,
  googleUser,
  hasGoogleToken,
  isSyncing,
  isDriveSyncing = false,
  onGoogleLogin,
  onGoogleLogout,
  onManualSync,
  onSyncPhotosToDrive,
  onConnectSpreadsheet,
  onCreateSpreadsheet,
  onDisconnectSpreadsheet,
  onCreateAssignment,
  onUpdateAssignment,
  onDeleteAssignment,
  onSaveDriver,
  onDeleteDriver,
  onSaveVehicle,
  onDeleteVehicle,
  onSaveRoute,
  onDeleteRoute,
  onSaveFleetCard,
  onTopUpFleetCard,
  onUpdateFleetCardBalance,
  onDeleteFleetCard,
  onDeleteDriverExpense,
  onSaveOperationalSettings,
  onSaveAppsScriptUrl,
  onTestWhatsAppNetwork,
  onChangeAdminPin,
  onRefreshAdminSession,
  onPurgeAssignmentsCache,
  onResetApplication,
  onNotify,
  onCopyText,
  onLogout,
}) => {
  const [activeMenu, setActiveMenu] = useState<AdminMenuTab>(() => {
    if (typeof window !== 'undefined') {
      const savedMenu = window.localStorage.getItem('crk_admin_active_menu');
      if (
        savedMenu === 'surat_tugas' ||
        savedMenu === 'driver_performance' ||
        savedMenu === 'master_data' ||
        savedMenu === 'master_fleet_card' ||
        savedMenu === 'pengeluaran_driver' ||
        savedMenu === 'notifikasi_wa' ||
        savedMenu === 'spreadsheets' ||
        savedMenu === 'ubah_pin'
      ) {
        return savedMenu;
      }
    }
    return 'surat_tugas';
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState<boolean>(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState<boolean>(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('crk_admin_active_menu', activeMenu);
      } catch {
        // Ignore storage quota restrictions
      }
    }
  }, [activeMenu]);

  const fleetDriveStats = useMemo(
    () => summarizeFleetPhotoDriveStats(assignments),
    [assignments]
  );

  // Global Search Bar + Status Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | TaskStatus>('ALL');
  const globalSearchInputRef = useRef<HTMLInputElement | null>(null);

  const handleGlobalSearchChange = (value: string) => {
    setSearchQuery(value);
    if (value.trim() && activeMenu !== 'surat_tugas') {
      setActiveMenu('surat_tugas');
    }
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        globalSearchInputRef.current?.focus();
        globalSearchInputRef.current?.select();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Printable PDF Report Modal State
  const [printableAssignment, setPrintableAssignment] =
    useState<Assignment | null>(null);

  // Fleet Status History Timeline & Daily Operational Summary WA State
  const [timelineModalAssignment, setTimelineModalAssignment] =
    useState<Assignment | null>(null);
  const [expandedTimelineId, setExpandedTimelineId] = useState<string | null>(
    null
  );
  const [showDailySummaryInDashboard, setShowDailySummaryInDashboard] =
    useState<boolean>(false);

  // Share Dedicated Driver Link Modal State
  const [driverLinkModalOpen, setDriverLinkModalOpen] =
    useState<boolean>(false);
  const [driverLinkSearch, setDriverLinkSearch] = useState<string>('');
  const [driverLinkStatus, setDriverLinkStatus] =
    useState<DriverLinkProbeStatus | null>(null);
  const [isCheckingDriverLink, setIsCheckingDriverLink] =
    useState<boolean>(false);
  const [publicPortalUrlInput, setPublicPortalUrlInput] = useState<string>(
    config.publicPortalBaseUrl || ''
  );
  const [savingPortalUrl, setSavingPortalUrl] = useState<boolean>(false);

  // Create / Edit Assignment Modal
  const [assignmentModalOpen, setAssignmentModalOpen] = useState<boolean>(false);
  const [editingAssignment, setEditingAssignment] = useState<Assignment | null>(
    null
  );
  const [nextPreviewNo, setNextPreviewNo] = useState<string>('');
  const [createWaMode, setCreateWaMode] = useState<WhatsAppTargetMode>(
    config.whatsappTargetMode || 'GROUP'
  );
  const [creatingSubmitting, setCreatingSubmitting] = useState<boolean>(false);
  const [lastCreatedNotification, setLastCreatedNotification] =
    useState<WhatsAppNotificationLog | null>(null);
  const [liveNow, setLiveNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setLiveNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const [suratJalanList, setSuratJalanList] = useState<string[]>(['']);

  const [asgForm, setAsgForm] = useState({
    tanggalTugas: new Date().toISOString().slice(0, 10),
    jadwalJamTiba: '',
    noSuratJalanFisik: '',
    kodeSegel: '',
    driverId: '',
    driverName: '',
    driverPhone: '',
    vehicleId: '',
    plateNumber: '',
    vehicleType: '',
    origin: '',
    routeId: '',
    destination: '',
    purpose: '',
    beratMuatan: '',
    volumeCbm: '',
    status: TaskStatus.MENUNGGU_BERANGKAT,
    kmAwal: '' as string,
    suhuAwal: '',
    kmAkhir: '' as string,
    suhuAkhir: '',
    penerimaNama: '',
    notes: '',
  });

  // Inline CBM Calculator State (P x L x T cm x Koli -> CBM)
  const [cbmCalcOpen, setCbmCalcOpen] = useState<boolean>(false);
  const [boxLengthCm, setBoxLengthCm] = useState<string>('');
  const [boxWidthCm, setBoxWidthCm] = useState<string>('');
  const [boxHeightCm, setBoxHeightCm] = useState<string>('');
  const [boxKoliCount, setBoxKoliCount] = useState<string>('1');

  // Master Data States
  const [masterTab, setMasterTab] = useState<MasterSubTab>('drivers');
  const [masterSearch, setMasterSearch] = useState<string>('');

  // Master Driver (without No. Polisi Default)
  const [driverModalOpen, setDriverModalOpen] = useState<boolean>(false);
  const [editingDriverId, setEditingDriverId] = useState<string | null>(null);
  const [driverForm, setDriverForm] = useState<DriverMaster>({
    id: '',
    name: '',
    phone: '',
    pin: '',
    licenseType: 'SIM B1',
    active: true,
  });

  // Master Armada (without Odometer KM Terakhir)
  const [vehicleModalOpen, setVehicleModalOpen] = useState<boolean>(false);
  const [editingVehicleId, setEditingVehicleId] = useState<string | null>(null);
  const [vehicleForm, setVehicleForm] = useState<VehicleMaster>({
    id: '',
    plateNumber: '',
    vehicleType: '',
    capacity: '',
    capacityCbm: '',
    status: 'Siap Jalan',
  });

  // Master Rute / Tujuan (without Lokasi Asal & Estimasi Jarak)
  const [routeModalOpen, setRouteModalOpen] = useState<boolean>(false);
  const [editingRouteId, setEditingRouteId] = useState<string | null>(null);
  const [routeForm, setRouteForm] = useState<RouteMaster>({
    id: '',
    destination: '',
    picName: '',
    picPhone: '',
  });

  // Spreadsheet Connection Form (synced automatically when permanent binding hydrates)
  const [sheetInput, setSheetInput] = useState<string>(
    config.spreadsheetUrl || config.spreadsheetId || ''
  );
  const [appsScriptUrlInput, setAppsScriptUrlInput] = useState<string>(
    config.appsScriptUrl || ''
  );
  const [newSheetTitle, setNewSheetTitle] = useState<string>(
    'CRK LOGISTIK DELIVERY SISTEM Database'
  );
  useEffect(() => {
    const boundRef = config.spreadsheetUrl || config.spreadsheetId || '';
    if (boundRef) {
      setSheetInput((prev) => (prev.trim() ? prev : boundRef));
    }
  }, [config.spreadsheetId, config.spreadsheetUrl]);

  useEffect(() => {
    setAppsScriptUrlInput(config.appsScriptUrl || '');
  }, [config.appsScriptUrl]);

  const [verifyingServiceAccount, setVerifyingServiceAccount] =
    useState<boolean>(false);
  const [driveFolderInput, setDriveFolderInput] = useState<string>(
    config.driveRootFolderUrl || config.driveRootFolderId || ''
  );

  useEffect(() => {
    const nextDriveRef =
      config.driveRootFolderUrl || config.driveRootFolderId || '';
    if (nextDriveRef) {
      setDriveFolderInput((prev) => (prev.trim() ? prev : nextDriveRef));
    }
  }, [config.driveRootFolderId, config.driveRootFolderUrl]);

  const handleVerifyServiceAccount = async () => {
    setVerifyingServiceAccount(true);
    try {
      const res = await safeApiFetch<{
        ok?: boolean;
        message?: string;
        error?: string;
      }>('/api/service-account/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          driveRootFolderInput: driveFolderInput.trim() || undefined,
        }),
      });
      if (res.ok && res.data?.ok) {
        onNotify(
          'success',
          'Service Account 24/7 Aktif',
          res.data.message ||
            'Server berhasil membaca dan menulis Google Spreadsheet secara langsung tanpa login Admin.'
        );
        await onManualSync();
      } else {
        onNotify(
          'error',
          'Verifikasi Service Account Belum Berhasil',
          res.data?.error ||
            res.errorMessage ||
            'Periksa kembali GOOGLE_SERVICE_ACCOUNT_JSON di Pengaturan AI Studio serta akses Editor di Google Spreadsheet.'
        );
      }
    } catch {
      onNotify(
        'error',
        'Gagal Menghubungi Server',
        'Tidak dapat memverifikasi Service Account saat ini.'
      );
    } finally {
      setVerifyingServiceAccount(false);
    }
  };

  // WhatsApp Group, Direct Number & Prefix Settings
  const [waPhoneInput, setWaPhoneInput] = useState<string>(
    config.dispatcherWaPhone || ''
  );
  const [waTargetModeInput, setWaTargetModeInput] =
    useState<WhatsAppTargetMode>(config.whatsappTargetMode || 'GROUP');
  const [waGroupNameInput, setWaGroupNameInput] = useState<string>(
    config.whatsappGroupName || 'Grup Operasional CRK Logistik'
  );
  const [waGroupInviteInput, setWaGroupInviteInput] = useState<string>(
    config.whatsappGroupInviteUrl || ''
  );
  const [prefixInput, setPrefixInput] = useState<string>(
    config.letterPrefix || 'ST-CRK'
  );

  // Admin Change Own PIN & Active Session Inspection State
  const [currentPin, setCurrentPin] = useState<string>('');
  const [newPin, setNewPin] = useState<string>('');
  const [confirmNewPin, setConfirmNewPin] = useState<string>('');
  const [pinError, setPinError] = useState<string>('');
  const [adminSessionHealth, setAdminSessionHealth] =
    useState<AdminSessionHealthSnapshot | null>(null);
  const [refreshingAdminSession, setRefreshingAdminSession] =
    useState<boolean>(false);

  useEffect(() => {
    let mounted = true;
    const loadHealth = async () => {
      const snap = await inspectActiveAdminSessionHealth();
      if (mounted) {
        setAdminSessionHealth(snap);
      }
    };
    void loadHealth();
    return () => {
      mounted = false;
    };
  }, [activeMenu, googleUser, hasGoogleToken]);

  // Generic Confirmation Dialog State
  const [confirmDialog, setConfirmDialog] = useState<{
    open: boolean;
    title: string;
    description: string;
    details: string[];
    confirmLabel: string;
    variant: 'primary' | 'danger';
    action: () => Promise<void>;
  } | null>(null);
  const [confirmLoading, setConfirmLoading] = useState<boolean>(false);

  useEffect(() => {
    setWaPhoneInput(config.dispatcherWaPhone || '');
    setWaTargetModeInput(config.whatsappTargetMode || 'GROUP');
    setWaGroupNameInput(
      config.whatsappGroupName || 'Grup Operasional CRK Logistik'
    );
    setWaGroupInviteInput(config.whatsappGroupInviteUrl || '');
    setCreateWaMode(config.whatsappTargetMode || 'GROUP');
    setPrefixInput(config.letterPrefix || 'ST-CRK');
    setPublicPortalUrlInput(config.publicPortalBaseUrl || '');
    if (config.spreadsheetId && !sheetInput) {
      setSheetInput(config.spreadsheetId);
    }
  }, [
    config.dispatcherWaPhone,
    config.whatsappTargetMode,
    config.whatsappGroupName,
    config.whatsappGroupInviteUrl,
    config.letterPrefix,
    config.publicPortalBaseUrl,
    config.spreadsheetId,
  ]);

  useEffect(() => {
    let active = true;
    const checkStatus = async () => {
      setIsCheckingDriverLink(true);
      const status = await refreshDriverLinkStatus(
        config.publicPortalBaseUrl,
        driverLinkModalOpen
      );
      if (active) {
        if (status) setDriverLinkStatus(status);
        setIsCheckingDriverLink(false);
      }
    };
    void checkStatus();
    return () => {
      active = false;
    };
  }, [config.publicPortalBaseUrl, driverLinkModalOpen]);

  const isDriverLinkReady = Boolean(
    driverLinkStatus
      ? driverLinkStatus.isShareReady
      : isDriverPortalShareReady()
  );

  const guardDriverLinkAction = (action: () => void) => {
    if (!isDriverLinkReady) {
      setDriverLinkModalOpen(true);
      return;
    }
    action();
  };

  const fetchNextSequentialPreview = async (dateStr: string) => {
    try {
      const res = await safeApiFetch<{ noPenugasan?: string }>(
        `/api/assignments/next-number?tanggal=${encodeURIComponent(dateStr)}`
      );
      if (res.ok && res.data?.noPenugasan) {
        setNextPreviewNo(res.data.noPenugasan);
      }
    } catch {
      // ignore preview error
    }
  };

  const statusCounts = useMemo(() => {
    let menunggu = 0;
    let perjalanan = 0;
    let delivered = 0;
    let handover = 0;
    for (const a of assignments) {
      if (a.status === TaskStatus.MENUNGGU_BERANGKAT) menunggu++;
      else if (a.status === TaskStatus.DALAM_PERJALANAN) perjalanan++;
      else if (a.status === TaskStatus.DELIVERED) delivered++;
      else if (isCompletedTaskStatus(a.status)) handover++;
    }
    return {
      all: assignments.length,
      menunggu,
      perjalanan,
      delivered,
      handover,
    };
  }, [assignments]);

  const loadStats = useLoadUtilizationStats(assignments, vehicles);

  const activeUnitsCbm = useMemo(
    () => evaluateActiveUnitsCbmSummary(vehicles, assignments),
    [vehicles, assignments]
  );

  const computedBoxCbm = useMemo(() => {
    return calculateBoxCbmFromCm(
      Number(boxLengthCm),
      Number(boxWidthCm),
      Number(boxHeightCm),
      Number(boxKoliCount || 1)
    );
  }, [boxLengthCm, boxWidthCm, boxHeightCm, boxKoliCount]);

  const liveUnitCbmPreview = useMemo(() => {
    const cleanPlate = asgForm.plateNumber.trim().replace(/\s+/g, '').toLowerCase();
    const matchedVeh = vehicles.find(
      (v) =>
        (asgForm.vehicleId && v.id === asgForm.vehicleId) ||
        (cleanPlate &&
          v.plateNumber.trim().replace(/\s+/g, '').toLowerCase() === cleanPlate)
    );

    const capacityCbm = matchedVeh
      ? parseCbmNumeric(matchedVeh.capacityCbm) ??
        (/\b(cbm|m3|m³|kubik)\b/i.test(matchedVeh.capacity || '')
          ? parseCbmNumeric(matchedVeh.capacity)
          : null)
      : null;

    const currentInputCbm =
      parseCbmNumeric(asgForm.volumeCbm) ??
      (/\b(cbm|m3|m³|kubik)\b/i.test(asgForm.beratMuatan || '')
        ? parseCbmNumeric(asgForm.beratMuatan)
        : null) ??
      0;

    let existingOtherActiveCbm = 0;
    if (matchedVeh || cleanPlate) {
      for (const a of assignments) {
        if (editingAssignment && a.id === editingAssignment.id) continue;
        if (!isActiveTaskStatus(a.status)) continue;
        const aPlate = a.plateNumber.trim().replace(/\s+/g, '').toLowerCase();
        const sameUnit =
          (matchedVeh && a.vehicleId === matchedVeh.id) ||
          (cleanPlate && aPlate === cleanPlate);
        if (sameUnit) {
          const cbmVal =
            parseCbmNumeric(a.volumeCbm) ??
            (/\b(cbm|m3|m³|kubik)\b/i.test(a.beratMuatan || '')
              ? parseCbmNumeric(a.beratMuatan)
              : null) ??
            0;
          existingOtherActiveCbm += cbmVal;
        }
      }
    }

    const projectedTotalCbm =
      Math.round((existingOtherActiveCbm + currentInputCbm) * 1000) / 1000;
    const remainingCbm =
      capacityCbm !== null
        ? Math.max(0, Math.round((capacityCbm - projectedTotalCbm) * 1000) / 1000)
        : null;
    const overCbm =
      capacityCbm !== null && projectedTotalCbm > capacityCbm
        ? Math.round((projectedTotalCbm - capacityCbm) * 1000) / 1000
        : 0;
    const utilizationPct =
      capacityCbm !== null && capacityCbm > 0
        ? Math.round((projectedTotalCbm / capacityCbm) * 100)
        : null;

    return {
      matchedVeh,
      capacityCbm,
      existingOtherActiveCbm,
      currentInputCbm,
      projectedTotalCbm,
      remainingCbm,
      overCbm,
      utilizationPct,
    };
  }, [
    asgForm.vehicleId,
    asgForm.plateNumber,
    asgForm.volumeCbm,
    asgForm.beratMuatan,
    vehicles,
    assignments,
    editingAssignment,
  ]);

  const liveFormLoadPreview = useMemo(() => {
    return evaluateAssignmentLoadUtilization(
      {
        vehicleId: asgForm.vehicleId,
        plateNumber: asgForm.plateNumber,
        beratMuatan: asgForm.beratMuatan,
        purpose: asgForm.purpose,
      },
      vehicles
    );
  }, [
    asgForm.vehicleId,
    asgForm.plateNumber,
    asgForm.beratMuatan,
    asgForm.purpose,
    vehicles,
  ]);

  const filteredAssignments = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const qCompact = q.replace(/[\s/-]+/g, '');

    return assignments.filter((item) => {
      const matchesStatus =
        statusFilter === 'ALL'
          ? true
          : statusFilter === TaskStatus.HANDOVER ||
            statusFilter === TaskStatus.SELESAI
          ? isCompletedTaskStatus(item.status)
          : item.status === statusFilter;
      if (!matchesStatus) return false;

      if (!q) return true;

      const plateCompact = item.plateNumber.toLowerCase().replace(/[\s-]+/g, '');
      const noPenugasanCompact = item.noPenugasan
        .toLowerCase()
        .replace(/[\s/-]+/g, '');
      const idCompact = item.id.toLowerCase().replace(/[\s-]+/g, '');

      return (
        item.driverName.toLowerCase().includes(q) ||
        item.driverId.toLowerCase().includes(q) ||
        item.plateNumber.toLowerCase().includes(q) ||
        (qCompact.length > 0 && plateCompact.includes(qCompact)) ||
        item.id.toLowerCase().includes(q) ||
        (qCompact.length > 0 && idCompact.includes(qCompact)) ||
        item.noPenugasan.toLowerCase().includes(q) ||
        (qCompact.length > 0 && noPenugasanCompact.includes(qCompact)) ||
        (item.noSuratJalanFisik || '').toLowerCase().includes(q) ||
        (item.kodeSegel || '').toLowerCase().includes(q)
      );
    });
  }, [assignments, searchQuery, statusFilter]);

  const openCreateAssignmentModal = () => {
    const today = new Date().toISOString().slice(0, 10);
    setEditingAssignment(null);
    setCreateWaMode(config.whatsappTargetMode || 'GROUP');
    setSuratJalanList(['']);
    setCbmCalcOpen(false);
    setBoxLengthCm('');
    setBoxWidthCm('');
    setBoxHeightCm('');
    setBoxKoliCount('1');
    setAsgForm({
      tanggalTugas: today,
      jadwalJamTiba: '',
      noSuratJalanFisik: '',
      kodeSegel: '',
      driverId: '',
      driverName: '',
      driverPhone: '',
      vehicleId: '',
      plateNumber: '',
      vehicleType: '',
      origin: '',
      routeId: '',
      destination: '',
      purpose: '',
      beratMuatan: '',
      volumeCbm: '',
      status: TaskStatus.MENUNGGU_BERANGKAT,
      kmAwal: '',
      suhuAwal: '',
      kmAkhir: '',
      suhuAkhir: '',
      penerimaNama: '',
      notes: '',
    });
    fetchNextSequentialPreview(today);
    setAssignmentModalOpen(true);
  };

  const openEditAssignmentModal = (asg: Assignment) => {
    setEditingAssignment(asg);
    const parsedSj = parseSuratJalanList(asg.noSuratJalanFisik);
    setSuratJalanList(parsedSj.length > 0 ? parsedSj : ['']);
    setCbmCalcOpen(false);
    setBoxLengthCm('');
    setBoxWidthCm('');
    setBoxHeightCm('');
    setBoxKoliCount('1');
    setAsgForm({
      tanggalTugas: asg.tanggalTugas,
      jadwalJamTiba: asg.jadwalJamTiba || '',
      noSuratJalanFisik: asg.noSuratJalanFisik || '',
      kodeSegel: asg.kodeSegel || '',
      driverId: asg.driverId,
      driverName: asg.driverName,
      driverPhone: asg.driverPhone,
      vehicleId: asg.vehicleId,
      plateNumber: asg.plateNumber,
      vehicleType: asg.vehicleType,
      origin:
        asg.departureData?.titikKeberangkatan ||
        (asg.origin === 'Menunggu Titik Keberangkatan Driver'
          ? ''
          : asg.origin),
      routeId: asg.routeId,
      destination: asg.destination,
      purpose: asg.purpose,
      beratMuatan: asg.beratMuatan || '',
      volumeCbm: asg.volumeCbm || '',
      status: asg.status,
      kmAwal:
        asg.departureData?.kmAwal !== undefined
          ? String(asg.departureData.kmAwal)
          : '',
      suhuAwal: asg.departureData?.suhuAwal || '',
      kmAkhir:
        asg.handoverData?.kmAkhir !== undefined
          ? String(asg.handoverData.kmAkhir)
          : '',
      suhuAkhir: asg.handoverData?.suhuAkhir || '',
      penerimaNama: asg.handoverData?.penerimaNama || '',
      notes: asg.notes || '',
    });
    setAssignmentModalOpen(true);
  };

  const handleDriverSelectInAssignment = (driverId: string) => {
    const drv = drivers.find((d) => d.id === driverId);
    if (!drv) {
      setAsgForm((prev) => ({ ...prev, driverId }));
      return;
    }
    setAsgForm((prev) => ({
      ...prev,
      driverId: drv.id,
      driverName: drv.name,
      driverPhone: drv.phone,
    }));
  };

  const handleVehicleSelectInAssignment = (vehicleId: string) => {
    const veh = vehicles.find((v) => v.id === vehicleId);
    if (!veh) {
      setAsgForm((prev) => ({ ...prev, vehicleId }));
      return;
    }
    setAsgForm((prev) => ({
      ...prev,
      vehicleId: veh.id,
      plateNumber: veh.plateNumber,
      vehicleType: veh.vehicleType,
    }));
  };

  const handleRouteSelectInAssignment = (routeId: string) => {
    const rt = routes.find((r) => r.id === routeId);
    if (!rt) {
      setAsgForm((prev) => ({ ...prev, routeId }));
      return;
    }
    setAsgForm((prev) => ({
      ...prev,
      routeId: rt.id,
      destination: rt.destination,
    }));
  };

  const handleOpenAssignmentWa = (
    asg: Assignment,
    mode: WhatsAppTargetMode
  ) => {
    const { url } = buildRealtimeWhatsAppUrlForAssignment(
      asg,
      mode,
      config.whatsappGroupName,
      config.dispatcherWaPhone
    );
    launchWhatsAppUrl(url);
  };

  const handleOpenNotifLogWa = (
    notif: WhatsAppNotificationLog,
    mode: WhatsAppTargetMode
  ) => {
    const matchedAsg = assignments.find(
      (a) => a.noPenugasan === notif.noPenugasan
    );
    if (matchedAsg) {
      handleOpenAssignmentWa(matchedAsg, mode);
      return;
    }
    const url = resolveWhatsAppUrlForMode(
      notif,
      mode,
      undefined,
      config.dispatcherWaPhone
    );
    launchWhatsAppUrl(url);
  };

  const triggerConfirm = (cfg: NonNullable<typeof confirmDialog>) => {
    setConfirmDialog(cfg);
  };

  const executeConfirmedAction = async () => {
    if (!confirmDialog) return;
    setConfirmLoading(true);
    try {
      await confirmDialog.action();
      setConfirmDialog(null);
    } finally {
      setConfirmLoading(false);
    }
  };

  const handleAdminBellSelect = (item: PortalBellNotificationItem) => {
    setActiveMenu('surat_tugas');
    setStatusFilter('ALL');
    if (item.noPenugasan) {
      setSearchQuery(item.noPenugasan);
    }
    if (item.assignmentId) {
      setExpandedTimelineId(item.assignmentId);
    }
  };

  const handleAdminBellQuickWa = (item: PortalBellNotificationItem) => {
    const preferredMode = config.whatsappTargetMode || 'GROUP';
    if (item.assignment) {
      handleOpenAssignmentWa(item.assignment, preferredMode);
      return;
    }
    if (item.waLog) {
      handleOpenNotifLogWa(item.waLog, preferredMode);
    }
  };

  const menuTitles: Record<AdminMenuTab, string> = {
    surat_tugas: 'Dasbor Surat Tugas & Analitik Rantai Dingin',
    driver_performance: 'Performa Driver (Driver Performance)',
    master_data: 'Master Data Operasional Armada & Rute',
    master_fleet_card: 'Master Kartu Fleet Card',
    pengeluaran_driver: 'Data_Pengeluaran Driver (BBM & Tol)',
    notifikasi_wa: 'Pengiriman & Log WhatsApp 1-Klik',
    spreadsheets: 'Sinkronisasi Database Spreadsheets',
    ubah_pin: 'Sesi Aktif & Pengaturan PIN Admin Dispatcher',
  };

  const shortMenuTitles: Record<AdminMenuTab, string> = {
    surat_tugas: 'Surat Tugas',
    driver_performance: 'Performa Driver',
    master_data: 'Master Data',
    master_fleet_card: 'Master Fleet Card',
    pengeluaran_driver: 'Pengeluaran Driver',
    notifikasi_wa: 'WhatsApp 1-Klik',
    spreadsheets: 'Database Sheets',
    ubah_pin: 'Sesi & PIN Admin',
  };

  // Master Kartu Fleet Card & Data_Pengeluaran Driver State
  const [fleetCardSearch, setFleetCardSearch] = useState<string>('');
  const [fleetCardModalOpen, setFleetCardModalOpen] = useState<boolean>(false);
  const [fleetCardModalMode, setFleetCardModalMode] = useState<
    'create' | 'edit'
  >('create');
  const [editingFleetCardOriginalId, setEditingFleetCardOriginalId] =
    useState<string>('');
  const [fleetCardForm, setFleetCardForm] = useState<{
    id: string;
    cardNumber: string;
    balance: string;
  }>({
    id: '',
    cardNumber: '',
    balance: '',
  });
  const [fleetCardSaving, setFleetCardSaving] = useState<boolean>(false);

  const [topUpModalCard, setTopUpModalCard] = useState<FleetCardMaster | null>(
    null
  );
  const [topUpAmount, setTopUpAmount] = useState<string>('');
  const [topUpSaving, setTopUpSaving] = useState<boolean>(false);

  const [updateBalanceModalCard, setUpdateBalanceModalCard] =
    useState<FleetCardMaster | null>(null);
  const [updateBalanceInput, setUpdateBalanceInput] = useState<string>('');
  const [updateBalanceSaving, setUpdateBalanceSaving] =
    useState<boolean>(false);

  const [expenseSearch, setExpenseSearch] = useState<string>('');
  const [expenseCardFilter, setExpenseCardFilter] = useState<string>('ALL');
  const [expensePeriodMode, setExpensePeriodMode] =
    useState<ExpensePdfPeriodMode>('DAILY');
  const [expenseDateFilter, setExpenseDateFilter] = useState<string>('');
  const [expenseMonthFilter, setExpenseMonthFilter] = useState<string>(() => {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      })
        .format(new Date())
        .slice(0, 7);
    } catch {
      return new Date().toISOString().slice(0, 7);
    }
  });
  const [receiptPreviewModal, setReceiptPreviewModal] = useState<{
    title: string;
    subtitle: string;
    imageSrc: string;
    driveUrl?: string;
  } | null>(null);
  const [receiptImgFailed, setReceiptImgFailed] = useState<boolean>(false);

  const parseRupiahInput = (raw: string): number => {
    const cleaned = String(raw || '').replace(/[^\d-]/g, '');
    if (!cleaned || cleaned === '-') return 0;
    const parsed = Number(cleaned);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  };

  const openCreateFleetCardModal = () => {
    const nextNum = fleetCards.length + 1;
    const suggestedId = `FC-${String(nextNum).padStart(3, '0')}`;
    setFleetCardModalMode('create');
    setEditingFleetCardOriginalId('');
    setFleetCardForm({
      id: suggestedId,
      cardNumber: '',
      balance: '',
    });
    setFleetCardModalOpen(true);
  };

  const openEditFleetCardModal = (card: FleetCardMaster) => {
    setFleetCardModalMode('edit');
    setEditingFleetCardOriginalId(card.id);
    setFleetCardForm({
      id: card.id,
      cardNumber: card.cardNumber,
      balance: String(Math.round(card.balance || 0)),
    });
    setFleetCardModalOpen(true);
  };

  const openTopUpFleetCardModal = (card: FleetCardMaster) => {
    setTopUpModalCard(card);
    setTopUpAmount('');
  };

  const openUpdateBalanceModal = (card: FleetCardMaster) => {
    setUpdateBalanceModalCard(card);
    setUpdateBalanceInput(String(Math.max(0, Math.round(card.balance || 0))));
  };

  const openReceiptPreview = (
    title: string,
    subtitle: string,
    imageSrc: string,
    driveUrl?: string
  ) => {
    setReceiptImgFailed(false);
    setReceiptPreviewModal({ title, subtitle, imageSrc, driveUrl });
  };

  const filteredFleetCards = useMemo(() => {
    const q = fleetCardSearch.trim().toLowerCase();
    if (!q) return fleetCards;
    return fleetCards.filter(
      (fc) =>
        fc.id.toLowerCase().includes(q) ||
        fc.cardNumber.toLowerCase().includes(q)
    );
  }, [fleetCards, fleetCardSearch]);

  const fleetCardUsageMap = useMemo(() => {
    const map = new Map<string, { txCount: number; totalSpent: number }>();
    const norm = (val: string) =>
      String(val || '')
        .trim()
        .replace(/[\s-]+/g, '')
        .toUpperCase();
    for (const exp of driverExpenses) {
      const keyByNum = norm(exp.fleetCardNumber);
      const keyById = String(exp.fleetCardId || '').trim().toUpperCase();
      const total =
        Number.isFinite(exp.totalPengeluaran) && exp.totalPengeluaran > 0
          ? exp.totalPengeluaran
          : (exp.totalPengirimanBbm || 0) + (exp.totalPengeluaranTol || 0);
      if (keyByNum) {
        const cur = map.get(`NUM:${keyByNum}`) || { txCount: 0, totalSpent: 0 };
        cur.txCount += 1;
        cur.totalSpent += total;
        map.set(`NUM:${keyByNum}`, cur);
      }
      if (keyById) {
        const cur = map.get(`ID:${keyById}`) || { txCount: 0, totalSpent: 0 };
        cur.txCount += 1;
        cur.totalSpent += total;
        map.set(`ID:${keyById}`, cur);
      }
    }
    return map;
  }, [driverExpenses]);

  const uniqueExpenseCardNumbers = useMemo(() => {
    const set = new Set<string>();
    for (const fc of fleetCards) {
      if (fc.cardNumber.trim()) set.add(fc.cardNumber.trim());
    }
    for (const exp of driverExpenses) {
      if (exp.fleetCardNumber.trim()) set.add(exp.fleetCardNumber.trim());
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [fleetCards, driverExpenses]);

  const filteredDriverExpenses = useMemo(() => {
    const q = expenseSearch.trim().toLowerCase();
    return [...driverExpenses]
      .filter((exp) => {
        if (
          expenseCardFilter !== 'ALL' &&
          exp.fleetCardNumber.trim().toLowerCase() !==
            expenseCardFilter.trim().toLowerCase()
        ) {
          return false;
        }
        const effDate = resolveExpenseEffectiveDate(exp);
        const reportDate = String(exp.tanggal || '').trim().slice(0, 10);
        if (expensePeriodMode === 'DAILY') {
          if (
            expenseDateFilter &&
            effDate !== expenseDateFilter &&
            reportDate !== expenseDateFilter
          ) {
            return false;
          }
        } else if (expensePeriodMode === 'MONTHLY') {
          if (
            expenseMonthFilter &&
            !effDate.startsWith(expenseMonthFilter) &&
            !reportDate.startsWith(expenseMonthFilter)
          ) {
            return false;
          }
        }
        if (!q) return true;
        return (
          exp.driverName.toLowerCase().includes(q) ||
          exp.driverId.toLowerCase().includes(q) ||
          exp.fleetCardNumber.toLowerCase().includes(q) ||
          exp.fleetCardId.toLowerCase().includes(q) ||
          (exp.plateNumber || '').toLowerCase().includes(q) ||
          (exp.completedAssignmentNos || '').toLowerCase().includes(q) ||
          (exp.tujuanPengiriman || '').toLowerCase().includes(q) ||
          (exp.tanggalPengiriman || '').toLowerCase().includes(q) ||
          exp.id.toLowerCase().includes(q)
        );
      })
      .sort(
        (a, b) =>
          new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
  }, [
    driverExpenses,
    expenseSearch,
    expenseCardFilter,
    expensePeriodMode,
    expenseDateFilter,
    expenseMonthFilter,
  ]);

  const filteredDrivers = useMemo(() => {
    const q = masterSearch.trim().toLowerCase();
    if (!q) return drivers;
    return drivers.filter(
      (d) =>
        d.id.toLowerCase().includes(q) || d.name.toLowerCase().includes(q)
    );
  }, [drivers, masterSearch]);

  const filteredVehicles = useMemo(() => {
    const q = masterSearch.trim().toLowerCase();
    if (!q) return vehicles;
    return vehicles.filter(
      (v) =>
        v.id.toLowerCase().includes(q) ||
        v.plateNumber.toLowerCase().includes(q) ||
        v.vehicleType.toLowerCase().includes(q)
    );
  }, [vehicles, masterSearch]);

  const filteredRoutes = useMemo(() => {
    const q = masterSearch.trim().toLowerCase();
    if (!q) return routes;
    return routes.filter(
      (r) =>
        r.id.toLowerCase().includes(q) ||
        r.destination.toLowerCase().includes(q) ||
        r.picName.toLowerCase().includes(q)
    );
  }, [routes, masterSearch]);

  return (
    <>
      <div className="no-print min-h-screen bg-slate-50 flex">
        {/* Desktop Sidebar Navigation */}
        <aside className="hidden lg:flex lg:w-64 lg:shrink-0 lg:flex-col border-r border-slate-200 bg-white">
          <div className="border-b border-slate-200 px-6 py-4">
            <div className="flex items-center gap-2 text-sm font-bold tracking-tight text-slate-900">
              <Snowflake className="h-4 w-4 shrink-0 text-sky-700" />
              <span className="truncate">CRK LOGISTIK</span>
            </div>
            <p className="mt-0.5 text-[11px] font-medium text-slate-500">
              Cold Chain Delivery Sistem
            </p>
          </div>

          <nav className="flex-1 space-y-1 p-4">
            <button
              type="button"
              onClick={() => setActiveMenu('surat_tugas')}
              className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeMenu === 'surat_tugas'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <ClipboardList className="h-4 w-4 shrink-0" />
                Surat Tugas
              </span>
              <span className="font-mono text-xs tabular-nums">
                {assignments.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMenu('driver_performance')}
              className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeMenu === 'driver_performance'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Award className="h-4 w-4 shrink-0" />
                Performa Driver
              </span>
              <span className="font-mono text-xs tabular-nums">
                {drivers.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMenu('master_data')}
              className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeMenu === 'master_data'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Database className="h-4 w-4 shrink-0" />
                Master Data
              </span>
              <span className="font-mono text-xs tabular-nums">
                {drivers.length + vehicles.length + routes.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMenu('master_fleet_card')}
              className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeMenu === 'master_fleet_card'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <CreditCard className="h-4 w-4 shrink-0" />
                Master Kartu Fleet Card
              </span>
              <span className="font-mono text-xs tabular-nums">
                {fleetCards.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMenu('pengeluaran_driver')}
              className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeMenu === 'pengeluaran_driver'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <Receipt className="h-4 w-4 shrink-0" />
                Data_Pengeluaran Driver
              </span>
              <span className="font-mono text-xs tabular-nums">
                {driverExpenses.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMenu('notifikasi_wa')}
              className={`flex w-full items-center justify-between rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeMenu === 'notifikasi_wa'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <span className="flex items-center gap-2.5">
                <MessageSquare className="h-4 w-4 shrink-0" />
                WhatsApp 1-Klik
              </span>
              <span className="font-mono text-xs tabular-nums">
                {notifications.length}
              </span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMenu('spreadsheets')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeMenu === 'spreadsheets'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <FileSpreadsheet className="h-4 w-4 shrink-0" />
              Database Spreadsheets
            </button>

            <button
              type="button"
              onClick={() => setActiveMenu('ubah_pin')}
              className={`flex w-full items-center gap-2.5 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                activeMenu === 'ubah_pin'
                  ? 'bg-slate-900 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              <ShieldCheck className="h-4 w-4 shrink-0" />
              Sesi Aktif &amp; PIN Admin
            </button>

            <div className="pt-2 space-y-2">
              <button
                type="button"
                onClick={() => setDriverLinkModalOpen(true)}
                className="flex w-full items-center justify-between rounded-lg border border-sky-200 bg-sky-50/80 px-3.5 py-2.5 text-xs font-semibold text-sky-900 transition-colors hover:bg-sky-100 whitespace-nowrap"
              >
                <span className="flex items-center gap-2">
                  <Link2 className="h-4 w-4 shrink-0 text-sky-700" />
                  Link Khusus Driver
                </span>
                <span className="font-mono tabular-nums text-sky-700">
                  {drivers.filter((d) => d.active !== false).length}
                </span>
              </button>
              <PWAInstallButton fullWidth label="Instal Aplikasi di Perangkat" />
            </div>
          </nav>

          <div className="border-t border-slate-200 p-4 space-y-3">
            <div className="text-xs text-slate-500">
              <button
                type="button"
                onClick={() => setActiveMenu('ubah_pin')}
                className="text-left text-[11px] font-semibold text-emerald-700 hover:underline"
                title="Lihat detail Sesi Aktif Admin Dispatcher"
              >
                Sesi Admin Dispatcher: Aktif Permanen · Auto-Refresh
              </button>
              <p className="mt-1 font-medium text-slate-800 truncate">
                {config.spreadsheetTitle || 'Spreadsheet Belum Dipilih'}
              </p>
              {googleUser && (
                <p className="mt-0.5 truncate text-[11px] font-medium text-slate-600">
                  Google Cloud: {googleUser.email}
                </p>
              )}
              <p className="mt-0.5 font-mono tabular-nums">
                {config.lastSyncedAt
                  ? `Sinkron: ${new Date(
                      config.lastSyncedAt
                    ).toLocaleTimeString('id-ID', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : 'Menunggu sinkronisasi'}
              </p>
            </div>
            <button
              type="button"
              onClick={onLogout}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50"
            >
              <LogOut className="h-3.5 w-3.5" />
              Keluar ke Halaman Login
            </button>
          </div>
        </aside>

        {/* Mobile Navigation Drawer */}
        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div
              className="fixed inset-0 bg-slate-950/45 backdrop-blur-[1px]"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative z-10 flex w-[84vw] max-w-xs flex-col rounded-r-3xl bg-white p-5 pb-safe shadow-2xl">
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-900">
                    <Snowflake className="h-4 w-4 shrink-0 text-sky-700" />
                    <span className="truncate">CRK LOGISTIK</span>
                  </div>
                  <p className="mt-0.5 text-[11px] font-medium text-slate-500">
                    Portal Admin Dispatcher
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"
                  aria-label="Tutup menu navigasi"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="mt-4 flex-1 space-y-1 overflow-y-auto">
                {(
                  [
                    ['surat_tugas', 'Surat Tugas', assignments.length],
                    ['driver_performance', 'Performa Driver', drivers.length],
                    [
                      'master_data',
                      'Master Data',
                      drivers.length + vehicles.length + routes.length,
                    ],
                    [
                      'master_fleet_card',
                      'Master Kartu Fleet Card',
                      fleetCards.length,
                    ],
                    [
                      'pengeluaran_driver',
                      'Data_Pengeluaran Driver',
                      driverExpenses.length,
                    ],
                    ['notifikasi_wa', 'WhatsApp 1-Klik', notifications.length],
                    ['spreadsheets', 'Database Spreadsheets', null],
                    ['ubah_pin', 'Sesi Aktif & PIN Admin', null],
                  ] as Array<[AdminMenuTab, string, number | null]>
                ).map(([key, label, count]) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => {
                      setActiveMenu(key);
                      setMobileMenuOpen(false);
                    }}
                    className={`flex min-h-[44px] w-full items-center justify-between rounded-xl px-3.5 py-2.5 text-left text-sm font-medium transition-colors ${
                      activeMenu === key
                        ? 'bg-slate-900 text-white'
                        : 'text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    <span>{label}</span>
                    {count !== null && (
                      <span
                        className={`font-mono text-xs tabular-nums ${
                          activeMenu === key ? 'text-slate-300' : 'text-slate-400'
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                ))}

                <div className="pt-2 space-y-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveMenu('surat_tugas');
                      setShowDailySummaryInDashboard(true);
                      setMobileMenuOpen(false);
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50/80 px-3.5 py-2.5 text-left text-xs font-semibold text-emerald-900"
                  >
                    <MessageSquare className="h-4 w-4 shrink-0 text-emerald-700" />
                    Ringkasan Harian WA
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      setDriverLinkModalOpen(true);
                    }}
                    className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-sky-200 bg-sky-50/80 px-3.5 py-2.5 text-left text-xs font-semibold text-sky-900"
                  >
                    <Link2 className="h-4 w-4 shrink-0 text-sky-700" />
                    Bagikan Link Khusus Driver
                  </button>
                  <div className="pt-0.5">
                    <PWAInstallButton fullWidth label="Instal Aplikasi di Perangkat" />
                  </div>
                </div>
              </nav>
              <div className="mt-4 border-t border-slate-200 pt-3 text-[11px] text-slate-500">
                <p className="font-semibold text-emerald-700">
                  Sesi Admin Dispatcher: Aktif Permanen
                </p>
                <p className="mt-0.5 truncate">
                  {googleUser
                    ? `Google: ${googleUser.email} · Auto-Refresh`
                    : 'Penyimpanan Sesi Berlapis Aktif'}
                </p>
              </div>
              <button
                type="button"
                onClick={onLogout}
                className="mt-3 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl border border-slate-300 px-4 py-2.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <LogOut className="h-4 w-4" />
                Keluar
              </button>
            </div>
          </div>
        )}

        {/* Main Workspace Area */}
        <div className="flex min-w-0 flex-1 flex-col">
          {/* Sleek Glassmorphic Top Bar (Single 54px Row on Mobile + Notification Bell) */}
          <header className="sticky top-0 z-30 border-b border-slate-200/90 bg-white/92 backdrop-blur-md">
            <div className="flex min-h-[54px] items-center justify-between gap-2 px-3.5 py-2 sm:px-8 sm:py-2.5">
              <div className="flex min-w-0 items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(true)}
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-700 transition-colors hover:bg-slate-50 active:scale-[0.98] lg:hidden"
                  aria-label="Buka menu navigasi"
                >
                  <Menu className="h-4 w-4" />
                </button>
                <div className="min-w-0 truncate text-sm font-medium text-slate-500">
                  <span className="hidden xl:inline">
                    CRK LOGISTIK DELIVERY SISTEM
                  </span>
                  <span className="hidden sm:inline xl:hidden">
                    CRK LOGISTIK
                  </span>
                  <span className="hidden sm:inline mx-1.5 text-slate-300">
                    /
                  </span>
                  <span className="font-bold text-slate-900 sm:hidden">
                    {shortMenuTitles[activeMenu]}
                  </span>
                  <span className="hidden font-semibold text-slate-900 sm:inline">
                    {menuTitles[activeMenu]}
                  </span>
                </div>
              </div>

              {/* Desktop Global Search Bar (Driver Name, Plate Number, Assignment ID) */}
              <div className="hidden md:block md:max-w-md md:flex-1 lg:max-w-lg">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    ref={globalSearchInputRef}
                    type="search"
                    value={searchQuery}
                    onChange={(e) => handleGlobalSearchChange(e.target.value)}
                    placeholder="Cari Global: Nama Driver, No. Polisi, atau ID Penugasan..."
                    aria-label="Pencarian global penugasan berdasarkan nama driver, nomor polisi, atau ID penugasan"
                    className="w-full rounded-xl border border-slate-300 bg-slate-50/75 py-2 pl-10 pr-24 text-xs sm:text-sm text-slate-900 transition-colors placeholder:text-slate-400 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                  <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                    {searchQuery.trim() ? (
                      <>
                        <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
                          {filteredAssignments.length}/{assignments.length}
                        </span>
                        <button
                          type="button"
                          onClick={() => setSearchQuery('')}
                          className="rounded p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-800"
                          aria-label="Bersihkan pencarian global"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : (
                      <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] font-medium text-slate-400 sm:inline-block">
                        Ctrl K
                      </kbd>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                {/* Mobile Search Toggle */}
                <button
                  type="button"
                  onClick={() => setMobileSearchOpen((prev) => !prev)}
                  className={`relative flex h-10 w-10 items-center justify-center rounded-xl border transition-colors md:hidden ${
                    mobileSearchOpen || searchQuery.trim()
                      ? 'border-slate-900 bg-slate-900 text-white'
                      : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                  aria-label="Cari penugasan"
                >
                  <Search className="h-4 w-4" />
                  {searchQuery.trim() && (
                    <span className="absolute -right-1 -top-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-sky-600 px-1 font-mono text-[9px] font-bold text-white tabular-nums">
                      {filteredAssignments.length}
                    </span>
                  )}
                </button>

                <PWAInstallButton compact />

                <button
                  type="button"
                  onClick={() => setDriverLinkModalOpen(true)}
                  className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3 py-2 text-xs font-semibold text-sky-900 transition-colors hover:bg-sky-100 whitespace-nowrap shrink-0"
                  title="Bagikan Link Login Khusus Driver via Salin Link atau WhatsApp"
                >
                  <Link2 className="h-3.5 w-3.5 text-sky-700" />
                  <span>Link Driver</span>
                </button>

                {/* Real-Time Interactive Notification Bell (Admin Portal) */}
                <NotificationBell
                  role="ADMIN"
                  assignments={assignments}
                  notifications={notifications}
                  spreadsheetTitle={config.spreadsheetTitle}
                  lastSyncedAt={config.lastSyncedAt}
                  onSelectNotification={handleAdminBellSelect}
                  onQuickWhatsApp={handleAdminBellQuickWa}
                  onViewAllLogs={() => setActiveMenu('notifikasi_wa')}
                />

                <button
                  type="button"
                  onClick={onManualSync}
                  disabled={isSyncing}
                  title="Sinkronkan Database Google Spreadsheets"
                  aria-label="Sinkronkan Database Google Spreadsheets"
                  className="inline-flex h-10 w-10 sm:h-auto sm:w-auto items-center justify-center gap-2 rounded-xl sm:rounded-lg border border-slate-200 sm:border-slate-300 bg-white sm:px-3.5 sm:py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw
                    className={`h-4 w-4 sm:h-3.5 sm:w-3.5 ${
                      isSyncing ? 'animate-spin' : ''
                    }`}
                  />
                  <span className="hidden lg:inline">
                    {isSyncing ? 'Menyinkronkan...' : 'Sinkron Spreadsheets'}
                  </span>
                  <span className="hidden sm:inline lg:hidden">
                    {isSyncing ? 'Sinkron...' : 'Sinkron'}
                  </span>
                </button>

                {activeMenu === 'surat_tugas' && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setShowDailySummaryInDashboard((prev) => !prev)
                      }
                      className={`hidden sm:inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        showDailySummaryInDashboard
                          ? 'border-emerald-700 bg-emerald-700 text-white'
                          : 'border-emerald-300 bg-emerald-50 text-emerald-900 hover:bg-emerald-100'
                      }`}
                      title="Buka atau tutup panel Ringkasan Harian Performa Operasional Armada untuk dikirim ke WhatsApp"
                    >
                      <MessageSquare className="h-3.5 w-3.5" />
                      <span className="hidden xl:inline">
                        Ringkasan Harian WA
                      </span>
                      <span className="xl:hidden">Rekap WA</span>
                    </button>
                    <button
                      type="button"
                      onClick={openCreateAssignmentModal}
                      className="hidden sm:inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 sm:px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      <Plus className="h-4 w-4" />
                      Buat Surat Tugas
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Collapsible Mobile Search Input */}
            {(mobileSearchOpen || Boolean(searchQuery.trim())) && (
              <div className="border-t border-slate-100 bg-white px-3.5 py-2.5 md:hidden">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => handleGlobalSearchChange(e.target.value)}
                    placeholder="Cari Driver, No. Polisi, atau No. Tugas..."
                    aria-label="Pencarian cepat penugasan di perangkat mobile"
                    className="min-h-[42px] w-full rounded-xl border border-slate-300 bg-slate-50 py-2 pl-10 pr-20 text-sm text-slate-900 focus:border-slate-900 focus:bg-white focus:outline-none"
                  />
                  <div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                    {searchQuery.trim() && (
                      <span className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 tabular-nums">
                        {filteredAssignments.length}/{assignments.length}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setMobileSearchOpen(false);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-200/60 hover:text-slate-800"
                      aria-label="Tutup pencarian"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </div>
            )}
          </header>

          {/* Main Viewport */}
          <main className="flex-1 p-3.5 pb-24 sm:p-8 lg:pb-8 max-w-7xl w-full mx-auto">
            {(!googleUser && !config.spreadsheetId) &&
              activeMenu !== 'spreadsheets' && (
                <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50/80 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="text-sm font-semibold text-amber-950">
                      Hubungkan Sesi Permanen Google &amp; Database Spreadsheets
                    </p>
                    <p className="mt-0.5 text-xs text-amber-800">
                      Seluruh data di aplikasi tetap tersimpan aman dan tidak
                      akan hilang. Hubungkan Spreadsheet sekali saja agar sesi
                      sinkronisasi terikat secara permanen.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveMenu('spreadsheets')}
                    className="self-start rounded-lg bg-amber-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-amber-950 whitespace-nowrap shrink-0 sm:self-center"
                  >
                    Atur Database Spreadsheets
                  </button>
                </div>
              )}

            {/* ========================================================== */}
            {/* TAB 1: DASBOR SURAT TUGAS + RECHARTS + PDF PRINT           */}
            {/* ========================================================== */}
            {activeMenu === 'surat_tugas' && (
              <div className="space-y-6">
                {/* Post-Create 1-Click WhatsApp Quick Resend Bar */}
                {lastCreatedNotification && (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50/90 p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-bold text-emerald-950">
                          Surat Tugas {lastCreatedNotification.noPenugasan}{' '}
                          Diterbitkan — Aplikasi WhatsApp Dibuka Otomatis
                        </p>
                        <p className="mt-0.5 text-xs text-emerald-800">
                          Jika tab baru tertahan atau Anda ingin meneruskan ke
                          Grup WhatsApp maupun chat Driver, gunakan tombol
                          1-klik berikut:
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenNotifLogWa(
                              lastCreatedNotification,
                              'GROUP'
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                        >
                          <Users className="h-3.5 w-3.5" />
                          Kirim ke Grup WhatsApp
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleOpenNotifLogWa(
                              lastCreatedNotification,
                              'DRIVER'
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 whitespace-nowrap"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          WA Driver
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const matchedTask = assignments.find(
                              (a) =>
                                a.noPenugasan ===
                                lastCreatedNotification.noPenugasan
                            );
                            const matchedDriver = drivers.find(
                              (d) =>
                                d.id.trim().toLowerCase() ===
                                lastCreatedNotification.driverId
                                  .trim()
                                  .toLowerCase()
                            );
                            onCopyText(
                              buildDriverPortalLink({
                                driverId: lastCreatedNotification.driverId,
                                taskId: matchedTask?.id,
                                taskNo: lastCreatedNotification.noPenugasan,
                                customBaseUrl: config.publicPortalBaseUrl,
                                driverSnapshot: matchedDriver,
                                taskSnapshot: matchedTask,
                              }),
                              `Link Tugas Driver (${lastCreatedNotification.noPenugasan})`
                            );
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 whitespace-nowrap"
                        >
                          <Link2 className="h-3.5 w-3.5" />
                          Salin Link Driver
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const freshLine = `Waktu Pesan WA : ${formatRealTimeTimestamp(
                              new Date()
                            )}`;
                            const cleanMsg = stripDriverLinkFromWaMessage(
                              lastCreatedNotification.message
                            );
                            const msg = cleanMsg.includes('Waktu Pesan WA :')
                              ? cleanMsg.replace(
                                  /^Waktu Pesan WA :.*$/m,
                                  freshLine
                                )
                              : cleanMsg;
                            onCopyText(msg, 'Pesan Surat Tugas WhatsApp');
                          }}
                          className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 whitespace-nowrap"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Salin Pesan
                        </button>
                        <button
                          type="button"
                          onClick={() => setLastCreatedNotification(null)}
                          className="rounded-lg p-1.5 text-emerald-800 hover:bg-emerald-100"
                          aria-label="Tutup banner WhatsApp"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* Daily Operational Summary WhatsApp Generator (Collapsible in Dashboard) */}
                {showDailySummaryInDashboard && (
                  <DailyOperationalSummaryPanel
                    assignments={assignments}
                    vehicles={vehicles}
                    drivers={drivers}
                    notifications={notifications}
                    config={config}
                    onCopyText={onCopyText}
                    defaultShowPreview
                  />
                )}

                {/* Mobile Quick Operational Shortcuts (Non-Sticky, Ergonomic 2-Col) */}
                <div className="grid grid-cols-2 gap-2.5 sm:hidden">
                  <button
                    type="button"
                    onClick={() =>
                      setShowDailySummaryInDashboard((prev) => !prev)
                    }
                    className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
                      showDailySummaryInDashboard
                        ? 'border-emerald-700 bg-emerald-700 text-white'
                        : 'border-emerald-200 bg-emerald-50/90 text-emerald-900'
                    }`}
                  >
                    <MessageSquare className="h-3.5 w-3.5 shrink-0" />
                    Rekap Harian WA
                  </button>
                  <button
                    type="button"
                    onClick={() => setDriverLinkModalOpen(true)}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50/90 px-3 py-2 text-xs font-semibold text-sky-900 transition-colors"
                  >
                    <Link2 className="h-3.5 w-3.5 shrink-0 text-sky-700" />
                    Link Khusus Driver
                  </button>
                </div>

                {/* Flat KPI Strip (6 Metrics Including Utilitas Muatan) */}
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl sm:rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3 lg:grid-cols-6">
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Total Surat Tugas
                    </p>
                    <p className="mt-1 sm:mt-1.5 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                      {statusCounts.all}
                    </p>
                  </div>
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Menunggu Berangkat
                    </p>
                    <p className="mt-1 sm:mt-1.5 font-mono text-xl sm:text-2xl font-bold text-amber-700 tabular-nums">
                      {statusCounts.menunggu}
                    </p>
                  </div>
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Dalam Perjalanan
                    </p>
                    <p className="mt-1 sm:mt-1.5 font-mono text-xl sm:text-2xl font-bold text-sky-700 tabular-nums">
                      {statusCounts.perjalanan}
                    </p>
                  </div>
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Delivered (Tiba)
                    </p>
                    <p className="mt-1 sm:mt-1.5 font-mono text-xl sm:text-2xl font-bold text-indigo-700 tabular-nums">
                      {statusCounts.delivered}
                    </p>
                  </div>
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Handover / Selesai
                    </p>
                    <p className="mt-1 sm:mt-1.5 font-mono text-xl sm:text-2xl font-bold text-emerald-700 tabular-nums">
                      {statusCounts.handover}
                    </p>
                  </div>
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Utilitas Muatan
                    </p>
                    <p className="mt-1 sm:mt-1.5 font-mono text-xl sm:text-2xl font-bold text-slate-900 tabular-nums">
                      {loadStats.avgUtilizationPct !== null
                        ? `${loadStats.avgUtilizationPct}%`
                        : loadStats.fleetActivePct !== null
                        ? `${loadStats.fleetActivePct}%`
                        : '—'}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                      {loadStats.avgUtilizationPct !== null
                        ? `${loadStats.measuredTripsCount} muatan terukur`
                        : `${loadStats.activeVehiclesCount}/${vehicles.length} unit aktif`}
                    </p>
                  </div>
                </div>

                {/* ========================================================= */}
                {/* PERHITUNGAN CBM MUATAN PER UNIT (STATUS SEDANG BERTUGAS)  */}
                {/* ========================================================= */}
                <section className="overflow-hidden rounded-2xl sm:rounded-xl border border-slate-200 bg-white">
                  <div className="flex flex-col gap-3 border-b border-slate-200 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
                    <div>
                      <div className="flex items-center gap-2">
                        <Box className="h-4 w-4 shrink-0 text-sky-700" />
                        <h2 className="text-sm sm:text-base font-bold text-slate-900">
                          Perhitungan CBM Muatan Per Unit (Status Sedang Bertugas)
                        </h2>
                      </div>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Kalkulasi otomatis volume kubikasi muatan (CBM / m³), sisa ruang box, dan persentase utilitas pada seluruh unit armada berstatus{' '}
                        <span className="font-semibold text-slate-800">Dalam Tugas</span>{' '}
                        (Menunggu Berangkat, Dalam Perjalanan, atau Delivered).
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => {
                          setActiveMenu('master_data');
                          setMasterTab('vehicles');
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        Atur Kapasitas CBM Unit
                      </button>
                      {onPurgeAssignmentsCache && assignments.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            triggerConfirm({
                              open: true,
                              title: 'Bersihkan Cache & Data Surat Tugas?',
                              description:
                                'Seluruh Surat Tugas dan cache tugas akan dikosongkan agar Anda dapat memulai dari 0 data bersih. Master Driver, Master Armada, Master Rute, dan sesi login tetap aman tersimpan.',
                              details: [
                                `Total Surat Tugas Dihapus : ${assignments.length} data`,
                                `Status Unit Armada        : Dikembalikan ke Siap Jalan`,
                                `Master Data & PIN Admin   : Tetap Utuh (Tidak Dihapus)`,
                              ],
                              confirmLabel: 'Bersihkan Surat Tugas',
                              variant: 'danger',
                              action: async () => {
                                await onPurgeAssignmentsCache();
                              },
                            })
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-700 hover:bg-red-100 whitespace-nowrap"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          Bersihkan Cache Surat Tugas
                        </button>
                      )}
                    </div>
                  </div>

                  {/* CBM KPI Summary Strip */}
                  <div className="grid grid-cols-2 gap-px border-b border-slate-200 bg-slate-200 sm:grid-cols-5">
                    <div className="bg-slate-50/70 p-3.5 sm:p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Unit Sedang Bertugas
                      </p>
                      <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
                        {activeUnitsCbm.activeUnitsCount}{' '}
                        <span className="text-xs font-medium text-slate-500">
                          Unit
                        </span>
                      </p>
                    </div>
                    <div className="bg-slate-50/70 p-3.5 sm:p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Total CBM Muatan Aktif
                      </p>
                      <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-sky-700 tabular-nums">
                        {formatCbmValue(activeUnitsCbm.totalUsedCbm)}
                      </p>
                    </div>
                    <div className="bg-slate-50/70 p-3.5 sm:p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Kapasitas CBM Unit Aktif
                      </p>
                      <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
                        {activeUnitsCbm.totalCapacityCbm > 0
                          ? formatCbmValue(activeUnitsCbm.totalCapacityCbm)
                          : '—'}
                      </p>
                    </div>
                    <div className="bg-slate-50/70 p-3.5 sm:p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Sisa Ruang CBM Aktif
                      </p>
                      <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-emerald-700 tabular-nums">
                        {activeUnitsCbm.totalCapacityCbm > 0
                          ? formatCbmValue(activeUnitsCbm.totalRemainingCbm)
                          : '—'}
                      </p>
                    </div>
                    <div className="col-span-2 sm:col-span-1 bg-slate-50/70 p-3.5 sm:p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Rata-Rata Utilitas CBM
                      </p>
                      <p className="mt-1 font-mono text-lg sm:text-xl font-bold text-slate-900 tabular-nums">
                        {activeUnitsCbm.avgUtilizationPct !== null
                          ? `${activeUnitsCbm.avgUtilizationPct}%`
                          : '—'}
                      </p>
                    </div>
                  </div>

                  {/* Per-Unit CBM Breakdown */}
                  {activeUnitsCbm.units.length === 0 ? (
                    <div className="px-6 py-8 text-center">
                      <p className="text-sm font-semibold text-slate-800">
                        Belum Ada Unit Berstatus Sedang Bertugas (0 CBM Aktif)
                      </p>
                      <p className="mx-auto mt-1 max-w-xl text-xs text-slate-500">
                        Saat Surat Tugas diterbitkan dan unit berstatus Dalam Tugas, rincian perhitungan kubikasi CBM terpakai, kapasitas box CBM, dan sisa ruang muatan per Nomor Polisi akan tampil otomatis di sini.
                      </p>
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {activeUnitsCbm.units.map((unit) => {
                        const isOverload = unit.overCbm > 0;
                        const barPct =
                          unit.utilizationPct !== null
                            ? Math.min(100, Math.max(0, unit.utilizationPct))
                            : unit.usedCbm > 0
                            ? 100
                            : 0;
                        return (
                          <div
                            key={`${unit.unitId}-${unit.plateNumber}`}
                            className="p-4 sm:px-6 sm:py-4 hover:bg-slate-50/60 transition-colors"
                          >
                            <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-2">
                                  <span className="font-mono text-sm font-bold text-slate-900">
                                    {unit.plateNumber}
                                  </span>
                                  <span className="font-mono text-xs text-slate-500 tabular-nums">
                                    ({unit.unitId})
                                  </span>
                                  <span className="rounded border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-semibold text-sky-800">
                                    Sedang Bertugas · {unit.activeAssignments.length} Tugas
                                  </span>
                                  {isOverload && (
                                    <span className="inline-flex items-center gap-1 rounded border border-red-200 bg-red-50 px-2 py-0.5 font-mono text-[11px] font-semibold text-red-700 tabular-nums">
                                      <AlertTriangle className="h-3 w-3" />
                                      Overload +{formatCbmValue(unit.overCbm)}
                                    </span>
                                  )}
                                </div>
                                <p className="mt-0.5 text-xs text-slate-600">
                                  {unit.vehicleType}
                                </p>
                              </div>

                              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:gap-6 shrink-0">
                                <div>
                                  <p className="text-[11px] text-slate-500">
                                    Muatan Terpakai
                                  </p>
                                  <p className="font-mono text-sm font-bold text-sky-700 tabular-nums">
                                    {unit.usedCbmDisplay}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-500">
                                    Kapasitas Box
                                  </p>
                                  <p className="font-mono text-sm font-semibold text-slate-900 tabular-nums">
                                    {unit.capacityCbmDisplay}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-500">
                                    Sisa Ruang CBM
                                  </p>
                                  <p
                                    className={`font-mono text-sm font-semibold tabular-nums ${
                                      isOverload
                                        ? 'text-red-600'
                                        : 'text-emerald-700'
                                    }`}
                                  >
                                    {isOverload
                                      ? `0 CBM (-${formatCbmValue(unit.overCbm)})`
                                      : unit.remainingCbmDisplay}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[11px] text-slate-500">
                                    Utilitas CBM
                                  </p>
                                  <p
                                    className={`font-mono text-sm font-bold tabular-nums ${
                                      isOverload
                                        ? 'text-red-600'
                                        : unit.utilizationPct !== null &&
                                          unit.utilizationPct >= 75
                                        ? 'text-emerald-700'
                                        : 'text-slate-900'
                                    }`}
                                  >
                                    {unit.utilizationPct !== null
                                      ? `${unit.utilizationPct}%`
                                      : '—'}
                                  </p>
                                </div>
                              </div>
                            </div>

                            {/* Utilization Progress Bar */}
                            {unit.capacityCbm !== null && unit.capacityCbm > 0 && (
                              <div className="mt-2.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                                <div
                                  className={`h-full rounded-full transition-all ${
                                    isOverload
                                      ? 'bg-red-600'
                                      : unit.utilizationPct !== null &&
                                        unit.utilizationPct >= 75
                                      ? 'bg-emerald-600'
                                      : 'bg-sky-600'
                                  }`}
                                  style={{ width: `${barPct}%` }}
                                />
                              </div>
                            )}

                            {/* Active Assignments on This Unit */}
                            {unit.activeAssignments.length > 0 && (
                              <div className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                                {unit.activeAssignments.map((item) => (
                                  <div
                                    key={item.id}
                                    className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/90 bg-slate-50/70 px-3 py-1.5 text-xs"
                                  >
                                    <div className="min-w-0 truncate">
                                      <span className="font-mono font-semibold text-slate-900 tabular-nums">
                                        {item.noPenugasan}
                                      </span>
                                      <span className="mx-1.5 text-slate-300">
                                        ·
                                      </span>
                                      <span className="font-medium text-slate-700">
                                        {item.driverName}
                                      </span>
                                      <span className="mx-1.5 text-slate-300">
                                        →
                                      </span>
                                      <span className="text-slate-600">
                                        {item.destination}
                                      </span>
                                    </div>
                                    <span className="shrink-0 font-mono font-bold text-slate-900 tabular-nums">
                                      {item.volumeCbm > 0
                                        ? formatCbmValue(item.volumeCbm)
                                        : item.volumeDisplay}
                                    </span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* On-Time Delivery Summary & Schedule Visualization Section */}
                <OnTimeDeliverySummarySection assignments={assignments} />

                {/* Cargo / Fleet Load Utilization Section */}
                <LoadUtilizationSection
                  assignments={assignments}
                  vehicles={vehicles}
                />

                {/* Recharts Data Visualization Section */}
                <DashboardChartsSection
                  assignments={assignments}
                  drivers={drivers}
                />

                {/* Fleet Card Expense Calculation Visualization on Admin Dashboard */}
                <FleetCardExpenseVisualizationSection
                  fleetCards={fleetCards}
                  driverExpenses={driverExpenses}
                  onOpenFleetCardMenu={() => setActiveMenu('master_fleet_card')}
                  onOpenExpensesMenu={() => setActiveMenu('pengeluaran_driver')}
                  onPdfDownloaded={(fileName, rowCount) =>
                    onNotify?.(
                      'success',
                      'Laporan PDF Berhasil Diunduh',
                      `${fileName} (${rowCount} data pengeluaran).`
                    )
                  }
                />

                {/* Search Bar + Swipeable Status Filter */}
                <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                  <div className="relative w-full lg:max-w-md">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => handleGlobalSearchChange(e.target.value)}
                      placeholder="Filter Nama Driver, No. Polisi (Plat), atau ID Penugasan..."
                      aria-label="Filter penugasan berdasarkan Nama Driver, Nomor Polisi, atau ID Penugasan"
                      className="min-h-[42px] w-full rounded-xl lg:rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-9 text-sm text-slate-900 transition-colors focus:border-slate-900 focus:outline-none"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                        aria-label="Bersihkan pencarian"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl lg:rounded-lg bg-slate-200/75 p-1">
                    {(
                      [
                        ['ALL', `Semua (${statusCounts.all})`],
                        [
                          TaskStatus.MENUNGGU_BERANGKAT,
                          `Menunggu (${statusCounts.menunggu})`,
                        ],
                        [
                          TaskStatus.DALAM_PERJALANAN,
                          `Perjalanan (${statusCounts.perjalanan})`,
                        ],
                        [
                          TaskStatus.DELIVERED,
                          `Delivered (${statusCounts.delivered})`,
                        ],
                        [
                          TaskStatus.HANDOVER,
                          `Handover (${statusCounts.handover})`,
                        ],
                      ] as Array<['ALL' | TaskStatus, string]>
                    ).map(([val, label]) => (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setStatusFilter(val)}
                        className={`min-h-[36px] sm:min-h-0 rounded-lg sm:rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                          statusFilter === val
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* High-Density Cold Chain Assignments Container (Mobile Card Stack + Desktop Table) */}
                <div className="overflow-hidden rounded-2xl sm:rounded-xl border border-slate-200 bg-white">
                  {filteredAssignments.length === 0 ? (
                    <div className="p-10 sm:p-12 text-center">
                      <ClipboardList className="mx-auto h-8 w-8 text-slate-400" />
                      <h3 className="mt-3 text-base font-semibold text-slate-900">
                        {assignments.length === 0
                          ? 'Belum Ada Data Surat Tugas'
                          : 'Tidak Ada Penugasan yang Cocok'}
                      </h3>
                      <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                        {assignments.length === 0
                          ? 'Buat Surat Tugas pengiriman dingin pertama dengan penomoran berurutan otomatis.'
                          : 'Ubah kata kunci pencarian atau pilih filter status lainnya.'}
                      </p>
                      {assignments.length === 0 && (
                        <button
                          type="button"
                          onClick={openCreateAssignmentModal}
                          className="mt-5 inline-flex min-h-[42px] items-center gap-2 rounded-xl sm:rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          <Plus className="h-4 w-4" />
                          Buat Surat Tugas Pertama
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      {/* Mobile Ergonomic Card List (< md) */}
                      <div className="divide-y divide-slate-200 md:hidden">
                        {filteredAssignments.map((asg) => {
                          const otd = evaluateAssignmentOtd(asg);
                          const loadEval = evaluateAssignmentLoadUtilization(
                            asg,
                            vehicles
                          );
                          const statusTimeline =
                            resolveAssignmentStatusTimeline(asg, notifications);
                          const isTimelineExpanded =
                            expandedTimelineId === asg.id;
                          const sjList = parseSuratJalanList(
                            asg.noSuratJalanFisik
                          );
                          const isNonPendingin =
                            asg.departureData?.jenisKendaraan ===
                            'Non Pendingin';
                          const displayOrigin =
                            asg.departureData?.titikKeberangkatan || asg.origin;
                          const photoStats = countAssignmentPhotos(asg);
                          const folderHref =
                            asg.driveMedia?.folderUrl ||
                            asg.driveFolderUrl ||
                            '';

                          return (
                            <div
                              key={`m-${asg.id}`}
                              className={`p-4 transition-colors ${
                                isTimelineExpanded ? 'bg-slate-50/70' : ''
                              }`}
                            >
                              {/* Top Metadata & Status */}
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs text-slate-600 tabular-nums">
                                    <span className="font-bold text-slate-900">
                                      {asg.noPenugasan}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span>{asg.tanggalTugas}</span>
                                    {asg.jadwalJamTiba && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span>SLA {asg.jadwalJamTiba}</span>
                                      </>
                                    )}
                                  </div>
                                  <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[11px] font-mono text-slate-500 tabular-nums">
                                    <span>Segel: {asg.kodeSegel || '-'}</span>
                                    {sjList.length > 0 && (
                                      <>
                                        <span aria-hidden="true">·</span>
                                        <span className="truncate max-w-[190px]">
                                          SJ: {sjList.join(', ')}
                                        </span>
                                      </>
                                    )}
                                  </div>
                                </div>

                                <div className="shrink-0 text-right text-xs font-semibold">
                                  {asg.status ===
                                    TaskStatus.MENUNGGU_BERANGKAT && (
                                    <span className="inline-flex items-center gap-1 text-amber-700">
                                      <Clock className="h-3.5 w-3.5 shrink-0" />
                                      Menunggu
                                    </span>
                                  )}
                                  {asg.status ===
                                    TaskStatus.DALAM_PERJALANAN && (
                                    <span className="inline-flex items-center gap-1 text-sky-700">
                                      <Navigation className="h-3.5 w-3.5 shrink-0" />
                                      Perjalanan
                                    </span>
                                  )}
                                  {asg.status === TaskStatus.DELIVERED && (
                                    <span className="inline-flex items-center gap-1 text-indigo-700">
                                      <PackageCheck className="h-3.5 w-3.5 shrink-0" />
                                      Delivered
                                    </span>
                                  )}
                                  {(asg.status === TaskStatus.HANDOVER ||
                                    asg.status === TaskStatus.SELESAI) && (
                                    <span className="inline-flex items-center gap-1 text-emerald-700">
                                      <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                      {asg.status === TaskStatus.HANDOVER
                                        ? 'Handover'
                                        : 'Selesai'}
                                    </span>
                                  )}
                                </div>
                              </div>

                              {/* Route Headline */}
                              <p className="mt-2 text-sm font-bold leading-snug text-slate-900">
                                {displayOrigin} → {asg.destination}
                              </p>

                              {/* Driver & Fleet Line */}
                              <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-slate-700">
                                <span className="font-semibold text-slate-900">
                                  {asg.driverName}
                                </span>
                                <span className="font-mono text-slate-500 tabular-nums">
                                  ({asg.driverId})
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono font-semibold text-slate-800">
                                  {asg.plateNumber}
                                </span>
                                {(asg.departureData?.jenisKendaraan ||
                                  asg.vehicleType) && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-slate-500">
                                      {asg.departureData?.jenisKendaraan ||
                                        asg.vehicleType}
                                    </span>
                                  </>
                                )}
                              </div>

                              {/* Cargo, Temperature, OTD & Drive Telemetry */}
                              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] font-mono text-slate-600 tabular-nums">
                                <span>
                                  {statusTimeline.inlineTransitionSummary}
                                </span>
                                {otd.category === 'ON_TIME' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-semibold text-emerald-700">
                                      Tepat Waktu
                                    </span>
                                  </>
                                )}
                                {otd.category === 'LATE_COMPLETED' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-semibold text-red-600">
                                      Terlambat +
                                      {formatDurationMinutes(otd.delayMinutes)}
                                    </span>
                                  </>
                                )}
                                {otd.category === 'OVERDUE_ACTIVE' && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-semibold text-amber-700">
                                      Lewat Jadwal +
                                      {formatDurationMinutes(otd.delayMinutes)}
                                    </span>
                                  </>
                                )}
                                {!isNonPendingin &&
                                  (asg.departureData?.suhuAwal ||
                                    asg.handoverData?.suhuAkhir) && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span>
                                        Suhu:{' '}
                                        {asg.departureData?.suhuAwal || '-'}
                                        {asg.handoverData?.suhuAkhir
                                          ? ` → ${asg.handoverData.suhuAkhir}`
                                          : ''}
                                      </span>
                                    </>
                                  )}
                                {asg.volumeCbm && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-semibold text-sky-800">
                                      CBM: {asg.volumeCbm}
                                    </span>
                                  </>
                                )}
                                {loadEval.utilizationPct !== null && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-semibold text-slate-800">
                                      Muatan {loadEval.utilizationPct}%
                                    </span>
                                  </>
                                )}
                                {folderHref ? (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <a
                                      href={folderHref}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-semibold text-sky-700 underline"
                                    >
                                      Drive ({photoStats.syncedToDrive}/
                                      {photoStats.totalUploaded})
                                    </a>
                                  </>
                                ) : photoStats.totalUploaded > 0 ? (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="text-amber-700">
                                      Foto ({photoStats.totalUploaded})
                                    </span>
                                  </>
                                ) : null}
                              </div>

                              {/* Touch-Friendly Action Strip */}
                              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenAssignmentWa(asg, 'GROUP')
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white active:scale-[0.98]"
                                >
                                  <Users className="h-3.5 w-3.5" />
                                  WA Grup
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenAssignmentWa(asg, 'DRIVER')
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-emerald-200 bg-emerald-50 px-2.5 py-1.5 text-xs font-semibold text-emerald-800 active:scale-[0.98]"
                                >
                                  <ExternalLink className="h-3.5 w-3.5" />
                                  WA Driver
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    setExpandedTimelineId((prev) =>
                                      prev === asg.id ? null : asg.id
                                    )
                                  }
                                  className={`inline-flex min-h-[38px] items-center gap-1 rounded-xl border px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                                    isTimelineExpanded
                                      ? 'border-slate-900 bg-slate-900 text-white'
                                      : 'border-slate-200 bg-white text-slate-700'
                                  }`}
                                >
                                  <Clock className="h-3.5 w-3.5" />
                                  Riwayat
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setPrintableAssignment(asg)}
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700"
                                >
                                  <Printer className="h-3.5 w-3.5" />
                                  PDF
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    guardDriverLinkAction(() => {
                                      const matchedDrv = drivers.find(
                                        (d) =>
                                          d.id.trim().toLowerCase() ===
                                          asg.driverId.trim().toLowerCase()
                                      );
                                      onCopyText(
                                        buildDriverPortalLink({
                                          driverId: asg.driverId,
                                          taskId: asg.id,
                                          taskNo: asg.noPenugasan,
                                          customBaseUrl:
                                            config.publicPortalBaseUrl,
                                          driverSnapshot: matchedDrv,
                                          taskSnapshot: asg,
                                        }),
                                        `Link Khusus Driver (${asg.noPenugasan})`
                                      );
                                    })
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-900"
                                >
                                  <Link2 className="h-3.5 w-3.5 text-sky-700" />
                                  Link
                                </button>
                                <div className="ml-auto flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => openEditAssignmentModal(asg)}
                                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-slate-100"
                                    aria-label={`Edit ${asg.noPenugasan}`}
                                  >
                                    <Edit3 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      triggerConfirm({
                                        open: true,
                                        title: 'Hapus Surat Tugas?',
                                        description:
                                          'Surat Tugas ini akan dihapus secara permanen dari aplikasi dan lembar Surat_Tugas di Google Spreadsheets.',
                                        details: [
                                          `No. Penugasan : ${asg.noPenugasan}`,
                                          `Driver        : ${asg.driverId} - ${asg.driverName}`,
                                          `Rute          : ${asg.origin} -> ${asg.destination}`,
                                        ],
                                        confirmLabel: 'Hapus Surat Tugas',
                                        variant: 'danger',
                                        action: async () => {
                                          await onDeleteAssignment(asg.id);
                                        },
                                      })
                                    }
                                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600"
                                    aria-label={`Hapus ${asg.noPenugasan}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>

                              {/* Expanded Inline Timeline on Mobile */}
                              {isTimelineExpanded && (
                                <div className="mt-3.5 rounded-2xl border border-slate-200 bg-white p-3.5">
                                  <div className="mb-3 flex items-center justify-between gap-2">
                                    <h4 className="text-xs font-bold text-slate-900">
                                      Timeline Status Armada
                                    </h4>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setTimelineModalAssignment(asg)
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg bg-slate-900 px-2.5 py-1.5 text-[11px] font-semibold text-white"
                                    >
                                      <Users className="h-3 w-3" />
                                      Detail &amp; Kirim WA
                                    </button>
                                  </div>
                                  <AssignmentStatusTimelineView
                                    assignment={asg}
                                    notifications={notifications}
                                    compact
                                  />
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* Desktop Full Multi-Column Table (md+) */}
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full border-collapse text-left text-sm">
                        <thead>
                          <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                            <th className="px-4 py-3 whitespace-nowrap">
                              ID &amp; No. Penugasan
                            </th>
                            <th className="px-4 py-3 whitespace-nowrap">
                              Jadwal &amp; OTD
                            </th>
                            <th className="px-4 py-3 whitespace-nowrap">
                              Driver
                            </th>
                            <th className="px-4 py-3 whitespace-nowrap">
                              Armada
                            </th>
                            <th className="px-4 py-3 whitespace-nowrap">
                              Titik Berangkat → Tujuan
                            </th>
                            <th className="px-4 py-3 whitespace-nowrap">
                              Status &amp; Riwayat Transisi
                            </th>
                            <th className="px-4 py-3 text-right whitespace-nowrap">
                              Aksi (Riwayat / PDF / WA / Edit)
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-200">
                          {filteredAssignments.map((asg) => {
                            const otd = evaluateAssignmentOtd(asg);
                            const loadEval = evaluateAssignmentLoadUtilization(
                              asg,
                              vehicles
                            );
                            const statusTimeline =
                              resolveAssignmentStatusTimeline(
                                asg,
                                notifications
                              );
                            const isTimelineExpanded =
                              expandedTimelineId === asg.id;
                            const sjList = parseSuratJalanList(
                              asg.noSuratJalanFisik
                            );
                            const isNonPendingin =
                              asg.departureData?.jenisKendaraan ===
                              'Non Pendingin';
                            const displayOrigin =
                              asg.departureData?.titikKeberangkatan ||
                              asg.origin;
                            return (
                              <React.Fragment key={asg.id}>
                                <tr
                                  className={`transition-colors hover:bg-slate-50/80 ${
                                    isTimelineExpanded ? 'bg-slate-50/70' : ''
                                  }`}
                                >
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                      {asg.noPenugasan}
                                    </div>
                                    <div className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                                      ID: {asg.id} · Segel: {asg.kodeSegel || '-'}
                                    </div>
                                    {sjList.length > 0 && (
                                      <div
                                        className="mt-0.5 max-w-[230px] truncate font-mono text-[11px] text-slate-600 tabular-nums"
                                        title={sjList.join(', ')}
                                      >
                                        {sjList.length > 1
                                          ? `SJ (${sjList.length}): ${sjList.join(', ')}`
                                          : `SJ: ${sjList[0]}`}
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="font-mono text-xs text-slate-800 tabular-nums">
                                      {asg.tanggalTugas}
                                      {asg.jadwalJamTiba
                                        ? ` · ${asg.jadwalJamTiba}`
                                        : ''}
                                    </div>
                                    <div className="mt-0.5 text-[11px] font-medium tabular-nums">
                                      {otd.category === 'ON_TIME' && (
                                        <span className="text-emerald-700">
                                          Tepat Waktu
                                        </span>
                                      )}
                                      {otd.category === 'LATE_COMPLETED' && (
                                        <span className="text-red-600">
                                          Terlambat +
                                          {formatDurationMinutes(
                                            otd.delayMinutes
                                          )}
                                        </span>
                                      )}
                                      {otd.category === 'ON_TRACK_ACTIVE' && (
                                        <span className="text-slate-500">
                                          Sesuai Jadwal
                                        </span>
                                      )}
                                      {otd.category === 'OVERDUE_ACTIVE' && (
                                        <span className="text-amber-700">
                                          Lewat Jadwal +
                                          {formatDurationMinutes(
                                            otd.delayMinutes
                                          )}
                                        </span>
                                      )}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="font-medium text-slate-900">
                                      {asg.driverName}
                                    </div>
                                    <div className="font-mono text-xs text-slate-500 tabular-nums">
                                      {asg.driverId}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap">
                                    <div className="font-mono text-xs font-semibold text-slate-900">
                                      {asg.plateNumber}
                                    </div>
                                    <div className="text-xs text-slate-500">
                                      {asg.departureData?.jenisKendaraan ||
                                        asg.vehicleType ||
                                        '-'}
                                    </div>
                                    {loadEval.utilizationPct !== null && (
                                      <div
                                        className={`mt-0.5 font-mono text-[11px] font-semibold tabular-nums ${
                                          loadEval.category === 'OVERLOAD'
                                            ? 'text-red-600'
                                            : loadEval.category === 'OPTIMAL'
                                            ? 'text-emerald-700'
                                            : loadEval.category === 'MODERATE'
                                            ? 'text-sky-700'
                                            : 'text-amber-700'
                                        }`}
                                      >
                                        Utilitas: {loadEval.utilizationPct}%
                                      </div>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 max-w-xs">
                                    <div className="truncate font-medium text-slate-900">
                                      {displayOrigin} → {asg.destination}
                                    </div>
                                    <div className="truncate text-xs text-slate-500">
                                      {asg.purpose || '-'}
                                      {asg.beratMuatan
                                        ? ` · ${asg.beratMuatan}`
                                        : ''}
                                      {asg.volumeCbm
                                        ? ` · CBM: ${asg.volumeCbm}`
                                        : ''}
                                    </div>
                                  </td>
                                  <td className="px-4 py-3 whitespace-nowrap text-xs font-semibold">
                                    <div>
                                      {asg.status ===
                                        TaskStatus.MENUNGGU_BERANGKAT && (
                                        <span className="inline-flex items-center gap-1.5 text-amber-700">
                                          <Clock className="h-3.5 w-3.5 shrink-0" />
                                          Menunggu Berangkat
                                        </span>
                                      )}
                                      {asg.status ===
                                        TaskStatus.DALAM_PERJALANAN && (
                                        <span className="inline-flex items-center gap-1.5 text-sky-700">
                                          <Navigation className="h-3.5 w-3.5 shrink-0" />
                                          Dalam Perjalanan
                                        </span>
                                      )}
                                      {asg.status === TaskStatus.DELIVERED && (
                                        <span className="inline-flex items-center gap-1.5 text-indigo-700">
                                          <PackageCheck className="h-3.5 w-3.5 shrink-0" />
                                          Delivered
                                        </span>
                                      )}
                                      {asg.status === TaskStatus.HANDOVER && (
                                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                          Handover
                                        </span>
                                      )}
                                      {asg.status === TaskStatus.SELESAI && (
                                        <span className="inline-flex items-center gap-1.5 text-emerald-700">
                                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                                          Selesai
                                        </span>
                                      )}
                                    </div>
                                    <div
                                      className="mt-0.5 font-mono text-[11px] font-normal text-slate-600 tabular-nums"
                                      title="Riwayat transisi waktu Keberangkatan ke Delivered"
                                    >
                                      {statusTimeline.inlineTransitionSummary}
                                    </div>
                                    {isNonPendingin ? (
                                      <div className="mt-0.5 font-mono text-[11px] font-normal text-slate-500">
                                        Non Pendingin
                                      </div>
                                    ) : (asg.departureData?.suhuAwal ||
                                        asg.handoverData?.suhuAkhir) ? (
                                      <div className="mt-0.5 font-mono text-[11px] font-normal text-slate-500 tabular-nums">
                                        Suhu:{' '}
                                        {asg.departureData?.suhuAwal || '-'}
                                        {asg.handoverData?.suhuAkhir
                                          ? ` → ${asg.handoverData.suhuAkhir}`
                                          : ''}
                                      </div>
                                    ) : null}
                                    {(() => {
                                      const photoStats =
                                        countAssignmentPhotos(asg);
                                      const folderHref =
                                        asg.driveMedia?.folderUrl ||
                                        asg.driveFolderUrl ||
                                        '';
                                      const odoDepHref =
                                        asg.driveMedia
                                          ?.fotoOdometerBerangkatUrl || '';
                                      const suhuHref =
                                        asg.driveMedia?.fotoSuhuBerangkatUrl ||
                                        asg.driveMedia?.fotoSuhuSerahTerimaUrl ||
                                        '';
                                      const buktiHref =
                                        asg.driveMedia
                                          ?.fotoBuktiSerahTerimaUrl || '';
                                      if (
                                        !folderHref &&
                                        !odoDepHref &&
                                        !suhuHref &&
                                        !buktiHref &&
                                        photoStats.totalUploaded === 0
                                      ) {
                                        return null;
                                      }
                                      return (
                                        <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-normal text-[11px] text-slate-500">
                                          {folderHref ? (
                                            <a
                                              href={folderHref}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="inline-flex items-center gap-0.5 font-semibold text-sky-700 hover:underline"
                                              title="Buka Folder Foto Pengiriman di Google Drive"
                                            >
                                              Drive ({photoStats.syncedToDrive}/
                                              {photoStats.totalUploaded})
                                            </a>
                                          ) : (
                                            <span className="text-amber-700">
                                              Foto ({photoStats.totalUploaded}) ·
                                              Antre Drive
                                            </span>
                                          )}
                                          {odoDepHref && (
                                            <>
                                              <span aria-hidden="true">·</span>
                                              <a
                                                href={odoDepHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-slate-700 hover:text-sky-700 hover:underline"
                                                title="Buka Foto Odometer Keberangkatan di Google Drive"
                                              >
                                                Odo
                                              </a>
                                            </>
                                          )}
                                          {suhuHref && (
                                            <>
                                              <span aria-hidden="true">·</span>
                                              <a
                                                href={suhuHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-slate-700 hover:text-sky-700 hover:underline"
                                                title="Buka Foto Suhu di Google Drive"
                                              >
                                                Suhu
                                              </a>
                                            </>
                                          )}
                                          {buktiHref && (
                                            <>
                                              <span aria-hidden="true">·</span>
                                              <a
                                                href={buktiHref}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-slate-700 hover:text-sky-700 hover:underline"
                                                title="Buka Foto Bukti Serah Terima di Google Drive"
                                              >
                                                Bukti
                                              </a>
                                            </>
                                          )}
                                        </div>
                                      );
                                    })()}
                                  </td>
                                  <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setExpandedTimelineId((prev) =>
                                            prev === asg.id ? null : asg.id
                                          )
                                        }
                                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs font-semibold transition-colors ${
                                          isTimelineExpanded
                                            ? 'border-slate-900 bg-slate-900 text-white'
                                            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-100 hover:text-slate-900'
                                        }`}
                                        title="Lihat Timeline Riwayat Status Armada (Keberangkatan → Delivered → Handover)"
                                      >
                                        <Clock className="h-3.5 w-3.5" />
                                        Riwayat
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setPrintableAssignment(asg)
                                        }
                                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900"
                                        title="Laporan Detail & Cetak PDF"
                                      >
                                        <Printer className="h-3.5 w-3.5" />
                                        PDF
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleOpenAssignmentWa(asg, 'GROUP')
                                        }
                                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                                        title="Kirim Surat Tugas ke Grup WhatsApp (Waktu Real-Time)"
                                      >
                                        <Users className="h-3.5 w-3.5" />
                                        WA Grup
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          handleOpenAssignmentWa(asg, 'DRIVER')
                                        }
                                        className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                                        title="Kirim ke Nomor WhatsApp Driver (Waktu Real-Time)"
                                      >
                                        <ExternalLink className="h-3.5 w-3.5" />
                                        WA Driver
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          guardDriverLinkAction(() => {
                                            const matchedDrv = drivers.find(
                                              (d) =>
                                                d.id.trim().toLowerCase() ===
                                                asg.driverId
                                                  .trim()
                                                  .toLowerCase()
                                            );
                                            onCopyText(
                                              buildDriverPortalLink({
                                                driverId: asg.driverId,
                                                taskId: asg.id,
                                                taskNo: asg.noPenugasan,
                                                customBaseUrl:
                                                  config.publicPortalBaseUrl,
                                                driverSnapshot: matchedDrv,
                                                taskSnapshot: asg,
                                              }),
                                              `Link Khusus Driver (${asg.noPenugasan})`
                                            );
                                          })
                                        }
                                        className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100"
                                        title="Salin Link Khusus Driver langsung ke Surat Tugas ini"
                                      >
                                        <Link2 className="h-3.5 w-3.5 text-sky-700" />
                                        Link
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openEditAssignmentModal(asg)
                                        }
                                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                        title="Edit Surat Tugas"
                                        aria-label={`Edit ${asg.noPenugasan}`}
                                      >
                                        <Edit3 className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          triggerConfirm({
                                            open: true,
                                            title: 'Hapus Surat Tugas?',
                                            description:
                                              'Surat Tugas ini akan dihapus secara permanen dari aplikasi dan lembar Surat_Tugas di Google Spreadsheets.',
                                            details: [
                                              `No. Penugasan : ${asg.noPenugasan}`,
                                              `Driver        : ${asg.driverId} - ${asg.driverName}`,
                                              `Rute          : ${asg.origin} -> ${asg.destination}`,
                                            ],
                                            confirmLabel: 'Hapus Surat Tugas',
                                            variant: 'danger',
                                            action: async () => {
                                              await onDeleteAssignment(asg.id);
                                            },
                                          })
                                        }
                                        className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                                        title="Hapus Surat Tugas"
                                        aria-label={`Hapus ${asg.noPenugasan}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                                {isTimelineExpanded && (
                                  <tr className="bg-slate-50/75">
                                    <td colSpan={7} className="px-5 py-4">
                                      <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                                        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                          <div>
                                            <h4 className="text-xs sm:text-sm font-bold text-slate-900">
                                              Riwayat Status Armada ·{' '}
                                              <span className="font-mono tabular-nums">
                                                {asg.noPenugasan}
                                              </span>
                                            </h4>
                                            <p className="mt-0.5 text-xs text-slate-500">
                                              Timeline kronologis perubahan
                                              status dari Keberangkatan ke
                                              Delivered hingga Serah Terima (
                                              {asg.plateNumber} ·{' '}
                                              {asg.driverName}).
                                            </p>
                                          </div>
                                          <div className="flex flex-wrap items-center gap-2 shrink-0">
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setTimelineModalAssignment(asg)
                                              }
                                              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
                                            >
                                              <Users className="h-3.5 w-3.5" />
                                              Detail &amp; Kirim WA Riwayat
                                            </button>
                                            <button
                                              type="button"
                                              onClick={() =>
                                                setExpandedTimelineId(null)
                                              }
                                              className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 whitespace-nowrap"
                                            >
                                              Tutup
                                            </button>
                                          </div>
                                        </div>
                                        <AssignmentStatusTimelineView
                                          assignment={asg}
                                          notifications={notifications}
                                          compact
                                        />
                                      </div>
                                    </td>
                                  </tr>
                                )}
                              </React.Fragment>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================== */}
            {/* TAB 2: DRIVER PERFORMANCE (Requirement #3)                 */}
            {/* ========================================================== */}
            {activeMenu === 'driver_performance' && (
              <DriverPerformanceView
                assignments={assignments}
                drivers={drivers}
              />
            )}

            {/* ========================================================== */}
            {/* TAB 3: MASTER DATA (DRIVER, ARMADA, RUTE TUJUAN)           */}
            {/* ========================================================== */}
            {activeMenu === 'master_data' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                  {/* 3 Segmented Master Category Tabs (Swipeable on Mobile) */}
                  <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl sm:rounded-lg bg-slate-200/75 p-1 w-full sm:w-auto sm:self-start">
                    <button
                      type="button"
                      onClick={() => setMasterTab('drivers')}
                      className={`min-h-[38px] sm:min-h-0 flex-1 sm:flex-none rounded-lg sm:rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                        masterTab === 'drivers'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Master Driver ({drivers.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMasterTab('vehicles')}
                      className={`min-h-[38px] sm:min-h-0 flex-1 sm:flex-none rounded-lg sm:rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                        masterTab === 'vehicles'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Master Armada ({vehicles.length})
                    </button>
                    <button
                      type="button"
                      onClick={() => setMasterTab('routes')}
                      className={`min-h-[38px] sm:min-h-0 flex-1 sm:flex-none rounded-lg sm:rounded-md px-3 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                        masterTab === 'routes'
                          ? 'bg-white text-slate-900 shadow-sm'
                          : 'text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      Master Rute ({routes.length})
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <div className="relative w-full sm:w-64">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        value={masterSearch}
                        onChange={(e) => setMasterSearch(e.target.value)}
                        placeholder="Cari di Master Data..."
                        className="min-h-[42px] sm:min-h-0 w-full rounded-xl sm:rounded-lg border border-slate-300 bg-white py-2 pl-9 pr-3 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    {masterTab === 'drivers' && (
                      <div className="flex w-full sm:w-auto items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setDriverLinkModalOpen(true)}
                          className="inline-flex min-h-[42px] sm:min-h-0 flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-xl sm:rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100 whitespace-nowrap shrink-0"
                        >
                          <Link2 className="h-3.5 w-3.5 text-sky-700" />
                          Link Driver
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            const nextIdx = drivers.length + 1;
                            setEditingDriverId(null);
                            setDriverForm({
                              id: `DRV-${String(nextIdx).padStart(3, '0')}`,
                              name: '',
                              phone: '',
                              pin: '',
                              licenseType: 'SIM B1',
                              active: true,
                            });
                            setDriverModalOpen(true);
                          }}
                          className="inline-flex min-h-[42px] sm:min-h-0 flex-1 sm:flex-none items-center justify-center gap-1.5 rounded-xl sm:rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Tambah Driver
                        </button>
                      </div>
                    )}

                    {masterTab === 'vehicles' && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextIdx = vehicles.length + 1;
                          setEditingVehicleId(null);
                          setVehicleForm({
                            id: `UNT-${String(nextIdx).padStart(3, '0')}`,
                            plateNumber: '',
                            vehicleType: '',
                            capacity: '',
                            capacityCbm: '',
                            status: 'Siap Jalan',
                          });
                          setVehicleModalOpen(true);
                        }}
                        className="inline-flex min-h-[42px] sm:min-h-0 w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl sm:rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Tambah Armada
                      </button>
                    )}

                    {masterTab === 'routes' && (
                      <button
                        type="button"
                        onClick={() => {
                          const nextIdx = routes.length + 1;
                          setEditingRouteId(null);
                          setRouteForm({
                            id: `RT-${String(nextIdx).padStart(3, '0')}`,
                            destination: '',
                            picName: '',
                            picPhone: '',
                          });
                          setRouteModalOpen(true);
                        }}
                        className="inline-flex min-h-[42px] sm:min-h-0 w-full sm:w-auto items-center justify-center gap-1.5 rounded-xl sm:rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        Tambah Rute Tujuan
                      </button>
                    )}
                  </div>
                </div>

                {/* SUB-TAB 1: MASTER DRIVER */}
                {masterTab === 'drivers' && (
                  <div className="overflow-hidden rounded-2xl sm:rounded-xl border border-slate-200 bg-white">
                    {filteredDrivers.length === 0 ? (
                      <div className="p-10 sm:p-12 text-center">
                        <h3 className="text-base font-semibold text-slate-900">
                          Data Master Driver Kosong
                        </h3>
                        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                          Tambahkan Master Driver atau sinkronkan dari lembar
                          Master_Driver di Google Spreadsheets.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Mobile Driver Cards (< md) */}
                        <div className="divide-y divide-slate-200 md:hidden">
                          {filteredDrivers.map((d) => (
                            <div key={`m-drv-${d.id}`} className="p-4">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <div className="flex items-center gap-1.5 text-xs">
                                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                                      {d.id}
                                    </span>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-bold text-slate-900">
                                      {d.name}
                                    </span>
                                  </div>
                                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-xs text-slate-600 tabular-nums">
                                    <span>WA: {d.phone || '-'}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>PIN: {d.pin || 'Tanpa PIN'}</span>
                                    <span aria-hidden="true">·</span>
                                    <span>{d.licenseType || '-'}</span>
                                  </div>
                                </div>
                                <span
                                  className={`text-xs font-semibold ${
                                    d.active
                                      ? 'text-emerald-700'
                                      : 'text-slate-400'
                                  }`}
                                >
                                  {d.active ? 'Aktif' : 'Nonaktif'}
                                </span>
                              </div>
                              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    guardDriverLinkAction(() =>
                                      onCopyText(
                                        buildDriverPortalLink({
                                          driverId: d.id,
                                          customBaseUrl:
                                            config.publicPortalBaseUrl,
                                        }),
                                        `Link Login Driver ${d.id} (${d.name})`
                                      )
                                    )
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-900"
                                >
                                  <Link2 className="h-3.5 w-3.5 text-sky-700" />
                                  Salin Link
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    guardDriverLinkAction(() => {
                                      const activeCount = assignments.filter(
                                        (a) =>
                                          a.driverId.trim().toLowerCase() ===
                                            d.id.trim().toLowerCase() &&
                                          isActiveTaskStatus(a.status)
                                      ).length;
                                      const latestActive = assignments.find(
                                        (a) =>
                                          a.driverId.trim().toLowerCase() ===
                                            d.id.trim().toLowerCase() &&
                                          isActiveTaskStatus(a.status)
                                      );
                                      const msg =
                                        buildPersonalDriverLinkWaMessage(
                                          d,
                                          activeCount,
                                          latestActive,
                                          config.publicPortalBaseUrl
                                        );
                                      const url = d.phone
                                        ? buildWhatsAppDirectUrl(
                                            d.phone,
                                            msg,
                                            false
                                          )
                                        : buildWhatsAppGroupUrl(msg);
                                      launchWhatsAppUrl(url);
                                    })
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white"
                                >
                                  <Send className="h-3 w-3" />
                                  WA Link
                                </button>
                                <div className="ml-auto flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setEditingDriverId(d.id);
                                      setDriverForm({ ...d });
                                      setDriverModalOpen(true);
                                    }}
                                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
                                    aria-label={`Edit driver ${d.name}`}
                                  >
                                    <Edit3 className="h-4 w-4" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() =>
                                      triggerConfirm({
                                        open: true,
                                        title: 'Hapus Master Driver?',
                                        description:
                                          'Data driver ini akan dihapus dari daftar login dropdown dan lembar Master_Driver di Google Spreadsheets.',
                                        details: [
                                          `ID Driver : ${d.id}`,
                                          `Nama      : ${d.name}`,
                                        ],
                                        confirmLabel: 'Hapus Driver',
                                        variant: 'danger',
                                        action: async () => {
                                          await onDeleteDriver(d.id);
                                        },
                                      })
                                    }
                                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600"
                                    aria-label={`Hapus driver ${d.name}`}
                                  >
                                    <Trash2 className="h-4 w-4" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Driver Table (md+) */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full border-collapse text-left text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                                <th className="px-4 py-3">ID Driver</th>
                                <th className="px-4 py-3">Nama Lengkap</th>
                                <th className="px-4 py-3">No. WhatsApp</th>
                                <th className="px-4 py-3">PIN Login</th>
                                <th className="px-4 py-3">Jenis SIM</th>
                                <th className="px-4 py-3">Status</th>
                                <th className="px-4 py-3 text-right">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {filteredDrivers.map((d) => (
                                <tr key={d.id} className="hover:bg-slate-50/80">
                                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                    {d.id}
                                  </td>
                                  <td className="px-4 py-3 font-medium text-slate-900">
                                    {d.name}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                                    {d.phone || '-'}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs text-slate-700 tabular-nums">
                                    {d.pin || '(Tanpa PIN)'}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slate-600">
                                    {d.licenseType || '-'}
                                  </td>
                                  <td className="px-4 py-3 text-xs font-semibold">
                                    {d.active ? (
                                      <span className="text-emerald-700">
                                        Aktif
                                      </span>
                                    ) : (
                                      <span className="text-slate-400">
                                        Nonaktif
                                      </span>
                                    )}
                                  </td>
                                  <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center justify-end gap-1">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          guardDriverLinkAction(() =>
                                            onCopyText(
                                              buildDriverPortalLink({
                                                driverId: d.id,
                                                customBaseUrl:
                                                  config.publicPortalBaseUrl,
                                              }),
                                              `Link Login Driver ${d.id} (${d.name})`
                                            )
                                          )
                                        }
                                        className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-1 text-xs font-semibold text-sky-900 hover:bg-sky-100"
                                        title={`Salin Link Login Khusus ${d.id}`}
                                      >
                                        <Link2 className="h-3.5 w-3.5 text-sky-700" />
                                        Salin Link
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          guardDriverLinkAction(() => {
                                            const activeCount = assignments.filter(
                                              (a) =>
                                                a.driverId.trim().toLowerCase() ===
                                                  d.id.trim().toLowerCase() &&
                                                isActiveTaskStatus(a.status)
                                            ).length;
                                            const latestActive = assignments.find(
                                              (a) =>
                                                a.driverId.trim().toLowerCase() ===
                                                  d.id.trim().toLowerCase() &&
                                                isActiveTaskStatus(a.status)
                                            );
                                            const msg =
                                              buildPersonalDriverLinkWaMessage(
                                                d,
                                                activeCount,
                                                latestActive,
                                                config.publicPortalBaseUrl
                                              );
                                            const url = d.phone
                                              ? buildWhatsAppDirectUrl(
                                                  d.phone,
                                                  msg,
                                                  false
                                                )
                                              : buildWhatsAppGroupUrl(msg);
                                            launchWhatsAppUrl(url);
                                          })
                                        }
                                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2 py-1 text-xs font-semibold text-white hover:bg-emerald-700"
                                        title={`Kirim Link Khusus via WhatsApp ke ${d.name}`}
                                      >
                                        <Send className="h-3 w-3" />
                                        WA Link
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setEditingDriverId(d.id);
                                          setDriverForm({ ...d });
                                          setDriverModalOpen(true);
                                        }}
                                        className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                        aria-label={`Edit driver ${d.name}`}
                                      >
                                        <Edit3 className="h-4 w-4" />
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          triggerConfirm({
                                            open: true,
                                            title: 'Hapus Master Driver?',
                                            description:
                                              'Data driver ini akan dihapus dari daftar login dropdown dan lembar Master_Driver di Google Spreadsheets.',
                                            details: [
                                              `ID Driver : ${d.id}`,
                                              `Nama      : ${d.name}`,
                                            ],
                                            confirmLabel: 'Hapus Driver',
                                            variant: 'danger',
                                            action: async () => {
                                              await onDeleteDriver(d.id);
                                            },
                                          })
                                        }
                                        className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                                        aria-label={`Hapus driver ${d.name}`}
                                      >
                                        <Trash2 className="h-4 w-4" />
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* SUB-TAB 2: MASTER ARMADA */}
                {masterTab === 'vehicles' && (
                  <div className="overflow-hidden rounded-2xl sm:rounded-xl border border-slate-200 bg-white">
                    {filteredVehicles.length === 0 ? (
                      <div className="p-10 sm:p-12 text-center">
                        <h3 className="text-base font-semibold text-slate-900">
                          Data Master Armada Kosong
                        </h3>
                        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                          Tambahkan unit kendaraan berpendingin (reefer) atau
                          sinkronkan dari Google Spreadsheets.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Mobile Vehicle Cards (< md) */}
                        <div className="divide-y divide-slate-200 md:hidden">
                          {filteredVehicles.map((v) => (
                            <div
                              key={`m-veh-${v.id}`}
                              className="flex items-start justify-between gap-3 p-4"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                                    {v.plateNumber}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono text-slate-500 tabular-nums">
                                    {v.id}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span
                                    className={`font-semibold ${
                                      v.status === 'Siap Jalan'
                                        ? 'text-emerald-700'
                                        : v.status === 'Dalam Tugas'
                                        ? 'text-sky-700'
                                        : 'text-amber-700'
                                    }`}
                                  >
                                    {v.status}
                                  </span>
                                </div>
                                <p className="mt-1 text-xs font-medium text-slate-800">
                                  {v.vehicleType || '-'}
                                  {v.capacity ? ` · Kapasitas: ${v.capacity}` : ''}
                                  {v.capacityCbm ? ` · Box: ${v.capacityCbm}` : ''}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingVehicleId(v.id);
                                    setVehicleForm({ ...v });
                                    setVehicleModalOpen(true);
                                  }}
                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
                                  aria-label={`Edit armada ${v.plateNumber}`}
                                >
                                  <Edit3 className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    triggerConfirm({
                                      open: true,
                                      title: 'Hapus Master Armada?',
                                      description:
                                        'Unit armada ini akan dihapus dari database dan lembar Master_Armada pada Google Spreadsheets.',
                                      details: [
                                        `Kode Unit : ${v.id}`,
                                        `No Polisi : ${v.plateNumber}`,
                                      ],
                                      confirmLabel: 'Hapus Armada',
                                      variant: 'danger',
                                      action: async () => {
                                        await onDeleteVehicle(v.id);
                                      },
                                    })
                                  }
                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600"
                                  aria-label={`Hapus armada ${v.plateNumber}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Vehicle Table (md+) */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full border-collapse text-left text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                                <th className="px-4 py-3">Kode Unit</th>
                                <th className="px-4 py-3">Nomor Polisi</th>
                                <th className="px-4 py-3">
                                  Tipe Kendaraan Pendingin
                                </th>
                                <th className="px-4 py-3">Kapasitas Berat</th>
                                <th className="px-4 py-3">Kapasitas CBM</th>
                                <th className="px-4 py-3">Status Unit</th>
                                <th className="px-4 py-3 text-right">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {filteredVehicles.map((v) => (
                                <tr key={v.id} className="hover:bg-slate-50/80">
                                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                    {v.id}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900">
                                    {v.plateNumber}
                                  </td>
                                  <td className="px-4 py-3 text-slate-800">
                                    {v.vehicleType || '-'}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slate-600">
                                    {v.capacity || '-'}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs font-semibold text-sky-800 tabular-nums">
                                    {v.capacityCbm || '-'}
                                  </td>
                                  <td className="px-4 py-3 text-xs font-semibold">
                                    <span
                                      className={
                                        v.status === 'Siap Jalan'
                                          ? 'text-emerald-700'
                                          : v.status === 'Dalam Tugas'
                                          ? 'text-sky-700'
                                          : 'text-amber-700'
                                      }
                                    >
                                      {v.status}
                                    </span>
                                  </td>
                                  <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingVehicleId(v.id);
                                        setVehicleForm({ ...v });
                                        setVehicleModalOpen(true);
                                      }}
                                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                      aria-label={`Edit armada ${v.plateNumber}`}
                                    >
                                      <Edit3 className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        triggerConfirm({
                                          open: true,
                                          title: 'Hapus Master Armada?',
                                          description:
                                            'Unit armada ini akan dihapus dari database dan lembar Master_Armada pada Google Spreadsheets.',
                                          details: [
                                            `Kode Unit : ${v.id}`,
                                            `No Polisi : ${v.plateNumber}`,
                                          ],
                                          confirmLabel: 'Hapus Armada',
                                          variant: 'danger',
                                          action: async () => {
                                            await onDeleteVehicle(v.id);
                                          },
                                        })
                                      }
                                      className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                                      aria-label={`Hapus armada ${v.plateNumber}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}

                {/* SUB-TAB 3: MASTER RUTE TUJUAN */}
                {masterTab === 'routes' && (
                  <div className="overflow-hidden rounded-2xl sm:rounded-xl border border-slate-200 bg-white">
                    {filteredRoutes.length === 0 ? (
                      <div className="p-10 sm:p-12 text-center">
                        <h3 className="text-base font-semibold text-slate-900">
                          Data Master Rute Tujuan Kosong
                        </h3>
                        <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                          Tambahkan daftar Lokasi Tujuan beserta PIC &amp; Nomor
                          WhatsApp tujuan.
                        </p>
                      </div>
                    ) : (
                      <>
                        {/* Mobile Route Cards (< md) */}
                        <div className="divide-y divide-slate-200 md:hidden">
                          {filteredRoutes.map((r) => (
                            <div
                              key={`m-rt-${r.id}`}
                              className="flex items-start justify-between gap-3 p-4"
                            >
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5 text-xs">
                                  <span className="font-mono font-bold text-slate-900 tabular-nums">
                                    {r.id}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-bold text-slate-900">
                                    {r.destination}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-1.5 text-xs text-slate-600">
                                  <span>PIC: {r.picName || '-'}</span>
                                  {r.picPhone && (
                                    <>
                                      <span aria-hidden="true">·</span>
                                      <span className="font-mono tabular-nums">
                                        {r.picPhone}
                                      </span>
                                    </>
                                  )}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setEditingRouteId(r.id);
                                    setRouteForm({ ...r });
                                    setRouteModalOpen(true);
                                  }}
                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-600"
                                  aria-label={`Edit rute ${r.id}`}
                                >
                                  <Edit3 className="h-4 w-4" />
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    triggerConfirm({
                                      open: true,
                                      title: 'Hapus Master Rute?',
                                      description:
                                        'Rute tujuan ini akan dihapus dari database dan lembar Master_Rute pada Google Spreadsheets.',
                                      details: [
                                        `Kode Rute     : ${r.id}`,
                                        `Lokasi Tujuan : ${r.destination}`,
                                      ],
                                      confirmLabel: 'Hapus Rute',
                                      variant: 'danger',
                                      action: async () => {
                                        await onDeleteRoute(r.id);
                                      },
                                    })
                                  }
                                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-red-50 hover:text-red-600"
                                  aria-label={`Hapus rute ${r.id}`}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* Desktop Route Table (md+) */}
                        <div className="hidden md:block overflow-x-auto">
                          <table className="w-full border-collapse text-left text-sm">
                            <thead>
                              <tr className="border-b border-slate-200 bg-slate-50 text-xs font-semibold text-slate-600">
                                <th className="px-4 py-3">Kode Rute</th>
                                <th className="px-4 py-3">Lokasi Tujuan</th>
                                <th className="px-4 py-3">Nama PIC Tujuan</th>
                                <th className="px-4 py-3">
                                  No. WhatsApp PIC Tujuan
                                </th>
                                <th className="px-4 py-3 text-right">Aksi</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-200">
                              {filteredRoutes.map((r) => (
                                <tr key={r.id} className="hover:bg-slate-50/80">
                                  <td className="px-4 py-3 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                    {r.id}
                                  </td>
                                  <td className="px-4 py-3 font-medium text-slate-900">
                                    {r.destination}
                                  </td>
                                  <td className="px-4 py-3 text-xs text-slate-700">
                                    {r.picName || '-'}
                                  </td>
                                  <td className="px-4 py-3 font-mono text-xs text-slate-600 tabular-nums">
                                    {r.picPhone || '-'}
                                  </td>
                                  <td className="px-4 py-3 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditingRouteId(r.id);
                                        setRouteForm({ ...r });
                                        setRouteModalOpen(true);
                                      }}
                                      className="rounded-md p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                                      aria-label={`Edit rute ${r.id}`}
                                    >
                                      <Edit3 className="h-4 w-4" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        triggerConfirm({
                                          open: true,
                                          title: 'Hapus Master Rute?',
                                          description:
                                            'Rute tujuan ini akan dihapus dari database dan lembar Master_Rute pada Google Spreadsheets.',
                                          details: [
                                            `Kode Rute     : ${r.id}`,
                                            `Lokasi Tujuan : ${r.destination}`,
                                          ],
                                          confirmLabel: 'Hapus Rute',
                                          variant: 'danger',
                                          action: async () => {
                                            await onDeleteRoute(r.id);
                                          },
                                        })
                                      }
                                      className="rounded-md p-1.5 text-slate-500 hover:bg-red-50 hover:text-red-600"
                                      aria-label={`Hapus rute ${r.id}`}
                                    >
                                      <Trash2 className="h-4 w-4" />
                                    </button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ========================================================== */}
            {/* TAB 4: WHATSAPP 1-KLIK & LOG NOTIFIKASI                    */}
            {/* ========================================================== */}
            {activeMenu === 'notifikasi_wa' && (
              <div className="space-y-6">
                <DailyOperationalSummaryPanel
                  assignments={assignments}
                  vehicles={vehicles}
                  drivers={drivers}
                  notifications={notifications}
                  config={config}
                  onCopyText={onCopyText}
                  defaultShowPreview
                />

                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <h2 className="text-base font-bold text-slate-900">
                    Pengaturan Grup WhatsApp, Nomor Dispatcher &amp; Prefix Surat
                    Tugas
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Atur tujuan default tombol WhatsApp sekali klik (Grup
                    WhatsApp Operasional atau Nomor Langsung) saat Admin
                    menerbitkan Surat Tugas maupun saat Driver mengirimkan
                    Keberangkatan &amp; Serah Terima.
                  </p>

                  {/* Default Target Mode Segmented Toggle */}
                  <div className="mt-5">
                    <label className="block text-xs font-semibold text-slate-700">
                      Mode Default Pengiriman WhatsApp Otomatis &amp; Sekali Klik
                    </label>
                    <div className="mt-1.5 inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/80 p-1">
                      <button
                        type="button"
                        onClick={() => setWaTargetModeInput('DRIVER')}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                          waTargetModeInput === 'DRIVER'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Phone className="h-3.5 w-3.5" />
                        WA Driver Otomatis
                      </button>
                      <button
                        type="button"
                        onClick={() => setWaTargetModeInput('GROUP')}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                          waTargetModeInput === 'GROUP'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <Users className="h-3.5 w-3.5" />
                        Kirim ke Grup WhatsApp
                      </button>
                      <button
                        type="button"
                        onClick={() => setWaTargetModeInput('DIRECT')}
                        className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap ${
                          waTargetModeInput === 'DIRECT'
                            ? 'bg-white text-slate-900 shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        <MessageSquare className="h-3.5 w-3.5" />
                        Nomor Dispatcher
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Nama Grup WhatsApp Operasional
                      </label>
                      <input
                        type="text"
                        value={waGroupNameInput}
                        onChange={(e) => setWaGroupNameInput(e.target.value)}
                        placeholder="Contoh: Grup Operasional CRK Logistik"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Link Undangan Grup WA / ID Grup Gateway (Opsional)
                      </label>
                      <input
                        type="text"
                        value={waGroupInviteInput}
                        onChange={(e) => setWaGroupInviteInput(e.target.value)}
                        placeholder="https://chat.whatsapp.com/... atau 1203630...@g.us"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Nomor WhatsApp Dispatcher Operasional
                      </label>
                      <input
                        type="text"
                        value={waPhoneInput}
                        onChange={(e) => setWaPhoneInput(e.target.value)}
                        placeholder="Contoh: 081234567890"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-700">
                        Kode Awalan (Prefix) Nomor Surat Tugas Berurutan
                      </label>
                      <input
                        type="text"
                        value={prefixInput}
                        onChange={(e) =>
                          setPrefixInput(e.target.value.toUpperCase())
                        }
                        placeholder="ST-CRK"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 uppercase focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      onClick={() =>
                        triggerConfirm({
                          open: true,
                          title: 'Simpan Pengaturan WhatsApp & Operasional?',
                          description:
                            'Mode pengiriman WhatsApp otomatis, nama grup operasional, nomor Dispatcher, dan prefix Surat Tugas akan disimpan serta disinkronkan secara real-time.',
                          details: [
                            `Mode Default WA   : ${
                              waTargetModeInput === 'DRIVER'
                                ? 'WA Driver Otomatis'
                                : waTargetModeInput === 'GROUP'
                                ? 'Grup WhatsApp'
                                : 'Nomor Dispatcher'
                            }`,
                            `Nama Grup WA      : ${waGroupNameInput || '-'}`,
                            `No. WA Dispatcher : ${waPhoneInput || '-'}`,
                            `Prefix Surat      : ${prefixInput || 'ST-CRK'}`,
                          ],
                          confirmLabel: 'Simpan Pengaturan',
                          variant: 'primary',
                          action: async () => {
                            await onSaveOperationalSettings({
                              dispatcherWaPhone: waPhoneInput.trim(),
                              whatsappTargetMode: waTargetModeInput,
                              whatsappGroupName:
                                waGroupNameInput.trim() ||
                                'Grup Operasional CRK Logistik',
                              whatsappGroupInviteUrl: waGroupInviteInput.trim(),
                              letterPrefix: prefixInput.trim() || 'ST-CRK',
                            });
                          },
                        })
                      }
                      className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap shrink-0"
                    >
                      Simpan Pengaturan
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        onTestWhatsAppNetwork(
                          waGroupInviteInput.trim().includes('@g.us')
                            ? waGroupInviteInput.trim()
                            : waPhoneInput.trim()
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap shrink-0"
                    >
                      <Send className="h-3.5 w-3.5" />
                      Buat Pesan Uji WhatsApp
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        launchWhatsAppUrl(
                          buildWhatsAppGroupUrl(
                            `*[CRK LOGISTIK DELIVERY SISTEM]*\nUji kirim pesan ke Grup WhatsApp (${
                              waGroupNameInput.trim() || 'Grup Operasional'
                            }) pada ${formatRealTimeTimestamp(new Date())}.`
                          )
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Kirim Uji ke Grup WhatsApp
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        launchWhatsAppUrl(
                          buildWhatsAppDirectUrl(
                            waPhoneInput.trim(),
                            `*[CRK LOGISTIK DELIVERY SISTEM]*\nTes koneksi langsung pembuka Aplikasi WhatsApp (${formatRealTimeTimestamp(
                              new Date()
                            )}).`,
                            false
                          )
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 whitespace-nowrap shrink-0"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Buka Chat WA Dispatcher
                    </button>

                    {waGroupInviteInput
                      .trim()
                      .startsWith('https://chat.whatsapp.com/') && (
                      <a
                        href={waGroupInviteInput.trim()}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                        Buka Link Grup WA
                      </a>
                    )}
                  </div>
                </div>

                {/* Log Pengiriman WhatsApp */}
                <div className="rounded-xl border border-slate-200 bg-white">
                  <div className="border-b border-slate-200 px-6 py-4">
                    <h3 className="text-sm font-bold text-slate-900">
                      Riwayat Pesan WhatsApp Sekali Klik ({notifications.length}
                      )
                    </h3>
                  </div>

                  {notifications.length === 0 ? (
                    <div className="p-10 text-center text-sm text-slate-600">
                      Belum ada Surat Tugas, laporan keberangkatan, atau serah
                      terima yang dikirimkan.
                    </div>
                  ) : (
                    <div className="divide-y divide-slate-200">
                      {notifications.map((notif) => (
                        <div key={notif.id} className="p-5">
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                            <div className="flex flex-wrap items-center gap-2 text-slate-600">
                              <span className="font-semibold text-slate-900">
                                {notif.eventType === 'SURAT_TUGAS'
                                  ? 'Penerbitan Surat Tugas'
                                  : notif.eventType === 'KEBERANGKATAN'
                                  ? 'Keberangkatan Rantai Dingin'
                                  : notif.eventType === 'DELIVERED'
                                  ? 'Tiba di Tujuan (Delivered)'
                                  : notif.eventType === 'SERAH_TERIMA'
                                  ? 'Serah Terima (Handover)'
                                  : 'Uji WhatsApp'}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="font-mono tabular-nums">
                                {notif.noPenugasan}
                              </span>
                              <span aria-hidden="true">·</span>
                              <span>
                                {notif.driverName} ({notif.plateNumber})
                              </span>
                            </div>

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-slate-500 tabular-nums">
                                {formatRealTimeTimestamp(notif.timestamp)}
                              </span>
                              {notif.waDriverUrl && (
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleOpenNotifLogWa(notif, 'DRIVER')
                                  }
                                  className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2.5 py-1 font-semibold text-sky-900 hover:bg-sky-100"
                                >
                                  <Phone className="h-3 w-3" />
                                  WA Driver
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() =>
                                  handleOpenNotifLogWa(notif, 'GROUP')
                                }
                                className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-3 py-1 font-semibold text-white hover:bg-emerald-700"
                              >
                                <Users className="h-3 w-3" />
                                Kirim ke Grup WA
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  handleOpenNotifLogWa(notif, 'DIRECT')
                                }
                                className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2.5 py-1 font-semibold text-emerald-800 hover:bg-emerald-100"
                              >
                                <ExternalLink className="h-3 w-3" />
                                WA Nomor
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  const freshLine = `Waktu Pesan WA : ${formatRealTimeTimestamp(
                                    new Date()
                                  )}`;
                                  const cleanMsg = stripDriverLinkFromWaMessage(
                                    notif.message
                                  );
                                  const msg = cleanMsg.includes(
                                    'Waktu Pesan WA :'
                                  )
                                    ? cleanMsg.replace(
                                        /^Waktu Pesan WA :.*$/m,
                                        freshLine
                                      )
                                    : cleanMsg;
                                  onCopyText(msg, 'Pesan WhatsApp');
                                }}
                                className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                              >
                                <Copy className="h-3 w-3" />
                                Salin
                              </button>
                            </div>
                          </div>

                          <pre className="mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
                            {stripDriverLinkFromWaMessage(notif.message)}
                          </pre>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ========================================================== */}
            {/* TAB 5: DATABASE SPREADSHEETS                               */}
            {/* ========================================================== */}
            {activeMenu === 'spreadsheets' && (
              <div className="space-y-6">
                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h2 className="text-base font-bold text-slate-900">
                        01. Sesi Sinkronisasi Spreadsheet Permanen &amp; Cloud
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        {config.spreadsheetId
                          ? `Database "${
                              config.spreadsheetTitle || config.spreadsheetId
                            }" terikat secara permanen di 4 lapis penyimpanan perangkat & Cloud${
                              googleUser ? ` (${googleUser.email})` : ''
                            }. Perubahan data maupun penghapusan baris di Spreadsheet atau Aplikasi diselaraskan dua arah secara otomatis tanpa perlu sinkron ulang.`
                          : googleUser
                          ? `Sesi Akun Google Permanen Aktif (${googleUser.email}). Pilih atau buat Google Spreadsheet di bawah agar terikat secara permanen.`
                          : 'Masuk dengan akun Google Anda sekali saja agar sesi dan ikatan Google Spreadsheet tersimpan secara permanen.'}
                      </p>

                      {config.spreadsheetId && (
                        <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-600 tabular-nums">
                          <span className="font-semibold text-emerald-700">
                            {config.serviceAccountConfigured &&
                            config.serviceAccountStatus === 'ACTIVE'
                              ? 'Mode: Auto-Sync Dua Arah 24/7 Resmi (Google Service Account)'
                              : config.appsScriptUrl
                              ? 'Mode: Auto-Sync Dua Arah 24/7 Permanen (Bridge)'
                              : hasGoogleToken ||
                                config.serverSheetSyncMode ===
                                  'LIVE_CSV_AND_OAUTH'
                              ? 'Mode: Auto-Sync Dua Arah Aktif Otomatis'
                              : 'Status: Terikat Permanen'}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Sheet:{' '}
                            {config.spreadsheetTitle || config.spreadsheetId}
                          </span>
                          {config.lastSyncedAt && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                Sinkron Terakhir:{' '}
                                {formatRealTimeTimestamp(config.lastSyncedAt)}
                              </span>
                            </>
                          )}
                          <span aria-hidden="true">·</span>
                          <span>
                            Antrean Tulis:{' '}
                            {
                              assignments.filter((a) => Boolean(a.needsSheetSync))
                                .length
                            }{' '}
                            tugas
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      {config.serviceAccountConfigured && !googleUser && (
                        <button
                          type="button"
                          onClick={onManualSync}
                          disabled={isSyncing}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${
                              isSyncing ? 'animate-spin' : ''
                            }`}
                          />
                          {isSyncing
                            ? 'Menyinkronkan...'
                            : 'Sinkronkan Sekarang'}
                        </button>
                      )}
                      {!googleUser ? (
                        <GoogleSignInButton
                          onClick={onGoogleLogin}
                          label="Sign in with Google"
                        />
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={onManualSync}
                            disabled={isSyncing}
                            className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                          >
                            <RefreshCw
                              className={`h-3.5 w-3.5 ${
                                isSyncing ? 'animate-spin' : ''
                              }`}
                            />
                            {isSyncing
                              ? 'Menyinkronkan...'
                              : hasGoogleToken ||
                                Boolean(config.serviceAccountConfigured) ||
                                Boolean(config.appsScriptUrl) ||
                                config.serverSheetSyncMode ===
                                  'LIVE_CSV_AND_OAUTH'
                              ? 'Sinkronkan Sekarang'
                              : 'Pulihkan Token Tulis'}
                          </button>
                          <button
                            type="button"
                            onClick={onGoogleLogout}
                            className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                          >
                            Putuskan Akun Google
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        02. Hubungkan Spreadsheet secara Permanen
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Tempelkan URL lengkap Google Sheets atau Spreadsheet ID.
                        Setelah terhubung, ID &amp; konfigurasi Spreadsheet
                        dikunci permanen sehingga tidak perlu dimasukkan ulang.
                      </p>

                      <div className="mt-4">
                        <label className="block text-xs font-semibold text-slate-700">
                          URL atau ID Google Spreadsheet
                        </label>
                        <input
                          type="text"
                          value={sheetInput}
                          onChange={(e) => setSheetInput(e.target.value)}
                          placeholder="https://docs.google.com/spreadsheets/d/1BxiMVs.../edit"
                          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="mt-5 flex flex-wrap items-center gap-2.5">
                      <button
                        type="button"
                        disabled={!sheetInput.trim() || isSyncing}
                        onClick={() =>
                          triggerConfirm({
                            open: true,
                            title:
                              'Ikat Permanen & Sinkronkan Google Spreadsheet?',
                            description:
                              'Spreadsheet ini akan disimpan permanen di Aplikasi, Cloud, dan memori perangkat serta disinkronkan otomatis setiap 20 detik.',
                            details: [
                              `Target Spreadsheet : ${sheetInput.trim()}`,
                            ],
                            confirmLabel: 'Ikat Permanen & Sinkronkan',
                            variant: 'primary',
                            action: async () => {
                              await onConnectSpreadsheet(sheetInput.trim());
                            },
                          })
                        }
                        className="rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        Ikat Permanen &amp; Sinkronkan
                      </button>

                      {config.spreadsheetUrl && (
                        <a
                          href={config.spreadsheetUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          Buka Sheet
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}

                      {config.spreadsheetId && onDisconnectSpreadsheet && (
                        <button
                          type="button"
                          onClick={() =>
                            triggerConfirm({
                              open: true,
                              title: 'Lepas Ikatan Spreadsheet Saat Ini?',
                              description:
                                'Ikatan ke file Spreadsheet ini akan dilepas dari aplikasi agar Anda dapat mengganti ke file lain. Data di dalam Google Sheets maupun di Aplikasi tidak akan terhapus.',
                              details: [
                                `Spreadsheet Saat Ini : ${
                                  config.spreadsheetTitle || config.spreadsheetId
                                }`,
                              ],
                              confirmLabel: 'Lepas Ikatan',
                              variant: 'danger',
                              action: async () => {
                                await onDisconnectSpreadsheet();
                                setSheetInput('');
                              },
                            })
                          }
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
                        >
                          Ganti / Lepas
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-200 bg-white p-6 flex flex-col justify-between">
                    <div>
                      <h3 className="text-base font-bold text-slate-900">
                        03. Buat Spreadsheet Database Baru Otomatis
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Buat file Google Spreadsheet baru lengkap dengan tab
                        Master_Driver, Master_Armada, Master_Rute, Surat_Tugas,
                        dan Konfigurasi serta langsung terikat permanen.
                      </p>

                      <div className="mt-4">
                        <label className="block text-xs font-semibold text-slate-700">
                          Judul Spreadsheet Baru
                        </label>
                        <input
                          type="text"
                          value={newSheetTitle}
                          onChange={(e) => setNewSheetTitle(e.target.value)}
                          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                    </div>

                    <div className="mt-5">
                      <button
                        type="button"
                        disabled={!newSheetTitle.trim() || isSyncing}
                        onClick={() =>
                          triggerConfirm({
                            open: true,
                            title: 'Buat File Google Spreadsheet Baru?',
                            description:
                              'Sebuah file Google Spreadsheet baru untuk CRK LOGISTIK DELIVERY SISTEM akan dibuat pada akun Google Anda dan diikat secara permanen.',
                            details: [`Nama File : ${newSheetTitle.trim()}`],
                            confirmLabel: 'Buat Database Baru',
                            variant: 'primary',
                            action: async () => {
                              await onCreateSpreadsheet(newSheetTitle.trim());
                            },
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-900 bg-white px-4 py-2.5 text-xs font-semibold text-slate-900 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap"
                      >
                        <Plus className="h-4 w-4" />
                        Buat Database Spreadsheet Baru
                      </button>
                    </div>
                  </div>
                </div>

                {/* Section 04: Google Drive Photo Archive Integration */}
                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="min-w-0">
                      <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                        <HardDrive className="h-4 w-4 shrink-0 text-slate-700" />
                        04. Arsip Otomatis Foto Odometer, Suhu &amp; Bukti ke
                        Google Drive
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Seluruh foto keberangkatan dan serah terima dari Driver
                        diunggah otomatis ke folder Google Drive Anda (
                        <span className="font-mono text-xs text-slate-800">
                          CRK LOGISTIK - Foto Pengiriman / YYYY-MM / Surat Tugas
                        </span>
                        ) dan link setiap foto (termasuk{' '}
                        <span className="font-semibold text-slate-800">
                          Link Foto Odometer Keberangkatan
                        </span>
                        ) ditulis ke lembar{' '}
                        <span className="font-mono text-xs text-slate-800">
                          Surat_Tugas
                        </span>
                        .
                      </p>
                      <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-slate-600 tabular-nums">
                        <span>
                          Total Foto Driver: {fleetDriveStats.totalPhotos}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="text-emerald-700 font-semibold">
                          Tersimpan di Drive: {fleetDriveStats.syncedPhotos}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span
                          className={
                            fleetDriveStats.pendingPhotos > 0
                              ? 'text-amber-700 font-semibold'
                              : 'text-slate-500'
                          }
                        >
                          Menunggu Unggah: {fleetDriveStats.pendingPhotos}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                      {onSyncPhotosToDrive && (
                        <button
                          type="button"
                          disabled={isDriveSyncing || isSyncing}
                          onClick={() => {
                            if (fleetDriveStats.pendingPhotos > 0) {
                              triggerConfirm({
                                open: true,
                                title:
                                  'Unggah Foto Pengiriman ke Google Drive & Perbarui Spreadsheet?',
                                description:
                                  'Sistem akan mengunggah foto odometer, suhu, bukti serah terima, dan tanda tangan ke folder Google Drive Anda serta menyimpan link file ke Spreadsheet.',
                                details: [
                                  `Foto Menunggu Unggah : ${fleetDriveStats.pendingPhotos} file`,
                                  `Penugasan Terkait : ${fleetDriveStats.assignmentsPendingSync} Surat Tugas`,
                                ],
                                confirmLabel: 'Unggah ke Google Drive',
                                variant: 'primary',
                                action: async () => {
                                  await onSyncPhotosToDrive();
                                },
                              });
                            } else {
                              void onSyncPhotosToDrive();
                            }
                          }}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 ${
                              isDriveSyncing ? 'animate-spin' : ''
                            }`}
                          />
                          {isDriveSyncing
                            ? 'Mengunggah ke Drive...'
                            : 'Sinkron Foto ke Google Drive'}
                        </button>
                      )}

                      {config.driveRootFolderUrl && (
                        <a
                          href={config.driveRootFolderUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <FolderOpen className="h-3.5 w-3.5" />
                          Buka Folder Drive Utama
                          <ExternalLink className="h-3.5 w-3.5" />
                        </a>
                      )}
                    </div>
                  </div>
                </div>

                {/* Section 05: Official Google Service Account 24/7 Server-to-Server API */}
                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 max-w-3xl">
                      <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                        <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-700" />
                        05. Google Service Account Resmi (API Server 24/7 — Tanpa Login Admin &amp; Tanpa Apps Script)
                      </h3>
                      <p className="mt-1 text-sm text-slate-600">
                        Dengan{' '}
                        <span className="font-semibold text-slate-900">
                          Google Service Account
                        </span>
                        , server aplikasi menulis dan membaca Google Sheets API v4 secara langsung 24/7 di latar belakang. Saat Driver mengirim laporan Keberangkatan, Sampai (Delivered), Handover, maupun Pengeluaran kapan saja (meskipun Admin logout atau menutup browser), baris langsung masuk ke Spreadsheet dalam hitungan detik.
                      </p>

                      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs tabular-nums">
                        {config.serviceAccountStatus === 'ACTIVE' ? (
                          <span className="font-semibold text-emerald-700">
                            Status: AKTIF 24/7 (Terverifikasi ke Google Sheets API)
                          </span>
                        ) : config.serviceAccountStatus ===
                          'PERMISSION_NEEDED' ? (
                          <span className="font-semibold text-amber-700">
                            Status: Menunggu Izin Share &quot;Editor&quot; di Google Spreadsheet
                          </span>
                        ) : config.serviceAccountConfigured ? (
                          <span className="font-semibold text-slate-800">
                            Status: Kredensial Terdeteksi — Klik Tes &amp; Sinkronkan
                          </span>
                        ) : (
                          <span className="font-semibold text-slate-600">
                            Status: Email Service Account Terdaftar — Menunggu Kunci JSON di .env.local / Secrets AI Studio
                          </span>
                        )}
                      </div>

                      {config.serviceAccountEmail && (
                        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <div className="text-xs font-semibold text-slate-700">
                            Email Service Account (Pastikan sudah dibagikan sebagai Editor di Google Spreadsheet):
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-2">
                            <code className="rounded bg-white px-2.5 py-1 font-mono text-xs text-slate-900 border border-slate-200 break-all">
                              {config.serviceAccountEmail}
                            </code>
                            <button
                              type="button"
                              onClick={() =>
                                onCopyText(
                                  config.serviceAccountEmail || '',
                                  'Email Service Account'
                                )
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1 text-xs font-semibold text-slate-800 hover:bg-slate-100"
                            >
                              <Copy className="h-3.5 w-3.5" />
                              Salin Email
                            </button>
                          </div>
                        </div>
                      )}

                      {config.serviceAccountLastError &&
                        config.serviceAccountStatus !== 'ACTIVE' && (
                          <p className="mt-2.5 text-xs text-amber-700 leading-relaxed">
                            Info Diagnostik: {config.serviceAccountLastError}
                          </p>
                        )}

                      <ol className="mt-3 space-y-1 text-xs text-slate-600 list-decimal list-inside">
                        <li>
                          Buka{' '}
                          <span className="font-semibold text-slate-800">
                            Google Cloud Console
                          </span>{' '}
                          &rarr; aktifkan{' '}
                          <span className="font-semibold text-slate-800">
                            Google Sheets API
                          </span>{' '}
                          &rarr; buka Service Account Anda &rarr; tab{' '}
                          <span className="font-semibold text-slate-800">
                            Keys &rarr; Add Key &rarr; Create new key (JSON)
                          </span>
                          .
                        </li>
                        <li>
                          Di bar atas Preview AI Studio, ketuk tombol{' '}
                          <span className="font-mono font-semibold text-slate-800">
                            &lt;&gt;
                          </span>{' '}
                          (Code) atau{' '}
                          <span className="font-semibold text-slate-800">
                            Settings &rarr; Secrets
                          </span>{' '}
                          di panel Build kiri, buat file{' '}
                          <span className="font-mono font-semibold text-slate-800">
                            .env.local
                          </span>{' '}
                          (terlindungi otomatis oleh .gitignore) lalu tempel isi file JSON dari Cloud Console.
                        </li>
                        <li>
                          Buka Google Spreadsheet Anda &rarr; klik{' '}
                          <span className="font-semibold text-slate-800">
                            Bagikan (Share)
                          </span>{' '}
                          &rarr; tempel alamat{' '}
                          <span className="font-mono text-slate-800">
                            client_email
                          </span>{' '}
                          Service Account sebagai{' '}
                          <span className="font-semibold text-slate-800">
                            Editor
                          </span>
                          , lalu klik tombol verifikasi di samping.
                        </li>
                      </ol>
                    </div>

                    <div className="shrink-0 flex flex-col gap-2.5 sm:items-end">
                      <button
                        type="button"
                        disabled={verifyingServiceAccount || isSyncing}
                        onClick={() => void handleVerifyServiceAccount()}
                        className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            verifyingServiceAccount ? 'animate-spin' : ''
                          }`}
                        />
                        {verifyingServiceAccount
                          ? 'Memverifikasi Service Account...'
                          : 'Tes & Sinkronkan via Service Account'}
                      </button>
                    </div>
                  </div>

                  <div className="mt-5 pt-4 border-t border-slate-100">
                    <label className="block text-xs font-semibold text-slate-700">
                      Link / ID Folder Google Drive Bersama (Opsional — untuk Arsip Foto Otomatis)
                    </label>
                    <div className="mt-1.5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        value={driveFolderInput}
                        onChange={(e) => setDriveFolderInput(e.target.value)}
                        placeholder="https://drive.google.com/drive/folders/... (Opsional)"
                        className="w-full flex-1 rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>
                </div>

                {/* Section 06: Permanent 24/7 Two-Way Google Apps Script Bridge (Zero Re-Auth Forever) */}
                {onSaveAppsScriptUrl && (
                  <div className="rounded-xl border border-slate-200 bg-white p-6">
                    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0 max-w-3xl">
                        <h3 className="flex items-center gap-2 text-base font-bold text-slate-900">
                          <Database className="h-4 w-4 shrink-0 text-slate-700" />
                          06. Alternatif Bridge Google Apps Script 24/7 (Opsional — Cadangan Tanpa Cloud Console)
                        </h3>
                        <p className="mt-1 text-sm text-slate-600">
                          Secara bawaan, aplikasi sudah memperbarui sesi Google
                          Sheets secara otomatis di latar belakang. Jika Anda
                          ingin sinkronisasi baca-tulis dua arah berjalan{' '}
                          <span className="font-semibold text-slate-900">
                            100% permanen selamanya
                          </span>{' '}
                          (termasuk saat Admin menutup tab, sesudah refresh, atau
                          saat Driver mengirim laporan dari HP tanpa token login
                          Admin), pasang kode Google Apps Script ini satu kali
                          saja di Spreadsheet Anda.
                        </p>

                        <ol className="mt-3 space-y-1 text-xs text-slate-600 list-decimal list-inside">
                          <li>
                            Buka Google Spreadsheet Anda lalu pilih menu{' '}
                            <span className="font-semibold text-slate-800">
                              Ekstensi (Extensions) &rarr; Apps Script
                            </span>
                            , hapus kode bawaan, klik{' '}
                            <span className="font-semibold text-slate-800">
                              Salin Kode Apps Script
                            </span>{' '}
                            di samping, lalu tempel dan simpan.
                          </li>
                          <li>
                            Klik{' '}
                            <span className="font-semibold text-slate-800">
                              Deploy &rarr; New deployment
                            </span>
                            , pilih jenis{' '}
                            <span className="font-semibold text-slate-800">
                              Web app
                            </span>
                            , atur <em>Execute as</em>:{' '}
                            <span className="font-semibold text-slate-800">
                              Me
                            </span>{' '}
                            dan <em>Who has access</em>:{' '}
                            <span className="font-semibold text-slate-800">
                              Anyone
                            </span>
                            , lalu klik Deploy.
                          </li>
                          <li>
                            Tempelkan{' '}
                            <span className="font-mono text-slate-800">
                              Web app URL
                            </span>{' '}
                            yang berakhiran{' '}
                            <span className="font-mono text-slate-800">
                              /exec
                            </span>{' '}
                            pada kolom di bawah dan klik{' '}
                            <span className="font-semibold text-slate-800">
                              Aktifkan Permanen
                            </span>
                            .
                          </li>
                        </ol>
                      </div>

                      <div className="shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            onCopyText(
                              `${buildPermanentAppsScriptCode(
                                config.spreadsheetId
                              )}\n\n${PERMANENT_APPS_SCRIPT_BODY}`,
                              'Kode Google Apps Script Permanen'
                            )
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          Salin Kode Apps Script
                        </button>
                      </div>
                    </div>

                    <div className="mt-5 pt-4 border-t border-slate-100">
                      <label className="block text-xs font-semibold text-slate-700">
                        Web App URL Google Apps Script (Permanen 24/7)
                      </label>
                      <div className="mt-1.5 flex flex-col gap-2.5 sm:flex-row sm:items-center">
                        <input
                          type="url"
                          value={appsScriptUrlInput}
                          onChange={(e) =>
                            setAppsScriptUrlInput(e.target.value)
                          }
                          placeholder="https://script.google.com/macros/s/AKfycb.../exec"
                          className="w-full flex-1 rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            disabled={
                              !appsScriptUrlInput.trim() ||
                              isSyncing ||
                              appsScriptUrlInput.trim() ===
                                (config.appsScriptUrl || '').trim()
                            }
                            onClick={() =>
                              triggerConfirm({
                                open: true,
                                title:
                                  'Aktifkan Sinkronisasi Dua Arah Permanen 24/7?',
                                description:
                                  'URL Bridge Google Apps Script ini akan disimpan permanen di Aplikasi, Cloud, dan Spreadsheet sehingga sinkronisasi dua arah berjalan otomatis setiap 15 detik tanpa perlu login atau sinkron ulang.',
                                details: [
                                  `Web App URL : ${appsScriptUrlInput.trim()}`,
                                ],
                                confirmLabel: 'Aktifkan Permanen',
                                variant: 'primary',
                                action: async () => {
                                  await onSaveAppsScriptUrl(
                                    appsScriptUrlInput.trim()
                                  );
                                },
                              })
                            }
                            className="rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                          >
                            {config.appsScriptUrl
                              ? 'Perbarui URL Permanen'
                              : 'Aktifkan Permanen'}
                          </button>

                          {config.appsScriptUrl && (
                            <button
                              type="button"
                              disabled={isSyncing}
                              onClick={() =>
                                triggerConfirm({
                                  open: true,
                                  title: 'Nonaktifkan URL Bridge Apps Script?',
                                  description:
                                    'URL Google Apps Script akan dilepas dari pengaturan. Sinkronisasi otomatis via akun Google (GIS) tetap berjalan seperti biasa.',
                                  details: [
                                    `URL Saat Ini : ${config.appsScriptUrl}`,
                                  ],
                                  confirmLabel: 'Hapus URL Bridge',
                                  variant: 'danger',
                                  action: async () => {
                                    await onSaveAppsScriptUrl('');
                                    setAppsScriptUrlInput('');
                                  },
                                })
                              }
                              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
                            >
                              Hapus Bridge
                            </button>
                          )}
                        </div>
                      </div>

                      {config.appsScriptUrl &&
                        (config.appsScriptBridgeStatus ===
                        'AUTH_BLOCKED_HTML' ? (
                          <p className="mt-2 text-xs text-amber-700 leading-relaxed">
                            Perhatian Izin Deployment Apps Script: URL saat ini
                            masih meminta halaman Login Google (HTML). Agar
                            sinkronisasi latar belakang saat tab ditutup aktif
                            penuh, buka Google Apps Script &rarr;{' '}
                            <span className="font-semibold">
                              Terapkan &rarr; Kelola deployment &rarr; Edit
                            </span>{' '}
                            lalu ubah{' '}
                            <span className="font-semibold">
                              Yang memiliki akses
                            </span>{' '}
                            menjadi{' '}
                            <span className="font-semibold">
                              Siapa saja (Anyone)
                            </span>
                            .
                          </p>
                        ) : config.appsScriptBridgeStatus ===
                          'NEEDS_SCRIPT_UPDATE' ? (
                          <p className="mt-2 text-xs text-amber-700 leading-relaxed">
                            Izin akses{' '}
                            <span className="font-semibold">Siapa saja</span>{' '}
                            sudah aktif, namun{' '}
                            <span className="font-mono font-semibold">
                              Kode.gs
                            </span>{' '}
                            di Apps Script Anda masih menggunakan versi lama (
                            <span className="font-mono">
                              Action tidak dikenal
                            </span>
                            ). Klik tombol{' '}
                            <span className="font-semibold">
                              Salin Kode Apps Script
                            </span>{' '}
                            di atas, ganti seluruh isi{' '}
                            <span className="font-mono font-semibold">
                              Kode.gs
                            </span>{' '}
                            lalu tekan Simpan, kemudian klik{' '}
                            <span className="font-semibold">
                              Terapkan &rarr; Kelola deployment &rarr; ikon
                              Pensil (Edit) &rarr; Versi: Versi baru &rarr;
                              Terapkan
                            </span>{' '}
                            (URL tetap sama). Selama akun Google terhubung di
                            tab Admin, sinkronisasi ke Spreadsheet tetap
                            berjalan otomatis.
                          </p>
                        ) : (
                          <p className="mt-2 font-mono text-xs text-emerald-700 tabular-nums">
                            Aktif Permanen 24/7 · Server menyelaraskan perubahan
                            &amp; penghapusan baris Spreadsheet secara otomatis
                            setiap 15 detik tanpa perlu sinkron ulang.
                          </p>
                        ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ========================================================== */}
            {/* TAB 6: SESI AKTIF & UBAH PIN ADMIN DISPATCHER              */}
            {/* ========================================================== */}
            {activeMenu === 'ubah_pin' && (
              <div className="space-y-6 max-w-3xl">
                {/* Active Admin Dispatcher Session Status & Control Card */}
                <section className="rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h2 className="text-lg font-bold text-slate-900">
                        Sesi Aktif Permanen (Admin &amp; Driver)
                      </h2>
                      <p className="mt-1 text-sm text-slate-600">
                        Sesi login dijaga tetap aktif secara permanen (10 tahun
                        bergulir) pada 4 lapisan brankas perangkat lintas
                        refresh halaman, penutupan browser, pergantian tab,
                        maupun gangguan sinyal seluler hingga Anda menekan
                        tombol Keluar secara manual.
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                        <span className="font-semibold text-emerald-700">
                          Status: Aktif Permanen (10 Tahun Bergulir)
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>Keep-Alive Otomatis 10 Menit &amp; Aktivitas</span>
                        <span aria-hidden="true">·</span>
                        <span>Auto-Refresh Token Cloud 25 Menit</span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={refreshingAdminSession}
                        onClick={async () => {
                          setRefreshingAdminSession(true);
                          try {
                            if (onRefreshAdminSession) {
                              await onRefreshAdminSession();
                            }
                            const updated =
                              await inspectActiveAdminSessionHealth();
                            setAdminSessionHealth(updated);
                          } finally {
                            setRefreshingAdminSession(false);
                          }
                        }}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                      >
                        <RefreshCw
                          className={`h-3.5 w-3.5 ${
                            refreshingAdminSession ? 'animate-spin' : ''
                          }`}
                        />
                        {refreshingAdminSession
                          ? 'Memperbarui...'
                          : 'Segarkan Sesi & Token'}
                      </button>
                    </div>
                  </div>

                  {/* Real Session Metrics Grid */}
                  <div className="mt-5 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="bg-slate-50/80 p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Mulai Sesi Aktif
                      </p>
                      <p className="mt-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {adminSessionHealth?.startedAtMs
                          ? formatRealTimeTimestamp(
                              new Date(adminSessionHealth.startedAtMs)
                            )
                          : 'Aktif Saat Ini'}
                      </p>
                    </div>

                    <div className="bg-slate-50/80 p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Pembaruan Keep-Alive Terakhir
                      </p>
                      <p className="mt-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {adminSessionHealth?.lastRenewedAtMs
                          ? formatRealTimeTimestamp(
                              new Date(adminSessionHealth.lastRenewedAtMs)
                            )
                          : 'Baru Saja'}
                      </p>
                    </div>

                    <div className="bg-slate-50/80 p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Masa Berlaku Sesi
                      </p>
                      <p className="mt-1 font-mono text-xs font-semibold text-emerald-700 tabular-nums">
                        {adminSessionHealth?.expiresAtMs
                          ? `Hingga ${new Date(
                              adminSessionHealth.expiresAtMs
                            ).toLocaleDateString('id-ID', {
                              day: '2-digit',
                              month: 'short',
                              year: 'numeric',
                            })}`
                          : '10 Tahun (Bergulir)'}
                      </p>
                    </div>

                    <div className="bg-slate-50/80 p-4">
                      <p className="text-[11px] font-medium text-slate-500">
                        Lapisan Penyimpanan Sesi
                      </p>
                      <p className="mt-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
                        {adminSessionHealth
                          ? `${
                              [
                                adminSessionHealth.layers.localStorage,
                                adminSessionHealth.layers.sessionStorage,
                                adminSessionHealth.layers.cookie,
                                adminSessionHealth.layers.indexedDb,
                              ].filter(Boolean).length
                            }/4 Lapisan Aktif`
                          : '4/4 Lapisan Aktif'}
                      </p>
                    </div>
                  </div>

                  {/* Storage & Cloud Identity Details */}
                  <div className="mt-4 space-y-2 border-t border-slate-200 pt-4 text-xs text-slate-600">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-semibold text-slate-800">
                        Brankas Sesi Browser:
                      </span>
                      <span>
                        LocalStorage (
                        {adminSessionHealth?.layers.localStorage !== false
                          ? 'Aktif'
                          : 'Nonaktif'}
                        )
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        SessionStorage (
                        {adminSessionHealth?.layers.sessionStorage !== false
                          ? 'Aktif'
                          : 'Nonaktif'}
                        )
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        Cookie (
                        {adminSessionHealth?.layers.cookie !== false
                          ? 'Aktif'
                          : 'Nonaktif'}
                        )
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>
                        IndexedDB (
                        {adminSessionHealth?.layers.indexedDb !== false
                          ? 'Aktif'
                          : 'Nonaktif'}
                        )
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-semibold text-slate-800">
                          Sesi Google Cloud &amp; Spreadsheets:
                        </span>
                        {googleUser ? (
                          <>
                            <span className="font-medium text-emerald-700">
                              {googleUser.email}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              {hasGoogleToken
                                ? 'Token Sheets & Drive Aktif'
                                : 'Cloud Aktif (Klik Perbarui untuk Tulis Sheets)'}
                            </span>
                          </>
                        ) : (
                          <span className="text-amber-700">
                            Belum terhubung ke akun Google Cloud
                          </span>
                        )}
                      </div>

                      {!googleUser ? (
                        <GoogleSignInButton
                          onClick={onGoogleLogin}
                          label="Hubungkan Google Admin"
                        />
                      ) : !hasGoogleToken ? (
                        <button
                          type="button"
                          onClick={onGoogleLogin}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                          Perbarui Token Sheets
                        </button>
                      ) : null}
                    </div>
                  </div>
                </section>

              <div className="max-w-lg rounded-xl border border-slate-200 bg-white p-6 sm:p-8">
                <h2 className="text-lg font-bold text-slate-900">
                  Ubah PIN Admin Dispatcher
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Setelah PIN Default dirubah, PIN baru tersimpan secara{' '}
                  <strong className="font-semibold text-slate-900">
                    permanen
                  </strong>{' '}
                  di sistem, penyimpanan browser, Cloud, serta Google
                  Spreadsheets dan tidak akan kembali ke PIN Default.
                </p>

                <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
                  Status PIN Saat Ini:{' '}
                  <strong
                    className={
                      config.isDefaultPin
                        ? 'text-amber-700'
                        : 'text-emerald-700'
                    }
                  >
                    {config.isDefaultPin
                      ? 'Menggunakan PIN Default (123456)'
                      : 'PIN Kustom Permanen Aktif'}
                  </strong>
                </div>

                {pinError && (
                  <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700">
                    {pinError}
                  </div>
                )}

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    setPinError('');
                    if (!currentPin.trim() || !newPin.trim()) {
                      setPinError('PIN lama dan PIN baru wajib diisi.');
                      return;
                    }
                    if (newPin.trim().length < 4) {
                      setPinError(
                        'PIN baru minimal terdiri dari 4 karakter/angka.'
                      );
                      return;
                    }
                    if (newPin.trim() !== confirmNewPin.trim()) {
                      setPinError('Konfirmasi PIN baru tidak cocok.');
                      return;
                    }

                    triggerConfirm({
                      open: true,
                      title: 'Simpan Perubahan PIN Admin Permanen?',
                      description:
                        'PIN akses Admin Dispatcher Anda akan diperbarui secara permanen dan tidak akan kembali ke PIN Default.',
                      details: [
                        'PIN baru tersimpan permanen di server, perangkat, Cloud & Google Spreadsheets.',
                      ],
                      confirmLabel: 'Ubah PIN Permanen',
                      variant: 'primary',
                      action: async () => {
                        const ok = await onChangeAdminPin(
                          currentPin.trim(),
                          newPin.trim()
                        );
                        if (ok) {
                          setCurrentPin('');
                          setNewPin('');
                          setConfirmNewPin('');
                        }
                      },
                    });
                  }}
                  className="mt-6 space-y-4"
                >
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      PIN Admin Saat Ini *
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      required
                      value={currentPin}
                      onChange={(e) => setCurrentPin(e.target.value)}
                      placeholder="Masukkan PIN saat ini"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      PIN Baru (Minimal 4 Angka/Karakter) *
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      required
                      value={newPin}
                      onChange={(e) => setNewPin(e.target.value)}
                      placeholder="Masukkan PIN baru"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Ulangi PIN Baru *
                    </label>
                    <input
                      type="password"
                      inputMode="numeric"
                      required
                      value={confirmNewPin}
                      onChange={(e) => setConfirmNewPin(e.target.value)}
                      placeholder="Konfirmasi PIN baru"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3.5 py-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="rounded-lg bg-slate-900 px-5 py-2.5 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Perbarui PIN Admin
                    </button>
                  </div>
                </form>
              </div>

              {/* Clean Cache Surat Tugas & Factory Reset Card */}
              {(onPurgeAssignmentsCache || onResetApplication) && (
                <div className="rounded-xl border border-slate-200 bg-white p-6">
                  <h3 className="text-base font-bold text-slate-900">
                    Pembersihan Cache Surat Tugas &amp; Reset Data
                  </h3>
                  <p className="mt-1 text-xs text-slate-600">
                    Gunakan tombol di bawah untuk membersihkan seluruh cache dan riwayat Surat Tugas agar operasional dimulai dari data kosong tanpa menghapus Master Driver, Master Armada, atau Master Rute.
                  </p>
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    {onPurgeAssignmentsCache && (
                      <button
                        type="button"
                        onClick={() =>
                          triggerConfirm({
                            open: true,
                            title: 'Bersihkan Cache Surat Tugas & Mulai dari Data Kosong?',
                            description:
                              'Seluruh daftar Surat Tugas, antrean cache laporan offline, dan status unit Dalam Tugas akan direset ke data kosong (0 tugas). Data Master Driver, Master Armada, Master Rute, dan sesi login tetap tersimpan.',
                            details: [
                              `Surat Tugas Saat Ini : ${assignments.length} data (Akan Dikosongkan)`,
                              `Master Data          : ${drivers.length} Driver, ${vehicles.length} Armada, ${routes.length} Rute (Tetap Aman)`,
                            ],
                            confirmLabel: 'Bersihkan Cache Surat Tugas',
                            variant: 'danger',
                            action: async () => {
                              await onPurgeAssignmentsCache();
                            },
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-2.5 text-xs font-semibold text-red-700 hover:bg-red-100"
                      >
                        <Trash2 className="h-4 w-4" />
                        Bersihkan Cache Surat Tugas (Mulai Data Kosong)
                      </button>
                    )}
                    {onResetApplication && (
                      <button
                        type="button"
                        onClick={() =>
                          triggerConfirm({
                            open: true,
                            title: 'Reset Penuh Seluruh Penyimpanan Aplikasi?',
                            description:
                              'Tindakan ini mengosongkan seluruh Surat Tugas, cache browser, dan mengembalikan sesi ke halaman Login awal.',
                            details: [
                              'Seluruh Surat Tugas & Cache Lokal dihapus bersih',
                              'Anda akan diarahkan kembali ke halaman Login',
                            ],
                            confirmLabel: 'Reset Penuh Aplikasi',
                            variant: 'danger',
                            action: async () => {
                              await onResetApplication();
                            },
                          })
                        }
                        className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        Reset Penuh &amp; Keluar
                      </button>
                    )}
                  </div>
                </div>
              )}
              </div>
            )}

            {/* ================================================================= */}
            {/* MENU: MASTER KARTU FLEET CARD                                     */}
            {/* ================================================================= */}
            {activeMenu === 'master_fleet_card' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Master Kartu Fleet Card
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Kelola ID Fleet Card, Nomor Kartu Fleet Card, Update Saldo, Tambah Saldo (Top-Up), Edit, dan Hapus kartu operasional Pembelian BBM &amp; Tol.
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={openCreateFleetCardModal}
                    className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl sm:rounded-lg bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap shrink-0"
                  >
                    <Plus className="h-4 w-4" />
                    Tambah Kartu Fleet Card
                  </button>
                </div>

                {/* KPI Summary */}
                <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-3">
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Total Kartu Terdaftar
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold text-slate-900 tabular-nums">
                      {fleetCards.length}{' '}
                      <span className="text-xs font-medium text-slate-500">
                        Kartu
                      </span>
                    </p>
                  </div>
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Total Saldo Fleet Card Tersedia
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold text-emerald-700 tabular-nums">
                      {formatIdrCurrency(
                        fleetCards.reduce(
                          (acc, c) => acc + (Number.isFinite(c.balance) ? c.balance : 0),
                          0
                        )
                      )}
                    </p>
                  </div>
                  <div className="bg-white p-4 sm:p-5">
                    <p className="text-xs font-medium text-slate-500">
                      Akumulasi Pemakaian Kartu ({driverExpenses.length} Laporan)
                    </p>
                    <p className="mt-1 font-mono text-2xl font-bold text-sky-800 tabular-nums">
                      {formatIdrCurrency(
                        driverExpenses.reduce(
                          (acc, e) =>
                            acc +
                            (Number.isFinite(e.totalPengeluaran) &&
                            e.totalPengeluaran > 0
                              ? e.totalPengeluaran
                              : (e.totalPengirimanBbm || 0) +
                                (e.totalPengeluaranTol || 0)),
                          0
                        )
                      )}
                    </p>
                  </div>
                </div>

                {/* Search Input */}
                <div className="relative max-w-md">
                  <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="search"
                    value={fleetCardSearch}
                    onChange={(e) => setFleetCardSearch(e.target.value)}
                    placeholder="Cari ID Fleet Card atau Nomor Kartu Fleet Card..."
                    aria-label="Cari Master Kartu Fleet Card"
                    className="min-h-[42px] w-full rounded-xl sm:rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-9 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  {fleetCardSearch && (
                    <button
                      type="button"
                      onClick={() => setFleetCardSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                {/* Table / Mobile Cards */}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {filteredFleetCards.length === 0 ? (
                    <div className="px-6 py-12 text-center">
                      <CreditCard className="mx-auto h-8 w-8 text-slate-400" />
                      <h3 className="mt-3 text-sm font-semibold text-slate-900">
                        {fleetCards.length === 0
                          ? 'Belum Ada Master Kartu Fleet Card'
                          : 'Kartu Fleet Card Tidak Ditemukan'}
                      </h3>
                      <p className="mx-auto mt-1 max-w-md text-xs text-slate-500">
                        {fleetCards.length === 0
                          ? 'Tambahkan ID Fleet Card, Nomor Kartu Fleet Card, dan Saldo awal agar Driver dapat memilih kartu saat melaporkan pengeluaran Pembelian BBM & Tol harian.'
                          : 'Ubah kata kunci pencarian untuk melihat daftar kartu.'}
                      </p>
                      {fleetCards.length === 0 && (
                        <button
                          type="button"
                          onClick={openCreateFleetCardModal}
                          className="mt-4 inline-flex min-h-[42px] items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                        >
                          <Plus className="h-4 w-4" />
                          Tambah Kartu Pertama
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <div className="hidden md:block overflow-x-auto">
                        <table className="w-full text-left text-sm">
                          <thead className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                            <tr>
                              <th className="px-5 py-3.5">ID Fleet Card</th>
                              <th className="px-5 py-3.5">
                                Nomor Kartu Fleet Card
                              </th>
                              <th className="px-5 py-3.5 text-right">
                                Saldo Fleet Card
                              </th>
                              <th className="px-5 py-3.5 text-right">
                                Total Pemakaian
                              </th>
                              <th className="px-5 py-3.5 text-right">
                                Aksi (Update Saldo / Tambah Saldo / Edit / Hapus)
                              </th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredFleetCards.map((card) => {
                              const normNum = String(card.cardNumber || '')
                                .trim()
                                .replace(/[\s-]+/g, '')
                                .toUpperCase();
                              const usage =
                                fleetCardUsageMap.get(`NUM:${normNum}`) ||
                                fleetCardUsageMap.get(
                                  `ID:${card.id.toUpperCase()}`
                                ) || { txCount: 0, totalSpent: 0 };
                              return (
                                <tr
                                  key={card.id}
                                  className="transition-colors hover:bg-slate-50/70"
                                >
                                  <td className="px-5 py-3.5 font-mono text-xs font-bold text-slate-900 tabular-nums whitespace-nowrap">
                                    {card.id}
                                  </td>
                                  <td className="px-5 py-3.5">
                                    <div className="flex items-center gap-2">
                                      <span className="font-mono text-sm font-bold text-slate-900 tabular-nums">
                                        {card.cardNumber}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          onCopyText(
                                            card.cardNumber,
                                            `Nomor Kartu ${card.id}`
                                          )
                                        }
                                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                                        title="Salin Nomor Kartu Fleet Card"
                                      >
                                        <Copy className="h-3.5 w-3.5" />
                                      </button>
                                    </div>
                                  </td>
                                  <td
                                    className={`px-5 py-3.5 text-right font-mono text-sm font-bold tabular-nums whitespace-nowrap ${
                                      card.balance < 0
                                        ? 'text-rose-700'
                                        : 'text-emerald-700'
                                    }`}
                                  >
                                    {formatIdrCurrency(card.balance)}
                                  </td>
                                  <td className="px-5 py-3.5 text-right font-mono text-xs text-slate-700 tabular-nums whitespace-nowrap">
                                    <span className="font-semibold text-slate-900">
                                      {formatIdrCurrency(usage.totalSpent)}
                                    </span>
                                    <span className="ml-1.5 text-slate-400">
                                      · {usage.txCount}x
                                    </span>
                                  </td>
                                  <td className="px-5 py-3.5 text-right whitespace-nowrap">
                                    <div className="inline-flex items-center justify-end gap-2">
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openUpdateBalanceModal(card)
                                        }
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-sky-800 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-sky-900 whitespace-nowrap"
                                      >
                                        <RefreshCw className="h-3.5 w-3.5" />
                                        Update Saldo
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openTopUpFleetCardModal(card)
                                        }
                                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-800 whitespace-nowrap"
                                      >
                                        <Wallet className="h-3.5 w-3.5" />
                                        Tambah Saldo
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openEditFleetCardModal(card)
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-50 whitespace-nowrap"
                                      >
                                        <Edit3 className="h-3.5 w-3.5" />
                                        Edit
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          triggerConfirm({
                                            open: true,
                                            title: `Hapus Kartu Fleet Card ${card.id}?`,
                                            description:
                                              'Data kartu ini akan dihapus dari Master Kartu Fleet Card, Cloud Database, dan Google Spreadsheets.',
                                            details: [
                                              `ID Fleet Card          : ${card.id}`,
                                              `Nomor Kartu Fleet Card : ${card.cardNumber}`,
                                              `Saldo Saat Ini         : ${formatIdrCurrency(card.balance)}`,
                                            ],
                                            confirmLabel: 'Hapus Kartu',
                                            variant: 'danger',
                                            action: async () => {
                                              await onDeleteFleetCard(card.id);
                                            },
                                          })
                                        }
                                        className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-100 whitespace-nowrap"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                        Hapus
                                      </button>
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Cards */}
                      <div className="divide-y divide-slate-200 md:hidden">
                        {filteredFleetCards.map((card) => {
                          const normNum = String(card.cardNumber || '')
                            .trim()
                            .replace(/[\s-]+/g, '')
                            .toUpperCase();
                          const usage =
                            fleetCardUsageMap.get(`NUM:${normNum}`) ||
                            fleetCardUsageMap.get(
                              `ID:${card.id.toUpperCase()}`
                            ) || { txCount: 0, totalSpent: 0 };
                          return (
                            <div key={card.id} className="p-4 space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="font-mono text-xs font-semibold text-slate-500 tabular-nums">
                                    ID: {card.id} · {usage.txCount}x Laporan
                                  </p>
                                  <p className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                                    {card.cardNumber}
                                  </p>
                                </div>
                                <div className="text-right">
                                  <p className="text-[11px] text-slate-500">
                                    Saldo Fleet Card
                                  </p>
                                  <p
                                    className={`font-mono text-sm font-bold tabular-nums ${
                                      card.balance < 0
                                        ? 'text-rose-700'
                                        : 'text-emerald-700'
                                    }`}
                                  >
                                    {formatIdrCurrency(card.balance)}
                                  </p>
                                </div>
                              </div>

                              <div className="grid grid-cols-2 gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() => openUpdateBalanceModal(card)}
                                  className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-sky-800 px-3 py-2 text-xs font-semibold text-white hover:bg-sky-900 whitespace-nowrap"
                                >
                                  <RefreshCw className="h-3.5 w-3.5" />
                                  Update Saldo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openTopUpFleetCardModal(card)}
                                  className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                                >
                                  <Wallet className="h-3.5 w-3.5" />
                                  Tambah Saldo
                                </button>
                                <button
                                  type="button"
                                  onClick={() => openEditFleetCardModal(card)}
                                  className="inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  Edit
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    triggerConfirm({
                                      open: true,
                                      title: `Hapus Kartu Fleet Card ${card.id}?`,
                                      description:
                                        'Data kartu ini akan dihapus dari Master Kartu Fleet Card.',
                                      details: [
                                        `ID Fleet Card          : ${card.id}`,
                                        `Nomor Kartu Fleet Card : ${card.cardNumber}`,
                                        `Saldo Saat Ini         : ${formatIdrCurrency(card.balance)}`,
                                      ],
                                      confirmLabel: 'Hapus Kartu',
                                      variant: 'danger',
                                      action: async () => {
                                        await onDeleteFleetCard(card.id);
                                      },
                                    })
                                  }
                                  className="inline-flex min-h-[42px] items-center justify-center gap-1 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-xs font-semibold text-rose-700 hover:bg-rose-100 whitespace-nowrap"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Hapus
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}

            {/* ================================================================= */}
            {/* MENU: DATA_PENGELUARAN DRIVER                                     */}
            {/* ================================================================= */}
            {activeMenu === 'pengeluaran_driver' && (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-lg font-bold text-slate-900">
                      Data_Pengeluaran Driver
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Rekapitulasi laporan harian pengeluaran Pembelian BBM &amp; Tol dari Portal Driver beserta Tanggal &amp; Tujuan Pengiriman (tersinkronisasi otomatis ke Sheet Pengeluaran_Driver).
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => {
                        const effectiveSelectedDate =
                          expenseDateFilter ||
                          (() => {
                            try {
                              return new Intl.DateTimeFormat('en-CA', {
                                timeZone: 'Asia/Jakarta',
                                year: 'numeric',
                                month: '2-digit',
                                day: '2-digit',
                              }).format(new Date());
                            } catch {
                              return new Date().toISOString().slice(0, 10);
                            }
                          })();
                        const result = downloadFleetCardExpensePdfReport({
                          expenses: driverExpenses,
                          fleetCards,
                          periodMode: expensePeriodMode,
                          selectedDate:
                            expensePeriodMode === 'DAILY'
                              ? expenseDateFilter || ''
                              : effectiveSelectedDate,
                          selectedMonth: expenseMonthFilter,
                          fleetCardFilter: expenseCardFilter,
                        });
                        onNotify?.(
                          'success',
                          'Laporan PDF Berhasil Diunduh',
                          `${result.fileName} (${result.rowCount} data pengeluaran).`
                        );
                      }}
                      className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl sm:rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap"
                    >
                      <Download className="h-4 w-4" />
                      Unduh PDF
                    </button>

                    <button
                      type="button"
                      onClick={() => setActiveMenu('master_fleet_card')}
                      className="inline-flex min-h-[42px] items-center justify-center gap-2 rounded-xl sm:rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
                    >
                      <CreditCard className="h-4 w-4 text-sky-700" />
                      Kelola Master Kartu Fleet Card ({fleetCards.length})
                    </button>
                  </div>
                </div>

                {/* Fleet Card Expense Visualization (Includes Harian / Bulanan PDF Report Controls) */}
                <FleetCardExpenseVisualizationSection
                  fleetCards={fleetCards}
                  driverExpenses={driverExpenses}
                  onOpenFleetCardMenu={() => setActiveMenu('master_fleet_card')}
                  onPdfDownloaded={(fileName, rowCount) =>
                    onNotify?.(
                      'success',
                      'Laporan PDF Berhasil Diunduh',
                      `${fileName} (${rowCount} data pengeluaran).`
                    )
                  }
                />

                {/* Filter, Period (Harian / Bulanan) & Direct PDF Download Bar */}
                <div className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
                    <div className="relative flex-1">
                      <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                      <input
                        type="search"
                        value={expenseSearch}
                        onChange={(e) => setExpenseSearch(e.target.value)}
                        placeholder="Cari Nama Driver, Nomor Kartu Fleet Card, Tujuan Pengiriman, No. Polisi, atau Surat Tugas..."
                        aria-label="Cari Data Pengeluaran Driver"
                        className="min-h-[42px] w-full rounded-xl sm:rounded-lg border border-slate-300 bg-white py-2 pl-10 pr-9 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                      {expenseSearch && (
                        <button
                          type="button"
                          onClick={() => setExpenseSearch('')}
                          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700"
                        >
                          <X className="h-4 w-4" />
                        </button>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="inline-flex rounded-lg border border-slate-300 bg-slate-100 p-0.5">
                        <button
                          type="button"
                          onClick={() => setExpensePeriodMode('DAILY')}
                          className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                            expensePeriodMode === 'DAILY'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Harian
                        </button>
                        <button
                          type="button"
                          onClick={() => setExpensePeriodMode('MONTHLY')}
                          className={`min-h-[38px] rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
                            expensePeriodMode === 'MONTHLY'
                              ? 'bg-white text-slate-900 shadow-xs'
                              : 'text-slate-600 hover:text-slate-900'
                          }`}
                        >
                          Bulanan
                        </button>
                      </div>

                      {expensePeriodMode === 'DAILY' ? (
                        <input
                          type="date"
                          value={expenseDateFilter}
                          onChange={(e) => setExpenseDateFilter(e.target.value)}
                          aria-label="Filter tanggal pengeluaran harian"
                          className="min-h-[42px] rounded-xl sm:rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 tabular-nums focus:border-slate-900 focus:outline-none"
                        />
                      ) : (
                        <input
                          type="month"
                          value={expenseMonthFilter}
                          onChange={(e) => setExpenseMonthFilter(e.target.value)}
                          aria-label="Filter bulan pengeluaran bulanan"
                          className="min-h-[42px] rounded-xl sm:rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-800 tabular-nums focus:border-slate-900 focus:outline-none"
                        />
                      )}

                      <select
                        value={expenseCardFilter}
                        onChange={(e) => setExpenseCardFilter(e.target.value)}
                        aria-label="Filter berdasarkan Nomor Kartu Fleet Card"
                        className="min-h-[42px] rounded-xl sm:rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 focus:border-slate-900 focus:outline-none"
                      >
                        <option value="ALL">Semua Nomor Kartu Fleet Card</option>
                        {uniqueExpenseCardNumbers.map((cardNum) => (
                          <option key={cardNum} value={cardNum}>
                            Kartu: {cardNum}
                          </option>
                        ))}
                      </select>

                      <button
                        type="button"
                        onClick={() => {
                          const result = downloadFleetCardExpensePdfReport({
                            expenses: driverExpenses,
                            fleetCards,
                            periodMode: expensePeriodMode,
                            selectedDate: expenseDateFilter,
                            selectedMonth: expenseMonthFilter,
                            fleetCardFilter: expenseCardFilter,
                          });
                          onNotify?.(
                            'success',
                            'Laporan PDF Berhasil Diunduh',
                            `${result.fileName} (${result.rowCount} data pengeluaran).`
                          );
                        }}
                        className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl sm:rounded-lg bg-sky-800 px-3.5 py-2 text-xs font-semibold text-white transition-colors hover:bg-sky-900 whitespace-nowrap"
                      >
                        <Download className="h-3.5 w-3.5" />
                        Unduh PDF ({expensePeriodMode === 'DAILY' ? 'Harian' : 'Bulanan'})
                      </button>

                      {(expenseSearch ||
                        expenseCardFilter !== 'ALL' ||
                        expenseDateFilter ||
                        expensePeriodMode !== 'DAILY') && (
                        <button
                          type="button"
                          onClick={() => {
                            setExpenseSearch('');
                            setExpenseCardFilter('ALL');
                            setExpensePeriodMode('DAILY');
                            setExpenseDateFilter('');
                          }}
                          className="min-h-[42px] rounded-xl sm:rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                        >
                          Reset Filter
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Expense Table & Mobile Cards */}
                <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                  {filteredDriverExpenses.length === 0 ? (
                    <div className="px-6 py-12 text-center">
                      <Receipt className="mx-auto h-8 w-8 text-slate-400" />
                      <h3 className="mt-3 text-sm font-semibold text-slate-900">
                        {driverExpenses.length === 0
                          ? 'Belum Ada Data_Pengeluaran Driver'
                          : 'Tidak Ada Laporan Pengeluaran Sesuai Filter'}
                      </h3>
                      <p className="mx-auto mt-1 max-w-lg text-xs text-slate-500">
                        {driverExpenses.length === 0
                          ? 'Saat Driver telah menyelesaikan seluruh Surat Tugas harian dan menekan "Selesai dan Laporkan" pada Form Input Pengeluaran, data otomatis masuk ke sini serta ke Sheet Pengeluaran_Driver.'
                          : 'Sesuaikan filter Nomor Kartu Fleet Card, periode Harian/Bulanan, atau kata kunci pencarian.'}
                      </p>
                    </div>
                  ) : (
                    <>
                      <div className="hidden lg:block overflow-x-auto">
                        <table className="w-full text-left text-xs sm:text-sm">
                          <thead className="border-b border-slate-200 bg-slate-50/80 text-[11px] font-semibold text-slate-600">
                            <tr>
                              <th className="px-4 py-3.5">Timestamp Otomatis</th>
                              <th className="px-4 py-3.5">
                                Tanggal &amp; Tujuan Pengiriman
                              </th>
                              <th className="px-4 py-3.5">
                                Driver &amp; Tugas Selesai
                              </th>
                              <th className="px-4 py-3.5">
                                Nomor Kartu Fleet Card
                              </th>
                              <th className="px-4 py-3.5 text-right">
                                Total Pembelian BBM &amp; Struk
                              </th>
                              <th className="px-4 py-3.5 text-right">
                                Total Pengeluaran Tol &amp; Struk
                              </th>
                              <th className="px-4 py-3.5 text-right">
                                Total Pengeluaran
                              </th>
                              <th className="px-4 py-3.5 text-right">Aksi</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredDriverExpenses.map((exp) => {
                              const hasBbmReceipt = Boolean(
                                exp.fotoStrukBbm || exp.fotoStrukBbmUrl
                              );
                              const hasTolReceipt = Boolean(
                                exp.fotoStrukTol || exp.fotoStrukTolUrl
                              );
                              const bbmImgUrl =
                                exp.fotoStrukBbm ||
                                `/api/driver-expenses/${encodeURIComponent(
                                  exp.id
                                )}/media/struk-bbm`;
                              const tolImgUrl =
                                exp.fotoStrukTol ||
                                `/api/driver-expenses/${encodeURIComponent(
                                  exp.id
                                )}/media/struk-tol`;
                              const totalVal =
                                Number.isFinite(exp.totalPengeluaran) &&
                                exp.totalPengeluaran > 0
                                  ? exp.totalPengeluaran
                                  : (exp.totalPengirimanBbm || 0) +
                                    (exp.totalPengeluaranTol || 0);
                              const shippingDate =
                                exp.tanggalPengiriman || exp.tanggal || '-';

                              return (
                                <tr
                                  key={exp.id}
                                  className="align-top transition-colors hover:bg-slate-50/70"
                                >
                                  <td className="px-4 py-3.5 whitespace-nowrap">
                                    <p className="font-mono text-xs font-semibold text-slate-900 tabular-nums">
                                      {formatRealTimeTimestamp(exp.timestamp)}
                                    </p>
                                    <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                                      {exp.id} · {exp.tanggal}
                                    </p>
                                  </td>

                                  <td className="px-4 py-3.5">
                                    <p className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                                      {shippingDate}
                                    </p>
                                    <p className="mt-0.5 text-xs font-medium text-slate-700">
                                      {exp.tujuanPengiriman ? (
                                        exp.tujuanPengiriman
                                      ) : (
                                        <span className="text-slate-400">
                                          Belum dicantumkan
                                        </span>
                                      )}
                                    </p>
                                  </td>

                                  <td className="px-4 py-3.5">
                                    <p className="text-xs sm:text-sm font-semibold text-slate-900">
                                      {exp.driverName}{' '}
                                      <span className="font-mono text-xs font-normal text-slate-500 tabular-nums">
                                        · {exp.driverId}
                                      </span>
                                    </p>
                                    <p className="mt-0.5 text-xs text-slate-600">
                                      {exp.plateNumber ? (
                                        <span className="font-mono font-semibold text-slate-800">
                                          {exp.plateNumber}
                                        </span>
                                      ) : (
                                        <span>Tanpa No. Polisi</span>
                                      )}
                                      {exp.completedAssignmentNos ? (
                                        <span className="font-mono text-slate-500 tabular-nums">
                                          {' '}
                                          · Tugas: {exp.completedAssignmentNos}
                                        </span>
                                      ) : null}
                                    </p>
                                    {exp.catatan ? (
                                      <p className="mt-0.5 text-[11px] text-slate-500">
                                        Catatan: {exp.catatan}
                                      </p>
                                    ) : null}
                                  </td>

                                  <td className="px-4 py-3.5 whitespace-nowrap">
                                    <p className="font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums">
                                      {exp.fleetCardNumber}
                                    </p>
                                    {exp.fleetCardId && (
                                      <p className="font-mono text-[11px] text-slate-500 tabular-nums">
                                        ID Kartu: {exp.fleetCardId}
                                      </p>
                                    )}
                                  </td>

                                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                    <p className="font-mono text-xs sm:text-sm font-bold text-sky-800 tabular-nums">
                                      {formatIdrCurrency(
                                        exp.totalPengirimanBbm || 0
                                      )}
                                    </p>
                                    {hasBbmReceipt ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openReceiptPreview(
                                            `Foto Struk Pembelian BBM — ${exp.driverName}`,
                                            `Kartu ${exp.fleetCardNumber} · ${formatIdrCurrency(exp.totalPengirimanBbm || 0)} · ${formatRealTimeTimestamp(exp.timestamp)}`,
                                            bbmImgUrl,
                                            exp.fotoStrukBbmUrl
                                          )
                                        }
                                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline"
                                      >
                                        <ImageIcon className="h-3 w-3" />
                                        Lihat Struk BBM
                                      </button>
                                    ) : (
                                      <p className="mt-0.5 text-[11px] text-slate-400">
                                        Tanpa foto struk
                                      </p>
                                    )}
                                  </td>

                                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                    <p className="font-mono text-xs sm:text-sm font-bold text-slate-900 tabular-nums">
                                      {formatIdrCurrency(
                                        exp.totalPengeluaranTol || 0
                                      )}
                                    </p>
                                    {hasTolReceipt ? (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openReceiptPreview(
                                            `Foto Struk Pengeluaran Tol — ${exp.driverName}`,
                                            `Kartu ${exp.fleetCardNumber} · ${formatIdrCurrency(exp.totalPengeluaranTol || 0)} · ${formatRealTimeTimestamp(exp.timestamp)}`,
                                            tolImgUrl,
                                            exp.fotoStrukTolUrl
                                          )
                                        }
                                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline"
                                      >
                                        <ImageIcon className="h-3 w-3" />
                                        Lihat Struk Tol
                                      </button>
                                    ) : (
                                      <p className="mt-0.5 text-[11px] text-slate-400">
                                        Tanpa foto struk
                                      </p>
                                    )}
                                  </td>

                                  <td className="px-4 py-3.5 text-right font-mono text-xs sm:text-sm font-bold text-slate-950 tabular-nums whitespace-nowrap">
                                    {formatIdrCurrency(totalVal)}
                                  </td>

                                  <td className="px-4 py-3.5 text-right whitespace-nowrap">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        triggerConfirm({
                                          open: true,
                                          title: `Hapus Laporan Pengeluaran ${exp.id}?`,
                                          description:
                                            'Data pengeluaran akan dihapus dari Data_Pengeluaran Driver, Cloud Database, dan Sheet Pengeluaran_Driver. Saldo kartu Fleet Card yang terpotong akan dikembalikan otomatis.',
                                          details: [
                                            `Driver               : ${exp.driverName} (${exp.driverId})`,
                                            `Tanggal Pengiriman   : ${shippingDate}`,
                                            `Tujuan Pengiriman    : ${exp.tujuanPengiriman || '-'}`,
                                            `Nomor Kartu          : ${exp.fleetCardNumber}`,
                                            `Total Pembelian BBM  : ${formatIdrCurrency(exp.totalPengirimanBbm || 0)}`,
                                            `Total Pengeluaran Tol: ${formatIdrCurrency(exp.totalPengeluaranTol || 0)}`,
                                            `Saldo Dikembalikan   : +${formatIdrCurrency(totalVal)}`,
                                          ],
                                          confirmLabel: 'Hapus Laporan',
                                          variant: 'danger',
                                          action: async () => {
                                            await onDeleteDriverExpense(exp.id);
                                          },
                                        })
                                      }
                                      className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50 px-2.5 py-1.5 text-xs font-semibold text-rose-700 hover:bg-rose-100"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                      Hapus
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Mobile Cards */}
                      <div className="divide-y divide-slate-200 lg:hidden">
                        {filteredDriverExpenses.map((exp) => {
                          const hasBbmReceipt = Boolean(
                            exp.fotoStrukBbm || exp.fotoStrukBbmUrl
                          );
                          const hasTolReceipt = Boolean(
                            exp.fotoStrukTol || exp.fotoStrukTolUrl
                          );
                          const bbmImgUrl =
                            exp.fotoStrukBbm ||
                            `/api/driver-expenses/${encodeURIComponent(
                              exp.id
                            )}/media/struk-bbm`;
                          const tolImgUrl =
                            exp.fotoStrukTol ||
                            `/api/driver-expenses/${encodeURIComponent(
                              exp.id
                            )}/media/struk-tol`;
                          const totalVal =
                            Number.isFinite(exp.totalPengeluaran) &&
                            exp.totalPengeluaran > 0
                              ? exp.totalPengeluaran
                              : (exp.totalPengirimanBbm || 0) +
                                (exp.totalPengeluaranTol || 0);
                          const shippingDate =
                            exp.tanggalPengiriman || exp.tanggal || '-';

                          return (
                            <div key={exp.id} className="p-4 space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div>
                                  <p className="text-sm font-bold text-slate-900">
                                    {exp.driverName}{' '}
                                    <span className="font-mono text-xs font-normal text-slate-500 tabular-nums">
                                      · {exp.driverId}
                                    </span>
                                  </p>
                                  <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                                    {formatRealTimeTimestamp(exp.timestamp)}
                                  </p>
                                </div>
                                <p className="font-mono text-sm font-bold text-slate-950 tabular-nums">
                                  {formatIdrCurrency(totalVal)}
                                </p>
                              </div>

                              <div className="text-xs text-slate-700 space-y-1">
                                <p>
                                  Kartu Fleet Card:{' '}
                                  <strong className="font-mono tabular-nums text-slate-900">
                                    {exp.fleetCardNumber}
                                  </strong>
                                  {exp.plateNumber ? (
                                    <span className="font-mono text-slate-600">
                                      {' '}
                                      · {exp.plateNumber}
                                    </span>
                                  ) : null}
                                </p>
                                <p>
                                  Tgl Pengiriman:{' '}
                                  <strong className="font-mono tabular-nums text-slate-900">
                                    {shippingDate}
                                  </strong>
                                  {exp.tujuanPengiriman ? (
                                    <span className="text-slate-700">
                                      {' '}
                                      · Tujuan: <strong>{exp.tujuanPengiriman}</strong>
                                    </span>
                                  ) : null}
                                </p>
                                <div className="grid grid-cols-2 gap-2 pt-1">
                                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                                    <p className="text-[11px] text-slate-500">
                                      Total Pembelian BBM
                                    </p>
                                    <p className="font-mono text-xs font-bold text-sky-800 tabular-nums">
                                      {formatIdrCurrency(
                                        exp.totalPengirimanBbm || 0
                                      )}
                                    </p>
                                    {hasBbmReceipt && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openReceiptPreview(
                                            `Foto Struk Pembelian BBM — ${exp.driverName}`,
                                            `Kartu ${exp.fleetCardNumber} · ${formatIdrCurrency(exp.totalPengirimanBbm || 0)}`,
                                            bbmImgUrl,
                                            exp.fotoStrukBbmUrl
                                          )
                                        }
                                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 underline"
                                      >
                                        <ImageIcon className="h-3 w-3" />
                                        Struk BBM
                                      </button>
                                    )}
                                  </div>
                                  <div className="rounded-lg border border-slate-200 bg-slate-50/70 p-2.5">
                                    <p className="text-[11px] text-slate-500">
                                      Total Pengeluaran Tol
                                    </p>
                                    <p className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                                      {formatIdrCurrency(
                                        exp.totalPengeluaranTol || 0
                                      )}
                                    </p>
                                    {hasTolReceipt && (
                                      <button
                                        type="button"
                                        onClick={() =>
                                          openReceiptPreview(
                                            `Foto Struk Pengeluaran Tol — ${exp.driverName}`,
                                            `Kartu ${exp.fleetCardNumber} · ${formatIdrCurrency(exp.totalPengeluaranTol || 0)}`,
                                            tolImgUrl,
                                            exp.fotoStrukTolUrl
                                          )
                                        }
                                        className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-700 underline"
                                      >
                                        <ImageIcon className="h-3 w-3" />
                                        Struk Tol
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>

                              <div className="flex justify-end pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    triggerConfirm({
                                      open: true,
                                      title: `Hapus Laporan Pengeluaran ${exp.id}?`,
                                      description:
                                        'Laporan akan dihapus dan saldo kartu Fleet Card akan dikembalikan.',
                                      details: [
                                        `Driver      : ${exp.driverName}`,
                                        `Pengiriman  : ${shippingDate} · ${exp.tujuanPengiriman || '-'}`,
                                        `Nomor Kartu : ${exp.fleetCardNumber}`,
                                        `Total       : ${formatIdrCurrency(totalVal)}`,
                                      ],
                                      confirmLabel: 'Hapus Laporan',
                                      variant: 'danger',
                                      action: async () => {
                                        await onDeleteDriverExpense(exp.id);
                                      },
                                    })
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border border-rose-200 bg-rose-50 px-3 py-1.5 text-xs font-semibold text-rose-700"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                  Hapus Laporan
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>

        {/* ================================================================= */}
        {/* MODAL: BUAT / EDIT SURAT TUGAS (Tanpa Template Rute Opsional)     */}
        {/* ================================================================= */}
        {assignmentModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
            <div className="sheet-enter max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {editingAssignment
                      ? `Edit Surat Tugas (${editingAssignment.noPenugasan})`
                      : 'Buat Surat Tugas Pengiriman Dingin'}
                  </h3>
                  {!editingAssignment && nextPreviewNo && (
                    <p className="mt-0.5 text-xs text-slate-500">
                      Nomor Surat Tugas Berurutan Otomatis:{' '}
                      <strong className="font-mono text-slate-900 tabular-nums">
                        {nextPreviewNo}
                      </strong>
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setAssignmentModalOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const serializedSj = serializeSuratJalanList(suratJalanList);
                  const payloadForm = {
                    ...asgForm,
                    noSuratJalanFisik: serializedSj,
                  };

                  if (editingAssignment) {
                    triggerConfirm({
                      open: true,
                      title: 'Simpan Perubahan Surat Tugas?',
                      description:
                        'Data Surat Tugas rantai dingin akan diperbarui dan langsung disinkronkan ke lembar Surat_Tugas pada Google Spreadsheets.',
                      details: [
                        `No. Penugasan : ${editingAssignment.noPenugasan}`,
                        `SJ Fisik/Segel: ${serializedSj || '-'} / ${
                          asgForm.kodeSegel || '-'
                        }`,
                        `Driver & Unit : ${asgForm.driverId} (${asgForm.driverName}) · ${asgForm.plateNumber}`,
                        `Asal -> Tujuan: ${asgForm.origin} -> ${asgForm.destination}`,
                        asgForm.beratMuatan
                          ? `Berat Muatan  : ${asgForm.beratMuatan}`
                          : '',
                        asgForm.volumeCbm
                          ? `Volume CBM    : ${asgForm.volumeCbm}`
                          : '',
                      ].filter(Boolean),
                      confirmLabel: 'Simpan Perubahan',
                      variant: 'primary',
                      action: async () => {
                        const ok = await onUpdateAssignment(
                          editingAssignment.id,
                          {
                            ...payloadForm,
                            kmAwal:
                              asgForm.kmAwal !== ''
                                ? Number(asgForm.kmAwal)
                                : '',
                            suhuAwal: asgForm.suhuAwal,
                            kmAkhir:
                              asgForm.kmAkhir !== ''
                                ? Number(asgForm.kmAkhir)
                                : '',
                            suhuAkhir: asgForm.suhuAkhir,
                            penerimaNama: asgForm.penerimaNama,
                          }
                        );
                        if (ok) setAssignmentModalOpen(false);
                      },
                    });
                    return;
                  }

                  // Requirement #3: 1-Click Terbitkan Surat Tugas -> directly save & open WhatsApp
                  setCreatingSubmitting(true);
                  try {
                    const clickTime = new Date();
                    const lockedTimeStr = formatDatabaseTimestamp(clickTime);
                    const notif = await onCreateAssignment(
                      {
                        ...payloadForm,
                        tanggalTugas: lockedTimeStr,
                        createdAt: lockedTimeStr,
                      },
                      createWaMode
                    );
                    if (notif) {
                      setLastCreatedNotification(notif);
                      setAssignmentModalOpen(false);
                    }
                  } finally {
                    setCreatingSubmitting(false);
                  }
                }}
                className="mt-5 space-y-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                      <Lock className="h-3.5 w-3.5 text-emerald-700" />
                      <span>Tanggal &amp; Waktu Terbit *</span>
                    </label>
                    {editingAssignment ? (
                      <input
                        type="text"
                        required
                        value={asgForm.tanggalTugas}
                        onChange={(e) => {
                          const val = e.target.value;
                          setAsgForm((p) => ({ ...p, tanggalTugas: val }));
                        }}
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    ) : (
                      <div className="mt-1.5 flex min-h-[42px] items-center justify-between rounded-lg border border-emerald-300 bg-emerald-50/70 px-3 py-2">
                        <div className="flex items-center gap-2">
                          <Clock className="h-3.5 w-3.5 text-emerald-700 shrink-0" />
                          <span className="font-mono text-xs font-bold text-slate-900 tabular-nums">
                            {formatRealTimeTimestamp(liveNow)}
                          </span>
                        </div>
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-800">
                          <Lock className="h-3 w-3" />
                          Terkunci Real-Time
                        </span>
                      </div>
                    )}
                    <p className="mt-1 text-[11px] text-slate-500">
                      {editingAssignment
                        ? 'Waktu penerbitan Surat Tugas.'
                        : 'Tanggal & waktu dikunci otomatis saat tombol "Terbitkan Surat Tugas" diklik.'}
                    </p>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Target Jam Tiba / SLA OTD (Opsional)
                    </label>
                    <input
                      type="time"
                      value={asgForm.jadwalJamTiba}
                      onChange={(e) =>
                        setAsgForm((p) => ({
                          ...p,
                          jadwalJamTiba: e.target.value,
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  {editingAssignment && (
                    <div className="sm:col-span-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        Status Penugasan
                      </label>
                      <select
                        value={asgForm.status}
                        onChange={(e) =>
                          setAsgForm((p) => ({
                            ...p,
                            status: e.target.value as TaskStatus,
                          }))
                        }
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                      >
                        <option value={TaskStatus.MENUNGGU_BERANGKAT}>
                          Menunggu Berangkat
                        </option>
                        <option value={TaskStatus.DALAM_PERJALANAN}>
                          Dalam Perjalanan
                        </option>
                        <option value={TaskStatus.DELIVERED}>Delivered</option>
                        <option value={TaskStatus.HANDOVER}>Handover</option>
                        <option value={TaskStatus.SELESAI}>Selesai</option>
                      </select>
                    </div>
                  )}

                  {/* Multi-Input No. Surat Jalan Fisik & Kode Segel */}
                  <div className="sm:col-span-2 grid grid-cols-1 gap-4 sm:grid-cols-12">
                    <div className="sm:col-span-7">
                      <div className="flex items-center justify-between gap-2">
                        <label className="block text-xs font-semibold text-slate-700">
                          No. Surat Jalan Fisik *{' '}
                          {suratJalanList.filter((s) => s.trim()).length > 1 && (
                            <span className="font-mono text-slate-500 tabular-nums">
                              ({suratJalanList.filter((s) => s.trim()).length} SJ)
                            </span>
                          )}
                        </label>
                        {suratJalanList.length < 12 && (
                          <button
                            type="button"
                            onClick={() =>
                              setSuratJalanList((prev) => [...prev, ''])
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2 py-1 text-[11px] font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                          >
                            <Plus className="h-3 w-3" />
                            Tambah No. Surat Jalan
                          </button>
                        )}
                      </div>

                      <div className="mt-1.5 space-y-2">
                        {suratJalanList.map((sjVal, idx) => (
                          <div key={idx} className="flex items-center gap-2">
                            <input
                              type="text"
                              required={idx === 0}
                              value={sjVal}
                              onChange={(e) => {
                                const rawVal = e.target.value;
                                // Auto-split if user pastes comma/semicolon-separated SJ numbers
                                if (/[,;\n]/.test(rawVal)) {
                                  const parts = parseSuratJalanList(rawVal);
                                  if (parts.length > 1) {
                                    setSuratJalanList((prev) => {
                                      const next = [...prev];
                                      next.splice(idx, 1, ...parts);
                                      return next.slice(0, 12);
                                    });
                                    return;
                                  }
                                }
                                setSuratJalanList((prev) =>
                                  prev.map((item, i) =>
                                    i === idx ? rawVal : item
                                  )
                                );
                              }}
                              placeholder={
                                idx === 0
                                  ? 'Contoh: SJF-CRK-00891'
                                  : `No. Surat Jalan tambahan #${idx + 1}`
                              }
                              className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                            />
                            {suratJalanList.length > 1 && (
                              <button
                                type="button"
                                onClick={() =>
                                  setSuratJalanList((prev) =>
                                    prev.filter((_, i) => i !== idx)
                                  )
                                }
                                className="rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-red-50 hover:text-red-600 shrink-0"
                                title="Hapus baris No. Surat Jalan ini"
                                aria-label={`Hapus No. Surat Jalan #${idx + 1}`}
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-slate-500">
                        Klik &ldquo;+ Tambah No. Surat Jalan&rdquo; jika 1
                        pengiriman membawa lebih dari satu Surat Jalan.
                      </p>
                    </div>

                    <div className="sm:col-span-5">
                      <label className="block text-xs font-semibold text-slate-700">
                        Kode Segel Box Pendingin *
                      </label>
                      <input
                        type="text"
                        required
                        value={asgForm.kodeSegel}
                        onChange={(e) =>
                          setAsgForm((p) => ({
                            ...p,
                            kodeSegel: e.target.value.toUpperCase(),
                          }))
                        }
                        placeholder="Contoh: SGL-992104"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-slate-900 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Pilih Driver (Master Driver) *
                    </label>
                    {drivers.length > 0 ? (
                      <select
                        required
                        value={asgForm.driverId}
                        onChange={(e) =>
                          handleDriverSelectInAssignment(e.target.value)
                        }
                        className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                      >
                        <option value="">-- Pilih Driver --</option>
                        {drivers.map((d) => (
                          <option key={d.id} value={d.id}>
                            {d.id} — {d.name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        required
                        value={asgForm.driverId}
                        onChange={(e) =>
                          setAsgForm((p) => ({
                            ...p,
                            driverId: e.target.value,
                          }))
                        }
                        placeholder="ID Driver (mis. DRV-001)"
                        className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm"
                      />
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Nama Driver *
                    </label>
                    <input
                      type="text"
                      required
                      value={asgForm.driverName}
                      onChange={(e) =>
                        setAsgForm((p) => ({
                          ...p,
                          driverName: e.target.value,
                        }))
                      }
                      placeholder="Nama lengkap driver"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Pilih Unit Armada Reefer
                    </label>
                    <select
                      value={asgForm.vehicleId}
                      onChange={(e) =>
                        handleVehicleSelectInAssignment(e.target.value)
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    >
                      <option value="">
                        -- Pilih dari Master Armada / Isi Manual --
                      </option>
                      {vehicles.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.plateNumber} — {v.vehicleType} ({v.status})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Nomor Polisi Kendaraan *
                    </label>
                    <input
                      type="text"
                      required
                      value={asgForm.plateNumber}
                      onChange={(e) =>
                        setAsgForm((p) => ({
                          ...p,
                          plateNumber: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="Contoh: B 9124 CRK"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  {/* Titik Keberangkatan Driver (Diisi oleh Driver pada Formulir Keberangkatan) */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      {editingAssignment
                        ? 'Titik Keberangkatan Driver'
                        : 'Titik Keberangkatan Awal (Opsional — Diisi Driver)'}
                    </label>
                    <input
                      type="text"
                      value={asgForm.origin}
                      onChange={(e) =>
                        setAsgForm((p) => ({ ...p, origin: e.target.value }))
                      }
                      placeholder="Diisi oleh Driver pada Formulir Keberangkatan"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                    {!editingAssignment && (
                      <p className="mt-1 text-[11px] text-slate-500">
                        Driver wajib mengisi titik keberangkatan aktual saat
                        mengisi Formulir Keberangkatan.
                      </p>
                    )}
                  </div>

                  {/* Lokasi Tujuan from Master Rute Tujuan */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Lokasi Tujuan (Master Rute) *
                    </label>
                    {routes.length > 0 && (
                      <select
                        value={asgForm.routeId}
                        onChange={(e) =>
                          handleRouteSelectInAssignment(e.target.value)
                        }
                        className="mt-1.5 mb-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                      >
                        <option value="">-- Pilih Tujuan dari Master Rute --</option>
                        {routes.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.id} — {r.destination}
                          </option>
                        ))}
                      </select>
                    )}
                    <input
                      type="text"
                      required
                      value={asgForm.destination}
                      onChange={(e) =>
                        setAsgForm((p) => ({
                          ...p,
                          destination: e.target.value,
                        }))
                      }
                      placeholder="Lokasi Tujuan Pengiriman"
                      className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Deskripsi Muatan Rantai Dingin &amp; Target Suhu
                    </label>
                    <input
                      type="text"
                      value={asgForm.purpose}
                      onChange={(e) =>
                        setAsgForm((p) => ({ ...p, purpose: e.target.value }))
                      }
                      placeholder="Contoh: Frozen Poultry (Target Suhu -18°C)"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="block text-xs font-semibold text-slate-700">
                        Berat Muatan (Ton / Kg)
                      </label>
                      {liveFormLoadPreview.utilizationPct !== null && (
                        <span
                          className={`font-mono text-[11px] font-semibold tabular-nums ${
                            liveFormLoadPreview.category === 'OVERLOAD'
                              ? 'text-red-600'
                              : liveFormLoadPreview.category === 'OPTIMAL'
                              ? 'text-emerald-700'
                              : 'text-sky-700'
                          }`}
                        >
                          Utilitas Berat: {liveFormLoadPreview.utilizationPct}% (
                          {liveFormLoadPreview.capacityDisplay})
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={asgForm.beratMuatan}
                      onChange={(e) =>
                        setAsgForm((p) => ({
                          ...p,
                          beratMuatan: e.target.value,
                        }))
                      }
                      placeholder="Contoh: 3.5 Ton / 2500 Kg"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  {/* Volume Muatan (CBM) + Kalkulator P x L x T x Koli + Simulasi CBM Unit */}
                  <div className="sm:col-span-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3.5 space-y-3">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <label className="block text-xs font-semibold text-slate-800">
                          Volume Kubikasi Muatan (CBM / m³)
                        </label>
                        <p className="text-[11px] text-slate-500">
                          Dihitung otomatis ke dalam panel CBM Unit Berstatus Sedang Bertugas.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCbmCalcOpen((prev) => !prev)}
                        className="inline-flex items-center gap-1.5 self-start rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky-800 hover:bg-sky-50 sm:self-center"
                      >
                        <Calculator className="h-3.5 w-3.5" />
                        {cbmCalcOpen
                          ? 'Tutup Kalkulator P×L×T'
                          : 'Kalkulator Box P×L×T (cm)'}
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:items-center">
                      <input
                        type="text"
                        value={asgForm.volumeCbm}
                        onChange={(e) =>
                          setAsgForm((p) => ({
                            ...p,
                            volumeCbm: e.target.value,
                          }))
                        }
                        placeholder="Contoh: 12.5 CBM"
                        className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />

                      {(liveUnitCbmPreview.matchedVeh ||
                        liveUnitCbmPreview.projectedTotalCbm > 0) && (
                        <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs">
                          <div className="flex flex-wrap items-center justify-between gap-1 font-mono tabular-nums">
                            <span className="text-slate-600">
                              Total Aktif Unit:
                            </span>
                            <span
                              className={`font-bold ${
                                liveUnitCbmPreview.overCbm > 0
                                  ? 'text-red-600'
                                  : 'text-sky-700'
                              }`}
                            >
                              {formatCbmValue(
                                liveUnitCbmPreview.projectedTotalCbm
                              )}
                              {liveUnitCbmPreview.capacityCbm !== null
                                ? ` / ${formatCbmValue(
                                    liveUnitCbmPreview.capacityCbm
                                  )}`
                                : ''}
                            </span>
                          </div>
                          {liveUnitCbmPreview.capacityCbm !== null ? (
                            <p
                              className={`mt-0.5 font-mono text-[11px] tabular-nums ${
                                liveUnitCbmPreview.overCbm > 0
                                  ? 'font-semibold text-red-600'
                                  : 'text-emerald-700'
                              }`}
                            >
                              {liveUnitCbmPreview.overCbm > 0
                                ? `Melebihi kapasitas box +${formatCbmValue(
                                    liveUnitCbmPreview.overCbm
                                  )} (${liveUnitCbmPreview.utilizationPct}%)`
                                : `Sisa ruang box: ${formatCbmValue(
                                    liveUnitCbmPreview.remainingCbm || 0
                                  )} · Utilitas ${
                                    liveUnitCbmPreview.utilizationPct ?? 0
                                  }%`}
                            </p>
                          ) : (
                            <p className="mt-0.5 text-[11px] text-slate-500">
                              Isi Kapasitas CBM di Master Armada untuk melihat sisa ruang box.
                            </p>
                          )}
                        </div>
                      )}
                    </div>

                    {cbmCalcOpen && (
                      <div className="rounded-lg border border-sky-200 bg-white p-3 space-y-2.5">
                        <p className="text-[11px] font-semibold text-slate-700">
                          Hitung Kubikasi Koli: (Panjang × Lebar × Tinggi cm × Jumlah Koli) ÷ 1.000.000
                        </p>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                          <div>
                            <label className="block text-[11px] text-slate-500">
                              Panjang (cm)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={boxLengthCm}
                              onChange={(e) => setBoxLengthCm(e.target.value)}
                              placeholder="60"
                              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500">
                              Lebar (cm)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={boxWidthCm}
                              onChange={(e) => setBoxWidthCm(e.target.value)}
                              placeholder="40"
                              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500">
                              Tinggi (cm)
                            </label>
                            <input
                              type="number"
                              min="0"
                              step="any"
                              value={boxHeightCm}
                              onChange={(e) => setBoxHeightCm(e.target.value)}
                              placeholder="35"
                              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-slate-500">
                              Jumlah Koli
                            </label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={boxKoliCount}
                              onChange={(e) => setBoxKoliCount(e.target.value)}
                              placeholder="100"
                              className="mt-1 w-full rounded-md border border-slate-300 px-2.5 py-1.5 font-mono text-xs tabular-nums"
                            />
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          <span className="font-mono text-xs font-semibold text-slate-800 tabular-nums">
                            Hasil Kalkulasi:{' '}
                            <strong className="text-sky-700">
                              {computedBoxCbm > 0
                                ? formatCbmValue(computedBoxCbm)
                                : '0 CBM'}
                            </strong>
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              disabled={computedBoxCbm <= 0}
                              onClick={() => {
                                if (computedBoxCbm <= 0) return;
                                const existing =
                                  parseCbmNumeric(asgForm.volumeCbm) || 0;
                                const combined =
                                  Math.round((existing + computedBoxCbm) * 1000) /
                                  1000;
                                setAsgForm((p) => ({
                                  ...p,
                                  volumeCbm: formatCbmValue(combined),
                                }));
                              }}
                              className="rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-40"
                            >
                              + Tambah ke CBM
                            </button>
                            <button
                              type="button"
                              disabled={computedBoxCbm <= 0}
                              onClick={() => {
                                if (computedBoxCbm <= 0) return;
                                setAsgForm((p) => ({
                                  ...p,
                                  volumeCbm: formatCbmValue(computedBoxCbm),
                                }));
                              }}
                              className="rounded-md bg-sky-700 px-3 py-1 text-xs font-semibold text-white hover:bg-sky-800 disabled:opacity-40"
                            >
                              Gunakan Nilai CBM
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {editingAssignment && (
                    <>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          KM Awal (Opsional)
                        </label>
                        <input
                          type="number"
                          value={asgForm.kmAwal}
                          onChange={(e) =>
                            setAsgForm((p) => ({
                              ...p,
                              kmAwal: e.target.value,
                            }))
                          }
                          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-semibold text-slate-700">
                          KM Akhir (Opsional)
                        </label>
                        <input
                          type="number"
                          value={asgForm.kmAkhir}
                          onChange={(e) =>
                            setAsgForm((p) => ({
                              ...p,
                              kmAkhir: e.target.value,
                            }))
                          }
                          className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                        />
                      </div>
                    </>
                  )}

                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Catatan Dispatcher
                    </label>
                    <input
                      type="text"
                      value={asgForm.notes}
                      onChange={(e) =>
                        setAsgForm((p) => ({ ...p, notes: e.target.value }))
                      }
                      placeholder="Instruksi penanganan suhu atau jadwal bongkar"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  {!editingAssignment && (
                    <div className="sm:col-span-2 rounded-lg border border-slate-200 bg-slate-50 p-3.5">
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-xs font-semibold text-slate-800">
                            Tujuan Pesan WhatsApp Sekali Klik Saat Diterbitkan
                          </p>
                          <p className="text-[11px] text-slate-500">
                            Menekan &ldquo;Terbitkan Surat Tugas&rdquo; akan
                            langsung menyimpan &amp; membuka Aplikasi WhatsApp.
                          </p>
                        </div>
                        <div className="inline-flex flex-wrap items-center gap-1 rounded-lg bg-slate-200/80 p-1 self-start sm:self-center">
                          <button
                            type="button"
                            onClick={() => setCreateWaMode('DRIVER')}
                            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                              createWaMode === 'DRIVER'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <Phone className="h-3.5 w-3.5" />
                            WA Driver
                          </button>
                          <button
                            type="button"
                            onClick={() => setCreateWaMode('GROUP')}
                            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                              createWaMode === 'GROUP'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <Users className="h-3.5 w-3.5" />
                            Grup WhatsApp
                          </button>
                          <button
                            type="button"
                            onClick={() => setCreateWaMode('DIRECT')}
                            className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                              createWaMode === 'DIRECT'
                                ? 'bg-white text-slate-900 shadow-sm'
                                : 'text-slate-600 hover:text-slate-900'
                            }`}
                          >
                            <MessageSquare className="h-3.5 w-3.5" />
                            WA Dispatcher
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-2.5 border-t border-slate-200 pt-4 sm:flex sm:items-center sm:justify-end">
                  <button
                    type="button"
                    disabled={creatingSubmitting}
                    onClick={() => setAssignmentModalOpen(false)}
                    className="min-h-[44px] sm:min-h-0 rounded-xl sm:rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={creatingSubmitting}
                    className="inline-flex min-h-[44px] sm:min-h-0 items-center justify-center gap-1.5 rounded-xl sm:rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                  >
                    {!editingAssignment && (
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    )}
                    {editingAssignment
                      ? 'Simpan Perubahan'
                      : creatingSubmitting
                      ? 'Menerbitkan...'
                      : 'Terbitkan Surat Tugas'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: MASTER DRIVER (Tanpa No. Polisi Default - Req #11)         */}
        {/* ================================================================= */}
        {driverModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
            <div className="sheet-enter max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <h3 className="text-base font-bold text-slate-900">
                  {editingDriverId
                    ? 'Edit Master Driver'
                    : 'Tambah Master Driver'}
                </h3>
                <button
                  type="button"
                  onClick={() => setDriverModalOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  triggerConfirm({
                    open: true,
                    title: editingDriverId
                      ? 'Simpan Perubahan Master Driver?'
                      : 'Tambah Master Driver ke Database?',
                    description:
                      'Data Driver akan disimpan dan langsung disinkronkan ke lembar Master_Driver di Google Spreadsheets.',
                    details: [
                      `ID Driver : ${driverForm.id.trim().toUpperCase()}`,
                      `Nama      : ${driverForm.name.trim()}`,
                    ],
                    confirmLabel: 'Simpan Data Driver',
                    variant: 'primary',
                    action: async () => {
                      const ok = await onSaveDriver(
                        editingDriverId ? 'edit' : 'create',
                        editingDriverId || '',
                        driverForm
                      );
                      if (ok) setDriverModalOpen(false);
                    },
                  });
                }}
                className="mt-4 space-y-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      ID Driver *
                    </label>
                    <input
                      type="text"
                      required
                      value={driverForm.id}
                      onChange={(e) =>
                        setDriverForm((p) => ({
                          ...p,
                          id: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="DRV-001"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      PIN Login Driver
                    </label>
                    <input
                      type="text"
                      value={driverForm.pin}
                      onChange={(e) =>
                        setDriverForm((p) => ({ ...p, pin: e.target.value }))
                      }
                      placeholder="Contoh: 1122 (Kosongkan jika tanpa PIN)"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Nama Lengkap Driver *
                    </label>
                    <input
                      type="text"
                      required
                      value={driverForm.name}
                      onChange={(e) =>
                        setDriverForm((p) => ({ ...p, name: e.target.value }))
                      }
                      placeholder="Nama lengkap driver"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Nomor WhatsApp
                    </label>
                    <input
                      type="text"
                      value={driverForm.phone}
                      onChange={(e) =>
                        setDriverForm((p) => ({ ...p, phone: e.target.value }))
                      }
                      placeholder="0812..."
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Jenis SIM
                    </label>
                    <select
                      value={driverForm.licenseType}
                      onChange={(e) =>
                        setDriverForm((p) => ({
                          ...p,
                          licenseType: e.target.value,
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="SIM A">SIM A</option>
                      <option value="SIM B1">SIM B1</option>
                      <option value="SIM B1 Umum">SIM B1 Umum</option>
                      <option value="SIM B2 Umum">SIM B2 Umum</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Status Aktif Login
                    </label>
                    <select
                      value={driverForm.active ? 'true' : 'false'}
                      onChange={(e) =>
                        setDriverForm((p) => ({
                          ...p,
                          active: e.target.value === 'true',
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="true">Aktif</option>
                      <option value="false">Nonaktif</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-3 sm:flex sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setDriverModalOpen(false)}
                    className="min-h-[44px] sm:min-h-0 rounded-xl sm:rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="min-h-[44px] sm:min-h-0 rounded-xl sm:rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Simpan Driver
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: MASTER ARMADA (Tanpa KM Terakhir - Req #12)                */}
        {/* ================================================================= */}
        {vehicleModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
            <div className="sheet-enter max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <h3 className="text-base font-bold text-slate-900">
                  {editingVehicleId
                    ? 'Edit Master Armada'
                    : 'Tambah Master Armada'}
                </h3>
                <button
                  type="button"
                  onClick={() => setVehicleModalOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  triggerConfirm({
                    open: true,
                    title: editingVehicleId
                      ? 'Simpan Perubahan Master Armada?'
                      : 'Tambah Master Armada?',
                    description:
                      'Data unit armada berpendingin akan disimpan dan disinkronkan ke lembar Master_Armada pada Google Spreadsheets.',
                    details: [
                      `Kode Unit : ${vehicleForm.id}`,
                      `No Polisi : ${vehicleForm.plateNumber}`,
                    ],
                    confirmLabel: 'Simpan Armada',
                    variant: 'primary',
                    action: async () => {
                      const ok = await onSaveVehicle(
                        editingVehicleId ? 'edit' : 'create',
                        editingVehicleId || '',
                        vehicleForm
                      );
                      if (ok) setVehicleModalOpen(false);
                    },
                  });
                }}
                className="mt-4 space-y-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Kode Unit *
                    </label>
                    <input
                      type="text"
                      required
                      value={vehicleForm.id}
                      onChange={(e) =>
                        setVehicleForm((p) => ({
                          ...p,
                          id: e.target.value.toUpperCase(),
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Nomor Polisi *
                    </label>
                    <input
                      type="text"
                      required
                      value={vehicleForm.plateNumber}
                      onChange={(e) =>
                        setVehicleForm((p) => ({
                          ...p,
                          plateNumber: e.target.value.toUpperCase(),
                        }))
                      }
                      placeholder="B 9123 CRK"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Tipe Kendaraan Pendingin (Reefer)
                    </label>
                    <input
                      type="text"
                      value={vehicleForm.vehicleType}
                      onChange={(e) =>
                        setVehicleForm((p) => ({
                          ...p,
                          vehicleType: e.target.value,
                        }))
                      }
                      placeholder="Contoh: CDD Box Thermo King -20°C"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Kapasitas Berat Muatan
                    </label>
                    <input
                      type="text"
                      value={vehicleForm.capacity}
                      onChange={(e) =>
                        setVehicleForm((p) => ({
                          ...p,
                          capacity: e.target.value,
                        }))
                      }
                      placeholder="Contoh: 5 Ton Chiller/Freezer"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Kapasitas Volume Box (CBM / m³)
                    </label>
                    <input
                      type="text"
                      value={vehicleForm.capacityCbm || ''}
                      onChange={(e) =>
                        setVehicleForm((p) => ({
                          ...p,
                          capacityCbm: e.target.value,
                        }))
                      }
                      placeholder="Contoh: 16 CBM (Digunakan untuk hitung CBM Unit Sedang Bertugas)"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-semibold text-slate-700">
                      Status Unit
                    </label>
                    <select
                      value={vehicleForm.status}
                      onChange={(e) =>
                        setVehicleForm((p) => ({
                          ...p,
                          status: e.target.value as VehicleMaster['status'],
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      <option value="Siap Jalan">Siap Jalan</option>
                      <option value="Dalam Tugas">Dalam Tugas</option>
                      <option value="Perawatan">Perawatan</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-3 sm:flex sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setVehicleModalOpen(false)}
                    className="min-h-[44px] sm:min-h-0 rounded-xl sm:rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="min-h-[44px] sm:min-h-0 rounded-xl sm:rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Simpan Armada
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: MASTER RUTE                                                */}
        {/* ================================================================= */}
        {routeModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
            <div className="sheet-enter max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
              <div className="flex items-center justify-between border-b border-slate-200 pb-4">
                <h3 className="text-base font-bold text-slate-900">
                  {editingRouteId
                    ? 'Edit Master Rute Tujuan'
                    : 'Tambah Master Rute Tujuan'}
                </h3>
                <button
                  type="button"
                  onClick={() => setRouteModalOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  triggerConfirm({
                    open: true,
                    title: editingRouteId
                      ? 'Simpan Perubahan Master Rute?'
                      : 'Tambah Master Rute Tujuan?',
                    description:
                      'Data rute tujuan akan disimpan dan disinkronkan ke lembar Master_Rute pada Google Spreadsheets.',
                    details: [
                      `Kode Rute     : ${routeForm.id}`,
                      `Lokasi Tujuan : ${routeForm.destination}`,
                    ],
                    confirmLabel: 'Simpan Rute',
                    variant: 'primary',
                    action: async () => {
                      const ok = await onSaveRoute(
                        editingRouteId ? 'edit' : 'create',
                        editingRouteId || '',
                        routeForm
                      );
                      if (ok) setRouteModalOpen(false);
                    },
                  });
                }}
                className="mt-4 space-y-4"
              >
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Kode Rute *
                    </label>
                    <input
                      type="text"
                      required
                      value={routeForm.id}
                      onChange={(e) =>
                        setRouteForm((p) => ({
                          ...p,
                          id: e.target.value.toUpperCase(),
                        }))
                      }
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm uppercase"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Lokasi Tujuan *
                    </label>
                    <input
                      type="text"
                      required
                      value={routeForm.destination}
                      onChange={(e) =>
                        setRouteForm((p) => ({
                          ...p,
                          destination: e.target.value,
                        }))
                      }
                      placeholder="Contoh: DC Cold Hub Surabaya"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      Nama PIC Tujuan
                    </label>
                    <input
                      type="text"
                      value={routeForm.picName}
                      onChange={(e) =>
                        setRouteForm((p) => ({
                          ...p,
                          picName: e.target.value,
                        }))
                      }
                      placeholder="Nama penerima di lokasi"
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-700">
                      No. WhatsApp PIC Tujuan
                    </label>
                    <input
                      type="text"
                      value={routeForm.picPhone}
                      onChange={(e) =>
                        setRouteForm((p) => ({
                          ...p,
                          picPhone: e.target.value,
                        }))
                      }
                      placeholder="0813..."
                      className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm tabular-nums"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-3 sm:flex sm:justify-end">
                  <button
                    type="button"
                    onClick={() => setRouteModalOpen(false)}
                    className="min-h-[44px] sm:min-h-0 rounded-xl sm:rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    className="min-h-[44px] sm:min-h-0 rounded-xl sm:rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white"
                  >
                    Simpan Rute
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: BAGIKAN LINK KHUSUS DRIVER (UMUM & PERSONAL PER DRIVER)    */}
        {/* ================================================================= */}
        {driverLinkModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
            <div className="sheet-enter max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
              <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Bagikan Link Akses Khusus Driver
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-600">
                    Link otomatis mengarahkan Driver ke tampilan khusus Portal
                    Driver pada alamat publik aplikasi (tanpa menampilkan menu
                    Admin Dispatcher).
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setDriverLinkModalOpen(false)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                  aria-label="Tutup modal link driver"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Live URL Verification & Anti-403 / Anti-404 Public Cloud Run Setup */}
              <div
                className={`mt-4 rounded-xl border p-4 ${
                  driverLinkStatus?.accessState === 'PUBLIC_OPEN'
                    ? 'border-emerald-200 bg-emerald-50/60'
                    : driverLinkStatus?.accessState === 'SHARED_GOOGLE_AUTH'
                    ? 'border-sky-200 bg-sky-50/60'
                    : driverLinkStatus?.accessState === 'CUSTOM_URL_ERROR'
                    ? 'border-red-200 bg-red-50/70'
                    : 'border-amber-300 bg-amber-50/80'
                }`}
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-bold text-slate-900">
                      {driverLinkStatus?.accessState === 'PUBLIC_OPEN'
                        ? 'Server Publik Aktif & Terverifikasi (Bebas Error 403 & 404)'
                        : driverLinkStatus?.accessState === 'SHARED_GOOGLE_AUTH'
                        ? 'URL Share Aktif — Pastikan Izin Disetel ke "Public"'
                        : driverLinkStatus?.accessState === 'CUSTOM_URL_ERROR'
                        ? 'URL Server Publik Belum Valid / Terkunci Error 403 atau 404'
                        : 'Akses Publik Belum Diaktifkan (Penyebab "Error 403" di HP Driver)'}
                    </p>
                    <p className="mt-1 text-xs leading-relaxed text-slate-700">
                      {driverLinkStatus?.statusMessage ||
                        'Memeriksa status akses publik server untuk perangkat Driver...'}
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isCheckingDriverLink}
                    onClick={async () => {
                      setIsCheckingDriverLink(true);
                      const fresh = await refreshDriverLinkStatus(
                        publicPortalUrlInput.trim() ||
                          config.publicPortalBaseUrl,
                        true
                      );
                      if (fresh) setDriverLinkStatus(fresh);
                      setIsCheckingDriverLink(false);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${
                        isCheckingDriverLink ? 'animate-spin' : ''
                      }`}
                    />
                    Cek Ulang Status
                  </button>
                </div>

                {!isDriverLinkReady && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3.5 text-xs text-slate-700 space-y-2">
                    <p className="font-semibold text-slate-900">
                      Cara Mengaktifkan Link agar HP Driver Tidak Terkena Error 403 / 404 (Pilih Salah Satu):
                    </p>
                    <div className="space-y-1.5 text-slate-700">
                      <p>
                        <strong className="text-slate-900">
                          Opsi 1 — Deploy ke Cloud Run (Paling Direkomendasikan, Tanpa Login Google di HP Driver):
                        </strong>{' '}
                        Klik tombol <strong>Deploy</strong> (ikon Roket /{' '}
                        <em>Deploy to Cloud Run</em>) di pojok kanan atas layar
                        Google AI Studio, pastikan opsi{' '}
                        <strong>Allow unauthenticated invocations</strong>{' '}
                        aktif, lalu salin alamat <code className="font-mono text-[11px]">https://...run.app</code>{' '}
                        yang muncul dan tempel pada kolom di bawah ini. Seluruh
                        Surat Tugas &amp; laporan Driver otomatis tersinkronisasi
                        dua arah!
                      </p>
                      <p>
                        <strong className="text-slate-900">
                          Opsi 2 — Tombol Share AI Studio:
                        </strong>{' '}
                        Klik tombol <strong>Share</strong> di pojok kanan atas
                        layar Google AI Studio, ubah izin dari{' '}
                        <em>Restricted</em> menjadi{' '}
                        <strong>Public / Anyone with the link</strong> (jika
                        masih <em>Restricted</em>, HP Driver tetap terkena Error
                        403), lalu klik tombol <strong>Cek Ulang Status</strong>{' '}
                        di atas.
                      </p>
                    </div>
                  </div>
                )}

                <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="url"
                    value={publicPortalUrlInput}
                    onChange={(e) => setPublicPortalUrlInput(e.target.value)}
                    placeholder="Tempel URL Publik Cloud Run hasil Deploy (https://...run.app)"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 font-mono text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={savingPortalUrl}
                      onClick={async () => {
                        setSavingPortalUrl(true);
                        try {
                          const candidate = publicPortalUrlInput.trim();
                          const probeFirst = await refreshDriverLinkStatus(
                            candidate,
                            true
                          );
                          if (probeFirst) {
                            setDriverLinkStatus(probeFirst);
                          }
                          if (!candidate || probeFirst?.isShareReady) {
                            await onSaveOperationalSettings({
                              dispatcherWaPhone: config.dispatcherWaPhone || '',
                              whatsappTargetMode:
                                config.whatsappTargetMode || 'GROUP',
                              whatsappGroupName:
                                config.whatsappGroupName ||
                                'Grup Operasional CRK Logistik',
                              whatsappGroupInviteUrl:
                                config.whatsappGroupInviteUrl || '',
                              letterPrefix: config.letterPrefix || 'ST-CRK',
                              publicPortalBaseUrl: candidate,
                            });
                          }
                        } finally {
                          setSavingPortalUrl(false);
                        }
                      }}
                      className="rounded-lg bg-slate-900 px-3.5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50 whitespace-nowrap"
                    >
                      {savingPortalUrl
                        ? 'Memverifikasi...'
                        : 'Simpan & Hubungkan'}
                    </button>
                    {(publicPortalUrlInput || config.publicPortalBaseUrl) && (
                      <button
                        type="button"
                        onClick={async () => {
                          setPublicPortalUrlInput('');
                          setSavingPortalUrl(true);
                          try {
                            await onSaveOperationalSettings({
                              dispatcherWaPhone: config.dispatcherWaPhone || '',
                              whatsappTargetMode:
                                config.whatsappTargetMode || 'GROUP',
                              whatsappGroupName:
                                config.whatsappGroupName ||
                                'Grup Operasional CRK Logistik',
                              whatsappGroupInviteUrl:
                                config.whatsappGroupInviteUrl || '',
                              letterPrefix: config.letterPrefix || 'ST-CRK',
                              publicPortalBaseUrl: '',
                            });
                            const fresh = await refreshDriverLinkStatus(
                              '',
                              true
                            );
                            if (fresh) setDriverLinkStatus(fresh);
                          } finally {
                            setSavingPortalUrl(false);
                          }
                        }}
                        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {/* Section 1: General Driver Portal Link */}
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50/80 p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      01. Link Umum Portal Driver (Untuk Grup WhatsApp)
                    </h4>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Cocok dibagikan ke Grup Operasional — semua Driver tinggal
                      memilih ID masing-masing.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!isDriverLinkReady}
                      onClick={() =>
                        onCopyText(
                          buildDriverPortalLink({
                            customBaseUrl:
                              driverLinkStatus?.effectiveBaseUrl ||
                              config.publicPortalBaseUrl,
                          }),
                          'Link Umum Portal Driver'
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      Salin Link Umum
                    </button>
                    <button
                      type="button"
                      disabled={!isDriverLinkReady}
                      onClick={() =>
                        launchWhatsAppUrl(
                          buildWhatsAppGroupUrl(
                            buildGeneralDriverPortalWaMessage(
                              config.whatsappGroupName,
                              driverLinkStatus?.effectiveBaseUrl ||
                                config.publicPortalBaseUrl
                            )
                          )
                        )
                      }
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                    >
                      <Users className="h-3.5 w-3.5" />
                      Kirim ke Grup WA
                    </button>
                  </div>
                </div>
                <div className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-2 font-mono text-xs text-slate-700 break-all">
                  {isDriverLinkReady
                    ? buildDriverPortalLink({
                        customBaseUrl:
                          driverLinkStatus?.effectiveBaseUrl ||
                          config.publicPortalBaseUrl,
                      })
                    : 'Menunggu aktivasi Deploy Cloud Run atau Share (Public) agar link bebas Error 403 & 404...'}
                </div>
              </div>

              {/* Section 2: Personal Link per Driver */}
              <div className="mt-5">
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h4 className="text-xs font-bold text-slate-900">
                      02. Link Personal per Driver (Otomatis Pilih ID Driver)
                    </h4>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Saat dibuka, ID Driver langsung terpilih otomatis dan sesi
                      login Driver tersimpan di HP mereka.
                    </p>
                  </div>
                  <div className="relative sm:w-56">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={driverLinkSearch}
                      onChange={(e) => setDriverLinkSearch(e.target.value)}
                      placeholder="Cari ID / Nama Driver..."
                      className="w-full rounded-lg border border-slate-300 bg-white py-1.5 pl-8 pr-3 text-xs text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>
                </div>

                {drivers.filter((d) => d.active !== false).length === 0 ? (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-600">
                    Belum ada Master Driver aktif. Tambahkan Master Driver
                    terlebih dahulu untuk membagikan link personal per Driver.
                  </div>
                ) : (
                  <div className="mt-3 max-h-72 divide-y divide-slate-200 overflow-y-auto rounded-xl border border-slate-200 bg-white">
                    {drivers
                      .filter((d) => {
                        if (d.active === false) return false;
                        const q = driverLinkSearch.trim().toLowerCase();
                        if (!q) return true;
                        return (
                          d.id.toLowerCase().includes(q) ||
                          d.name.toLowerCase().includes(q) ||
                          (d.phone || '').toLowerCase().includes(q)
                        );
                      })
                      .sort((a, b) =>
                        a.id.localeCompare(b.id, 'id', { numeric: true })
                      )
                      .map((drv) => {
                        const activeTasksForDrv = assignments.filter(
                          (a) =>
                            a.driverId.trim().toLowerCase() ===
                              drv.id.trim().toLowerCase() &&
                            isActiveTaskStatus(a.status)
                        );
                        const latestActiveTask = activeTasksForDrv[0];
                        const effectiveCustomUrl =
                          driverLinkStatus?.effectiveBaseUrl ||
                          config.publicPortalBaseUrl;
                        const personalLink = buildDriverPortalLink({
                          driverId: drv.id,
                          taskId: latestActiveTask?.id,
                          taskNo: latestActiveTask?.noPenugasan,
                          customBaseUrl: effectiveCustomUrl,
                          driverSnapshot: drv,
                          taskSnapshot: latestActiveTask,
                        });

                        return (
                          <div
                            key={drv.id}
                            className="flex flex-col gap-2.5 p-3.5 sm:flex-row sm:items-center sm:justify-between hover:bg-slate-50/80"
                          >
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 text-xs">
                                <span className="font-mono font-bold text-slate-900 tabular-nums">
                                  {drv.id}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="font-semibold text-slate-900">
                                  {drv.name}
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-500">
                                  {drv.pin ? 'PIN Aktif' : 'Tanpa PIN'}
                                </span>
                                {activeTasksForDrv.length > 0 && (
                                  <>
                                    <span aria-hidden="true">·</span>
                                    <span className="font-medium text-sky-800 tabular-nums">
                                      {activeTasksForDrv.length} Tugas Aktif
                                    </span>
                                  </>
                                )}
                              </div>
                              <p className="mt-0.5 truncate font-mono text-[11px] text-slate-500">
                                {isDriverLinkReady
                                  ? personalLink
                                  : `Menunggu aktivasi URL Publik (?role=driver&driver=${drv.id})`}
                              </p>
                            </div>

                            <div className="flex items-center gap-2 shrink-0">
                              <button
                                type="button"
                                disabled={!isDriverLinkReady}
                                onClick={() =>
                                  onCopyText(
                                    personalLink,
                                    `Link Khusus ${drv.id} (${drv.name})`
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                              >
                                <Copy className="h-3.5 w-3.5" />
                                Salin Link
                              </button>
                              <button
                                type="button"
                                disabled={!isDriverLinkReady}
                                onClick={() => {
                                  const msg = buildPersonalDriverLinkWaMessage(
                                    drv,
                                    activeTasksForDrv.length,
                                    latestActiveTask,
                                    effectiveCustomUrl
                                  );
                                  const url = drv.phone
                                    ? buildWhatsAppDirectUrl(
                                        drv.phone,
                                        msg,
                                        false
                                      )
                                    : buildWhatsAppGroupUrl(msg);
                                  launchWhatsAppUrl(url);
                                }}
                                className="inline-flex items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap"
                              >
                                <Send className="h-3 w-3" />
                                Kirim WA
                              </button>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
              </div>

              <div className="mt-5 flex justify-end border-t border-slate-200 pt-4">
                <button
                  type="button"
                  onClick={() => setDriverLinkModalOpen(false)}
                  className="min-h-[44px] sm:min-h-0 w-full sm:w-auto rounded-xl sm:rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Selesai
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: TAMBAH / EDIT MASTER KARTU FLEET CARD                      */}
        {/* ================================================================= */}
        {fleetCardModalOpen && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
            <div className="sheet-enter w-full max-w-md rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
              <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {fleetCardModalMode === 'create'
                      ? 'Tambah Master Kartu Fleet Card'
                      : `Edit Kartu Fleet Card (${editingFleetCardOriginalId})`}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    Tersinkronisasi otomatis ke Cloud &amp; Sheet Master_Fleet_Card.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setFleetCardModalOpen(false)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const cleanId = fleetCardForm.id.trim().toUpperCase();
                  const cleanNumber = fleetCardForm.cardNumber.trim();
                  const numericBalance = parseRupiahInput(fleetCardForm.balance);
                  if (!cleanId || !cleanNumber) return;

                  setFleetCardSaving(true);
                  try {
                    const ok = await onSaveFleetCard(
                      fleetCardModalMode,
                      editingFleetCardOriginalId || cleanId,
                      {
                        id: cleanId,
                        cardNumber: cleanNumber,
                        balance: numericBalance,
                      }
                    );
                    if (ok) {
                      setFleetCardModalOpen(false);
                    }
                  } finally {
                    setFleetCardSaving(false);
                  }
                }}
                className="mt-4 space-y-4"
              >
                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    ID Fleet Card <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={64}
                    value={fleetCardForm.id}
                    onChange={(e) =>
                      setFleetCardForm((prev) => ({
                        ...prev,
                        id: e.target.value,
                      }))
                    }
                    placeholder="Contoh: FC-001"
                    className="mt-1 min-h-[42px] w-full rounded-xl sm:rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Nomor Kartu Fleet Card{' '}
                    <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={fleetCardForm.cardNumber}
                    onChange={(e) =>
                      setFleetCardForm((prev) => ({
                        ...prev,
                        cardNumber: e.target.value,
                      }))
                    }
                    placeholder="Contoh: 6032-9841-2210-001"
                    className="mt-1 min-h-[42px] w-full rounded-xl sm:rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Saldo Fleet Card (Rp){' '}
                    <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={fleetCardForm.balance}
                    onChange={(e) =>
                      setFleetCardForm((prev) => ({
                        ...prev,
                        balance: e.target.value.replace(/[^\d-]/g, ''),
                      }))
                    }
                    placeholder="Contoh: 5000000"
                    className="mt-1 min-h-[42px] w-full rounded-xl sm:rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                  <p className="mt-1 font-mono text-xs text-emerald-700 tabular-nums">
                    Format Rupiah:{' '}
                    <strong>
                      {formatIdrCurrency(parseRupiahInput(fleetCardForm.balance))}
                    </strong>
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setFleetCardModalOpen(false)}
                    className="min-h-[42px] rounded-xl sm:rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={fleetCardSaving}
                    className="min-h-[42px] rounded-xl sm:rounded-lg bg-slate-900 px-5 py-2 text-xs font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                  >
                    {fleetCardSaving
                      ? 'Menyimpan...'
                      : fleetCardModalMode === 'create'
                      ? 'Simpan Kartu'
                      : 'Simpan Perubahan'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: TAMBAH SALDO (TOP-UP) MASTER KARTU FLEET CARD              */}
        {/* ================================================================= */}
        {topUpModalCard && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
            <div className="sheet-enter w-full max-w-md rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
              <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Tambah Saldo Fleet Card
                  </h3>
                  <p className="mt-0.5 font-mono text-xs text-slate-600 tabular-nums">
                    {topUpModalCard.id} · {topUpModalCard.cardNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setTopUpModalCard(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  const addNominal = parseRupiahInput(topUpAmount);
                  if (addNominal <= 0) return;

                  setTopUpSaving(true);
                  try {
                    const ok = await onTopUpFleetCard(
                      topUpModalCard.id,
                      addNominal
                    );
                    if (ok) {
                      setTopUpModalCard(null);
                      setTopUpAmount('');
                    }
                  } finally {
                    setTopUpSaving(false);
                  }
                }}
                className="mt-4 space-y-4"
              >
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Saldo Saat Ini</span>
                    <span className="font-mono font-bold text-slate-900 tabular-nums">
                      {formatIdrCurrency(topUpModalCard.balance)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-600">Nominal Tambah Saldo</span>
                    <span className="font-mono font-bold text-sky-700 tabular-nums">
                      +{formatIdrCurrency(Math.max(0, parseRupiahInput(topUpAmount)))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
                    <span className="font-semibold text-slate-900">
                      Estimasi Saldo Akhir
                    </span>
                    <span className="font-mono text-sm font-bold text-emerald-700 tabular-nums">
                      {formatIdrCurrency(
                        (topUpModalCard.balance || 0) +
                          Math.max(0, parseRupiahInput(topUpAmount))
                      )}
                    </span>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Pilih Cepat Nominal Top-Up
                  </label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[500_000, 1_000_000, 2_500_000, 5_000_000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setTopUpAmount(String(preset))}
                        className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-800 hover:bg-slate-50 tabular-nums"
                      >
                        +{(preset / 1_000_000 >= 1
                          ? `${preset / 1_000_000} Jt`
                          : `${preset / 1_000} Rb`
                        ).replace('.', ',')}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Nominal Tambah Saldo (Rp){' '}
                    <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={topUpAmount}
                    onChange={(e) =>
                      setTopUpAmount(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="Masukkan nominal top-up, contoh: 1500000"
                    className="mt-1 min-h-[42px] w-full rounded-xl sm:rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setTopUpModalCard(null)}
                    className="min-h-[42px] rounded-xl sm:rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={
                      topUpSaving || parseRupiahInput(topUpAmount) <= 0
                    }
                    className="min-h-[42px] rounded-xl sm:rounded-lg bg-emerald-700 px-5 py-2 text-xs font-semibold text-white hover:bg-emerald-800 disabled:opacity-50"
                  >
                    {topUpSaving ? 'Menambahkan...' : 'Konfirmasi Tambah Saldo'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: UPDATE SALDO LANGSUNG MASTER KARTU FLEET CARD              */}
        {/* ================================================================= */}
        {updateBalanceModalCard && (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
            <div className="sheet-enter w-full max-w-md rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
              <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
              <div className="flex items-center justify-between border-b border-slate-200 pb-3.5">
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Update Saldo Fleet Card
                  </h3>
                  <p className="mt-0.5 font-mono text-xs text-slate-600 tabular-nums">
                    {updateBalanceModalCard.id} · {updateBalanceModalCard.cardNumber}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setUpdateBalanceModalCard(null)}
                  className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (updateBalanceInput.trim() === '') return;
                  const newNominal = Math.max(
                    0,
                    parseRupiahInput(updateBalanceInput)
                  );

                  setUpdateBalanceSaving(true);
                  try {
                    const ok = await onUpdateFleetCardBalance(
                      updateBalanceModalCard.id,
                      newNominal
                    );
                    if (ok) {
                      setUpdateBalanceModalCard(null);
                      setUpdateBalanceInput('');
                    }
                  } finally {
                    setUpdateBalanceSaving(false);
                  }
                }}
                className="mt-4 space-y-4"
              >
                {(() => {
                  const currentBal = Math.round(
                    updateBalanceModalCard.balance || 0
                  );
                  const targetBal =
                    updateBalanceInput.trim() === ''
                      ? currentBal
                      : Math.max(0, parseRupiahInput(updateBalanceInput));
                  const diffBal = targetBal - currentBal;
                  return (
                    <div className="rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-xs space-y-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Saldo Saat Ini</span>
                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                          {formatIdrCurrency(currentBal)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-slate-600">Selisih Penyesuaian</span>
                        <span
                          className={`font-mono font-bold tabular-nums ${
                            diffBal > 0
                              ? 'text-emerald-700'
                              : diffBal < 0
                              ? 'text-rose-700'
                              : 'text-slate-600'
                          }`}
                        >
                          {diffBal > 0
                            ? `+${formatIdrCurrency(diffBal)}`
                            : formatIdrCurrency(diffBal)}
                        </span>
                      </div>
                      <div className="flex items-center justify-between border-t border-slate-200 pt-1.5">
                        <span className="font-semibold text-slate-900">
                          Saldo Baru Ditetapkan
                        </span>
                        <span className="font-mono text-sm font-bold text-sky-800 tabular-nums">
                          {formatIdrCurrency(targetBal)}
                        </span>
                      </div>
                    </div>
                  );
                })()}

                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Pilih Cepat Saldo Baru
                  </label>
                  <div className="mt-1.5 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {[0, 1_000_000, 2_500_000, 5_000_000].map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => setUpdateBalanceInput(String(preset))}
                        className="min-h-[38px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 font-mono text-xs font-semibold text-slate-800 hover:bg-slate-50 tabular-nums"
                      >
                        {preset === 0
                          ? 'Rp 0'
                          : `Rp ${(preset / 1_000_000)
                              .toString()
                              .replace('.', ',')} Jt`}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-800">
                    Saldo Baru Fleet Card (Rp){' '}
                    <span className="text-rose-600">*</span>
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    required
                    value={updateBalanceInput}
                    onChange={(e) =>
                      setUpdateBalanceInput(e.target.value.replace(/\D/g, ''))
                    }
                    placeholder="Masukkan saldo terbaru kartu, contoh: 3250000"
                    className="mt-1 min-h-[42px] w-full rounded-xl sm:rounded-lg border border-slate-300 px-3.5 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Memperbarui saldo aktual kartu langsung ke Cloud Database &amp; Sheet Master_Fleet_Card.
                  </p>
                </div>

                <div className="flex items-center justify-end gap-2 border-t border-slate-200 pt-4">
                  <button
                    type="button"
                    onClick={() => setUpdateBalanceModalCard(null)}
                    className="min-h-[42px] rounded-xl sm:rounded-lg border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    Batal
                  </button>
                  <button
                    type="submit"
                    disabled={
                      updateBalanceSaving || updateBalanceInput.trim() === ''
                    }
                    className="min-h-[42px] rounded-xl sm:rounded-lg bg-sky-800 px-5 py-2 text-xs font-semibold text-white hover:bg-sky-900 disabled:opacity-50"
                  >
                    {updateBalanceSaving
                      ? 'Menyimpan...'
                      : 'Simpan Update Saldo'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ================================================================= */}
        {/* MODAL: PREVIEW FOTO STRUK BBM / STRUK TOL                         */}
        {/* ================================================================= */}
        {receiptPreviewModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/65 p-4 backdrop-blur-[2px]">
            <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
              <div className="flex items-start justify-between gap-3 border-b border-slate-200 pb-3">
                <div className="min-w-0">
                  <h3 className="text-sm sm:text-base font-bold text-slate-900">
                    {receiptPreviewModal.title}
                  </h3>
                  <p className="mt-0.5 font-mono text-xs text-slate-500 tabular-nums">
                    {receiptPreviewModal.subtitle}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setReceiptPreviewModal(null)}
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              <div className="mt-4 overflow-hidden rounded-xl border border-slate-200 bg-slate-100">
                {!receiptImgFailed ? (
                  <img
                    src={receiptPreviewModal.imageSrc}
                    alt={receiptPreviewModal.title}
                    referrerPolicy="no-referrer"
                    onError={() => setReceiptImgFailed(true)}
                    className="mx-auto max-h-[64vh] w-auto object-contain"
                  />
                ) : (
                  <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                    <Receipt className="h-10 w-10 text-slate-400" />
                    <p className="mt-2 text-sm font-semibold text-slate-800">
                      Pratinjau Gambar Sedang Dimuat dari Google Drive
                    </p>
                    <p className="mt-1 max-w-sm text-xs text-slate-500">
                      Jika foto telah diarsipkan ke Google Drive, Anda dapat membukanya langsung melalui tautan Drive di bawah.
                    </p>
                  </div>
                )}
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                {receiptPreviewModal.driveUrl ? (
                  <a
                    href={receiptPreviewModal.driveUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg border border-sky-300 bg-sky-50 px-3.5 py-2 text-xs font-semibold text-sky-900 hover:bg-sky-100"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Buka File di Google Drive
                  </a>
                ) : (
                  <span className="text-xs text-slate-500">
                    Tersimpan di server aplikasi &amp; siap disinkron ke Google Drive
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => setReceiptPreviewModal(null)}
                  className="min-h-[40px] rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800"
                >
                  Tutup
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Fixed Thumb-Zone Mobile Bottom Navigation Bar (< lg) */}
        <nav
          aria-label="Navigasi bawah Portal Admin"
          className="fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 bg-white/95 backdrop-blur-md pb-safe lg:hidden"
        >
          <div className="grid h-[60px] grid-cols-5 items-center px-1.5">
            <button
              type="button"
              onClick={() => setActiveMenu('surat_tugas')}
              className={`flex h-full flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                activeMenu === 'surat_tugas'
                  ? 'text-slate-950 font-bold'
                  : 'text-slate-500 font-medium hover:text-slate-800'
              }`}
            >
              <ClipboardList className="h-4 w-4" />
              <span className="text-[10px] leading-tight">Tugas</span>
            </button>

            <button
              type="button"
              onClick={() => setActiveMenu('driver_performance')}
              className={`flex h-full flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                activeMenu === 'driver_performance'
                  ? 'text-slate-950 font-bold'
                  : 'text-slate-500 font-medium hover:text-slate-800'
              }`}
            >
              <Award className="h-4 w-4" />
              <span className="text-[10px] leading-tight">Performa</span>
            </button>

            <div className="flex items-center justify-center px-1">
              <button
                type="button"
                onClick={openCreateAssignmentModal}
                className="flex h-11 w-full max-w-[78px] flex-col items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm transition-transform active:scale-[0.96]"
                aria-label="Buat Surat Tugas Baru"
              >
                <Plus className="h-4 w-4" />
                <span className="text-[10px] font-bold leading-tight">
                  Buat
                </span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setActiveMenu('master_data')}
              className={`flex h-full flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                activeMenu === 'master_data'
                  ? 'text-slate-950 font-bold'
                  : 'text-slate-500 font-medium hover:text-slate-800'
              }`}
            >
              <Database className="h-4 w-4" />
              <span className="text-[10px] leading-tight">Master</span>
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen(true)}
              className={`flex h-full flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                activeMenu === 'master_fleet_card' ||
                activeMenu === 'pengeluaran_driver' ||
                activeMenu === 'notifikasi_wa' ||
                activeMenu === 'spreadsheets' ||
                activeMenu === 'ubah_pin'
                  ? 'text-slate-950 font-bold'
                  : 'text-slate-500 font-medium hover:text-slate-800'
              }`}
            >
              <Menu className="h-4 w-4" />
              <span className="text-[10px] leading-tight">Menu</span>
            </button>
          </div>
        </nav>

        {/* Confirmation Dialog */}
        {confirmDialog && (
          <ConfirmModal
            open={confirmDialog.open}
            title={confirmDialog.title}
            description={confirmDialog.description}
            details={confirmDialog.details}
            confirmLabel={confirmDialog.confirmLabel}
            variant={confirmDialog.variant}
            loading={confirmLoading}
            onConfirm={executeConfirmedAction}
            onCancel={() => {
              if (!confirmLoading) setConfirmDialog(null);
            }}
          />
        )}
        {/* Fleet Status History Timeline Modal */}
        <FleetStatusHistoryModal
          assignment={timelineModalAssignment}
          notifications={notifications}
          groupName={config.whatsappGroupName}
          onCopyText={onCopyText}
          onClose={() => setTimelineModalAssignment(null)}
        />
      </div>

      {/* Browser Print-Friendly PDF Report Modal (Outside .no-print) */}
      <PrintableAssignmentModal
        assignment={printableAssignment}
        onClose={() => setPrintableAssignment(null)}
      />
    </>
  );
};
