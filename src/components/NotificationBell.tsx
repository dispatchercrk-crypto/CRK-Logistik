import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  BellRing,
  Check,
  CheckCheck,
  CheckCircle2,
  ClipboardList,
  Clock,
  ExternalLink,
  FileSpreadsheet,
  Navigation,
  PackageCheck,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import {
  Assignment,
  TaskStatus,
  WhatsAppEventType,
  WhatsAppNotificationLog,
} from '../types';
import {
  evaluateAssignmentOtd,
  formatDurationMinutes,
  formatRealTimeTimestamp,
  parseFlexibleTimestamp,
} from '../utils/media';

export interface PortalBellNotificationItem {
  id: string;
  dedupeKey: string;
  timestamp: string;
  timestampMs: number;
  category:
    | 'SURAT_TUGAS'
    | 'KEBERANGKATAN'
    | 'DELIVERED'
    | 'SERAH_TERIMA'
    | 'SLA_OVERDUE'
    | 'OFFLINE_QUEUE'
    | 'SPREADSHEET_SYNC';
  title: string;
  subtitle: string;
  metaLine: string;
  assignmentId?: string;
  noPenugasan?: string;
  driverId?: string;
  waLog?: WhatsAppNotificationLog;
  assignment?: Assignment;
}

type BellFilterTab = 'ALL' | 'UNREAD' | 'ACTIVE_FLOW' | 'COMPLETED_FLOW';

interface NotificationBellProps {
  role: 'ADMIN' | 'DRIVER';
  driverId?: string;
  driverName?: string;
  assignments: Assignment[];
  notifications: WhatsAppNotificationLog[];
  pendingSyncCount?: number;
  spreadsheetTitle?: string;
  lastSyncedAt?: string | null;
  onSelectNotification?: (item: PortalBellNotificationItem) => void;
  onQuickWhatsApp?: (item: PortalBellNotificationItem) => void;
  onViewAllLogs?: () => void;
}

function parseTimestampMs(raw?: string | null): number {
  if (!raw) return 0;
  const parsed = parseFlexibleTimestamp(raw);
  if (parsed !== null) return parsed;
  const fallback = Date.parse(raw);
  return Number.isNaN(fallback) ? 0 : fallback;
}

function formatRelativeTimeId(timestampMs: number, nowMs: number): string {
  if (!timestampMs) return 'Baru saja';
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSec < 45) return 'Baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return new Date(timestampMs).toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
  });
}

function playGentleNotificationChime(): void {
  if (typeof window === 'undefined') return;
  try {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = 'sine';
    osc1.frequency.setValueAtTime(880, now);
    osc1.frequency.exponentialRampToValueAtTime(1174.66, now + 0.14);

    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.exponentialRampToValueAtTime(0.08, now + 0.02);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);

    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    window.setTimeout(() => {
      void ctx.close().catch(() => undefined);
    }, 450);
  } catch {
    // Ignore browser autoplay restrictions silently
  }
}

export const NotificationBell: React.FC<NotificationBellProps> = ({
  role,
  driverId = '',
  driverName = '',
  assignments,
  notifications,
  pendingSyncCount = 0,
  spreadsheetTitle = '',
  lastSyncedAt = null,
  onSelectNotification,
  onQuickWhatsApp,
  onViewAllLogs,
}) => {
  const storageKey = useMemo(() => {
    if (role === 'DRIVER') {
      const cleanId = driverId.trim().toLowerCase() || 'default';
      return `crk_bell_read_driver_v1_${cleanId}`;
    }
    return 'crk_bell_read_admin_v1';
  }, [role, driverId]);

  const soundPrefKey = 'crk_bell_sound_enabled_v1';

  const [open, setOpen] = useState<boolean>(false);
  const [filterTab, setFilterTab] = useState<BellFilterTab>('ALL');
  const [ringing, setRinging] = useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    try {
      return window.localStorage.getItem(soundPrefKey) !== 'false';
    } catch {
      return true;
    }
  });

  const [readIds, setReadIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return new Set();
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return new Set(parsed.filter((x) => typeof x === 'string'));
      }
    } catch {
      // Ignore storage errors
    }
    return new Set();
  });

  // Reload readIds if storageKey changes (e.g. switching driver)
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) {
        setReadIds(new Set());
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setReadIds(new Set(parsed.filter((x) => typeof x === 'string')));
      }
    } catch {
      setReadIds(new Set());
    }
  }, [storageKey]);

  const persistReadIds = useCallback(
    (nextSet: Set<string>) => {
      if (typeof window === 'undefined') return;
      try {
        const arr = Array.from(nextSet).slice(-500);
        window.localStorage.setItem(storageKey, JSON.stringify(arr));
      } catch {
        // Ignore storage quota
      }
    },
    [storageKey]
  );

  // Refresh relative timestamps live while open and lock mobile body scroll
  useEffect(() => {
    if (!open || typeof window === 'undefined') return;
    setNowMs(Date.now());
    const timer = window.setInterval(() => setNowMs(Date.now()), 15000);

    const isMobile = window.innerWidth < 640;
    const prevBodyOverflow = document.body.style.overflow;
    if (isMobile) {
      document.body.style.overflow = 'hidden';
    }

    return () => {
      window.clearInterval(timer);
      if (isMobile) {
        document.body.style.overflow = prevBodyOverflow;
      }
    };
  }, [open]);

  // Close panel on Escape key or outside pointer click (supports React Portal outside header!)
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onPointerDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (triggerRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    document.addEventListener('mousedown', onPointerDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('mousedown', onPointerDown);
    };
  }, [open]);

  const synthesizedItems = useMemo<PortalBellNotificationItem[]>(() => {
    const normDriver = driverId.trim().toLowerCase();
    const byDedupeKey = new Map<string, PortalBellNotificationItem>();

    const assignmentByNo = new Map<string, Assignment>();
    for (const asg of assignments) {
      assignmentByNo.set(asg.noPenugasan, asg);
    }

    // 1. Offline queue alert for Driver Portal
    if (role === 'DRIVER' && pendingSyncCount > 0) {
      const queueKey = `offline_queue:${normDriver}:${pendingSyncCount}`;
      byDedupeKey.set(queueKey, {
        id: queueKey,
        dedupeKey: queueKey,
        timestamp: new Date().toISOString(),
        timestampMs: Date.now(),
        category: 'OFFLINE_QUEUE',
        title: `${pendingSyncCount} Laporan Menunggu Sinkronisasi Sinyal`,
        subtitle:
          'Laporan tersimpan aman di memori HP dan otomatis terkirim saat sinyal kembali stabil.',
        metaLine: `${driverId} · Memori Lokal Aktif`,
        driverId,
      });
    }

    // 2. Latest Spreadsheet sync activity for Admin Portal (pre-marked read if historical)
    if (role === 'ADMIN' && lastSyncedAt) {
      const syncMs = parseTimestampMs(lastSyncedAt);
      if (syncMs > 0) {
        const sheetKey = `spreadsheet_sync:${lastSyncedAt}`;
        byDedupeKey.set(sheetKey, {
          id: `bell:${sheetKey}`,
          dedupeKey: sheetKey,
          timestamp: lastSyncedAt,
          timestampMs: syncMs,
          category: 'SPREADSHEET_SYNC',
          title: 'Sinkronisasi Database Spreadsheet Berhasil',
          subtitle: spreadsheetTitle
            ? `Data Master & Surat Tugas tersinkron dengan "${spreadsheetTitle}".`
            : 'Seluruh data Master & Surat Tugas telah tersinkronisasi ke Google Sheets.',
          metaLine: `Sesi Sinkron Permanen · Auto-Sync Aktif`,
        });
      }
    }

    // 3. Real-time WhatsApp & system operational logs
    const relevantLogs =
      role === 'DRIVER'
        ? notifications.filter(
            (n) => n.driverId.trim().toLowerCase() === normDriver
          )
        : notifications.filter((n) => n.eventType !== 'UJI_JARINGAN');

    const mapEventCategory = (
      ev: WhatsAppEventType
    ): PortalBellNotificationItem['category'] => {
      if (ev === 'KEBERANGKATAN') return 'KEBERANGKATAN';
      if (ev === 'DELIVERED') return 'DELIVERED';
      if (ev === 'SERAH_TERIMA') return 'SERAH_TERIMA';
      return 'SURAT_TUGAS';
    };

    for (const log of relevantLogs) {
      const cat = mapEventCategory(log.eventType);
      const dedupeKey = `${log.noPenugasan || log.id}:${cat}`;
      const matchedAsg = assignmentByNo.get(log.noPenugasan);
      const tsMs = parseTimestampMs(log.timestamp);
      const originLabel =
        matchedAsg?.departureData?.titikKeberangkatan ||
        matchedAsg?.origin ||
        'Titik Berangkat';
      const destLabel = matchedAsg?.destination || 'Tujuan';

      let title = '';
      let subtitle = '';
      if (role === 'ADMIN') {
        if (cat === 'SURAT_TUGAS') {
          title = `Surat Tugas Diterbitkan · ${log.noPenugasan}`;
          subtitle = `Driver ${log.driverName} (${log.plateNumber}) → ${destLabel}`;
        } else if (cat === 'KEBERANGKATAN') {
          const suhuInfo = matchedAsg?.departureData?.suhuAwal
            ? ` · Suhu ${matchedAsg.departureData.suhuAwal}`
            : '';
          title = `Armada Berangkat · ${log.plateNumber}`;
          subtitle = `${log.driverName} berangkat dari ${originLabel} → ${destLabel}${suhuInfo}`;
        } else if (cat === 'DELIVERED') {
          title = `Tiba di Tujuan (Delivered) · ${log.plateNumber}`;
          subtitle = `${log.driverName} telah tiba di ${destLabel} (${log.noPenugasan})`;
        } else {
          const receiver = matchedAsg?.handoverData?.penerimaNama
            ? ` kepada ${matchedAsg.handoverData.penerimaNama}`
            : '';
          title = `Serah Terima Selesai · ${log.noPenugasan}`;
          subtitle = `Handover muatan ${log.plateNumber} oleh ${log.driverName}${receiver}`;
        }
      } else {
        if (cat === 'SURAT_TUGAS') {
          title = `Surat Tugas Baru · ${log.noPenugasan}`;
          subtitle = `Armada ${log.plateNumber} menuju ${destLabel}. Silakan isi data keberangkatan.`;
        } else if (cat === 'KEBERANGKATAN') {
          title = `Keberangkatan Tercatat · ${log.noPenugasan}`;
          subtitle = `Perjalanan ${originLabel} → ${destLabel} sedang berlangsung.`;
        } else if (cat === 'DELIVERED') {
          title = `Status Delivered Tercatat · ${log.noPenugasan}`;
          subtitle = `Tiba di ${destLabel}. Lanjutkan formulir serah terima (Handover).`;
        } else {
          title = `Handover Selesai · ${log.noPenugasan}`;
          subtitle = `Laporan serah terima armada ${log.plateNumber} telah tersimpan.`;
        }
      }

      byDedupeKey.set(dedupeKey, {
        id: `bell:${dedupeKey}`,
        dedupeKey,
        timestamp: log.timestamp,
        timestampMs: tsMs,
        category: cat,
        title,
        subtitle,
        metaLine: `${log.noPenugasan} · ${log.plateNumber} · ${log.driverId}`,
        assignmentId: matchedAsg?.id,
        noPenugasan: log.noPenugasan,
        driverId: log.driverId,
        waLog: log,
        assignment: matchedAsg,
      });
    }

    // 4. Assignment lifecycle synthesizer (ensures Firestore/Sheets-hydrated records always appear!)
    const relevantAssignments =
      role === 'DRIVER'
        ? assignments.filter(
            (a) => a.driverId.trim().toLowerCase() === normDriver
          )
        : assignments;

    for (const asg of relevantAssignments) {
      const originLabel =
        asg.departureData?.titikKeberangkatan ||
        (asg.origin !== 'Menunggu Titik Keberangkatan Driver'
          ? asg.origin
          : 'Pool / Gudang');

      // Stage A: Surat Tugas Created
      const stKey = `${asg.noPenugasan}:SURAT_TUGAS`;
      if (!byDedupeKey.has(stKey)) {
        const createdMs =
          parseTimestampMs(asg.createdAt) ||
          parseTimestampMs(`${asg.tanggalTugas}T07:00:00`);
        byDedupeKey.set(stKey, {
          id: `bell:${stKey}`,
          dedupeKey: stKey,
          timestamp: asg.createdAt || asg.tanggalTugas,
          timestampMs: createdMs,
          category: 'SURAT_TUGAS',
          title:
            role === 'ADMIN'
              ? `Surat Tugas · ${asg.noPenugasan}`
              : `Penugasan Anda · ${asg.noPenugasan}`,
          subtitle:
            role === 'ADMIN'
              ? `${asg.driverName} (${asg.plateNumber}) → ${asg.destination}`
              : `Armada ${asg.plateNumber} menuju ${asg.destination}${
                  asg.purpose ? ` (${asg.purpose})` : ''
                }`,
          metaLine: `${asg.noPenugasan} · ${asg.plateNumber} · ${asg.tanggalTugas}`,
          assignmentId: asg.id,
          noPenugasan: asg.noPenugasan,
          driverId: asg.driverId,
          assignment: asg,
        });
      }

      // Stage B: Departure Recorded
      if (asg.departureData?.timestamp) {
        const depKey = `${asg.noPenugasan}:KEBERANGKATAN`;
        if (!byDedupeKey.has(depKey)) {
          const depMs = parseTimestampMs(asg.departureData.timestamp);
          const suhuInfo = asg.departureData.suhuAwal
            ? ` · Suhu ${asg.departureData.suhuAwal}`
            : '';
          byDedupeKey.set(depKey, {
            id: `bell:${depKey}`,
            dedupeKey: depKey,
            timestamp: asg.departureData.timestamp,
            timestampMs: depMs,
            category: 'KEBERANGKATAN',
            title:
              role === 'ADMIN'
                ? `Driver Berangkat · ${asg.plateNumber}`
                : `Keberangkatan Tersimpan · ${asg.noPenugasan}`,
            subtitle:
              role === 'ADMIN'
                ? `${asg.driverName} berangkat dari ${originLabel} → ${asg.destination}${suhuInfo}`
                : `${originLabel} → ${asg.destination} · KM Awal ${asg.departureData.kmAwal.toLocaleString(
                    'id-ID'
                  )}${suhuInfo}`,
            metaLine: `${asg.noPenugasan} · ${asg.plateNumber} · ${asg.driverId}`,
            assignmentId: asg.id,
            noPenugasan: asg.noPenugasan,
            driverId: asg.driverId,
            assignment: asg,
          });
        }
      }

      // Stage C: Delivered Recorded
      if (asg.deliveredAt) {
        const delKey = `${asg.noPenugasan}:DELIVERED`;
        if (!byDedupeKey.has(delKey)) {
          const delMs = parseTimestampMs(asg.deliveredAt);
          byDedupeKey.set(delKey, {
            id: `bell:${delKey}`,
            dedupeKey: delKey,
            timestamp: asg.deliveredAt,
            timestampMs: delMs,
            category: 'DELIVERED',
            title:
              role === 'ADMIN'
                ? `Armada Tiba (Delivered) · ${asg.plateNumber}`
                : `Konfirmasi Tiba Tercatat · ${asg.noPenugasan}`,
            subtitle:
              role === 'ADMIN'
                ? `${asg.driverName} telah tiba di lokasi tujuan ${asg.destination}`
                : `Tiba di ${asg.destination}. Siap melanjutkan serah terima muatan.`,
            metaLine: `${asg.noPenugasan} · ${asg.plateNumber} · ${asg.driverId}`,
            assignmentId: asg.id,
            noPenugasan: asg.noPenugasan,
            driverId: asg.driverId,
            assignment: asg,
          });
        }
      }

      // Stage D: Handover Completed
      if (
        asg.handoverData?.timestamp ||
        asg.status === TaskStatus.HANDOVER ||
        asg.status === TaskStatus.SELESAI
      ) {
        const hoKey = `${asg.noPenugasan}:SERAH_TERIMA`;
        if (!byDedupeKey.has(hoKey)) {
          const rawHoTs =
            asg.handoverData?.timestamp || asg.deliveredAt || asg.createdAt;
          const hoMs = parseTimestampMs(rawHoTs);
          const receiver = asg.handoverData?.penerimaNama
            ? ` · Penerima: ${asg.handoverData.penerimaNama}`
            : '';
          byDedupeKey.set(hoKey, {
            id: `bell:${hoKey}`,
            dedupeKey: hoKey,
            timestamp: rawHoTs,
            timestampMs: hoMs,
            category: 'SERAH_TERIMA',
            title:
              role === 'ADMIN'
                ? `Handover Selesai · ${asg.noPenugasan}`
                : `Tugas Selesai (Handover) · ${asg.noPenugasan}`,
            subtitle:
              role === 'ADMIN'
                ? `${asg.driverName} menyelesaikan serah terima di ${asg.destination}${receiver}`
                : `Serah terima di ${asg.destination} selesai${receiver}`,
            metaLine: `${asg.noPenugasan} · ${asg.plateNumber} · ${asg.driverId}`,
            assignmentId: asg.id,
            noPenugasan: asg.noPenugasan,
            driverId: asg.driverId,
            assignment: asg,
          });
        }
      }

      // Stage E: SLA Overdue Alert on Active Tasks
      const otd = evaluateAssignmentOtd(asg);
      if (otd.category === 'OVERDUE_ACTIVE') {
        const slaKey = `${asg.noPenugasan}:SLA_OVERDUE:${asg.tanggalTugas}`;
        byDedupeKey.set(slaKey, {
          id: `bell:${slaKey}`,
          dedupeKey: slaKey,
          timestamp: new Date().toISOString(),
          timestampMs: Date.now() - 1000,
          category: 'SLA_OVERDUE',
          title: `Melewati Target Jam Tiba (+${formatDurationMinutes(
            otd.delayMinutes
          )})`,
          subtitle: `${asg.noPenugasan} · ${asg.driverName} (${asg.plateNumber}) tujuan ${asg.destination}`,
          metaLine: `Target SLA ${asg.jadwalJamTiba} · Status: ${asg.status}`,
          assignmentId: asg.id,
          noPenugasan: asg.noPenugasan,
          driverId: asg.driverId,
          assignment: asg,
        });
      }
    }

    return Array.from(byDedupeKey.values())
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 60);
  }, [
    assignments,
    notifications,
    role,
    driverId,
    pendingSyncCount,
    lastSyncedAt,
    spreadsheetTitle,
  ]);

  const isItemUnread = useCallback(
    (item: PortalBellNotificationItem) => {
      // Passive background 20s spreadsheet ticks don't inflate unread badge unless clicked
      if (item.category === 'SPREADSHEET_SYNC') return false;
      return !readIds.has(item.id);
    },
    [readIds]
  );

  const unreadItems = useMemo(
    () => synthesizedItems.filter((item) => isItemUnread(item)),
    [synthesizedItems, isItemUnread]
  );

  const activeFlowItems = useMemo(
    () =>
      synthesizedItems.filter(
        (item) =>
          item.category === 'SURAT_TUGAS' ||
          item.category === 'KEBERANGKATAN' ||
          item.category === 'SLA_OVERDUE' ||
          item.category === 'OFFLINE_QUEUE'
      ),
    [synthesizedItems]
  );

  const completedFlowItems = useMemo(
    () =>
      synthesizedItems.filter(
        (item) =>
          item.category === 'DELIVERED' || item.category === 'SERAH_TERIMA'
      ),
    [synthesizedItems]
  );

  const unreadCount = unreadItems.length;

  // Detect genuinely new live arrivals after initial hydration to ring the bell
  const knownIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (synthesizedItems.length === 0) return;
    if (knownIdsRef.current === null) {
      knownIdsRef.current = new Set(synthesizedItems.map((i) => i.id));
      return;
    }

    let hasBrandNewUnread = false;
    for (const item of synthesizedItems) {
      if (!knownIdsRef.current.has(item.id)) {
        knownIdsRef.current.add(item.id);
        if (isItemUnread(item)) {
          hasBrandNewUnread = true;
        }
      }
    }

    if (hasBrandNewUnread) {
      setRinging(true);
      if (soundEnabled) {
        playGentleNotificationChime();
      }
      const timer = window.setTimeout(() => setRinging(false), 1200);
      return () => window.clearTimeout(timer);
    }
  }, [synthesizedItems, isItemUnread, soundEnabled]);

  const markItemRead = (id: string) => {
    setReadIds((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      persistReadIds(next);
      return next;
    });
  };

  const markAllAsRead = () => {
    setReadIds((prev) => {
      const next = new Set(prev);
      for (const item of synthesizedItems) {
        next.add(item.id);
      }
      persistReadIds(next);
      return next;
    });
  };

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(soundPrefKey, String(next));
      } catch {
        // Ignore
      }
    }
    if (next) {
      playGentleNotificationChime();
    }
  };

  const displayedItems = useMemo(() => {
    if (filterTab === 'UNREAD') return unreadItems;
    if (filterTab === 'ACTIVE_FLOW') return activeFlowItems;
    if (filterTab === 'COMPLETED_FLOW') return completedFlowItems;
    return synthesizedItems;
  }, [
    filterTab,
    unreadItems,
    activeFlowItems,
    completedFlowItems,
    synthesizedItems,
  ]);

  const renderCategoryIcon = (
    category: PortalBellNotificationItem['category'],
    isUnread: boolean
  ) => {
    if (category === 'SERAH_TERIMA') {
      return (
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            isUnread
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          <CheckCircle2 className="h-4 w-4" />
        </div>
      );
    }
    if (category === 'DELIVERED') {
      return (
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            isUnread
              ? 'bg-indigo-100 text-indigo-700'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          <PackageCheck className="h-4 w-4" />
        </div>
      );
    }
    if (category === 'KEBERANGKATAN') {
      return (
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            isUnread ? 'bg-sky-100 text-sky-700' : 'bg-slate-100 text-slate-600'
          }`}
        >
          <Navigation className="h-4 w-4" />
        </div>
      );
    }
    if (category === 'SLA_OVERDUE' || category === 'OFFLINE_QUEUE') {
      return (
        <div
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
            isUnread
              ? 'bg-amber-100 text-amber-800'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          <AlertTriangle className="h-4 w-4" />
        </div>
      );
    }
    if (category === 'SPREADSHEET_SYNC') {
      return (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
          <FileSpreadsheet className="h-4 w-4" />
        </div>
      );
    }
    return (
      <div
        className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
          isUnread
            ? 'bg-slate-900 text-white'
            : 'bg-slate-100 text-slate-600'
        }`}
      >
        <ClipboardList className="h-4 w-4" />
      </div>
    );
  };

  const portalOverlay =
    open && typeof document !== 'undefined'
      ? createPortal(
          <>
            {/* Full-Viewport Backdrop Scrim (Dimmed on Mobile, Subtle Click-Outside Layer on Desktop) */}
            <div
              className="no-print fixed inset-0 z-[100] bg-slate-950/50 backdrop-blur-[1px] sm:bg-slate-950/10 sm:backdrop-blur-none"
              onClick={() => setOpen(false)}
              aria-hidden="true"
            />

            {/* Portaled Notification Panel: Immune to parent header backdrop-blur / overflow clipping */}
            <div
              ref={panelRef}
              role="dialog"
              aria-modal="true"
              aria-label="Pusat Aktivitas & Notifikasi Real-Time"
              className="no-print sheet-enter fixed inset-x-0 bottom-0 z-[101] flex max-h-[86dvh] w-full flex-col overflow-hidden rounded-t-3xl border-t border-slate-200 bg-white pb-safe shadow-2xl sm:inset-x-auto sm:bottom-auto sm:right-4 sm:top-[60px] sm:max-h-[min(620px,calc(100dvh-76px))] sm:w-[440px] sm:max-w-[calc(100vw-2rem)] sm:rounded-2xl sm:border sm:border-slate-200/95 sm:pb-0 sm:shadow-2xl lg:right-8"
            >
              {/* Mobile Grab Handle */}
              <div className="flex shrink-0 justify-center pt-2.5 pb-1 sm:hidden">
                <div className="h-1.5 w-11 rounded-full bg-slate-300" />
              </div>

              {/* Header */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-slate-200 px-4 py-3 sm:px-5 sm:py-3.5">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="truncate text-sm font-bold text-slate-900">
                      {role === 'ADMIN'
                        ? 'Aktivitas Operasional Armada'
                        : `Aktivitas & Tugas · ${driverId}`}
                    </h3>
                    <span
                      className="inline-flex h-2 w-2 shrink-0 rounded-full bg-emerald-500"
                      title="Pembaruan Real-Time Aktif"
                    />
                  </div>
                  <p className="mt-0.5 text-[11px] text-slate-500 tabular-nums">
                    {unreadCount > 0
                      ? `${unreadCount} aktivitas terbaru belum dibaca`
                      : `Terpantau real-time · ${synthesizedItems.length} aktivitas tercatat`}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <button
                    type="button"
                    onClick={toggleSound}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900"
                    title={
                      soundEnabled
                        ? 'Suara notifikasi aktif (Klik untuk bisukan)'
                        : 'Suara notifikasi dibisukan (Klik untuk aktifkan)'
                    }
                    aria-label="Pengaturan suara notifikasi"
                  >
                    {soundEnabled ? (
                      <Volume2 className="h-4 w-4 text-sky-700" />
                    ) : (
                      <VolumeX className="h-4 w-4 text-slate-400" />
                    )}
                  </button>

                  {unreadCount > 0 && (
                    <button
                      type="button"
                      onClick={markAllAsRead}
                      className="inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-sky-800 transition-colors hover:bg-sky-50"
                      title="Tandai semua aktivitas sudah dibaca"
                    >
                      <CheckCheck className="h-3.5 w-3.5" />
                      <span className="hidden xs:inline sm:inline">
                        Tandai Dibaca
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                    aria-label="Tutup panel notifikasi"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Category Filter Segmented Bar */}
              <div className="shrink-0 border-b border-slate-100 bg-slate-50/85 px-4 py-2 sm:px-5">
                <div className="no-scrollbar flex items-center gap-1 overflow-x-auto">
                  <button
                    type="button"
                    onClick={() => setFilterTab('ALL')}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors tabular-nums ${
                      filterTab === 'ALL'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                    }`}
                  >
                    Semua ({synthesizedItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab('UNREAD')}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors tabular-nums ${
                      filterTab === 'UNREAD'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                    }`}
                  >
                    Belum Dibaca ({unreadCount})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab('ACTIVE_FLOW')}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors tabular-nums ${
                      filterTab === 'ACTIVE_FLOW'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                    }`}
                  >
                    Tugas &amp; Jalan ({activeFlowItems.length})
                  </button>
                  <button
                    type="button"
                    onClick={() => setFilterTab('COMPLETED_FLOW')}
                    className={`shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition-colors tabular-nums ${
                      filterTab === 'COMPLETED_FLOW'
                        ? 'bg-slate-900 text-white shadow-xs'
                        : 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900'
                    }`}
                  >
                    Selesai ({completedFlowItems.length})
                  </button>
                </div>
              </div>

              {/* Scrollable Real-Time Activity List */}
              <div className="min-h-0 flex-1 divide-y divide-slate-100 overflow-y-auto overscroll-contain">
                {displayedItems.length === 0 ? (
                  <div className="px-6 py-12 text-center">
                    <Bell className="mx-auto h-7 w-7 text-slate-300" />
                    <p className="mt-2.5 text-sm font-semibold text-slate-900">
                      {filterTab === 'UNREAD'
                        ? 'Tidak Ada Aktivitas Belum Dibaca'
                        : 'Belum Ada Aktivitas pada Kategori Ini'}
                    </p>
                    <p className="mx-auto mt-1 max-w-xs text-xs leading-relaxed text-slate-500">
                      {role === 'ADMIN'
                        ? 'Setiap penerbitan Surat Tugas, keberangkatan armada, status Delivered, dan serah terima Driver muncul otomatis secara real-time di sini.'
                        : `Penugasan baru dari Admin Dispatcher dan riwayat laporan perjalanan ${
                            driverName || driverId
                          } akan muncul otomatis secara real-time di sini.`}
                    </p>
                  </div>
                ) : (
                  displayedItems.map((item) => {
                    const isUnread = isItemUnread(item);
                    return (
                      <div
                        key={item.id}
                        className={`group flex items-start gap-3 px-4 py-3.5 transition-colors sm:px-5 ${
                          isUnread
                            ? 'bg-sky-50/45 hover:bg-sky-50/80'
                            : 'bg-white hover:bg-slate-50/90'
                        }`}
                      >
                        {renderCategoryIcon(item.category, isUnread)}

                        <div className="min-w-0 flex-1">
                          <div
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                              markItemRead(item.id);
                              if (
                                onSelectNotification &&
                                item.category !== 'SPREADSHEET_SYNC'
                              ) {
                                onSelectNotification(item);
                                setOpen(false);
                              }
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault();
                                markItemRead(item.id);
                                if (
                                  onSelectNotification &&
                                  item.category !== 'SPREADSHEET_SYNC'
                                ) {
                                  onSelectNotification(item);
                                  setOpen(false);
                                }
                              }
                            }}
                            className="cursor-pointer focus:outline-none"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex min-w-0 items-center gap-1.5">
                                {isUnread && (
                                  <span
                                    className="h-2 w-2 shrink-0 rounded-full bg-sky-600"
                                    aria-hidden="true"
                                  />
                                )}
                                <p
                                  className={`text-xs leading-snug ${
                                    isUnread
                                      ? 'font-bold text-slate-950'
                                      : 'font-semibold text-slate-800'
                                  }`}
                                >
                                  {item.title}
                                </p>
                              </div>
                              <span className="shrink-0 font-mono text-[10px] text-slate-500 tabular-nums">
                                {formatRelativeTimeId(item.timestampMs, nowMs)}
                              </span>
                            </div>

                            <p className="mt-1 text-xs leading-relaxed text-slate-600">
                              {item.subtitle}
                            </p>

                            <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-[10px] text-slate-400 tabular-nums">
                              {item.metaLine && (
                                <>
                                  <span className="text-slate-500">
                                    {item.metaLine}
                                  </span>
                                  <span aria-hidden="true">·</span>
                                </>
                              )}
                              <span className="inline-flex items-center gap-1">
                                <Clock className="h-2.5 w-2.5" />
                                {item.timestampMs
                                  ? formatRealTimeTimestamp(
                                      new Date(item.timestampMs)
                                    )
                                  : item.timestamp}
                              </span>
                            </div>
                          </div>

                          {/* Quick Action Links Row */}
                          {(Boolean(
                            onSelectNotification &&
                              (item.assignment ||
                                item.noPenugasan ||
                                item.category === 'OFFLINE_QUEUE')
                          ) ||
                            Boolean(
                              onQuickWhatsApp && (item.assignment || item.waLog)
                            ) ||
                            isUnread) && (
                            <div className="mt-2.5 flex flex-wrap items-center gap-2">
                              {onSelectNotification &&
                                (item.assignment ||
                                  item.noPenugasan ||
                                  item.category === 'OFFLINE_QUEUE') && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      markItemRead(item.id);
                                      onSelectNotification(item);
                                      setOpen(false);
                                    }}
                                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-slate-800 transition-colors hover:bg-slate-100"
                                  >
                                    {item.category === 'OFFLINE_QUEUE'
                                      ? 'Coba Kirim Sekarang'
                                      : 'Buka Tugas'}
                                  </button>
                                )}

                              {onQuickWhatsApp &&
                                (item.assignment || item.waLog) && (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      markItemRead(item.id);
                                      onQuickWhatsApp(item);
                                    }}
                                    className="inline-flex min-h-[32px] items-center gap-1 rounded-lg bg-emerald-600 px-2.5 py-1 text-[11px] font-semibold text-white transition-colors hover:bg-emerald-700"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    Kirim WA
                                  </button>
                                )}

                              {isUnread && (
                                <button
                                  type="button"
                                  onClick={() => markItemRead(item.id)}
                                  className="inline-flex min-h-[32px] items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-800"
                                >
                                  <Check className="h-3 w-3" />
                                  Tandai dibaca
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>

              {/* Footer Bar */}
              <div className="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200/90 bg-slate-50/90 px-4 py-2.5 sm:px-5">
                <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                  Sinkron Real-Time Aktif
                </span>
                {onViewAllLogs ? (
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      onViewAllLogs();
                    }}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-sky-800 transition-colors hover:text-slate-950"
                  >
                    <span>Lihat Semua Log Aktivitas</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-xs font-semibold text-slate-600 hover:text-slate-900"
                  >
                    Tutup
                  </button>
                )}
              </div>
            </div>
          </>,
          document.body
        )
      : null;

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-label={`Notifikasi ${
          role === 'ADMIN'
            ? 'Admin Dispatcher'
            : `Driver ${driverName || driverId}`
        }${unreadCount > 0 ? ` (${unreadCount} belum dibaca)` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={`relative inline-flex h-10 w-10 items-center justify-center rounded-xl border transition-colors ${
          open
            ? 'border-slate-900 bg-slate-900 text-white'
            : unreadCount > 0
            ? 'border-sky-300 bg-sky-50/90 text-slate-900 hover:bg-sky-100'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
        }`}
        title="Buka pusat aktivitas & notifikasi real-time"
      >
        {unreadCount > 0 || ringing ? (
          <BellRing
            className={`h-[18px] w-[18px] ${
              ringing ? 'bell-swing-anim' : ''
            } ${open ? 'text-white' : 'text-sky-700'}`}
          />
        ) : (
          <Bell className="h-[18px] w-[18px]" />
        )}

        {unreadCount > 0 && (
          <span
            className={`pointer-events-none absolute -right-1 -top-1 inline-flex min-h-[19px] min-w-[19px] items-center justify-center rounded-full px-1 font-mono text-[10px] font-bold leading-none tabular-nums shadow-xs ${
              open
                ? 'bg-sky-500 text-white ring-2 ring-white'
                : 'bg-red-600 text-white ring-2 ring-white'
            }`}
          >
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {portalOverlay}
    </div>
  );
};
