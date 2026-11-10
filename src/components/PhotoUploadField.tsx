import React, { useRef, useState } from 'react';
import { Camera, Maximize2, RefreshCw, Trash2, X } from 'lucide-react';
import { compressImageFile } from '../utils/media';

interface PhotoUploadFieldProps {
  label: string;
  helperText?: string;
  required?: boolean;
  value: string;
  onChange: (dataUrl: string) => void;
}

export const PhotoUploadField: React.FC<PhotoUploadFieldProps> = ({
  label,
  helperText,
  required = false,
  value,
  onChange,
}) => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [processing, setProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [zoomed, setZoomed] = useState<boolean>(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setErrorMsg('');
    setProcessing(true);
    try {
      const compressed = await compressImageFile(file, 960, 0.72);
      onChange(compressed);
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

  return (
    <div>
      <label className="block text-xs font-semibold text-slate-700">
        {label} {required && <span className="text-red-600">*</span>}
      </label>
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
          className="mt-1.5 flex min-h-[52px] w-full items-center justify-center gap-2 rounded-xl border border-dashed border-slate-300 bg-slate-50/90 px-4 py-3.5 text-xs font-semibold text-slate-700 transition-colors hover:border-slate-400 hover:bg-slate-100 active:bg-slate-200/70 disabled:opacity-50"
        >
          {processing ? (
            <>
              <RefreshCw className="h-4 w-4 animate-spin text-slate-600" />
              Memproses Foto...
            </>
          ) : (
            <>
              <Camera className="h-4 w-4 text-sky-700" />
              Ambil / Unggah Foto Kamera
            </>
          )}
        </button>
      ) : (
        <div className="mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 shadow-xs">
          <div className="group relative h-40 w-full bg-slate-900/5 cursor-pointer" onClick={() => setZoomed(true)}>
            <img
              src={value}
              alt={label}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
            <div className="absolute inset-0 flex items-center justify-center bg-slate-950/30 opacity-0 group-hover:opacity-100 transition-opacity">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-slate-900/80 px-2.5 py-1 text-xs font-semibold text-white">
                <Maximize2 className="h-3.5 w-3.5" />
                Perbesar Thumbnail
              </span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-1.5">
            <button
              type="button"
              onClick={() => setZoomed(true)}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            >
              <Maximize2 className="h-3.5 w-3.5 text-slate-600" />
              Perbesar
            </button>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
              >
                <Camera className="h-3.5 w-3.5 text-sky-700" />
                Ganti
              </button>
              <button
                type="button"
                onClick={() => onChange('')}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
              >
                <Trash2 className="h-3.5 w-3.5" />
                Hapus
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Fullscreen Zoom Lightbox */}
      {zoomed && value && (
        <div
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-slate-950/90 p-4"
          onClick={() => setZoomed(false)}
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
              <span className="text-sm font-bold text-slate-900">{label}</span>
              <button
                type="button"
                onClick={() => setZoomed(false)}
                className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-slate-100 px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-200"
              >
                <X className="h-4 w-4" />
                Tutup
              </button>
            </div>
            <div className="flex max-h-[75vh] items-center justify-center bg-slate-950/95 p-3">
              <img
                src={value}
                alt={label}
                className="max-h-[70vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}

      {errorMsg && <p className="mt-1 text-xs text-red-600">{errorMsg}</p>}
    </div>
  );
};
