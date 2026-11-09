import fs from 'fs';
import path from 'path';

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
  slot: string
): LocalMediaItem | null {
  const cleanId = sanitizeId(entityId);
  const cleanSlot = sanitizeSlot(slot);
  if (!cleanId || !cleanSlot) return null;

  const dir = path.join(MEDIA_BASE_DIR, category, cleanId);
  const binPath = path.join(dir, `${cleanSlot}.bin`);
  const metaPath = path.join(dir, `${cleanSlot}.meta.json`);

  if (!fs.existsSync(binPath)) return null;

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
    return null;
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
