import React, { useRef, useState, useEffect } from 'react';
import {
  Camera,
  Maximize2,
  RefreshCw,
  Trash2,
  X,
  CheckCircle,
  Clock,
  RotateCw,
  ZoomIn,
  ZoomOut,
  ScanLine,
} from 'lucide-react';
import {
  compressImageDual,
  rotateImageBase64,
  getPhotoUploadQueue,
  savePhotoUploadQueue,
  uploadPhotoToGasWebApp,
} from '../utils/media';

interface PhotoUploadFieldProps {
  label: string;
  helperText?: string;
  required?: boolean;
  value: string;
  onChange: (dataUrl: string, thumbnailDataUrl?: string) => void;
  suratTugas?: string;
  appsScriptUrl?: string;
}

export const PhotoUploadField: React.FC<PhotoUploadFieldProps> = ({
  label,
  helperText,
  required = false,
  value,
  onChange,
  suratTugas = 'ST-GENERAL',
  appsScriptUrl = '',
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [rotating, setRotating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [zoomed, setZoomed] = useState<boolean>(false);
  const [zoomLevel, setZoomLevel] = useState<number>(1);
  const [lastUploadedId, setLastUploadedId] = useState<string>('');
  const [uploadStatus, setUploadStatus] = useState<
    'Menunggu Unggah' | 'Tersimpan di Drive' | 'Gagal'
  >('Menunggu Unggah');

  // Reset zoom level whenever lightbox closes or opens
  useEffect(() => {
    if (zoomed) {
      setZoomLevel(1);
    }
  }, [zoomed]);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    setProcessing(true);
    try {
      // 1. Kualitas & Kompresi Upload Gambar (Client-Side):
      // - Lebar maksimal di 1200px dengan rasio aspek asli (tidak di-crop kotak)
      // - Kualitas kompresi JPEG 0.82 (82%) agar ukuran file ringan (200-400KB) namun angka & teks struk tetap tajam
      const { mainBase64, thumbnailBase64 } = await compressImageDual(
        file,
        1200,
        0.82
      );
      onChange(mainBase64, thumbnailBase64);

      const idUnik =
        'IMG-' + Date.now() + '-' + Math.random().toString(36).substring(2, 7);
      setLastUploadedId(idUnik);
      const tanggalKirim = new Date().toISOString();
      const fileName = `${label.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.jpg`;

      // 2. Simpan ke antrean lokal (localStorage)
      const queueItem = {
        idUnik,
        tanggalKirim,
        suratTugas,
        fileName,
        base64Data: mainBase64,
        thumbnailBase64,
        status: 'Menunggu Unggah' as const,
      };

      const currentQueue = getPhotoUploadQueue();
      currentQueue.push(queueItem);
      savePhotoUploadQueue(currentQueue);
      setUploadStatus('Menunggu Unggah');

      // 3. Pengiriman Paralel ke GAS Web App jika appsScriptUrl tersedia
      if (
        appsScriptUrl &&
        /^https:\/\/script\.google\.com\//i.test(appsScriptUrl)
      ) {
        uploadPhotoToGasWebApp(queueItem, appsScriptUrl).then((res) => {
          if (res.success) {
            setUploadStatus('Tersimpan di Drive');
            const updated = getPhotoUploadQueue().map((q) =>
              q.idUnik === idUnik
                ? {
                    ...q,
                    status: 'Tersimpan di Drive' as const,
                    driveUrl: res.url,
                    thumbnailUrl: res.thumbnailUrl,
                  }
                : q
            );
            savePhotoUploadQueue(updated);
          } else {
            setUploadStatus('Gagal');
          }
        });
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal memproses foto.'
      );
    } finally {
      setProcessing(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  // Tombol "Putar 90°" (Rotate) untuk memastikan orientasi struk tegak/sesuai
  const handleRotate = async (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!value || rotating) return;
    setRotating(true);
    setErrorMsg('');
    try {
      const rotated = await rotateImageBase64(value, 90, 0.82);
      onChange(rotated, rotated);

      // Perbarui item yang ada di antrean lokal (localStorage)
      const currentQueue = getPhotoUploadQueue();
      let updatedQueue = false;
      const modifiedQueue = currentQueue.map((item) => {
        if (
          (lastUploadedId && item.idUnik === lastUploadedId) ||
          item.thumbnailBase64 === value ||
          item.base64Data === value
        ) {
          updatedQueue = true;
          return {
            ...item,
            base64Data: rotated,
            thumbnailBase64: rotated,
          };
        }
        return item;
      });

      if (updatedQueue) {
        savePhotoUploadQueue(modifiedQueue);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Gagal memutar foto.'
      );
    } finally {
      setRotating(false);
    }
  };

  const handleZoomIn = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setZoomLevel((prev) => Math.min(4, Math.round((prev + 0.5) * 10) / 10));
  };

  const handleZoomOut = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setZoomLevel((prev) => Math.max(1, Math.round((prev - 0.5) * 10) / 10));
  };

  const handleResetZoom = (e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setZoomLevel(1);
  };

  return (
    <div>
      <div className="flex items-center justify-between gap-1">
        <label className="block text-xs font-semibold text-slate-700">
          {label} {required && <span className="text-red-600">*</span>}
        </label>
        {value && (
          <span
            className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${
              uploadStatus === 'Tersimpan di Drive'
                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}
          >
            {uploadStatus === 'Tersimpan di Drive' ? (
              <>
                <CheckCircle className="h-2.5 w-2.5" />
                Tersimpan di Drive
              </>
            ) : (
              <>
                <Clock className="h-2.5 w-2.5 animate-pulse" />
                Menunggu Unggah
              </>
            )}
          </span>
        )}
      </div>
      {helperText && (
        <p className="mt-0.5 text-xs text-slate-500">{helperText}</p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />

      {!value ? (
        <button
          type="button"
          disabled={processing}
          onClick={() => inputRef.current?.click()}
          className="mt-1.5 flex min-h-[56px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/90 px-4 py-3.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100 active:bg-slate-200/70 disabled:opacity-50"
        >
          {processing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-slate-600" />
              Memproses &amp; Kompresi Foto Tajam (1200px / 82%)...
            </>
          ) : (
            <>
              <Camera className="h-4 w-4 text-sky-700" />
              Ambil / Unggah Foto Kamera
            </>
          )}
        </button>
      ) : (
        /* 2. Tampilan UI Thumbnail Struk:
           - Aspek rasio potret memanjang (aspek rasio 3:4, min-h-[240px])
           - CSS object-fit: contain dengan background abu-abu netral terang (#f4f4f5)
           - Tulisan & angka struk utuh tidak terpotong dari atas sampai bawah */
        <div className="mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xs">
          <div
            className="group relative min-h-[240px] max-h-[380px] w-full aspect-[3/4] cursor-pointer overflow-hidden flex items-center justify-center p-2"
            style={{ backgroundColor: '#f4f4f5' }}
            onClick={() => setZoomed(true)}
            title="Klik untuk membuka pratinjau layar penuh (Lightbox) & perbesar detail struk"
          >
            <img
              src={value}
              alt={label}
              referrerPolicy="no-referrer"
              className="h-full w-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
              style={{ objectFit: 'contain' }}
            />
            {/* Overlay petunjuk klik zoom */}
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-slate-950/30 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/85 px-3 py-1.5 text-xs font-semibold text-white shadow-lg backdrop-blur-xs">
                <Maximize2 className="h-3.5 w-3.5" />
                Klik Pratinjau Layar Penuh (Zoom)
              </span>
              <span className="text-[10px] text-white/90 drop-shadow-sm font-medium">
                Objek Utuh Tanpa Terpotong
              </span>
            </div>
            {/* Badge orientasi / rasio */}
            <div className="absolute bottom-2 left-2 pointer-events-none">
              <span className="inline-flex items-center gap-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-semibold text-white backdrop-blur-xs">
                <ScanLine className="h-2.5 w-2.5" />
                Rasio Asli (1200px · 82%)
              </span>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-1.5 border-t border-slate-200 bg-white px-2.5 py-2">
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setZoomed(true)}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
                title="Buka pratinjau layar penuh untuk memeriksa angka struk"
              >
                <Maximize2 className="h-3.5 w-3.5 text-sky-700" />
                <span>Perbesar</span>
              </button>

              {/* 1. Tombol Putar 90° (Rotate) */}
              <button
                type="button"
                disabled={rotating}
                onClick={handleRotate}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-50"
                title="Putar orientasi foto 90 derajat searah jarum jam"
              >
                <RotateCw
                  className={`h-3.5 w-3.5 text-slate-700 ${
                    rotating ? 'animate-spin' : ''
                  }`}
                />
                <span>Putar 90°</span>
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
                title="Ganti foto struk dengan foto baru"
              >
                <Camera className="h-3.5 w-3.5 text-slate-600" />
                <span>Ganti</span>
              </button>
              <button
                type="button"
                onClick={() => onChange('')}
                className="inline-flex min-h-[36px] items-center gap-1 rounded-lg px-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
                title="Hapus foto struk ini"
              >
                <Trash2 className="h-3.5 w-3.5" />
                <span>Hapus</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 3. Fitur Zoom / Preview Layar Penuh (Lightbox) */}
      {zoomed && value && (
        <div
          className="fixed inset-0 z-[100] flex flex-col bg-slate-950/95 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          onClick={() => setZoomed(false)}
        >
          {/* Header Bar Lightbox */}
          <div
            className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 bg-slate-900/90 px-4 py-3 text-white"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="min-w-0">
              <h3 className="truncate text-sm font-bold text-white">
                {label}
              </h3>
              <p className="font-mono text-xs text-slate-400">
                {suratTugas} · Mode Detail Struk Resolusi Penuh
              </p>
            </div>

            {/* Controls: Zoom In, Zoom Out, Reset Zoom, Putar 90°, Tutup */}
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                disabled={zoomLevel <= 1}
                onClick={handleZoomOut}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                title="Perkecil (Zoom Out)"
              >
                <ZoomOut className="h-4 w-4" />
              </button>

              <span className="font-mono text-xs font-bold text-slate-300 min-w-[50px] text-center tabular-nums">
                {Math.round(zoomLevel * 100)}%
              </span>

              <button
                type="button"
                disabled={zoomLevel >= 4}
                onClick={handleZoomIn}
                className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                title="Perbesar (Zoom In)"
              >
                <ZoomIn className="h-4 w-4" />
              </button>

              {zoomLevel !== 1 && (
                <button
                  type="button"
                  onClick={handleResetZoom}
                  className="inline-flex h-9 items-center justify-center rounded-lg border border-slate-700 bg-slate-800 px-2 text-xs font-medium text-slate-300 hover:bg-slate-700"
                  title="Kembalikan ukuran normal 100%"
                >
                  100%
                </button>
              )}

              {/* Tombol Putar 90° di dalam Modal Lightbox */}
              <button
                type="button"
                disabled={rotating}
                onClick={handleRotate}
                className="inline-flex h-9 items-center gap-1 rounded-lg border border-slate-700 bg-slate-800 px-2.5 text-xs font-semibold text-slate-200 hover:bg-slate-700 disabled:opacity-40"
                title="Putar 90°"
              >
                <RotateCw
                  className={`h-4 w-4 ${rotating ? 'animate-spin' : ''}`}
                />
                <span className="hidden sm:inline">Putar 90°</span>
              </button>

              <button
                type="button"
                onClick={() => setZoomed(false)}
                className="ml-1 inline-flex h-9 items-center gap-1 rounded-lg bg-red-600 px-3 text-xs font-semibold text-white hover:bg-red-700"
                title="Tutup Pratinjau Layar Penuh"
              >
                <X className="h-4 w-4" />
                <span>Tutup</span>
              </button>
            </div>
          </div>

          {/* Stage Area: Interactive Scroll & Pan Container */}
          <div
            className="flex-1 overflow-auto p-4 flex items-center justify-center select-none"
            style={{ backgroundColor: '#18181b' }}
            onClick={(e) => {
              // Clicking outside the image closes; clicking the image toggles zoom
              if (e.target === e.currentTarget) {
                setZoomed(false);
              }
            }}
          >
            <div
              className="relative inline-block transition-transform duration-200 ease-out"
              style={{
                transform: `scale(${zoomLevel})`,
                transformOrigin: 'center center',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <img
                src={value}
                alt={label}
                referrerPolicy="no-referrer"
                className="max-h-[80vh] w-auto max-w-[92vw] rounded-lg shadow-2xl object-contain"
                style={{
                  backgroundColor: '#f4f4f5',
                  objectFit: 'contain',
                }}
              />
            </div>
          </div>

          {/* Bottom Bar Hints */}
          <div
            className="border-t border-slate-800 bg-slate-900/90 px-4 py-2 text-center text-xs text-slate-400"
            onClick={(e) => e.stopPropagation()}
          >
            Gunakan tombol <span className="font-semibold text-white">Zoom In (+)</span> &amp; <span className="font-semibold text-white">Zoom Out (-)</span> untuk membaca rincian angka kecil pada struk belanja, atau tombol <span className="font-semibold text-white">Putar 90°</span> jika struk miring.
          </div>
        </div>
      )}

      {errorMsg && <p className="mt-1 text-xs text-red-600">{errorMsg}</p>}
    </div>
  );
};
