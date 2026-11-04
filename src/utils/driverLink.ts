import { Assignment, DriverMaster } from '../types';
import { formatRealTimeTimestamp, parseSuratJalanList } from './media';

export interface EmbeddedDriverSnapshot {
  id: string;
  name: string;
  phone: string;
  licenseType: string;
}

export interface EmbeddedTaskSnapshot {
  id: string;
  sequenceNumber: number;
  noPenugasan: string;
  noSuratJalanFisik: string;
  kodeSegel: string;
  tanggalTugas: string;
  jadwalJamTiba?: string;
  driverId: string;
  driverCode?: string;
  driverName: string;
  driverPhone: string;
  vehicleId: string;
  plateNumber: string;
  vehicleType: string;
  origin: string;
  destination: string;
  purpose: string;
  beratMuatan?: string;
  status: Assignment['status'];
  notes?: string;
  ownerUid?: string;
}

export interface EmbeddedConfigSnapshot {
  spreadsheetId?: string;
  appsScriptUrl?: string;
}

export interface ParsedDriverLinkParams {
  isDriverMode: boolean;
  driverId: string;
  taskKey: string;
  embeddedDriver?: EmbeddedDriverSnapshot;
  embeddedTask?: EmbeddedTaskSnapshot;
  embeddedConfig?: EmbeddedConfigSnapshot;
}

function encodeUrlSafeBase64(obj: unknown): string {
  try {
    const json = JSON.stringify(obj);
    const bytes = new TextEncoder().encode(json);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return window
      .btoa(binary)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  } catch {
    return '';
  }
}

function decodeUrlSafeBase64<T>(encoded: string): T | null {
  try {
    if (!encoded) return null;
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const binary = window.atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

export type DriverPortalAccessState =
  | 'PUBLIC_OPEN'
  | 'SHARED_GOOGLE_AUTH'
  | 'NEEDS_PUBLIC_SETUP'
  | 'CUSTOM_URL_ERROR';

export interface DriverLinkProbeStatus {
  accessState: DriverPortalAccessState;
  isShareReady: boolean;
  statusMessage: string;
  isDevHost: boolean;
  isPreUrlLive: boolean;
  preUrl: string;
  currentOriginUrl: string;
  customBaseUrl: string;
  effectiveBaseUrl: string;
}

let cachedVerifiedBaseUrl = '';
let cachedCustomPortalBaseUrl = '';
let cachedIsShareReady = false;
let cachedEmbeddedSheetId = '';
let cachedEmbeddedAppsScriptUrl = '';

export function setEmbeddedSheetConfigSnapshot(
  spreadsheetId?: string,
  appsScriptUrl?: string
): void {
  if (typeof spreadsheetId === 'string') {
    cachedEmbeddedSheetId = spreadsheetId.trim();
  }
  if (typeof appsScriptUrl === 'string') {
    cachedEmbeddedAppsScriptUrl = appsScriptUrl.trim();
  }
}

/**
 * Normalizes any candidate base URL to a clean root origin URL ending with `/`
 * (never appending sub-paths like `/index.html/` that trigger 404 errors).
 */
export function normalizePortalBaseUrl(rawUrl?: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) return '';
  try {
    const withProto = /^https?:\/\//i.test(trimmed)
      ? trimmed
      : `https://${trimmed}`;
    const parsed = new URL(withProto);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return '';
  }
}

export function isPrivateAiStudioDevUrl(rawUrl?: string): boolean {
  const normalized = normalizePortalBaseUrl(rawUrl);
  if (!normalized) return false;
  try {
    const parsed = new URL(normalized);
    return parsed.hostname.startsWith('ais-dev-');
  } catch {
    return false;
  }
}

export function setCustomDriverPortalBaseUrl(customUrl?: string): void {
  const normalized = normalizePortalBaseUrl(customUrl);
  cachedCustomPortalBaseUrl = isPrivateAiStudioDevUrl(normalized)
    ? ''
    : normalized;
}

export function isDriverPortalShareReady(): boolean {
  if (cachedIsShareReady) return true;
  if (cachedCustomPortalBaseUrl && !isPrivateAiStudioDevUrl(cachedCustomPortalBaseUrl)) {
    return true;
  }
  if (typeof window !== 'undefined') {
    return !window.location.hostname.startsWith('ais-dev-');
  }
  return false;
}

/**
 * Queries the backend `/api/driver-link-status` endpoint to verify whether a
 * public URL (`Cloud Run` or `ais-pre-...`) is live and accessible to Drivers
 * without triggering Google Error 403 (private ais-dev editor) or Error 404.
 */
export async function refreshDriverLinkStatus(
  customUrl?: string,
  forceRefresh?: boolean
): Promise<DriverLinkProbeStatus | null> {
  if (typeof window === 'undefined') return null;
  if (customUrl !== undefined) {
    setCustomDriverPortalBaseUrl(customUrl);
  }
  try {
    const query = new URLSearchParams();
    if (forceRefresh) query.set('refresh', '1');
    if (customUrl !== undefined) query.set('customUrl', customUrl.trim());
    const qs = query.toString();
    const endpoint = `/api/driver-link-status${qs ? `?${qs}` : ''}`;

    const res = await fetch(endpoint, {
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as Partial<DriverLinkProbeStatus>;
    const normalizedEffective = normalizePortalBaseUrl(data.effectiveBaseUrl);
    cachedVerifiedBaseUrl = normalizedEffective;
    cachedIsShareReady = Boolean(data.isShareReady && normalizedEffective);

    if (
      typeof data.customBaseUrl === 'string' &&
      data.customBaseUrl.trim() &&
      !isPrivateAiStudioDevUrl(data.customBaseUrl)
    ) {
      cachedCustomPortalBaseUrl = normalizePortalBaseUrl(data.customBaseUrl);
    }

    const accessState: DriverPortalAccessState =
      data.accessState === 'PUBLIC_OPEN' ||
      data.accessState === 'SHARED_GOOGLE_AUTH' ||
      data.accessState === 'CUSTOM_URL_ERROR' ||
      data.accessState === 'NEEDS_PUBLIC_SETUP'
        ? data.accessState
        : cachedIsShareReady
        ? 'PUBLIC_OPEN'
        : 'NEEDS_PUBLIC_SETUP';

    return {
      accessState,
      isShareReady: cachedIsShareReady,
      statusMessage: String(data.statusMessage || ''),
      isDevHost: Boolean(data.isDevHost),
      isPreUrlLive: Boolean(data.isPreUrlLive),
      preUrl: normalizePortalBaseUrl(data.preUrl),
      currentOriginUrl:
        normalizePortalBaseUrl(data.currentOriginUrl) ||
        `${window.location.protocol}//${window.location.host}/`,
      customBaseUrl: normalizePortalBaseUrl(data.customBaseUrl),
      effectiveBaseUrl: normalizedEffective,
    };
  } catch {
    return null;
  }
}

/**
 * Resolves the verified public base URL of the application.
 * - Never returns a private `ais-dev-...` URL as a custom URL (which causes Google Error 403 on Driver phones).
 * - Uses Admin's configured `publicPortalBaseUrl` (Cloud Run URL) when valid.
 * - Uses `ais-pre-...` when verified live (`HTTP !== 404`).
 * - Uses current origin automatically when running directly on a deployed Cloud Run server.
 */
export function getShareableBaseUrl(customBaseUrl?: string): string {
  const explicitCustom = normalizePortalBaseUrl(customBaseUrl);
  if (explicitCustom && !isPrivateAiStudioDevUrl(explicitCustom)) {
    return explicitCustom;
  }
  if (
    cachedCustomPortalBaseUrl &&
    !isPrivateAiStudioDevUrl(cachedCustomPortalBaseUrl)
  ) {
    return cachedCustomPortalBaseUrl;
  }
  if (cachedVerifiedBaseUrl && !isPrivateAiStudioDevUrl(cachedVerifiedBaseUrl)) {
    return cachedVerifiedBaseUrl;
  }
  if (typeof window === 'undefined') return '';
  const { protocol, host, hostname } = window.location;
  if (hostname.startsWith('ais-dev-')) {
    return `https://ais-pre-${host.slice('ais-dev-'.length)}/`;
  }
  return `${protocol}//${host}/`;
}

/**
 * Builds a dedicated Driver Portal URL:
 * - General Driver Portal: `?role=driver`
 * - Personal Driver Link: `?role=driver&driver=DRV-001`
 * - Direct Task Link: `?role=driver&driver=DRV-001&task=ASG-...`
 */
export function buildDriverPortalLink(options?: {
  driverId?: string;
  taskId?: string;
  taskNo?: string;
  customBaseUrl?: string;
  driverSnapshot?: Pick<DriverMaster, 'id' | 'name' | 'phone' | 'licenseType'>;
  taskSnapshot?: Assignment;
  configSnapshot?: EmbeddedConfigSnapshot;
}): string {
  const base = getShareableBaseUrl(options?.customBaseUrl);
  if (!base) return '';
  const params = new URLSearchParams();
  params.set('role', 'driver');
  if (options?.driverId && options.driverId.trim()) {
    params.set('driver', options.driverId.trim().toUpperCase());
  }
  const safeTaskKey =
    (options?.taskId && options.taskId.trim()) ||
    (options?.taskNo && options.taskNo.trim()) ||
    '';
  if (safeTaskKey) {
    params.set('task', safeTaskKey);
  }

  const effSheetId = (
    options?.configSnapshot?.spreadsheetId ?? cachedEmbeddedSheetId
  ).trim();
  const effBridgeUrl = (
    options?.configSnapshot?.appsScriptUrl ?? cachedEmbeddedAppsScriptUrl
  ).trim();

  if (
    options?.driverSnapshot ||
    options?.taskSnapshot ||
    effSheetId ||
    effBridgeUrl
  ) {
    const compactPayload: {
      d?: EmbeddedDriverSnapshot;
      t?: EmbeddedTaskSnapshot;
      c?: { s?: string; a?: string };
    } = {};
    if (options?.driverSnapshot) {
      compactPayload.d = {
        id: options.driverSnapshot.id,
        name: options.driverSnapshot.name,
        phone: options.driverSnapshot.phone || '',
        licenseType: options.driverSnapshot.licenseType || '',
      };
    }
    if (options?.taskSnapshot) {
      const ts = options.taskSnapshot;
      compactPayload.t = {
        id: ts.id,
        sequenceNumber: ts.sequenceNumber || 1,
        noPenugasan: ts.noPenugasan,
        noSuratJalanFisik: ts.noSuratJalanFisik || '',
        kodeSegel: ts.kodeSegel || '',
        tanggalTugas: ts.tanggalTugas,
        jadwalJamTiba: ts.jadwalJamTiba || undefined,
        driverId: ts.driverId,
        driverCode: ts.driverCode || ts.driverId,
        driverName: ts.driverName,
        driverPhone: ts.driverPhone || '',
        vehicleId: ts.vehicleId || '',
        plateNumber: ts.plateNumber,
        vehicleType: ts.vehicleType || '',
        origin: ts.origin || 'Menunggu Titik Keberangkatan Driver',
        destination: ts.destination,
        purpose: ts.purpose || '',
        beratMuatan: ts.beratMuatan || undefined,
        status: ts.status,
        notes: ts.notes || undefined,
        ownerUid: ts.ownerUid || undefined,
      };
    }
    if (effSheetId || effBridgeUrl) {
      compactPayload.c = {
        ...(effSheetId ? { s: effSheetId } : {}),
        ...(effBridgeUrl ? { a: effBridgeUrl } : {}),
      };
    }
    const snapStr = encodeUrlSafeBase64(compactPayload);
    if (snapStr && snapStr.length <= 2000) {
      params.set('snap', snapStr);
    }
  }

  return `${base}?${params.toString()}`;
}

/**
 * Parses URL query, hash, or path parameters when a Driver opens a shared link.
 * Strips accidental trailing punctuation added by chat clients.
 */
export function parseDriverUrlParams(): ParsedDriverLinkParams {
  if (typeof window === 'undefined') {
    return { isDriverMode: false, driverId: '', taskKey: '' };
  }
  const cleanParam = (val: string | null): string =>
    String(val || '')
      .trim()
      .replace(/[).,;>\]'"]+$/g, '');

  const searchParams = new URLSearchParams(window.location.search);
  const hashRaw = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const hashParams = new URLSearchParams(
    hashRaw.startsWith('?') ? hashRaw.slice(1) : hashRaw
  );

  const roleParam = (
    cleanParam(searchParams.get('role')) || cleanParam(hashParams.get('role'))
  ).toLowerCase();
  const driverId = (
    cleanParam(searchParams.get('driver')) ||
    cleanParam(hashParams.get('driver'))
  ).toUpperCase();
  const taskKey =
    cleanParam(searchParams.get('task')) ||
    cleanParam(hashParams.get('task'));
  const snapRaw =
    cleanParam(searchParams.get('snap')) ||
    cleanParam(hashParams.get('snap'));

  const decodedSnap = snapRaw
    ? decodeUrlSafeBase64<{
        d?: EmbeddedDriverSnapshot;
        t?: EmbeddedTaskSnapshot;
        c?: { s?: string; a?: string };
      }>(snapRaw)
    : null;

  const pathIsDriver = /^\/driver(\/|$)/i.test(window.location.pathname);

  const embeddedConfig: EmbeddedConfigSnapshot | undefined =
    decodedSnap?.c && (decodedSnap.c.s || decodedSnap.c.a)
      ? {
          spreadsheetId: decodedSnap.c.s?.trim() || undefined,
          appsScriptUrl: decodedSnap.c.a?.trim() || undefined,
        }
      : undefined;

  return {
    isDriverMode:
      roleParam === 'driver' ||
      pathIsDriver ||
      Boolean(driverId) ||
      Boolean(taskKey) ||
      Boolean(decodedSnap?.d || decodedSnap?.t),
    driverId: driverId || (decodedSnap?.d?.id || '').toUpperCase(),
    taskKey: taskKey || decodedSnap?.t?.id || decodedSnap?.t?.noPenugasan || '',
    embeddedDriver: decodedSnap?.d,
    embeddedTask: decodedSnap?.t,
    embeddedConfig,
  };
}

/**
 * Formats a ready-to-send WhatsApp message for explicitly sharing the general Driver Portal link to a WhatsApp Group.
 */
export function buildGeneralDriverPortalWaMessage(
  groupName?: string,
  customBaseUrl?: string
): string {
  const link = buildDriverPortalLink({ customBaseUrl });
  return [
    '*[CRK LOGISTIK — AKSES PORTAL DRIVER]*',
    `Waktu Pesan WA : ${formatRealTimeTimestamp(new Date())}`,
    groupName ? `Grup Operasional : ${groupName}` : '',
    '',
    'Silakan klik tautan di bawah ini untuk langsung masuk ke *Portal Driver CRK Logistik* (Laporan Keberangkatan, Konfirmasi Tiba/Delivered, & Serah Terima Handover):',
    link,
    '',
    'Petunjuk Akses:',
    '1. Buka link di atas melalui browser HP Anda',
    '2. Pilih *ID Driver* Anda pada daftar',
    '3. Masukkan PIN Driver (atau langsung klik Masuk jika tanpa PIN)',
  ]
    .filter((line, idx, arr) => {
      if (line !== '') return true;
      return idx > 0 && arr[idx - 1] !== '';
    })
    .join('\n')
    .trim();
}

/**
 * Formats a personalized WhatsApp message when Admin explicitly clicks "Kirim WA" inside Master Driver / Bagikan Link Driver.
 */
export function buildPersonalDriverLinkWaMessage(
  driver: DriverMaster,
  activeTasksCount: number,
  specificTask?: Assignment,
  customBaseUrl?: string
): string {
  const link = buildDriverPortalLink({
    driverId: driver.id,
    taskId: specificTask?.id,
    taskNo: specificTask?.noPenugasan,
    customBaseUrl,
    driverSnapshot: driver,
    taskSnapshot: specificTask,
  });

  const sjItems = parseSuratJalanList(specificTask?.noSuratJalanFisik);

  return [
    '*[CRK LOGISTIK — AKSES LOGIN DRIVER]*',
    `Waktu Pesan WA : ${formatRealTimeTimestamp(new Date())}`,
    `ID Driver : ${driver.id}`,
    `Nama Driver : ${driver.name}`,
    `Akses Login : ${
      driver.pin
        ? 'Menggunakan PIN Driver Anda'
        : 'Langsung Masuk (Tanpa PIN)'
    }`,
    specificTask
      ? `Surat Tugas Aktif : ${specificTask.noPenugasan} (${specificTask.plateNumber} -> ${specificTask.destination})`
      : `Penugasan Aktif Saat Ini : ${activeTasksCount} tugas`,
    sjItems.length > 0
      ? `No. Surat Jalan${sjItems.length > 1 ? ` (${sjItems.length})` : ''} : ${sjItems.join(', ')}`
      : '',
    '',
    'Klik tautan berikut untuk langsung membuka Portal Driver Anda:',
    link,
  ]
    .filter((line, idx, arr) => {
      if (line !== '') return true;
      return idx > 0 && arr[idx - 1] !== '';
    })
    .join('\n')
    .trim();
}
