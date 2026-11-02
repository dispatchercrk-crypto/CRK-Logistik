import { Assignment, DriveMediaLinks, DriverExpense } from '../types';

function sanitizeDriveSegment(raw?: string): string {
  return String(raw || '')
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildAssignmentDriveSubfolderName(
  asg: Pick<
    Assignment,
    'id' | 'noPenugasan' | 'tanggalTugas' | 'plateNumber' | 'driverName' | 'driverId'
  >
): string {
  const datePart = sanitizeDriveSegment(asg.tanggalTugas || 'TANPA-TGL');
  const noPart = sanitizeDriveSegment(asg.noPenugasan || asg.id);
  const platePart = sanitizeDriveSegment(asg.plateNumber || 'UNIT');
  const driverPart = sanitizeDriveSegment(
    asg.driverName || asg.driverId || 'DRIVER'
  );
  return `${datePart} _ ${noPart} _ ${platePart} _ ${driverPart}`;
}

const DRIVE_FILES_API = 'https://www.googleapis.com/drive/v3/files';
const DRIVE_UPLOAD_API =
  'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink';
const ROOT_DRIVE_FOLDER_NAME = 'CRK LOGISTIK - Foto Pengiriman';

export interface AssignmentPhotoCountSummary {
  totalUploaded: number;
  syncedToDrive: number;
  pendingDriveUpload: number;
  departurePhotos: number;
  handoverPhotos: number;
}

export interface FleetPhotoDriveStats {
  totalPhotos: number;
  syncedPhotos: number;
  pendingPhotos: number;
  assignmentsWithPhotos: number;
  assignmentsPendingSync: number;
}

export interface AssignmentDriveSyncResult {
  assignmentId: string;
  folderId: string;
  folderUrl: string;
  syncedAt: string;
  uploadedCount: number;
  mediaUrls: Omit<DriveMediaLinks, 'folderId' | 'folderUrl' | 'syncedAt'>;
}

export interface SyncAllDriveOutput {
  rootFolder: {
    id: string;
    webViewLink: string;
  };
  results: AssignmentDriveSyncResult[];
  totalUploadedFiles: number;
}

interface DriveHttpError extends Error {
  status?: number;
}

function createDriveError(message: string, status?: number): DriveHttpError {
  const err = new Error(message) as DriveHttpError;
  err.status = status;
  return err;
}

function isHttpUrl(val?: string): boolean {
  if (!val) return false;
  const trimmed = val.trim();
  return /^https?:\/\//i.test(trimmed);
}

function isDataUriImage(val?: string): boolean {
  if (!val) return false;
  return /^data:image\/[a-zA-Z0-9.+-]+;base64,/i.test(val.trim());
}

export function countAssignmentPhotos(
  asg: Assignment
): AssignmentPhotoCountSummary {
  const dep = asg.departureData;
  const ho = asg.handoverData;
  const dm = asg.driveMedia;

  const slots: Array<{ raw?: string; driveUrl?: string; stage: 'dep' | 'ho' }> =
    [
      {
        raw: dep?.fotoOdometerBerangkat,
        driveUrl: dm?.fotoOdometerBerangkatUrl,
        stage: 'dep',
      },
      {
        raw: dep?.fotoSuhuBerangkat,
        driveUrl: dm?.fotoSuhuBerangkatUrl,
        stage: 'dep',
      },
      {
        raw: ho?.fotoOdometerSerahTerima,
        driveUrl: dm?.fotoOdometerSerahTerimaUrl,
        stage: 'ho',
      },
      {
        raw: ho?.fotoSuhuSerahTerima,
        driveUrl: dm?.fotoSuhuSerahTerimaUrl,
        stage: 'ho',
      },
      {
        raw: ho?.fotoBuktiSerahTerima,
        driveUrl: dm?.fotoBuktiSerahTerimaUrl,
        stage: 'ho',
      },
      {
        raw: ho?.tandaTanganPenerima,
        driveUrl: dm?.tandaTanganPenerimaUrl,
        stage: 'ho',
      },
    ];

  let departurePhotos = 0;
  let handoverPhotos = 0;
  let syncedToDrive = 0;
  let pendingDriveUpload = 0;

  for (const s of slots) {
    const hasPhoto = Boolean(
      (s.raw && s.raw.trim()) || (s.driveUrl && s.driveUrl.trim())
    );
    if (!hasPhoto) continue;
    if (s.stage === 'dep') {
      departurePhotos += 1;
    } else {
      handoverPhotos += 1;
    }

    const synced =
      isHttpUrl(s.driveUrl) || (isHttpUrl(s.raw) && s.raw!.includes('drive.google.com'));
    if (synced) {
      syncedToDrive += 1;
    } else if (isDataUriImage(s.raw)) {
      pendingDriveUpload += 1;
    }
  }

  return {
    totalUploaded: departurePhotos + handoverPhotos,
    syncedToDrive,
    pendingDriveUpload,
    departurePhotos,
    handoverPhotos,
  };
}

export function summarizeFleetPhotoDriveStats(
  assignments: Assignment[]
): FleetPhotoDriveStats {
  let totalPhotos = 0;
  let syncedPhotos = 0;
  let pendingPhotos = 0;
  let assignmentsWithPhotos = 0;
  let assignmentsPendingSync = 0;

  for (const asg of assignments) {
    const c = countAssignmentPhotos(asg);
    totalPhotos += c.totalUploaded;
    syncedPhotos += c.syncedToDrive;
    pendingPhotos += c.pendingDriveUpload;
    if (c.totalUploaded > 0) {
      assignmentsWithPhotos += 1;
    }
    if (c.pendingDriveUpload > 0) {
      assignmentsPendingSync += 1;
    }
  }

  return {
    totalPhotos,
    syncedPhotos,
    pendingPhotos,
    assignmentsWithPhotos,
    assignmentsPendingSync,
  };
}

function escapeDriveQueryString(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function findOrCreateDriveFolder(
  accessToken: string,
  folderName: string,
  parentId?: string
): Promise<{ id: string; webViewLink: string }> {
  const clauses = [
    `mimeType = 'application/vnd.google-apps.folder'`,
    `name = '${escapeDriveQueryString(folderName)}'`,
    `trashed = false`,
  ];
  if (parentId) {
    clauses.push(`'${escapeDriveQueryString(parentId)}' in parents`);
  }
  const q = encodeURIComponent(clauses.join(' and '));
  const searchRes = await fetch(
    `${DRIVE_FILES_API}?q=${q}&fields=files(id,name,webViewLink)&pageSize=1`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );

  if (!searchRes.ok) {
    throw createDriveError(
      `Gagal mengakses Google Drive (${searchRes.status}).`,
      searchRes.status
    );
  }

  const searchJson = (await searchRes.json()) as {
    files?: Array<{ id: string; webViewLink?: string }>;
  };
  const existing = searchJson.files?.[0];
  if (existing?.id) {
    return {
      id: existing.id,
      webViewLink:
        existing.webViewLink ||
        `https://drive.google.com/drive/folders/${existing.id}`,
    };
  }

  const createRes = await fetch(
    `${DRIVE_FILES_API}?fields=id,name,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      }),
    }
  );

  if (!createRes.ok) {
    throw createDriveError(
      `Gagal membuat folder Google Drive (${createRes.status}).`,
      createRes.status
    );
  }

  const created = (await createRes.json()) as {
    id: string;
    webViewLink?: string;
  };
  return {
    id: created.id,
    webViewLink:
      created.webViewLink ||
      `https://drive.google.com/drive/folders/${created.id}`,
  };
}

async function verifyFolderById(
  accessToken: string,
  folderId: string
): Promise<{ id: string; webViewLink: string } | null> {
  if (!folderId.trim()) return null;
  const res = await fetch(
    `${DRIVE_FILES_API}/${encodeURIComponent(
      folderId.trim()
    )}?fields=id,trashed,webViewLink`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    }
  );
  if (res.status === 401 || res.status === 403) {
    throw createDriveError(
      `Sesi Google Drive memerlukan otorisasi ulang (${res.status}).`,
      res.status
    );
  }
  if (!res.ok) return null;
  const data = (await res.json()) as {
    id?: string;
    trashed?: boolean;
    webViewLink?: string;
  };
  if (!data.id || data.trashed) return null;
  return {
    id: data.id,
    webViewLink:
      data.webViewLink || `https://drive.google.com/drive/folders/${data.id}`,
  };
}

function parseDataUriToParts(dataUri: string): {
  mimeType: string;
  base64Data: string;
  ext: 'jpg' | 'png';
} | null {
  const match = dataUri
    .trim()
    .match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!match) return null;
  const mimeType = match[1].toLowerCase();
  const ext: 'jpg' | 'png' = mimeType.includes('png') ? 'png' : 'jpg';
  return {
    mimeType,
    base64Data: match[2].replace(/\s+/g, ''),
    ext,
  };
}

async function uploadDataUriToDriveFolder(
  accessToken: string,
  parentFolderId: string,
  baseFileName: string,
  dataUri: string
): Promise<string> {
  const parsed = parseDataUriToParts(dataUri);
  if (!parsed) return '';

  const fullFileName = `${baseFileName}.${parsed.ext}`;
  const boundary = `crk_drive_boundary_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;

  const metadataPart = JSON.stringify({
    name: fullFileName,
    parents: [parentFolderId],
  });

  const multipartBody =
    `--${boundary}\r\n` +
    `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
    `${metadataPart}\r\n` +
    `--${boundary}\r\n` +
    `Content-Type: ${parsed.mimeType}\r\n` +
    `Content-Transfer-Encoding: base64\r\n\r\n` +
    `${parsed.base64Data}\r\n` +
    `--${boundary}--`;

  const uploadRes = await fetch(DRIVE_UPLOAD_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: multipartBody,
  });

  if (!uploadRes.ok) {
    throw createDriveError(
      `Gagal mengunggah foto ${fullFileName} ke Google Drive (${uploadRes.status}).`,
      uploadRes.status
    );
  }

  const uploaded = (await uploadRes.json()) as {
    id: string;
    webViewLink?: string;
  };

  // Best-effort link sharing so Dispatcher/Spreadsheet viewers can open the photo URL directly
  try {
    await fetch(
      `${DRIVE_FILES_API}/${encodeURIComponent(uploaded.id)}/permissions`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'reader', type: 'anyone' }),
      }
    );
  } catch {
    // Non-fatal if Workspace policy restricts public link sharing
  }

  return (
    uploaded.webViewLink ||
    `https://drive.google.com/file/d/${uploaded.id}/view`
  );
}

export async function syncAllAssignmentsPhotosToDrive(
  accessToken: string,
  assignments: Assignment[],
  options?: {
    cachedRootFolderId?: string;
    overwriteExisting?: boolean;
  }
): Promise<SyncAllDriveOutput> {
  if (!accessToken.trim()) {
    throw createDriveError('Token akses Google Drive belum tersedia.', 401);
  }

  let rootFolder = options?.cachedRootFolderId
    ? await verifyFolderById(accessToken, options.cachedRootFolderId)
    : null;
  if (!rootFolder) {
    rootFolder = await findOrCreateDriveFolder(
      accessToken,
      ROOT_DRIVE_FOLDER_NAME
    );
  }

  const monthFolderCache = new Map<
    string,
    { id: string; webViewLink: string }
  >();
  const results: AssignmentDriveSyncResult[] = [];
  let totalUploadedFiles = 0;

  for (const asg of assignments) {
    const dep = asg.departureData;
    const ho = asg.handoverData;
    const existingDm = asg.driveMedia || {};
    const overwrite = Boolean(options?.overwriteExisting);

    const slotDefs: Array<{
      key: keyof Omit<DriveMediaLinks, 'folderId' | 'folderUrl' | 'syncedAt'>;
      filePrefix: string;
      raw?: string;
      existingUrl?: string;
    }> = [
      {
        key: 'fotoOdometerBerangkatUrl',
        filePrefix: `${asg.noPenugasan || asg.id}_01_Odometer_Keberangkatan`,
        raw: dep?.fotoOdometerBerangkat,
        existingUrl: existingDm.fotoOdometerBerangkatUrl,
      },
      {
        key: 'fotoSuhuBerangkatUrl',
        filePrefix: `${asg.noPenugasan || asg.id}_02_Suhu_Keberangkatan`,
        raw: dep?.fotoSuhuBerangkat,
        existingUrl: existingDm.fotoSuhuBerangkatUrl,
      },
      {
        key: 'fotoOdometerSerahTerimaUrl',
        filePrefix: `${asg.noPenugasan || asg.id}_03_Odometer_SerahTerima`,
        raw: ho?.fotoOdometerSerahTerima,
        existingUrl: existingDm.fotoOdometerSerahTerimaUrl,
      },
      {
        key: 'fotoSuhuSerahTerimaUrl',
        filePrefix: `${asg.noPenugasan || asg.id}_04_Suhu_SerahTerima`,
        raw: ho?.fotoSuhuSerahTerima,
        existingUrl: existingDm.fotoSuhuSerahTerimaUrl,
      },
      {
        key: 'fotoBuktiSerahTerimaUrl',
        filePrefix: `${asg.noPenugasan || asg.id}_05_Bukti_SerahTerima`,
        raw: ho?.fotoBuktiSerahTerima,
        existingUrl: existingDm.fotoBuktiSerahTerimaUrl,
      },
      {
        key: 'tandaTanganPenerimaUrl',
        filePrefix: `${asg.noPenugasan || asg.id}_06_TandaTangan_Penerima`,
        raw: ho?.tandaTanganPenerima,
        existingUrl: existingDm.tandaTanganPenerimaUrl,
      },
    ];

    const toUpload = slotDefs.filter(
      (s) => isDataUriImage(s.raw) && (overwrite || !isHttpUrl(s.existingUrl))
    );

    if (toUpload.length === 0) continue;

    const monthSegment = /^\d{4}-\d{2}/.test(asg.tanggalTugas || '')
      ? asg.tanggalTugas.slice(0, 7)
      : new Date().toISOString().slice(0, 7);

    let monthFolder = monthFolderCache.get(monthSegment);
    if (!monthFolder) {
      monthFolder = await findOrCreateDriveFolder(
        accessToken,
        monthSegment,
        rootFolder.id
      );
      monthFolderCache.set(monthSegment, monthFolder);
    }

    const asgSubfolderName = buildAssignmentDriveSubfolderName(asg);
    const asgFolder = await findOrCreateDriveFolder(
      accessToken,
      asgSubfolderName,
      monthFolder.id
    );

    const mediaUrls: Omit<
      DriveMediaLinks,
      'folderId' | 'folderUrl' | 'syncedAt'
    > = {
      fotoOdometerBerangkatUrl: existingDm.fotoOdometerBerangkatUrl,
      fotoSuhuBerangkatUrl: existingDm.fotoSuhuBerangkatUrl,
      fotoOdometerSerahTerimaUrl: existingDm.fotoOdometerSerahTerimaUrl,
      fotoSuhuSerahTerimaUrl: existingDm.fotoSuhuSerahTerimaUrl,
      fotoBuktiSerahTerimaUrl: existingDm.fotoBuktiSerahTerimaUrl,
      tandaTanganPenerimaUrl: existingDm.tandaTanganPenerimaUrl,
    };

    let uploadedForAsg = 0;
    for (const slot of toUpload) {
      if (!slot.raw) continue;
      const fileUrl = await uploadDataUriToDriveFolder(
        accessToken,
        asgFolder.id,
        slot.filePrefix.replace(/[\\/:*?"<>|]+/g, '-'),
        slot.raw
      );
      if (fileUrl) {
        mediaUrls[slot.key] = fileUrl;
        uploadedForAsg += 1;
        totalUploadedFiles += 1;
      }
    }

    if (uploadedForAsg > 0) {
      results.push({
        assignmentId: asg.id,
        folderId: asgFolder.id,
        folderUrl: asgFolder.webViewLink,
        syncedAt: new Date().toISOString(),
        uploadedCount: uploadedForAsg,
        mediaUrls,
      });
    }
  }

  return {
    rootFolder,
    results,
    totalUploadedFiles,
  };
}

export interface DriverExpenseDriveSyncResult {
  expenseId: string;
  fotoStrukBbmUrl?: string;
  fotoStrukTolUrl?: string;
  syncedAt: string;
  uploadedCount: number;
}

export interface SyncExpenseDriveOutput {
  rootFolder: {
    id: string;
    webViewLink: string;
  };
  results: DriverExpenseDriveSyncResult[];
  totalUploadedFiles: number;
}

export async function syncDriverExpensesPhotosToDrive(
  accessToken: string,
  driverExpenses: DriverExpense[],
  options?: {
    cachedRootFolderId?: string;
    overwriteExisting?: boolean;
  }
): Promise<SyncExpenseDriveOutput> {
  if (!accessToken.trim()) {
    throw createDriveError('Token akses Google Drive belum tersedia.', 401);
  }

  let rootFolder = options?.cachedRootFolderId
    ? await verifyFolderById(accessToken, options.cachedRootFolderId)
    : null;
  if (!rootFolder) {
    rootFolder = await findOrCreateDriveFolder(
      accessToken,
      ROOT_DRIVE_FOLDER_NAME
    );
  }

  const overwrite = Boolean(options?.overwriteExisting);
  const results: DriverExpenseDriveSyncResult[] = [];
  let totalUploadedFiles = 0;

  let expenseRootFolder: { id: string; webViewLink: string } | null = null;
  const monthFolderCache = new Map<
    string,
    { id: string; webViewLink: string }
  >();

  for (const exp of driverExpenses) {
    const needBbm =
      isDataUriImage(exp.fotoStrukBbm) &&
      (overwrite || !isHttpUrl(exp.fotoStrukBbmUrl));
    const needTol =
      isDataUriImage(exp.fotoStrukTol) &&
      (overwrite || !isHttpUrl(exp.fotoStrukTolUrl));

    if (!needBbm && !needTol) continue;

    if (!expenseRootFolder) {
      expenseRootFolder = await findOrCreateDriveFolder(
        accessToken,
        'Pengeluaran_Driver',
        rootFolder.id
      );
    }

    const monthSegment = /^\d{4}-\d{2}/.test(exp.tanggal || '')
      ? exp.tanggal.slice(0, 7)
      : new Date().toISOString().slice(0, 7);

    let monthFolder = monthFolderCache.get(monthSegment);
    if (!monthFolder) {
      monthFolder = await findOrCreateDriveFolder(
        accessToken,
        monthSegment,
        expenseRootFolder.id
      );
      monthFolderCache.set(monthSegment, monthFolder);
    }

    const safeCard = sanitizeDriveSegment(exp.fleetCardNumber || exp.fleetCardId || 'KARTU');
    const safeDriver = sanitizeDriveSegment(exp.driverName || exp.driverId || 'DRIVER');
    const safeDate = sanitizeDriveSegment(exp.tanggal || 'TGL');

    let fotoStrukBbmUrl = exp.fotoStrukBbmUrl;
    let fotoStrukTolUrl = exp.fotoStrukTolUrl;
    let uploadedCount = 0;

    if (needBbm && exp.fotoStrukBbm) {
      const url = await uploadDataUriToDriveFolder(
        accessToken,
        monthFolder.id,
        `${safeDate}_${safeDriver}_${safeCard}_${exp.id}_Struk_BBM`.replace(
          /[\\/:*?"<>|]+/g,
          '-'
        ),
        exp.fotoStrukBbm
      );
      if (url) {
        fotoStrukBbmUrl = url;
        uploadedCount += 1;
        totalUploadedFiles += 1;
      }
    }

    if (needTol && exp.fotoStrukTol) {
      const url = await uploadDataUriToDriveFolder(
        accessToken,
        monthFolder.id,
        `${safeDate}_${safeDriver}_${safeCard}_${exp.id}_Struk_Tol`.replace(
          /[\\/:*?"<>|]+/g,
          '-'
        ),
        exp.fotoStrukTol
      );
      if (url) {
        fotoStrukTolUrl = url;
        uploadedCount += 1;
        totalUploadedFiles += 1;
      }
    }

    if (uploadedCount > 0) {
      results.push({
        expenseId: exp.id,
        fotoStrukBbmUrl,
        fotoStrukTolUrl,
        syncedAt: new Date().toISOString(),
        uploadedCount,
      });
    }
  }

  return {
    rootFolder,
    results,
    totalUploadedFiles,
  };
}
