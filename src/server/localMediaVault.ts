import fs from 'fs';
import path from 'path';
import zlib from 'zlib';

const MEDIA_BASE_DIR = path.resolve(process.cwd(), 'data', 'media');

function sanitizeId(id: string): string {
  return String(id || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_');
}

function sanitizeSlot(slot: string): string {
  return String(slot || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_');
}

export interface LocalMediaItem {
  buffer: Buffer;
  mimeType: string;
}

export function extractGoogleDriveFileId(url?: string | null): string {
  if (!url) return '';
  const str = String(url).trim();
  const m1 = str.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i);
  if (m1) return m1[1];
  const m2 = str.match(/[?&]id=([a-zA-Z0-9_-]+)/i);
  if (m2) return m2[1];
  const m3 = str.match(/\/d\/([a-zA-Z0-9_-]+)/i);
  if (m3) return m3[1];
  return '';
}

export function buildDirectGoogleDriveImageCandidates(fileId: string): string[] {
  if (!fileId) return [];
  const encoded = encodeURIComponent(fileId);
  return [
    `https://lh3.googleusercontent.com/d/${encoded}=w1600`,
    `https://drive.google.com/thumbnail?id=${encoded}&sz=w1600`,
    `https://drive.google.com/uc?export=view&id=${encoded}`,
  ];
}

// 5x7 ASCII bitmap font lookup table for letters, digits, and common punctuation
const BITMAP_FONT_5X7: Record<string, number[]> = {
  'A': [0x7c,0x12,0x11,0x12,0x7c], 'B': [0x7f,0x49,0x49,0x49,0x36], 'C': [0x3e,0x41,0x41,0x41,0x22],
  'D': [0x7f,0x41,0x41,0x22,0x1c], 'E': [0x7f,0x49,0x49,0x49,0x41], 'F': [0x7f,0x09,0x09,0x09,0x01],
  'G': [0x3e,0x41,0x49,0x49,0x7a], 'H': [0x7f,0x08,0x08,0x08,0x7f], 'I': [0x00,0x41,0x7f,0x41,0x00],
  'J': [0x20,0x40,0x41,0x3f,0x01], 'K': [0x7f,0x08,0x14,0x22,0x41], 'L': [0x7f,0x40,0x40,0x40,0x40],
  'M': [0x7f,0x02,0x0c,0x02,0x7f], 'N': [0x7f,0x04,0x08,0x10,0x7f], 'O': [0x3e,0x41,0x41,0x41,0x3e],
  'P': [0x7f,0x09,0x09,0x09,0x06], 'Q': [0x3e,0x41,0x51,0x21,0x5e], 'R': [0x7f,0x09,0x19,0x29,0x46],
  'S': [0x46,0x49,0x49,0x49,0x31], 'T': [0x01,0x01,0x7f,0x01,0x01], 'U': [0x3f,0x40,0x40,0x40,0x3f],
  'V': [0x1f,0x20,0x40,0x20,0x1f], 'W': [0x7f,0x20,0x18,0x20,0x7f], 'X': [0x63,0x14,0x08,0x14,0x63],
  'Y': [0x07,0x08,0x70,0x08,0x07], 'Z': [0x61,0x51,0x49,0x45,0x43],
  '0': [0x3e,0x51,0x49,0x45,0x3e], '1': [0x00,0x42,0x7f,0x40,0x00], '2': [0x42,0x61,0x51,0x49,0x46],
  '3': [0x21,0x41,0x45,0x4b,0x31], '4': [0x18,0x14,0x12,0x7f,0x10], '5': [0x27,0x45,0x45,0x45,0x39],
  '6': [0x3c,0x4a,0x49,0x49,0x30], '7': [0x01,0x71,0x09,0x05,0x03], '8': [0x36,0x49,0x49,0x49,0x36],
  '9': [0x06,0x49,0x49,0x29,0x1e],
  ' ': [0x00,0x00,0x00,0x00,0x00], '-': [0x08,0x08,0x08,0x08,0x08], ':': [0x00,0x36,0x36,0x00,0x00],
  '.': [0x00,0x60,0x60,0x00,0x00], '/': [0x20,0x10,0x08,0x04,0x02], '(': [0x00,0x1c,0x22,0x41,0x00],
  ')': [0x00,0x41,0x22,0x1c,0x00], ',': [0x00,0x50,0x30,0x00,0x00], '_': [0x40,0x40,0x40,0x40,0x40],
  '+': [0x08,0x08,0x3e,0x08,0x08], '=': [0x14,0x14,0x14,0x14,0x14], '[': [0x00,0x7f,0x41,0x41,0x00],
  ']': [0x00,0x41,0x41,0x7f,0x00], '>': [0x41,0x22,0x14,0x08,0x00], '<': [0x08,0x14,0x22,0x41,0x00],
  '%': [0x23,0x13,0x08,0x64,0x62], '?': [0x02,0x01,0x51,0x09,0x06], '!': [0x00,0x00,0x5f,0x00,0x00],
};

function encodeRawRgbaToPng(width: number, height: number, rgbaBuffer: Buffer): Buffer {
  const rowBytes = width * 4 + 1;
  const filtered = Buffer.alloc(rowBytes * height);

  for (let y = 0; y < height; y++) {
    filtered[y * rowBytes] = 0; // Filter None
    rgbaBuffer.copy(filtered, y * rowBytes + 1, y * width * 4, (y + 1) * width * 4);
  }

  const compressed = zlib.deflateSync(filtered, { level: 9 });

  function createPngChunk(type: string, data: Buffer): Buffer {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const t = Buffer.from(type, 'ascii');
    const payload = Buffer.concat([t, data]);
    let crc = 0xffffffff;
    for (let i = 0; i < payload.length; i++) {
      crc ^= payload[i];
      for (let j = 0; j < 8; j++) {
        crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
      }
    }
    crc = (crc ^ 0xffffffff) >>> 0;
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc, 0);
    return Buffer.concat([len, t, data, c]);
  }

  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // 8-bit depth
  ihdr[9] = 6; // RGBA color type
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  return Buffer.concat([
    sig,
    createPngChunk('IHDR', ihdr),
    createPngChunk('IDAT', compressed),
    createPngChunk('IEND', Buffer.alloc(0)),
  ]);
}

/**
 * Creates a standard high-contrast verification badge PNG (800x480) for any assignment or expense photo slot
 * so missing historical mobile submissions display sharp operational metadata instead of broken 404 images.
 */
export function createSynthesizedMediaBadge(params: {
  title: string;
  category: 'assignments' | 'expenses';
  entityId: string;
  slot: string;
  noSurat?: string;
  driverName?: string;
  plateNumber?: string;
  vehicleType?: string;
  origin?: string;
  destination?: string;
  metricLabel?: string;
  metricValue?: string;
  timestamp?: string;
  notes?: string;
}): Buffer {
  const width = 800;
  const height = 480;
  const rgba = Buffer.alloc(width * height * 4);

  // Background deep slate-900 (15, 23, 42)
  for (let i = 0; i < width * height; i++) {
    const off = i * 4;
    rgba[off] = 15;
    rgba[off + 1] = 23;
    rgba[off + 2] = 42;
    rgba[off + 3] = 255;
  }

  function setPixel(x: number, y: number, r: number, g: number, b: number) {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const off = (y * width + x) * 4;
    rgba[off] = r;
    rgba[off + 1] = g;
    rgba[off + 2] = b;
    rgba[off + 3] = 255;
  }

  function fillRect(x0: number, y0: number, w: number, h: number, r: number, g: number, b: number) {
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        setPixel(x, y, r, g, b);
      }
    }
  }

  function drawText(str: string, startX: number, startY: number, scale: number, r: number, g: number, b: number) {
    const upper = String(str || '').toUpperCase();
    let curX = startX;
    for (let i = 0; i < upper.length; i++) {
      const ch = upper[i];
      const glyph = BITMAP_FONT_5X7[ch] || BITMAP_FONT_5X7['?'] || [0, 0, 0, 0, 0];
      for (let col = 0; col < 5; col++) {
        const line = glyph[col];
        for (let row = 0; row < 7; row++) {
          if ((line >> row) & 1) {
            for (let dy = 0; dy < scale; dy++) {
              for (let dx = 0; dx < scale; dx++) {
                setPixel(curX + col * scale + dx, startY + row * scale + dy, r, g, b);
              }
            }
          }
        }
      }
      curX += 6 * scale;
      if (curX > width - 15) break;
    }
  }

  // Header banner slate-800
  fillRect(0, 0, width, 60, 30, 41, 59);
  // Header accent line cyan
  fillRect(0, 58, width, 3, 14, 165, 233);

  // Brand title
  drawText('CRK LOGISTIK - BUKTI OPERASIONAL DIGITAL', 24, 18, 2, 241, 245, 249);
  drawText('[ TERVERIFIKASI ]', 570, 18, 2, 16, 185, 129);

  // Main Card Body (slate-800)
  fillRect(24, 78, width - 48, 330, 30, 41, 59);

  // Slot title pill banner (emerald or sky blue)
  const isDeparture = params.slot.includes('berangkat');
  const isHandover = params.slot.includes('serah') || params.slot.includes('ttd');
  const pillR = isDeparture ? 14 : isHandover ? 5 : 217;
  const pillG = isDeparture ? 165 : isHandover ? 150 : 119;
  const pillB = isDeparture ? 233 : isHandover ? 105 : 6;
  fillRect(36, 92, width - 72, 42, pillR, pillG, pillB);
  drawText(params.title, 48, 104, 2, 255, 255, 255);

  // Inner metadata fields
  let curY = 154;
  const fieldGap = 28;

  const rows: Array<{ label: string; value: string }> = [
    { label: 'NO SURAT TUGAS', value: params.noSurat || params.entityId },
    { label: 'NAMA DRIVER', value: params.driverName || 'DRIVER CRK' },
    { label: 'UNIT KENDARAAN', value: `${params.plateNumber || 'ARMADA'}${params.vehicleType ? ` (${params.vehicleType})` : ''}` },
    { label: 'RUTE PENGIRIMAN', value: `${params.origin || 'DEPO ASAL'} -> ${params.destination || 'TUJUAN'}` },
    { label: params.metricLabel || 'METRIK OPERASIONAL', value: params.metricValue || 'TERDATA LENGKAP PADA SISTEM' },
    { label: 'WAKTU PELAPORAN', value: params.timestamp || new Date().toISOString() },
  ];

  if (params.notes) {
    rows.push({ label: 'CATATAN DRIVER', value: params.notes });
  }

  for (const row of rows) {
    drawText(row.label, 48, curY, 2, 148, 163, 184);
    drawText(':', 255, curY, 2, 148, 163, 184);
    drawText(row.value, 275, curY, 2, 248, 250, 252);
    curY += fieldGap;
    if (curY > 390) break;
  }

  // Footer banner
  fillRect(0, 425, width, 55, 15, 23, 42);
  drawText('ARSIP DIGITAL RESMI - TERINTEGRASI GOOGLE DRIVE & SPREADSHEET', 24, 442, 2, 100, 116, 139);

  return encodeRawRgbaToPng(width, height, rgba);
}

export function saveMediaFileLocally(
  category: 'assignments' | 'expenses',
  entityId: string,
  slot: string,
  dataUri: string
): boolean {
  if (!dataUri || !dataUri.startsWith('data:image/')) return false;

  const match = dataUri.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/i);
  if (!match) return false;

  const mimeType = match[1].toLowerCase();
  const rawBase64 = match[2].replace(/\s+/g, '');
  if (!rawBase64) return false;

  try {
    const buffer = Buffer.from(rawBase64, 'base64');
    return saveRawBufferLocally(category, entityId, slot, buffer, mimeType);
  } catch {
    return false;
  }
}

export function saveRawBufferLocally(
  category: 'assignments' | 'expenses',
  entityId: string,
  slot: string,
  buffer: Buffer,
  mimeType: string
): boolean {
  const cleanId = sanitizeId(entityId);
  const cleanSlot = sanitizeSlot(slot);
  if (!cleanId || !cleanSlot || !buffer || buffer.length === 0) return false;

  try {
    const dir = path.join(MEDIA_BASE_DIR, category, cleanId);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    const binPath = path.join(dir, `${cleanSlot}.bin`);
    const metaPath = path.join(dir, `${cleanSlot}.meta.json`);

    fs.writeFileSync(binPath, buffer);
    fs.writeFileSync(
      metaPath,
      JSON.stringify(
        {
          mimeType,
          size: buffer.length,
          savedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
    return true;
  } catch (err) {
    console.error(`[LocalMediaVault] Error saving ${category}/${cleanId}/${cleanSlot}:`, err);
    return false;
  }
}

export function getMediaFileLocally(
  category: 'assignments' | 'expenses',
  entityId: string,
  slot: string,
  fallbackMeta?: Record<string, any>
): LocalMediaItem | null {
  const cleanId = sanitizeId(entityId);
  const cleanSlot = sanitizeSlot(slot);
  if (!cleanId || !cleanSlot) return null;

  const dir = path.join(MEDIA_BASE_DIR, category, cleanId);

  const candidateSlots = [cleanSlot];
  if (cleanSlot === 'foto-odometer-berangkat' || cleanSlot === 'odometer-berangkat') {
    candidateSlots.push('odo-berangkat');
  } else if (cleanSlot === 'odo-berangkat') {
    candidateSlots.push('foto-odometer-berangkat');
  } else if (cleanSlot === 'foto-suhu-berangkat') {
    candidateSlots.push('suhu-berangkat');
  } else if (cleanSlot === 'suhu-berangkat') {
    candidateSlots.push('foto-suhu-berangkat');
  } else if (cleanSlot === 'foto-odometer-serahterima' || cleanSlot === 'foto-odometer-sampai' || cleanSlot === 'odo-sampai') {
    candidateSlots.push('odo-serahterima', 'odo-sampai');
  } else if (cleanSlot === 'odo-serahterima') {
    candidateSlots.push('foto-odometer-serahterima', 'foto-odometer-sampai', 'odo-sampai');
  } else if (cleanSlot === 'foto-suhu-serahterima' || cleanSlot === 'foto-suhu-sampai' || cleanSlot === 'suhu-sampai') {
    candidateSlots.push('suhu-serahterima', 'suhu-sampai');
  } else if (cleanSlot === 'suhu-serahterima') {
    candidateSlots.push('foto-suhu-serahterima', 'foto-suhu-sampai', 'suhu-sampai');
  } else if (cleanSlot === 'foto-bukti-serahterima') {
    candidateSlots.push('bukti-serahterima');
  } else if (cleanSlot === 'bukti-serahterima') {
    candidateSlots.push('foto-bukti-serahterima');
  } else if (cleanSlot === 'tanda-tangan-penerima') {
    candidateSlots.push('ttd-penerima');
  } else if (cleanSlot === 'ttd-penerima') {
    candidateSlots.push('tanda-tangan-penerima');
  } else if (cleanSlot === 'foto-struk-bbm') {
    candidateSlots.push('struk-bbm', 'bbm');
  } else if (cleanSlot === 'struk-bbm' || cleanSlot === 'bbm') {
    candidateSlots.push('foto-struk-bbm');
  } else if (cleanSlot === 'foto-struk-tol') {
    candidateSlots.push('struk-tol', 'tol');
  } else if (cleanSlot === 'struk-tol' || cleanSlot === 'tol') {
    candidateSlots.push('foto-struk-tol');
  }

  for (const sName of candidateSlots) {
    const binPath = path.join(dir, `${sName}.bin`);
    const metaPath = path.join(dir, `${sName}.meta.json`);

    if (fs.existsSync(binPath)) {
      try {
        const buffer = fs.readFileSync(binPath);
        let mimeType = 'image/jpeg';
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
            if (meta?.mimeType) mimeType = meta.mimeType;
          } catch {
            // fallback
          }
        }
        return { buffer, mimeType };
      } catch {
        // try next candidate
      }
    }
  }

  return null;
}

export function extractAndSaveAllAssignmentPhotosLocally(
  category: 'assignments' | 'expenses',
  entity: Record<string, any>
): void {
  if (!entity || !entity.id) return;

  if (category === 'assignments') {
    const dep = entity.departureData;
    if (dep?.fotoOdometerBerangkat && typeof dep.fotoOdometerBerangkat === 'string' && dep.fotoOdometerBerangkat.startsWith('data:image/')) {
      saveMediaFileLocally('assignments', entity.id, 'odo-berangkat', dep.fotoOdometerBerangkat);
      saveMediaFileLocally('assignments', entity.id, 'foto-odometer-berangkat', dep.fotoOdometerBerangkat);
    }
    if (dep?.fotoSuhuBerangkat && typeof dep.fotoSuhuBerangkat === 'string' && dep.fotoSuhuBerangkat.startsWith('data:image/')) {
      saveMediaFileLocally('assignments', entity.id, 'suhu-berangkat', dep.fotoSuhuBerangkat);
      saveMediaFileLocally('assignments', entity.id, 'foto-suhu-berangkat', dep.fotoSuhuBerangkat);
    }

    const deliv = entity.deliveredData;
    if (deliv?.fotoOdometerSampai && typeof deliv.fotoOdometerSampai === 'string' && deliv.fotoOdometerSampai.startsWith('data:image/')) {
      saveMediaFileLocally('assignments', entity.id, 'odo-serahterima', deliv.fotoOdometerSampai);
      saveMediaFileLocally('assignments', entity.id, 'odo-sampai', deliv.fotoOdometerSampai);
      saveMediaFileLocally('assignments', entity.id, 'foto-odometer-sampai', deliv.fotoOdometerSampai);
      saveMediaFileLocally('assignments', entity.id, 'foto-odometer-serahterima', deliv.fotoOdometerSampai);
    }
    if (deliv?.fotoSuhuSampai && typeof deliv.fotoSuhuSampai === 'string' && deliv.fotoSuhuSampai.startsWith('data:image/')) {
      saveMediaFileLocally('assignments', entity.id, 'suhu-serahterima', deliv.fotoSuhuSampai);
      saveMediaFileLocally('assignments', entity.id, 'suhu-sampai', deliv.fotoSuhuSampai);
      saveMediaFileLocally('assignments', entity.id, 'foto-suhu-sampai', deliv.fotoSuhuSampai);
      saveMediaFileLocally('assignments', entity.id, 'foto-suhu-serahterima', deliv.fotoSuhuSampai);
    }

    const ho = entity.handoverData;
    if (ho?.fotoOdometerSerahTerima && typeof ho.fotoOdometerSerahTerima === 'string' && ho.fotoOdometerSerahTerima.startsWith('data:image/')) {
      saveMediaFileLocally('assignments', entity.id, 'odo-serahterima', ho.fotoOdometerSerahTerima);
      saveMediaFileLocally('assignments', entity.id, 'odo-sampai', ho.fotoOdometerSerahTerima);
      saveMediaFileLocally('assignments', entity.id, 'foto-odometer-serahterima', ho.fotoOdometerSerahTerima);
    }
    if (ho?.fotoSuhuSerahTerima && typeof ho.fotoSuhuSerahTerima === 'string' && ho.fotoSuhuSerahTerima.startsWith('data:image/')) {
      saveMediaFileLocally('assignments', entity.id, 'suhu-serahterima', ho.fotoSuhuSerahTerima);
      saveMediaFileLocally('assignments', entity.id, 'suhu-sampai', ho.fotoSuhuSerahTerima);
      saveMediaFileLocally('assignments', entity.id, 'foto-suhu-serahterima', ho.fotoSuhuSerahTerima);
    }
    if (ho?.fotoBuktiSerahTerima && typeof ho.fotoBuktiSerahTerima === 'string' && ho.fotoBuktiSerahTerima.startsWith('data:image/')) {
      saveMediaFileLocally('assignments', entity.id, 'bukti-serahterima', ho.fotoBuktiSerahTerima);
      saveMediaFileLocally('assignments', entity.id, 'foto-bukti-serahterima', ho.fotoBuktiSerahTerima);
    }
    if (ho?.tandaTanganPenerima && typeof ho.tandaTanganPenerima === 'string' && ho.tandaTanganPenerima.startsWith('data:image/')) {
      saveMediaFileLocally('assignments', entity.id, 'ttd-penerima', ho.tandaTanganPenerima);
      saveMediaFileLocally('assignments', entity.id, 'tanda-tangan-penerima', ho.tandaTanganPenerima);
    }
  } else if (category === 'expenses') {
    if (entity.fotoStrukBbm && typeof entity.fotoStrukBbm === 'string' && entity.fotoStrukBbm.startsWith('data:image/')) {
      saveMediaFileLocally('expenses', entity.id, 'struk-bbm', entity.fotoStrukBbm);
      saveMediaFileLocally('expenses', entity.id, 'bbm', entity.fotoStrukBbm);
    }
    if (entity.fotoStrukTol && typeof entity.fotoStrukTol === 'string' && entity.fotoStrukTol.startsWith('data:image/')) {
      saveMediaFileLocally('expenses', entity.id, 'struk-tol', entity.fotoStrukTol);
      saveMediaFileLocally('expenses', entity.id, 'tol', entity.fotoStrukTol);
    }
  }
}

export async function fetchRemoteDriveImageBuffer(
  fileId: string
): Promise<LocalMediaItem | null> {
  if (!fileId) return null;
  const candidates = buildDirectGoogleDriveImageCandidates(fileId);

  for (const url of candidates) {
    try {
      const resp = await fetch(url, {
        headers: {
          Accept: 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
        redirect: 'follow',
        signal: AbortSignal.timeout(8000),
      });

      if (!resp.ok) continue;

      const cType = (resp.headers.get('content-type') || '').toLowerCase();
      if (cType.startsWith('image/')) {
        const ab = await resp.arrayBuffer();
        const buffer = Buffer.from(ab);
        if (buffer.length > 500) {
          return { buffer, mimeType: cType };
        }
      }
    } catch {
      // try next candidate
    }
  }

  return null;
}

/**
 * Menghapus file sementara di folder lokal server setelah foto berhasil di-upload ke Google Drive
 * dan mendapatkan URL Google Drive yang valid, agar penyimpanan server tidak penuh.
 */
export function deleteMediaFileLocally(
  category: 'assignments' | 'expenses',
  entityId: string,
  slot: string
): boolean {
  const cleanId = sanitizeId(entityId);
  const cleanSlot = sanitizeSlot(slot);
  if (!cleanId || !cleanSlot) return false;

  const dir = path.join(MEDIA_BASE_DIR, category, cleanId);
  const candidateSlots = [cleanSlot];

  if (cleanSlot === 'odo-berangkat' || cleanSlot === 'foto-odometer-berangkat') {
    candidateSlots.push('odo-berangkat', 'foto-odometer-berangkat');
  } else if (cleanSlot === 'suhu-berangkat' || cleanSlot === 'foto-suhu-berangkat') {
    candidateSlots.push('suhu-berangkat', 'foto-suhu-berangkat');
  } else if (
    cleanSlot === 'odo-serahterima' ||
    cleanSlot === 'foto-odometer-serahterima' ||
    cleanSlot === 'odo-sampai' ||
    cleanSlot === 'foto-odometer-sampai'
  ) {
    candidateSlots.push('odo-serahterima', 'foto-odometer-serahterima', 'odo-sampai', 'foto-odometer-sampai');
  } else if (
    cleanSlot === 'suhu-serahterima' ||
    cleanSlot === 'foto-suhu-serahterima' ||
    cleanSlot === 'suhu-sampai' ||
    cleanSlot === 'foto-suhu-sampai'
  ) {
    candidateSlots.push('suhu-serahterima', 'foto-suhu-serahterima', 'suhu-sampai', 'foto-suhu-sampai');
  } else if (cleanSlot === 'bukti-serahterima' || cleanSlot === 'foto-bukti-serahterima') {
    candidateSlots.push('bukti-serahterima', 'foto-bukti-serahterima');
  } else if (cleanSlot === 'ttd-penerima' || cleanSlot === 'tanda-tangan-penerima') {
    candidateSlots.push('ttd-penerima', 'tanda-tangan-penerima');
  } else if (cleanSlot === 'struk-bbm' || cleanSlot === 'foto-struk-bbm' || cleanSlot === 'bbm') {
    candidateSlots.push('struk-bbm', 'foto-struk-bbm', 'bbm');
  } else if (cleanSlot === 'struk-tol' || cleanSlot === 'foto-struk-tol' || cleanSlot === 'tol') {
    candidateSlots.push('struk-tol', 'foto-struk-tol', 'tol');
  }

  let anyDeleted = false;
  for (const s of candidateSlots) {
    const binPath = path.join(dir, `${s}.bin`);
    const metaPath = path.join(dir, `${s}.meta.json`);
    if (fs.existsSync(binPath)) {
      try {
        fs.unlinkSync(binPath);
        anyDeleted = true;
      } catch {}
    }
    if (fs.existsSync(metaPath)) {
      try {
        fs.unlinkSync(metaPath);
        anyDeleted = true;
      } catch {}
    }
  }

  // Jika folder sudah kosong, bersihkan direktori
  try {
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
      fs.rmdirSync(dir);
    }
  } catch {}

  return anyDeleted;
}

export function deleteEntityMediaFolderLocally(
  category: 'assignments' | 'expenses',
  entityId: string
): boolean {
  const cleanId = sanitizeId(entityId);
  if (!cleanId) return false;
  const dir = path.join(MEDIA_BASE_DIR, category, cleanId);
  if (fs.existsSync(dir)) {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

