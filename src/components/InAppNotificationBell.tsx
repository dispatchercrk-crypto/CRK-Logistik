import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Bell,
  Check,
  CheckCheck,
  ClipboardList,
  MapPin,
  Navigation,
  PackageCheck,
  X,
} from 'lucide-react';
import {
  Assignment,
  WhatsAppEventType,
  WhatsAppNotificationLog,
} from '../types';
import { formatRealTimeTimestamp, parseFlexibleTimestamp } from '../utils/media';

const ADMIN_READ_NOTIF_STORAGE_KEY = 'crk_admin_inapp_read_ids_v1';
const DRIVER_READ_NOTIF_STORAGE_PREFIX = 'crk_driver_inapp_read_ids_v1_';

export interface InAppNotificationItem {
  id: string;
  isServerNotification: boolean;
  eventType: Exclude<WhatsAppEventType, 'UJI_JARINGAN'>;
  actorRole: 'ADMIN' | 'DRIVER' | 'SYSTEM';
  timestamp: string;
  timestampMs: number;
  title: string;
  summary: string;
  noPenugasan: string;
  assignmentId?: string;
  driverId: string;
  driverName: string;
  plateNumber: string;
  destination: string;
  isRead: boolean;
}

interface InAppNotificationBellProps {
  audience?: 'ADMIN' | 'DRIVER';
  driverId?: string;
  driverName?: string;
  notifications: WhatsAppNotificationLog[];
  assignments: Assignment[];
  onMarkNotificationsRead?: (ids: string[], markAll?: boolean) => Promise<void>;
  onSelectNotificationAssignment: (params: {
    assignment?: Assignment;
    noPenugasan: string;
  }) => void;
  onOpenNotificationLogMenu: () => void;
}

function resolveStorageKey(
  audience: 'ADMIN' | 'DRIVER',
  driverId?: string
): string {
  if (audience === 'DRIVER') {
    const cleanId = (driverId || 'default').trim().toLowerCase() || 'default';
    return `${DRIVER_READ_NOTIF_STORAGE_PREFIX}${cleanId}`;
  }
  return ADMIN_READ_NOTIF_STORAGE_KEY;
}

function readLocalReadSet(storageKey: string): Set<string> {
  if (typeof window === 'undefined') return new Set();
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set(parsed.map((v) => String(v)));
    }
  } catch {
    // Ignore storage access errors
  }
  return new Set();
}

function persistLocalReadSet(storageKey: string, ids: Set<string>): void {
  if (typeof window === 'undefined') return;
  try {
    const arr = Array.from(ids).slice(-500);
    window.localStorage.setItem(storageKey, JSON.stringify(arr));
  } catch {
    // Ignore storage quota errors
  }
}

function formatRelativeTimeId(timestampMs: number, nowMs: number): string {
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return '-';
  const diffSec = Math.max(0, Math.floor((nowMs - timestampMs) / 1000));
  if (diffSec < 45) return 'Baru saja';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin} mnt lalu`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr} jam lalu`;
  const diffDay = Math.floor(diffHr / 24);
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return new Date(timestampMs).toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: 'short',
  });
}

function getEventHeadline(
  eventType: Exclude<WhatsAppEventType, 'UJI_JARINGAN'>,
  audience: 'ADMIN' | 'DRIVER',
  actorRole: 'ADMIN' | 'DRIVER' | 'SYSTEM',
  rawSummary?: string
): string {
  if (audience === 'DRIVER') {
    const isDispatcherUpdate =
      actorRole === 'ADMIN' &&
      rawSummary &&
      rawSummary.toLowerCase().includes('diperbarui');
    if (isDispatcherUpdate) {
      return 'Pembaruan Penugasan Dispatcher';
    }
    switch (eventType) {
      case 'SURAT_TUGAS':
        return 'Tugas Baru untuk Anda';
      case 'KEBERANGKATAN':
        return 'Laporan Keberangkatan Tercatat';
      case 'DELIVERED':
        return 'Konfirmasi Tiba (Delivered)';
      case 'SERAH_TERIMA':
        return 'Serah Terima (Handover) Selesai';
    }
  }

  switch (eventType) {
    case 'SURAT_TUGAS':
      return 'Tugas Baru Diterbitkan';
    case 'KEBERANGKATAN':
      return 'Driver Mulai Berangkat';
    case 'DELIVERED':
      return 'Driver Tiba di Tujuan';
    case 'SERAH_TERIMA':
      return 'Serah Terima Muatan Selesai';
  }
}

function buildFallbackSummary(
  notif: WhatsAppNotificationLog,
  audience: 'ADMIN' | 'DRIVER',
  matchedAssignment?: Assignment
): string {
  if (notif.summary && notif.summary.trim()) {
    return notif.summary.trim();
  }
  const dest =
    notif.destination || matchedAssignment?.destination || 'lokasi tujuan';
  const plate = notif.plateNumber || matchedAssignment?.plateNumber || 'Armada';

  if (audience === 'DRIVER') {
    const jamTiba = matchedAssignment?.jadwalJamTiba
      ? ` · Target tiba ${matchedAssignment.jadwalJamTiba}`
      : '';
    switch (notif.eventType) {
      case 'SURAT_TUGAS':
        return `Penugasan armada ${plate} menuju ${dest}${jamTiba}.`;
      case 'KEBERANGKATAN': {
        const dep = matchedAssignment?.departureData;
        const origin =
          dep?.titikKeberangkatan || matchedAssignment?.origin || 'titik awal';
        return `Keberangkatan armada ${plate} dari ${origin} menuju ${dest}${
          dep?.kmAwal !== undefined
            ? ` · KM ${dep.kmAwal.toLocaleString('id-ID')}`
            : ''
        }.`;
      }
      case 'DELIVERED':
        return `Status tiba di lokasi tujuan ${dest} (${plate}) telah tercatat.`;
      case 'SERAH_TERIMA': {
        const ho = matchedAssignment?.handoverData;
        return `Berita acara serah terima armada ${plate} di ${dest}${
          ho?.penerimaNama ? ` kepada ${ho.penerimaNama}` : ''
        } telah selesai.`;
      }
      default:
        return `${plate} — ${notif.noPenugasan}`;
    }
  }

  const driverLabel = notif.driverName
    ? `${notif.driverName}${notif.plateNumber ? ` (${notif.plateNumber})` : ''}`
    : notif.plateNumber || 'Armada';

  switch (notif.eventType) {
    case 'SURAT_TUGAS':
      return `Penugasan pengiriman untuk ${driverLabel} menuju ${dest}.`;
    case 'KEBERANGKATAN': {
      const dep = matchedAssignment?.departureData;
      const origin =
        dep?.titikKeberangkatan || matchedAssignment?.origin || 'titik awal';
      return `${driverLabel} berangkat dari ${origin} menuju ${dest}${
        dep?.kmAwal !== undefined
          ? ` · KM ${dep.kmAwal.toLocaleString('id-ID')}`
          : ''
      }.`;
    }
    case 'DELIVERED':
      return `${driverLabel} telah tiba di lokasi tujuan ${dest}.`;
    case 'SERAH_TERIMA': {
      const ho = matchedAssignment?.handoverData;
      return `Berita acara serah terima ${driverLabel} di ${dest}${
        ho?.penerimaNama ? ` kepada ${ho.penerimaNama}` : ''
      } telah selesai.`;
    }
    default:
      return `${driverLabel} — ${notif.noPenugasan}`;
  }
}

export const InAppNotificationBell: React.FC<InAppNotificationBellProps> = ({
  audience = 'ADMIN',
  driverId,
  driverName,
  notifications,
  assignments,
  onMarkNotificationsRead,
  onSelectNotificationAssignment,
  onOpenNotificationLogMenu,
}) => {
  const storageKey = useMemo(
    () => resolveStorageKey(audience, driverId),
    [audience, driverId]
  );

  const [open, setOpen] = useState<boolean>(false);
  const [filterTab, setFilterTab] = useState<'ALL' | 'UNREAD' | 'ROLE_FOCUS'>(
    'ALL'
  );
  const [localReadIds, setLocalReadIds] = useState<Set<string>>(() =>
    readLocalReadSet(storageKey)
  );
  const [hasRecentArrivalHighlight, setHasRecentArrivalHighlight] =
    useState<boolean>(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const containerRef = useRef<HTMLDivElement | null>(null);
  const seenNotificationIdsRef = useRef<Set<string> | null>(null);

  // Sync local read set if storageKey changes (e.g., Driver account switches)
  useEffect(() => {
    setLocalReadIds(readLocalReadSet(storageKey));
    seenNotificationIdsRef.current = null;
  }, [storageKey]);

  // Refresh relative time labels every 30s while mounted
  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Close popover on outside click or Escape key
  useEffect(() => {
    if (!open) return;
    setNowMs(Date.now());
    const handlePointerDown = (event: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const scopedAssignments = useMemo(() => {
    if (audience !== 'DRIVER' || !driverId) return assignments;
    const norm = driverId.trim().toLowerCase();
    return assignments.filter(
      (a) =>
        a.driverId.trim().toLowerCase() === norm ||
        (a.driverCode || '').trim().toLowerCase() === norm
    );
  }, [assignments, audience, driverId]);

  const scopedNotifications = useMemo(() => {
    if (audience !== 'DRIVER' || !driverId) return notifications;
    const norm = driverId.trim().toLowerCase();
    return notifications.filter(
      (n) => n.driverId.trim().toLowerCase() === norm
    );
  }, [notifications, audience, driverId]);

  const assignmentByNoAndId = useMemo(() => {
    const byId = new Map<string, Assignment>();
    const byNo = new Map<string, Assignment>();
    for (const asg of scopedAssignments) {
      byId.set(asg.id, asg);
      byNo.set(asg.noPenugasan.trim().toLowerCase(), asg);
    }
    return { byId, byNo };
  }, [scopedAssignments]);

  const unifiedItems = useMemo<InAppNotificationItem[]>(() => {
    const items: InAppNotificationItem[] = [];
    const coveredTaskStageKeys = new Set<string>();

    for (const notif of scopedNotifications) {
      if (notif.eventType === 'UJI_JARINGAN') continue;
      const matchedAsg =
        (notif.assignmentId &&
          assignmentByNoAndId.byId.get(notif.assignmentId)) ||
        assignmentByNoAndId.byNo.get(notif.noPenugasan.trim().toLowerCase());

      const stageKey = `${notif.noPenugasan.trim().toLowerCase()}__${
        notif.eventType
      }`;
      coveredTaskStageKeys.add(stageKey);

      const parsedMs = parseFlexibleTimestamp(notif.timestamp) ?? new Date(notif.timestamp).getTime();
      const timestampMs = Number.isFinite(parsedMs) ? parsedMs : 0;
      const actorRole: 'ADMIN' | 'DRIVER' | 'SYSTEM' =
        notif.actorRole ||
        (notif.eventType === 'SURAT_TUGAS' ? 'ADMIN' : 'DRIVER');

      const serverMarkedRead =
        audience === 'DRIVER'
          ? Boolean(notif.readByDriver)
          : Boolean(notif.readByAdmin);
      const isRead = serverMarkedRead || localReadIds.has(notif.id);

      items.push({
        id: notif.id,
        isServerNotification: true,
        eventType: notif.eventType,
        actorRole,
        timestamp: notif.timestamp,
        timestampMs,
        title: getEventHeadline(
          notif.eventType,
          audience,
          actorRole,
          notif.summary
        ),
        summary: buildFallbackSummary(notif, audience, matchedAsg),
        noPenugasan: notif.noPenugasan,
        assignmentId: notif.assignmentId || matchedAsg?.id,
        driverId: notif.driverId || matchedAsg?.driverId || '',
        driverName:
          notif.driverName || matchedAsg?.driverName || driverName || 'Driver',
        plateNumber: notif.plateNumber || matchedAsg?.plateNumber || '-',
        destination: notif.destination || matchedAsg?.destination || '-',
        isRead,
      });
    }

    // Include real milestone events from assignments if notification log had not recorded them
    for (const asg of scopedAssignments) {
      const normNo = asg.noPenugasan.trim().toLowerCase();
      const jamTibaLabel = asg.jadwalJamTiba
        ? ` · Target tiba ${asg.jadwalJamTiba}`
        : '';

      const candidateMilestones: Array<{
        eventType: Exclude<WhatsAppEventType, 'UJI_JARINGAN'>;
        actorRole: 'ADMIN' | 'DRIVER';
        timestamp?: string;
        summary: string;
      }> = [
        {
          eventType: 'SURAT_TUGAS',
          actorRole: 'ADMIN',
          timestamp: asg.createdAt,
          summary:
            audience === 'DRIVER'
              ? `Penugasan armada ${asg.plateNumber} menuju ${asg.destination}${jamTibaLabel}.`
              : `Tugas baru diterbitkan untuk ${asg.driverName} (${asg.plateNumber}) menuju ${asg.destination}.`,
        },
      ];

      if (asg.departureData?.timestamp) {
        const origin =
          asg.departureData.titikKeberangkatan || asg.origin || 'titik awal';
        candidateMilestones.push({
          eventType: 'KEBERANGKATAN',
          actorRole: 'DRIVER',
          timestamp: asg.departureData.timestamp,
          summary:
            audience === 'DRIVER'
              ? `Keberangkatan armada ${asg.plateNumber} dari ${origin} menuju ${asg.destination} (KM ${asg.departureData.kmAwal.toLocaleString('id-ID')}${
                  asg.departureData.suhuAwal
                    ? `, Suhu ${asg.departureData.suhuAwal}`
                    : ''
                }).`
              : `${asg.driverName} (${asg.plateNumber}) mulai berangkat dari ${origin} menuju ${asg.destination} (KM ${asg.departureData.kmAwal.toLocaleString('id-ID')}${
                  asg.departureData.suhuAwal
                    ? `, Suhu ${asg.departureData.suhuAwal}`
                    : ''
                }).`,
        });
      }

      if (asg.deliveredAt) {
        candidateMilestones.push({
          eventType: 'DELIVERED',
          actorRole: 'DRIVER',
          timestamp: asg.deliveredAt,
          summary:
            audience === 'DRIVER'
              ? `Konfirmasi tiba di lokasi tujuan ${asg.destination} (${asg.plateNumber}) telah tercatat.`
              : `${asg.driverName} (${asg.plateNumber}) telah tiba di lokasi tujuan ${asg.destination}.`,
        });
      }

      if (asg.handoverData?.timestamp) {
        candidateMilestones.push({
          eventType: 'SERAH_TERIMA',
          actorRole: 'DRIVER',
          timestamp: asg.handoverData.timestamp,
          summary:
            audience === 'DRIVER'
              ? `Serah terima muatan ${asg.plateNumber}${
                  asg.handoverData.penerimaNama
                    ? ` kepada ${asg.handoverData.penerimaNama}`
                    : ''
                } di ${asg.destination} selesai.`
              : `Serah terima muatan ${asg.plateNumber} oleh ${asg.driverName}${
                  asg.handoverData.penerimaNama
                    ? ` kepada ${asg.handoverData.penerimaNama}`
                    : ''
                } di ${asg.destination} selesai.`,
        });
      }

      for (const m of candidateMilestones) {
        if (!m.timestamp) continue;
        const stageKey = `${normNo}__${m.eventType}`;
        if (coveredTaskStageKeys.has(stageKey)) continue;
        coveredTaskStageKeys.add(stageKey);

        const syntheticId = `ASG-EVT-${asg.id}-${m.eventType}`;
        const parsedMs = parseFlexibleTimestamp(m.timestamp) ?? new Date(m.timestamp).getTime();
        const timestampMs = Number.isFinite(parsedMs) ? parsedMs : 0;

        items.push({
          id: syntheticId,
          isServerNotification: false,
          eventType: m.eventType,
          actorRole: m.actorRole,
          timestamp: m.timestamp,
          timestampMs,
          title: getEventHeadline(m.eventType, audience, m.actorRole),
          summary: m.summary,
          noPenugasan: asg.noPenugasan,
          assignmentId: asg.id,
          driverId: asg.driverId,
          driverName: asg.driverName,
          plateNumber: asg.plateNumber,
          destination: asg.destination,
          isRead: localReadIds.has(syntheticId),
        });
      }
    }

    return items
      .sort((a, b) => b.timestampMs - a.timestampMs)
      .slice(0, 80);
  }, [
    scopedNotifications,
    scopedAssignments,
    assignmentByNoAndId,
    localReadIds,
    audience,
    driverName,
  ]);

  // Subtle transient highlight when a brand-new real-time notification arrives after initial mount
  useEffect(() => {
    if (seenNotificationIdsRef.current === null) {
      seenNotificationIdsRef.current = new Set(unifiedItems.map((i) => i.id));
      return;
    }
    let foundBrandNewUnread = false;
    for (const item of unifiedItems) {
      if (!seenNotificationIdsRef.current.has(item.id)) {
        seenNotificationIdsRef.current.add(item.id);
        if (!item.isRead) {
          foundBrandNewUnread = true;
        }
      }
    }
    if (foundBrandNewUnread) {
      setNowMs(Date.now());
      setHasRecentArrivalHighlight(true);
      const timer = window.setTimeout(() => {
        setHasRecentArrivalHighlight(false);
      }, 2800);
      return () => window.clearTimeout(timer);
    }
  }, [unifiedItems]);

  const unreadCount = useMemo(
    () => unifiedItems.reduce((acc, item) => acc + (item.isRead ? 0 : 1), 0),
    [unifiedItems]
  );

  const roleFocusCount = useMemo(
    () =>
      unifiedItems.reduce(
        (acc, item) =>
          acc +
          (audience === 'DRIVER'
            ? item.actorRole === 'ADMIN' || item.eventType === 'SURAT_TUGAS'
              ? 1
              : 0
            : item.actorRole === 'DRIVER'
            ? 1
            : 0),
        0
      ),
    [unifiedItems, audience]
  );

  const roleFocusUnreadCount = useMemo(
    () =>
      unifiedItems.reduce(
        (acc, item) =>
          acc +
          (!item.isRead &&
          (audience === 'DRIVER'
            ? item.actorRole === 'ADMIN' || item.eventType === 'SURAT_TUGAS'
            : item.actorRole === 'DRIVER')
            ? 1
            : 0),
        0
      ),
    [unifiedItems, audience]
  );

  const visibleItems = useMemo(() => {
    if (filterTab === 'UNREAD') {
      return unifiedItems.filter((item) => !item.isRead);
    }
    if (filterTab === 'ROLE_FOCUS') {
      return audience === 'DRIVER'
        ? unifiedItems.filter(
            (item) =>
              item.actorRole === 'ADMIN' || item.eventType === 'SURAT_TUGAS'
          )
        : unifiedItems.filter((item) => item.actorRole === 'DRIVER');
    }
    return unifiedItems;
  }, [unifiedItems, filterTab, audience]);

  const markItemsAsRead = (
    itemsToMark: InAppNotificationItem[],
    markAll = false
  ) => {
    if (itemsToMark.length === 0 && !markAll) return;
    setLocalReadIds((prev) => {
      const next = new Set(prev);
      for (const item of itemsToMark) {
        next.add(item.id);
      }
      if (markAll) {
        for (const item of unifiedItems) {
          next.add(item.id);
        }
      }
      persistLocalReadSet(storageKey, next);
      return next;
    });

    const serverIds = itemsToMark
      .filter((i) => i.isServerNotification)
      .map((i) => i.id);
    if (onMarkNotificationsRead && (markAll || serverIds.length > 0)) {
      void onMarkNotificationsRead(serverIds, markAll);
    }
  };

  const renderEventIcon = (
    eventType: Exclude<WhatsAppEventType, 'UJI_JARINGAN'>
  ) => {
    switch (eventType) {
      case 'SURAT_TUGAS':
        return (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-700">
            <ClipboardList className="h-4 w-4" />
          </div>
        );
      case 'KEBERANGKATAN':
        return (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-700">
            <Navigation className="h-4 w-4" />
          </div>
        );
      case 'DELIVERED':
        return (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-50 text-indigo-700">
            <MapPin className="h-4 w-4" />
          </div>
        );
      case 'SERAH_TERIMA':
        return (
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
            <PackageCheck className="h-4 w-4" />
          </div>
        );
    }
  };

  const isDriverAudience = audience === 'DRIVER';

  return (
    <div ref={containerRef} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={
          unreadCount > 0
            ? `${
                isDriverAudience
                  ? 'Notifikasi tugas Driver'
                  : 'Notifikasi aktivitas real-time'
              }: ${unreadCount} belum dibaca`
            : isDriverAudience
            ? 'Notifikasi tugas Driver'
            : 'Notifikasi aktivitas real-time'
        }
        title={
          unreadCount > 0
            ? `${unreadCount} notifikasi terbaru belum dibaca`
            : isDriverAudience
            ? 'Lihat daftar notifikasi Surat Tugas & status perjalanan Anda'
            : 'Lihat daftar notifikasi aktivitas Driver & Surat Tugas'
        }
        className={`relative inline-flex h-9 w-9 sm:h-[38px] sm:w-[38px] items-center justify-center rounded-lg border text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 ${
          open
            ? 'border-slate-900 bg-slate-900 text-white'
            : hasRecentArrivalHighlight
            ? 'border-sky-400 bg-sky-50 text-sky-900'
            : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900'
        }`}
      >
        <Bell className="h-4 w-4" />
        {unreadCount > 0 && (
          <span className="pointer-events-none absolute -right-1 -top-1 flex h-[17px] min-w-[17px] items-center justify-center rounded-full bg-red-600 px-1 font-mono text-[10px] font-bold leading-none text-white tabular-nums shadow-xs">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={
            isDriverAudience
              ? 'Pusat Notifikasi Real-Time Driver'
              : 'Pusat Notifikasi Real-Time Admin'
          }
          className="fixed inset-x-3 top-15 z-40 flex max-h-[calc(100dvh-4.75rem)] flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:max-h-[520px] sm:w-[410px] sm:rounded-xl"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 shrink-0">
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-slate-900">
                {isDriverAudience
                  ? 'Notifikasi Tugas & Perjalanan'
                  : 'Notifikasi Aktivitas Real-Time'}
              </h3>
              <p className="mt-0.5 text-xs text-slate-500 tabular-nums">
                {unreadCount > 0
                  ? `${unreadCount} belum dibaca${
                      roleFocusUnreadCount > 0
                        ? isDriverAudience
                          ? ` · ${roleFocusUnreadCount} tugas Dispatcher`
                          : ` · ${roleFocusUnreadCount} aktivitas Driver`
                        : ''
                    }`
                  : 'Seluruh notifikasi telah dibaca'}
              </p>
            </div>

            <div className="flex items-center gap-1.5 shrink-0">
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() =>
                    markItemsAsRead(
                      unifiedItems.filter((i) => !i.isRead),
                      true
                    )
                  }
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 transition-colors hover:bg-slate-50 hover:text-slate-900 whitespace-nowrap"
                >
                  <CheckCheck className="h-3.5 w-3.5 text-emerald-700" />
                  Tandai Semua Dibaca
                </button>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="Tutup panel notifikasi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="border-b border-slate-100 bg-slate-50/70 px-4 py-2 shrink-0">
            <div className="grid grid-cols-3 gap-1 rounded-lg bg-slate-200/70 p-1">
              {(
                [
                  ['ALL', `Semua (${unifiedItems.length})`],
                  ['UNREAD', `Belum Dibaca (${unreadCount})`],
                  [
                    'ROLE_FOCUS',
                    isDriverAudience
                      ? `Tugas Baru (${roleFocusCount})`
                      : `Aktivitas Driver (${roleFocusCount})`,
                  ],
                ] as const
              ).map(([tabKey, label]) => (
                <button
                  key={tabKey}
                  type="button"
                  onClick={() => setFilterTab(tabKey)}
                  className={`min-h-[34px] rounded-md px-2 py-1.5 text-[11px] font-semibold transition-colors tabular-nums truncate ${
                    filterTab === tabKey
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Notification Feed */}
          <div className="min-h-0 flex-1 overflow-y-auto divide-y divide-slate-100">
            {visibleItems.length === 0 ? (
              <div className="px-6 py-10 text-center">
                <Bell className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2.5 text-sm font-semibold text-slate-900">
                  {filterTab === 'UNREAD'
                    ? 'Tidak Ada Notifikasi Belum Dibaca'
                    : filterTab === 'ROLE_FOCUS'
                    ? isDriverAudience
                      ? 'Belum Ada Penugasan Baru dari Dispatcher'
                      : 'Belum Ada Aktivitas Driver Terbaru'
                    : 'Belum Ada Notifikasi Aktivitas'}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  {isDriverAudience
                    ? 'Notifikasi Surat Tugas baru dari Dispatcher serta konfirmasi keberangkatan, tiba di tujuan, dan serah terima akan tampil otomatis secara real-time.'
                    : 'Notifikasi tugas baru, keberangkatan armada, driver tiba di tujuan, dan serah terima akan tampil otomatis secara real-time.'}
                </p>
              </div>
            ) : (
              visibleItems.map((item) => {
                const matchedAssignment =
                  (item.assignmentId &&
                    assignmentByNoAndId.byId.get(item.assignmentId)) ||
                  assignmentByNoAndId.byNo.get(
                    item.noPenugasan.trim().toLowerCase()
                  );

                return (
                  <div
                    key={item.id}
                    className={`flex items-start gap-3 px-4 py-3.5 transition-colors ${
                      item.isRead
                        ? 'bg-white hover:bg-slate-50/80'
                        : 'bg-sky-50/50 hover:bg-sky-50/85'
                    }`}
                  >
                    {renderEventIcon(item.eventType)}

                    <button
                      type="button"
                      onClick={() => {
                        if (!item.isRead) {
                          markItemsAsRead([item], false);
                        }
                        setOpen(false);
                        onSelectNotificationAssignment({
                          assignment: matchedAssignment,
                          noPenugasan: item.noPenugasan,
                        });
                      }}
                      className="min-w-0 flex-1 text-left focus-visible:outline-none"
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <p
                          className={`truncate text-xs ${
                            item.isRead
                              ? 'font-semibold text-slate-700'
                              : 'font-bold text-slate-950'
                          }`}
                        >
                          {item.title}
                        </p>
                        <span className="shrink-0 font-mono text-[11px] text-slate-500 tabular-nums">
                          {formatRelativeTimeId(item.timestampMs, nowMs)}
                        </span>
                      </div>

                      <p
                        className={`mt-1 text-xs leading-relaxed ${
                          item.isRead ? 'text-slate-600' : 'text-slate-800'
                        }`}
                      >
                        {item.summary}
                      </p>

                      <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
                        <span className="font-semibold text-slate-700">
                          {item.noPenugasan}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{item.plateNumber}</span>
                        <span aria-hidden="true">·</span>
                        <span>{formatRealTimeTimestamp(item.timestamp)}</span>
                      </div>
                    </button>

                    {!item.isRead && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          markItemsAsRead([item], false);
                        }}
                        title="Tandai sudah dibaca"
                        aria-label={`Tandai notifikasi ${item.noPenugasan} sudah dibaca`}
                        className="mt-0.5 inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded-md p-1.5 text-sky-700 transition-colors hover:bg-sky-100 hover:text-sky-900 shrink-0"
                      >
                        <Check className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-slate-50 px-4 py-2.5 shrink-0">
            <span className="text-[11px] text-slate-500">
              {isDriverAudience
                ? 'Ketuk item untuk membuka penugasan terkait'
                : 'Klik item untuk membuka detail & riwayat penugasan'}
            </span>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenNotificationLogMenu();
              }}
              className="text-xs font-semibold text-slate-900 hover:underline whitespace-nowrap"
            >
              Riwayat Log WA
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
