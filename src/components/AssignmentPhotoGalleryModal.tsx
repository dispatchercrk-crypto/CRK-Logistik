import React, { useEffect, useMemo, useState } from 'react';
import {
  Camera,
  ExternalLink,
  FolderOpen,
  ImageOff,
  Maximize2,
  Printer,
  X,
} from 'lucide-react';
import { Assignment } from '../types';
import { readCachedAssignmentMediaFromVault } from '../services/persistentVault';
import {
  buildAssignmentDriveSubfolderName,
  countAssignmentPhotos,
} from '../services/driveSync';
import { formatRealTimeTimestamp } from '../utils/media';

export type AssignmentMediaApiSlot =
  | 'odo-berangkat'
  | 'suhu-berangkat'
  | 'odo-serahterima'
  | 'suhu-serahterima'
  | 'bukti-serahterima'
  | 'ttd-penerima';

export function extractDriveFileIdFromUrl(rawUrl?: string): string | null {
  if (!rawUrl || typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || trimmed.startsWith('data:')) return null;

  const fileDMatch = trimmed.match(/\/file\/d\/([a-zA-Z0-9_-]{10,})/);
  if (fileDMatch?.[1]) return fileDMatch[1];

  const shortDMatch = trimmed.match(/\/d\/([a-zA-Z0-9_-]{10,})/);
  if (shortDMatch?.[1]) return shortDMatch[1];

  const queryIdMatch = trimmed.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (queryIdMatch?.[1]) return queryIdMatch[1];

  return null;
}

export function isDirectRenderableSrc(src?: string): boolean {
  if (!src || typeof src !== 'string') return false;
  const trimmed = src.trim();
  if (!trimmed) return false;
  if (trimmed.startsWith('data:image/') || trimmed.startsWith('blob:')) {
    return true;
  }
  if (trimmed.startsWith('/api/assignments/')) {
    return true;
  }
  if (
    (trimmed.startsWith('http://') || trimmed.startsWith('https://')) &&
    !extractDriveFileIdFromUrl(trimmed) &&
    !trimmed.includes('drive.google.com/drive/folders/')
  ) {
    return true;
  }
  return false;
}

export function buildMediaCandidateUrls(params: {
  assignmentId: string;
  apiSlot: AssignmentMediaApiSlot;
  primarySrc?: string;
  vaultSrc?: string;
  driveUrl?: string;
  probeServerIfEmpty?: boolean;
}): string[] {
  const {
    assignmentId,
    apiSlot,
    primarySrc,
    vaultSrc,
    driveUrl,
    probeServerIfEmpty = false,
  } = params;

  const seen = new Set<string>();
  const pushUnique = (url?: string | null) => {
    if (!url) return;
    const clean = url.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
  };

  if (isDirectRenderableSrc(primarySrc)) {
    pushUnique(primarySrc!);
  }
  if (isDirectRenderableSrc(vaultSrc)) {
    pushUnique(vaultSrc!);
  }

  const hasAnySignal = Boolean(
    (primarySrc && primarySrc.trim()) ||
      (vaultSrc && vaultSrc.trim()) ||
      (driveUrl && driveUrl.trim()) ||
      probeServerIfEmpty
  );

  if (assignmentId && hasAnySignal) {
    pushUnique(
      `/api/assignments/${encodeURIComponent(assignmentId)}/media/${apiSlot}`
    );
  }

  const driveFileId =
    extractDriveFileIdFromUrl(driveUrl) ||
    extractDriveFileIdFromUrl(primarySrc) ||
    extractDriveFileIdFromUrl(vaultSrc);

  if (driveFileId) {
    const encoded = encodeURIComponent(driveFileId);
    pushUnique(`https://drive.google.com/thumbnail?id=${encoded}&sz=w1600`);
    pushUnique(`https://lh3.googleusercontent.com/d/${encoded}=w1600`);
    pushUnique(`https://drive.google.com/uc?export=view&id=${encoded}`);
  }

  return Array.from(seen);
}

export interface AssignmentPhotoSlotDescriptor {
  apiSlot: AssignmentMediaApiSlot;
  stage: 'KEBERANGKATAN' | 'SERAH_TERIMA';
  shortLabel: string;
  title: string;
  caption: string;
  primarySrc?: string;
  vaultSrc?: string;
  driveUrl?: string;
  isSignature?: boolean;
  hasEvidenceSignal: boolean;
}

export function buildAssignmentPhotoDescriptors(
  assignment: Assignment,
  vaultMedia?: Pick<Assignment, 'departureData' | 'handoverData'> | null
): AssignmentPhotoSlotDescriptor[] {
  const jenisKendaraan =
    assignment.departureData?.jenisKendaraan || 'Mobil Pendingin';
  const isPendingin = jenisKendaraan !== 'Non Pendingin';

  const hasDepSuhuSignal = Boolean(
    isPendingin ||
      assignment.departureData?.fotoSuhuBerangkat ||
      vaultMedia?.departureData?.fotoSuhuBerangkat ||
      assignment.driveMedia?.fotoSuhuBerangkatUrl
  );

  const hasHanSuhuSignal = Boolean(
    isPendingin ||
      assignment.handoverData?.fotoSuhuSerahTerima ||
      vaultMedia?.handoverData?.fotoSuhuSerahTerima ||
      assignment.driveMedia?.fotoSuhuSerahTerimaUrl
  );

  const depTimestampLabel = assignment.departureData?.timestamp
    ? formatRealTimeTimestamp(assignment.departureData.timestamp)
    : '';
  const hanTimestampLabel = assignment.handoverData?.timestamp
    ? formatRealTimeTimestamp(assignment.handoverData.timestamp)
    : '';

  const slots: AssignmentPhotoSlotDescriptor[] = [
    {
      apiSlot: 'odo-berangkat',
      stage: 'KEBERANGKATAN',
      shortLabel: 'Odo Awal',
      title: '01. Foto Odometer Keberangkatan',
      caption:
        assignment.departureData?.kmAwal !== undefined
          ? `KM Awal: ${assignment.departureData.kmAwal.toLocaleString('id-ID')} km${
              depTimestampLabel ? ` · ${depTimestampLabel}` : ''
            }`
          : 'Menunggu input keberangkatan Driver',
      primarySrc: assignment.departureData?.fotoOdometerBerangkat,
      vaultSrc: vaultMedia?.departureData?.fotoOdometerBerangkat,
      driveUrl: assignment.driveMedia?.fotoOdometerBerangkatUrl,
      hasEvidenceSignal: Boolean(
        assignment.departureData?.fotoOdometerBerangkat ||
          vaultMedia?.departureData?.fotoOdometerBerangkat ||
          assignment.driveMedia?.fotoOdometerBerangkatUrl ||
          assignment.departureData
      ),
    },
    ...(hasDepSuhuSignal
      ? [
          {
            apiSlot: 'suhu-berangkat' as const,
            stage: 'KEBERANGKATAN' as const,
            shortLabel: 'Suhu Awal',
            title: '02. Foto Monitor Suhu Keberangkatan',
            caption: assignment.departureData?.suhuAwal
              ? `Suhu Awal: ${assignment.departureData.suhuAwal}${
                  depTimestampLabel ? ` · ${depTimestampLabel}` : ''
                }`
              : 'Menunggu foto monitor suhu awal',
            primarySrc: assignment.departureData?.fotoSuhuBerangkat,
            vaultSrc: vaultMedia?.departureData?.fotoSuhuBerangkat,
            driveUrl: assignment.driveMedia?.fotoSuhuBerangkatUrl,
            hasEvidenceSignal: Boolean(
              assignment.departureData?.fotoSuhuBerangkat ||
                vaultMedia?.departureData?.fotoSuhuBerangkat ||
                assignment.driveMedia?.fotoSuhuBerangkatUrl ||
                assignment.departureData?.suhuAwal
            ),
          },
        ]
      : []),
    {
      apiSlot: 'odo-serahterima',
      stage: 'SERAH_TERIMA',
      shortLabel: 'Odo Akhir',
      title: '03. Foto Odometer Serah Terima',
      caption:
        assignment.handoverData?.kmAkhir !== undefined
          ? `KM Akhir: ${assignment.handoverData.kmAkhir.toLocaleString('id-ID')} km${
              hanTimestampLabel ? ` · ${hanTimestampLabel}` : ''
            }`
          : 'Menunggu laporan serah terima Driver',
      primarySrc: assignment.handoverData?.fotoOdometerSerahTerima,
      vaultSrc: vaultMedia?.handoverData?.fotoOdometerSerahTerima,
      driveUrl: assignment.driveMedia?.fotoOdometerSerahTerimaUrl,
      hasEvidenceSignal: Boolean(
        assignment.handoverData?.fotoOdometerSerahTerima ||
          vaultMedia?.handoverData?.fotoOdometerSerahTerima ||
          assignment.driveMedia?.fotoOdometerSerahTerimaUrl ||
          assignment.handoverData
      ),
    },
    ...(hasHanSuhuSignal
      ? [
          {
            apiSlot: 'suhu-serahterima' as const,
            stage: 'SERAH_TERIMA' as const,
            shortLabel: 'Suhu Akhir',
            title: '04. Foto Monitor Suhu Serah Terima',
            caption: assignment.handoverData?.suhuAkhir
              ? `Suhu Akhir: ${assignment.handoverData.suhuAkhir}${
                  hanTimestampLabel ? ` · ${hanTimestampLabel}` : ''
                }`
              : 'Menunggu foto monitor suhu serah terima',
            primarySrc: assignment.handoverData?.fotoSuhuSerahTerima,
            vaultSrc: vaultMedia?.handoverData?.fotoSuhuSerahTerima,
            driveUrl: assignment.driveMedia?.fotoSuhuSerahTerimaUrl,
            hasEvidenceSignal: Boolean(
              assignment.handoverData?.fotoSuhuSerahTerima ||
                vaultMedia?.handoverData?.fotoSuhuSerahTerima ||
                assignment.driveMedia?.fotoSuhuSerahTerimaUrl ||
                assignment.handoverData?.suhuAkhir
            ),
          },
        ]
      : []),
    {
      apiSlot: 'bukti-serahterima',
      stage: 'SERAH_TERIMA',
      shortLabel: 'Bukti Serah Terima',
      title: '05. Foto Bukti Serah Terima Muatan',
      caption: assignment.handoverData?.penerimaNama
        ? `Penerima: ${assignment.handoverData.penerimaNama} · ${
            assignment.handoverData.kondisiAkhir || 'Diterima'
          }`
        : 'Menunggu foto bukti serah terima barang',
      primarySrc: assignment.handoverData?.fotoBuktiSerahTerima,
      vaultSrc: vaultMedia?.handoverData?.fotoBuktiSerahTerima,
      driveUrl: assignment.driveMedia?.fotoBuktiSerahTerimaUrl,
      hasEvidenceSignal: Boolean(
        assignment.handoverData?.fotoBuktiSerahTerima ||
          vaultMedia?.handoverData?.fotoBuktiSerahTerima ||
          assignment.driveMedia?.fotoBuktiSerahTerimaUrl ||
          assignment.handoverData
      ),
    },
    {
      apiSlot: 'ttd-penerima',
      stage: 'SERAH_TERIMA',
      shortLabel: 'TTD Penerima',
      title: '06. Tanda Tangan Digital Penerima',
      caption: assignment.handoverData?.penerimaNama
        ? `Ditandatangani oleh: ${assignment.handoverData.penerimaNama}`
        : 'Menunggu tanda tangan penerima',
      primarySrc: assignment.handoverData?.tandaTanganPenerima,
      vaultSrc: vaultMedia?.handoverData?.tandaTanganPenerima,
      driveUrl: assignment.driveMedia?.tandaTanganPenerimaUrl,
      isSignature: true,
      hasEvidenceSignal: Boolean(
        assignment.handoverData?.tandaTanganPenerima ||
          vaultMedia?.handoverData?.tandaTanganPenerima ||
          assignment.driveMedia?.tandaTanganPenerimaUrl ||
          assignment.handoverData?.penerimaNama
      ),
    },
  ];

  return slots;
}

interface ResilientSlotThumbnailProps {
  assignmentId: string;
  slot: AssignmentPhotoSlotDescriptor;
  onSelect: (resolvedSrc: string) => void;
  compact?: boolean;
}

const ResilientSlotThumbnail: React.FC<ResilientSlotThumbnailProps> = ({
  assignmentId,
  slot,
  onSelect,
  compact = false,
}) => {
  const candidates = useMemo(
    () =>
      buildMediaCandidateUrls({
        assignmentId,
        apiSlot: slot.apiSlot,
        primarySrc: slot.primarySrc,
        vaultSrc: slot.vaultSrc,
        driveUrl: slot.driveUrl,
        probeServerIfEmpty: slot.hasEvidenceSignal,
      }),
    [
      assignmentId,
      slot.apiSlot,
      slot.primarySrc,
      slot.vaultSrc,
      slot.driveUrl,
      slot.hasEvidenceSignal,
    ]
  );

  const candidateKey = candidates.join('|');
  const [idx, setIdx] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setIdx(0);
    setFailed(false);
  }, [candidateKey]);

  if (candidates.length === 0 || failed) {
    return null;
  }

  const activeSrc = candidates[idx] || '';
  if (!activeSrc) return null;

  return (
    <button
      type="button"
      onClick={() => onSelect(activeSrc)}
      title={`Lihat ${slot.title}`}
      className={`group relative overflow-hidden rounded-md border border-slate-200 bg-white text-left transition-colors hover:border-slate-900 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 ${
        compact ? 'h-11 w-14 shrink-0' : 'h-16 w-24 shrink-0'
      }`}
    >
      <img
        src={activeSrc}
        alt={slot.shortLabel}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => {
          if (idx + 1 < candidates.length) {
            setIdx((prev) => prev + 1);
          } else {
            setFailed(true);
          }
        }}
        className={`h-full w-full ${
          slot.isSignature ? 'object-contain bg-white p-0.5' : 'object-cover'
        }`}
      />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 truncate bg-slate-950/70 px-1 py-0.5 text-[9px] font-medium text-white">
        {slot.shortLabel}
      </span>
    </button>
  );
};

export const AssignmentInlineMiniThumbs: React.FC<{
  assignment: Assignment;
  onOpenGallery: () => void;
}> = ({ assignment, onOpenGallery }) => {
  const [vaultMedia, setVaultMedia] = useState<Pick<
    Assignment,
    'departureData' | 'handoverData'
  > | null>(null);

  useEffect(() => {
    let active = true;
    readCachedAssignmentMediaFromVault(assignment.id)
      .then((cached) => {
        if (active) setVaultMedia(cached);
      })
      .catch(() => {
        if (active) setVaultMedia(null);
      });
    return () => {
      active = false;
    };
  }, [assignment.id]);

  const descriptors = useMemo(
    () =>
      buildAssignmentPhotoDescriptors(assignment, vaultMedia).filter(
        (s) => s.hasEvidenceSignal
      ),
    [assignment, vaultMedia]
  );

  if (descriptors.length === 0) return null;

  return (
    <div className="mt-1 flex items-center gap-1">
      {descriptors.map((slot) => (
        <ResilientSlotThumbnail
          key={slot.apiSlot}
          assignmentId={assignment.id}
          slot={slot}
          compact
          onSelect={() => onOpenGallery()}
        />
      ))}
    </div>
  );
};

interface AssignmentPhotoStripProps {
  assignment: Assignment;
  driveRootFolderUrl?: string;
  onOpenGallery: () => void;
  onOpenPrint?: () => void;
  compact?: boolean;
}

export const AssignmentPhotoStrip: React.FC<AssignmentPhotoStripProps> = ({
  assignment,
  driveRootFolderUrl,
  onOpenGallery,
  onOpenPrint,
  compact = false,
}) => {
  const [vaultMedia, setVaultMedia] = useState<Pick<
    Assignment,
    'departureData' | 'handoverData'
  > | null>(null);

  useEffect(() => {
    let active = true;
    readCachedAssignmentMediaFromVault(assignment.id)
      .then((cached) => {
        if (active) setVaultMedia(cached);
      })
      .catch(() => {
        if (active) setVaultMedia(null);
      });
    return () => {
      active = false;
    };
  }, [assignment.id]);

  const photoStats = useMemo(
    () => countAssignmentPhotos(assignment),
    [assignment]
  );

  const descriptors = useMemo(
    () => buildAssignmentPhotoDescriptors(assignment, vaultMedia),
    [assignment, vaultMedia]
  );

  const visibleSlots = descriptors.filter((s) => s.hasEvidenceSignal);
  const folderHref =
    assignment.driveMedia?.folderUrl ||
    assignment.driveFolderUrl ||
    (driveRootFolderUrl && driveRootFolderUrl.trim().startsWith('http')
      ? driveRootFolderUrl.trim()
      : '');

  if (
    visibleSlots.length === 0 &&
    photoStats.totalUploaded === 0 &&
    !folderHref
  ) {
    return null;
  }

  return (
    <div
      className={
        compact
          ? 'mt-2 border-t border-slate-100 pt-2'
          : 'mt-3 border-t border-slate-200 pt-3'
      }
    >
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px]">
        <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-slate-600">
          <Camera className="h-3.5 w-3.5 text-slate-500" />
          <span className="font-semibold text-slate-800">
            Dokumentasi Foto &amp; TTD Driver
          </span>
          <span aria-hidden="true">·</span>
          <span className="font-mono tabular-nums text-emerald-700">
            {photoStats.totalUploaded > 0
              ? `${photoStats.totalUploaded} lampiran`
              : 'Siap dilihat'}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onOpenGallery}
            className="inline-flex items-center gap-1 font-semibold text-sky-700 hover:text-sky-900 hover:underline"
          >
            <Maximize2 className="h-3 w-3" />
            Perbesar Foto
          </button>
          {folderHref && (
            <>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <a
                href={folderHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900 hover:underline"
              >
                <FolderOpen className="h-3 w-3" />
                Google Drive
              </a>
            </>
          )}
          {onOpenPrint && (
            <>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <button
                type="button"
                onClick={onOpenPrint}
                className="inline-flex items-center gap-1 font-semibold text-slate-700 hover:text-slate-900 hover:underline"
              >
                <Printer className="h-3 w-3" />
                Lampiran Cetak
              </button>
            </>
          )}
        </div>
      </div>

      {visibleSlots.length > 0 && (
        <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar">
          {visibleSlots.map((slot) => (
            <ResilientSlotThumbnail
              key={slot.apiSlot}
              assignmentId={assignment.id}
              slot={slot}
              compact={compact}
              onSelect={() => onOpenGallery()}
            />
          ))}
        </div>
      )}
    </div>
  );
};

interface GalleryFrameCardProps {
  assignmentId: string;
  slot: AssignmentPhotoSlotDescriptor;
  onZoom: (src: string, title: string, caption: string) => void;
}

const GalleryFrameCard: React.FC<GalleryFrameCardProps> = ({
  assignmentId,
  slot,
  onZoom,
}) => {
  const candidates = useMemo(
    () =>
      buildMediaCandidateUrls({
        assignmentId,
        apiSlot: slot.apiSlot,
        primarySrc: slot.primarySrc,
        vaultSrc: slot.vaultSrc,
        driveUrl: slot.driveUrl,
        probeServerIfEmpty: slot.hasEvidenceSignal,
      }),
    [
      assignmentId,
      slot.apiSlot,
      slot.primarySrc,
      slot.vaultSrc,
      slot.driveUrl,
      slot.hasEvidenceSignal,
    ]
  );

  const candidateKey = candidates.join('|');
  const [idx, setIdx] = useState(0);
  const [allFailed, setAllFailed] = useState(false);

  useEffect(() => {
    setIdx(0);
    setAllFailed(false);
  }, [candidateKey]);

  const activeSrc = !allFailed && candidates[idx] ? candidates[idx] : '';

  return (
    <div className="flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
        <span className="truncate text-xs font-semibold text-slate-800">
          {slot.title}
        </span>
        {slot.driveUrl && slot.driveUrl.trim().startsWith('http') && (
          <a
            href={slot.driveUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex shrink-0 items-center gap-1 text-[11px] font-semibold text-sky-700 hover:underline"
            title="Buka file asli di Google Drive"
          >
            Drive
            <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>

      <div className="relative flex h-52 items-center justify-center bg-slate-50/40 p-2">
        {activeSrc ? (
          <button
            type="button"
            onClick={() => onZoom(activeSrc, slot.title, slot.caption)}
            className="group relative flex h-full w-full items-center justify-center overflow-hidden rounded focus-visible:outline-2 focus-visible:outline-slate-900"
            title="Klik untuk memperbesar foto"
          >
            <img
              src={activeSrc}
              alt={slot.title}
              referrerPolicy="no-referrer"
              onError={() => {
                if (idx + 1 < candidates.length) {
                  setIdx((prev) => prev + 1);
                } else {
                  setAllFailed(true);
                }
              }}
              className={`h-full w-full rounded ${
                slot.isSignature ? 'bg-white object-contain p-2' : 'object-contain'
              }`}
            />
            <span className="pointer-events-none absolute right-2 bottom-2 inline-flex items-center gap-1 rounded bg-slate-900/75 px-2 py-1 text-[10px] font-semibold text-white opacity-0 transition-opacity group-hover:opacity-100">
              <Maximize2 className="h-3 w-3" />
              Perbesar
            </span>
          </button>
        ) : candidates.length > 0 && allFailed ? (
          <div className="flex flex-col items-center gap-1.5 px-3 text-center text-xs text-slate-400">
            <ImageOff className="h-5 w-5 text-slate-400" />
            <span>Belum ada foto terunggah pada slot ini</span>
          </div>
        ) : (
          <span className="text-xs text-slate-400">
            Belum ada foto diunggah Driver
          </span>
        )}
      </div>

      <div className="border-t border-slate-100 px-3 py-2 font-mono text-[11px] text-slate-600 tabular-nums">
        {slot.caption}
      </div>
    </div>
  );
};

interface AssignmentPhotoGalleryModalProps {
  assignment: Assignment | null;
  driveRootFolderUrl?: string;
  onOpenPrint?: (assignment: Assignment) => void;
  onClose: () => void;
}

export const AssignmentPhotoGalleryModal: React.FC<
  AssignmentPhotoGalleryModalProps
> = ({ assignment, driveRootFolderUrl, onOpenPrint, onClose }) => {
  const [vaultMedia, setVaultMedia] = useState<Pick<
    Assignment,
    'departureData' | 'handoverData'
  > | null>(null);
  const [zoomedItem, setZoomedItem] = useState<{
    src: string;
    title: string;
    caption: string;
  } | null>(null);

  useEffect(() => {
    if (!assignment?.id) {
      setVaultMedia(null);
      setZoomedItem(null);
      return;
    }
    let active = true;
    readCachedAssignmentMediaFromVault(assignment.id)
      .then((cached) => {
        if (active) setVaultMedia(cached);
      })
      .catch(() => {
        if (active) setVaultMedia(null);
      });
    return () => {
      active = false;
    };
  }, [assignment?.id]);

  useEffect(() => {
    if (!assignment) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (zoomedItem) {
          setZoomedItem(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [assignment, zoomedItem, onClose]);

  if (!assignment) return null;

  const descriptors = buildAssignmentPhotoDescriptors(assignment, vaultMedia);
  const departureSlots = descriptors.filter((d) => d.stage === 'KEBERANGKATAN');
  const handoverSlots = descriptors.filter((d) => d.stage === 'SERAH_TERIMA');
  const subfolderName = buildAssignmentDriveSubfolderName(assignment);
  const folderHref =
    assignment.driveMedia?.folderUrl ||
    assignment.driveFolderUrl ||
    (driveRootFolderUrl && driveRootFolderUrl.trim().startsWith('http')
      ? driveRootFolderUrl.trim()
      : '');

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/65 p-3 sm:p-6"
      role="dialog"
      aria-modal="true"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="my-auto w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-4 shadow-2xl sm:p-6">
        {/* Header */}
        <div className="flex flex-col gap-3 border-b border-slate-200 pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-mono text-xs text-slate-600 tabular-nums">
              <span className="font-bold text-slate-900">
                {assignment.noPenugasan}
              </span>
              <span aria-hidden="true">·</span>
              <span>{assignment.plateNumber}</span>
              <span aria-hidden="true">·</span>
              <span>{assignment.driverName}</span>
              <span aria-hidden="true">·</span>
              <span className="font-semibold text-emerald-700">
                {assignment.status}
              </span>
            </div>
            <h3 className="mt-1 text-base font-bold text-slate-900 sm:text-lg">
              Dokumentasi Foto Inputan Driver &amp; Tanda Tangan Penerima
            </h3>
            <p className="mt-0.5 font-mono text-[11px] text-slate-500">
              Subfolder Arsip Google Drive: {subfolderName}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {folderHref && (
              <a
                href={folderHref}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 whitespace-nowrap"
              >
                <FolderOpen className="h-3.5 w-3.5 text-sky-700" />
                Buka Folder Drive
              </a>
            )}
            {onOpenPrint && (
              <button
                type="button"
                onClick={() => onOpenPrint(assignment)}
                className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-slate-900 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
              >
                <Printer className="h-3.5 w-3.5" />
                Lampiran Cetak / PDF
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              Tutup
            </button>
          </div>
        </div>

        {/* Section 01: Keberangkatan */}
        <div className="mt-5">
          <h4 className="text-xs font-bold text-slate-900">
            01. Foto Keberangkatan Driver
          </h4>
          <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {departureSlots.map((slot) => (
              <GalleryFrameCard
                key={slot.apiSlot}
                assignmentId={assignment.id}
                slot={slot}
                onZoom={(src, title, caption) =>
                  setZoomedItem({ src, title, caption })
                }
              />
            ))}
          </div>
        </div>

        {/* Section 02: Serah Terima & TTD */}
        <div className="mt-6">
          <h4 className="text-xs font-bold text-slate-900">
            02. Foto Serah Terima &amp; Tanda Tangan Penerima
          </h4>
          <div className="mt-2.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {handoverSlots.map((slot) => (
              <GalleryFrameCard
                key={slot.apiSlot}
                assignmentId={assignment.id}
                slot={slot}
                onZoom={(src, title, caption) =>
                  setZoomedItem({ src, title, caption })
                }
              />
            ))}
          </div>
        </div>
      </div>

      {/* Fullscreen Zoom Lightbox */}
      {zoomedItem && (
        <div
          className="fixed inset-0 z-[60] flex flex-col items-center justify-center bg-slate-950/90 p-4"
          onClick={() => setZoomedItem(null)}
        >
          <div
            className="w-full max-w-4xl overflow-hidden rounded-xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-slate-900">
                  {zoomedItem.title}
                </p>
                <p className="truncate font-mono text-xs text-slate-500 tabular-nums">
                  {zoomedItem.caption}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZoomedItem(null)}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 text-xs font-semibold text-slate-800 hover:bg-slate-50"
              >
                <X className="h-4 w-4" />
                Tutup
              </button>
            </div>
            <div className="flex max-h-[78vh] items-center justify-center bg-slate-950/5 p-3">
              <img
                src={zoomedItem.src}
                alt={zoomedItem.title}
                referrerPolicy="no-referrer"
                className="max-h-[72vh] w-auto max-w-full rounded object-contain bg-white"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
