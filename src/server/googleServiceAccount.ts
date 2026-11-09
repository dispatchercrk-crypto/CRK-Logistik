import crypto from 'crypto';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

export type CanonicalServerSheetKey =
  | 'Master_Driver'
  | 'Master_Armada'
  | 'Master_Rute'
  | 'Master_Fleet_Card'
  | 'Pengeluaran_Driver'
  | 'Surat_Tugas'
  | 'Konfigurasi';

export const SERVER_SHEET_HEADERS: Record<CanonicalServerSheetKey, string[]> = {
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

const CANONICAL_TAB_ORDER: CanonicalServerSheetKey[] = [
  'Master_Driver',
  'Master_Armada',
  'Master_Rute',
  'Master_Fleet_Card',
  'Pengeluaran_Driver',
  'Surat_Tugas',
  'Konfigurasi',
];

export interface ParsedServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  projectId: string;
  tokenUri: string;
}

export type ServiceAccountRuntimeStatus =
  | 'ACTIVE'
  | 'NOT_CONFIGURED'
  | 'PERMISSION_NEEDED'
  | 'ERROR';

export interface ServiceAccountPublicInfo {
  configured: boolean;
  clientEmail: string;
  projectId: string;
  status: ServiceAccountRuntimeStatus;
  lastError?: string;
  lastVerifiedAt?: string;
}

let cachedAccessToken = '';
let cachedTokenExpiresAtMs = 0;
let cachedTokenFingerprint = '';

let lastRuntimeStatus: ServiceAccountRuntimeStatus = 'NOT_CONFIGURED';
let lastRuntimeError = '';
let lastVerifiedAtIso = '';

const DEFAULT_SERVICE_ACCOUNT_EMAIL =
  'crk-sheets-sync@gen-lang-client-0326301182.iam.gserviceaccount.com';
const DEFAULT_SERVICE_ACCOUNT_PROJECT_ID = 'gen-lang-client-0326301182';

function isPlaceholderValue(val: string): boolean {
  const trimmed = String(val || '').trim();
  if (!trimmed) return true;
  const upper = trimmed.toUpperCase();
  return (
    upper.startsWith('MY_') ||
    upper.startsWith('YOUR_') ||
    upper === 'PASTE_HERE' ||
    upper === 'REPLACE_ME'
  );
}

function normalizePrivateKeyPem(rawKey: string): string {
  let cleaned = String(rawKey || '').trim();
  if (
    (cleaned.startsWith('"') && cleaned.endsWith('"')) ||
    (cleaned.startsWith("'") && cleaned.endsWith("'"))
  ) {
    cleaned = cleaned.slice(1, -1).trim();
  }
  cleaned = cleaned.replace(/\\r\\n/g, '\n').replace(/\\n/g, '\n');

  // Reconstruct canonical 64-char PEM lines even if mobile single-line inputs turned newlines into spaces
  const pemMatch = cleaned.match(
    /-----BEGIN ([A-Z0-9 ]*PRIVATE KEY)-----([\s\S]*?)-----END \1-----/
  );
  if (pemMatch) {
    const keyLabel = pemMatch[1];
    const base64Body = pemMatch[2].replace(/[^A-Za-z0-9+/=]/g, '');
    if (base64Body.length > 64) {
      const wrapped = base64Body.match(/.{1,64}/g)?.join('\n') || base64Body;
      return `-----BEGIN ${keyLabel}-----\n${wrapped}\n-----END ${keyLabel}-----\n`;
    }
  }

  return cleaned;
}

function tryExtractCredentialsFromAnyText(
  rawText: string
): ParsedServiceAccountCredentials | null {
  const trimmed = String(rawText || '').trim();
  if (!trimmed || isPlaceholderValue(trimmed)) return null;

  let candidate = trimmed;
  if (
    (candidate.startsWith('"') && candidate.endsWith('"')) ||
    (candidate.startsWith("'") && candidate.endsWith("'"))
  ) {
    candidate = candidate.slice(1, -1).trim();
  }

  const tryParseJsonObj = (txt: string): Record<string, unknown> | null => {
    try {
      const parsed = JSON.parse(txt);
      if (parsed && typeof parsed === 'object') {
        return parsed as Record<string, unknown>;
      }
    } catch {
      try {
        const unescaped = txt.replace(/\\"/g, '"');
        const parsed2 = JSON.parse(unescaped);
        if (parsed2 && typeof parsed2 === 'object') {
          return parsed2 as Record<string, unknown>;
        }
      } catch {
        // Fallback: extract embedded JSON object {...} if pasted inside .env.local across multiple lines
        const firstBrace = txt.indexOf('{');
        const lastBrace = txt.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace > firstBrace) {
          try {
            const slice = txt.slice(firstBrace, lastBrace + 1);
            const parsed3 = JSON.parse(slice);
            if (parsed3 && typeof parsed3 === 'object') {
              return parsed3 as Record<string, unknown>;
            }
          } catch {
            return null;
          }
        }
      }
    }
    return null;
  };

  let obj = tryParseJsonObj(candidate);
  if (
    !obj &&
    !candidate.startsWith('{') &&
    !candidate.includes('PRIVATE KEY')
  ) {
    try {
      const decoded = Buffer.from(candidate, 'base64').toString('utf8').trim();
      obj = tryParseJsonObj(decoded);
    } catch {
      obj = null;
    }
  }

  if (obj) {
    const envFallbackEmail = String(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
    ).trim();
    const clientEmail =
      String(obj.client_email || '').trim() ||
      (!isPlaceholderValue(envFallbackEmail)
        ? envFallbackEmail
        : DEFAULT_SERVICE_ACCOUNT_EMAIL);
    const privateKey = normalizePrivateKeyPem(String(obj.private_key || ''));
    const projectId =
      String(obj.project_id || '').trim() || DEFAULT_SERVICE_ACCOUNT_PROJECT_ID;
    const tokenUri =
      String(obj.token_uri || '').trim() ||
      'https://oauth2.googleapis.com/token';

    if (clientEmail && privateKey.includes('PRIVATE KEY')) {
      return {
        clientEmail,
        privateKey,
        projectId,
        tokenUri,
      };
    }
  }

  // Also support pasting just the PEM private_key directly!
  if (candidate.includes('PRIVATE KEY')) {
    const normalizedPem = normalizePrivateKeyPem(candidate);
    if (normalizedPem.includes('PRIVATE KEY')) {
      const rawEmail = String(
        process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
      ).trim();
      const clientEmail = !isPlaceholderValue(rawEmail)
        ? rawEmail
        : DEFAULT_SERVICE_ACCOUNT_EMAIL;
      return {
        clientEmail,
        privateKey: normalizedPem,
        projectId:
          String(process.env.GOOGLE_CLOUD_PROJECT || '').trim() ||
          DEFAULT_SERVICE_ACCOUNT_PROJECT_ID,
        tokenUri: 'https://oauth2.googleapis.com/token',
      };
    }
  }

  return null;
}

function readDynamicLocalEnvFallback(): ParsedServiceAccountCredentials | null {
  const candidateFiles = ['.env.local', '.env'];
  for (const fileName of candidateFiles) {
    try {
      const fullPath = path.join(process.cwd(), fileName);
      if (!fs.existsSync(fullPath)) continue;
      const content = fs.readFileSync(fullPath, 'utf8');
      if (!content.trim()) continue;

      const parsedEnv = dotenv.parse(content);
      const fromJsonVar = tryExtractCredentialsFromAnyText(
        parsedEnv.GOOGLE_SERVICE_ACCOUNT_JSON || ''
      );
      if (fromJsonVar) return fromJsonVar;

      const fromKeyVar = tryExtractCredentialsFromAnyText(
        parsedEnv.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || ''
      );
      if (fromKeyVar) {
        const customEmail = String(
          parsedEnv.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
        ).trim();
        if (customEmail && !isPlaceholderValue(customEmail)) {
          fromKeyVar.clientEmail = customEmail;
        }
        return fromKeyVar;
      }

      // Also handle raw multi-line JSON pasted directly into .env.local without quotes
      if (
        content.includes('"private_key"') &&
        content.includes('PRIVATE KEY')
      ) {
        const fromRawContent = tryExtractCredentialsFromAnyText(content);
        if (fromRawContent) return fromRawContent;
      }
    } catch {
      // Ignore fs read errors
    }
  }

  // Also check if user uploaded the downloaded Google Cloud .json (or renamed .txt) file directly into workspace root via AI Studio File Explorer
  const ignoredAppJsonFiles = new Set([
    'package.json',
    'package-lock.json',
    'tsconfig.json',
    'metadata.json',
    'firebase-applet-config.json',
    'firebase-blueprint.json',
  ]);
  try {
    const rootEntries = fs.readdirSync(process.cwd());
    for (const entry of rootEntries) {
      const lower = entry.toLowerCase();
      if (ignoredAppJsonFiles.has(lower)) continue;
      const isCandidateExt =
        lower.endsWith('.json') ||
        lower.endsWith('.txt') ||
        /^\d+(\s*\(\d+\))?$/.test(lower);
      if (!isCandidateExt) continue;
      const fullPath = path.join(process.cwd(), entry);
      const stat = fs.statSync(fullPath);
      if (!stat.isFile() || stat.size > 64 * 1024) continue;
      const raw = fs.readFileSync(fullPath, 'utf8');
      if (raw.includes('"private_key"') && raw.includes('PRIVATE KEY')) {
        const extracted = tryExtractCredentialsFromAnyText(raw);
        if (extracted) return extracted;
      }
    }
  } catch {
    // Ignore directory scan errors
  }

  return null;
}

export function parseServiceAccountFromEnv(): ParsedServiceAccountCredentials | null {
  const fromJsonEnv = tryExtractCredentialsFromAnyText(
    String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '')
  );
  if (fromJsonEnv) return fromJsonEnv;

  const fromSeparateKeyEnv = tryExtractCredentialsFromAnyText(
    String(process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || '')
  );
  if (fromSeparateKeyEnv) {
    const separateEmail = String(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
    ).trim();
    if (separateEmail && !isPlaceholderValue(separateEmail)) {
      fromSeparateKeyEnv.clientEmail = separateEmail;
    }
    return fromSeparateKeyEnv;
  }

  return readDynamicLocalEnvFallback();
}

export function isGoogleServiceAccountConfigured(): boolean {
  return parseServiceAccountFromEnv() !== null;
}

export function getServiceAccountPublicStatus(): ServiceAccountPublicInfo {
  const creds = parseServiceAccountFromEnv();
  if (!creds) {
    const rawEmail = String(
      process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || ''
    ).trim();
    const displayEmail = !isPlaceholderValue(rawEmail)
      ? rawEmail
      : DEFAULT_SERVICE_ACCOUNT_EMAIL;
    return {
      configured: false,
      clientEmail: displayEmail,
      projectId: DEFAULT_SERVICE_ACCOUNT_PROJECT_ID,
      status: 'NOT_CONFIGURED',
    };
  }
  const effectiveStatus: ServiceAccountRuntimeStatus =
    lastRuntimeStatus === 'NOT_CONFIGURED' ? 'ACTIVE' : lastRuntimeStatus;
  return {
    configured: true,
    clientEmail: creds.clientEmail,
    projectId: creds.projectId,
    status: effectiveStatus,
    lastError: lastRuntimeError || undefined,
    lastVerifiedAt: lastVerifiedAtIso || undefined,
  };
}

function base64UrlEncode(input: Buffer | string): string {
  const buf = typeof input === 'string' ? Buffer.from(input, 'utf8') : input;
  return buf
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export async function getServiceAccountAccessToken(): Promise<string> {
  const creds = parseServiceAccountFromEnv();
  if (!creds) {
    lastRuntimeStatus = 'NOT_CONFIGURED';
    throw new Error('Google Service Account belum dikonfigurasi di server.');
  }

  const fp = `${creds.clientEmail}:${creds.privateKey.length}`;
  const nowMs = Date.now();
  if (
    cachedAccessToken &&
    cachedTokenFingerprint === fp &&
    nowMs + 5 * 60 * 1000 < cachedTokenExpiresAtMs
  ) {
    return cachedAccessToken;
  }

  const iat = Math.floor(nowMs / 1000);
  const exp = iat + 3600;
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claimSet = base64UrlEncode(
    JSON.stringify({
      iss: creds.clientEmail,
      scope:
        'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',
      aud: creds.tokenUri,
      iat,
      exp,
    })
  );

  const unsignedJwt = `${header}.${claimSet}`;
  let signature = '';
  try {
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(unsignedJwt);
    signer.end();
    signature = base64UrlEncode(signer.sign(creds.privateKey));
  } catch (err) {
    lastRuntimeStatus = 'ERROR';
    lastRuntimeError =
      err instanceof Error
        ? `Format private_key Service Account tidak valid: ${err.message}`
        : 'Format private_key Service Account tidak valid.';
    throw new Error(lastRuntimeError);
  }

  const assertion = `${unsignedJwt}.${signature}`;
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const resp = await fetch(creds.tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal: AbortSignal.timeout(10000),
  });

  const text = await resp.text();
  if (!resp.ok) {
    lastRuntimeStatus = 'ERROR';
    lastRuntimeError = `Gagal meminta token OAuth Service Account (HTTP ${resp.status}): ${text.slice(0, 180)}`;
    throw new Error(lastRuntimeError);
  }

  const parsed = JSON.parse(text) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!parsed.access_token) {
    lastRuntimeStatus = 'ERROR';
    lastRuntimeError = 'Respons token Service Account tidak berisi access_token.';
    throw new Error(lastRuntimeError);
  }

  cachedAccessToken = parsed.access_token;
  cachedTokenExpiresAtMs =
    nowMs + Math.max(300, Number(parsed.expires_in) || 3600) * 1000;
  cachedTokenFingerprint = fp;
  return cachedAccessToken;
}

interface SpreadsheetMetadataResponse {
  properties?: { title?: string };
  sheets?: Array<{ properties?: { title?: string; sheetId?: number } }>;
}

async function ensureCanonicalTabsExist(
  accessToken: string,
  spreadsheetId: string
): Promise<{ title: string; existingTitles: Map<CanonicalServerSheetKey, string> }> {
  const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}?fields=properties.title,sheets.properties(title,sheetId)`;

  const metaRes = await fetch(metaUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10000),
  });

  if (!metaRes.ok) {
    const errText = await metaRes.text().catch(() => '');
    const creds = parseServiceAccountFromEnv();
    if (metaRes.status === 403 || metaRes.status === 404) {
      lastRuntimeStatus = 'PERMISSION_NEEDED';
      lastRuntimeError = creds?.clientEmail
        ? `Spreadsheet belum dibagikan (Share -> Editor) ke email Service Account: ${creds.clientEmail}`
        : `Akses Spreadsheet ditolak (HTTP ${metaRes.status}).`;
      throw new Error(lastRuntimeError);
    }
    lastRuntimeStatus = 'ERROR';
    lastRuntimeError = `Google Sheets API HTTP ${metaRes.status}: ${errText.slice(0, 160)}`;
    throw new Error(lastRuntimeError);
  }

  const meta = (await metaRes.json()) as SpreadsheetMetadataResponse;
  const spreadsheetTitle = String(meta.properties?.title || '').trim();
  const actualTitles = (meta.sheets || [])
    .map((s) => String(s.properties?.title || '').trim())
    .filter(Boolean);

  const lowerToActual = new Map<string, string>();
  for (const t of actualTitles) {
    lowerToActual.set(t.toLowerCase(), t);
  }

  const resolvedMap = new Map<CanonicalServerSheetKey, string>();
  const missingTabs: CanonicalServerSheetKey[] = [];

  for (const key of CANONICAL_TAB_ORDER) {
    const exactOrCaseMatch = lowerToActual.get(key.toLowerCase());
    if (exactOrCaseMatch) {
      resolvedMap.set(key, exactOrCaseMatch);
    } else {
      missingTabs.push(key);
      resolvedMap.set(key, key);
    }
  }

  if (missingTabs.length > 0) {
    const batchAddRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requests: missingTabs.map((tabTitle) => ({
            addSheet: { properties: { title: tabTitle } },
          })),
        }),
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!batchAddRes.ok) {
      const errText = await batchAddRes.text().catch(() => '');
      const creds = parseServiceAccountFromEnv();
      if (batchAddRes.status === 403) {
        lastRuntimeStatus = 'PERMISSION_NEEDED';
        lastRuntimeError = creds?.clientEmail
          ? `Service Account hanya memiliki akses Lihat (Viewer). Ubah izin Share Spreadsheet menjadi Editor untuk: ${creds.clientEmail}`
          : 'Service Account membutuhkan akses Editor pada Spreadsheet.';
        throw new Error(lastRuntimeError);
      }
      throw new Error(
        `Gagal membuat tab baru di Spreadsheet (HTTP ${batchAddRes.status}): ${errText.slice(0, 140)}`
      );
    }

    // Populate headers on newly created tabs immediately
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
        spreadsheetId
      )}/values:batchUpdate`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          valueInputOption: 'RAW',
          data: missingTabs.map((tabKey) => ({
            range: `'${tabKey.replace(/'/g, "''")}'!A1`,
            values: [SERVER_SHEET_HEADERS[tabKey]],
          })),
        }),
        signal: AbortSignal.timeout(10000),
      }
    );
  }

  return { title: spreadsheetTitle, existingTitles: resolvedMap };
}

export async function pullAllTabsViaServiceAccount(
  spreadsheetId: string
): Promise<{
  title: string;
  Master_Driver: string[][];
  Master_Armada: string[][];
  Master_Rute: string[][];
  Master_Fleet_Card: string[][];
  Pengeluaran_Driver: string[][];
  Surat_Tugas: string[][];
  Konfigurasi: string[][];
}> {
  const accessToken = await getServiceAccountAccessToken();
  const { title, existingTitles } = await ensureCanonicalTabsExist(
    accessToken,
    spreadsheetId
  );

  const queryParams = new URLSearchParams();
  queryParams.set('valueRenderOption', 'FORMATTED_VALUE');
  for (const key of CANONICAL_TAB_ORDER) {
    const tabName = existingTitles.get(key) || key;
    queryParams.append('ranges', `'${tabName.replace(/'/g, "''")}'!A1:AZ5000`);
  }

  const batchUrl = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values:batchGet?${queryParams.toString()}`;

  const res = await fetch(batchUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(12000),
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    lastRuntimeStatus = res.status === 403 ? 'PERMISSION_NEEDED' : 'ERROR';
    lastRuntimeError = `Gagal membaca Spreadsheet via Service Account (HTTP ${res.status}): ${txt.slice(0, 160)}`;
    throw new Error(lastRuntimeError);
  }

  const json = (await res.json()) as {
    valueRanges?: Array<{ values?: unknown[][] }>;
  };
  const ranges = json.valueRanges || [];
  const toMatrix = (idx: number, fallbackHeader: string[]): string[][] => {
    const rawVals = ranges[idx]?.values;
    if (!Array.isArray(rawVals) || rawVals.length === 0) {
      return [fallbackHeader];
    }
    return rawVals.map((row) =>
      Array.isArray(row) ? row.map((cell) => String(cell ?? '')) : []
    );
  };

  lastRuntimeStatus = 'ACTIVE';
  lastRuntimeError = '';
  lastVerifiedAtIso = new Date().toISOString();

  return {
    title,
    Master_Driver: toMatrix(0, SERVER_SHEET_HEADERS.Master_Driver),
    Master_Armada: toMatrix(1, SERVER_SHEET_HEADERS.Master_Armada),
    Master_Rute: toMatrix(2, SERVER_SHEET_HEADERS.Master_Rute),
    Master_Fleet_Card: toMatrix(3, SERVER_SHEET_HEADERS.Master_Fleet_Card),
    Pengeluaran_Driver: toMatrix(4, SERVER_SHEET_HEADERS.Pengeluaran_Driver),
    Surat_Tugas: toMatrix(5, SERVER_SHEET_HEADERS.Surat_Tugas),
    Konfigurasi: toMatrix(6, SERVER_SHEET_HEADERS.Konfigurasi),
  };
}

export async function pushAllTabsViaServiceAccount(
  spreadsheetId: string,
  payload: {
    driversRows: Array<Array<string | number>>;
    vehiclesRows: Array<Array<string | number>>;
    routesRows: Array<Array<string | number>>;
    fleetCardsRows: Array<Array<string | number>>;
    driverExpensesRows: Array<Array<string | number>>;
    assignmentsRows: Array<Array<string | number>>;
    configRows: Array<Array<string | number>>;
  }
): Promise<boolean> {
  const accessToken = await getServiceAccountAccessToken();
  const { existingTitles } = await ensureCanonicalTabsExist(
    accessToken,
    spreadsheetId
  );

  const tabDataByKey: Record<
    CanonicalServerSheetKey,
    Array<Array<string | number>>
  > = {
    Master_Driver: [SERVER_SHEET_HEADERS.Master_Driver, ...payload.driversRows],
    Master_Armada: [SERVER_SHEET_HEADERS.Master_Armada, ...payload.vehiclesRows],
    Master_Rute: [SERVER_SHEET_HEADERS.Master_Rute, ...payload.routesRows],
    Master_Fleet_Card: [
      SERVER_SHEET_HEADERS.Master_Fleet_Card,
      ...payload.fleetCardsRows,
    ],
    Pengeluaran_Driver: [
      SERVER_SHEET_HEADERS.Pengeluaran_Driver,
      ...payload.driverExpensesRows,
    ],
    Surat_Tugas: [SERVER_SHEET_HEADERS.Surat_Tugas, ...payload.assignmentsRows],
    Konfigurasi: [SERVER_SHEET_HEADERS.Konfigurasi, ...payload.configRows],
  };

  const clearRanges = CANONICAL_TAB_ORDER.map((key) => {
    const tabName = existingTitles.get(key) || key;
    return `'${tabName.replace(/'/g, "''")}'!A1:AZ5000`;
  });

  const clearRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchClear`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ranges: clearRanges }),
      signal: AbortSignal.timeout(12000),
    }
  );

  if (!clearRes.ok) {
    const errText = await clearRes.text().catch(() => '');
    const creds = parseServiceAccountFromEnv();
    if (clearRes.status === 403) {
      lastRuntimeStatus = 'PERMISSION_NEEDED';
      lastRuntimeError = creds?.clientEmail
        ? `Izin tulis ditolak. Pastikan email Service Account (${creds.clientEmail}) diberi akses Editor di tombol Bagikan (Share) Google Spreadsheet.`
        : 'Service Account membutuhkan izin Editor di Google Spreadsheet.';
      throw new Error(lastRuntimeError);
    }
    lastRuntimeStatus = 'ERROR';
    lastRuntimeError = `Gagal membersihkan range Spreadsheet (HTTP ${clearRes.status}): ${errText.slice(0, 150)}`;
    throw new Error(lastRuntimeError);
  }

  const updateData = CANONICAL_TAB_ORDER.map((key) => {
    const tabName = existingTitles.get(key) || key;
    return {
      range: `'${tabName.replace(/'/g, "''")}'!A1`,
      values: tabDataByKey[key],
    };
  });

  const writeRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
      spreadsheetId
    )}/values:batchUpdate`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        valueInputOption: 'RAW',
        data: updateData,
      }),
      signal: AbortSignal.timeout(15000),
    }
  );

  if (!writeRes.ok) {
    const errText = await writeRes.text().catch(() => '');
    lastRuntimeStatus = writeRes.status === 403 ? 'PERMISSION_NEEDED' : 'ERROR';
    lastRuntimeError = `Gagal menulis ke Spreadsheet via Service Account (HTTP ${writeRes.status}): ${errText.slice(0, 160)}`;
    throw new Error(lastRuntimeError);
  }

  lastRuntimeStatus = 'ACTIVE';
  lastRuntimeError = '';
  lastVerifiedAtIso = new Date().toISOString();
  return true;
}

function sanitizeDriveFolderName(raw?: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

async function findOrCreateDriveSubfolder(
  accessToken: string,
  parentId: string,
  folderName: string
): Promise<{ id: string; webViewLink: string } | null> {
  const cleanName = sanitizeDriveFolderName(folderName);
  if (!parentId || !cleanName) return null;

  const escapedName = cleanName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const q = `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and trashed = false`;
  const searchUrl = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(
    q
  )}&fields=files(id,name,webViewLink)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true`;

  const searchRes = await fetch(searchUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(8000),
  });
  if (searchRes.ok) {
    const data = (await searchRes.json()) as {
      files?: Array<{ id: string; webViewLink?: string }>;
    };
    const found = data.files?.[0];
    if (found?.id) {
      return {
        id: found.id,
        webViewLink:
          found.webViewLink ||
          `https://drive.google.com/drive/folders/${found.id}`,
      };
    }
  }

  const createRes = await fetch(
    'https://www.googleapis.com/drive/v3/files?fields=id,webViewLink&supportsAllDrives=true',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: cleanName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
      signal: AbortSignal.timeout(8000),
    }
  );

  if (!createRes.ok) {
    return null;
  }
  const created = (await createRes.json()) as {
    id?: string;
    webViewLink?: string;
  };
  if (!created.id) return null;
  return {
    id: created.id,
    webViewLink:
      created.webViewLink ||
      `https://drive.google.com/drive/folders/${created.id}`,
  };
}

export async function uploadDataUriToDriveViaServiceAccount(params: {
  rootFolderId: string;
  subfolderChain: string[];
  fileBaseName: string;
  dataUri: string;
}): Promise<{ fileUrl: string; folderId: string; folderUrl: string } | null> {
  const { rootFolderId, subfolderChain, fileBaseName, dataUri } = params;
  if (!rootFolderId || !dataUri.startsWith('data:image/')) return null;

  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const ext = mimeType.includes('png') ? 'png' : 'jpg';
  const binaryBuffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');

  try {
    const accessToken = await getServiceAccountAccessToken();
    let currentFolderId = rootFolderId;
    let currentFolderUrl = `https://drive.google.com/drive/folders/${rootFolderId}`;

    for (const seg of subfolderChain) {
      const sub = await findOrCreateDriveSubfolder(
        accessToken,
        currentFolderId,
        seg
      );
      if (!sub) return null;
      currentFolderId = sub.id;
      currentFolderUrl = sub.webViewLink;
    }

    const fileName = `${sanitizeDriveFolderName(fileBaseName)}.${ext}`;
    const boundary = `crk_sa_${Date.now()}_${Math.random()
      .toString(36)
      .slice(2, 8)}`;
    const metadataPart = Buffer.from(
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
        {
          name: fileName,
          parents: [currentFolderId],
        }
      )}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`,
      'utf8'
    );
    const closingPart = Buffer.from(`\r\n--${boundary}--`, 'utf8');
    const multipartBody = Buffer.concat([
      metadataPart,
      binaryBuffer,
      closingPart,
    ]);

    const upRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink&supportsAllDrives=true',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
        signal: AbortSignal.timeout(15000),
      }
    );

    if (!upRes.ok) {
      // Consumer @gmail.com Service Account 0GB quota or unshared Drive folder -> fail gracefully without breaking Sheet sync
      return null;
    }

    const uploaded = (await upRes.json()) as {
      id?: string;
      webViewLink?: string;
    };
    if (!uploaded.id) return null;

    // Best-effort public link permission so links in Spreadsheet open smoothly
    await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        uploaded.id
      )}/permissions?supportsAllDrives=true`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
        signal: AbortSignal.timeout(5000),
      }
    ).catch(() => undefined);

    return {
      fileUrl:
        uploaded.webViewLink ||
        `https://drive.google.com/file/d/${uploaded.id}/view`,
      folderId: currentFolderId,
      folderUrl: currentFolderUrl,
    };
  } catch {
    return null;
  }
}

export async function fetchFileMediaFromDriveViaServiceAccount(
  fileId: string
): Promise<{ data: Buffer; mimeType: string } | null> {
  if (!fileId || !isGoogleServiceAccountConfigured()) return null;
  try {
    const accessToken = await getServiceAccountAccessToken();
    const res = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(
        fileId
      )}?alt=media&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal: AbortSignal.timeout(15000),
      }
    );
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const mimeType = res.headers.get('content-type') || 'image/jpeg';
    return { data: Buffer.from(arrayBuffer), mimeType };
  } catch {
    return null;
  }
}
