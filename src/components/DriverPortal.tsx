import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  BellRing,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Clock,
  CloudOff,
  Copy,
  CreditCard,
  ExternalLink,
  Gauge,
  History,
  Image as ImageIcon,
  Link2,
  LogOut,
  MapPin,
  MessageSquareShare,
  Navigation,
  PackageCheck,
  Phone,
  Receipt,
  RefreshCw,
  Send,
  ShieldCheck,
  SlidersHorizontal,
  Snowflake,
  Thermometer,
  Truck,
  Users,
  Wifi,
  WifiOff,
  X,
} from 'lucide-react';
import {
  AppConfig,
  Assignment,
  DriverExpense,
  DriverMaster,
  FleetCardMaster,
  RouteMaster,
  TaskStatus,
  VehicleCoolingType,
  VehicleMaster,
  WhatsAppNotificationLog,
  WhatsAppTargetMode,
  isActiveTaskStatus,
  isCompletedTaskStatus,
} from '../types';
import {
  formatRealTimeTimestamp,
  parseSuratJalanList,
} from '../utils/media';
import {
  EmbeddedTaskSnapshot,
  buildDriverPortalLink,
} from '../utils/driverLink';
import {
  cacheSuratTugasSnapshotLocally,
  clearDriverFormDraft,
  readDriverAssignmentsCacheAsync,
  readDriverAssignmentsCacheSync,
  readDriverFormDraft,
  saveDriverAssignmentsCache,
  saveDriverFormDraft,
} from '../services/persistentVault';
import { persistSavedDriverUid } from '../services/googleAuth';
import {
  DriverDeliveredSubmitPayload,
  DriverDepartureSubmitPayload,
  DriverHandoverSubmitPayload,
  DriverReportStage,
  humanizePendingSyncError,
  hydratePendingReportSyncItem,
  PENDING_REPORT_SYNC_ITEM_PREFIX,
  PendingItemRetryStatus,
  PendingReportSyncItem,
  readLocalStoragePendingReportSyncEntries,
  readPendingItemRetryStatuses,
  readPendingReportSyncQueue,
  setPendingItemRetryStatus,
  submitReportToFirestoreWithOfflineRecovery as submitSharedReportWithOfflineRecovery,
  subscribePendingItemRetryStatuses,
  subscribePendingReportSyncQueue,
} from '../services/firestoreSync';
import {
  buildDriverRealtimeWaMessage,
  buildWhatsAppDirectUrl,
  buildWhatsAppGroupUrl,
  inferWhatsAppEventType,
  launchWhatsAppUrl,
  resolveWhatsAppUrlForMode,
  stripDriverLinkFromWaMessage,
} from '../utils/whatsapp';
import {
  NotificationBell,
  PortalBellNotificationItem,
} from './NotificationBell';
import { PhotoUploadField } from './PhotoUploadField';
import { PWAInstallButton } from './PWAInstallButton';
import { SignatureCanvas } from './SignatureCanvas';
import { formatIdrCurrency } from './AnalyticsAndPerformance';

export interface DriverSubmitSyncMeta {
  firestoreAlreadySynced?: boolean;
  firestoreQueuedInPortal?: boolean;
  resolvedAssignment?: Assignment;
}

export interface DriverExpenseSubmitPayload {
  tanggalPengiriman: string;
  tujuanPengiriman: string;
  plateNumber?: string;
  completedAssignmentNos?: string;
  fleetCardId: string;
  fleetCardNumber: string;
  totalPengirimanBbm: number;
  fotoStrukBbm?: string;
  totalPengeluaranTol: number;
  fotoStrukTol?: string;
  catatan?: string;
}

function parseRupiahDigits(raw: string): number {
  const digits = String(raw || '').replace(/[^\d]/g, '');
  if (!digits) return 0;
  const parsed = Number(digits);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

const OFFLINE_RECOVERY_FRIENDLY_MESSAGE =
  'Koneksi terganggu. Laporan Anda aman disimpan di memori HP dan akan otomatis terkirim saat sinyal kembali.';

interface DriverPortalProps {
  driver: DriverMaster;
  vehicles?: VehicleMaster[];
  assignments: Assignment[];
  notifications: WhatsAppNotificationLog[];
  routes: RouteMaster[];
  fleetCards: FleetCardMaster[];
  driverExpenses: DriverExpense[];
  config: AppConfig;
  isSyncing: boolean;
  initialTaskKey?: string;
  embeddedTask?: EmbeddedTaskSnapshot;
  onRefreshSync: () => Promise<void>;
  onRetryPendingSync?: () => Promise<void>;
  onRetrySinglePendingSync?: (queueId: string) => Promise<boolean>;
  onNotify?: (
    type: 'success' | 'error' | 'info',
    title: string,
    description?: string
  ) => void;
  onSubmitDeparture: (
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
    autoOpenWa: boolean,
    explicitSnapshot?: Assignment,
    syncMeta?: DriverSubmitSyncMeta
  ) => Promise<WhatsAppNotificationLog | null>;
  onSubmitDelivered: (
    assignmentId: string,
    payload: DriverDeliveredSubmitPayload | string,
    waTargetMode: WhatsAppTargetMode,
    autoOpenWa: boolean,
    explicitSnapshot?: Assignment,
    syncMeta?: DriverSubmitSyncMeta
  ) => Promise<WhatsAppNotificationLog | null>;
  onSubmitHandover: (
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
    autoOpenWa: boolean,
    explicitSnapshot?: Assignment,
    syncMeta?: DriverSubmitSyncMeta
  ) => Promise<WhatsAppNotificationLog | null>;
  onSubmitDriverExpense: (
    payload: DriverExpenseSubmitPayload
  ) => Promise<boolean>;
  onCopyText: (text: string, label: string) => void;
  onLogout: () => void;
}

export const DriverPortal: React.FC<DriverPortalProps> = ({
  driver,
  vehicles = [],
  assignments,
  notifications,
  routes,
  fleetCards,
  driverExpenses,
  config,
  isSyncing,
  initialTaskKey = '',
  embeddedTask,
  onRefreshSync,
  onRetryPendingSync,
  onRetrySinglePendingSync,
  onNotify,
  onSubmitDeparture,
  onSubmitDelivered,
  onSubmitHandover,
  onSubmitDriverExpense,
  onCopyText,
  onLogout,
}) => {
  // Always persist fallback Driver UID (`saved_driver_uid`) in localStorage while Driver Portal is active
  useEffect(() => {
    if (driver.id) {
      persistSavedDriverUid(driver.id);
    }
  }, [driver.id]);

  const [offlineRecoveryNotice, setOfflineRecoveryNotice] = useState<string>('');
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const [pendingSyncItems, setPendingSyncItems] = useState<
    PendingReportSyncItem[]
  >(() =>
    readPendingReportSyncQueue().filter(
      (item) =>
        item.driverId.trim().toLowerCase() === driver.id.trim().toLowerCase()
    )
  );
  const [retryingPendingSync, setRetryingPendingSync] = useState(false);
  const [localRetryingQueueIds, setLocalRetryingQueueIds] = useState<
    Record<string, boolean>
  >({});
  const [itemRetryStatuses, setItemRetryStatuses] = useState<
    Record<string, PendingItemRetryStatus>
  >(() => readPendingItemRetryStatuses());

  useEffect(() => {
    setItemRetryStatuses(readPendingItemRetryStatuses());
    return subscribePendingItemRetryStatuses((statuses) => {
      setItemRetryStatuses(statuses);
    });
  }, []);

  useEffect(() => {
    const syncLocalList = (allItems: PendingReportSyncItem[]) => {
      const filtered = allItems
        .filter(
          (item) =>
            item.driverId.trim().toLowerCase() ===
            driver.id.trim().toLowerCase()
        )
        .sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt).getTime() -
            new Date(a.updatedAt || a.createdAt).getTime()
        );
      setPendingSyncItems(filtered);
      if (filtered.length === 0) {
        setOfflineRecoveryNotice('');
      }
    };
    syncLocalList(readPendingReportSyncQueue());
    return subscribePendingReportSyncQueue(syncLocalList);
  }, [driver.id]);

  const [activeTab, setActiveTab] = useState<
    'aktif' | 'pengeluaran' | 'riwayat' | 'notifikasi_wa'
  >(() => {
    if (initialTaskKey) return 'aktif';
    if (typeof window !== 'undefined') {
      const savedTab = window.localStorage.getItem('crk_driver_active_tab');
      if (
        savedTab === 'aktif' ||
        savedTab === 'pengeluaran' ||
        savedTab === 'riwayat' ||
        savedTab === 'notifikasi_wa'
      ) {
        return savedTab;
      }
    }
    return 'aktif';
  });

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem('crk_driver_active_tab', activeTab);
      } catch {
        // Ignore storage restrictions
      }
    }
  }, [activeTab]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const initialTaskOpenedRef = useRef<boolean>(false);
  const waBannerRef = useRef<HTMLDivElement | null>(null);

  // Real-time ticking clock for Departure, Delivered, Handover & WhatsApp Timestamp display
  const [liveNow, setLiveNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setLiveNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Automatic real-time WhatsApp launch preference for Role Driver
  const [autoOpenWa, setAutoOpenWa] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    return window.localStorage.getItem('crk_driver_auto_wa') !== 'false';
  });

  const [showMobileWaPrefs, setShowMobileWaPrefs] = useState<boolean>(false);

  const handleToggleAutoOpenWa = (next: boolean) => {
    setAutoOpenWa(next);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('crk_driver_auto_wa', String(next));
    }
  };

  // WhatsApp target mode (supports WA Driver, Grup WA, or WA Dispatcher)
  const [waTargetMode, setWaTargetMode] = useState<WhatsAppTargetMode>(() => {
    if (driver.phone) return 'DRIVER';
    return config.whatsappTargetMode || 'GROUP';
  });

  useEffect(() => {
    if (config.whatsappTargetMode === 'DRIVER' && driver.phone) {
      setWaTargetMode('DRIVER');
    } else if (!driver.phone && waTargetMode === 'DRIVER') {
      setWaTargetMode(config.whatsappTargetMode || 'GROUP');
    }
  }, [config.whatsappTargetMode, driver.phone, waTargetMode]);

  // Stage 1: Departure Form States
  const [titikKeberangkatan, setTitikKeberangkatan] = useState<string>('');
  const [jenisKendaraan, setJenisKendaraan] =
    useState<VehicleCoolingType>('Mobil Pendingin');
  const [kmAwal, setKmAwal] = useState<string>('');
  const [suhuAwal, setSuhuAwal] = useState<string>('');
  const [bbmAwal, setBbmAwal] = useState<string>('Penuh (Full)');
  const [kondisiKendaraan, setKondisiKendaraan] = useState<string>(
    'Thermo Pendingin Normal'
  );
  const [catatanBerangkat, setCatatanBerangkat] = useState<string>('');
  const [fotoOdometerBerangkat, setFotoOdometerBerangkat] =
    useState<string>('');
  const [fotoSuhuBerangkat, setFotoSuhuBerangkat] = useState<string>('');

  // Stage 2: Delivered (Sampai) Form States (adapts to Departure's Mobil Pendingin / Non Pendingin)
  const [deliveredJenisKendaraan, setDeliveredJenisKendaraan] =
    useState<VehicleCoolingType>('Mobil Pendingin');
  const [kmSampai, setKmSampai] = useState<string>('');
  const [suhuSampai, setSuhuSampai] = useState<string>('');
  const [bbmSampai, setBbmSampai] = useState<string>('1/2 Tangki');
  const [kondisiSampai, setKondisiSampai] = useState<string>(
    'Suhu & Segel Utuh - Lengkap'
  );
  const [catatanSampai, setCatatanSampai] = useState<string>('');
  const [fotoOdometerSampai, setFotoOdometerSampai] = useState<string>('');
  const [fotoSuhuSampai, setFotoSuhuSampai] = useState<string>('');

  // Stage 3: Selesai Handover (Berita Acara Serah Terima) Form States
  const [penerimaNama, setPenerimaNama] = useState<string>('');
  const [catatanSerahTerima, setCatatanSerahTerima] = useState<string>('');
  const [fotoBuktiSerahTerima, setFotoBuktiSerahTerima] = useState<string>('');
  const [tandaTanganPenerima, setTandaTanganPenerima] = useState<string>('');

  const [formValidationErr, setFormValidationErr] = useState<string>('');
  const [lastSentWaLog, setLastSentWaLog] =
    useState<WhatsAppNotificationLog | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const [cachedDriverTasks, setCachedDriverTasks] = useState<Assignment[]>(() =>
    readDriverAssignmentsCacheSync(driver.id)
  );

  useEffect(() => {
    let active = true;
    readDriverAssignmentsCacheAsync(driver.id)
      .then((cached) => {
        if (active && cached.length > 0) {
          setCachedDriverTasks(cached);
        }
      })
      .catch(() => {
        // Ignore IndexedDB read errors
      });
    return () => {
      active = false;
    };
  }, [driver.id]);

  const isServerStateHydrated =
    Boolean(config.lastSyncedAt) ||
    assignments.length > 0 ||
    (config.lastSequence || 0) === 0;

  const myAssignments = useMemo(() => {
    const normDriverId = driver.id.trim().toLowerCase();
    const liveMatches = assignments.filter(
      (a) => a.driverId.trim().toLowerCase() === normDriverId
    );
    const byId = new Map<string, Assignment>();
    for (const item of liveMatches) {
      byId.set(item.id, item);
    }

    if (
      embeddedTask &&
      embeddedTask.driverId.trim().toLowerCase() === normDriverId &&
      !byId.has(embeddedTask.id)
    ) {
      byId.set(embeddedTask.id, {
        ...embeddedTask,
        driverCode: embeddedTask.driverCode || embeddedTask.driverId || driver.id,
        notes: embeddedTask.notes ?? '',
        routeId: '',
        createdAt: new Date().toISOString(),
      });
    }

    // Preserve cached Driver tasks ONLY when offline or before initial server hydration finishes
    if (
      liveMatches.length === 0 &&
      cachedDriverTasks.length > 0 &&
      (!isBrowserOnline || !isServerStateHydrated)
    ) {
      for (const cached of cachedDriverTasks) {
        if (
          cached.driverId.trim().toLowerCase() === normDriverId &&
          !byId.has(cached.id)
        ) {
          byId.set(cached.id, {
            ...cached,
            driverCode: cached.driverCode || cached.driverId || driver.id,
          });
        }
      }
    }

    return Array.from(byId.values());
  }, [
    assignments,
    cachedDriverTasks,
    driver.id,
    embeddedTask,
    isBrowserOnline,
    isServerStateHydrated,
  ]);

  // Clear stale cached Driver tasks when online and server explicitly confirms 0 Surat Tugas for this driver
  useEffect(() => {
    if (!isBrowserOnline || !isServerStateHydrated || embeddedTask) return;
    const normDriverId = driver.id.trim().toLowerCase();
    const hasLiveServerMatch = assignments.some(
      (a) => a.driverId.trim().toLowerCase() === normDriverId
    );
    if (!hasLiveServerMatch && cachedDriverTasks.length > 0) {
      setCachedDriverTasks([]);
      void saveDriverAssignmentsCache(driver.id, []);
    }
  }, [
    assignments,
    cachedDriverTasks.length,
    driver.id,
    embeddedTask,
    isBrowserOnline,
    isServerStateHydrated,
  ]);

  // Proactively cache every Surat Tugas (including explicit `driverCode`) in localStorage + IndexedDB
  // BEFORE the 1-hour Firebase Auth token can expire
  useEffect(() => {
    if (myAssignments.length > 0) {
      void saveDriverAssignmentsCache(driver.id, myAssignments);
      for (const asg of myAssignments) {
        void cacheSuratTugasSnapshotLocally(asg, driver.id);
      }
    }
  }, [driver.id, myAssignments]);

  const activeTasks = useMemo(
    () => myAssignments.filter((a) => isActiveTaskStatus(a.status)),
    [myAssignments]
  );

  const completedTasks = useMemo(
    () => myAssignments.filter((a) => isCompletedTaskStatus(a.status)),
    [myAssignments]
  );

  // Form Input Pengeluaran hanya aktif (ditampilkan) ketika ada Surat Tugas untuk Driver ini,
  // dan hanya bisa diisi setelah seluruh Surat Tugas yang diberikan telah diselesaikan.
  const hasSuratTugas = myAssignments.length > 0;
  const canFillExpenseForm =
    hasSuratTugas && activeTasks.length === 0 && completedTasks.length > 0;

  useEffect(() => {
    if (!hasSuratTugas && activeTab === 'pengeluaran') {
      setActiveTab('aktif');
    }
  }, [hasSuratTugas, activeTab]);

  const myNotifications = useMemo(
    () =>
      notifications.filter(
        (n) =>
          n.driverId.trim().toLowerCase() === driver.id.trim().toLowerCase()
      ),
    [notifications, driver.id]
  );

  const todayWibDateStr = useMemo(() => {
    try {
      return new Intl.DateTimeFormat('sv-SE', {
        timeZone: 'Asia/Jakarta',
      }).format(liveNow);
    } catch {
      return liveNow.toISOString().slice(0, 10);
    }
  }, [liveNow]);

  const completedTodayTasks = useMemo(
    () =>
      completedTasks.filter((t) => {
        if (t.tanggalTugas === todayWibDateStr) return true;
        const handoverDay = t.handoverData?.timestamp?.slice(0, 10) || '';
        return handoverDay === todayWibDateStr;
      }),
    [completedTasks, todayWibDateStr]
  );

  const mySubmittedExpenses = useMemo(
    () =>
      driverExpenses
        .filter(
          (e) =>
            e.driverId.trim().toLowerCase() === driver.id.trim().toLowerCase()
        )
        .sort(
          (a, b) =>
            new Date(b.timestamp || b.tanggal).getTime() -
            new Date(a.timestamp || a.tanggal).getTime()
        ),
    [driverExpenses, driver.id]
  );

  // Form Input Pengeluaran (Sheet: Pengeluaran_Driver) states
  const [selectedFleetCardId, setSelectedFleetCardId] = useState<string>(() =>
    fleetCards.length > 0 ? fleetCards[0].id : ''
  );
  const [expenseTanggalPengiriman, setExpenseTanggalPengiriman] =
    useState<string>(() => todayWibDateStr);
  const [expenseTujuanPengiriman, setExpenseTujuanPengiriman] =
    useState<string>('');
  const [tujuanManuallyEdited, setTujuanManuallyEdited] =
    useState<boolean>(false);
  const [expensePlateNumber, setExpensePlateNumber] = useState<string>('');
  const [totalPengirimanBbmInput, setTotalPengirimanBbmInput] =
    useState<string>('');
  const [fotoStrukBbm, setFotoStrukBbm] = useState<string>('');
  const [totalPengeluaranTolInput, setTotalPengeluaranTolInput] =
    useState<string>('');
  const [fotoStrukTol, setFotoStrukTol] = useState<string>('');
  const [catatanPengeluaran, setCatatanPengeluaran] = useState<string>('');
  const [expenseValidationErr, setExpenseValidationErr] = useState<string>('');
  const [submittingExpense, setSubmittingExpense] = useState<boolean>(false);
  const [expenseReceiptPreview, setExpenseReceiptPreview] = useState<{
    title: string;
    subtitle: string;
    src: string;
  } | null>(null);
  const [expenseBrokenImgMap, setExpenseBrokenImgMap] = useState<
    Record<string, boolean>
  >({});

  useEffect(() => {
    if (fleetCards.length === 0) {
      if (selectedFleetCardId !== '') {
        setSelectedFleetCardId('');
      }
      return;
    }
    if (
      !selectedFleetCardId ||
      !fleetCards.some((fc) => fc.id === selectedFleetCardId)
    ) {
      setSelectedFleetCardId(fleetCards[0].id);
    }
  }, [fleetCards, selectedFleetCardId]);

  const relevantCompletedTasks = useMemo(
    () =>
      completedTodayTasks.length > 0 ? completedTodayTasks : completedTasks,
    [completedTodayTasks, completedTasks]
  );

  useEffect(() => {
    if (!expenseTanggalPengiriman) {
      setExpenseTanggalPengiriman(
        relevantCompletedTasks[0]?.tanggalTugas || todayWibDateStr
      );
    }
  }, [relevantCompletedTasks, todayWibDateStr, expenseTanggalPengiriman]);

  useEffect(() => {
    if (tujuanManuallyEdited || expenseTujuanPengiriman.trim()) return;
    const completedDestinations = Array.from(
      new Set(
        relevantCompletedTasks
          .map((t) => String(t.destination || '').trim())
          .filter(Boolean)
      )
    );
    if (completedDestinations.length > 0) {
      setExpenseTujuanPengiriman(completedDestinations.join(', '));
    }
  }, [relevantCompletedTasks, tujuanManuallyEdited, expenseTujuanPengiriman]);

  const destinationQuickOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of relevantCompletedTasks) {
      const d = String(t.destination || '').trim();
      if (d) set.add(d);
    }
    for (const r of routes) {
      const d = String(r.destination || '').trim();
      if (d) set.add(d);
    }
    return Array.from(set);
  }, [relevantCompletedTasks, routes]);

  useEffect(() => {
    if (expensePlateNumber.trim()) return;
    const recentPlate =
      relevantCompletedTasks[0]?.plateNumber ||
      completedTasks[0]?.plateNumber ||
      '';
    if (recentPlate) {
      setExpensePlateNumber(recentPlate);
    }
  }, [relevantCompletedTasks, completedTasks, expensePlateNumber]);

  const activeSelectedFleetCard = useMemo(
    () =>
      selectedFleetCardId
        ? fleetCards.find((fc) => fc.id === selectedFleetCardId) || null
        : null,
    [fleetCards, selectedFleetCardId]
  );

  const parsedBbmNominal = useMemo(
    () => parseRupiahDigits(totalPengirimanBbmInput),
    [totalPengirimanBbmInput]
  );
  const parsedTolNominal = useMemo(
    () => parseRupiahDigits(totalPengeluaranTolInput),
    [totalPengeluaranTolInput]
  );
  const parsedTotalPengeluaran = parsedBbmNominal + parsedTolNominal;

  const handleExpenseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setExpenseValidationErr('');

    if (!hasSuratTugas) {
      setExpenseValidationErr(
        'Form Input Pengeluaran tidak aktif karena belum ada Surat Tugas.'
      );
      return;
    }

    if (!canFillExpenseForm || activeTasks.length > 0) {
      setExpenseValidationErr(
        `Selesaikan seluruh ${activeTasks.length} Surat Tugas yang diberikan terlebih dahulu sebelum mengisi Form Input Pengeluaran.`
      );
      return;
    }

    if (!activeSelectedFleetCard) {
      setExpenseValidationErr(
        fleetCards.length === 0
          ? 'Belum ada data di Master Kartu Fleet Card. Hubungi Admin Dispatcher untuk menambahkan kartu.'
          : 'Pilih Nomor Kartu Fleet Card yang digunakan dari daftar Master Kartu Fleet Card.'
      );
      return;
    }

    const cleanTanggalPengiriman = expenseTanggalPengiriman.trim();
    if (!cleanTanggalPengiriman) {
      setExpenseValidationErr('Tanggal Pengiriman wajib diisi.');
      return;
    }

    const cleanTujuanPengiriman = expenseTujuanPengiriman.trim();
    if (!cleanTujuanPengiriman) {
      setExpenseValidationErr('Tujuan Pengiriman wajib diisi atau dipilih.');
      return;
    }

    if (parsedBbmNominal <= 0 && parsedTolNominal <= 0) {
      setExpenseValidationErr(
        'Masukkan nominal Total Pembelian BBM atau Total Pengeluaran Tol (minimal salah satu lebih dari Rp 0).'
      );
      return;
    }

    if (parsedBbmNominal > 0 && !fotoStrukBbm) {
      setExpenseValidationErr(
        'Unggah Foto Struk Pengeluaran BBM sebagai bukti transaksi BBM.'
      );
      return;
    }

    if (parsedTolNominal > 0 && !fotoStrukTol) {
      setExpenseValidationErr(
        'Unggah Foto Struk Pengeluaran Tol sebagai bukti transaksi Tol.'
      );
      return;
    }

    const completedNos = relevantCompletedTasks
      .map((t) => t.noPenugasan)
      .filter(Boolean)
      .join(', ');

    setSubmittingExpense(true);
    try {
      const ok = await onSubmitDriverExpense({
        tanggalPengiriman: cleanTanggalPengiriman,
        tujuanPengiriman: cleanTujuanPengiriman,
        plateNumber: expensePlateNumber.trim(),
        completedAssignmentNos: completedNos,
        fleetCardId: activeSelectedFleetCard.id,
        fleetCardNumber: activeSelectedFleetCard.cardNumber,
        totalPengirimanBbm: parsedBbmNominal,
        fotoStrukBbm: fotoStrukBbm || undefined,
        totalPengeluaranTol: parsedTolNominal,
        fotoStrukTol: fotoStrukTol || undefined,
        catatan: catatanPengeluaran.trim() || undefined,
      });

      if (ok) {
        setTotalPengirimanBbmInput('');
        setFotoStrukBbm('');
        setTotalPengeluaranTolInput('');
        setFotoStrukTol('');
        setCatatanPengeluaran('');
      }
    } finally {
      setSubmittingExpense(false);
    }
  };

  // Surface incoming real-time WhatsApp notifications automatically in banner
  const latestSeenNotifIdRef = useRef<string | null>(
    myNotifications[0]?.id || null
  );
  useEffect(() => {
    const newest = myNotifications[0];
    if (!newest) return;
    if (latestSeenNotifIdRef.current === null) {
      latestSeenNotifIdRef.current = newest.id;
      return;
    }
    if (newest.id !== latestSeenNotifIdRef.current) {
      latestSeenNotifIdRef.current = newest.id;
      setLastSentWaLog(newest);
    }
  }, [myNotifications]);

  const handleSelectDepartureJenisKendaraan = (next: VehicleCoolingType) => {
    setJenisKendaraan(next);
    setFormValidationErr('');
    if (next === 'Non Pendingin') {
      setSuhuAwal('');
      setFotoSuhuBerangkat('');
      setKondisiKendaraan('Unit Kendaraan Normal & Siap Jalan');
    } else {
      setKondisiKendaraan('Thermo Pendingin Normal');
    }
  };

  const handleSelectDeliveredJenisFallback = (next: VehicleCoolingType) => {
    setDeliveredJenisKendaraan(next);
    setFormValidationErr('');
    if (next === 'Non Pendingin') {
      setSuhuSampai('');
      setFotoSuhuSampai('');
      setKondisiSampai('Segel & Muatan Utuh - Lengkap');
    } else {
      setKondisiSampai('Suhu & Segel Utuh - Lengkap');
    }
  };

  const draftHydratingRef = useRef<boolean>(false);

  const openTaskForm = (task: Assignment) => {
    // Ensure `dataSuratTugasAsli` (with `driverCode`) is backed up in localStorage + IndexedDB as soon as form opens
    void cacheSuratTugasSnapshotLocally(task, driver.id);
    setSelectedTaskId(task.id);
    setFormValidationErr('');
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.setItem('crk_driver_open_task_id', task.id);
      } catch {
        // Ignore
      }
    }

    if (task.status === TaskStatus.MENUNGGU_BERANGKAT) {
      const initialOrigin =
        task.departureData?.titikKeberangkatan ||
        (task.origin && task.origin !== 'Menunggu Titik Keberangkatan Driver'
          ? task.origin
          : '');
      setTitikKeberangkatan(initialOrigin);
      setJenisKendaraan('Mobil Pendingin');
      setKmAwal('');
      setSuhuAwal('');
      setBbmAwal('Penuh (Full)');
      setKondisiKendaraan('Thermo Pendingin Normal');
      setCatatanBerangkat('');
      setFotoOdometerBerangkat('');
      setFotoSuhuBerangkat('');
    } else if (task.status === TaskStatus.DALAM_PERJALANAN) {
      const depJenis: VehicleCoolingType =
        task.departureData?.jenisKendaraan === 'Non Pendingin'
          ? 'Non Pendingin'
          : 'Mobil Pendingin';
      setDeliveredJenisKendaraan(depJenis);
      setKmSampai('');
      setSuhuSampai('');
      setBbmSampai('1/2 Tangki');
      setKondisiSampai(
        depJenis === 'Non Pendingin'
          ? 'Segel & Muatan Utuh - Lengkap'
          : 'Suhu & Segel Utuh - Lengkap'
      );
      setCatatanSampai('');
      setFotoOdometerSampai('');
      setFotoSuhuSampai('');
    } else if (task.status === TaskStatus.DELIVERED) {
      const matchedRoute = routes.find((r) => r.id === task.routeId);
      setPenerimaNama(matchedRoute?.picName || '');
      setCatatanSerahTerima('');
      setFotoBuktiSerahTerima('');
      setTandaTanganPenerima('');
    }

    draftHydratingRef.current = true;
    void readDriverFormDraft(task.id)
      .then((draft) => {
        if (!draft) return;
        if (task.status === TaskStatus.MENUNGGU_BERANGKAT) {
          if (draft.titikKeberangkatan)
            setTitikKeberangkatan(draft.titikKeberangkatan);
          if (draft.jenisKendaraan) setJenisKendaraan(draft.jenisKendaraan);
          if (draft.kmAwal !== undefined && draft.kmAwal !== '')
            setKmAwal(draft.kmAwal);
          if (draft.suhuAwal !== undefined && draft.suhuAwal !== '')
            setSuhuAwal(draft.suhuAwal);
          if (draft.bbmAwal) setBbmAwal(draft.bbmAwal);
          if (draft.kondisiKendaraan)
            setKondisiKendaraan(draft.kondisiKendaraan);
          if (draft.catatanBerangkat)
            setCatatanBerangkat(draft.catatanBerangkat);
          if (draft.fotoOdometerBerangkat)
            setFotoOdometerBerangkat(draft.fotoOdometerBerangkat);
          if (draft.fotoSuhuBerangkat)
            setFotoSuhuBerangkat(draft.fotoSuhuBerangkat);
        } else if (task.status === TaskStatus.DALAM_PERJALANAN) {
          const savedJenis =
            draft.deliveredJenisKendaraan || draft.handoverJenisKendaraan;
          if (savedJenis) setDeliveredJenisKendaraan(savedJenis);
          const savedKm = draft.kmSampai ?? draft.kmAkhir;
          if (savedKm !== undefined && savedKm !== '') setKmSampai(savedKm);
          const savedSuhu = draft.suhuSampai ?? draft.suhuAkhir;
          if (savedSuhu !== undefined && savedSuhu !== '')
            setSuhuSampai(savedSuhu);
          if (draft.bbmSampai || draft.bbmAkhir)
            setBbmSampai(draft.bbmSampai || draft.bbmAkhir || '1/2 Tangki');
          if (draft.kondisiSampai || draft.kondisiAkhir)
            setKondisiSampai(
              draft.kondisiSampai ||
                draft.kondisiAkhir ||
                'Suhu & Segel Utuh - Lengkap'
            );
          if (draft.catatanSampai) setCatatanSampai(draft.catatanSampai);
          const savedOdo =
            draft.fotoOdometerSampai || draft.fotoOdometerSerahTerima;
          if (savedOdo) setFotoOdometerSampai(savedOdo);
          const savedSuhuFoto =
            draft.fotoSuhuSampai || draft.fotoSuhuSerahTerima;
          if (savedSuhuFoto) setFotoSuhuSampai(savedSuhuFoto);
        } else if (task.status === TaskStatus.DELIVERED) {
          if (draft.penerimaNama) setPenerimaNama(draft.penerimaNama);
          if (draft.catatanSerahTerima)
            setCatatanSerahTerima(draft.catatanSerahTerima);
          if (draft.fotoBuktiSerahTerima)
            setFotoBuktiSerahTerima(draft.fotoBuktiSerahTerima);
          if (draft.tandaTanganPenerima)
            setTandaTanganPenerima(draft.tandaTanganPenerima);
        }
      })
      .finally(() => {
        draftHydratingRef.current = false;
      });
  };

  const closeTaskForm = useCallback(() => {
    setSelectedTaskId(null);
    setFormValidationErr('');
    if (typeof window !== 'undefined') {
      try {
        window.sessionStorage.removeItem('crk_driver_open_task_id');
      } catch {
        // Ignore storage restrictions
      }
    }
  }, []);

  // Restore open task form across accidental mobile pull-to-refresh
  useEffect(() => {
    if (selectedTaskId || activeTasks.length === 0) return;
    if (typeof window === 'undefined') return;
    const savedOpenId = window.sessionStorage.getItem('crk_driver_open_task_id');
    if (!savedOpenId) return;
    const found = activeTasks.find((t) => t.id === savedOpenId);
    if (found) {
      openTaskForm(found);
    }
  }, [activeTasks, selectedTaskId]);

  // Continuously save in-progress Driver form inputs & camera photos in IndexedDB
  useEffect(() => {
    if (!selectedTaskId || draftHydratingRef.current) return;
    void saveDriverFormDraft(selectedTaskId, {
      assignmentId: selectedTaskId,
      updatedAtMs: Date.now(),
      titikKeberangkatan,
      jenisKendaraan,
      kmAwal,
      suhuAwal,
      bbmAwal,
      kondisiKendaraan,
      catatanBerangkat,
      fotoOdometerBerangkat: fotoOdometerBerangkat || undefined,
      fotoSuhuBerangkat: fotoSuhuBerangkat || undefined,
      deliveredJenisKendaraan,
      kmSampai,
      suhuSampai,
      bbmSampai,
      kondisiSampai,
      catatanSampai,
      fotoOdometerSampai: fotoOdometerSampai || undefined,
      fotoSuhuSampai: fotoSuhuSampai || undefined,
      penerimaNama,
      catatanSerahTerima,
      fotoBuktiSerahTerima: fotoBuktiSerahTerima || undefined,
      tandaTanganPenerima: tandaTanganPenerima || undefined,
    });
  }, [
    selectedTaskId,
    titikKeberangkatan,
    jenisKendaraan,
    kmAwal,
    suhuAwal,
    bbmAwal,
    kondisiKendaraan,
    catatanBerangkat,
    fotoOdometerBerangkat,
    fotoSuhuBerangkat,
    deliveredJenisKendaraan,
    kmSampai,
    suhuSampai,
    bbmSampai,
    kondisiSampai,
    catatanSampai,
    fotoOdometerSampai,
    fotoSuhuSampai,
    penerimaNama,
    catatanSerahTerima,
    fotoBuktiSerahTerima,
    tandaTanganPenerima,
  ]);

  // Auto-open specific task when Driver enters via a task-specific Link Khusus Driver
  useEffect(() => {
    if (
      initialTaskOpenedRef.current ||
      !initialTaskKey.trim() ||
      myAssignments.length === 0
    ) {
      return;
    }
    const norm = initialTaskKey.trim().toLowerCase();
    const matchedActive = activeTasks.find(
      (a) =>
        a.noPenugasan.trim().toLowerCase() === norm ||
        a.id.trim().toLowerCase() === norm
    );
    if (matchedActive) {
      initialTaskOpenedRef.current = true;
      setActiveTab('aktif');
      openTaskForm(matchedActive);
      return;
    }
    const matchedHistory = completedTasks.find(
      (a) =>
        a.noPenugasan.trim().toLowerCase() === norm ||
        a.id.trim().toLowerCase() === norm
    );
    if (matchedHistory) {
      initialTaskOpenedRef.current = true;
      setActiveTab('riwayat');
    }
  }, [initialTaskKey, myAssignments, activeTasks, completedTasks]);

  /**
   * Generates a real-time WhatsApp message & opens WhatsApp using the exact current click timestamp (`new Date()`).
   */
  const handleSendRealtimeTaskWa = (
    task: Assignment,
    mode: WhatsAppTargetMode
  ) => {
    const clickTime = new Date();
    const eventType = inferWhatsAppEventType(task);
    const freshMessage = buildDriverRealtimeWaMessage(
      {
        ...task,
        driverPhone: task.driverPhone || driver.phone,
      },
      eventType,
      config.whatsappGroupName,
      clickTime
    );

    let url = '';
    if (mode === 'GROUP') {
      url = buildWhatsAppGroupUrl(freshMessage);
    } else if (mode === 'DRIVER') {
      const phone =
        driver.phone || task.driverPhone || config.dispatcherWaPhone || '';
      url = buildWhatsAppDirectUrl(phone, freshMessage, false);
    } else {
      const matchedRoute = routes.find((r) => r.id === task.routeId);
      const phone =
        config.dispatcherWaPhone ||
        matchedRoute?.picPhone ||
        driver.phone ||
        '';
      url = buildWhatsAppDirectUrl(phone, freshMessage, false);
    }

    setLastSentWaLog((prev) =>
      prev && prev.noPenugasan === task.noPenugasan
        ? {
            ...prev,
            timestamp: clickTime.toISOString(),
            message: freshMessage,
            waGroupUrl: buildWhatsAppGroupUrl(freshMessage),
            waDriverUrl: buildWhatsAppDirectUrl(
              driver.phone || task.driverPhone || config.dispatcherWaPhone || '',
              freshMessage,
              false
            ),
          }
        : prev
    );

    launchWhatsAppUrl(url);
  };

  /**
   * Sends WhatsApp from a notification log entry while refreshing the timestamp to the exact live click time (`new Date()`).
   */
  const handleSendRealtimeNotifWa = (
    notif: WhatsAppNotificationLog,
    mode: WhatsAppTargetMode
  ) => {
    const matchedTask = myAssignments.find(
      (a) => a.noPenugasan === notif.noPenugasan
    );
    if (matchedTask) {
      handleSendRealtimeTaskWa(matchedTask, mode);
      return;
    }

    const clickTime = new Date();
    const freshNowLine = `Waktu Pesan WA : ${formatRealTimeTimestamp(clickTime)}`;
    const rawMsg = stripDriverLinkFromWaMessage(String(notif.message || ''));
    const refreshedMessage = rawMsg.includes('Waktu Pesan WA :')
      ? rawMsg.replace(/^Waktu Pesan WA :.*$/m, freshNowLine)
      : rawMsg
      ? (() => {
          const lines = rawMsg.split('\n');
          lines.splice(1, 0, freshNowLine);
          return lines.join('\n');
        })()
      : freshNowLine;

    const updatedNotif: WhatsAppNotificationLog = {
      ...notif,
      timestamp: clickTime.toISOString(),
      message: refreshedMessage,
    };

    if (lastSentWaLog?.id === notif.id) {
      setLastSentWaLog(updatedNotif);
    }

    const url = resolveWhatsAppUrlForMode(
      updatedNotif,
      mode,
      driver.phone,
      config.dispatcherWaPhone
    );
    launchWhatsAppUrl(url);
  };

  const handleCopyRealtimeNotifText = (
    notif: WhatsAppNotificationLog,
    label: string
  ) => {
    const matchedTask = myAssignments.find(
      (a) => a.noPenugasan === notif.noPenugasan
    );
    if (matchedTask) {
      const freshMessage = buildDriverRealtimeWaMessage(
        {
          ...matchedTask,
          driverPhone: matchedTask.driverPhone || driver.phone,
        },
        inferWhatsAppEventType(matchedTask),
        config.whatsappGroupName,
        new Date()
      );
      onCopyText(freshMessage, label);
      return;
    }

    const freshNowLine = `Waktu Pesan WA : ${formatRealTimeTimestamp(new Date())}`;
    const rawMsg = stripDriverLinkFromWaMessage(String(notif.message || ''));
    const refreshedMessage = rawMsg.includes('Waktu Pesan WA :')
      ? rawMsg.replace(/^Waktu Pesan WA :.*$/m, freshNowLine)
      : rawMsg;
    onCopyText(refreshedMessage, label);
  };

  /**
   * Core Tier 2 Firestore submission + Offline Recovery for Link Khusus Driver:
   * Delegates to shared `submitReportToFirestoreWithOfflineRecovery` in `firestoreSync.ts`
   * and synchronizes DriverPortal local task cache & friendly offline notice banner.
   */
  const submitReportToFirestoreWithOfflineRecovery = useCallback(
    async (params: {
      assignmentId: string;
      stage: DriverReportStage;
      candidateAssignment: Assignment;
      departurePayload?: DriverDepartureSubmitPayload;
      deliveredCatatan?: string;
      deliveredPayload?: DriverDeliveredSubmitPayload;
      handoverPayload?: DriverHandoverSubmitPayload;
      suppressToast?: boolean;
    }): Promise<{
      syncedToFirestore: boolean;
      queuedOffline: boolean;
      resolvedAssignment: Assignment & { driverCode: string };
    }> => {
      const {
        assignmentId,
        stage,
        candidateAssignment,
        departurePayload,
        deliveredCatatan,
        deliveredPayload,
        handoverPayload,
        suppressToast = false,
      } = params;

      const result = await submitSharedReportWithOfflineRecovery({
        assignmentId,
        fallbackDriverId: driver.id,
        stage,
        candidateAssignment,
        departurePayload,
        deliveredCatatan,
        deliveredPayload,
        handoverPayload,
      });

      setCachedDriverTasks((prev) => {
        const exists = prev.some(
          (item) => item.id === result.resolvedAssignment.id
        );
        return exists
          ? prev.map((item) =>
              item.id === result.resolvedAssignment.id
                ? result.resolvedAssignment
                : item
            )
          : [result.resolvedAssignment, ...prev];
      });

      if (result.syncedToFirestore) {
        setOfflineRecoveryNotice('');
      } else {
        setOfflineRecoveryNotice(OFFLINE_RECOVERY_FRIENDLY_MESSAGE);
        if (!suppressToast) {
          onNotify?.(
            'info',
            'Laporan Aman Tersimpan di Memori HP',
            OFFLINE_RECOVERY_FRIENDLY_MESSAGE
          );
        }
      }

      return result;
    },
    [driver.id, onNotify]
  );

  // Per-item manual retry handler inside Driver Portal
  const retrySinglePendingItem = useCallback(
    async (targetItem: PendingReportSyncItem): Promise<boolean> => {
      const qId = targetItem.queueId;
      if (localRetryingQueueIds[qId]) return false;

      setLocalRetryingQueueIds((prev) => ({ ...prev, [qId]: true }));
      try {
        if (onRetrySinglePendingSync) {
          const ok = await onRetrySinglePendingSync(qId);
          if (ok && pendingSyncItems.length <= 1) {
            setOfflineRecoveryNotice('');
          }
          return ok;
        }

        setPendingItemRetryStatus(
          qId,
          'retrying',
          'Menghubungi Cloud Database...'
        );
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          await new Promise((r) => setTimeout(r, 350));
          setPendingItemRetryStatus(
            qId,
            'failed',
            'Perangkat masih luring (tanpa sinyal). Otomatis dikirim saat sinyal kembali.'
          );
          onNotify?.(
            'info',
            `Menunggu Sinyal (${targetItem.noPenugasan})`,
            'HP masih luring. Laporan tetap aman di memori HP dan akan dikirim otomatis.'
          );
          return false;
        }

        const hydrated = await hydratePendingReportSyncItem(targetItem);
        const res = await submitReportToFirestoreWithOfflineRecovery({
          assignmentId: hydrated.assignmentId,
          stage: hydrated.stage,
          candidateAssignment: hydrated.assignmentSnapshot,
          departurePayload: hydrated.departurePayload,
          deliveredCatatan: hydrated.deliveredCatatan,
          deliveredPayload: hydrated.deliveredPayload,
          handoverPayload: hydrated.handoverPayload,
          suppressToast: true,
        });

        if (res.syncedToFirestore) {
          if (pendingSyncItems.length <= 1) {
            setOfflineRecoveryNotice('');
          }
          onNotify?.(
            'success',
            `Laporan ${targetItem.noPenugasan} Terkirim`,
            'Laporan dari memori HP berhasil disinkronkan ke Cloud.'
          );
          return true;
        }

        setPendingItemRetryStatus(
          qId,
          'failed',
          'Koneksi ke Cloud belum stabil. Siap dicoba ulang.'
        );
        return false;
      } finally {
        setLocalRetryingQueueIds((prev) => {
          const next = { ...prev };
          delete next[qId];
          return next;
        });
      }
    },
    [
      localRetryingQueueIds,
      onNotify,
      onRetrySinglePendingSync,
      pendingSyncItems.length,
      submitReportToFirestoreWithOfflineRecovery,
    ]
  );

  // Manual retry-all button handler inside Driver Portal (global `online` auto-retry runs in `App.tsx`)
  const retryPortalPendingFirestoreSync = useCallback(async () => {
    if (onRetryPendingSync) {
      await onRetryPendingSync();
      return;
    }

    const myPending = readLocalStoragePendingReportSyncEntries().filter(
      ({ item }) =>
        item.driverId.trim().toLowerCase() === driver.id.trim().toLowerCase() &&
        !item.firestoreSynced
    );
    if (myPending.length === 0) return;

    let recovered = 0;
    for (const { item: rawItem } of myPending) {
      const ok = await retrySinglePendingItem(rawItem);
      if (ok) {
        recovered += 1;
      }
    }

    if (recovered > 0) {
      setOfflineRecoveryNotice('');
      onNotify?.(
        'success',
        'Laporan Offline Berhasil Terkirim',
        `${recovered} laporan dari memori HP berhasil disinkronkan ke Firestore Database.`
      );
    }
  }, [driver.id, onNotify, onRetryPendingSync, retrySinglePendingItem]);

  const scrollWaBannerIntoView = useCallback(() => {
    if (typeof window === 'undefined') return;
    window.setTimeout(() => {
      waBannerRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'center',
      });
    }, 80);
  }, []);

  const handleDirectDepartureSubmit = async (
    e: React.FormEvent,
    task: Assignment
  ) => {
    e.preventDefault();
    if (submitting) return;
    setFormValidationErr('');

    const isPendingin = jenisKendaraan === 'Mobil Pendingin';

    if (!titikKeberangkatan.trim()) {
      setFormValidationErr('Titik Keberangkatan Driver wajib diisi.');
      return;
    }
    if (kmAwal === '' || Number(kmAwal) < 0) {
      setFormValidationErr('Odometer KM Awal wajib diisi.');
      return;
    }
    if (isPendingin && !suhuAwal.trim()) {
      setFormValidationErr(
        'Suhu Keberangkatan wajib diisi untuk Mobil Pendingin.'
      );
      return;
    }
    if (!fotoOdometerBerangkat) {
      setFormValidationErr('Foto Odometer Keberangkatan wajib diunggah.');
      return;
    }
    if (isPendingin && !fotoSuhuBerangkat) {
      setFormValidationErr(
        'Foto Monitor Pendingin Keberangkatan wajib diunggah untuk Mobil Pendingin.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const departurePayload: DriverDepartureSubmitPayload = {
        titikKeberangkatan: titikKeberangkatan.trim(),
        jenisKendaraan,
        kmAwal: Number(kmAwal) || 0,
        suhuAwal: isPendingin ? suhuAwal.trim() : '',
        bbmAwal,
        kondisiKendaraan,
        catatanBerangkat,
        fotoOdometerBerangkat: fotoOdometerBerangkat || undefined,
        fotoSuhuBerangkat: isPendingin
          ? fotoSuhuBerangkat || undefined
          : undefined,
      };

      const candidateDepartureTask: Assignment = {
        ...task,
        driverCode: task.driverCode || driver.id || task.driverId,
        origin: departurePayload.titikKeberangkatan,
        status: TaskStatus.DALAM_PERJALANAN,
        departureData: {
          timestamp: nowIso,
          titikKeberangkatan: departurePayload.titikKeberangkatan,
          jenisKendaraan: departurePayload.jenisKendaraan,
          kmAwal: departurePayload.kmAwal,
          suhuAwal: departurePayload.suhuAwal,
          bbmAwal: departurePayload.bbmAwal,
          kondisiKendaraan: departurePayload.kondisiKendaraan,
          catatanBerangkat: departurePayload.catatanBerangkat,
          fotoOdometerBerangkat: departurePayload.fotoOdometerBerangkat,
          fotoSuhuBerangkat: departurePayload.fotoSuhuBerangkat,
        },
      };

      void cacheSuratTugasSnapshotLocally(candidateDepartureTask, driver.id);
      setCachedDriverTasks((prev) => {
        const exists = prev.some((item) => item.id === candidateDepartureTask.id);
        return exists
          ? prev.map((item) =>
              item.id === candidateDepartureTask.id ? candidateDepartureTask : item
            )
          : [candidateDepartureTask, ...prev];
      });

      const waLog = await onSubmitDeparture(
        task.id,
        departurePayload,
        waTargetMode,
        autoOpenWa,
        candidateDepartureTask
      );
      if (waLog) {
        void clearDriverFormDraft(task.id);
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.removeItem('crk_driver_open_task_id');
          } catch {
            // Ignore
          }
        }
        setLastSentWaLog(waLog);
        if (waLog.gatewayDetail?.includes('Pending Sync Queue')) {
          setOfflineRecoveryNotice(OFFLINE_RECOVERY_FRIENDLY_MESSAGE);
        } else {
          setOfflineRecoveryNotice('');
        }
        setSelectedTaskId(null);
        scrollWaBannerIntoView();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectDeliveredSubmit = async (
    e: React.FormEvent,
    task: Assignment
  ) => {
    e.preventDefault();
    if (submitting) return;
    setFormValidationErr('');

    const effectiveDeliveredJenis: VehicleCoolingType =
      task.departureData?.jenisKendaraan || deliveredJenisKendaraan;
    const isPendingin = effectiveDeliveredJenis !== 'Non Pendingin';
    const startKm = task.departureData?.kmAwal ?? 0;

    if (kmSampai.trim() === '' || !Number.isFinite(Number(kmSampai))) {
      setFormValidationErr('Odometer KM Sampai wajib diisi.');
      return;
    }
    if (Number(kmSampai) < startKm) {
      setFormValidationErr(
        `Odometer KM Sampai (${Number(kmSampai).toLocaleString(
          'id-ID'
        )} km) tidak boleh lebih kecil dari KM Awal (${startKm.toLocaleString(
          'id-ID'
        )} km).`
      );
      return;
    }
    if (isPendingin && !suhuSampai.trim()) {
      setFormValidationErr(
        'Suhu Serah Sampai (°C) wajib diisi untuk Mobil Pendingin.'
      );
      return;
    }
    if (!bbmSampai.trim()) {
      setFormValidationErr('Posisi BBM Sampai wajib dipilih.');
      return;
    }
    if (!kondisiSampai.trim()) {
      setFormValidationErr('Kondisi Muatan & Segel Saat Sampai wajib dipilih.');
      return;
    }
    if (!fotoOdometerSampai) {
      setFormValidationErr('Foto Odometer Sampai wajib diunggah.');
      return;
    }
    if (isPendingin && !fotoSuhuSampai) {
      setFormValidationErr(
        'Foto Monitor Pendingin Sampai wajib diunggah untuk Mobil Pendingin.'
      );
      return;
    }

    setSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const deliveredPayload: DriverDeliveredSubmitPayload = {
        jenisKendaraan: effectiveDeliveredJenis,
        kmSampai: Number(kmSampai) || 0,
        suhuSampai: isPendingin ? suhuSampai.trim() : '',
        bbmSampai: bbmSampai.trim(),
        kondisiSampai: kondisiSampai.trim(),
        catatanSampai: catatanSampai.trim(),
        fotoOdometerSampai: fotoOdometerSampai || undefined,
        fotoSuhuSampai: isPendingin ? fotoSuhuSampai || undefined : undefined,
      };

      const candidateDeliveredTask: Assignment = {
        ...task,
        driverCode: task.driverCode || driver.id || task.driverId,
        status: TaskStatus.DELIVERED,
        deliveredAt: nowIso,
        deliveredData: {
          timestamp: nowIso,
          jenisKendaraan: deliveredPayload.jenisKendaraan || effectiveDeliveredJenis,
          kmSampai: deliveredPayload.kmSampai,
          suhuSampai: deliveredPayload.suhuSampai,
          bbmSampai: deliveredPayload.bbmSampai,
          kondisiSampai: deliveredPayload.kondisiSampai,
          catatanSampai: deliveredPayload.catatanSampai,
          fotoOdometerSampai: deliveredPayload.fotoOdometerSampai,
          fotoSuhuSampai: deliveredPayload.fotoSuhuSampai,
        },
      };

      void cacheSuratTugasSnapshotLocally(candidateDeliveredTask, driver.id);
      setCachedDriverTasks((prev) => {
        const exists = prev.some((item) => item.id === candidateDeliveredTask.id);
        return exists
          ? prev.map((item) =>
              item.id === candidateDeliveredTask.id ? candidateDeliveredTask : item
            )
          : [candidateDeliveredTask, ...prev];
      });

      const waLog = await onSubmitDelivered(
        task.id,
        deliveredPayload,
        waTargetMode,
        autoOpenWa,
        candidateDeliveredTask
      );
      if (waLog) {
        void clearDriverFormDraft(task.id);
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.removeItem('crk_driver_open_task_id');
          } catch {
            // Ignore
          }
        }
        setLastSentWaLog(waLog);
        if (waLog.gatewayDetail?.includes('Pending Sync Queue')) {
          setOfflineRecoveryNotice(OFFLINE_RECOVERY_FRIENDLY_MESSAGE);
        } else {
          setOfflineRecoveryNotice('');
        }
        setSelectedTaskId(null);
        scrollWaBannerIntoView();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectHandoverSubmit = async (
    e: React.FormEvent,
    task: Assignment
  ) => {
    e.preventDefault();
    if (submitting) return;
    setFormValidationErr('');

    if (!penerimaNama.trim()) {
      setFormValidationErr('Nama Penerima Serah Terima wajib diisi.');
      return;
    }
    if (!fotoBuktiSerahTerima) {
      setFormValidationErr('Foto Bukti Serah Terima wajib diunggah.');
      return;
    }
    if (!tandaTanganPenerima) {
      setFormValidationErr(
        'Canvas Tanda Tangan Penerima wajib ditandatangani.'
      );
      return;
    }

    const effectiveHandoverJenis: VehicleCoolingType =
      task.deliveredData?.jenisKendaraan ||
      task.departureData?.jenisKendaraan ||
      'Mobil Pendingin';
    const isPendingin = effectiveHandoverJenis !== 'Non Pendingin';
    const inheritedKmAkhir =
      task.deliveredData?.kmSampai ?? task.departureData?.kmAwal ?? 0;
    const inheritedSuhuAkhir = isPendingin
      ? task.deliveredData?.suhuSampai || task.departureData?.suhuAwal || ''
      : '';
    const inheritedBbmAkhir = task.deliveredData?.bbmSampai || '1/2 Tangki';
    const inheritedKondisiAkhir =
      task.deliveredData?.kondisiSampai ||
      (isPendingin
        ? 'Suhu & Segel Utuh - Lengkap'
        : 'Segel & Muatan Utuh - Lengkap');
    const inheritedFotoOdo = task.deliveredData?.fotoOdometerSampai;
    const inheritedFotoSuhu = isPendingin
      ? task.deliveredData?.fotoSuhuSampai
      : undefined;

    setSubmitting(true);
    try {
      const nowIso = new Date().toISOString();
      const handoverPayload: DriverHandoverSubmitPayload = {
        jenisKendaraan: effectiveHandoverJenis,
        kmAkhir: inheritedKmAkhir,
        suhuAkhir: inheritedSuhuAkhir,
        bbmAkhir: inheritedBbmAkhir,
        penerimaNama: penerimaNama.trim(),
        kondisiAkhir: inheritedKondisiAkhir,
        catatanSerahTerima: catatanSerahTerima.trim(),
        fotoOdometerSerahTerima: inheritedFotoOdo,
        fotoSuhuSerahTerima: inheritedFotoSuhu,
        fotoBuktiSerahTerima: fotoBuktiSerahTerima || undefined,
        tandaTanganPenerima: tandaTanganPenerima || undefined,
      };

      const candidateHandoverTask: Assignment = {
        ...task,
        driverCode: task.driverCode || driver.id || task.driverId,
        status: TaskStatus.HANDOVER,
        deliveredAt:
          task.deliveredAt || task.deliveredData?.timestamp || nowIso,
        handoverData: {
          timestamp: nowIso,
          kmAkhir: handoverPayload.kmAkhir,
          suhuAkhir: handoverPayload.suhuAkhir,
          bbmAkhir: handoverPayload.bbmAkhir,
          penerimaNama: handoverPayload.penerimaNama,
          kondisiAkhir: handoverPayload.kondisiAkhir,
          catatanSerahTerima: handoverPayload.catatanSerahTerima,
          fotoOdometerSerahTerima: handoverPayload.fotoOdometerSerahTerima,
          fotoSuhuSerahTerima: handoverPayload.fotoSuhuSerahTerima,
          fotoBuktiSerahTerima: handoverPayload.fotoBuktiSerahTerima,
          tandaTanganPenerima: handoverPayload.tandaTanganPenerima,
        },
      };

      void cacheSuratTugasSnapshotLocally(candidateHandoverTask, driver.id);
      setCachedDriverTasks((prev) => {
        const exists = prev.some((item) => item.id === candidateHandoverTask.id);
        return exists
          ? prev.map((item) =>
              item.id === candidateHandoverTask.id ? candidateHandoverTask : item
            )
          : [candidateHandoverTask, ...prev];
      });

      const waLog = await onSubmitHandover(
        task.id,
        handoverPayload,
        waTargetMode,
        autoOpenWa,
        candidateHandoverTask
      );
      if (waLog) {
        void clearDriverFormDraft(task.id);
        if (typeof window !== 'undefined') {
          try {
            window.sessionStorage.removeItem('crk_driver_open_task_id');
          } catch {
            // Ignore
          }
        }
        setLastSentWaLog(waLog);
        if (waLog.gatewayDetail?.includes('Pending Sync Queue')) {
          setOfflineRecoveryNotice(OFFLINE_RECOVERY_FRIENDLY_MESSAGE);
        } else {
          setOfflineRecoveryNotice('');
        }
        setSelectedTaskId(null);
        scrollWaBannerIntoView();
      }
    } finally {
      setSubmitting(false);
    }
  };

  const hasGroupInviteLink =
    config.whatsappGroupInviteUrl &&
    config.whatsappGroupInviteUrl.startsWith('https://chat.whatsapp.com/');

  const handleBellSelectNotification = (item: PortalBellNotificationItem) => {
    if (item.category === 'OFFLINE_QUEUE') {
      void retryPortalPendingFirestoreSync();
      return;
    }
    const matchedActive = activeTasks.find(
      (a) =>
        (item.assignmentId && a.id === item.assignmentId) ||
        (item.noPenugasan && a.noPenugasan === item.noPenugasan)
    );
    if (matchedActive) {
      setActiveTab('aktif');
      openTaskForm(matchedActive);
      return;
    }
    const matchedCompleted = completedTasks.find(
      (a) =>
        (item.assignmentId && a.id === item.assignmentId) ||
        (item.noPenugasan && a.noPenugasan === item.noPenugasan)
    );
    if (matchedCompleted) {
      setActiveTab('riwayat');
      return;
    }
    setActiveTab('notifikasi_wa');
  };

  const handleBellQuickWhatsApp = (item: PortalBellNotificationItem) => {
    if (item.assignment) {
      handleSendRealtimeTaskWa(item.assignment, waTargetMode);
      return;
    }
    if (item.waLog) {
      handleSendRealtimeNotifWa(item.waLog, waTargetMode);
    }
  };

  const copyMyDriverPortalLink = () => {
    onCopyText(
      buildDriverPortalLink({
        driverId: driver.id,
        taskId: activeTasks[0]?.id,
        taskNo: activeTasks[0]?.noPenugasan,
        customBaseUrl: config.publicPortalBaseUrl,
        driverSnapshot: driver,
        taskSnapshot: activeTasks[0],
      }),
      `Link Login Khusus ${driver.id}`
    );
  };

  const verificationTargetTask = useMemo<Assignment | null>(() => {
    if (selectedTaskId) {
      const selectedActive = activeTasks.find((t) => t.id === selectedTaskId);
      if (selectedActive) return selectedActive;
    }
    const waitingDeparture = activeTasks.find(
      (t) => t.status === TaskStatus.MENUNGGU_BERANGKAT
    );
    if (waitingDeparture) return waitingDeparture;
    return activeTasks[0] ?? null;
  }, [activeTasks, selectedTaskId]);

  const [collapsedDraftPreview, setCollapsedDraftPreview] = useState<{
    taskId: string;
    jenisKendaraan?: VehicleCoolingType;
    kmAwal?: string;
    suhuAwal?: string;
  } | null>(null);

  useEffect(() => {
    if (
      !verificationTargetTask ||
      selectedTaskId === verificationTargetTask.id ||
      verificationTargetTask.status !== TaskStatus.MENUNGGU_BERANGKAT
    ) {
      setCollapsedDraftPreview(null);
      return;
    }
    let cancelled = false;
    void readDriverFormDraft(verificationTargetTask.id)
      .then((draft) => {
        if (cancelled) return;
        if (!draft) {
          setCollapsedDraftPreview(null);
          return;
        }
        setCollapsedDraftPreview({
          taskId: verificationTargetTask.id,
          jenisKendaraan: draft.jenisKendaraan,
          kmAwal: draft.kmAwal,
          suhuAwal: draft.suhuAwal,
        });
      })
      .catch(() => {
        if (!cancelled) setCollapsedDraftPreview(null);
      });
    return () => {
      cancelled = true;
    };
  }, [verificationTargetTask, selectedTaskId]);

  const verificationSummary = useMemo(() => {
    const formatKm = (
      raw: string | number | undefined | null
    ): { formatted: string | null; numeric: number | null; invalid: boolean } => {
      if (raw === undefined || raw === null) {
        return { formatted: null, numeric: null, invalid: false };
      }
      const str = String(raw).trim();
      if (!str) {
        return { formatted: null, numeric: null, invalid: false };
      }
      const num = Number(str);
      if (!Number.isFinite(num) || num < 0) {
        return { formatted: null, numeric: null, invalid: true };
      }
      return {
        formatted: `${num.toLocaleString('id-ID')} km`,
        numeric: num,
        invalid: false,
      };
    };

    const formatSuhu = (raw: string | undefined | null): string | null => {
      if (!raw) return null;
      const trimmed = raw.trim();
      if (!trimmed) return null;
      if (/°\s*[cCfF]\b|[cCfF]$/i.test(trimmed)) {
        return trimmed
          .replace(/°?\s*c$/i, ' °C')
          .replace(/\s+/g, ' ')
          .trim();
      }
      if (/\d$/.test(trimmed)) {
        return `${trimmed} °C`;
      }
      return trimmed;
    };

    if (!verificationTargetTask) {
      return {
        hasTask: false,
        isExpanded: false,
        isWaitingDeparture: false,
        coolingType: 'Mobil Pendingin' as VehicleCoolingType,
        kmAwalFormatted: null as string | null,
        kmAwalInvalid: false,
        suhuAwalFormatted: null as string | null,
        isKmReady: false,
        isSuhuReady: false,
        isReadyForSubmit: false,
        kmAkhirDeltaText: null as string | null,
        kmAkhirInvalid: false,
        suhuAkhirFormatted: null as string | null,
      };
    }

    const isExpanded = selectedTaskId === verificationTargetTask.id;
    const isWaitingDeparture =
      verificationTargetTask.status === TaskStatus.MENUNGGU_BERANGKAT;

    if (isWaitingDeparture) {
      const draftMatches =
        collapsedDraftPreview?.taskId === verificationTargetTask.id
          ? collapsedDraftPreview
          : null;
      const effectiveCooling: VehicleCoolingType = isExpanded
        ? jenisKendaraan
        : draftMatches?.jenisKendaraan ||
          verificationTargetTask.departureData?.jenisKendaraan ||
          'Mobil Pendingin';
      const rawKm = isExpanded
        ? kmAwal
        : draftMatches?.kmAwal ??
          verificationTargetTask.departureData?.kmAwal ??
          '';
      const rawSuhu = isExpanded
        ? suhuAwal
        : draftMatches?.suhuAwal ??
          verificationTargetTask.departureData?.suhuAwal ??
          '';

      const kmParsed = formatKm(rawKm);
      const suhuFormatted =
        effectiveCooling === 'Non Pendingin' ? null : formatSuhu(rawSuhu);
      const isKmReady = Boolean(kmParsed.formatted) && !kmParsed.invalid;
      const isSuhuReady =
        effectiveCooling === 'Non Pendingin' || Boolean(suhuFormatted);

      return {
        hasTask: true,
        isExpanded,
        isWaitingDeparture: true,
        coolingType: effectiveCooling,
        kmAwalFormatted: kmParsed.formatted,
        kmAwalInvalid: kmParsed.invalid,
        suhuAwalFormatted: suhuFormatted,
        isKmReady,
        isSuhuReady,
        isReadyForSubmit: isKmReady && isSuhuReady,
        kmAkhirDeltaText: null as string | null,
        kmAkhirInvalid: false,
        suhuAkhirFormatted: null as string | null,
      };
    }

    // Active task in transit (Delivered form) or already Delivered (Handover Berita Acara stage)
    const effectiveCooling: VehicleCoolingType =
      verificationTargetTask.deliveredData?.jenisKendaraan ||
      verificationTargetTask.departureData?.jenisKendaraan ||
      (isExpanded ? deliveredJenisKendaraan : 'Mobil Pendingin');
    const kmParsed = formatKm(verificationTargetTask.departureData?.kmAwal);
    const suhuFormatted =
      effectiveCooling === 'Non Pendingin'
        ? null
        : formatSuhu(verificationTargetTask.departureData?.suhuAwal);

    const activeArrivalKmRaw =
      verificationTargetTask.status === TaskStatus.DELIVERED
        ? verificationTargetTask.deliveredData?.kmSampai !== undefined
          ? String(verificationTargetTask.deliveredData.kmSampai)
          : ''
        : isExpanded
        ? kmSampai
        : '';

    let kmAkhirDeltaText: string | null = null;
    let kmAkhirInvalid = false;
    if (activeArrivalKmRaw.trim() !== '') {
      const akhirNum = Number(activeArrivalKmRaw);
      const startNum = verificationTargetTask.departureData?.kmAwal ?? 0;
      if (!Number.isFinite(akhirNum) || akhirNum < startNum) {
        kmAkhirInvalid = true;
      } else {
        kmAkhirDeltaText = `+${(akhirNum - startNum).toLocaleString('id-ID')} km`;
      }
    }

    const rawArrivalSuhu =
      verificationTargetTask.status === TaskStatus.DELIVERED
        ? verificationTargetTask.deliveredData?.suhuSampai || ''
        : isExpanded
        ? suhuSampai
        : '';

    const suhuAkhirFormatted =
      effectiveCooling !== 'Non Pendingin' ? formatSuhu(rawArrivalSuhu) : null;

    return {
      hasTask: true,
      isExpanded,
      isWaitingDeparture: false,
      coolingType: effectiveCooling,
      kmAwalFormatted: kmParsed.formatted,
      kmAwalInvalid: false,
      suhuAwalFormatted: suhuFormatted,
      isKmReady: Boolean(kmParsed.formatted),
      isSuhuReady:
        effectiveCooling === 'Non Pendingin' || Boolean(suhuFormatted),
      isReadyForSubmit: !kmAkhirInvalid,
      kmAkhirDeltaText,
      kmAkhirInvalid,
      suhuAkhirFormatted,
    };
  }, [
    verificationTargetTask,
    selectedTaskId,
    collapsedDraftPreview,
    jenisKendaraan,
    kmAwal,
    suhuAwal,
    deliveredJenisKendaraan,
    kmSampai,
    suhuSampai,
  ]);

  const handleFocusVerificationField = (field: 'km' | 'suhu') => {
    if (!verificationTargetTask) return;
    if (activeTab !== 'aktif') {
      setActiveTab('aktif');
    }
    const isTargetWaiting =
      verificationTargetTask.status === TaskStatus.MENUNGGU_BERANGKAT;
    const isTargetInTransit =
      verificationTargetTask.status === TaskStatus.DALAM_PERJALANAN;
    if (selectedTaskId !== verificationTargetTask.id) {
      openTaskForm(verificationTargetTask);
    }
    if (typeof window !== 'undefined') {
      window.setTimeout(() => {
        const targetId = isTargetWaiting
          ? field === 'km'
            ? 'driver-input-km-awal'
            : 'driver-input-suhu-awal'
          : isTargetInTransit
          ? field === 'km'
            ? 'driver-input-km-sampai'
            : 'driver-input-suhu-sampai'
          : 'driver-input-penerima-nama';
        const inputEl = window.document.getElementById(
          targetId
        ) as HTMLInputElement | null;
        if (inputEl) {
          inputEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
          inputEl.focus({ preventScroll: true });
        }
      }, 90);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Unified Sticky Top Shell: App Bar + Permanent KM Awal & Suhu Awal Verification Card */}
      <div className="sticky top-0 z-30 bg-white/95 backdrop-blur-md">
        <header className="flex h-12 items-center justify-between gap-2 border-b border-slate-200/80 px-3.5 sm:h-auto sm:gap-4 sm:px-6 sm:py-3">
        <div className="flex min-w-0 items-center gap-2">
          <Snowflake className="h-4 w-4 shrink-0 text-sky-700" />
          <div className="min-w-0 truncate text-sm font-bold tracking-tight text-slate-900 sm:text-base">
            CRK LOGISTIK · <span className="font-mono">{driver.id}</span>
          </div>
        </div>

        <div className="hidden md:flex items-center gap-3 text-xs text-slate-600">
          <span className="font-medium text-slate-900 whitespace-nowrap shrink-0">
            {driver.name}
          </span>
          {driver.phone && (
            <>
              <span aria-hidden="true">·</span>
              <span className="font-mono text-slate-600 whitespace-nowrap shrink-0 tabular-nums">
                WA: {driver.phone}
              </span>
            </>
          )}
          <span aria-hidden="true">·</span>
          <span className="whitespace-nowrap shrink-0">
            Rantai Pengiriman Dingin Real-Time
          </span>
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          <PWAInstallButton compact />

          <button
            type="button"
            onClick={copyMyDriverPortalLink}
            className="inline-flex h-10 w-10 items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 sm:w-auto sm:px-3 whitespace-nowrap shrink-0"
            title="Salin link akses khusus ID Driver Anda"
          >
            <Link2 className="h-3.5 w-3.5 text-sky-700" />
            <span className="hidden sm:inline">Link Saya</span>
          </button>

          {/* Real-Time Notification Bell for Driver */}
          <NotificationBell
            role="DRIVER"
            driverId={driver.id}
            driverName={driver.name}
            assignments={myAssignments}
            notifications={notifications}
            pendingSyncCount={pendingSyncItems.length}
            onSelectNotification={handleBellSelectNotification}
            onQuickWhatsApp={handleBellQuickWhatsApp}
            onViewAllLogs={() => setActiveTab('notifikasi_wa')}
          />

          <button
            type="button"
            onClick={onLogout}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-3 text-xs font-semibold text-white transition-colors hover:bg-slate-800 sm:px-3.5 whitespace-nowrap shrink-0"
            title="Keluar sesi Driver"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span className="hidden xs:inline sm:inline">Keluar</span>
          </button>
        </div>
        </header>

        {/* Permanent Sticky Top Status Card: KM Awal & Suhu Awal Verification */}
        <section
          aria-label="Kartu Status Verifikasi KM Awal dan Suhu Awal"
          className="border-b border-slate-200/90"
        >
        <div className="mx-auto w-full max-w-4xl px-3.5 py-2 sm:px-6 sm:py-2.5">
          {/* Context & Verification Readiness Line */}
          <div className="mb-1.5 flex items-center justify-between gap-2 text-[11px] leading-tight">
            <div className="flex min-w-0 items-center gap-1.5 text-slate-600">
              <span className="font-semibold text-slate-800 shrink-0">
                Verifikasi Awal
              </span>
              {verificationTargetTask ? (
                <>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span className="truncate font-mono font-bold text-slate-900 tabular-nums">
                    {verificationTargetTask.noPenugasan}
                  </span>
                  <span
                    aria-hidden="true"
                    className="hidden xs:inline text-slate-400 sm:inline"
                  >
                    ·
                  </span>
                  <span className="hidden xs:inline truncate font-mono font-semibold text-slate-700 sm:inline">
                    {verificationTargetTask.plateNumber}
                  </span>
                </>
              ) : (
                <>
                  <span aria-hidden="true" className="text-slate-400">
                    ·
                  </span>
                  <span className="truncate text-slate-500">
                    Menunggu Surat Tugas Aktif
                  </span>
                </>
              )}
            </div>

            <div className="shrink-0 font-semibold">
              {!verificationSummary.hasTask ? (
                <span className="inline-flex items-center gap-1 text-slate-500">
                  <Clock className="h-3.5 w-3.5 shrink-0" />
                  <span>Standby</span>
                </span>
              ) : verificationSummary.isWaitingDeparture ? (
                verificationSummary.isReadyForSubmit ? (
                  <span className="inline-flex items-center gap-1 text-emerald-700">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span>Siap Diverifikasi</span>
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 text-amber-800">
                    <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                    <span>Cek Input Awal</span>
                  </span>
                )
              ) : verificationSummary.kmAkhirInvalid ? (
                <span className="inline-flex items-center gap-1 text-red-700">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                  <span>KM Akhir &lt; Awal</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-sky-800">
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
                  <span>Tercatat</span>
                </span>
              )}
            </div>
          </div>

          {/* 2-Column Summary Card: KM Awal & Suhu Awal */}
          <div className="grid grid-cols-2 divide-x divide-slate-200/90 rounded-xl border border-slate-200/90 bg-slate-50/85">
            {/* Column 1: KM Awal */}
            <button
              type="button"
              disabled={!verificationSummary.hasTask}
              onClick={() => handleFocusVerificationField('km')}
              aria-label="Verifikasi atau ubah input Odometer KM Awal"
              className="flex min-h-[46px] flex-col justify-center rounded-l-xl px-3 py-1.5 text-left transition-colors hover:bg-white active:bg-slate-100/80 disabled:cursor-default disabled:hover:bg-transparent sm:min-h-[52px] sm:px-4 sm:py-2"
            >
              <span className="flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <Gauge className="h-3 w-3 shrink-0 text-slate-600" />
                  <span>KM Awal</span>
                </span>
                {verificationSummary.hasTask && (
                  <span className="hidden sm:inline font-sans text-[10px] font-medium normal-case tracking-normal text-slate-400">
                    {verificationSummary.isWaitingDeparture
                      ? 'Ketuk cek'
                      : 'Acuan awal'}
                  </span>
                )}
              </span>

              {!verificationSummary.hasTask ? (
                <span className="mt-0.5 font-mono text-xs font-semibold text-slate-400 tabular-nums sm:text-sm">
                  — km
                </span>
              ) : verificationSummary.kmAwalInvalid ? (
                <span className="mt-0.5 text-xs font-semibold text-red-700 sm:text-sm">
                  Angka tidak valid
                </span>
              ) : verificationSummary.kmAwalFormatted ? (
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 font-mono text-sm font-bold text-slate-950 tabular-nums sm:text-base">
                  <span>{verificationSummary.kmAwalFormatted}</span>
                  {verificationSummary.kmAkhirInvalid ? (
                    <span className="font-sans text-[10px] font-semibold text-red-700 sm:text-xs">
                      · Akhir lebih kecil
                    </span>
                  ) : verificationSummary.kmAkhirDeltaText ? (
                    <span className="text-[11px] font-semibold text-emerald-700 sm:text-xs">
                      ({verificationSummary.kmAkhirDeltaText})
                    </span>
                  ) : null}
                </span>
              ) : (
                <span className="mt-0.5 text-xs font-semibold text-amber-800 sm:text-sm">
                  Belum diisi
                </span>
              )}
            </button>

            {/* Column 2: Suhu Awal */}
            <button
              type="button"
              disabled={
                !verificationSummary.hasTask ||
                verificationSummary.coolingType === 'Non Pendingin'
              }
              onClick={() => handleFocusVerificationField('suhu')}
              aria-label="Verifikasi atau ubah input Suhu Awal Keberangkatan"
              className="flex min-h-[46px] flex-col justify-center rounded-r-xl px-3 py-1.5 text-left transition-colors hover:bg-white active:bg-slate-100/80 disabled:cursor-default disabled:hover:bg-transparent sm:min-h-[52px] sm:px-4 sm:py-2"
            >
              <span className="flex items-center justify-between gap-1 text-[10px] font-semibold uppercase tracking-wider text-slate-500 sm:text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <Thermometer className="h-3 w-3 shrink-0 text-sky-700" />
                  <span>Suhu Awal</span>
                </span>
                {verificationSummary.hasTask &&
                  verificationSummary.coolingType !== 'Non Pendingin' && (
                    <span className="hidden sm:inline font-sans text-[10px] font-medium normal-case tracking-normal text-slate-400">
                      {verificationSummary.isWaitingDeparture
                        ? 'Ketuk cek'
                        : 'Acuan awal'}
                    </span>
                  )}
              </span>

              {!verificationSummary.hasTask ? (
                <span className="mt-0.5 font-mono text-xs font-semibold text-slate-400 tabular-nums sm:text-sm">
                  — °C
                </span>
              ) : verificationSummary.coolingType === 'Non Pendingin' ? (
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1 text-xs font-semibold text-slate-700 sm:text-sm">
                  <span>Non Pendingin</span>
                  <span className="hidden md:inline text-[11px] font-normal text-slate-500">
                    · Tanpa suhu
                  </span>
                </span>
              ) : verificationSummary.suhuAwalFormatted ? (
                <span className="mt-0.5 flex flex-wrap items-baseline gap-x-1.5 font-mono text-sm font-bold text-sky-900 tabular-nums sm:text-base">
                  <span>{verificationSummary.suhuAwalFormatted}</span>
                  {verificationSummary.suhuAkhirFormatted && (
                    <span className="text-[11px] font-semibold text-slate-600 sm:text-xs">
                      → {verificationSummary.suhuAkhirFormatted}
                    </span>
                  )}
                </span>
              ) : (
                <span className="mt-0.5 text-xs font-semibold text-amber-800 sm:text-sm">
                  Belum diisi
                </span>
              )}
            </button>
          </div>
        </div>
        </section>
      </div>

      <main className="mx-auto w-full max-w-4xl flex-1 px-3.5 pt-4 pb-24 sm:px-6 sm:py-8">
        {(pendingSyncItems.length > 0 || offlineRecoveryNotice) && (
          <section
            aria-label="Antrean Sinkronisasi Laporan Tertunda"
            className="mb-6 rounded-2xl border border-amber-300/90 bg-amber-50/75 p-4 text-slate-900 sm:p-5"
          >
            {/* Queue Header & Global Retry Control */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs font-semibold">
                  <span className="inline-flex items-center gap-1.5 text-amber-950">
                    <CloudOff className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                    <span>Antrean Sinkronisasi Laporan</span>
                  </span>
                  <span aria-hidden="true" className="text-amber-700">
                    ·
                  </span>
                  <span className="font-mono font-bold text-amber-900 tabular-nums">
                    {pendingSyncItems.length} Laporan Belum Tersinkron
                  </span>
                  <span aria-hidden="true" className="text-amber-700">
                    ·
                  </span>
                  {isBrowserOnline ? (
                    <span className="inline-flex items-center gap-1 text-emerald-800">
                      <Wifi className="h-3.5 w-3.5 shrink-0" />
                      <span>Sinyal Terhubung</span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-900">
                      <WifiOff className="h-3.5 w-3.5 shrink-0" />
                      <span>Luring (Menunggu Sinyal)</span>
                    </span>
                  )}
                </div>

                <p className="text-xs leading-relaxed text-amber-950/90 sm:text-sm">
                  {!isBrowserOnline
                    ? 'Sinyal internet terputus sementara. Seluruh laporan dan foto tersimpan aman di memori HP dan akan dikirim otomatis begitu sinyal pulih.'
                    : offlineRecoveryNotice ||
                      'Laporan berikut tersimpan aman di memori HP dan siap disinkronkan ke Server & Cloud Database.'}
                </p>
              </div>

              {pendingSyncItems.length > 0 && (
                <button
                  type="button"
                  disabled={retryingPendingSync || isSyncing}
                  onClick={async () => {
                    setRetryingPendingSync(true);
                    try {
                      await retryPortalPendingFirestoreSync();
                    } finally {
                      setRetryingPendingSync(false);
                    }
                  }}
                  className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-amber-900 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-amber-800 disabled:opacity-50 whitespace-nowrap shrink-0"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${
                      retryingPendingSync ? 'animate-spin' : ''
                    }`}
                  />
                  {retryingPendingSync
                    ? `Menyinkronkan (${
                        Object.values(itemRetryStatuses).filter(
                          (s) => s.phase === 'retrying'
                        ).length > 0
                          ? 'Aktif'
                          : `${pendingSyncItems.length} Laporan`
                      })...`
                    : pendingSyncItems.length > 1
                    ? `Kirim Ulang Semua (${pendingSyncItems.length})`
                    : 'Kirim Ulang Semua'}
                </button>
              )}
            </div>

            {/* Itemized List of Unsynced Reports with Per-Item Retry Indicators */}
            {pendingSyncItems.length > 0 && (
              <div className="mt-4 divide-y divide-amber-200/80 border-t border-amber-200/90 pt-3">
                {pendingSyncItems.map((item, idx) => {
                  const retryStatus = itemRetryStatuses[item.queueId];
                  const isItemRetrying =
                    Boolean(localRetryingQueueIds[item.queueId]) ||
                    retryStatus?.phase === 'retrying';
                  const hasFailedAttempt =
                    retryStatus?.phase === 'failed' ||
                    (item.attemptCount || 0) >= 1;

                  const stageLabel =
                    item.stage === 'KEBERANGKATAN'
                      ? 'Laporan Keberangkatan'
                      : item.stage === 'DELIVERED'
                      ? 'Konfirmasi Tiba (Delivered)'
                      : 'Bukti Serah Terima (Handover)';

                  const snap = item.assignmentSnapshot;
                  const plateText = snap?.plateNumber || '-';
                  const originText =
                    item.departurePayload?.titikKeberangkatan ||
                    snap?.departureData?.titikKeberangkatan ||
                    (snap?.origin &&
                    snap.origin !== 'Menunggu Titik Keberangkatan Driver'
                      ? snap.origin
                      : '');
                  const destText = snap?.destination || '-';

                  let payloadSummary = '';
                  if (item.stage === 'KEBERANGKATAN') {
                    const km =
                      item.departurePayload?.kmAwal ??
                      snap?.departureData?.kmAwal;
                    const suhu =
                      item.departurePayload?.suhuAwal ||
                      snap?.departureData?.suhuAwal;
                    const parts: string[] = [];
                    if (km !== undefined && km >= 0) {
                      parts.push(`KM Awal ${km.toLocaleString('id-ID')}`);
                    }
                    if (suhu) {
                      parts.push(`Suhu ${suhu}`);
                    }
                    if (item.photosStoredInVault) {
                      parts.push('Foto tersimpan di memori HP');
                    }
                    payloadSummary = parts.join(' · ');
                  } else if (item.stage === 'DELIVERED') {
                    const kmDeliv =
                      item.deliveredPayload?.kmSampai ??
                      snap?.deliveredData?.kmSampai;
                    const suhuDeliv =
                      item.deliveredPayload?.suhuSampai ||
                      snap?.deliveredData?.suhuSampai;
                    const parts: string[] = [];
                    if (kmDeliv !== undefined && kmDeliv >= 0) {
                      parts.push(`KM Sampai ${kmDeliv.toLocaleString('id-ID')}`);
                    }
                    if (suhuDeliv) {
                      parts.push(`Suhu Sampai ${suhuDeliv}`);
                    }
                    if (item.photosStoredInVault) {
                      parts.push('Foto Sampai tersimpan di memori HP');
                    }
                    payloadSummary =
                      parts.join(' · ') ||
                      item.deliveredCatatan ||
                      'Armada tiba di lokasi tujuan';
                  } else {
                    const penerima =
                      item.handoverPayload?.penerimaNama ||
                      snap?.handoverData?.penerimaNama;
                    const kmAkhirVal =
                      item.handoverPayload?.kmAkhir ??
                      snap?.handoverData?.kmAkhir ??
                      snap?.deliveredData?.kmSampai;
                    const parts: string[] = [];
                    if (penerima) parts.push(`Penerima: ${penerima}`);
                    if (kmAkhirVal !== undefined && kmAkhirVal >= 0) {
                      parts.push(
                        `KM Sampai ${kmAkhirVal.toLocaleString('id-ID')}`
                      );
                    }
                    if (item.photosStoredInVault) {
                      parts.push('Bukti & TTD tersimpan di memori HP');
                    }
                    payloadSummary = parts.join(' · ');
                  }

                  const createdTimeStr = item.createdAt
                    ? new Date(item.createdAt).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : '-';
                  const lastAttemptTimeStr = item.updatedAt
                    ? new Date(item.updatedAt).toLocaleTimeString('id-ID', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })
                    : createdTimeStr;

                  const feedbackText = isItemRetrying
                    ? retryStatus?.message ||
                      'Sedang mengirim ulang ke Server & Cloud Database...'
                    : retryStatus?.message ||
                      humanizePendingSyncError(item.lastError, isBrowserOnline);

                  return (
                    <div
                      key={item.queueId}
                      className={`flex flex-col gap-3 py-3.5 first:pt-1 last:pb-0 sm:flex-row sm:items-center sm:justify-between ${
                        idx > 0 ? 'pt-3.5' : ''
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        {/* Primary Identity Row */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:text-sm">
                          <span className="inline-flex items-center gap-1.5 font-bold text-slate-900">
                            {item.stage === 'KEBERANGKATAN' ? (
                              <Navigation className="h-3.5 w-3.5 shrink-0 text-sky-700" />
                            ) : item.stage === 'DELIVERED' ? (
                              <MapPin className="h-3.5 w-3.5 shrink-0 text-amber-700" />
                            ) : (
                              <ClipboardCheck className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                            )}
                            <span>{stageLabel}</span>
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span className="font-mono font-bold text-slate-900 tabular-nums">
                            {item.noPenugasan}
                          </span>
                          <span aria-hidden="true" className="text-slate-400">
                            ·
                          </span>
                          <span className="font-mono font-semibold text-slate-700">
                            {plateText}
                          </span>
                        </div>

                        {/* Route & Captured Cold-Chain Data Summary */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-700">
                          <span className="font-medium text-slate-800">
                            {originText
                              ? `${originText} → ${destText}`
                              : `Tujuan: ${destText}`}
                          </span>
                          {payloadSummary && (
                            <>
                              <span
                                aria-hidden="true"
                                className="text-slate-400"
                              >
                                ·
                              </span>
                              <span className="tabular-nums text-slate-600">
                                {payloadSummary}
                              </span>
                            </>
                          )}
                        </div>

                        {/* Per-Item Live Retry Indicator & Telemetry */}
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 pt-0.5 text-[11px] tabular-nums">
                          {isItemRetrying ? (
                            <span className="inline-flex items-center gap-1.5 font-semibold text-sky-800">
                              <RefreshCw className="h-3 w-3 shrink-0 animate-spin text-sky-700" />
                              <span>{feedbackText}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 font-medium text-amber-900">
                              {!isBrowserOnline ? (
                                <WifiOff className="h-3 w-3 shrink-0 text-amber-700" />
                              ) : hasFailedAttempt ? (
                                <AlertCircle className="h-3 w-3 shrink-0 text-amber-700" />
                              ) : (
                                <Clock className="h-3 w-3 shrink-0 text-amber-700" />
                              )}
                              <span>{feedbackText}</span>
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                          <span>Disimpan {createdTimeStr}</span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Percobaan ke-{Math.max(1, item.attemptCount || 1)} (
                            {lastAttemptTimeStr})
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Server:{' '}
                            <strong
                              className={
                                item.serverSynced
                                  ? 'font-semibold text-emerald-700'
                                  : 'font-semibold text-amber-800'
                              }
                            >
                              {item.serverSynced ? 'Terkirim' : 'Menunggu'}
                            </strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            Cloud:{' '}
                            <strong
                              className={
                                item.firestoreSynced
                                  ? 'font-semibold text-emerald-700'
                                  : 'font-semibold text-amber-800'
                              }
                            >
                              {item.firestoreSynced ? 'Terkirim' : 'Menunggu'}
                            </strong>
                          </span>
                          <span aria-hidden="true">·</span>
                          <span>
                            ID:{' '}
                            {PENDING_REPORT_SYNC_ITEM_PREFIX}
                            {item.assignmentId}
                          </span>
                        </div>
                      </div>

                      {/* Individual Per-Item Retry Button & Indicator */}
                      <div className="flex items-center justify-end gap-2 sm:shrink-0">
                        <button
                          type="button"
                          disabled={isItemRetrying || retryingPendingSync}
                          onClick={() => {
                            void retrySinglePendingItem(item);
                          }}
                          aria-label={`Coba kirim ulang laporan ${item.noPenugasan} tahap ${stageLabel}`}
                          className={`inline-flex min-h-[40px] w-full items-center justify-center gap-1.5 rounded-xl border px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap sm:w-auto ${
                            isItemRetrying
                              ? 'border-sky-300 bg-sky-50 text-sky-900'
                              : 'border-amber-300 bg-white text-amber-950 hover:bg-amber-100/70 disabled:opacity-50'
                          }`}
                        >
                          <RefreshCw
                            className={`h-3.5 w-3.5 shrink-0 ${
                              isItemRetrying
                                ? 'animate-spin text-sky-700'
                                : 'text-amber-800'
                            }`}
                          />
                          <span className="tabular-nums">
                            {isItemRetrying
                              ? 'Mengirim Ulang...'
                              : `Coba Ulang (#${
                                  Math.max(1, item.attemptCount || 1) + 1
                                })`}
                          </span>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        )}

        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:gap-4 sm:pb-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="flex items-center justify-between gap-2">
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-sky-800">
                <Snowflake className="h-3.5 w-3.5" />
                <span>PORTAL OPERASIONAL DRIVER</span>
              </p>
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              Selamat Bertugas, {driver.name}
            </h1>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-slate-500 tabular-nums sm:text-xs">
              <span>ID: {driver.id}</span>
              {driver.phone && (
                <>
                  <span aria-hidden="true">·</span>
                  <span>WA: {driver.phone}</span>
                </>
              )}
              <span aria-hidden="true">·</span>
              <span>{formatRealTimeTimestamp(liveNow)}</span>
              {hasGroupInviteLink && (
                <>
                  <span aria-hidden="true">·</span>
                  <a
                    href={config.whatsappGroupInviteUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 font-sans font-semibold text-emerald-700 hover:underline whitespace-nowrap"
                  >
                    <Users className="h-3.5 w-3.5" />
                    Buka {config.whatsappGroupName || 'Grup WA Operasional'}
                  </a>
                </>
              )}
            </div>
          </div>

          {/* Desktop & Tablet Segmented Tabs (Mobile uses Fixed Bottom Tab Bar) */}
          <div className="hidden sm:flex flex-wrap items-center gap-1 rounded-xl bg-slate-200/75 p-1 self-start">
            <button
              type="button"
              onClick={() => setActiveTab('aktif')}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === 'aktif'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Tugas Aktif ({activeTasks.length})
            </button>
            {hasSuratTugas && (
              <button
                type="button"
                onClick={() => setActiveTab('pengeluaran')}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                  activeTab === 'pengeluaran'
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Receipt className="h-3.5 w-3.5 text-sky-700" />
                Form Input Pengeluaran ({mySubmittedExpenses.length})
              </button>
            )}
            <button
              type="button"
              onClick={() => setActiveTab('riwayat')}
              className={`rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === 'riwayat'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Riwayat Handover ({completedTasks.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('notifikasi_wa')}
              className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 tabular-nums ${
                activeTab === 'notifikasi_wa'
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <BellRing className="h-3.5 w-3.5 text-emerald-700" />
              Notifikasi WA Otomatis ({myNotifications.length})
            </button>
          </div>
        </div>

        {/* Driver Automatic Real-Time WhatsApp Configuration Strip (Compact Accordion on Mobile, Inline on Desktop) */}
        <div className="mt-4 rounded-2xl border border-slate-200/90 bg-white px-4 py-3 shadow-2xs sm:mt-5 sm:py-3.5">
          <div className="flex items-center justify-between gap-2 sm:hidden">
            <button
              type="button"
              onClick={() => setShowMobileWaPrefs((prev) => !prev)}
              className="flex min-h-[36px] flex-1 items-center justify-between gap-2 text-left"
            >
              <span className="flex items-center gap-2 text-xs font-semibold text-slate-800">
                <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                <span>
                  Tujuan WA:{' '}
                  <strong className="text-slate-950">
                    {waTargetMode === 'DRIVER'
                      ? 'WA Driver'
                      : waTargetMode === 'GROUP'
                      ? 'Grup WA'
                      : 'WA Dispatcher'}
                  </strong>{' '}
                  · {autoOpenWa ? 'Otomatis' : 'Manual'}
                </span>
              </span>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                  showMobileWaPrefs ? 'rotate-180' : ''
                }`}
              />
            </button>
          </div>

          <div
            className={`${
              showMobileWaPrefs ? 'mt-3 pt-3 border-t border-slate-100 block' : 'hidden'
            } sm:mt-0 sm:pt-0 sm:border-0 sm:flex sm:items-center sm:justify-between sm:gap-3`}
          >
            <div className="hidden sm:flex items-start gap-2.5">
              <MessageSquareShare className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <div>
                <p className="text-xs font-bold text-slate-900">
                  Notifikasi WhatsApp Otomatis Driver (Waktu Klik Real-Time WIB)
                </p>
                <p className="text-[11px] text-slate-600">
                  Setiap klik pengiriman pesan WhatsApp mengambil waktu saat ini
                  secara real-time beserta Titik Keberangkatan &amp; status armada.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2.5 shrink-0">
              <div className="grid w-full grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 sm:inline-flex sm:w-auto">
                <button
                  type="button"
                  onClick={() => setWaTargetMode('DRIVER')}
                  className={`min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap sm:min-h-0 sm:py-1 ${
                    waTargetMode === 'DRIVER'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  WA Driver
                </button>
                <button
                  type="button"
                  onClick={() => setWaTargetMode('GROUP')}
                  className={`min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap sm:min-h-0 sm:py-1 ${
                    waTargetMode === 'GROUP'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Grup WA
                </button>
                <button
                  type="button"
                  onClick={() => setWaTargetMode('DIRECT')}
                  className={`min-h-[36px] rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors whitespace-nowrap sm:min-h-0 sm:py-1 ${
                    waTargetMode === 'DIRECT'
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Dispatcher
                </button>
              </div>

              <label className="inline-flex min-h-[38px] w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 select-none sm:min-h-0 sm:w-auto">
                <input
                  type="checkbox"
                  checked={autoOpenWa}
                  onChange={(e) => handleToggleAutoOpenWa(e.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-600"
                />
                <span>Buka WA Otomatis Saat Simpan</span>
              </label>
            </div>
          </div>
        </div>

        {/* Real-Time Latest WhatsApp Notification Banner (Departure + Delivered + Handover Summary) */}
        {lastSentWaLog && (
          <div
            ref={waBannerRef}
            className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-5"
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <MessageSquareShare className="mt-0.5 h-5 w-5 shrink-0 text-emerald-700" />
                <div>
                  <h2 className="text-sm font-bold text-emerald-950">
                    Notifikasi WhatsApp Real-Time Siap ({lastSentWaLog.noPenugasan})
                  </h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-emerald-800">
                    Klik tombol di samping untuk mengirim pesan dengan waktu
                    real-time saat ini ({formatRealTimeTimestamp(liveNow)}).
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    handleSendRealtimeNotifWa(lastSentWaLog, 'DRIVER')
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 whitespace-nowrap"
                >
                  <Phone className="h-3.5 w-3.5" />
                  WA Driver
                </button>
                <button
                  type="button"
                  onClick={() =>
                    handleSendRealtimeNotifWa(lastSentWaLog, 'GROUP')
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white shadow-sm transition-colors hover:bg-emerald-700 whitespace-nowrap"
                >
                  <Users className="h-3.5 w-3.5" />
                  Kirim ke Grup WA
                </button>
                {config.dispatcherWaPhone && (
                  <button
                    type="button"
                    onClick={() =>
                      handleSendRealtimeNotifWa(lastSentWaLog, 'DIRECT')
                    }
                    className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 whitespace-nowrap"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    WA Dispatcher
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    handleCopyRealtimeNotifText(
                      lastSentWaLog,
                      'Format laporan WhatsApp'
                    )
                  }
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-white px-3 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-50 whitespace-nowrap"
                >
                  <Copy className="h-3.5 w-3.5" />
                  Salin
                </button>
              </div>
            </div>
            <pre className="mt-3 overflow-x-auto rounded-lg border border-emerald-200/80 bg-white p-3 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
              {stripDriverLinkFromWaMessage(lastSentWaLog.message)}
            </pre>
          </div>
        )}

        {/* ===================================================== */}
        {/* TAB 1: ACTIVE TASKS                                   */}
        {/* ===================================================== */}
        {activeTab === 'aktif' && (
          <div className="mt-6 space-y-5">
            {activeTasks.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center sm:p-10">
                <Truck className="mx-auto h-8 w-8 text-slate-400" />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Belum Ada Surat Tugas Pengiriman Dingin Aktif
                </h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                  Penugasan baru untuk ID Driver{' '}
                  <span className="font-mono font-semibold text-slate-800">
                    {driver.id}
                  </span>{' '}
                  akan tampil otomatis secara real-time di halaman ini.
                </p>

                {canFillExpenseForm && (
                  <div className="mx-auto mt-5 max-w-md border-t border-slate-100 pt-5">
                    <p className="text-xs text-slate-600">
                      Seluruh {relevantCompletedTasks.length} Surat Tugas yang diberikan telah selesai. Silakan isi Form Input Pengeluaran harian Anda.
                    </p>
                    <button
                      type="button"
                      onClick={() => setActiveTab('pengeluaran')}
                      className="mt-3 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-slate-800"
                    >
                      <Receipt className="h-4 w-4 text-sky-400" />
                      Buka Form Input Pengeluaran Harian
                    </button>
                  </div>
                )}
              </div>
            ) : (
              activeTasks.map((task) => {
                const isExpanded = selectedTaskId === task.id;
                const isWaiting = task.status === TaskStatus.MENUNGGU_BERANGKAT;
                const isInTransit = task.status === TaskStatus.DALAM_PERJALANAN;
                const isDelivered = task.status === TaskStatus.DELIVERED;
                const kmSampaiDelta =
                  isInTransit &&
                  task.departureData &&
                  kmSampai !== '' &&
                  Number(kmSampai) >= task.departureData.kmAwal
                    ? Number(kmSampai) - task.departureData.kmAwal
                    : null;

                const isDeparturePendingin =
                  jenisKendaraan === 'Mobil Pendingin';
                const effectiveDeliveredJenis: VehicleCoolingType =
                  task.deliveredData?.jenisKendaraan ||
                  task.departureData?.jenisKendaraan ||
                  deliveredJenisKendaraan;
                const isDeliveredPendingin =
                  effectiveDeliveredJenis !== 'Non Pendingin';
                const displayOrigin =
                  task.departureData?.titikKeberangkatan ||
                  task.origin ||
                  'Menunggu Titik Keberangkatan Driver';
                const sjItems = parseSuratJalanList(task.noSuratJalanFisik);

                return (
                  <article
                    key={task.id}
                    className="rounded-2xl border border-slate-200/90 bg-white p-4 shadow-2xs sm:p-6"
                  >
                    {/* Metadata Line */}
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2 text-slate-600">
                        <span className="font-mono font-bold text-slate-900 tabular-nums">
                          {task.noPenugasan}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {task.tanggalTugas}
                          {task.jadwalJamTiba ? ` (${task.jadwalJamTiba})` : ''}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono font-semibold text-slate-800">
                          {task.plateNumber}
                        </span>
                        {(task.deliveredData?.jenisKendaraan ||
                          task.departureData?.jenisKendaraan) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-semibold text-slate-700">
                              {task.deliveredData?.jenisKendaraan ||
                                task.departureData?.jenisKendaraan}
                            </span>
                          </>
                        )}
                        {sjItems.length > 0 && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {sjItems.length > 1
                                ? `SJ (${sjItems.length}): ${sjItems.join(', ')}`
                                : `SJ: ${sjItems[0]}`}
                            </span>
                          </>
                        )}
                        {task.kodeSegel && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono font-semibold text-sky-800">
                              Segel: {task.kodeSegel}
                            </span>
                          </>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 font-semibold">
                        {isWaiting ? (
                          <span className="inline-flex items-center gap-1.5 text-amber-700">
                            <Clock className="h-3.5 w-3.5" />
                            Menunggu Berangkat
                          </span>
                        ) : isDelivered ? (
                          <span className="inline-flex items-center gap-1.5 text-indigo-700">
                            <PackageCheck className="h-3.5 w-3.5" />
                            Delivered (Siap Berita Acara Handover)
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-sky-700">
                            <Navigation className="h-3.5 w-3.5" />
                            Dalam Perjalanan
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Route & Cargo */}
                    <div className="mt-3.5 flex flex-col gap-3.5 sm:mt-4 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-start gap-2 text-base font-bold text-slate-900 sm:items-center sm:text-lg">
                          <MapPin className="mt-1 h-4 w-4 shrink-0 text-sky-700 sm:mt-0" />
                          <span className="leading-snug">
                            {displayOrigin} → {task.destination}
                          </span>
                        </div>
                        <p className="mt-1 text-xs text-slate-600 sm:text-sm">
                          Muatan:{' '}
                          <span className="font-medium text-slate-900">
                            {task.purpose || 'Pengiriman Logistik'}
                          </span>
                          {task.beratMuatan && (
                            <span className="ml-1.5 font-mono text-xs text-slate-600 tabular-nums">
                              · {task.beratMuatan}
                            </span>
                          )}
                          {task.volumeCbm && (
                            <span className="ml-1.5 font-mono text-xs font-semibold text-sky-800 tabular-nums">
                              · {task.volumeCbm}
                            </span>
                          )}
                        </p>
                        {task.notes && (
                          <p className="mt-1 text-xs text-slate-500">
                            Catatan Dispatcher: {task.notes}
                          </p>
                        )}
                      </div>

                      {!isExpanded && (
                        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center shrink-0">
                          <button
                            type="button"
                            onClick={() => openTaskForm(task)}
                            className="inline-flex min-h-[44px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-semibold text-white transition-colors hover:bg-slate-800 whitespace-nowrap sm:min-h-[40px] sm:w-auto sm:rounded-lg sm:py-2"
                          >
                            {isWaiting ? (
                              <>
                                <Send className="h-3.5 w-3.5" />
                                Isi Data Keberangkatan
                              </>
                            ) : isInTransit ? (
                              <>
                                <PackageCheck className="h-3.5 w-3.5" />
                                Isi Form Delivered (Sampai)
                              </>
                            ) : (
                              <>
                                <ClipboardCheck className="h-3.5 w-3.5" />
                                Isi Berita Acara Serah Terima
                              </>
                            )}
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              handleSendRealtimeTaskWa(task, waTargetMode)
                            }
                            className="inline-flex min-h-[42px] w-full items-center justify-center gap-1.5 rounded-xl border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-900 hover:bg-emerald-100 whitespace-nowrap sm:min-h-[40px] sm:w-auto sm:rounded-lg"
                          >
                            <Phone className="h-3.5 w-3.5 shrink-0" />
                            <span>Kirim WA</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Recorded Departure & Delivered Info */}
                    {!isWaiting && task.departureData && (
                      <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 pt-3 text-xs text-slate-600">
                        <span>
                          Berangkat:{' '}
                          <strong className="font-mono text-slate-800 tabular-nums">
                            {formatRealTimeTimestamp(
                              task.departureData.timestamp
                            )}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Titik Berangkat:{' '}
                          <strong className="text-slate-800">
                            {task.departureData.titikKeberangkatan ||
                              task.origin}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          Jenis Armada:{' '}
                          <strong className="text-slate-800">
                            {task.departureData.jenisKendaraan ||
                              'Mobil Pendingin'}
                          </strong>
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>
                          KM Awal:{' '}
                          <strong className="font-mono text-slate-800 tabular-nums">
                            {task.departureData.kmAwal.toLocaleString('id-ID')}{' '}
                            km
                          </strong>
                        </span>
                        {task.departureData.jenisKendaraan !==
                          'Non Pendingin' &&
                          task.departureData.suhuAwal && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>
                                Suhu Awal:{' '}
                                <strong className="font-mono text-sky-800 tabular-nums">
                                  {task.departureData.suhuAwal}
                                </strong>
                              </span>
                            </>
                          )}
                        {(task.deliveredAt || task.deliveredData?.timestamp) && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              Sampai (Delivered):{' '}
                              <strong className="font-mono text-indigo-800 tabular-nums">
                                {formatRealTimeTimestamp(
                                  task.deliveredData?.timestamp ||
                                    task.deliveredAt ||
                                    ''
                                )}
                              </strong>
                            </span>
                          </>
                        )}
                        {task.deliveredData?.kmSampai !== undefined && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              KM Sampai:{' '}
                              <strong className="font-mono text-indigo-900 tabular-nums">
                                {task.deliveredData.kmSampai.toLocaleString(
                                  'id-ID'
                                )}{' '}
                                km
                              </strong>
                            </span>
                          </>
                        )}
                        {task.deliveredData?.suhuSampai && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>
                              Suhu Sampai:{' '}
                              <strong className="font-mono text-sky-800 tabular-nums">
                                {task.deliveredData.suhuSampai}
                              </strong>
                            </span>
                          </>
                        )}
                      </div>
                    )}

                    {/* ===================================================== */}
                    {/* STAGE 1: FORM KEBERANGKATAN RANTAI PENGIRIMAN DINGIN  */}
                    {/* ===================================================== */}
                    {isExpanded && isWaiting && (
                      <form
                        onSubmit={(e) => handleDirectDepartureSubmit(e, task)}
                        className="mt-5 border-t border-slate-200 pt-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            Formulir Keberangkatan Rantai Pengiriman Dingin
                          </h3>
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                            <Clock className="h-3.5 w-3.5 text-sky-700" />
                            <span>
                              Timestamp Real-Time:{' '}
                              {formatRealTimeTimestamp(liveNow)}
                            </span>
                          </div>
                        </div>

                        {formValidationErr && (
                          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                            {formValidationErr}
                          </div>
                        )}

                        {/* Pilihan Mobil Pendingin / Non Pendingin */}
                        <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3.5">
                          <label className="block text-xs font-semibold text-slate-800">
                            Pilihan Armada Keberangkatan *
                          </label>
                          <p className="mt-0.5 text-[11px] text-slate-500">
                            Pilih Mobil Pendingin untuk menampilkan input suhu
                            &amp; foto monitor pendingin, atau Non Pendingin
                            untuk menyembunyikannya.
                          </p>
                          <div className="mt-2.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <button
                              type="button"
                              onClick={() =>
                                handleSelectDepartureJenisKendaraan(
                                  'Mobil Pendingin'
                                )
                              }
                              className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-semibold transition-colors ${
                                isDeparturePendingin
                                  ? 'border-sky-700 bg-sky-700 text-white shadow-sm'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <Snowflake className="h-4 w-4 shrink-0" />
                              <span>Mobil Pendingin</span>
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                handleSelectDepartureJenisKendaraan(
                                  'Non Pendingin'
                                )
                              }
                              className={`flex items-center justify-center gap-2 rounded-lg border px-4 py-2.5 text-xs font-semibold transition-colors ${
                                !isDeparturePendingin
                                  ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                                  : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
                              }`}
                            >
                              <Truck className="h-4 w-4 shrink-0" />
                              <span>Non Pendingin</span>
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          {/* Kolom Input Titik Keberangkatan Driver */}
                          <div className="sm:col-span-2">
                            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                              <MapPin className="h-3.5 w-3.5 text-slate-700" />
                              <span>Titik Keberangkatan Driver *</span>
                            </label>
                            <input
                              type="text"
                              required
                              value={titikKeberangkatan}
                              onChange={(e) =>
                                setTitikKeberangkatan(e.target.value)
                              }
                              placeholder="Ketik lokasi titik keberangkatan Driver (mis. Gudang Cikarang / Pool Bekasi)"
                              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                            />
                          </div>

                          <div>
                            <label
                              htmlFor="driver-input-km-awal"
                              className="block text-xs font-semibold text-slate-700"
                            >
                              Odometer KM Awal *
                            </label>
                            <input
                              id="driver-input-km-awal"
                              type="number"
                              min={0}
                              required
                              value={kmAwal}
                              onChange={(e) => setKmAwal(e.target.value)}
                              placeholder="Isi angka KM keberangkatan"
                              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                            />
                          </div>

                          {isDeparturePendingin && (
                            <div>
                              <label
                                htmlFor="driver-input-suhu-awal"
                                className="flex items-center gap-1 text-xs font-semibold text-slate-700"
                              >
                                <Thermometer className="h-3.5 w-3.5 text-sky-700" />
                                <span>Suhu Keberangkatan (°C) *</span>
                              </label>
                              <input
                                id="driver-input-suhu-awal"
                                type="text"
                                required
                                value={suhuAwal}
                                onChange={(e) => setSuhuAwal(e.target.value)}
                                placeholder="Ketik suhu monitor pendingin (mis. -18.2°C)"
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-xs font-semibold text-slate-700">
                              Posisi BBM Awal
                            </label>
                            <select
                              value={bbmAwal}
                              onChange={(e) => setBbmAwal(e.target.value)}
                              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                            >
                              <option value="Penuh (Full)">Penuh (Full)</option>
                              <option value="3/4 Tangki">3/4 Tangki</option>
                              <option value="1/2 Tangki">1/2 Tangki</option>
                              <option value="1/4 Tangki">1/4 Tangki</option>
                            </select>
                          </div>

                          <div
                            className={
                              isDeparturePendingin ? '' : 'sm:col-span-2'
                            }
                          >
                            <label className="block text-xs font-semibold text-slate-700">
                              {isDeparturePendingin
                                ? 'Kondisi Unit & Pendingin'
                                : 'Kondisi Unit Kendaraan'}
                            </label>
                            <select
                              value={kondisiKendaraan}
                              onChange={(e) =>
                                setKondisiKendaraan(e.target.value)
                              }
                              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                            >
                              {isDeparturePendingin ? (
                                <>
                                  <option value="Thermo Pendingin Normal">
                                    Thermo Pendingin Normal
                                  </option>
                                  <option value="Pre-Cooling Tercapai & Segel Aman">
                                    Pre-Cooling Tercapai &amp; Segel Aman
                                  </option>
                                  <option value="Catatan Teknis Ringan">
                                    Catatan Teknis Ringan
                                  </option>
                                </>
                              ) : (
                                <>
                                  <option value="Unit Kendaraan Normal & Siap Jalan">
                                    Unit Kendaraan Normal &amp; Siap Jalan
                                  </option>
                                  <option value="Segel & Muatan Aman">
                                    Segel &amp; Muatan Aman
                                  </option>
                                  <option value="Catatan Teknis Ringan">
                                    Catatan Teknis Ringan
                                  </option>
                                </>
                              )}
                            </select>
                          </div>
                        </div>

                        <div
                          className={`grid grid-cols-1 gap-4 ${
                            isDeparturePendingin ? 'sm:grid-cols-2' : ''
                          }`}
                        >
                          <PhotoUploadField
                            label="Foto Odometer Keberangkatan"
                            helperText="Pastikan angka KM terlihat jelas"
                            required
                            value={fotoOdometerBerangkat}
                            onChange={setFotoOdometerBerangkat}
                          />

                          {isDeparturePendingin && (
                            <PhotoUploadField
                              label="Foto Monitor Pendingin Keberangkatan"
                              helperText="Pastikan layar suhu pendingin terbaca jelas"
                              required
                              value={fotoSuhuBerangkat}
                              onChange={setFotoSuhuBerangkat}
                            />
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700">
                            Catatan Keberangkatan (Opsional)
                          </label>
                          <input
                            type="text"
                            value={catatanBerangkat}
                            onChange={(e) =>
                              setCatatanBerangkat(e.target.value)
                            }
                            placeholder={
                              isDeparturePendingin
                                ? 'Misal: Segel terpasang rapat, muatan suhu terjaga aman'
                                : 'Misal: Segel terpasang rapat, muatan siap diberangkatkan'
                            }
                            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                          />
                        </div>

                        {formValidationErr && (
                          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                            <span>{formValidationErr}</span>
                          </div>
                        )}

                        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                              Tujuan WA Otomatis:
                            </span>
                            <div className="inline-flex rounded-lg bg-slate-100 p-1">
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('DRIVER')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'DRIVER'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                WA Driver
                              </button>
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('GROUP')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'GROUP'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                Grup WA
                              </button>
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('DIRECT')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'DIRECT'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                WA Dispatcher
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center sm:justify-end">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={closeTaskForm}
                              className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 disabled:opacity-50 sm:min-h-[40px] sm:rounded-lg"
                            >
                              Batal
                            </button>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap shrink-0 disabled:opacity-50 sm:min-h-[40px] sm:rounded-lg"
                            >
                              <Send className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">
                                {submitting
                                  ? 'Menyimpan...'
                                  : 'Simpan & Kirim WA'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </form>
                    )}

                    {/* ===================================================== */}
                    {/* STAGE 2: FORM INPUT DELIVERED (SAMPAI DI TUJUAN)      */}
                    {/* ===================================================== */}
                    {isExpanded && isInTransit && (
                      <form
                        onSubmit={(e) => handleDirectDeliveredSubmit(e, task)}
                        className="mt-5 border-t border-slate-200 pt-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            Form Input Delivered (Sampai di Tujuan)
                          </h3>
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                            <Clock className="h-3.5 w-3.5 text-indigo-700" />
                            <span>
                              Timestamp Real-Time:{' '}
                              {formatRealTimeTimestamp(liveNow)}
                            </span>
                          </div>
                        </div>

                        {/* Departure Reference & Cooling Mode Sync Box */}
                        <div className="rounded-lg border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700 space-y-1.5">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="font-semibold text-slate-900">
                              Menyesuaikan Keberangkatan:{' '}
                              <span
                                className={
                                  isDeliveredPendingin
                                    ? 'text-sky-800'
                                    : 'text-slate-800'
                                }
                              >
                                {effectiveDeliveredJenis}
                              </span>
                            </p>

                            {!task.departureData?.jenisKendaraan && (
                              <div className="inline-flex rounded-md bg-slate-200/80 p-0.5">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelectDeliveredJenisFallback(
                                      'Mobil Pendingin'
                                    )
                                  }
                                  className={`rounded px-2 py-1 text-[11px] font-semibold ${
                                    isDeliveredPendingin
                                      ? 'bg-white text-slate-900 shadow-sm'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  Mobil Pendingin
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleSelectDeliveredJenisFallback(
                                      'Non Pendingin'
                                    )
                                  }
                                  className={`rounded px-2 py-1 text-[11px] font-semibold ${
                                    !isDeliveredPendingin
                                      ? 'bg-white text-slate-900 shadow-sm'
                                      : 'text-slate-600'
                                  }`}
                                >
                                  Non Pendingin
                                </button>
                              </div>
                            )}
                          </div>

                          {task.departureData && (
                            <p className="font-mono text-[11px] text-slate-600 tabular-nums">
                              Titik Berangkat:{' '}
                              {task.departureData.titikKeberangkatan ||
                                task.origin}{' '}
                              · Waktu:{' '}
                              {formatRealTimeTimestamp(
                                task.departureData.timestamp
                              )}{' '}
                              · KM Awal:{' '}
                              {task.departureData.kmAwal.toLocaleString(
                                'id-ID'
                              )}{' '}
                              km
                              {isDeliveredPendingin &&
                              task.departureData.suhuAwal
                                ? ` · Suhu Awal: ${task.departureData.suhuAwal}`
                                : ''}{' '}
                              · BBM Awal: {task.departureData.bbmAwal}
                            </p>
                          )}
                        </div>

                        {formValidationErr && (
                          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                            {formValidationErr}
                          </div>
                        )}

                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div>
                            <label
                              htmlFor="driver-input-km-sampai"
                              className="block text-xs font-semibold text-slate-700"
                            >
                              Odometer KM Sampai *
                            </label>
                            <input
                              id="driver-input-km-sampai"
                              type="number"
                              min={task.departureData?.kmAwal || 0}
                              required
                              value={kmSampai}
                              onChange={(e) => setKmSampai(e.target.value)}
                              placeholder="Masukkan angka KM saat sampai"
                              className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                            />
                            {kmSampaiDelta !== null && (
                              <p className="mt-1 font-mono text-xs text-emerald-700 tabular-nums">
                                Jarak tempuh:{' '}
                                {kmSampaiDelta.toLocaleString('id-ID')} km
                              </p>
                            )}
                          </div>

                          {isDeliveredPendingin && (
                            <div>
                              <label
                                htmlFor="driver-input-suhu-sampai"
                                className="flex items-center gap-1 text-xs font-semibold text-slate-700"
                              >
                                <Thermometer className="h-3.5 w-3.5 text-sky-700" />
                                <span>Suhu Serah Sampai (°C) *</span>
                              </label>
                              <input
                                id="driver-input-suhu-sampai"
                                type="text"
                                required
                                value={suhuSampai}
                                onChange={(e) => setSuhuSampai(e.target.value)}
                                placeholder="Ketik suhu monitor pendingin saat sampai"
                                className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                              />
                            </div>
                          )}

                          <div>
                            <label className="block text-xs font-semibold text-slate-700">
                              Posisi BBM Sampai *
                            </label>
                            <select
                              required
                              value={bbmSampai}
                              onChange={(e) => setBbmSampai(e.target.value)}
                              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                            >
                              <option value="Penuh (Full)">Penuh (Full)</option>
                              <option value="3/4 Tangki">3/4 Tangki</option>
                              <option value="1/2 Tangki">1/2 Tangki</option>
                              <option value="1/4 Tangki">1/4 Tangki</option>
                              <option value="Cadangan (Reserve)">
                                Cadangan (Reserve)
                              </option>
                            </select>
                          </div>

                          <div
                            className={
                              isDeliveredPendingin ? '' : 'sm:col-span-2'
                            }
                          >
                            <label className="block text-xs font-semibold text-slate-700">
                              Kondisi Muatan &amp; Segel Saat Sampai *
                            </label>
                            <select
                              required
                              value={kondisiSampai}
                              onChange={(e) => setKondisiSampai(e.target.value)}
                              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                            >
                              {isDeliveredPendingin ? (
                                <>
                                  <option value="Suhu & Segel Utuh - Lengkap">
                                    Suhu &amp; Segel Utuh - Lengkap
                                  </option>
                                  <option value="Diterima Baik Sesuai Surat Jalan Fisik">
                                    Diterima Baik Sesuai Surat Jalan Fisik
                                  </option>
                                  <option value="Ada Catatan Selisih / Suhu">
                                    Ada Catatan Selisih / Suhu
                                  </option>
                                </>
                              ) : (
                                <>
                                  <option value="Segel & Muatan Utuh - Lengkap">
                                    Segel &amp; Muatan Utuh - Lengkap
                                  </option>
                                  <option value="Diterima Baik Sesuai Surat Jalan Fisik">
                                    Diterima Baik Sesuai Surat Jalan Fisik
                                  </option>
                                  <option value="Ada Catatan Selisih / Kerusakan">
                                    Ada Catatan Selisih / Kerusakan
                                  </option>
                                </>
                              )}
                            </select>
                          </div>
                        </div>

                        <div
                          className={`grid grid-cols-1 gap-4 ${
                            isDeliveredPendingin ? 'sm:grid-cols-2' : ''
                          }`}
                        >
                          <PhotoUploadField
                            label="Foto Odometer Sampai"
                            helperText="Pastikan angka KM saat sampai terlihat jelas"
                            required
                            value={fotoOdometerSampai}
                            onChange={setFotoOdometerSampai}
                          />

                          {isDeliveredPendingin && (
                            <PhotoUploadField
                              label="Foto Monitor Pendingin Sampai"
                              helperText="Pastikan layar suhu pendingin saat sampai terbaca jelas"
                              required
                              value={fotoSuhuSampai}
                              onChange={setFotoSuhuSampai}
                            />
                          )}
                        </div>

                        <div>
                          <label className="block text-xs font-semibold text-slate-700">
                            Catatan Sampai (Opsional)
                          </label>
                          <input
                            type="text"
                            value={catatanSampai}
                            onChange={(e) => setCatatanSampai(e.target.value)}
                            placeholder="Misal: Armada telah tiba di area bongkar / antre loading dock"
                            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                          />
                        </div>

                        {formValidationErr && (
                          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                            <span>{formValidationErr}</span>
                          </div>
                        )}

                        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                              Tujuan WA Otomatis:
                            </span>
                            <div className="inline-flex rounded-lg bg-slate-100 p-1">
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('DRIVER')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'DRIVER'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                WA Driver
                              </button>
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('GROUP')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'GROUP'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                Grup WA
                              </button>
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('DIRECT')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'DIRECT'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                WA Dispatcher
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center sm:justify-end">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={closeTaskForm}
                              className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 disabled:opacity-50 sm:min-h-[40px] sm:rounded-lg"
                            >
                              Batal
                            </button>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-indigo-700 px-4 py-2 text-xs font-semibold text-white hover:bg-indigo-800 whitespace-nowrap shrink-0 disabled:opacity-50 sm:min-h-[40px] sm:rounded-lg"
                            >
                              <PackageCheck className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">
                                {submitting
                                  ? 'Menyimpan...'
                                  : 'Simpan Delivered & Kirim WA'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </form>
                    )}

                    {/* ===================================================== */}
                    {/* STAGE 3: FORM SELESAI HANDOVER (BERITA ACARA)         */}
                    {/* ===================================================== */}
                    {isExpanded && isDelivered && (
                      <form
                        onSubmit={(e) => handleDirectHandoverSubmit(e, task)}
                        className="mt-5 border-t border-slate-200 pt-5 space-y-4"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            Formulir Berita Acara Serah Terima (Selesai Handover)
                          </h3>
                          <div className="inline-flex items-center gap-1.5 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                            <Clock className="h-3.5 w-3.5 text-emerald-700" />
                            <span>
                              Timestamp Real-Time:{' '}
                              {formatRealTimeTimestamp(liveNow)}
                            </span>
                          </div>
                        </div>

                        {/* Read-Only Summary of Recorded Delivered (Sampai) Data */}
                        <div className="rounded-lg border border-indigo-200/80 bg-indigo-50/50 px-3.5 py-2.5 text-xs text-slate-700 space-y-1">
                          <p className="font-semibold text-slate-900">
                            Ringkasan Data Delivered (Sampai) Tercatat
                          </p>
                          <p className="font-mono text-[11px] text-slate-600 tabular-nums">
                            Waktu Sampai:{' '}
                            {formatRealTimeTimestamp(
                              task.deliveredData?.timestamp ||
                                task.deliveredAt ||
                                ''
                            )}
                            {task.deliveredData?.kmSampai !== undefined
                              ? ` · KM Sampai: ${task.deliveredData.kmSampai.toLocaleString(
                                  'id-ID'
                                )} km`
                              : ''}
                            {isDeliveredPendingin &&
                            task.deliveredData?.suhuSampai
                              ? ` · Suhu Sampai: ${task.deliveredData.suhuSampai}`
                              : ''}
                            {task.deliveredData?.bbmSampai
                              ? ` · BBM Sampai: ${task.deliveredData.bbmSampai}`
                              : ''}
                            {task.deliveredData?.kondisiSampai
                              ? ` · Kondisi: ${task.deliveredData.kondisiSampai}`
                              : ''}
                          </p>
                        </div>

                        {formValidationErr && (
                          <div className="rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                            {formValidationErr}
                          </div>
                        )}

                        <div>
                          <label
                            htmlFor="driver-input-penerima-nama"
                            className="block text-xs font-semibold text-slate-700"
                          >
                            Nama Penerima Serah Terima *
                          </label>
                          <input
                            id="driver-input-penerima-nama"
                            type="text"
                            required
                            value={penerimaNama}
                            onChange={(e) => setPenerimaNama(e.target.value)}
                            placeholder="Nama lengkap petugas penerima di lokasi tujuan"
                            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                          />
                        </div>

                        <PhotoUploadField
                          label="Foto Bukti Serah Terima"
                          helperText="Unggah foto bukti serah terima barang / surat jalan bertanda tangan"
                          required
                          value={fotoBuktiSerahTerima}
                          onChange={setFotoBuktiSerahTerima}
                        />

                        <SignatureCanvas
                          label="Canvas Tanda Tangan Penerima"
                          required
                          value={tandaTanganPenerima}
                          onChange={setTandaTanganPenerima}
                        />

                        <div>
                          <label className="block text-xs font-semibold text-slate-700">
                            Catatan Serah Terima (Opsional)
                          </label>
                          <input
                            type="text"
                            value={catatanSerahTerima}
                            onChange={(e) =>
                              setCatatanSerahTerima(e.target.value)
                            }
                            placeholder="Misal: Diserahterimakan lengkap di loading dock tujuan"
                            className="mt-1.5 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                          />
                        </div>

                        {formValidationErr && (
                          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-medium text-red-700">
                            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                            <span>{formValidationErr}</span>
                          </div>
                        )}

                        <div className="flex flex-col gap-3 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-xs font-medium text-slate-600 whitespace-nowrap">
                              Tujuan WA Otomatis:
                            </span>
                            <div className="inline-flex rounded-lg bg-slate-100 p-1">
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('DRIVER')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'DRIVER'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                WA Driver
                              </button>
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('GROUP')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'GROUP'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                Grup WA
                              </button>
                              <button
                                type="button"
                                onClick={() => setWaTargetMode('DIRECT')}
                                className={`rounded-md px-2.5 py-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                                  waTargetMode === 'DIRECT'
                                    ? 'bg-white text-slate-900 shadow-sm'
                                    : 'text-slate-600 hover:text-slate-900'
                                }`}
                              >
                                WA Dispatcher
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 gap-2.5 sm:flex sm:items-center sm:justify-end">
                            <button
                              type="button"
                              disabled={submitting}
                              onClick={closeTaskForm}
                              className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 whitespace-nowrap shrink-0 disabled:opacity-50 sm:min-h-[40px] sm:rounded-lg"
                            >
                              Batal
                            </button>
                            <button
                              type="submit"
                              disabled={submitting}
                              className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap shrink-0 disabled:opacity-50 sm:min-h-[40px] sm:rounded-lg"
                            >
                              <ClipboardCheck className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">
                                {submitting
                                  ? 'Menyimpan...'
                                  : 'Selesai Handover'}
                              </span>
                            </button>
                          </div>
                        </div>
                      </form>
                    )}
                  </article>
                );
              })
            )}
          </div>
        )}

        {/* ===================================================== */}
        {/* TAB 2: COMPLETED HANDOVER HISTORY                     */}
        {/* ===================================================== */}
        {activeTab === 'riwayat' && (
          <div className="mt-6 space-y-4">
            {completedTasks.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <CheckCircle2 className="mx-auto h-8 w-8 text-slate-400" />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Belum Ada Riwayat Handover Selesai
                </h2>
                <p className="mt-1 text-sm text-slate-600">
                  Pengiriman yang telah selesai serah terima akan tercatat
                  secara real-time di sini.
                </p>
              </div>
            ) : (
              completedTasks.map((task) => {
                const startKm = task.departureData?.kmAwal ?? 0;
                const endKm =
                  task.deliveredData?.kmSampai ??
                  task.handoverData?.kmAkhir ??
                  0;
                const totalKm =
                  endKm >= startKm && startKm > 0 ? endKm - startKm : 0;
                const jenisArmada =
                  task.deliveredData?.jenisKendaraan ||
                  task.departureData?.jenisKendaraan ||
                  'Mobil Pendingin';
                const isPendingin = jenisArmada !== 'Non Pendingin';
                const displayOrigin =
                  task.departureData?.titikKeberangkatan || task.origin;
                const suhuSampaiVal =
                  task.deliveredData?.suhuSampai ||
                  task.handoverData?.suhuAkhir ||
                  '-';

                return (
                  <div
                    key={task.id}
                    className="rounded-xl border border-slate-200 bg-white p-5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2 text-slate-600">
                        <span className="font-mono font-semibold text-slate-900 tabular-nums">
                          {task.noPenugasan}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono tabular-nums">
                          {task.tanggalTugas}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="font-mono">{task.plateNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-slate-700">
                          {jenisArmada}
                        </span>
                        {task.noSuratJalanFisik && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {(() => {
                                const historySj = parseSuratJalanList(
                                  task.noSuratJalanFisik
                                );
                                return historySj.length > 1
                                  ? `SJ (${historySj.length}): ${historySj.join(', ')}`
                                  : `SJ: ${historySj[0] || task.noSuratJalanFisik}`;
                              })()}
                            </span>
                          </>
                        )}
                        {task.kodeSegel && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono">
                              Segel: {task.kodeSegel}
                            </span>
                          </>
                        )}
                      </div>
                      <span className="inline-flex items-center gap-1.5 font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        {task.status}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-base font-bold text-slate-900">
                          {displayOrigin} → {task.destination}
                        </p>
                        {(task.beratMuatan || task.volumeCbm) && (
                          <p className="mt-0.5 font-mono text-xs text-slate-600 tabular-nums">
                            {[task.beratMuatan, task.volumeCbm]
                              .filter(Boolean)
                              .join(' · ')}
                          </p>
                        )}
                        <div className="mt-1.5 space-y-1 text-xs text-slate-600">
                          <p className="font-mono tabular-nums">
                            <span className="font-sans font-semibold text-slate-700">
                              Keberangkatan:
                            </span>{' '}
                            {task.departureData
                              ? `${formatRealTimeTimestamp(
                                  task.departureData.timestamp
                                )} · KM Awal ${startKm.toLocaleString(
                                  'id-ID'
                                )}${
                                  isPendingin
                                    ? ` · Suhu ${
                                        task.departureData.suhuAwal || '-'
                                      }`
                                    : ' · Non Pendingin'
                                }`
                              : '-'}
                          </p>
                          <p className="font-mono tabular-nums">
                            <span className="font-sans font-semibold text-slate-700">
                              Delivered (Sampai):
                            </span>{' '}
                            {task.deliveredData || task.deliveredAt
                              ? `${formatRealTimeTimestamp(
                                  task.deliveredData?.timestamp ||
                                    task.deliveredAt ||
                                    ''
                                )} · KM Sampai ${endKm.toLocaleString(
                                  'id-ID'
                                )} (${totalKm.toLocaleString('id-ID')} km)${
                                  isPendingin ? ` · Suhu ${suhuSampaiVal}` : ''
                                }`
                              : '-'}
                          </p>
                          <p className="font-mono tabular-nums">
                            <span className="font-sans font-semibold text-slate-700">
                              Berita Acara Handover:
                            </span>{' '}
                            {task.handoverData
                              ? `${formatRealTimeTimestamp(
                                  task.handoverData.timestamp
                                )} · Penerima: ${
                                  task.handoverData.penerimaNama || '-'
                                }`
                              : '-'}
                          </p>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 self-start sm:self-center shrink-0">
                        <button
                          type="button"
                          onClick={() =>
                            handleSendRealtimeTaskWa(task, 'DRIVER')
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-700 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-800 whitespace-nowrap"
                        >
                          <Phone className="h-3.5 w-3.5" />
                          WA Driver
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleSendRealtimeTaskWa(task, 'GROUP')
                          }
                          className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-700 whitespace-nowrap"
                        >
                          <Users className="h-3.5 w-3.5" />
                          Grup WA
                        </button>
                        {config.dispatcherWaPhone && (
                          <button
                            type="button"
                            onClick={() =>
                              handleSendRealtimeTaskWa(task, 'DIRECT')
                            }
                            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                            WA Dispatcher
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        )}

        {/* ===================================================== */}
        {/* TAB 3: AUTOMATIC REAL-TIME WHATSAPP NOTIFICATIONS     */}
        {/* ===================================================== */}
        {activeTab === 'notifikasi_wa' && (
          <div className="mt-6 space-y-4">
            {myNotifications.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-10 text-center">
                <BellRing className="mx-auto h-8 w-8 text-slate-400" />
                <h2 className="mt-3 text-base font-semibold text-slate-900">
                  Belum Ada Riwayat Notifikasi WhatsApp Otomatis
                </h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-slate-600">
                  Setiap notifikasi otomatis Surat Tugas, Data Keberangkatan,
                  Delivered, dan Data Serah Terima untuk Driver {driver.name}{' '}
                  akan tampil secara real-time di sini.
                </p>
              </div>
            ) : (
              myNotifications.map((notif) => (
                <div
                  key={notif.id}
                  className="rounded-xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex flex-wrap items-center gap-2 text-slate-600">
                      <span className="font-semibold text-slate-900">
                        {notif.eventType === 'SURAT_TUGAS'
                          ? 'Surat Tugas Baru'
                          : notif.eventType === 'KEBERANGKATAN'
                          ? 'Laporan Data Keberangkatan'
                          : notif.eventType === 'DELIVERED'
                          ? 'Konfirmasi Tiba (Delivered)'
                          : 'Laporan Data Serah Terima (Handover)'}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono font-semibold text-slate-800 tabular-nums">
                        {notif.noPenugasan}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono">{notif.plateNumber}</span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-slate-500 tabular-nums">
                        {formatRealTimeTimestamp(notif.timestamp)}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleSendRealtimeNotifWa(notif, 'DRIVER')
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-700 px-2.5 py-1 font-semibold text-white hover:bg-emerald-800"
                      >
                        <Phone className="h-3 w-3" />
                        WA Driver
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleSendRealtimeNotifWa(notif, 'GROUP')
                        }
                        className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 font-semibold text-white hover:bg-emerald-700"
                      >
                        <Users className="h-3 w-3" />
                        Grup WA
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopyRealtimeNotifText(
                            notif,
                            'Notifikasi WhatsApp Driver'
                          )
                        }
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1 font-semibold text-slate-700 hover:bg-slate-50"
                      >
                        <Copy className="h-3 w-3" />
                        Salin
                      </button>
                    </div>
                  </div>

                  <pre className="mt-3 overflow-x-auto rounded-xl border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
                    {stripDriverLinkFromWaMessage(notif.message)}
                  </pre>
                </div>
              ))
            )}
          </div>
        )}
        {/* ===================================================== */}
        {/* TAB: FORM INPUT PENGELUARAN (Sheet: Pengeluaran_Driver) */}
        {/* ===================================================== */}
        {activeTab === 'pengeluaran' && hasSuratTugas && (
          <div className="mt-6 space-y-6">
            {!canFillExpenseForm ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-700" />
                  <div className="min-w-0 flex-1">
                    <h2 className="text-sm font-bold text-slate-900 sm:text-base">
                      Selesaikan Semua Surat Tugas yang Diberikan Terlebih Dahulu
                    </h2>
                    <p className="mt-1 text-xs leading-relaxed text-slate-700 sm:text-sm">
                      Form Input Pengeluaran baru dapat diisi setelah seluruh Surat Tugas yang diberikan kepada Anda selesai diserahterimakan (Handover) untuk tercatat pada Sheet{' '}
                      <span className="font-mono font-semibold">
                        Pengeluaran_Driver
                      </span>
                      . Saat ini masih terdapat{' '}
                      <strong className="font-mono tabular-nums">
                        {activeTasks.length}
                      </strong>{' '}
                      Surat Tugas aktif yang belum diselesaikan:
                    </p>

                    <div className="mt-4 divide-y divide-amber-200/70 rounded-xl border border-amber-200/90 bg-white px-4 py-1">
                      {activeTasks.map((t) => (
                        <div
                          key={t.id}
                          className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-xs"
                        >
                          <div className="flex flex-wrap items-center gap-2 text-slate-700">
                            <span className="font-mono font-bold text-slate-900 tabular-nums">
                              {t.noPenugasan}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono font-semibold text-slate-800">
                              {t.plateNumber}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{t.destination}</span>
                          </div>
                          <span className="font-semibold text-amber-800">
                            {t.status}
                          </span>
                        </div>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => setActiveTab('aktif')}
                      className="mt-4 inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-slate-800"
                    >
                      <Truck className="h-4 w-4" />
                      Kembali &amp; Selesaikan Tugas Aktif ({activeTasks.length})
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs sm:p-6">
                <div className="flex flex-col gap-2 border-b border-slate-100 pb-4 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                      Form Input Pengeluaran
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-600">
                      Laporan pengeluaran harian Driver ke Sheet{' '}
                      <span className="font-mono font-semibold text-slate-800">
                        Pengeluaran_Driver
                      </span>{' '}
                      setelah seluruh Surat Tugas hari ini selesai.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                    <span>Driver:</span>
                    <span className="font-semibold text-slate-900">
                      {driver.name}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono text-slate-700 tabular-nums">
                      {driver.id}
                    </span>
                    {completedTodayTasks.length > 0 && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="font-semibold text-emerald-700 tabular-nums">
                          {completedTodayTasks.length} Tugas Selesai Hari Ini
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <form onSubmit={handleExpenseSubmit} className="mt-5 space-y-5">
                  {expenseValidationErr && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                      <span>{expenseValidationErr}</span>
                    </div>
                  )}

                  {/* 1. Timestamp Otomatis */}
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3.5">
                    <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                        <Clock className="h-4 w-4 text-sky-700" />
                        <span>
                          Timestamp Otomatis (Saat Menekan Selesai dan Laporkan)
                        </span>
                      </div>
                      <span className="font-mono text-sm font-bold text-slate-950 tabular-nums">
                        {formatRealTimeTimestamp(liveNow)}
                      </span>
                    </div>
                    <p className="mt-1 text-[11px] text-slate-500">
                      Waktu real-time WIB akan dikunci otomatis tepat ketika Anda
                      menekan tombol &ldquo;Selesai dan Laporkan&rdquo;.
                    </p>
                  </div>

                  {/* 2. Nomor Kartu Fleet Card (Dropdown Master) & Armada */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="driver-expense-fleet-card"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Nomor Kartu Fleet Card yang Digunakan{' '}
                        <span className="text-rose-600">*</span>
                      </label>
                      <select
                        id="driver-expense-fleet-card"
                        required
                        disabled={fleetCards.length === 0}
                        value={selectedFleetCardId}
                        onChange={(e) => {
                          setSelectedFleetCardId(e.target.value);
                          setExpenseValidationErr('');
                        }}
                        className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm font-medium text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-500"
                      >
                        <option value="">
                          {fleetCards.length === 0
                            ? '-- Belum Ada Master Kartu Fleet Card --'
                            : '-- Pilih Nomor Kartu Fleet Card --'}
                        </option>
                        {fleetCards.map((fc) => (
                          <option key={fc.id} value={fc.id}>
                            {fc.cardNumber} — {fc.id} (Saldo:{' '}
                            {formatIdrCurrency(fc.balance)})
                          </option>
                        ))}
                      </select>

                      {fleetCards.length === 0 ? (
                        <p className="mt-1.5 text-[11px] text-amber-700">
                          Daftar kartu bersumber dari Master Kartu Fleet Card.
                          Minta Admin Dispatcher menambahkan kartu terlebih dahulu.
                        </p>
                      ) : activeSelectedFleetCard ? (
                        <p className="mt-1.5 text-[11px] text-slate-600">
                          ID Kartu:{' '}
                          <span className="font-mono font-semibold text-slate-800">
                            {activeSelectedFleetCard.id}
                          </span>{' '}
                          · Saldo Tersedia:{' '}
                          <span className="font-mono font-semibold text-emerald-700 tabular-nums">
                            {formatIdrCurrency(activeSelectedFleetCard.balance)}
                          </span>
                        </p>
                      ) : null}
                    </div>

                    <div>
                      <label
                        htmlFor="driver-expense-plate"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Nomor Polisi Armada (Opsional)
                      </label>
                      {vehicles.length > 0 ? (
                        <select
                          id="driver-expense-plate"
                          value={expensePlateNumber}
                          onChange={(e) => setExpensePlateNumber(e.target.value)}
                          className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                        >
                          <option value="">-- Pilih Unit Armada --</option>
                          {vehicles.map((v) => (
                            <option key={v.id} value={v.plateNumber}>
                              {v.plateNumber} ({v.vehicleType})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          id="driver-expense-plate"
                          type="text"
                          value={expensePlateNumber}
                          onChange={(e) => setExpensePlateNumber(e.target.value)}
                          placeholder="Contoh: B 9123 CRK"
                          className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                        />
                      )}
                      {completedTodayTasks.length > 0 && (
                        <p className="mt-1.5 truncate text-[11px] text-slate-600">
                          Surat Tugas Selesai Hari Ini:{' '}
                          <span className="font-mono font-semibold text-slate-800">
                            {completedTodayTasks
                              .map((t) => t.noPenugasan)
                              .join(', ')}
                          </span>
                        </p>
                      )}
                    </div>
                  </div>

                  {/* 3. Tanggal Pengiriman & Tujuan Pengiriman */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="driver-expense-tanggal-pengiriman"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Tanggal Pengiriman{' '}
                        <span className="text-rose-600">*</span>
                      </label>
                      <input
                        id="driver-expense-tanggal-pengiriman"
                        type="date"
                        required
                        value={expenseTanggalPengiriman}
                        onChange={(e) => {
                          setExpenseTanggalPengiriman(e.target.value);
                          setExpenseValidationErr('');
                        }}
                        className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 font-mono text-sm text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label
                        htmlFor="driver-expense-tujuan-pengiriman"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Tujuan Pengiriman{' '}
                        <span className="text-rose-600">*</span>
                      </label>
                      {destinationQuickOptions.length > 0 && (
                        <select
                          aria-label="Pilih cepat Tujuan Pengiriman dari Master Rute atau Tugas Hari Ini"
                          value={
                            destinationQuickOptions.includes(
                              expenseTujuanPengiriman.trim()
                            )
                              ? expenseTujuanPengiriman.trim()
                              : ''
                          }
                          onChange={(e) => {
                            if (!e.target.value) return;
                            setTujuanManuallyEdited(true);
                            setExpenseTujuanPengiriman(e.target.value);
                            setExpenseValidationErr('');
                          }}
                          className="mt-1.5 w-full min-h-[42px] rounded-xl border border-slate-300 bg-slate-50 px-3.5 py-2 text-xs font-semibold text-slate-800 focus:border-slate-900 focus:outline-none"
                        >
                          <option value="">
                            -- Pilih Cepat dari Rute / Tujuan Tugas --
                          </option>
                          {destinationQuickOptions.map((dest) => (
                            <option key={dest} value={dest}>
                              {dest}
                            </option>
                          ))}
                        </select>
                      )}
                      <input
                        id="driver-expense-tujuan-pengiriman"
                        type="text"
                        required
                        maxLength={240}
                        value={expenseTujuanPengiriman}
                        onChange={(e) => {
                          setTujuanManuallyEdited(true);
                          setExpenseTujuanPengiriman(e.target.value);
                          setExpenseValidationErr('');
                        }}
                        placeholder="Contoh: DC Cikarang, Gudang Bekasi"
                        className={`${
                          destinationQuickOptions.length > 0 ? 'mt-2' : 'mt-1.5'
                        } w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none`}
                      />
                    </div>
                  </div>

                  {/* 4 & 5. Total Pembelian BBM + Foto Struk Pengeluaran BBM */}
                  <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="driver-expense-bbm"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Total Pembelian BBM (Rp){' '}
                        <span className="text-rose-600">*</span>
                      </label>
                      <div className="relative mt-1.5">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 font-mono text-xs font-bold text-slate-500">
                          Rp
                        </span>
                        <input
                          id="driver-expense-bbm"
                          type="text"
                          inputMode="numeric"
                          value={totalPengirimanBbmInput}
                          onChange={(e) => {
                            const cleaned = e.target.value.replace(/[^\d.]/g, '');
                            setTotalPengirimanBbmInput(cleaned);
                            setExpenseValidationErr('');
                          }}
                          placeholder="0"
                          className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white py-2.5 pr-3.5 pl-10 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <p className="mt-1.5 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                        Nominal Terbaca: {formatIdrCurrency(parsedBbmNominal)}
                      </p>
                    </div>

                    <div>
                      <PhotoUploadField
                        label="Foto Struk Pengeluaran BBM"
                        helperText="Ambil foto struk SPBU / bukti transaksi BBM yang jelas"
                        value={fotoStrukBbm}
                        onChange={(val) => {
                          setFotoStrukBbm(val);
                          setExpenseValidationErr('');
                        }}
                      />
                    </div>
                  </div>

                  {/* 5 & 6. Total Pengeluaran Tol + Foto Struk Pengeluaran Tol */}
                  <div className="grid grid-cols-1 gap-4 rounded-2xl border border-slate-200 bg-slate-50/60 p-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="driver-expense-tol"
                        className="block text-xs font-bold text-slate-800"
                      >
                        Total Pengeluaran Tol (Rp){' '}
                        <span className="text-rose-600">*</span>
                      </label>
                      <div className="relative mt-1.5">
                        <span className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 font-mono text-xs font-bold text-slate-500">
                          Rp
                        </span>
                        <input
                          id="driver-expense-tol"
                          type="text"
                          inputMode="numeric"
                          value={totalPengeluaranTolInput}
                          onChange={(e) => {
                            const cleaned = e.target.value.replace(/[^\d.]/g, '');
                            setTotalPengeluaranTolInput(cleaned);
                            setExpenseValidationErr('');
                          }}
                          placeholder="0"
                          className="w-full min-h-[44px] rounded-xl border border-slate-300 bg-white py-2.5 pr-3.5 pl-10 font-mono text-sm font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
                        />
                      </div>
                      <p className="mt-1.5 font-mono text-xs font-semibold text-slate-700 tabular-nums">
                        Nominal Terbaca: {formatIdrCurrency(parsedTolNominal)}
                      </p>
                    </div>

                    <div>
                      <PhotoUploadField
                        label="Foto Struk Pengeluaran Tol"
                        helperText="Ambil foto struk gerbang tol / rincian pemakaian tol"
                        value={fotoStrukTol}
                        onChange={(val) => {
                          setFotoStrukTol(val);
                          setExpenseValidationErr('');
                        }}
                      />
                    </div>
                  </div>

                  {/* Catatan Tambahan */}
                  <div>
                    <label
                      htmlFor="driver-expense-notes"
                      className="block text-xs font-bold text-slate-800"
                    >
                      Catatan Pengeluaran Harian (Opsional)
                    </label>
                    <input
                      id="driver-expense-notes"
                      type="text"
                      value={catatanPengeluaran}
                      onChange={(e) => setCatatanPengeluaran(e.target.value)}
                      placeholder="Contoh: Pengisian Solar Dex SPBU Rest Area KM 57 & Tol Dalam Kota"
                      className="mt-1.5 w-full min-h-[44px] rounded-xl border border-slate-300 bg-white px-3.5 py-2.5 text-sm text-slate-900 focus:border-slate-900 focus:outline-none"
                    />
                  </div>

                  {/* Kalkulasi Ringkas Sebelum Submit */}
                  <div className="rounded-2xl border border-slate-200 bg-slate-900 p-4 text-white sm:p-5">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                      <div>
                        <p className="text-[11px] text-slate-300">
                          Total Pembelian BBM
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-bold tabular-nums">
                          {formatIdrCurrency(parsedBbmNominal)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-300">
                          Total Pengeluaran Tol
                        </p>
                        <p className="mt-0.5 font-mono text-sm font-bold tabular-nums">
                          {formatIdrCurrency(parsedTolNominal)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-sky-300">
                          Total Pengeluaran Dilaporkan
                        </p>
                        <p className="mt-0.5 font-mono text-base font-bold text-white tabular-nums">
                          {formatIdrCurrency(parsedTotalPengeluaran)}
                        </p>
                      </div>
                    </div>

                    {activeSelectedFleetCard && (
                      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-800 pt-3 text-xs text-slate-300">
                        <span>
                          Kartu:{' '}
                          <strong className="font-mono text-white">
                            {activeSelectedFleetCard.cardNumber}
                          </strong>
                        </span>
                        <span>
                          Estimasi Sisa Saldo:{' '}
                          <strong className="font-mono text-emerald-400 tabular-nums">
                            {formatIdrCurrency(
                              activeSelectedFleetCard.balance -
                                parsedTotalPengeluaran
                            )}
                          </strong>
                        </span>
                      </div>
                    )}
                  </div>

                  {expenseValidationErr && (
                    <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-xs font-medium text-rose-800">
                      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
                      <span>{expenseValidationErr}</span>
                    </div>
                  )}

                  <button
                    type="submit"
                    disabled={submittingExpense}
                    className="inline-flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-5 py-3 text-sm font-bold text-white shadow-sm transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {submittingExpense ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Menyimpan ke Pengeluaran_Driver...
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" />
                        Selesai dan Laporkan
                      </>
                    )}
                  </button>
                </form>
              </section>
            )}

            {/* Riwayat Pengeluaran Harian Saya */}
            <section className="rounded-2xl border border-slate-200/90 bg-white p-5 shadow-2xs sm:p-6">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 sm:text-base">
                    Riwayat Laporan Pengeluaran Saya ({mySubmittedExpenses.length})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Tersinkron otomatis dengan Dasbord Admin &amp; Sheet{' '}
                    <span className="font-mono">Pengeluaran_Driver</span>
                  </p>
                </div>
              </div>

              {mySubmittedExpenses.length === 0 ? (
                <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-6 text-center text-xs text-slate-500">
                  Belum ada laporan pengeluaran BBM &amp; Tol yang dikirimkan
                  oleh ID Driver{' '}
                  <span className="font-mono font-semibold text-slate-700">
                    {driver.id}
                  </span>
                  .
                </div>
              ) : (
                <div className="mt-4 divide-y divide-slate-100">
                  {mySubmittedExpenses.map((exp) => {
                    const bbmReceiptSrc =
                      exp.fotoStrukBbm || exp.fotoStrukBbmUrl || '';
                    const tolReceiptSrc =
                      exp.fotoStrukTol || exp.fotoStrukTolUrl || '';
                    return (
                      <div
                        key={exp.id}
                        className="flex flex-col gap-3 py-4 first:pt-1 last:pb-1 sm:flex-row sm:items-center sm:justify-between"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                            <span className="font-mono font-bold text-slate-900 tabular-nums">
                              {exp.id}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono tabular-nums">
                              {formatRealTimeTimestamp(
                                exp.timestamp || exp.tanggal
                              )}
                            </span>
                            {exp.plateNumber && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono font-semibold text-slate-800">
                                  {exp.plateNumber}
                                </span>
                              </>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-700">
                            <CreditCard className="h-3.5 w-3.5 text-sky-700" />
                            <span>Nomor Kartu Fleet Card:</span>
                            <span className="font-mono font-bold text-slate-900 tabular-nums">
                              {exp.fleetCardNumber}
                            </span>
                            {exp.fleetCardId && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="font-mono text-slate-500">
                                  {exp.fleetCardId}
                                </span>
                              </>
                            )}
                          </div>

                          {(exp.tanggalPengiriman || exp.tujuanPengiriman) && (
                            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
                              <span>
                                Tgl Pengiriman:{' '}
                                <strong className="font-mono text-slate-900 tabular-nums">
                                  {exp.tanggalPengiriman || exp.tanggal}
                                </strong>
                              </span>
                              {exp.tujuanPengiriman && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>
                                    Tujuan:{' '}
                                    <strong className="text-slate-900">
                                      {exp.tujuanPengiriman}
                                    </strong>
                                  </span>
                                </>
                              )}
                            </div>
                          )}

                          <div className="flex flex-wrap items-center gap-3 text-xs text-slate-600">
                            <span>
                              Pembelian BBM:{' '}
                              <strong className="font-mono text-slate-900 tabular-nums">
                                {formatIdrCurrency(exp.totalPengirimanBbm)}
                              </strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              Tol:{' '}
                              <strong className="font-mono text-slate-900 tabular-nums">
                                {formatIdrCurrency(exp.totalPengeluaranTol)}
                              </strong>
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>
                              Total:{' '}
                              <strong className="font-mono text-emerald-700 tabular-nums">
                                {formatIdrCurrency(exp.totalPengeluaran)}
                              </strong>
                            </span>
                          </div>

                          {exp.catatan && (
                            <p className="text-xs text-slate-500">
                              Catatan: {exp.catatan}
                            </p>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {bbmReceiptSrc && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpenseReceiptPreview({
                                  title: `Struk Pengeluaran BBM · ${exp.id}`,
                                  subtitle: `Kartu ${exp.fleetCardNumber} · ${formatIdrCurrency(
                                    exp.totalPengirimanBbm
                                  )}`,
                                  src: bbmReceiptSrc,
                                })
                              }
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                            >
                              <ImageIcon className="h-3.5 w-3.5 text-sky-700" />
                              Struk BBM
                            </button>
                          )}
                          {tolReceiptSrc && (
                            <button
                              type="button"
                              onClick={() =>
                                setExpenseReceiptPreview({
                                  title: `Struk Pengeluaran Tol · ${exp.id}`,
                                  subtitle: `Kartu ${exp.fleetCardNumber} · ${formatIdrCurrency(
                                    exp.totalPengeluaranTol
                                  )}`,
                                  src: tolReceiptSrc,
                                })
                              }
                              className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                            >
                              <ImageIcon className="h-3.5 w-3.5 text-emerald-700" />
                              Struk Tol
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}
      </main>

      {/* Modal Preview Foto Struk Pengeluaran Driver */}
      {expenseReceiptPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-xs"
          onClick={() => setExpenseReceiptPreview(null)}
        >
          <div
            className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-sm font-bold text-slate-900">
                  {expenseReceiptPreview.title}
                </h3>
                <p className="truncate font-mono text-xs text-slate-600 tabular-nums">
                  {expenseReceiptPreview.subtitle}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setExpenseReceiptPreview(null)}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                aria-label="Tutup pratinjau struk"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="bg-slate-950 p-4">
              {expenseBrokenImgMap[expenseReceiptPreview.src] ? (
                <div className="flex h-64 flex-col items-center justify-center rounded-xl border border-slate-800 bg-slate-900 p-6 text-center text-xs text-slate-300">
                  <ImageIcon className="mb-2 h-8 w-8 text-slate-500" />
                  <p>Pratinjau langsung tidak tersedia untuk tautan eksternal ini.</p>
                  {expenseReceiptPreview.src.startsWith('http') && (
                    <a
                      href={expenseReceiptPreview.src}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-white px-3.5 py-2 font-semibold text-slate-900"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      Buka File Struk
                    </a>
                  )}
                </div>
              ) : (
                <img
                  src={expenseReceiptPreview.src}
                  alt={expenseReceiptPreview.title}
                  referrerPolicy="no-referrer"
                  onError={() =>
                    setExpenseBrokenImgMap((prev) => ({
                      ...prev,
                      [expenseReceiptPreview.src]: true,
                    }))
                  }
                  className="mx-auto max-h-[70vh] w-auto rounded-lg object-contain"
                />
              )}
            </div>
          </div>
        </div>
      )}

      {/* Fixed Thumb-Zone Bottom Navigation Bar on Mobile (< sm); auto-hides when filling out a form to preserve vertical viewport */}
      <nav
        aria-label="Navigasi Utama Portal Driver"
        className={`fixed inset-x-0 bottom-0 z-30 border-t border-slate-200/90 bg-white/95 pb-safe backdrop-blur-md sm:hidden ${
          selectedTaskId && activeTab === 'aktif' ? 'hidden' : ''
        }`}
      >
        <div
          className={`grid h-[60px] ${
            hasSuratTugas ? 'grid-cols-4' : 'grid-cols-3'
          } items-center px-1.5`}
        >
          <button
            type="button"
            onClick={() => setActiveTab('aktif')}
            className={`relative flex h-full flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
              activeTab === 'aktif'
                ? 'text-slate-950 font-bold'
                : 'text-slate-500 font-medium hover:text-slate-800'
            }`}
          >
            <div className="relative flex items-center justify-center">
              <Truck
                className={`h-[19px] w-[19px] ${
                  activeTab === 'aktif' ? 'text-sky-700' : ''
                }`}
              />
              {activeTasks.length > 0 && (
                <span className="ml-1 font-mono text-[10px] font-bold text-sky-700 tabular-nums">
                  {activeTasks.length}
                </span>
              )}
            </div>
            <span className="text-[11px] leading-tight">Tugas Aktif</span>
            {activeTab === 'aktif' && (
              <span className="absolute top-0 h-0.5 w-8 rounded-full bg-slate-900" />
            )}
          </button>

          {hasSuratTugas && (
            <button
              type="button"
              onClick={() => setActiveTab('pengeluaran')}
              className={`relative flex h-full flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
                activeTab === 'pengeluaran'
                  ? 'text-slate-950 font-bold'
                  : 'text-slate-500 font-medium hover:text-slate-800'
              }`}
            >
              <div className="relative flex items-center justify-center">
                <Receipt
                  className={`h-[19px] w-[19px] ${
                    activeTab === 'pengeluaran' ? 'text-sky-700' : ''
                  }`}
                />
                {mySubmittedExpenses.length > 0 && (
                  <span className="ml-1 font-mono text-[10px] font-bold text-sky-700 tabular-nums">
                    {mySubmittedExpenses.length}
                  </span>
                )}
              </div>
              <span className="text-[11px] leading-tight">Pengeluaran</span>
              {activeTab === 'pengeluaran' && (
                <span className="absolute top-0 h-0.5 w-8 rounded-full bg-slate-900" />
              )}
            </button>
          )}

          <button
            type="button"
            onClick={() => setActiveTab('riwayat')}
            className={`relative flex h-full flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
              activeTab === 'riwayat'
                ? 'text-slate-950 font-bold'
                : 'text-slate-500 font-medium hover:text-slate-800'
            }`}
          >
            <div className="relative flex items-center justify-center">
              <History
                className={`h-[19px] w-[19px] ${
                  activeTab === 'riwayat' ? 'text-emerald-700' : ''
                }`}
              />
              {completedTasks.length > 0 && (
                <span className="ml-1 font-mono text-[10px] font-bold text-slate-600 tabular-nums">
                  {completedTasks.length}
                </span>
              )}
            </div>
            <span className="text-[11px] leading-tight">Riwayat</span>
            {activeTab === 'riwayat' && (
              <span className="absolute top-0 h-0.5 w-8 rounded-full bg-slate-900" />
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('notifikasi_wa')}
            className={`relative flex h-full flex-col items-center justify-center gap-0.5 rounded-xl transition-colors ${
              activeTab === 'notifikasi_wa'
                ? 'text-slate-950 font-bold'
                : 'text-slate-500 font-medium hover:text-slate-800'
            }`}
          >
            <div className="relative flex items-center justify-center">
              <MessageSquareShare
                className={`h-[19px] w-[19px] ${
                  activeTab === 'notifikasi_wa' ? 'text-emerald-700' : ''
                }`}
              />
              {myNotifications.length > 0 && (
                <span className="ml-1 font-mono text-[10px] font-bold text-emerald-700 tabular-nums">
                  {myNotifications.length}
                </span>
              )}
            </div>
            <span className="text-[11px] leading-tight">Pesan WA</span>
            {activeTab === 'notifikasi_wa' && (
              <span className="absolute top-0 h-0.5 w-8 rounded-full bg-slate-900" />
            )}
          </button>
        </div>
      </nav>
    </div>
  );
};
