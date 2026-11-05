export async function compressImageFile(
  file: File,
  maxDimension = 960,
  quality = 0.72
): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Gagal membaca file gambar.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('Format gambar tidak didukung.'));
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDimension || height > maxDimension) {
          if (width >= height) {
            height = Math.round((height * maxDimension) / width);
            width = maxDimension;
          } else {
            width = Math.round((width * maxDimension) / height);
            height = maxDimension;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(String(reader.result || ''));
          return;
        }
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      };
      img.src = String(reader.result || '');
    };
    reader.readAsDataURL(file);
  });
}

export function parseFlexibleTimestamp(raw?: string | null): number | null {
  const str = String(raw || '').trim();
  if (!str || str === '-' || str === 'undefined' || str === 'null') return null;

  // 1. Check if already an ISO string with explicit timezone / Z: e.g. 2026-11-05T13:35:27.000Z or +07:00
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(str)) {
    const ms = new Date(str).getTime();
    return Number.isFinite(ms) ? ms : null;
  }

  // 2. Format: DD-MM-YYYY or DD/MM/YYYY with optional time separated by ;, space, T, or comma
  // e.g. 05-11-2026;20:35:27 or 05/11/2026, 20.35.27 or 05-11-2026 20:35:27
  const dmyMatch = str.match(
    /^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[;\s,T]+(\d{1,2})[:.](\d{1,2})(?:[:.](\d{1,2}))?)?/
  );
  if (dmyMatch) {
    const day = Number(dmyMatch[1]);
    const month = Number(dmyMatch[2]) - 1;
    const year = Number(dmyMatch[3]);
    const hr = Number(dmyMatch[4] ?? 0);
    const min = Number(dmyMatch[5] ?? 0);
    const sec = Number(dmyMatch[6] ?? 0);
    // Interpreted as WIB (Asia/Jakarta, UTC+7) -> Date.UTC(year, month, day, hr - 7, min, sec)
    const ms = Date.UTC(year, month, day, hr - 7, min, sec);
    return Number.isFinite(ms) ? ms : null;
  }

  // 3. Format: YYYY-MM-DD or YYYY/MM/DD with optional time
  // e.g. 2026-11-05;20:35:27 or 2026-11-05 20:35:27 or 2026-11-05T20:35:27 (without trailing Z/offset)
  const ymdMatch = str.match(
    /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})(?:[;\s,T]+(\d{1,2})[:.](\d{1,2})(?:[:.](\d{1,2}))?)?/
  );
  if (ymdMatch) {
    const year = Number(ymdMatch[1]);
    const month = Number(ymdMatch[2]) - 1;
    const day = Number(ymdMatch[3]);
    const hr = Number(ymdMatch[4] ?? 0);
    const min = Number(ymdMatch[5] ?? 0);
    const sec = Number(ymdMatch[6] ?? 0);
    const ms = Date.UTC(year, month, day, hr - 7, min, sec);
    return Number.isFinite(ms) ? ms : null;
  }

  // Fallback: standard Date parsing
  const fallback = new Date(str).getTime();
  return Number.isFinite(fallback) ? fallback : null;
}

export function formatRealTimeTimestamp(dateOrIso: Date | string | null | undefined): string {
  if (!dateOrIso) return '-';
  let d: Date;
  if (dateOrIso instanceof Date) {
    d = dateOrIso;
  } else {
    const ms = parseFlexibleTimestamp(dateOrIso);
    d = ms !== null ? new Date(ms) : new Date(dateOrIso);
  }
  if (Number.isNaN(d.getTime())) return String(dateOrIso || '-');
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

/**
 * Format timestamp database & spreadsheet: Tanggal-Bulan-Tahun;Jam: Menit: Detik
 * Contoh: 05-11-2026;20:07:53 (WIB / Asia/Jakarta)
 */
export function formatDatabaseTimestamp(
  dateOrIso?: Date | string | null
): string {
  if (!dateOrIso) return '';
  const raw = String(dateOrIso).trim();
  if (!raw || raw === '-') return '';

  if (/^\d{2}-\d{2}-\d{4};\d{2}:\d{2}:\d{2}$/.test(raw)) {
    return raw;
  }

  let ms = parseFlexibleTimestamp(raw);
  if (ms === null && !Number.isNaN(new Date(raw).getTime())) {
    ms = new Date(raw).getTime();
  }
  if (ms === null || Number.isNaN(ms)) {
    return raw;
  }

  const d = new Date(ms);
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jakarta',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(d);

  const getPart = (type: string) =>
    parts.find((p) => p.type === type)?.value || '00';
  const day = getPart('day');
  const month = getPart('month');
  const year = getPart('year');
  const hour = getPart('hour');
  const minute = getPart('minute');
  const second = getPart('second');

  return `${day}-${month}-${year};${hour}:${minute}:${second}`;
}

export function parseScheduledDeadlineMs(
  tanggalTugas?: string,
  jadwalJamTiba?: string
): number | null {
  const dateRaw = String(tanggalTugas || '').trim();
  if (!dateRaw) return null;

  let year = 0;
  let monthIdx = 0;
  let day = 0;

  const ymd = dateRaw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (ymd) {
    year = Number(ymd[1]);
    monthIdx = Number(ymd[2]) - 1;
    day = Number(ymd[3]);
  } else {
    const dmy = dateRaw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})/);
    if (dmy) {
      day = Number(dmy[1]);
      monthIdx = Number(dmy[2]) - 1;
      year = Number(dmy[3]);
    } else {
      const parsed = new Date(dateRaw);
      if (Number.isNaN(parsed.getTime())) return null;
      year = parsed.getFullYear();
      monthIdx = parsed.getMonth();
      day = parsed.getDate();
    }
  }

  let hours = 23;
  let minutes = 59;
  let seconds = 59;

  const timeRaw = String(jadwalJamTiba || '').trim();
  if (timeRaw) {
    const hm = timeRaw.match(/^(\d{1,2})[:.](\d{2})/);
    if (hm) {
      hours = Math.min(23, Math.max(0, Number(hm[1])));
      minutes = Math.min(59, Math.max(0, Number(hm[2])));
      seconds = 59;
    }
  }

  const deadlineMs = Date.UTC(year, monthIdx, day, hours - 7, minutes, seconds, 999);
  if (!Number.isFinite(deadlineMs)) return null;
  return deadlineMs;
}

export type OtdCategory =
  | 'ON_TIME'
  | 'LATE_COMPLETED'
  | 'ON_TRACK_ACTIVE'
  | 'OVERDUE_ACTIVE'
  | 'UNSCHEDULED';

export interface AssignmentOtdEvaluation {
  category: OtdCategory;
  deadlineMs: number | null;
  referenceMs: number | null;
  delayMinutes: number;
}

export function evaluateAssignmentOtd(
  assignment: {
    status: string;
    tanggalTugas?: string;
    jadwalJamTiba?: string;
    deliveredAt?: string;
    departureData?: { timestamp?: string };
    handoverData?: { timestamp?: string };
    createdAt?: string;
  },
  nowMs: number = Date.now()
): AssignmentOtdEvaluation {
  const deadlineMs = parseScheduledDeadlineMs(
    assignment.tanggalTugas,
    assignment.jadwalJamTiba
  );
  if (deadlineMs === null) {
    return {
      category: 'UNSCHEDULED',
      deadlineMs: null,
      referenceMs: null,
      delayMinutes: 0,
    };
  }

  const normalizedStatus = String(assignment.status || '')
    .trim()
    .toLowerCase();
  const isCompleted =
    normalizedStatus === 'selesai' ||
    normalizedStatus === 'handover' ||
    normalizedStatus === 'delivered';

  if (isCompleted) {
    const completedMs =
      parseFlexibleTimestamp(assignment.handoverData?.timestamp) ??
      parseFlexibleTimestamp(assignment.deliveredAt) ??
      parseFlexibleTimestamp(assignment.departureData?.timestamp) ??
      parseFlexibleTimestamp(assignment.createdAt);

    if (completedMs === null) {
      return {
        category: 'ON_TIME',
        deadlineMs,
        referenceMs: null,
        delayMinutes: 0,
      };
    }

    if (completedMs <= deadlineMs) {
      return {
        category: 'ON_TIME',
        deadlineMs,
        referenceMs: completedMs,
        delayMinutes: 0,
      };
    }

    return {
      category: 'LATE_COMPLETED',
      deadlineMs,
      referenceMs: completedMs,
      delayMinutes: Math.max(1, Math.round((completedMs - deadlineMs) / 60000)),
    };
  }

  // Active task ('Menunggu Berangkat' | 'Dalam Perjalanan')
  if (nowMs <= deadlineMs) {
    return {
      category: 'ON_TRACK_ACTIVE',
      deadlineMs,
      referenceMs: nowMs,
      delayMinutes: 0,
    };
  }

  return {
    category: 'OVERDUE_ACTIVE',
    deadlineMs,
    referenceMs: nowMs,
    delayMinutes: Math.max(1, Math.round((nowMs - deadlineMs) / 60000)),
  };
}

export function calculateTripDurationMinutes(
  startIso?: string,
  endIso?: string
): number | null {
  const startMs = parseFlexibleTimestamp(startIso);
  const endMs = parseFlexibleTimestamp(endIso);
  if (startMs === null || endMs === null || endMs < startMs) {
    return null;
  }
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}

export function formatDurationMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '-';
  if (minutes >= 1440) {
    const days = Math.floor(minutes / 1440);
    const remHrs = Math.floor((minutes % 1440) / 60);
    return remHrs > 0 ? `${days}h ${remHrs}j` : `${days} hari`;
  }
  const hrs = Math.floor(minutes / 60);
  const mins = Math.round(minutes % 60);
  if (hrs === 0) return `${mins} mnt`;
  return `${hrs}j ${mins}m`;
}

/**
 * Splits a raw No. Surat Jalan string (or array) into clean individual delivery note numbers.
 * Supports comma, semicolon, and newline separators.
 */
export function parseSuratJalanList(raw?: string | string[]): string[] {
  if (!raw) return [];
  const source = Array.isArray(raw) ? raw.join(',') : String(raw);
  return source
    .split(/[,;\r\n]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/**
 * Joins multiple No. Surat Jalan entries into a canonical comma-separated string.
 */
export function serializeSuratJalanList(items: string[]): string {
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of items) {
    for (const part of parseSuratJalanList(raw)) {
      const key = part.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        cleaned.push(part);
      }
    }
  }
  return cleaned.join(', ');
}

export function formatSuratJalanSummary(raw?: string): {
  items: string[];
  count: number;
  text: string;
} {
  const items = parseSuratJalanList(raw);
  return {
    items,
    count: items.length,
    text: items.length > 0 ? items.join(', ') : '-',
  };
}

// ============================================================================
// Utilitas Muatan (Cargo / Fleet Payload Utilization) Helpers
// ============================================================================

export type LoadUnitFamily = 'WEIGHT_KG' | 'VOLUME_CBM' | 'COUNT_UNIT' | 'PERCENT';

export interface ParsedLoadMeasurement {
  family: LoadUnitFamily;
  normalizedValue: number;
  displayText: string;
  unitLabel: string;
}

function parseLocalizedNumber(numStr: string, isSmallUnit: boolean): number {
  const s = numStr.trim();
  if (!s) return NaN;
  // Both '.' and ',' present -> last separator is decimal
  if (s.includes('.') && s.includes(',')) {
    const lastDot = s.lastIndexOf('.');
    const lastComma = s.lastIndexOf(',');
    if (lastComma > lastDot) {
      return Number(s.replace(/\./g, '').replace(',', '.'));
    }
    return Number(s.replace(/,/g, ''));
  }
  // Indonesian thousands separator e.g. "2.500" for kg/box
  if (isSmallUnit && /^\d{1,3}(\.\d{3})+$/.test(s)) {
    return Number(s.replace(/\./g, ''));
  }
  if (isSmallUnit && /^\d{1,3}(,\d{3})+$/.test(s)) {
    return Number(s.replace(/,/g, ''));
  }
  return Number(s.replace(',', '.'));
}

export function parseLoadMeasurement(
  raw?: string
): ParsedLoadMeasurement | null {
  const text = String(raw || '').trim();
  if (!text) return null;

  // Strip temperature expressions like -18°C or 4 C so they are never misread as cargo numbers
  const withoutTemp = text.replace(
    /[+-]?\d+(?:[.,]\d+)?\s*°?\s*[cCfF]\b/g,
    ' '
  );

  // 1. Explicit percentage e.g. "85%"
  const pctMatch = withoutTemp.match(/(\d+(?:[.,]\d+)?)\s*%/);
  if (pctMatch) {
    const val = parseLocalizedNumber(pctMatch[1], false);
    if (Number.isFinite(val) && val >= 0) {
      return {
        family: 'PERCENT',
        normalizedValue: val,
        displayText: `${Math.round(val * 10) / 10}%`,
        unitLabel: '%',
      };
    }
  }

  // 2. Weight units: Ton / MT / Kw / Kuintal / Kg
  const tonMatch = withoutTemp.match(
    /(\d+(?:[.,]\d+)?)\s*(?:ton|tons|mt|tonase)\b/i
  );
  if (tonMatch) {
    const tons = parseLocalizedNumber(tonMatch[1], false);
    if (Number.isFinite(tons) && tons > 0) {
      return {
        family: 'WEIGHT_KG',
        normalizedValue: tons * 1000,
        displayText: `${Math.round(tons * 100) / 100} Ton`,
        unitLabel: 'Ton',
      };
    }
  }

  const kwMatch = withoutTemp.match(
    /(\d+(?:[.,]\d+)?)\s*(?:kuintal|kwintal|kw)\b/i
  );
  if (kwMatch) {
    const kw = parseLocalizedNumber(kwMatch[1], false);
    if (Number.isFinite(kw) && kw > 0) {
      return {
        family: 'WEIGHT_KG',
        normalizedValue: kw * 100,
        displayText: `${Math.round(kw * 10) / 10} Kw`,
        unitLabel: 'Kw',
      };
    }
  }

  const kgMatch = withoutTemp.match(
    /(\d+(?:[.,]\d+)*)\s*(?:kg|kgs|kilogram|kilo)\b/i
  );
  if (kgMatch) {
    const kg = parseLocalizedNumber(kgMatch[1], true);
    if (Number.isFinite(kg) && kg > 0) {
      return {
        family: 'WEIGHT_KG',
        normalizedValue: kg,
        displayText: formatWeightKg(kg),
        unitLabel: 'Kg',
      };
    }
  }

  // 3. Volume units: CBM / m3 / m³ / Kubik / Liter
  const cbmMatch = withoutTemp.match(
    /(\d+(?:[.,]\d+)?)\s*(?:cbm|m3|m³|kubik)\b/i
  );
  if (cbmMatch) {
    const cbm = parseLocalizedNumber(cbmMatch[1], false);
    if (Number.isFinite(cbm) && cbm > 0) {
      return {
        family: 'VOLUME_CBM',
        normalizedValue: cbm,
        displayText: `${Math.round(cbm * 100) / 100} CBM`,
        unitLabel: 'CBM',
      };
    }
  }

  const literMatch = withoutTemp.match(
    /(\d+(?:[.,]\d+)*)\s*(?:liter|ltr)\b/i
  );
  if (literMatch) {
    const ltr = parseLocalizedNumber(literMatch[1], true);
    if (Number.isFinite(ltr) && ltr > 0) {
      return {
        family: 'VOLUME_CBM',
        normalizedValue: ltr / 1000,
        displayText: `${ltr.toLocaleString('id-ID')} L`,
        unitLabel: 'L',
      };
    }
  }

  // 4. Discrete logistics units: Pallet / Box / Koli / Krat / Carton
  const unitMatch = withoutTemp.match(
    /(\d+(?:[.,]\d+)*)\s*(pallet|palet|box|boks|koli|krat|carton|ctn|ikat|pack)\b/i
  );
  if (unitMatch) {
    const qty = parseLocalizedNumber(unitMatch[1], true);
    const label = unitMatch[2];
    if (Number.isFinite(qty) && qty > 0) {
      return {
        family: 'COUNT_UNIT',
        normalizedValue: qty,
        displayText: `${qty.toLocaleString('id-ID')} ${label}`,
        unitLabel: label,
      };
    }
  }

  // 5. Bare number fallback ONLY when input is purely numeric (e.g. "3500" -> Kg, or "3.5" -> Ton if <= 50)
  const bareMatch = withoutTemp.trim().match(/^(\d+(?:[.,]\d+)?)$/);
  if (bareMatch) {
    const val = parseLocalizedNumber(bareMatch[1], false);
    if (Number.isFinite(val) && val > 0) {
      if (val <= 60) {
        return {
          family: 'WEIGHT_KG',
          normalizedValue: val * 1000,
          displayText: `${Math.round(val * 100) / 100} Ton`,
          unitLabel: 'Ton',
        };
      }
      return {
        family: 'WEIGHT_KG',
        normalizedValue: val,
        displayText: formatWeightKg(val),
        unitLabel: 'Kg',
      };
    }
  }

  return null;
}

export function formatWeightKg(kg: number): string {
  if (!Number.isFinite(kg) || kg <= 0) return '0 Kg';
  if (kg >= 1000) {
    const tons = Math.round((kg / 1000) * 100) / 100;
    return `${tons.toLocaleString('id-ID')} Ton`;
  }
  return `${Math.round(kg).toLocaleString('id-ID')} Kg`;
}

export type LoadUtilizationCategory =
  | 'OPTIMAL'
  | 'MODERATE'
  | 'UNDERLOAD'
  | 'OVERLOAD'
  | 'UNMEASURED';

export interface AssignmentLoadUtilization {
  utilizationPct: number | null;
  category: LoadUtilizationCategory;
  loadKg: number | null;
  capacityKg: number | null;
  loadDisplay: string;
  capacityDisplay: string;
}

export function evaluateAssignmentLoadUtilization(
  assignment: {
    beratMuatan?: string;
    purpose?: string;
    vehicleId?: string;
    plateNumber?: string;
  },
  vehicles: Array<{ id: string; plateNumber: string; capacity: string }>
): AssignmentLoadUtilization {
  const vehIdNorm = String(assignment.vehicleId || '').trim().toLowerCase();
  const plateNorm = String(assignment.plateNumber || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '');

  const matchedVehicle = vehicles.find((v) => {
    if (vehIdNorm && v.id.trim().toLowerCase() === vehIdNorm) return true;
    if (
      plateNorm &&
      v.plateNumber.trim().toLowerCase().replace(/\s+/g, '') === plateNorm
    ) {
      return true;
    }
    return false;
  });

  const capParsed = parseLoadMeasurement(matchedVehicle?.capacity);
  const loadParsed =
    parseLoadMeasurement(assignment.beratMuatan) ||
    parseLoadMeasurement(assignment.purpose);

  const capacityDisplay =
    capParsed?.displayText || matchedVehicle?.capacity?.trim() || '-';
  const loadDisplay =
    loadParsed?.displayText || assignment.beratMuatan?.trim() || '-';

  let utilizationPct: number | null = null;
  let loadKg: number | null =
    loadParsed?.family === 'WEIGHT_KG' ? loadParsed.normalizedValue : null;
  const capacityKg: number | null =
    capParsed?.family === 'WEIGHT_KG' ? capParsed.normalizedValue : null;

  if (loadParsed?.family === 'PERCENT') {
    utilizationPct = Math.round(loadParsed.normalizedValue * 10) / 10;
    if (capacityKg !== null) {
      loadKg = (utilizationPct / 100) * capacityKg;
    }
  } else if (
    loadParsed &&
    capParsed &&
    loadParsed.family === capParsed.family &&
    capParsed.normalizedValue > 0
  ) {
    utilizationPct =
      Math.round((loadParsed.normalizedValue / capParsed.normalizedValue) * 1000) /
      10;
  }

  let category: LoadUtilizationCategory = 'UNMEASURED';
  if (utilizationPct !== null) {
    if (utilizationPct > 100) category = 'OVERLOAD';
    else if (utilizationPct >= 70) category = 'OPTIMAL';
    else if (utilizationPct >= 40) category = 'MODERATE';
    else category = 'UNDERLOAD';
  }

  return {
    utilizationPct,
    category,
    loadKg,
    capacityKg,
    loadDisplay,
    capacityDisplay,
  };
}

export function parseCbmNumeric(
  raw?: string | number | null
): number | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'number') {
    return Number.isFinite(raw) && raw > 0
      ? Math.round(raw * 1000) / 1000
      : null;
  }
  const trimmed = String(raw).trim();
  if (!trimmed) return null;

  const cleaned = trimmed
    .toLowerCase()
    .replace(/m³|m3|cbm|kubik/g, ' ')
    .trim();
  const match = cleaned.match(/(\d+(?:[.,]\d+)?)/);
  if (!match) return null;

  let numStr = match[1];
  if (numStr.includes(',') && !numStr.includes('.')) {
    numStr = numStr.replace(',', '.');
  } else if (numStr.includes(',') && numStr.includes('.')) {
    numStr = numStr.replace(/,/g, '');
  }

  const parsed = Number.parseFloat(numStr);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.round(parsed * 1000) / 1000;
}

export function formatCbmValue(
  cbm: number | null | undefined,
  includeUnit = true
): string {
  if (cbm === null || cbm === undefined || !Number.isFinite(cbm) || cbm <= 0) {
    return includeUnit ? '0 CBM' : '0';
  }
  const rounded = Math.round(cbm * 1000) / 1000;
  const formatted = rounded.toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3,
  });
  return includeUnit ? `${formatted} CBM` : formatted;
}

export function calculateBoxCbmFromCm(
  lengthCm: number,
  widthCm: number,
  heightCm: number,
  koliCount = 1
): number {
  if (
    !Number.isFinite(lengthCm) ||
    !Number.isFinite(widthCm) ||
    !Number.isFinite(heightCm) ||
    !Number.isFinite(koliCount) ||
    lengthCm <= 0 ||
    widthCm <= 0 ||
    heightCm <= 0 ||
    koliCount <= 0
  ) {
    return 0;
  }
  const totalM3 = (lengthCm * widthCm * heightCm * koliCount) / 1_000_000;
  return Math.round(totalM3 * 1000) / 1000;
}

export interface ActiveUnitAssignmentCbmItem {
  id: string;
  noPenugasan: string;
  destination: string;
  driverName: string;
  status: string;
  volumeCbm: number;
  volumeDisplay: string;
  beratMuatan?: string;
}

export interface ActiveUnitCbmBreakdown {
  unitId: string;
  plateNumber: string;
  vehicleType: string;
  unitStatus: string;
  capacityWeight: string;
  capacityCbm: number | null;
  capacityCbmDisplay: string;
  usedCbm: number;
  usedCbmDisplay: string;
  remainingCbm: number | null;
  remainingCbmDisplay: string;
  overCbm: number;
  utilizationPct: number | null;
  category: LoadUtilizationCategory;
  activeAssignments: ActiveUnitAssignmentCbmItem[];
}

export interface ActiveFleetCbmSummary {
  activeUnitsCount: number;
  activeAssignmentsCount: number;
  totalUsedCbm: number;
  totalCapacityCbm: number;
  totalRemainingCbm: number;
  avgUtilizationPct: number | null;
  units: ActiveUnitCbmBreakdown[];
}

function resolveAssignmentCbm(asg: {
  volumeCbm?: string;
  beratMuatan?: string;
  purpose?: string;
}): number {
  const direct = parseCbmNumeric(asg.volumeCbm);
  if (direct !== null && direct > 0) return direct;

  const fallbackLoad =
    parseLoadMeasurement(asg.beratMuatan) || parseLoadMeasurement(asg.purpose);
  if (fallbackLoad?.family === 'VOLUME_CBM' && fallbackLoad.normalizedValue > 0) {
    return Math.round(fallbackLoad.normalizedValue * 1000) / 1000;
  }
  return 0;
}

function isAssignmentCurrentlyActive(asg: {
  status?: string;
  handoverData?: unknown;
}): boolean {
  if (Boolean(asg.handoverData)) return false;
  const norm = String(asg.status || '')
    .trim()
    .toLowerCase();
  return (
    norm === 'menunggu berangkat' ||
    norm === 'dalam perjalanan' ||
    norm === 'delivered'
  );
}

export function evaluateActiveUnitsCbmSummary(
  vehicles: Array<{
    id: string;
    plateNumber: string;
    vehicleType: string;
    capacity: string;
    capacityCbm?: string;
    status: string;
  }>,
  assignments: Array<{
    id: string;
    noPenugasan: string;
    vehicleId?: string;
    plateNumber?: string;
    vehicleType?: string;
    driverName?: string;
    destination?: string;
    status: string;
    volumeCbm?: string;
    beratMuatan?: string;
    purpose?: string;
    handoverData?: unknown;
  }>
): ActiveFleetCbmSummary {
  const activeAsgs = assignments.filter((a) => isAssignmentCurrentlyActive(a));
  const usedAsgIds = new Set<string>();
  const units: ActiveUnitCbmBreakdown[] = [];

  for (const v of vehicles) {
    const vIdNorm = v.id.trim().toLowerCase();
    const vPlateNorm = v.plateNumber.trim().toLowerCase().replace(/\s+/g, '');

    const matchingAsgs = activeAsgs.filter((a) => {
      const aVehId = String(a.vehicleId || '').trim().toLowerCase();
      const aPlate = String(a.plateNumber || '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '');
      if (vIdNorm && aVehId === vIdNorm) return true;
      if (vPlateNorm && aPlate === vPlateNorm) return true;
      return false;
    });

    const isOnDuty = v.status === 'Dalam Tugas' || matchingAsgs.length > 0;
    if (!isOnDuty) continue;

    for (const ma of matchingAsgs) {
      usedAsgIds.add(ma.id);
    }

    const capCbm =
      parseCbmNumeric(v.capacityCbm) ??
      (() => {
        const capMeas = parseLoadMeasurement(v.capacity);
        return capMeas?.family === 'VOLUME_CBM' ? capMeas.normalizedValue : null;
      })();

    const items: ActiveUnitAssignmentCbmItem[] = matchingAsgs.map((a) => {
      const cbm = resolveAssignmentCbm(a);
      return {
        id: a.id,
        noPenugasan: a.noPenugasan,
        destination: a.destination || '-',
        driverName: a.driverName || '-',
        status: a.status,
        volumeCbm: cbm,
        volumeDisplay: cbm > 0 ? formatCbmValue(cbm) : 'Belum diisi',
        beratMuatan: a.beratMuatan,
      };
    });

    const usedCbm =
      Math.round(items.reduce((acc, item) => acc + item.volumeCbm, 0) * 1000) /
      1000;
    const remainingCbm =
      capCbm !== null
        ? Math.max(0, Math.round((capCbm - usedCbm) * 1000) / 1000)
        : null;
    const overCbm =
      capCbm !== null && usedCbm > capCbm
        ? Math.round((usedCbm - capCbm) * 1000) / 1000
        : 0;
    const utilizationPct =
      capCbm !== null && capCbm > 0
        ? Math.round((usedCbm / capCbm) * 1000) / 10
        : null;

    let category: LoadUtilizationCategory = 'UNMEASURED';
    if (utilizationPct !== null && usedCbm > 0) {
      if (utilizationPct > 100) category = 'OVERLOAD';
      else if (utilizationPct >= 70) category = 'OPTIMAL';
      else if (utilizationPct >= 40) category = 'MODERATE';
      else category = 'UNDERLOAD';
    }

    units.push({
      unitId: v.id,
      plateNumber: v.plateNumber,
      vehicleType: v.vehicleType,
      unitStatus: 'Dalam Tugas',
      capacityWeight: v.capacity || '-',
      capacityCbm: capCbm,
      capacityCbmDisplay: capCbm !== null ? formatCbmValue(capCbm) : '-',
      usedCbm,
      usedCbmDisplay: formatCbmValue(usedCbm),
      remainingCbm,
      remainingCbmDisplay:
        remainingCbm !== null ? formatCbmValue(remainingCbm) : '-',
      overCbm,
      utilizationPct,
      category,
      activeAssignments: items,
    });
  }

  // Group any active assignments whose unit was not matched in Master Armada
  const unmatchedByPlate = new Map<string, typeof activeAsgs>();
  for (const a of activeAsgs) {
    if (usedAsgIds.has(a.id)) continue;
    const key =
      String(a.plateNumber || a.vehicleId || 'UNIT-AKTIF')
        .trim()
        .toUpperCase() || 'UNIT-AKTIF';
    const group = unmatchedByPlate.get(key) || [];
    group.push(a);
    unmatchedByPlate.set(key, group);
  }

  for (const [key, group] of unmatchedByPlate.entries()) {
    const first = group[0];
    const items: ActiveUnitAssignmentCbmItem[] = group.map((a) => {
      const cbm = resolveAssignmentCbm(a);
      return {
        id: a.id,
        noPenugasan: a.noPenugasan,
        destination: a.destination || '-',
        driverName: a.driverName || '-',
        status: a.status,
        volumeCbm: cbm,
        volumeDisplay: cbm > 0 ? formatCbmValue(cbm) : 'Belum diisi',
        beratMuatan: a.beratMuatan,
      };
    });
    const usedCbm =
      Math.round(items.reduce((acc, item) => acc + item.volumeCbm, 0) * 1000) /
      1000;
    units.push({
      unitId: first.vehicleId || key,
      plateNumber: first.plateNumber || key,
      vehicleType: first.vehicleType || '-',
      unitStatus: 'Dalam Tugas',
      capacityWeight: '-',
      capacityCbm: null,
      capacityCbmDisplay: '-',
      usedCbm,
      usedCbmDisplay: formatCbmValue(usedCbm),
      remainingCbm: null,
      remainingCbmDisplay: '-',
      overCbm: 0,
      utilizationPct: null,
      category: 'UNMEASURED',
      activeAssignments: items,
    });
  }

  const totalUsedCbm =
    Math.round(units.reduce((acc, u) => acc + u.usedCbm, 0) * 1000) / 1000;
  const totalCapacityCbm =
    Math.round(
      units.reduce((acc, u) => acc + (u.capacityCbm ?? 0), 0) * 1000
    ) / 1000;
  const totalRemainingCbm =
    Math.round(
      units.reduce((acc, u) => acc + (u.remainingCbm ?? 0), 0) * 1000
    ) / 1000;
  const avgUtilizationPct =
    totalCapacityCbm > 0
      ? Math.round((totalUsedCbm / totalCapacityCbm) * 1000) / 10
      : null;

  return {
    activeUnitsCount: units.length,
    activeAssignmentsCount: activeAsgs.length,
    totalUsedCbm,
    totalCapacityCbm,
    totalRemainingCbm,
    avgUtilizationPct,
    units,
  };
}

