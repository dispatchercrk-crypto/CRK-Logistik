import React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Info,
  X,
} from 'lucide-react';
import { ToastMessage } from '../types';
import { formatRealTimeTimestamp } from '../utils/media';
import { launchWhatsAppUrl } from '../utils/whatsapp';

interface ToastContainerProps {
  toasts: ToastMessage[];
  onDismiss: (id: string) => void;
}

function openRealtimeHref(href: string): void {
  if (!href.startsWith('https://wa.me/')) {
    launchWhatsAppUrl(href);
    return;
  }
  try {
    const parsed = new URL(href);
    const rawText = parsed.searchParams.get('text');
    if (rawText) {
      const freshLine = `Waktu Pesan WA : ${formatRealTimeTimestamp(new Date())}`;
      const updatedText = rawText.includes('Waktu Pesan WA :')
        ? rawText.replace(/^Waktu Pesan WA :.*$/m, freshLine)
        : rawText;
      const base = `${parsed.origin}${parsed.pathname}`;
      launchWhatsAppUrl(`${base}?text=${encodeURIComponent(updatedText)}`);
      return;
    }
  } catch {
    // Fallback to direct launch
  }
  launchWhatsAppUrl(href);
}

export const ToastContainer: React.FC<ToastContainerProps> = ({
  toasts,
  onDismiss,
}) => {
  if (toasts.length === 0) return null;

  return (
    <div
      aria-live="polite"
      className="fixed inset-x-3 top-16 z-50 flex flex-col gap-2.5 sm:inset-x-auto sm:bottom-5 sm:right-5 sm:top-auto sm:w-full sm:max-w-sm"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className="sheet-enter flex items-start gap-3 rounded-2xl border border-slate-200/90 bg-white/95 p-4 shadow-xl backdrop-blur-md"
        >
          {toast.type === 'success' && (
            <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
          )}
          {toast.type === 'error' && (
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-600" />
          )}
          {toast.type === 'info' && (
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
          )}
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-slate-900">{toast.title}</p>
            {toast.description && (
              <p className="mt-0.5 text-xs leading-relaxed text-slate-600">
                {toast.description}
              </p>
            )}
            {toast.actionHref && toast.actionLabel && (
              <button
                type="button"
                onClick={() => openRealtimeHref(toast.actionHref!)}
                className="mt-2.5 inline-flex min-h-[34px] items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-emerald-700"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                {toast.actionLabel}
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => onDismiss(toast.id)}
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup notifikasi"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  );
};
