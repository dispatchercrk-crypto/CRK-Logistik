import { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  userMessage: string;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  declare state: ErrorBoundaryState;
  declare props: Readonly<ErrorBoundaryProps>;

  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      userMessage: 'Terjadi kendala tak terduga saat memuat tampilan aplikasi.',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let friendly =
      'Terjadi kendala saat memproses permintaan. Silakan muat ulang halaman.';
    const raw = error?.message || '';
    if (raw.includes('Quota exceeded')) {
      friendly =
        'Batas kuota harian penyimpanan cloud telah tercapai dan akan disetel ulang besok.';
    } else if (raw.includes('Missing or insufficient permissions')) {
      friendly =
        'Akses ditolak oleh aturan keamanan data. Pastikan Anda masuk menggunakan akun Google Admin terverifikasi.';
    }
    return {
      hasError: true,
      userMessage: friendly,
    };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Application ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-slate-50 flex items-center justify-center p-6">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm text-center space-y-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-amber-50 text-amber-600">
              <AlertTriangle className="h-6 w-6" />
            </div>
            <div className="space-y-1.5">
              <h1 className="text-base font-semibold text-slate-900">
                CRK LOGISTIK DELIVERY SISTEM
              </h1>
              <p className="text-sm text-slate-600">{this.state.userMessage}</p>
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-sky-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-sky-800 transition-colors cursor-pointer"
            >
              <RefreshCw className="h-4 w-4" />
              Muat Ulang Aplikasi
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
