import React, { useRef, useState } from 'react';
import { Camera, RefreshCw, Trash2 } from 'lucide-react';
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
        <div className="mt-1.5 overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
          <div className="relative h-40 w-full bg-slate-900/5">
            <img
              src={value}
              alt={label}
              referrerPolicy="no-referrer"
              className="h-full w-full object-cover"
            />
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-slate-200 bg-white px-3 py-1.5">
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              <Camera className="h-3.5 w-3.5 text-sky-700" />
              Ganti Foto
            </button>
            <button
              type="button"
              onClick={() => onChange('')}
              className="inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-red-600 transition-colors hover:bg-red-50 hover:text-red-700"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Hapus
            </button>
          </div>
        </div>
      )}

      {errorMsg && <p className="mt-1 text-xs text-red-600">{errorMsg}</p>}
    </div>
  );
};
