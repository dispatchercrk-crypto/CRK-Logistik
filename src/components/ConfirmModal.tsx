import React from 'react';
import { AlertTriangle, CheckCircle2, X } from 'lucide-react';

export interface ConfirmModalProps {
  open: boolean;
  title: string;
  description: string;
  details?: string[];
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'danger' | 'primary';
  loading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  open,
  title,
  description,
  details,
  confirmLabel = 'Konfirmasi',
  cancelLabel = 'Batal',
  variant = 'primary',
  loading = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-modal-title"
    >
      <div className="sheet-enter w-full max-w-md rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div
              className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                variant === 'danger'
                  ? 'bg-red-50 text-red-600'
                  : 'bg-slate-100 text-slate-900'
              }`}
            >
              {variant === 'danger' ? (
                <AlertTriangle className="h-5 w-5" />
              ) : (
                <CheckCircle2 className="h-5 w-5" />
              )}
            </div>
            <div>
              <h3
                id="confirm-modal-title"
                className="text-base font-bold text-slate-900"
              >
                {title}
              </h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-600">
                {description}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {details && details.length > 0 && (
          <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-700">
            <ul className="space-y-1 font-mono tabular-nums">
              {details.map((item, i) => (
                <li key={i} className="truncate">
                  {item}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-6 grid grid-cols-2 gap-2.5 sm:flex sm:items-center sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={loading}
            className="min-h-[44px] whitespace-nowrap shrink-0 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50 sm:min-h-[40px] sm:rounded-lg sm:py-2"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={loading}
            className={`min-h-[44px] whitespace-nowrap shrink-0 rounded-xl px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50 sm:min-h-[40px] sm:rounded-lg sm:py-2 ${
              variant === 'danger'
                ? 'bg-red-600 hover:bg-red-700'
                : 'bg-slate-900 hover:bg-slate-800'
            }`}
          >
            {loading ? 'Memproses...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};
