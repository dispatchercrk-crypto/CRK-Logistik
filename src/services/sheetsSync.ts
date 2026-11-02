import {
  Assignment,
  DriverExpense,
  DriverMaster,
  FleetCardMaster,
  RouteMaster,
  TaskStatus,
  VehicleCoolingType,
  VehicleMaster,
  WhatsAppTargetMode,
} from '../types';
import {
  isHtmlOrMobileProxyError,
  looksLikeHtmlPayload,
} from '../utils/safeFetchJson';

export type CanonicalSheetKey =
  | 'Master_Driver'
  | 'Master_Armada'
  | 'Master_Rute'
  | 'Master_Fleet_Card'
  | 'Pengeluaran_Driver'
  | 'Surat_Tugas'
  | 'Konfigurasi';

const SHEET_HEADERS: Record<CanonicalSheetKey, string[]> = {
  Master_Driver: [
    'ID Driver',
    'Nama Driver',
    'No WhatsApp',
    'PIN Login',
    'Jenis SIM',
    'Status Aktif',
  ],
  Master_Armada: [
    'Kode Unit',
    'No Polisi',
    'Tipe Kendaraan',
    'Kapasitas',
    'Status Unit',
    'Kapasitas CBM',
  ],
  Master_Rute: [
    'Kode Rute',
    'Lokasi Tujuan',
    'Nama PIC Tujuan',
    'No WA PIC Tujuan',
  ],
  Master_Fleet_Card: [
    'ID Fleet Card',
    'Nomor Kartu Fleet Card',
    'Saldo Fleet Card',
  ],
  Pengeluaran_Driver: [
    'ID Pengeluaran',
    'Timestamp Otomatis',
    'Tanggal',
    'ID Driver',
    'Nama Driver',
    'No Polisi',
    'No Surat Tugas Selesai',
    'ID Fleet Card',
    'Nomor Kartu Fleet Card',
    'Total Pembelian BBM',
    'Link Foto Struk BBM',
    'Total Pengeluaran Tol',
    'Link Foto Struk Tol',
    'Total Pengeluaran',
    'Catatan',
    'Tanggal Pengiriman',
    'Tujuan Pengiriman',
  ],
  Surat_Tugas: [
    'ID Internal',
    'Urutan',
    'No Penugasan',
    'No Surat Jalan Fisik',
    'Kode Segel',
    'Tanggal Tugas',
    'ID Driver',
    'Nama Driver',
    'No WA Driver',
    'Kode Unit',
    'No Polisi',
    'Tipe Kendaraan',
    'Jenis Armada (Pendingin/Non)',
    'Titik Keberangkatan Driver',
    'Kode Rute',
    'Lokasi Tujuan',
    'Muatan Pengiriman',
    'Status',
    'Timestamp Berangkat',
    'KM Awal',
    'Suhu Awal',
    'BBM Awal',
    'Kondisi Berangkat',
    'Catatan Berangkat',
    'Status Foto Berangkat',
    'Timestamp Serah Terima',
    'KM Akhir',
    'Suhu Serah Terima',
    'BBM Akhir',
    'Penerima Serah Terima',
    'Kondisi Akhir',
    'Catatan Serah Terima',
    'Status Foto & TTD Serah Terima',
    'Catatan Dispatcher',
    'Dibuat Pada',
    'Target Jam Tiba',
    'Berat Muatan',
    'Link Folder Google Drive',
    'Link Foto Odometer Keberangkatan',
    'Link Foto Suhu Keberangkatan',
    'Link Foto Odometer Serah Terima',
    'Link Foto Suhu Serah Terima',
    'Link Foto Bukti Serah Terima',
    'Link Tanda Tangan Penerima',
    'Waktu Tiba (Delivered)',
    'Volume Muatan (CBM)',
  ],
  Konfigurasi: ['Kunci', 'Nilai'],
};

const SHEET_ALIASES: Record<CanonicalSheetKey, string[]> = {
  Master_Driver: [
    'master_driver',
    'master driver',
    'driver',
    'drivers',
    'data driver',
    'daftar driver',
  ],
  Master_Armada: [
    'master_armada',
    'master armada',
    'armada',
    'kendaraan',
    'unit',
    'master kendaraan',
    'data kendaraan',
  ],
  Master_Rute: [
    'master_rute',
    'master rute',
    'rute',
    'tujuan',
    'lokasi tujuan',
    'data rute',
  ],
  Master_Fleet_Card: [
    'master_fleet_card',
    'master fleet card',
    'master kartu fleet card',
    'fleet_card',
    'fleet card',
    'kartu fleet card',
  ],
  Pengeluaran_Driver: [
    'pengeluaran_driver',
    'pengeluaran driver',
    'pengeluran_driver',
    'pengeluran driver',
    'data_pengeluaran driver',
    'data_pengeluaran_driver',
    'data pengeluaran driver',
  ],
  Surat_Tugas: [
    'surat_tugas',
    'surat tugas',
    'penugasan',
    'tugas',
    'assignments',
    'data surat tugas',
  ],
  Konfigurasi: ['konfigurasi', 'pengaturan', 'config', 'setting', 'admin'],
};

export function extractSpreadsheetId(input: string): string {
  const trimmed = String(input || '').trim();
  if (!trimmed || trimmed.startsWith('<')) return '';

  const sheetUrlMatch = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (sheetUrlMatch && sheetUrlMatch[1]) {
    return sheetUrlMatch[1];
  }

  const fileUrlMatch = trimmed.match(/\/d\/([a-zA-Z0-9-_]{15,})/);
  if (fileUrlMatch && fileUrlMatch[1]) {
    return fileUrlMatch[1];
  }

  const queryIdMatch = trimmed.match(/[?&]id=([a-zA-Z0-9-_]{15,})/);
  if (queryIdMatch && queryIdMatch[1]) {
    return queryIdMatch[1];
  }

  // Reject raw URLs or paths that did not contain a valid Google file ID
  if (/^https?:\/\//i.test(trimmed) || trimmed.includes('/')) {
    return '';
  }

  return /^[a-zA-Z0-9-_]{10,}$/.test(trimmed) ? trimmed : '';
}

interface SpreadsheetMetadata {
  spreadsheetId: string;
  spreadsheetUrl: string;
  properties?: {
    title?: string;
  };
  sheets?: Array<{
    properties?: {
      sheetId?: number;
      title?: string;
    };
  }>;
}

async function sheetsFetch<T>(
  url: string,
  accessToken: string,
  options: RequestInit = {}
): Promise<T> {
  const res = await fetch(url, {
    ...options,
    cache: options.cache ?? 'no-store',
    headers: {
      Accept: 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const contentType = res.headers.get('content-type');
  const rawText = await res.text();
  const trimmed = rawText.trim();
  const isHtml = looksLikeHtmlPayload(trimmed, contentType);

  if (!res.ok) {
    // If an intermediate mobile proxy or captive gateway returned an HTML page
    // (even with 401/403/502/503), mark it as an HTML proxy error instead of an OAuth revocation
    // so exponential backoff can retry without invalidating the active login session.
    if (isHtml) {
      const htmlErr = new Error(
        `Unexpected token '<': Respons proxy jaringan seluler mengembalikan halaman HTML sementara (HTTP ${res.status}).`
      ) as Error & { status?: number; isHtmlProxyError?: boolean };
      htmlErr.isHtmlProxyError = true;
      htmlErr.status = res.status >= 500 ? res.status : 502;
      throw htmlErr;
    }

    let errDetail = `Google Sheets API HTTP ${res.status}`;
    if (trimmed) {
      try {
        const errBody = JSON.parse(trimmed);
        if (errBody?.error?.message) {
          errDetail = errBody.error.message;
        }
      } catch {
        // Ignore JSON parse error on non-OK body
      }
    }
    if (res.status === 404) {
      errDetail =
        'Spreadsheet tidak ditemukan (404). Pastikan ID/URL Google Sheets benar dan akun Google memiliki akses.';
    } else if (res.status === 401 || res.status === 403) {
      errDetail =
        'Sesi token akses Google Sheets telah kedaluwarsa atau belum diizinkan.';
    }
    const err = new Error(errDetail) as Error & { status?: number };
    err.status = res.status;
    throw err;
  }

  if (!trimmed) {
    return ({} as unknown) as T;
  }

  if (isHtml) {
    const err = new Error(
      "Unexpected token '<': Respons Google Sheets terhalang halaman HTML dari proxy jaringan mobile."
    ) as Error & { status?: number; isHtmlProxyError?: boolean };
    err.isHtmlProxyError = true;
    err.status = 502;
    throw err;
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch (parseErr) {
    const err = new Error(
      isHtmlOrMobileProxyError(parseErr) || trimmed.startsWith('<')
        ? "Unexpected token '<': Data respons Google Sheets terhalang halaman HTML dari proxy jaringan mobile."
        : 'Data respons Google Sheets tidak berformat JSON valid. Periksa koneksi internet Anda lalu coba sinkronisasi ulang.'
    ) as Error & { status?: number; isHtmlProxyError?: boolean };
    if (isHtmlOrMobileProxyError(parseErr) || trimmed.startsWith('<')) {
      err.isHtmlProxyError = true;
      err.status = 502;
    }
    throw err;
  }
}

export async function getSpreadsheetMetadata(
  accessToken: string,
  spreadsheetId: string
): Promise<{
  title: string;
  url: string;
  resolvedTabs: Record<CanonicalSheetKey, string | null>;
  allTabTitles: string[];
}> {
  const meta = await sheetsFetch<SpreadsheetMetadata>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}?includeGridData=false`,
    accessToken
  );

  const allTabTitles = (meta.sheets || [])
    .map((s) => s.properties?.title || '')
    .filter(Boolean);

  const resolvedTabs: Record<CanonicalSheetKey, string | null> = {
    Master_Driver: null,
    Master_Armada: null,
    Master_Rute: null,
    Master_Fleet_Card: null,
    Pengeluaran_Driver: null,
    Surat_Tugas: null,
    Konfigurasi: null,
  };

  for (const key of Object.keys(SHEET_ALIASES) as CanonicalSheetKey[]) {
    const aliases = SHEET_ALIASES[key];
    const found = allTabTitles.find((t) =>
      aliases.includes(t.trim().toLowerCase())
    );
    resolvedTabs[key] = found || null;
  }

  return {
    title: meta.properties?.title || 'CRK Logistik Delivery Sistem',
    url:
      meta.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    resolvedTabs,
    allTabTitles,
  };
}

export async function ensureSpreadsheetStructure(
  accessToken: string,
  spreadsheetId: string
): Promise<{
  title: string;
  url: string;
  tabNames: Record<CanonicalSheetKey, string>;
}> {
  const meta = await getSpreadsheetMetadata(accessToken, spreadsheetId);
  const missingKeys = (
    Object.keys(meta.resolvedTabs) as CanonicalSheetKey[]
  ).filter((k) => !meta.resolvedTabs[k]);

  const finalTabNames: Record<CanonicalSheetKey, string> = {
    Master_Driver: meta.resolvedTabs.Master_Driver || 'Master_Driver',
    Master_Armada: meta.resolvedTabs.Master_Armada || 'Master_Armada',
    Master_Rute: meta.resolvedTabs.Master_Rute || 'Master_Rute',
    Master_Fleet_Card:
      meta.resolvedTabs.Master_Fleet_Card || 'Master_Fleet_Card',
    Pengeluaran_Driver:
      meta.resolvedTabs.Pengeluaran_Driver || 'Pengeluaran_Driver',
    Surat_Tugas: meta.resolvedTabs.Surat_Tugas || 'Surat_Tugas',
    Konfigurasi: meta.resolvedTabs.Konfigurasi || 'Konfigurasi',
  };

  if (missingKeys.length > 0) {
    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          requests: missingKeys.map((key) => ({
            addSheet: {
              properties: {
                title: key,
                gridProperties: { frozenRowCount: 1 },
              },
            },
          })),
        }),
      }
    );

    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values:batchUpdate`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: missingKeys.map((key) => ({
            range: `'${key}'!A1`,
            values: [SHEET_HEADERS[key]],
          })),
        }),
      }
    );
  }

  return {
    title: meta.title,
    url: meta.url,
    tabNames: finalTabNames,
  };
}

export async function createNewDatabaseSpreadsheet(
  accessToken: string,
  customTitle?: string
): Promise<{
  spreadsheetId: string;
  title: string;
  url: string;
}> {
  const title =
    (customTitle || '').trim() ||
    `CRK LOGISTIK DELIVERY SISTEM (${new Date().toISOString().slice(0, 10)})`;

  const keys = Object.keys(SHEET_HEADERS) as CanonicalSheetKey[];
  const created = await sheetsFetch<SpreadsheetMetadata>(
    'https://sheets.googleapis.com/v4/spreadsheets',
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        properties: { title },
        sheets: keys.map((key) => ({
          properties: {
            title: key,
            gridProperties: { frozenRowCount: 1 },
          },
        })),
      }),
    }
  );

  const spreadsheetId = created.spreadsheetId;

  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchUpdate`,
    accessToken,
    {
      method: 'POST',
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: keys.map((key) => ({
          range: `'${key}'!A1`,
          values: [SHEET_HEADERS[key]],
        })),
      }),
    }
  );

  return {
    spreadsheetId,
    title: created.properties?.title || title,
    url:
      created.spreadsheetUrl ||
      `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
  };
}

function parseTaskStatus(raw: string): TaskStatus {
  const val = String(raw || '').trim().toLowerCase();
  if (val === 'dalam perjalanan') return TaskStatus.DALAM_PERJALANAN;
  if (val === 'delivered') return TaskStatus.DELIVERED;
  if (val === 'handover') return TaskStatus.HANDOVER;
  if (val === 'selesai') return TaskStatus.SELESAI;
  return TaskStatus.MENUNGGU_BERANGKAT;
}

export function parseIdrNumericCell(raw: unknown): number {
  const str = String(raw ?? '').trim();
  if (!str) return 0;
  const cleaned = str
    .replace(/rp/gi, '')
    .replace(/\s+/g, '')
    .replace(/\.(?=\d{3}(?:\D|$))/g, '')
    .replace(/,/g, '.');
  const num = Number(cleaned.replace(/[^\d.-]/g, ''));
  return Number.isFinite(num) ? Math.round(num) : 0;
}

export async function pullAllFromSpreadsheet(
  accessToken: string,
  spreadsheetId: string
): Promise<{
  spreadsheetId: string;
  spreadsheetTitle: string;
  spreadsheetUrl: string;
  drivers: DriverMaster[];
  vehicles: VehicleMaster[];
  routes: RouteMaster[];
  fleetCards: FleetCardMaster[];
  driverExpenses: DriverExpense[];
  assignments: Assignment[];
  adminPin?: string;
  dispatcherWaPhone?: string;
  whatsappTargetMode?: WhatsAppTargetMode;
  whatsappGroupName?: string;
  whatsappGroupInviteUrl?: string;
  letterPrefix?: string;
  publicPortalBaseUrl?: string;
  appsScriptUrl?: string;
  driveRootFolderId?: string;
  driveRootFolderUrl?: string;
}> {
  const ensured = await ensureSpreadsheetStructure(accessToken, spreadsheetId);
  const { tabNames } = ensured;

  const ranges = [
    `'${tabNames.Master_Driver}'!A1:G2000`,
    `'${tabNames.Master_Armada}'!A1:F2000`,
    `'${tabNames.Master_Rute}'!A1:F2000`,
    `'${tabNames.Surat_Tugas}'!A1:AZ3000`,
    `'${tabNames.Konfigurasi}'!A2:B60`,
    `'${tabNames.Master_Fleet_Card}'!A1:D2000`,
    `'${tabNames.Pengeluaran_Driver}'!A1:R3000`,
  ];

  const query = ranges.map((r) => `ranges=${encodeURIComponent(r)}`).join('&');
  const batchRes = await sheetsFetch<{
    valueRanges?: Array<{ range?: string; values?: string[][] }>;
  }>(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchGet?${query}`,
    accessToken
  );

  const valueRanges = batchRes.valueRanges || [];
  const driverAll = valueRanges[0]?.values || [];
  const vehicleAll = valueRanges[1]?.values || [];
  const routeAll = valueRanges[2]?.values || [];
  const assignmentAll = valueRanges[3]?.values || [];
  const configRows = valueRanges[4]?.values || [];
  const fleetCardAll = valueRanges[5]?.values || [];
  const expenseAll = valueRanges[6]?.values || [];

  // Parse Drivers (supports both new 6-col format and legacy 7-col format)
  const driverHeader = (driverAll[0] || []).map((h) =>
    String(h || '').toLowerCase()
  );
  const drvStatusIdx = driverHeader.findIndex((h) => h.includes('status'));
  const drivers: DriverMaster[] = driverAll
    .slice(1)
    .filter((row) => row && String(row[0] || '').trim() !== '')
    .map((row) => {
      const sIdx = drvStatusIdx >= 0 ? drvStatusIdx : row.length >= 7 ? 6 : 5;
      const statusRaw = String(row[sIdx] ?? 'Aktif').trim().toLowerCase();
      return {
        id: String(row[0] || '').trim().toUpperCase(),
        name: String(row[1] || '').trim(),
        phone: String(row[2] || '').trim(),
        pin: String(row[3] || '').trim(),
        licenseType: String(row[4] || 'SIM B1').trim(),
        active:
          statusRaw !== 'nonaktif' && statusRaw !== 'false' && statusRaw !== '0',
      };
    });

  // Parse Vehicles (supports 6-col CBM format, 5-col format, and legacy 6-col format)
  const vehHeader = (vehicleAll[0] || []).map((h) =>
    String(h || '').toLowerCase()
  );
  const vehStatusIdx = vehHeader.findIndex((h) => h.includes('status'));
  const vehCbmIdx = vehHeader.findIndex(
    (h) => h.includes('cbm') || h.includes('volume') || h.includes('kubik')
  );
  const vehicles: VehicleMaster[] = vehicleAll
    .slice(1)
    .filter(
      (row) =>
        row &&
        (String(row[0] || '').trim() !== '' ||
          String(row[1] || '').trim() !== '')
    )
    .map((row, idx) => {
      const sIdx =
        vehStatusIdx >= 0
          ? vehStatusIdx
          : row.length >= 6 && vehCbmIdx < 0
          ? 5
          : 4;
      const rawStatus = String(row[sIdx] || 'Siap Jalan').trim();
      const status: VehicleMaster['status'] =
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

  // Parse Master Rute / Tujuan (supports both new 4-col format and legacy 6-col format)
  const routeHeader = (routeAll[0] || []).map((h) =>
    String(h || '').toLowerCase()
  );
  const isLegacyRoute = routeHeader.some((h) => h.includes('asal'));
  const routes: RouteMaster[] = routeAll
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

  // Parse Assignments (supports both 36-col schema and legacy 28-col schema)
  const asgHeader = (assignmentAll[0] || []).map((h) =>
    String(h || '').toLowerCase()
  );
  const isNewColdChainSchema = asgHeader.some((h) =>
    h.includes('surat jalan fisik')
  );
  const asgCbmIdx = asgHeader.findIndex(
    (h) => h.includes('cbm') || h.includes('volume muatan')
  );

  const assignments: Assignment[] = assignmentAll
    .slice(1)
    .filter((row) => row && String(row[2] || '').trim() !== '')
    .map((row, index) => {
      const noPenugasan = String(row[2] || '').trim();
      const seqNum =
        Number(row[1]) ||
        (() => {
          const m = noPenugasan.match(/(\d+)\s*$/);
          return m ? parseInt(m[1], 10) : index + 1;
        })();

      if (isNewColdChainSchema) {
        const rawCol12 = String(row[12] || '').trim();
        const parsedJenisKendaraan: VehicleCoolingType | undefined =
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
          volumeCbm:
            (asgCbmIdx >= 0
              ? String(row[asgCbmIdx] || '').trim()
              : String(row[45] || '').trim()) || undefined,
          status: parseTaskStatus(row[17]),
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

      // Legacy fallback mapping
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
        status: parseTaskStatus(row[14]),
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
  let whatsappTargetMode: WhatsAppTargetMode | undefined;
  let whatsappGroupName: string | undefined;
  let whatsappGroupInviteUrl: string | undefined;
  let letterPrefix: string | undefined;
  let publicPortalBaseUrl: string | undefined;
  let appsScriptUrl: string | undefined;
  let driveRootFolderId: string | undefined;
  let driveRootFolderUrl: string | undefined;

  for (const row of configRows) {
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
    if (k === 'public_portal_url' && v !== undefined) {
      publicPortalBaseUrl = v;
    }
    if (k === 'apps_script_url' && v !== undefined) {
      appsScriptUrl = v;
    }
    if (k === 'drive_root_folder_id' && v) {
      driveRootFolderId = v;
    }
    if (k === 'drive_root_folder_url' && v) {
      driveRootFolderUrl = v;
    }
  }

  const fleetCards: FleetCardMaster[] = fleetCardAll
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
      balance: parseIdrNumericCell(row[2]),
    }));

  const driverExpenses: DriverExpense[] = expenseAll
    .slice(1)
    .filter(
      (row) =>
        row &&
        (String(row[0] || '').trim() !== '' ||
          String(row[1] || '').trim() !== '' ||
          String(row[8] || '').trim() !== '')
    )
    .map((row, idx) => {
      const bbm = parseIdrNumericCell(row[9]);
      const tol = parseIdrNumericCell(row[11]);
      const totalCell = parseIdrNumericCell(row[13]);
      const rawTs = String(row[1] || '').trim() || new Date().toISOString();
      const rawTanggal =
        String(row[2] || '').trim() ||
        (/^\d{4}-\d{2}-\d{2}/.test(rawTs)
          ? rawTs.slice(0, 10)
          : new Date().toISOString().slice(0, 10));
      const bbmUrl = String(row[10] || '').trim();
      const tolUrl = String(row[12] || '').trim();
      const rawTanggalPengiriman = String(row[15] || '').trim();
      const rawTujuanPengiriman = String(row[16] || '').trim();
      return {
        id: String(row[0] || `EXP-SHEET-${idx + 1}`).trim(),
        timestamp: rawTs,
        tanggal: rawTanggal,
        tanggalPengiriman: rawTanggalPengiriman || rawTanggal,
        tujuanPengiriman: rawTujuanPengiriman || undefined,
        driverId: String(row[3] || '').trim().toUpperCase(),
        driverName: String(row[4] || '').trim(),
        plateNumber: String(row[5] || '').trim().toUpperCase() || undefined,
        completedAssignmentNos: String(row[6] || '').trim() || undefined,
        fleetCardId: String(row[7] || '-').trim().toUpperCase(),
        fleetCardNumber: String(row[8] || '').trim(),
        totalPengirimanBbm: bbm,
        fotoStrukBbmUrl: /^https?:\/\//i.test(bbmUrl) ? bbmUrl : undefined,
        totalPengeluaranTol: tol,
        fotoStrukTolUrl: /^https?:\/\//i.test(tolUrl) ? tolUrl : undefined,
        totalPengeluaran: totalCell > 0 ? totalCell : bbm + tol,
        catatan: String(row[14] || '').trim() || undefined,
        needsSheetSync: false,
      };
    });

  return {
    spreadsheetId,
    spreadsheetTitle: ensured.title,
    spreadsheetUrl: ensured.url,
    drivers,
    vehicles,
    routes,
    fleetCards,
    driverExpenses,
    assignments,
    adminPin,
    dispatcherWaPhone,
    whatsappTargetMode,
    whatsappGroupName,
    whatsappGroupInviteUrl,
    letterPrefix,
    publicPortalBaseUrl,
    appsScriptUrl,
    driveRootFolderId,
    driveRootFolderUrl,
  };
}

async function replaceSheetRows(
  accessToken: string,
  spreadsheetId: string,
  tabName: string,
  headerRow: string[],
  dataRows: Array<Array<string | number>>
): Promise<void> {
  const values = [headerRow, ...dataRows];

  // 1. Write new rows FIRST so if OAuth token is expired (401) or network fails, existing Spreadsheet rows are 100% untouched
  await sheetsFetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values/${encodeURIComponent(`'${tabName}'!A1`)}?valueInputOption=RAW`,
    accessToken,
    {
      method: 'PUT',
      body: JSON.stringify({
        range: `'${tabName}'!A1`,
        majorDimension: 'ROWS',
        values,
      }),
    }
  );

  // 2. Only AFTER write succeeds, clear any leftover trailing rows strictly below the written range
  const clearStartRow = values.length + 1;
  if (clearStartRow <= 3000) {
    await sheetsFetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values/${encodeURIComponent(
        `'${tabName}'!A${clearStartRow}:AZ3000`
      )}:clear`,
      accessToken,
      {
        method: 'POST',
        body: JSON.stringify({}),
      }
    );
  }
}

export async function pushDriversToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  drivers: DriverMaster[],
  allowEmptyOverwrite = false
): Promise<void> {
  if (drivers.length === 0 && !allowEmptyOverwrite) return;
  const ensured = await ensureSpreadsheetStructure(accessToken, spreadsheetId);
  const rows = drivers.map((d) => [
    d.id,
    d.name,
    d.phone,
    d.pin,
    d.licenseType,
    d.active ? 'Aktif' : 'Nonaktif',
  ]);
  await replaceSheetRows(
    accessToken,
    spreadsheetId,
    ensured.tabNames.Master_Driver,
    SHEET_HEADERS.Master_Driver,
    rows
  );
}

export async function pushVehiclesToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  vehicles: VehicleMaster[],
  allowEmptyOverwrite = false
): Promise<void> {
  if (vehicles.length === 0 && !allowEmptyOverwrite) return;
  const ensured = await ensureSpreadsheetStructure(accessToken, spreadsheetId);
  const rows = vehicles.map((v) => [
    v.id,
    v.plateNumber,
    v.vehicleType,
    v.capacity,
    v.status,
    v.capacityCbm || '',
  ]);
  await replaceSheetRows(
    accessToken,
    spreadsheetId,
    ensured.tabNames.Master_Armada,
    SHEET_HEADERS.Master_Armada,
    rows
  );
}

export async function pushRoutesToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  routes: RouteMaster[],
  allowEmptyOverwrite = false
): Promise<void> {
  if (routes.length === 0 && !allowEmptyOverwrite) return;
  const ensured = await ensureSpreadsheetStructure(accessToken, spreadsheetId);
  const rows = routes.map((r) => [
    r.id,
    r.destination,
    r.picName,
    r.picPhone,
  ]);
  await replaceSheetRows(
    accessToken,
    spreadsheetId,
    ensured.tabNames.Master_Rute,
    SHEET_HEADERS.Master_Rute,
    rows
  );
}

export async function pushFleetCardsToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  fleetCards: FleetCardMaster[],
  allowEmptyOverwrite = false
): Promise<void> {
  if (fleetCards.length === 0 && !allowEmptyOverwrite) return;
  const ensured = await ensureSpreadsheetStructure(accessToken, spreadsheetId);
  const rows = fleetCards.map((fc) => [
    fc.id,
    fc.cardNumber,
    Math.round(Number(fc.balance) || 0),
  ]);
  await replaceSheetRows(
    accessToken,
    spreadsheetId,
    ensured.tabNames.Master_Fleet_Card,
    SHEET_HEADERS.Master_Fleet_Card,
    rows
  );
}

export async function pushDriverExpensesToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  driverExpenses: DriverExpense[],
  allowEmptyOverwrite = false
): Promise<void> {
  if (driverExpenses.length === 0 && !allowEmptyOverwrite) return;
  const ensured = await ensureSpreadsheetStructure(accessToken, spreadsheetId);
  const sorted = [...driverExpenses].sort(
    (a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
  const rows = sorted.map((exp) => [
    exp.id,
    exp.timestamp,
    exp.tanggal,
    exp.driverId,
    exp.driverName,
    exp.plateNumber || '',
    exp.completedAssignmentNos || '',
    exp.fleetCardId || '-',
    exp.fleetCardNumber,
    Math.round(Number(exp.totalPengirimanBbm) || 0),
    exp.fotoStrukBbmUrl || (exp.fotoStrukBbm ? 'Foto Struk BBM Tersimpan' : ''),
    Math.round(Number(exp.totalPengeluaranTol) || 0),
    exp.fotoStrukTolUrl || (exp.fotoStrukTol ? 'Foto Struk Tol Tersimpan' : ''),
    Math.round(Number(exp.totalPengeluaran) || 0),
    exp.catatan || '',
    exp.tanggalPengiriman || exp.tanggal || '',
    exp.tujuanPengiriman || '',
  ]);
  await replaceSheetRows(
    accessToken,
    spreadsheetId,
    ensured.tabNames.Pengeluaran_Driver,
    SHEET_HEADERS.Pengeluaran_Driver,
    rows
  );
}

export async function pushAssignmentsToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  assignments: Assignment[],
  allowEmptyOverwrite = false
): Promise<void> {
  if (assignments.length === 0 && !allowEmptyOverwrite) return;
  const ensured = await ensureSpreadsheetStructure(accessToken, spreadsheetId);
  const sorted = [...assignments].sort(
    (a, b) => a.sequenceNumber - b.sequenceNumber
  );
  const rows = sorted.map((a) => {
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
  });
  await replaceSheetRows(
    accessToken,
    spreadsheetId,
    ensured.tabNames.Surat_Tugas,
    SHEET_HEADERS.Surat_Tugas,
    rows
  );
}

export async function pushConfigToSpreadsheet(
  accessToken: string,
  spreadsheetId: string,
  config: {
    adminPin: string;
    dispatcherWaPhone: string;
    whatsappTargetMode?: WhatsAppTargetMode;
    whatsappGroupName?: string;
    whatsappGroupInviteUrl?: string;
    letterPrefix: string;
    publicPortalBaseUrl?: string;
    appsScriptUrl?: string;
    driveRootFolderId?: string;
    driveRootFolderUrl?: string;
  }
): Promise<void> {
  const ensured = await ensureSpreadsheetStructure(accessToken, spreadsheetId);
  const rows = [
    ['admin_pin', config.adminPin],
    ['dispatcher_wa', config.dispatcherWaPhone],
    ['whatsapp_target_mode', config.whatsappTargetMode || 'GROUP'],
    ['whatsapp_group_name', config.whatsappGroupName || ''],
    ['whatsapp_group_invite', config.whatsappGroupInviteUrl || ''],
    ['letter_prefix', config.letterPrefix],
    ['public_portal_url', config.publicPortalBaseUrl || ''],
    ['apps_script_url', config.appsScriptUrl || ''],
    ['drive_root_folder_id', config.driveRootFolderId || ''],
    ['drive_root_folder_url', config.driveRootFolderUrl || ''],
  ];
  await replaceSheetRows(
    accessToken,
    spreadsheetId,
    ensured.tabNames.Konfigurasi,
    SHEET_HEADERS.Konfigurasi,
    rows
  );
}
