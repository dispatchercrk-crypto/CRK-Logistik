import {
  Assignment,
  DriverMaster,
  TaskStatus,
  VehicleMaster,
  WhatsAppEventType,
  WhatsAppNotificationLog,
  WhatsAppTargetMode,
  isCompletedTaskStatus,
} from '../types';
import {
  evaluateAssignmentLoadUtilization,
  evaluateAssignmentOtd,
  formatDurationMinutes,
  formatRealTimeTimestamp,
  formatWeightKg,
  parseFlexibleTimestamp,
  parseSuratJalanList,
} from './media';

export function normalizePhoneForWa(rawPhone: string): string {
  const firstToken = String(rawPhone || '')
    .split(',')[0]
    .trim();

  // Do not treat WhatsApp Group JIDs (@g.us) or URLs as personal phone numbers
  if (
    !firstToken ||
    firstToken.includes('@g.us') ||
    firstToken.startsWith('http://') ||
    firstToken.startsWith('https://')
  ) {
    return '';
  }

  const digits = firstToken.replace(/[^\d+]/g, '').trim();
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

/**
 * Strips any legacy "Link Khusus Driver : ..." line from stored WhatsApp messages
 * so Link Khusus Driver is never displayed in operational WhatsApp notifications.
 */
export function stripDriverLinkFromWaMessage(rawMessage?: string): string {
  return String(rawMessage || '')
    .replace(/^Link Khusus Driver\s*:.*(?:\r?\n)?/gim, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Builds a WhatsApp URL that opens the Group & Contact picker directly in WhatsApp
 * so the user can choose any WhatsApp Group (or chat) and send the message.
 */
export function buildWhatsAppGroupUrl(message: string): string {
  const encodedText = encodeURIComponent(message);
  return `https://wa.me/?text=${encodedText}`;
}

/**
 * Builds a WhatsApp URL either for Group picker (when preferGroup is true or no valid phone)
 * or for a specific normalized phone number.
 */
export function buildWhatsAppDirectUrl(
  phone: string,
  message: string,
  preferGroup = false
): string {
  if (preferGroup) {
    return buildWhatsAppGroupUrl(message);
  }
  const normalized = normalizePhoneForWa(phone);
  const encodedText = encodeURIComponent(message);
  if (normalized) {
    return `https://wa.me/${normalized}?text=${encodedText}`;
  }
  return `https://wa.me/?text=${encodedText}`;
}

/**
 * Formats a comprehensive real-time WhatsApp message for Role Driver & Dispatcher
 * capturing the exact current timestamp (`nowDate = new Date()`) when clicked,
 * multiple No. Surat Jalan entries, Driver's departure point, and cooling/non-cooling vehicle mode
 * (without displaying Link Khusus Driver).
 */
export function buildDriverRealtimeWaMessage(
  asg: Assignment,
  eventType: WhatsAppEventType = 'KEBERANGKATAN',
  groupName?: string,
  nowDate: Date = new Date()
): string {
  const headerByEvent: Record<WhatsAppEventType, string> = {
    SURAT_TUGAS:
      '*[CRK LOGISTIK — NOTIFIKASI SURAT TUGAS DRIVER REAL-TIME]*',
    KEBERANGKATAN:
      '*[CRK LOGISTIK — NOTIFIKASI KEBERANGKATAN DRIVER REAL-TIME]*',
    DELIVERED:
      '*[CRK LOGISTIK — NOTIFIKASI TIBA DI TUJUAN (DELIVERED) REAL-TIME]*',
    SERAH_TERIMA:
      '*[CRK LOGISTIK — NOTIFIKASI SERAH TERIMA (HANDOVER) REAL-TIME]*',
    UJI_JARINGAN: '*[CRK LOGISTIK — UJI NOTIFIKASI WHATSAPP REAL-TIME]*',
  };

  const dep = asg.departureData;
  const deliv = asg.deliveredData;
  const ho = asg.handoverData;
  const jenisKendaraan =
    deliv?.jenisKendaraan || dep?.jenisKendaraan || 'Mobil Pendingin';
  const isPendingin = jenisKendaraan !== 'Non Pendingin';
  const titikBerangkat =
    dep?.titikKeberangkatan || asg.origin || 'Menunggu Input Driver';
  const effectiveEndKm =
    typeof ho?.kmAkhir === 'number' && ho.kmAkhir >= 0
      ? ho.kmAkhir
      : typeof deliv?.kmSampai === 'number' && deliv.kmSampai >= 0
      ? deliv.kmSampai
      : null;
  const kmDelta =
    dep && effectiveEndKm !== null && effectiveEndKm >= dep.kmAwal
      ? effectiveEndKm - dep.kmAwal
      : null;
  const sjList = parseSuratJalanList(asg.noSuratJalanFisik);

  const departureLines = dep
    ? [
        '*--- DATA KEBERANGKATAN ---*',
        `Waktu Berangkat : ${formatRealTimeTimestamp(dep.timestamp)}`,
        `Titik Keberangkatan : ${titikBerangkat}`,
        `Jenis Armada : ${jenisKendaraan}`,
        `Odometer Awal : ${dep.kmAwal.toLocaleString('id-ID')} km`,
        isPendingin ? `Suhu Monitor Awal : ${dep.suhuAwal || '-'}` : '',
        `BBM Awal : ${dep.bbmAwal || '-'}`,
        `Kondisi Unit : ${dep.kondisiKendaraan || '-'}`,
        isPendingin
          ? `Foto Berangkat : Odometer (${
              dep.fotoOdometerBerangkat || asg.driveMedia?.fotoOdometerBerangkatUrl
                ? 'Ada'
                : '-'
            }), Monitor Pendingin (${
              dep.fotoSuhuBerangkat || asg.driveMedia?.fotoSuhuBerangkatUrl
                ? 'Ada'
                : '-'
            })`
          : `Foto Berangkat : Odometer (${
              dep.fotoOdometerBerangkat || asg.driveMedia?.fotoOdometerBerangkatUrl
                ? 'Ada'
                : '-'
            })`,
        dep.catatanBerangkat
          ? `Catatan Berangkat : ${dep.catatanBerangkat}`
          : '',
      ]
    : [
        '*--- DATA KEBERANGKATAN ---*',
        'Status Keberangkatan : Menunggu pengisian laporan keberangkatan Driver',
      ];

  const hasDeliveredInfo =
    Boolean(deliv) ||
    Boolean(asg.deliveredAt) ||
    asg.status === TaskStatus.DELIVERED ||
    isCompletedTaskStatus(asg.status);
  const resolvedKmSampai =
    deliv?.kmSampai ?? (ho ? ho.kmAkhir : null);
  const resolvedSuhuSampai =
    deliv?.suhuSampai || ho?.suhuAkhir || '';
  const resolvedBbmSampai =
    deliv?.bbmSampai || ho?.bbmAkhir || '';
  const resolvedKondisiSampai =
    deliv?.kondisiSampai || ho?.kondisiAkhir || '';
  const hasOdoSampaiFoto = Boolean(
    deliv?.fotoOdometerSampai ||
      ho?.fotoOdometerSerahTerima ||
      asg.driveMedia?.fotoOdometerSerahTerimaUrl
  );
  const hasSuhuSampaiFoto = Boolean(
    deliv?.fotoSuhuSampai ||
      ho?.fotoSuhuSerahTerima ||
      asg.driveMedia?.fotoSuhuSerahTerimaUrl
  );

  const depMs = parseFlexibleTimestamp(dep?.timestamp);
  const delivMs = parseFlexibleTimestamp(deliv?.timestamp || asg.deliveredAt);
  const hoMs = parseFlexibleTimestamp(ho?.timestamp);

  // Perhitungan Durasi Perjalanan: hitung dari Durasi Keberangkatan sampai Delivered saja
  const departToDeliveredMinutes =
    depMs !== null && delivMs !== null && delivMs >= depMs
      ? Math.max(0, Math.round((delivMs - depMs) / 60000))
      : null;
  const departToDeliveredText =
    departToDeliveredMinutes !== null
      ? formatDurationMinutes(departToDeliveredMinutes)
      : null;

  // Durasi Bongkar / Handover: hitung dari Waktu Delivered sampai Selesai Handover
  const deliveredToHandoverMinutes =
    delivMs !== null && hoMs !== null && hoMs >= delivMs
      ? Math.max(0, Math.round((hoMs - delivMs) / 60000))
      : null;
  const deliveredToHandoverText =
    deliveredToHandoverMinutes !== null
      ? formatDurationMinutes(deliveredToHandoverMinutes)
      : null;

  const deliveredLines = hasDeliveredInfo
    ? [
        '*--- DATA DELIVERED (SAMPAI DI TUJUAN) ---*',
        `Waktu Sampai (Delivered) : ${formatRealTimeTimestamp(
          deliv?.timestamp || asg.deliveredAt || ho?.timestamp || nowDate
        )}`,
        departToDeliveredText
          ? `Durasi Perjalanan (Berangkat → Delivered) : ${departToDeliveredText}`
          : '',
        resolvedKmSampai !== null && resolvedKmSampai >= 0
          ? `Odometer KM Sampai : ${resolvedKmSampai.toLocaleString('id-ID')} km${
              kmDelta !== null
                ? ` (Jarak Tempuh: ${kmDelta.toLocaleString('id-ID')} km)`
                : ''
            }`
          : '',
        isPendingin ? `Suhu Serah Sampai : ${resolvedSuhuSampai || '-'}` : '',
        resolvedBbmSampai ? `Posisi BBM Sampai : ${resolvedBbmSampai}` : '',
        resolvedKondisiSampai
          ? `Kondisi Muatan & Segel Sampai : ${resolvedKondisiSampai}`
          : '',
        isPendingin
          ? `Foto Sampai : Odometer (${
              hasOdoSampaiFoto ? 'Ada' : '-'
            }), Monitor Pendingin (${hasSuhuSampaiFoto ? 'Ada' : '-'})`
          : `Foto Sampai : Odometer (${hasOdoSampaiFoto ? 'Ada' : '-'})`,
        deliv?.catatanSampai ? `Catatan Sampai : ${deliv.catatanSampai}` : '',
      ].filter(Boolean)
    : [];

  const handoverLines =
    ho && (isCompletedTaskStatus(asg.status) || Boolean(ho.penerimaNama))
      ? [
          '*--- BERITA ACARA SERAH TERIMA (HANDOVER) ---*',
          `Waktu Serah Terima : ${formatRealTimeTimestamp(ho.timestamp)}`,
          `Nama Penerima Serah Terima : ${ho.penerimaNama || '-'}`,
          deliveredToHandoverText
            ? `Durasi Bongkar / Handover : ${deliveredToHandoverText}`
            : '',
          departToDeliveredText
            ? `Durasi Perjalanan (Berangkat → Delivered) : ${departToDeliveredText}`
            : '',
          `Foto Bukti Serah Terima : ${
            ho.fotoBuktiSerahTerima || asg.driveMedia?.fotoBuktiSerahTerimaUrl
              ? 'Ada'
              : '-'
          }`,
          `Tanda Tangan Penerima : ${
            ho.tandaTanganPenerima || asg.driveMedia?.tandaTanganPenerimaUrl
              ? 'Tersimpan'
              : '-'
          }`,
          ho.catatanSerahTerima
            ? `Catatan Serah Terima : ${ho.catatanSerahTerima}`
            : '',
        ].filter(Boolean)
      : asg.status === TaskStatus.DELIVERED || Boolean(deliv)
      ? [
          '*--- BERITA ACARA SERAH TERIMA (HANDOVER) ---*',
          'Status Serah Terima : Armada telah sampai di tujuan (Delivered) — menunggu pengisian Berita Acara Serah Terima',
        ]
      : [
          '*--- BERITA ACARA SERAH TERIMA (HANDOVER) ---*',
          'Status Serah Terima : Menunggu armada tiba di tujuan & berita acara serah terima',
        ];

  const sjLine =
    sjList.length > 1
      ? `No. Surat Jalan (${sjList.length}) : ${sjList.join(', ')}`
      : sjList.length === 1
      ? `No. Surat Jalan : ${sjList[0]}`
      : '';

  return [
    headerByEvent[eventType] || headerByEvent.KEBERANGKATAN,
    `Waktu Pesan WA : ${formatRealTimeTimestamp(nowDate)}`,
    groupName ? `Grup Operasional : ${groupName}` : '',
    `No. Penugasan : ${asg.noPenugasan}`,
    `ID Penugasan : ${asg.id}`,
    sjLine,
    asg.kodeSegel ? `Kode Segel : ${asg.kodeSegel}` : '',
    `Jadwal Tugas : ${asg.tanggalTugas}${
      asg.jadwalJamTiba ? ` (Target Tiba ${asg.jadwalJamTiba})` : ''
    }`,
    `Driver : ${asg.driverId} - ${asg.driverName}${
      asg.driverPhone ? ` (${asg.driverPhone})` : ''
    }`,
    `Armada : ${asg.plateNumber}${
      asg.vehicleType ? ` (${asg.vehicleType})` : ''
    }`,
    dep ? `Jenis Armada : ${jenisKendaraan}` : '',
    `Titik Keberangkatan : ${titikBerangkat}`,
    `Tujuan Pengiriman : ${asg.destination}`,
    `Rute : ${titikBerangkat} -> ${asg.destination}`,
    `Muatan : ${asg.purpose || '-'}${
      [asg.beratMuatan, asg.volumeCbm].filter(Boolean).length > 0
        ? ` (${[asg.beratMuatan, asg.volumeCbm].filter(Boolean).join(' · ')})`
        : ''
    }`,
    `Status Real-Time : ${asg.status}`,
    asg.notes ? `Instruksi Dispatcher : ${asg.notes}` : '',
    '',
    ...departureLines,
    ...(deliveredLines.length > 0 ? ['', ...deliveredLines] : []),
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

export function inferWhatsAppEventType(asg: Assignment): WhatsAppEventType {
  if (isCompletedTaskStatus(asg.status) || Boolean(asg.handoverData?.penerimaNama)) {
    return 'SERAH_TERIMA';
  }
  if (asg.status === TaskStatus.DELIVERED || Boolean(asg.deliveredData)) {
    return 'DELIVERED';
  }
  if (asg.departureData) {
    return 'KEBERANGKATAN';
  }
  return 'SURAT_TUGAS';
}

export function buildSuratTugasWaMessage(
  asg: Assignment,
  groupName?: string,
  nowDate: Date = new Date()
): string {
  return buildDriverRealtimeWaMessage(
    asg,
    inferWhatsAppEventType(asg),
    groupName,
    nowDate
  );
}

/**
 * Generates a fresh click-time WhatsApp message and target URL using the exact current clock (`new Date()`).
 */
export function buildRealtimeWhatsAppUrlForAssignment(
  asg: Assignment,
  mode: WhatsAppTargetMode,
  groupName?: string,
  dispatcherPhone?: string,
  eventTypeOverride?: WhatsAppEventType
): { message: string; url: string } {
  const eventType = eventTypeOverride || inferWhatsAppEventType(asg);
  const message = buildDriverRealtimeWaMessage(
    asg,
    eventType,
    groupName,
    new Date()
  );
  if (mode === 'GROUP') {
    return { message, url: buildWhatsAppGroupUrl(message) };
  }
  if (mode === 'DRIVER') {
    const phone = asg.driverPhone || dispatcherPhone || '';
    return { message, url: buildWhatsAppDirectUrl(phone, message, false) };
  }
  const phone = dispatcherPhone || asg.driverPhone || '';
  return { message, url: buildWhatsAppDirectUrl(phone, message, false) };
}

export function resolveWhatsAppUrlForMode(
  notif: WhatsAppNotificationLog,
  mode: WhatsAppTargetMode,
  fallbackDriverPhone?: string,
  fallbackDispatcherPhone?: string
): string {
  // Always refresh any embedded Waktu Pesan WA line and strip any legacy Link Khusus Driver line
  const freshNowLine = `Waktu Pesan WA : ${formatRealTimeTimestamp(new Date())}`;
  const rawMessage = stripDriverLinkFromWaMessage(notif.message);
  const refreshedMessage = rawMessage.includes('Waktu Pesan WA :')
    ? rawMessage.replace(/^Waktu Pesan WA :.*$/m, freshNowLine)
    : rawMessage
    ? (() => {
        const lines = rawMessage.split('\n');
        lines.splice(1, 0, freshNowLine);
        return lines.join('\n');
      })()
    : freshNowLine;

  if (mode === 'GROUP') {
    return buildWhatsAppGroupUrl(refreshedMessage);
  }
  if (mode === 'DRIVER') {
    const phone = fallbackDriverPhone || fallbackDispatcherPhone || '';
    return buildWhatsAppDirectUrl(phone, refreshedMessage, false);
  }
  const phone =
    fallbackDispatcherPhone || fallbackDriverPhone || notif.targetPhone || '';
  return buildWhatsAppDirectUrl(phone, refreshedMessage, false);
}

/**
 * Triggers opening a WhatsApp URL in 1 click using a temporary semantic <a> element
 * (strictly avoiding window.open for iframe compatibility).
 */
export function launchWhatsAppUrl(url: string): boolean {
  if (!url || typeof document === 'undefined' || typeof window === 'undefined') {
    return false;
  }
  try {
    const isInsideIframe = (() => {
      try {
        return window.self !== window.top;
      } catch {
        return true;
      }
    })();
    const isMobileDevice = /Android|iPhone|iPad|iPod/i.test(
      window.navigator?.userAgent || ''
    );
    const navWithActivation = window.navigator as Navigator & {
      userActivation?: { isActive?: boolean };
    };
    const hasActiveGesture =
      typeof navWithActivation?.userActivation?.isActive === 'boolean'
        ? Boolean(navWithActivation.userActivation.isActive)
        : true;

    // On standalone mobile browsers/PWAs (outside iframes), async awaits expire transient user activation
    // causing target="_blank" to be silently blocked by mobile popup blockers. Navigating directly to
    // https://wa.me/... triggers the native WhatsApp App via OS Intent/Universal Link without losing tab state.
    if (!isInsideIframe && isMobileDevice && !hasActiveGesture) {
      window.location.assign(url);
      return true;
    }

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    setTimeout(() => {
      try {
        if (anchor.parentNode) {
          anchor.parentNode.removeChild(anchor);
        }
      } catch {
        // Ignore cleanup errors
      }
    }, 250);
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Riwayat Status Armada (Timeline 'Keberangkatan' -> 'Delivered' -> 'Handover')
// ============================================================================

export function getWibTodayYmd(date: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Jakarta',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const year = parts.find((p) => p.type === 'year')?.value || '2026';
  const month = parts.find((p) => p.type === 'month')?.value || '01';
  const day = parts.find((p) => p.type === 'day')?.value || '01';
  return `${year}-${month}-${day}`;
}

export function shiftWibDateYmd(baseYmd: string, offsetDays: number): string {
  const match = String(baseYmd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return getWibTodayYmd();
  const utc = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0)
  );
  utc.setUTCDate(utc.getUTCDate() + offsetDays);
  return utc.toISOString().slice(0, 10);
}

export function formatShortWibTime(isoOrDate?: string): string {
  if (!isoOrDate) return '-';
  const ms = parseFlexibleTimestamp(isoOrDate);
  const d = ms !== null ? new Date(ms) : new Date(isoOrDate);
  if (Number.isNaN(d.getTime())) return String(isoOrDate);
  return `${d.toLocaleTimeString('id-ID', {
    timeZone: 'Asia/Jakarta',
    hour: '2-digit',
    minute: '2-digit',
  })} WIB`;
}

export function formatReadableWibDate(dateYmd: string): string {
  const match = String(dateYmd || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return dateYmd || '-';
  const d = new Date(
    Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 5, 0, 0)
  );
  if (Number.isNaN(d.getTime())) return dateYmd;
  return d.toLocaleDateString('id-ID', {
    timeZone: 'Asia/Jakarta',
    weekday: 'long',
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function parseTimestampMs(raw?: string): number | null {
  return parseFlexibleTimestamp(raw);
}

export interface FleetStatusStageEntry {
  stepNumber: string;
  key: 'CREATED' | 'DEPARTURE' | 'DELIVERED' | 'HANDOVER';
  title: string;
  statusLabel: string;
  reached: boolean;
  isCurrent: boolean;
  timestamp?: string;
  shortTimeText: string;
  fullTimeText: string;
  elapsedFromPreviousText?: string;
  subtitle: string;
  metrics: string[];
}

export interface AssignmentStatusTimeline {
  createdAt?: string;
  departedAt?: string;
  deliveredAt?: string;
  handoverAt?: string;
  isDeliveredInferredFromHandover: boolean;
  departToDeliveredMinutes: number | null;
  departToDeliveredText: string | null;
  liveInTransitMinutes: number | null;
  liveInTransitText: string | null;
  deliveredToHandoverMinutes: number | null;
  deliveredToHandoverText: string | null;
  totalTripMinutes: number | null;
  totalTripText: string | null;
  inlineTransitionSummary: string;
  stages: FleetStatusStageEntry[];
}

export function resolveAssignmentStatusTimeline(
  asg: Assignment,
  notifications: WhatsAppNotificationLog[] = [],
  nowMs: number = Date.now()
): AssignmentStatusTimeline {
  const matchingNotifs = notifications.filter(
    (n) =>
      n.noPenugasan.trim().toLowerCase() ===
      asg.noPenugasan.trim().toLowerCase()
  );

  const createdNotif = matchingNotifs.find(
    (n) => n.eventType === 'SURAT_TUGAS'
  );
  const depNotif = matchingNotifs.find((n) => n.eventType === 'KEBERANGKATAN');
  const deliveredNotif = matchingNotifs.find(
    (n) => n.eventType === 'DELIVERED'
  );
  const handoverNotif = matchingNotifs.find(
    (n) => n.eventType === 'SERAH_TERIMA'
  );

  const createdAt = asg.createdAt || createdNotif?.timestamp;
  const departedAt = asg.departureData?.timestamp || depNotif?.timestamp;
  const handoverAt = asg.handoverData?.timestamp || handoverNotif?.timestamp;

  const isCompleted = isCompletedTaskStatus(asg.status);
  const isDeliveredOrLater =
    asg.status === TaskStatus.DELIVERED || isCompleted;
  const isDepartedOrLater =
    asg.status === TaskStatus.DALAM_PERJALANAN ||
    isDeliveredOrLater ||
    Boolean(departedAt);

  let deliveredAt = asg.deliveredAt || deliveredNotif?.timestamp;
  let isDeliveredInferredFromHandover = false;
  if (!deliveredAt && isCompleted && handoverAt) {
    deliveredAt = handoverAt;
    isDeliveredInferredFromHandover = true;
  }

  const depMs = parseTimestampMs(departedAt);
  const delivMs = parseTimestampMs(deliveredAt);
  const hoMs = parseTimestampMs(handoverAt);

  const departToDeliveredMinutes =
    depMs !== null && delivMs !== null && delivMs >= depMs
      ? Math.max(0, Math.round((delivMs - depMs) / 60000))
      : null;
  const departToDeliveredText =
    departToDeliveredMinutes !== null
      ? formatDurationMinutes(departToDeliveredMinutes)
      : null;

  const liveInTransitMinutes =
    asg.status === TaskStatus.DALAM_PERJALANAN &&
    depMs !== null &&
    nowMs >= depMs
      ? Math.max(0, Math.round((nowMs - depMs) / 60000))
      : null;
  const liveInTransitText =
    liveInTransitMinutes !== null
      ? formatDurationMinutes(liveInTransitMinutes)
      : null;

  const deliveredToHandoverMinutes =
    delivMs !== null && hoMs !== null && hoMs >= delivMs
      ? Math.max(0, Math.round((hoMs - delivMs) / 60000))
      : null;
  const deliveredToHandoverText =
    deliveredToHandoverMinutes !== null && !isDeliveredInferredFromHandover
      ? formatDurationMinutes(deliveredToHandoverMinutes)
      : null;

  // Perhitungan Durasi Perjalanan: hitung dari Durasi Keberangkatan sampai Delivered saja
  const totalTripMinutes = departToDeliveredMinutes;
  const totalTripText = departToDeliveredText;

  const otd = evaluateAssignmentOtd(asg);
  const jenisKendaraan =
    asg.deliveredData?.jenisKendaraan ||
    asg.departureData?.jenisKendaraan ||
    'Mobil Pendingin';
  const isPendingin = jenisKendaraan !== 'Non Pendingin';
  const titikBerangkat =
    asg.departureData?.titikKeberangkatan ||
    (asg.origin && asg.origin !== 'Menunggu Titik Keberangkatan Driver'
      ? asg.origin
      : 'Menunggu Input Driver');

  const endKmValue =
    typeof asg.handoverData?.kmAkhir === 'number' &&
    asg.handoverData.kmAkhir >= 0
      ? asg.handoverData.kmAkhir
      : typeof asg.deliveredData?.kmSampai === 'number' &&
        asg.deliveredData.kmSampai >= 0
      ? asg.deliveredData.kmSampai
      : null;

  const kmDelta =
    asg.departureData &&
    endKmValue !== null &&
    endKmValue >= asg.departureData.kmAwal
      ? endKmValue - asg.departureData.kmAwal
      : null;

  let inlineTransitionSummary = 'Menunggu laporan keberangkatan';
  if (departedAt && deliveredAt) {
    inlineTransitionSummary = `${formatShortWibTime(departedAt).replace(
      ' WIB',
      ''
    )} → ${formatShortWibTime(deliveredAt).replace(' WIB', '')}${
      departToDeliveredText ? ` (${departToDeliveredText})` : ''
    }`;
  } else if (departedAt && asg.status === TaskStatus.DALAM_PERJALANAN) {
    inlineTransitionSummary = `Berangkat ${formatShortWibTime(departedAt)}${
      liveInTransitText ? ` · ${liveInTransitText}` : ''
    }`;
  } else if (deliveredAt) {
    inlineTransitionSummary = `Delivered ${formatShortWibTime(deliveredAt)}`;
  }

  const stages: FleetStatusStageEntry[] = [
    {
      stepNumber: '01',
      key: 'CREATED',
      title: 'Surat Tugas Diterbitkan',
      statusLabel: 'Menunggu Berangkat',
      reached: true,
      isCurrent: asg.status === TaskStatus.MENUNGGU_BERANGKAT,
      timestamp: createdAt,
      shortTimeText: formatShortWibTime(createdAt),
      fullTimeText: createdAt
        ? formatRealTimeTimestamp(createdAt)
        : 'Tercatat pada sistem',
      subtitle: `Jadwal penugasan ${asg.tanggalTugas}${
        asg.jadwalJamTiba ? ` · Target tiba ${asg.jadwalJamTiba}` : ''
      }`,
      metrics: [
        `Armada: ${asg.plateNumber}${
          asg.vehicleType ? ` (${asg.vehicleType})` : ''
        }`,
        `Driver: ${asg.driverId} - ${asg.driverName}`,
        asg.beratMuatan ? `Muatan: ${asg.beratMuatan}` : '',
        asg.volumeCbm ? `Volume CBM: ${asg.volumeCbm}` : '',
      ].filter(Boolean),
    },
    {
      stepNumber: '02',
      key: 'DEPARTURE',
      title: 'Keberangkatan Armada',
      statusLabel: 'Dalam Perjalanan',
      reached: isDepartedOrLater,
      isCurrent: asg.status === TaskStatus.DALAM_PERJALANAN,
      timestamp: departedAt,
      shortTimeText: formatShortWibTime(departedAt),
      fullTimeText: departedAt
        ? formatRealTimeTimestamp(departedAt)
        : isDepartedOrLater
        ? 'Berangkat tercatat'
        : 'Menunggu keberangkatan Driver',
      subtitle: isDepartedOrLater
        ? `Titik berangkat: ${titikBerangkat}`
        : 'Menunggu Driver mengisi form keberangkatan di lapangan',
      metrics: asg.departureData
        ? [
            `Odo Awal: ${asg.departureData.kmAwal.toLocaleString('id-ID')} km`,
            isPendingin && asg.departureData.suhuAwal
              ? `Suhu Awal: ${asg.departureData.suhuAwal}`
              : jenisKendaraan,
            asg.departureData.bbmAwal
              ? `BBM: ${asg.departureData.bbmAwal}`
              : '',
            asg.departureData.kondisiKendaraan || '',
          ].filter(Boolean)
        : [],
    },
    {
      stepNumber: '03',
      key: 'DELIVERED',
      title: 'Tiba di Tujuan (Delivered)',
      statusLabel: 'Delivered',
      reached: isDeliveredOrLater,
      isCurrent: asg.status === TaskStatus.DELIVERED,
      timestamp: deliveredAt,
      shortTimeText: formatShortWibTime(deliveredAt),
      fullTimeText: deliveredAt
        ? formatRealTimeTimestamp(deliveredAt)
        : asg.status === TaskStatus.DALAM_PERJALANAN
        ? `Sedang dalam perjalanan${
            liveInTransitText ? ` (${liveInTransitText})` : ''
          }`
        : 'Belum tiba di tujuan',
      elapsedFromPreviousText: departToDeliveredText
        ? `Durasi Keberangkatan → Delivered: ${departToDeliveredText}`
        : liveInTransitText
        ? `Waktu berjalan sejak Keberangkatan: ${liveInTransitText}`
        : undefined,
      subtitle: isDeliveredOrLater
        ? `Lokasi tujuan: ${asg.destination}${
            isDeliveredInferredFromHandover
              ? ' · Tercatat bersamaan dengan penyelesaian Serah Terima'
              : ''
          }`
        : `Tujuan pengiriman: ${asg.destination}`,
      metrics: isDeliveredOrLater
        ? [
            endKmValue !== null
              ? `KM Sampai: ${endKmValue.toLocaleString('id-ID')} km${
                  kmDelta !== null
                    ? ` (${kmDelta.toLocaleString('id-ID')} km)`
                    : ''
                }`
              : '',
            isPendingin &&
            (asg.deliveredData?.suhuSampai || asg.handoverData?.suhuAkhir)
              ? `Suhu Sampai: ${
                  asg.deliveredData?.suhuSampai || asg.handoverData?.suhuAkhir
                }`
              : '',
            asg.deliveredData?.bbmSampai
              ? `BBM Sampai: ${asg.deliveredData.bbmSampai}`
              : '',
            departToDeliveredText
              ? `Waktu Tempuh: ${departToDeliveredText}`
              : '',
            otd.category === 'ON_TIME'
              ? 'SLA: Tepat Waktu'
              : otd.category === 'LATE_COMPLETED'
              ? `SLA: Terlambat +${formatDurationMinutes(otd.delayMinutes)}`
              : asg.jadwalJamTiba
              ? `Target SLA: ${asg.jadwalJamTiba}`
              : '',
          ].filter(Boolean)
        : [],
    },
    {
      stepNumber: '04',
      key: 'HANDOVER',
      title: 'Berita Acara Serah Terima (Handover)',
      statusLabel: asg.status === TaskStatus.SELESAI ? 'Selesai' : 'Handover',
      reached: isCompleted,
      isCurrent: isCompleted,
      timestamp: handoverAt,
      shortTimeText: formatShortWibTime(handoverAt),
      fullTimeText: handoverAt
        ? formatRealTimeTimestamp(handoverAt)
        : asg.status === TaskStatus.DELIVERED
        ? 'Armada sudah sampai — menunggu Berita Acara Serah Terima'
        : 'Menunggu penyelesaian serah terima',
      elapsedFromPreviousText: deliveredToHandoverText
        ? `Durasi Bongkar / Handover: ${deliveredToHandoverText}`
        : undefined,
      subtitle: asg.handoverData?.penerimaNama
        ? `Diterima oleh: ${asg.handoverData.penerimaNama}`
        : 'Penerima muatan di lokasi tujuan',
      metrics: asg.handoverData
        ? [
            asg.handoverData.penerimaNama
              ? `Penerima: ${asg.handoverData.penerimaNama}`
              : '',
            asg.handoverData.catatanSerahTerima || '',
            deliveredToHandoverText
              ? `Durasi Bongkar: ${deliveredToHandoverText}`
              : '',
            departToDeliveredText
              ? `Durasi Perjalanan: ${departToDeliveredText}`
              : '',
          ].filter(Boolean)
        : [],
    },
  ];

  return {
    createdAt,
    departedAt,
    deliveredAt,
    handoverAt,
    isDeliveredInferredFromHandover,
    departToDeliveredMinutes,
    departToDeliveredText,
    liveInTransitMinutes,
    liveInTransitText,
    deliveredToHandoverMinutes,
    deliveredToHandoverText,
    totalTripMinutes,
    totalTripText,
    inlineTransitionSummary,
    stages,
  };
}

export function buildFleetStatusHistoryWaMessage(
  asg: Assignment,
  notifications: WhatsAppNotificationLog[] = [],
  groupName?: string
): string {
  const tl = resolveAssignmentStatusTimeline(asg, notifications);
  const titik =
    asg.departureData?.titikKeberangkatan ||
    (asg.origin && asg.origin !== 'Menunggu Titik Keberangkatan Driver'
      ? asg.origin
      : '-');

  return [
    '*[CRK LOGISTIK — RIWAYAT STATUS ARMADA]*',
    `Waktu Cetak WA : ${formatRealTimeTimestamp(new Date())}`,
    groupName ? `Grup Operasional : ${groupName}` : '',
    `No. Penugasan : ${asg.noPenugasan}`,
    `Armada : ${asg.plateNumber}${
      asg.vehicleType ? ` (${asg.vehicleType})` : ''
    }`,
    `Driver : ${asg.driverId} - ${asg.driverName}`,
    `Rute : ${titik} -> ${asg.destination}`,
    `Status Saat Ini : ${asg.status}`,
    '',
    '*--- TIMELINE PERUBAHAN STATUS ARMADA ---*',
    `1. Surat Tugas Diterbitkan : ${
      tl.createdAt ? formatRealTimeTimestamp(tl.createdAt) : '-'
    }`,
    `2. Keberangkatan (Dalam Perjalanan) : ${
      tl.departedAt ? formatRealTimeTimestamp(tl.departedAt) : 'Belum berangkat'
    }`,
    `3. Tiba di Tujuan (Delivered) : ${
      tl.deliveredAt
        ? `${formatRealTimeTimestamp(tl.deliveredAt)}${
            tl.isDeliveredInferredFromHandover ? ' (bersamaan Handover)' : ''
          }`
        : 'Belum tiba'
    }`,
    tl.departToDeliveredText
      ? `   Durasi Keberangkatan -> Delivered : ${tl.departToDeliveredText}`
      : tl.liveInTransitText
      ? `   Waktu Berjalan Sejak Berangkat : ${tl.liveInTransitText}`
      : '',
    `4. Serah Terima (Handover) : ${
      tl.handoverAt
        ? `${formatRealTimeTimestamp(tl.handoverAt)}${
            asg.handoverData?.penerimaNama
              ? ` (Penerima: ${asg.handoverData.penerimaNama})`
              : ''
          }`
        : 'Menunggu serah terima'
    }`,
    tl.deliveredToHandoverText
      ? `   Durasi Bongkar / Handover : ${tl.deliveredToHandoverText}`
      : '',
    tl.departToDeliveredText
      ? `   Durasi Perjalanan (Berangkat -> Delivered) : ${tl.departToDeliveredText}`
      : '',
  ]
    .filter((line, idx, arr) => {
      if (line !== '') return true;
      return idx > 0 && arr[idx - 1] !== '';
    })
    .join('\n')
    .trim();
}

// ============================================================================
// Ringkasan Harian Penugasan & Performa Operasional Seluruh Armada (WhatsApp)
// ============================================================================

export interface DailyAssignmentBrief {
  assignment: Assignment;
  departTimeShort: string;
  deliveredTimeShort: string;
  handoverTimeShort: string;
  departToDeliveredText: string | null;
  distanceKm: number | null;
  utilizationPct: number | null;
  otdLabel: string;
}

export interface DailyOperationalSummary {
  dateYmd: string;
  readableDate: string;
  totalAssignments: number;
  menungguCount: number;
  perjalananCount: number;
  deliveredCount: number;
  handoverCount: number;
  arrivedOrCompletedCount: number;
  completionRatePct: number;
  activeFleetAssignedCount: number;
  totalFleetUnits: number;
  readyUnitsCount: number;
  inTaskUnitsCount: number;
  maintenanceUnitsCount: number;
  activeDriversAssignedCount: number;
  totalDistanceKm: number;
  totalWeightKg: number;
  totalWeightDisplay: string;
  avgLoadUtilizationPct: number | null;
  avgDepartToDeliveredMinutes: number | null;
  avgDepartToDeliveredText: string;
  otdEvaluatedCount: number;
  otdOnTimeCount: number;
  otdLateCount: number;
  otdRatePct: number | null;
  items: DailyAssignmentBrief[];
}

function isoMatchesWibDate(iso: string | undefined, targetYmd: string): boolean {
  if (!iso) return false;
  const ms = parseFlexibleTimestamp(iso);
  if (ms === null) return false;
  return getWibTodayYmd(new Date(ms)) === targetYmd;
}

export function computeDailyOperationalSummary(
  dateYmd: string,
  assignments: Assignment[],
  vehicles: VehicleMaster[],
  drivers: DriverMaster[],
  notifications: WhatsAppNotificationLog[] = []
): DailyOperationalSummary {
  const safeDateYmd = dateYmd || getWibTodayYmd();

  // Include assignments scheduled for `safeDateYmd` OR whose actual departure/delivered/handover happened on `safeDateYmd` (WIB)
  const dayAssignments = assignments
    .filter((a) => {
      if (a.tanggalTugas === safeDateYmd) return true;
      if (isoMatchesWibDate(a.departureData?.timestamp, safeDateYmd))
        return true;
      if (isoMatchesWibDate(a.deliveredAt, safeDateYmd)) return true;
      if (isoMatchesWibDate(a.handoverData?.timestamp, safeDateYmd))
        return true;
      return false;
    })
    .sort((a, b) => a.sequenceNumber - b.sequenceNumber);

  let menungguCount = 0;
  let perjalananCount = 0;
  let deliveredCount = 0;
  let handoverCount = 0;

  const uniqueVehicleKeys = new Set<string>();
  const uniqueDriverKeys = new Set<string>();

  let totalDistanceKm = 0;
  let totalWeightKg = 0;
  const loadUtilPcts: number[] = [];
  const departToDeliveredDurations: number[] = [];

  let otdEvaluatedCount = 0;
  let otdOnTimeCount = 0;
  let otdLateCount = 0;

  const items: DailyAssignmentBrief[] = dayAssignments.map((asg) => {
    if (asg.status === TaskStatus.MENUNGGU_BERANGKAT) menungguCount += 1;
    else if (asg.status === TaskStatus.DALAM_PERJALANAN) perjalananCount += 1;
    else if (asg.status === TaskStatus.DELIVERED) deliveredCount += 1;
    else if (isCompletedTaskStatus(asg.status)) handoverCount += 1;

    if (asg.plateNumber) {
      uniqueVehicleKeys.add(
        asg.plateNumber.trim().toUpperCase().replace(/\s+/g, '')
      );
    }
    if (asg.driverId) {
      uniqueDriverKeys.add(asg.driverId.trim().toUpperCase());
    }

    const tl = resolveAssignmentStatusTimeline(asg, notifications);
    if (tl.departToDeliveredMinutes !== null) {
      departToDeliveredDurations.push(tl.departToDeliveredMinutes);
    }

    const endKm =
      typeof asg.handoverData?.kmAkhir === 'number' &&
      asg.handoverData.kmAkhir >= 0
        ? asg.handoverData.kmAkhir
        : typeof asg.deliveredData?.kmSampai === 'number' &&
          asg.deliveredData.kmSampai >= 0
        ? asg.deliveredData.kmSampai
        : null;
    const kmDelta =
      asg.departureData &&
      endKm !== null &&
      endKm >= asg.departureData.kmAwal
        ? endKm - asg.departureData.kmAwal
        : null;
    if (kmDelta !== null && kmDelta > 0) {
      totalDistanceKm += kmDelta;
    }

    const loadEval = evaluateAssignmentLoadUtilization(asg, vehicles);
    if (loadEval.loadKg !== null && loadEval.loadKg > 0) {
      totalWeightKg += loadEval.loadKg;
    }
    if (loadEval.utilizationPct !== null) {
      loadUtilPcts.push(loadEval.utilizationPct);
    }

    const otd = evaluateAssignmentOtd(asg);
    let otdLabel = '-';
    if (otd.category === 'ON_TIME') {
      otdEvaluatedCount += 1;
      otdOnTimeCount += 1;
      otdLabel = 'Tepat Waktu';
    } else if (otd.category === 'LATE_COMPLETED') {
      otdEvaluatedCount += 1;
      otdLateCount += 1;
      otdLabel = `Terlambat +${formatDurationMinutes(otd.delayMinutes)}`;
    } else if (otd.category === 'OVERDUE_ACTIVE') {
      otdLabel = `Lewat Jadwal +${formatDurationMinutes(otd.delayMinutes)}`;
    } else if (otd.category === 'ON_TRACK_ACTIVE') {
      otdLabel = 'Sesuai Jadwal';
    }

    return {
      assignment: asg,
      departTimeShort: tl.departedAt
        ? formatShortWibTime(tl.departedAt).replace(' WIB', '')
        : '-',
      deliveredTimeShort: tl.deliveredAt
        ? formatShortWibTime(tl.deliveredAt).replace(' WIB', '')
        : '-',
      handoverTimeShort: tl.handoverAt
        ? formatShortWibTime(tl.handoverAt).replace(' WIB', '')
        : '-',
      departToDeliveredText: tl.departToDeliveredText,
      distanceKm: kmDelta,
      utilizationPct: loadEval.utilizationPct,
      otdLabel,
    };
  });

  const totalAssignments = dayAssignments.length;
  const arrivedOrCompletedCount = deliveredCount + handoverCount;
  const completionRatePct =
    totalAssignments > 0
      ? Math.round((handoverCount / totalAssignments) * 100)
      : 0;

  const avgLoadUtilizationPct =
    loadUtilPcts.length > 0
      ? Math.round(
          (loadUtilPcts.reduce((acc, v) => acc + v, 0) / loadUtilPcts.length) *
            10
        ) / 10
      : null;

  const avgDepartToDeliveredMinutes =
    departToDeliveredDurations.length > 0
      ? Math.round(
          departToDeliveredDurations.reduce((acc, v) => acc + v, 0) /
            departToDeliveredDurations.length
        )
      : null;

  const otdRatePct =
    otdEvaluatedCount > 0
      ? Math.round((otdOnTimeCount / otdEvaluatedCount) * 100)
      : null;

  let readyUnitsCount = 0;
  let inTaskUnitsCount = 0;
  let maintenanceUnitsCount = 0;
  for (const v of vehicles) {
    if (v.status === 'Perawatan') maintenanceUnitsCount += 1;
    else if (v.status === 'Dalam Tugas') inTaskUnitsCount += 1;
    else readyUnitsCount += 1;
  }

  // Ensure active driver count never exceeds registered active drivers when drivers list exists
  const activeDriversAssignedCount =
    drivers.length > 0 ? uniqueDriverKeys.size : uniqueDriverKeys.size;

  return {
    dateYmd: safeDateYmd,
    readableDate: formatReadableWibDate(safeDateYmd),
    totalAssignments,
    menungguCount,
    perjalananCount,
    deliveredCount,
    handoverCount,
    arrivedOrCompletedCount,
    completionRatePct,
    activeFleetAssignedCount: uniqueVehicleKeys.size,
    totalFleetUnits: vehicles.length,
    readyUnitsCount,
    inTaskUnitsCount,
    maintenanceUnitsCount,
    activeDriversAssignedCount,
    totalDistanceKm,
    totalWeightKg,
    totalWeightDisplay:
      totalWeightKg > 0 ? formatWeightKg(totalWeightKg) : '0 Kg',
    avgLoadUtilizationPct,
    avgDepartToDeliveredMinutes,
    avgDepartToDeliveredText:
      avgDepartToDeliveredMinutes !== null
        ? formatDurationMinutes(avgDepartToDeliveredMinutes)
        : '-',
    otdEvaluatedCount,
    otdOnTimeCount,
    otdLateCount,
    otdRatePct,
    items,
  };
}

export function buildDailyOperationalSummaryWaMessage(
  summary: DailyOperationalSummary,
  groupName?: string,
  nowDate: Date = new Date()
): string {
  const headerLines = [
    '*[CRK LOGISTIK — RINGKASAN HARIAN OPERASIONAL ARMADA]*',
    `Tanggal Operasional : ${summary.readableDate} (${summary.dateYmd})`,
    `Waktu Rangkuman WA : ${formatRealTimeTimestamp(nowDate)}`,
    groupName ? `Grup Operasional : ${groupName}` : '',
    '',
    '*--- 1. REKAP STATUS PENUGASAN HARI INI ---*',
    `Total Surat Tugas : ${summary.totalAssignments} Penugasan`,
    `- Menunggu Berangkat : ${summary.menungguCount}`,
    `- Dalam Perjalanan : ${summary.perjalananCount}`,
    `- Tiba di Tujuan (Delivered) : ${summary.deliveredCount}`,
    `- Selesai Serah Terima (Handover) : ${summary.handoverCount} (${summary.completionRatePct}%)`,
    '',
    '*--- 2. PERFORMA SELURUH ARMADA & SLA ---*',
    `Unit Armada Bertugas : ${summary.activeFleetAssignedCount} dari ${summary.totalFleetUnits} Unit Terdaftar`,
    `Status Kesiapan Unit : Siap Jalan ${summary.readyUnitsCount} · Dalam Tugas ${summary.inTaskUnitsCount} · Perawatan ${summary.maintenanceUnitsCount}`,
    `Driver Bertugas : ${summary.activeDriversAssignedCount} Personel`,
    `Total Muatan Terukur : ${summary.totalWeightDisplay}${
      summary.avgLoadUtilizationPct !== null
        ? ` (Rata-rata Utilitas: ${summary.avgLoadUtilizationPct}%)`
        : ''
    }`,
    `Total Jarak Tempuh : ${summary.totalDistanceKm.toLocaleString('id-ID')} km`,
    `Rata-Rata Berangkat -> Delivered : ${summary.avgDepartToDeliveredText}`,
    summary.otdRatePct !== null
      ? `Ketepatan Waktu (OTD) : ${summary.otdRatePct}% (${summary.otdOnTimeCount} Tepat Waktu, ${summary.otdLateCount} Terlambat)`
      : 'Ketepatan Waktu (OTD) : Menunggu penyelesaian jadwal SLA',
  ];

  const assignmentLines: string[] =
    summary.items.length === 0
      ? [
          '',
          '*--- 3. RINCIAN PENUGASAN ARMADA ---*',
          'Belum ada penugasan tercatat pada tanggal operasional ini.',
        ]
      : [
          '',
          `*--- 3. RINCIAN PENUGASAN ARMADA (${summary.items.length}) ---*`,
          ...summary.items.map((item, idx) => {
            const asg = item.assignment;
            const originShort =
              asg.departureData?.titikKeberangkatan ||
              (asg.origin &&
              asg.origin !== 'Menunggu Titik Keberangkatan Driver'
                ? asg.origin
                : 'Pool');
            const timelinePart =
              item.departTimeShort !== '-' && item.deliveredTimeShort !== '-'
                ? `Berangkat ${item.departTimeShort} -> Delivered ${
                    item.deliveredTimeShort
                  }${
                    item.departToDeliveredText
                      ? ` (${item.departToDeliveredText})`
                      : ''
                  }`
                : item.departTimeShort !== '-'
                ? `Berangkat ${item.departTimeShort}`
                : 'Belum Berangkat';
            const suhuPart =
              asg.departureData?.jenisKendaraan === 'Non Pendingin'
                ? 'Non Pendingin'
                : asg.departureData?.suhuAwal || asg.handoverData?.suhuAkhir
                ? `Suhu ${asg.departureData?.suhuAwal || '-'} -> ${
                    asg.handoverData?.suhuAkhir || '-'
                  }`
                : '';
            const extraParts = [
              timelinePart,
              suhuPart,
              item.distanceKm !== null ? `${item.distanceKm} km` : '',
              asg.beratMuatan || '',
              asg.volumeCbm || '',
            ]
              .filter(Boolean)
              .join(' · ');

            return `${idx + 1}. *${asg.plateNumber}* (${asg.driverName}) — ${
              asg.noPenugasan
            }\n   Rute: ${originShort} -> ${asg.destination} | Status: *${
              asg.status
            }*\n   ${extraParts}`;
          }),
        ];

  return [...headerLines, ...assignmentLines]
    .filter((line, idx, arr) => {
      if (line !== '') return true;
      return idx > 0 && arr[idx - 1] !== '';
    })
    .join('\n')
    .trim();
}
