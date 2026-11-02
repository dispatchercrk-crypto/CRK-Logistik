import React, { useState } from 'react';
import {
  Check,
  CheckCircle2,
  Copy,
  Download,
  ExternalLink,
  Laptop,
  Loader2,
  RefreshCw,
  Share2,
  Smartphone,
  X,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';

interface PWAInstallButtonProps {
  compact?: boolean;
  fullWidth?: boolean;
  showAlways?: boolean;
  variant?: 'button' | 'store-card';
  highlighted?: boolean;
  label?: string;
  compactLabel?: string;
}

export const PWAInstallButton: React.FC<PWAInstallButtonProps> = ({
  compact = false,
  fullWidth = false,
  showAlways = false,
  variant = 'button',
  highlighted = false,
  label,
  compactLabel,
}) => {
  const {
    isInstallable,
    isInstalled,
    isInstalling,
    justInstalled,
    isIOS,
    isAndroid,
    isAndroidWebView,
    isInIframe,
    isDevPrivateHost,
    isPublicShareLive,
    isCheckingPublicLink,
    recheckPublicLink,
    directTopLevelInstallUrl,
    chromeAndroidIntentUrl,
    install,
  } = usePWAInstall();

  const [showGuide, setShowGuide] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);

  if (isInstalled && !showAlways) {
    return null;
  }

  const canNativeShare =
    typeof navigator !== 'undefined' && typeof navigator.share === 'function';

  const handleTriggerInstall = async () => {
    if (isInstalled) {
      setShowGuide(true);
      return;
    }
    const result = await install();
    if (result === 'unavailable') {
      void recheckPublicLink(false);
      setShowGuide(true);
    }
  };

  const handleCopyInstallUrl = async () => {
    try {
      const targetUrl =
        directTopLevelInstallUrl ||
        window.location.origin + window.location.pathname;
      await navigator.clipboard.writeText(targetUrl);
      setCopiedUrl(true);
      window.setTimeout(() => setCopiedUrl(false), 2500);
    } catch {
      setCopiedUrl(false);
    }
  };

  const handleNativeShareUrl = async () => {
    const targetUrl =
      directTopLevelInstallUrl ||
      window.location.origin + window.location.pathname;
    if (canNativeShare) {
      try {
        await navigator.share({
          title: 'Instal Aplikasi CRK Logistik',
          text: 'Buka link ini di Google Chrome HP lalu ketuk Instal ke HP untuk memasang aplikasi CRK Logistik Delivery Sistem:',
          url: targetUrl,
        });
        return;
      } catch {
        // User cancelled share sheet; fallback to copy
      }
    }
    await handleCopyInstallUrl();
  };

  const buttonLabel = isInstalled
    ? 'Aplikasi Terpasang'
    : label || 'Pasang Aplikasi ke HP';
  const mobileCompactLabel = isInstalled
    ? 'Terpasang'
    : compactLabel || 'Instal ke HP';

  return (
    <>
      {variant === 'store-card' ? (
        <div
          className={`rounded-2xl border p-3.5 sm:p-4 transition-colors ${
            highlighted
              ? 'border-emerald-400 bg-emerald-50/90 shadow-xs'
              : 'border-slate-200 bg-slate-50/90'
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <img
                src="/icon.svg"
                alt="Ikon Aplikasi CRK Logistik"
                className="h-11 w-11 shrink-0 rounded-xl border border-slate-200 bg-slate-900 p-1 shadow-2xs"
              />
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="truncate text-sm font-bold text-slate-900">
                    CRK Logistik
                  </p>
                  {(isInstalled || justInstalled) && (
                    <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  )}
                </div>
                <p className="truncate text-[11px] sm:text-xs text-slate-600">
                  {isInstalled || justInstalled
                    ? 'Terpasang di menu utama HP ini'
                    : isInstallable
                    ? 'Siap dipasang · 1-Klik pasang ke HP'
                    : highlighted
                    ? 'Ketuk tombol hijau untuk pasang ke HP'
                    : 'Aplikasi Resmi HP Android & iOS'}
                </p>
              </div>
            </div>

            <button
              type="button"
              disabled={isInstalling}
              onClick={() => void handleTriggerInstall()}
              className={`inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl px-4 py-2 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer ${
                isInstalled || justInstalled
                  ? 'border border-slate-300 bg-white text-slate-800 hover:bg-slate-100'
                  : 'bg-emerald-700 text-white shadow-2xs hover:bg-emerald-800 active:scale-[0.99]'
              }`}
            >
              {isInstalling ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  <span>Menyiapkan...</span>
                </>
              ) : isInstalled || justInstalled ? (
                <>
                  <Share2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Link Instal</span>
                </>
              ) : (
                <>
                  <Download className="h-4 w-4 shrink-0" />
                  <span>{isInstallable ? 'Instal Sekarang' : 'Instal ke HP'}</span>
                </>
              )}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={isInstalling}
          onClick={() => void handleTriggerInstall()}
          title="Instal langsung aplikasi CRK Logistik ke perangkat HP / Laptop"
          aria-label="Instal aplikasi ke perangkat"
          className={`inline-flex items-center justify-center gap-2 rounded-xl font-semibold shadow-2xs transition-colors active:scale-[0.99] whitespace-nowrap shrink-0 disabled:opacity-60 cursor-pointer ${
            isInstalled
              ? 'border border-emerald-300 bg-emerald-50 text-emerald-950 hover:bg-emerald-100/80'
              : 'border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800'
          } ${
            fullWidth
              ? 'w-full min-h-[48px] px-4 py-2.5 text-xs sm:text-sm'
              : compact
              ? 'min-h-[40px] px-3 sm:px-3.5 text-xs'
              : 'min-h-[44px] px-4 text-xs sm:text-sm'
          }`}
        >
          {isInstalling ? (
            <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          ) : isInstalled ? (
            <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0" />
          ) : (
            <Download className="h-4 w-4 shrink-0" />
          )}
          <span className={compact ? 'hidden sm:inline' : ''}>
            {isInstalling ? 'Menyiapkan Instalasi...' : buttonLabel}
          </span>
          {compact && (
            <span className="sm:hidden">
              {isInstalling ? 'Menyiapkan...' : mobileCompactLabel}
            </span>
          )}
        </button>
      )}

      {showGuide && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-[1px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-modal-title"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl max-h-[90vh] overflow-y-auto">
            {/* Play-Store-Style App Sheet Header */}
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-4">
              <div className="flex items-center gap-3 min-w-0">
                <img
                  src="/icon.svg"
                  alt="CRK Logistik"
                  className="h-12 w-12 shrink-0 rounded-2xl border border-slate-200 bg-slate-900 p-1.5"
                />
                <div className="min-w-0">
                  <h3
                    id="pwa-install-modal-title"
                    className="truncate text-sm sm:text-base font-bold text-slate-900"
                  >
                    CRK Logistik Delivery Sistem
                  </h3>
                  <p className="mt-0.5 text-xs text-emerald-700 font-medium">
                    Instalasi Resmi WebAPK · Tanpa Memori Penuh
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="min-h-[40px] min-w-[40px] inline-flex items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100 shrink-0 cursor-pointer"
                aria-label="Tutup jendela instalasi"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {isInstalled && (
              <div className="mt-3.5 flex items-start gap-2.5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs text-emerald-950">
                <CheckCircle2 className="h-4 w-4 text-emerald-700 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Aplikasi sudah terpasang di perangkat ini
                  </p>
                  <p className="mt-0.5 leading-relaxed text-emerald-800">
                    Buka aplikasi langsung dari layar utama HP Anda dengan ikon{' '}
                    <strong>CRK Logistik</strong>.
                  </p>
                </div>
              </div>
            )}

            {/* Native 1-Click Install Ready */}
            {isInstallable && !isInstalled && (
              <div className="mt-3.5">
                <button
                  type="button"
                  disabled={isInstalling}
                  onClick={async () => {
                    const outcome = await install();
                    if (outcome === 'accepted') {
                      setShowGuide(false);
                    }
                  }}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Download className="h-4 w-4 shrink-0" />
                  <span>Instal Sekarang (1-Klik ke HP)</span>
                </button>
              </div>
            )}

            {/* Case 1: Opened inside AI Studio Preview Iframe -> 1-Click Open Top-Level Chrome Tab! */}
            {isInIframe && !isInstalled && (
              <div className="mt-3.5 rounded-xl border border-emerald-300 bg-emerald-50/80 p-3.5 text-xs text-slate-800 space-y-2.5">
                <p className="font-bold text-emerald-950">
                  Langkah 1-Klik: Buka di Tab Utama Chrome
                </p>
                <p className="leading-relaxed text-slate-700">
                  Saat ini Anda sedang berada di dalam jendela Pratinjau Editor,
                  sehingga Google Chrome menahan tombol instalasi. Klik tombol
                  hijau di bawah untuk membuka halaman instalasi di{' '}
                  <strong>Tab Utama Chrome</strong>, lalu ketuk{' '}
                  <strong>Instal Sekarang</strong> (langsung terpasang seperti
                  Play Store):
                </p>
                {directTopLevelInstallUrl && (
                  <a
                    href={directTopLevelInstallUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs sm:text-sm font-semibold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    <span>Buka Halaman Instalasi 1-Klik</span>
                  </a>
                )}
              </div>
            )}

            {/* Public Link Warning when in private ais-dev editor and Share/Deploy isn't enabled yet */}
            {isDevPrivateHost && !isPublicShareLive && (
              <div className="mt-3 rounded-xl border border-amber-300 bg-amber-50/90 p-3.5 text-xs text-amber-950 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">
                    Penting Sebelum Membagikan Link ke HP Driver Lain:
                  </p>
                  <button
                    type="button"
                    disabled={isCheckingPublicLink}
                    onClick={() => void recheckPublicLink(true)}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-2.5 py-1 text-[11px] font-semibold text-amber-900 hover:bg-amber-100 whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw
                      className={`h-3 w-3 ${
                        isCheckingPublicLink ? 'animate-spin' : ''
                      }`}
                    />
                    <span>Cek Status</span>
                  </button>
                </div>
                <p className="leading-relaxed text-amber-900">
                  Untuk memasang di <strong>HP Driver / perangkat lain</strong>{' '}
                  tanpa Error 404/403, klik tombol{' '}
                  <strong>Deploy (ikon Roket)</strong> atau tombol{' '}
                  <strong>Share &rarr; Public</strong> di pojok kanan atas
                  Google AI Studio terlebih dahulu, lalu tekan{' '}
                  <strong>Cek Status</strong>.
                </p>
              </div>
            )}

            {/* Case 2: Opened inside WhatsApp / In-App WebView on Android */}
            {isAndroid && isAndroidWebView && !isInIframe && !isInstalled && (
              <div className="mt-3.5 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-slate-800 space-y-2.5">
                <p className="font-semibold text-emerald-950">
                  Buka di Google Chrome untuk Instal 1-Klik
                </p>
                <p className="leading-relaxed text-slate-700">
                  Anda sedang membuka link dari browser internal WhatsApp /
                  aplikasi pesan. Ketuk tombol di bawah untuk membuka otomatis di{' '}
                  <strong>Google Chrome</strong> lalu ketuk{' '}
                  <strong>Instal Sekarang</strong>.
                </p>
                {chromeAndroidIntentUrl && (
                  <a
                    href={chromeAndroidIntentUrl}
                    className="flex min-h-[46px] w-full items-center justify-center gap-2 rounded-xl bg-emerald-700 px-4 py-2.5 text-xs font-semibold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap"
                  >
                    <ExternalLink className="h-4 w-4 shrink-0" />
                    <span>Buka Otomatis di Google Chrome</span>
                  </a>
                )}
              </div>
            )}

            {/* Platform Instructions */}
            <div className="mt-3.5 space-y-2.5 text-xs">
              <div
                className={`rounded-xl border p-3 ${
                  isAndroid
                    ? 'border-emerald-300 bg-emerald-50/50'
                    : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Smartphone className="h-4 w-4 text-emerald-700 shrink-0" />
                  <span>HP Android (Google Chrome)</span>
                </div>
                <ol className="mt-1.5 list-decimal pl-4 space-y-1 text-slate-600 leading-relaxed">
                  <li>
                    Buka halaman aplikasi di tab utama{' '}
                    <strong>Google Chrome HP</strong>, lalu ketuk tombol hijau{' '}
                    <strong>Instal Sekarang</strong> — muncul popup resmi{' '}
                    <strong>Instal</strong> seperti Play Store.
                  </li>
                  <li>
                    Jika aplikasi belum muncul atau sudah pernah ditutup, ketuk
                    menu <strong>titik tiga (⋮)</strong> di kanan atas Chrome
                    lalu pilih <strong>Instal aplikasi</strong>.
                  </li>
                </ol>
              </div>

              <div
                className={`rounded-xl border p-3 ${
                  isIOS
                    ? 'border-sky-300 bg-sky-50/60'
                    : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="flex items-center gap-2 font-bold text-slate-900">
                  <Smartphone className="h-4 w-4 text-sky-700 shrink-0" />
                  <span>iPhone / iPad (Browser Safari)</span>
                </div>
                <ol className="mt-1.5 list-decimal pl-4 space-y-1 text-slate-600 leading-relaxed">
                  <li>
                    Ketuk ikon <strong>Bagikan (Share)</strong> pada bilah bawah
                    Safari.
                  </li>
                  <li>
                    Pilih{' '}
                    <strong>
                      Tambahkan ke Layar Utama (Add to Home Screen)
                    </strong>
                    .
                  </li>
                </ol>
              </div>

              {!isAndroid && !isIOS && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3">
                  <div className="flex items-center gap-2 font-bold text-slate-900">
                    <Laptop className="h-4 w-4 text-slate-700 shrink-0" />
                    <span>Laptop / Komputer (Chrome &amp; Edge)</span>
                  </div>
                  <p className="mt-1.5 text-slate-600 leading-relaxed">
                    Buka di tab utama Chrome/Edge, lalu klik tombol{' '}
                    <strong>Instal Sekarang</strong> atau ikon instal di sebelah
                    kanan kolom alamat URL.
                  </p>
                </div>
              )}
            </div>

            <div className="mt-4 flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                onClick={() => void handleCopyInstallUrl()}
                className="flex-1 min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 text-xs font-semibold text-slate-800 hover:bg-slate-50 transition-colors whitespace-nowrap cursor-pointer"
              >
                {copiedUrl ? (
                  <>
                    <Check className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span className="text-emerald-700">
                      Link Instalasi Disalin
                    </span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4 text-slate-600 shrink-0" />
                    <span>
                      {isPublicShareLive
                        ? 'Salin Link Instalasi HP'
                        : 'Salin Link Tab Chrome'}
                    </span>
                  </>
                )}
              </button>

              {canNativeShare && isPublicShareLive && (
                <button
                  type="button"
                  onClick={() => void handleNativeShareUrl()}
                  className="min-h-[44px] inline-flex items-center justify-center gap-1.5 rounded-xl bg-emerald-700 px-3.5 text-xs font-semibold text-white hover:bg-emerald-800 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Share2 className="h-4 w-4 shrink-0" />
                  <span>Bagikan ke HP</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="sm:w-24 min-h-[44px] rounded-xl bg-slate-900 px-4 text-xs font-semibold text-white hover:bg-slate-800 transition-colors whitespace-nowrap cursor-pointer"
              >
                Tutup
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
