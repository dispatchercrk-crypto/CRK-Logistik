import React, { useEffect, useMemo, useState } from 'react';
import {
  ChevronDown,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  LogIn,
  ShieldCheck,
  Snowflake,
  Truck,
} from 'lucide-react';
import { User } from 'firebase/auth';
import {
  AppConfig,
  Assignment,
  DriverMaster,
  isActiveTaskStatus,
  UserRole,
  VehicleMaster,
} from '../types';
import { PWAInstallButton } from './PWAInstallButton';
import { EmbeddedDriverSnapshot } from '../utils/driverLink';
import { safeApiFetch } from '../utils/safeFetchJson';
import coldChainHeroImg from '../assets/images/crk_cold_chain_fleet_1792968127070.jpg';

const VERIFIED_ADMIN_DISPATCHER_EMAIL = 'dispatchercrk@gmail.com';

interface LoginPageProps {
  drivers: DriverMaster[];
  vehicles: VehicleMaster[];
  assignments: Assignment[];
  config: AppConfig;
  googleUser: User | null;
  hasGoogleToken: boolean;
  isSyncing: boolean;
  initialDriverMode?: boolean;
  initialDriverId?: string;
  initialTaskKey?: string;
  embeddedDriver?: EmbeddedDriverSnapshot;
  onRefreshSync: () => Promise<void>;
  onGoogleLogin: () => Promise<void>;
  onDriverLoginSuccess: (driver: DriverMaster) => void;
  onAdminLoginSuccess: () => void;
}

export const LoginPage: React.FC<LoginPageProps> = ({
  drivers,
  vehicles,
  assignments,
  config,
  googleUser,
  initialDriverMode = false,
  initialDriverId = '',
  initialTaskKey = '',
  embeddedDriver,
  onDriverLoginSuccess,
  onAdminLoginSuccess,
}) => {
  const isVerifiedAdminGoogleSession = Boolean(
    googleUser?.email &&
      googleUser.emailVerified &&
      googleUser.email.trim().toLowerCase() === VERIFIED_ADMIN_DISPATCHER_EMAIL
  );

  const [selectedRole, setSelectedRole] = useState<UserRole>(() =>
    !initialDriverMode && isVerifiedAdminGoogleSession
      ? UserRole.ADMIN
      : UserRole.DRIVER
  );
  const [driverOnlyView, setDriverOnlyView] =
    useState<boolean>(initialDriverMode);
  const [selectedDriverId, setSelectedDriverId] = useState<string>('');
  const [driverPin, setDriverPin] = useState<string>('');
  const [adminPin, setAdminPin] = useState<string>('');
  const [showPin, setShowPin] = useState<boolean>(false);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string>('');
  const [imgError, setImgError] = useState<boolean>(false);
  const isDirectInstallLink = useMemo(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).get('install') === '1';
  }, []);

  useEffect(() => {
    if (!driverOnlyView && isVerifiedAdminGoogleSession && !selectedDriverId) {
      setSelectedRole(UserRole.ADMIN);
    }
  }, [driverOnlyView, isVerifiedAdminGoogleSession, selectedDriverId]);

  const activeDrivers = useMemo(() => {
    const list = [...drivers].filter((d) => d.active !== false);
    if (
      embeddedDriver?.id &&
      !list.some(
        (d) => d.id.trim().toLowerCase() === embeddedDriver.id.trim().toLowerCase()
      )
    ) {
      list.push({
        id: embeddedDriver.id,
        name: embeddedDriver.name,
        phone: embeddedDriver.phone || '',
        pin: '',
        licenseType: embeddedDriver.licenseType || '',
        active: true,
      });
    }
    return list.sort((a, b) => a.id.localeCompare(b.id, 'id', { numeric: true }));
  }, [drivers, embeddedDriver]);

  const linkedAssignment = useMemo(() => {
    if (!initialTaskKey.trim()) return null;
    const norm = initialTaskKey.trim().toLowerCase();
    return (
      assignments.find(
        (a) =>
          a.noPenugasan.trim().toLowerCase() === norm ||
          a.id.trim().toLowerCase() === norm
      ) || null
    );
  }, [assignments, initialTaskKey]);

  // Pre-select Driver ID automatically when opened via Link Khusus Driver
  useEffect(() => {
    if (selectedDriverId) return;
    const candidateId =
      initialDriverId.trim() || linkedAssignment?.driverId?.trim() || '';
    if (!candidateId || activeDrivers.length === 0) return;
    const matched = activeDrivers.find(
      (d) => d.id.trim().toLowerCase() === candidateId.toLowerCase()
    );
    if (matched) {
      setSelectedDriverId(matched.id);
      setSelectedRole(UserRole.DRIVER);
    }
  }, [
    activeDrivers,
    initialDriverId,
    linkedAssignment,
    selectedDriverId,
  ]);

  const selectedDriverObj = useMemo(
    () => activeDrivers.find((d) => d.id === selectedDriverId) || null,
    [activeDrivers, selectedDriverId]
  );

  const activeTripsCount = useMemo(
    () => assignments.filter((a) => isActiveTaskStatus(a.status)).length,
    [assignments]
  );

  const handleDriverSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    if (!selectedDriverId) {
      setErrorMessage('Pilih ID Driver dari daftar dropdown terlebih dahulu.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await safeApiFetch<{ driver?: DriverMaster; error?: string }>(
        '/api/auth/driver',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            driverId: selectedDriverId.trim(),
            pin: driverPin.trim(),
            driverSnapshot: selectedDriverObj || undefined,
          }),
        }
      );

      if (res.ok && res.data?.driver) {
        onDriverLoginSuccess(res.data.driver);
        return;
      }

      if ((res.isHtmlResponse || res.networkFailed) && selectedDriverObj) {
        const expectedPin = String(selectedDriverObj.pin || '').trim();
        const enteredPin = driverPin.trim();
        if (
          !expectedPin ||
          expectedPin === enteredPin ||
          expectedPin.replace(/^0+/, '') === enteredPin.replace(/^0+/, '')
        ) {
          onDriverLoginSuccess(selectedDriverObj);
          return;
        }
        setErrorMessage(
          'PIN Driver tidak sesuai. Pastikan angka PIN benar atau hubungi Admin Dispatcher.'
        );
        return;
      }

      setErrorMessage(res.errorMessage || 'Gagal masuk sebagai Driver.');
    } catch {
      setErrorMessage(
        'Gagal menghubungi server. Periksa koneksi jaringan Anda.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleAdminSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');

    const enteredPin = adminPin.trim();
    if (!enteredPin) {
      setErrorMessage('Masukkan PIN Admin Dispatcher.');
      return;
    }

    setSubmitting(true);
    try {
      const res = await safeApiFetch<{
        success?: boolean;
        isDefaultPin?: boolean;
        error?: string;
      }>('/api/auth/admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: enteredPin }),
      });

      if (res.ok && res.data?.success) {
        onAdminLoginSuccess();
        return;
      }

      if (res.isHtmlResponse || res.networkFailed) {
        const savedCustomPin =
          typeof window !== 'undefined'
            ? (
                window.localStorage.getItem('crk_custom_admin_pin') || ''
              ).trim()
            : '';
        const expectedFallbackPin =
          savedCustomPin.length >= 4 && savedCustomPin !== '123456'
            ? savedCustomPin
            : config.isDefaultPin
            ? '123456'
            : '';
        if (expectedFallbackPin && enteredPin === expectedFallbackPin) {
          onAdminLoginSuccess();
          return;
        }
      }

      setErrorMessage(res.errorMessage || 'PIN Admin Dispatcher salah.');
    } catch {
      setErrorMessage(
        'Gagal menghubungi server. Periksa koneksi jaringan Anda.'
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Clean Single-Row Top Bar (3-Zone Contract) */}
      <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200/90 bg-white/92 px-4 py-3 backdrop-blur-md sm:gap-8 sm:px-6 sm:py-4">
        <div className="flex min-w-0 items-center gap-2">
          <Snowflake className="h-4 w-4 shrink-0 text-sky-700" />
          <span className="truncate text-sm font-bold tracking-tight text-slate-900 sm:text-base">
            CRK LOGISTIK{' '}
            <span className="hidden sm:inline">DELIVERY SISTEM</span>
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <PWAInstallButton
            compact
            showAlways
            label="Instal Aplikasi ke HP"
            compactLabel="Instal ke HP"
          />
        </div>
      </header>

      {/* Main Split Viewport */}
      <main className="mx-auto grid w-full max-w-7xl flex-1 grid-cols-1 items-stretch gap-4 px-4 py-4 sm:gap-8 sm:px-6 sm:py-8 lg:grid-cols-12 lg:py-12">
        {/* Compact Mobile Cold Chain Hero Card (Visible on Mobile & Tablet < lg) */}
        <section className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 p-4 sm:p-5 text-white shadow-sm lg:hidden">
          {!imgError ? (
            <img
              src={coldChainHeroImg}
              alt="Armada truk berpendingin CRK Logistik Delivery Sistem"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-sky-950 via-slate-900 to-slate-950" />
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/75 to-slate-900/40" />

          <div className="relative z-10">
            <p className="inline-flex items-center gap-1.5 text-[11px] font-semibold tracking-wide text-sky-200">
              <Snowflake className="h-3.5 w-3.5" />
              <span>Manajemen Rantai Pengiriman Dingin</span>
            </p>
            <h1 className="mt-1 text-lg font-bold tracking-tight text-white sm:text-xl">
              CRK LOGISTIK DELIVERY SISTEM
            </h1>
            <div className="mt-3.5 grid grid-cols-3 gap-3 border-t border-white/15 pt-3">
              <div>
                <p className="text-[11px] text-slate-300">Driver Aktif</p>
                <p className="mt-0.5 font-mono text-base font-bold text-white tabular-nums">
                  {activeDrivers.length}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-300">Armada Reefer</p>
                <p className="mt-0.5 font-mono text-base font-bold text-white tabular-nums">
                  {vehicles.length}
                </p>
              </div>
              <div>
                <p className="text-[11px] text-slate-300">Tugas Jalan</p>
                <p className="mt-0.5 font-mono text-base font-bold text-white tabular-nums">
                  {activeTripsCount}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Left Cold Chain Fleet Visual & Operational Context (Desktop >= lg) */}
        <section className="relative hidden overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 lg:col-span-6 lg:flex lg:flex-col lg:justify-between">
          {!imgError ? (
            <img
              src={coldChainHeroImg}
              alt="Armada truk berpendingin CRK Logistik Delivery Sistem di fasilitas Cold Storage"
              referrerPolicy="no-referrer"
              onError={() => setImgError(true)}
              className="absolute inset-0 h-full w-full object-cover"
            />
          ) : (
            <div className="absolute inset-0 bg-gradient-to-br from-sky-950 via-slate-900 to-slate-950" />
          )}

          {/* Measured Contrast Scrim */}
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/95 via-slate-950/60 to-slate-900/25" />

          <div className="relative z-10 p-8">
            <p className="inline-flex items-center gap-2 text-xs font-semibold tracking-wide text-sky-200">
              <Snowflake className="h-4 w-4" />
              <span>Sistem Manajemen Rantai Pengiriman Dingin (Cold Chain)</span>
            </p>
          </div>

          <div className="relative z-10 p-8 pt-16">
            <h1 className="max-w-lg text-3xl font-bold leading-tight tracking-tight text-white">
              CRK LOGISTIK DELIVERY SISTEM
            </h1>
            <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-200">
              Monitoring terpadu keberangkatan armada reefer, foto monitor suhu,
              odometer, kode segel, tanda tangan digital serah terima, dan
              sinkronisasi otomatis Google Sheets.
            </p>

            {/* Real Synced Metrics Strip */}
            <div className="mt-8 grid grid-cols-3 gap-6 border-t border-white/15 pt-6">
              <div>
                <p className="text-xs text-slate-300">Driver Aktif</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-white tabular-nums">
                  {activeDrivers.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-300">Armada Reefer</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-white tabular-nums">
                  {vehicles.length}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-300">Pengiriman Aktif</p>
                <p className="mt-1 font-mono text-2xl font-semibold text-white tabular-nums">
                  {activeTripsCount}
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Right Login Form Workspace */}
        <section className="flex flex-col justify-center lg:col-span-6">
          <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200/90 bg-white p-5 shadow-xs sm:p-8">
            {isDirectInstallLink && (
              <div className="mb-5">
                <PWAInstallButton variant="store-card" highlighted showAlways />
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-sky-800">
                {driverOnlyView
                  ? 'Portal Akses Khusus Driver · CRK Logistik'
                  : 'Aplikasi Rantai Pengiriman Dingin'}
              </p>
              <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
                {driverOnlyView
                  ? 'Masuk Portal Driver'
                  : 'Masuk ke Sistem Operasional'}
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-slate-600 sm:text-sm">
                {driverOnlyView
                  ? 'Pilih ID Driver Anda untuk melaporkan Keberangkatan, Konfirmasi Delivered, dan Serah Terima.'
                  : 'Pilih peran akses Anda pada CRK LOGISTIK DELIVERY SISTEM.'}
              </p>
            </div>

            {linkedAssignment && selectedRole === UserRole.DRIVER && (
              <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/80 px-4 py-3 text-xs text-slate-700">
                <div className="flex items-center gap-1.5 font-semibold text-sky-950">
                  <Link2 className="h-3.5 w-3.5 shrink-0 text-sky-700" />
                  <span>
                    Link Surat Tugas: {linkedAssignment.noPenugasan}
                  </span>
                </div>
                <p className="mt-1 text-slate-700">
                  Armada{' '}
                  <strong className="font-mono font-semibold text-slate-900">
                    {linkedAssignment.plateNumber}
                  </strong>{' '}
                  · Tujuan:{' '}
                  <strong className="font-semibold text-slate-900">
                    {linkedAssignment.destination}
                  </strong>
                </p>
              </div>
            )}

            {/* Segmented Role Switcher (hidden by default when opened via Link Khusus Driver) */}
            {!driverOnlyView && (
              <div className="mt-5 grid grid-cols-2 gap-1.5 rounded-xl bg-slate-100 p-1.5 sm:mt-6">
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRole(UserRole.DRIVER);
                    setErrorMessage('');
                  }}
                  className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 sm:px-4 sm:text-sm ${
                    selectedRole === UserRole.DRIVER
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Truck className="h-4 w-4 shrink-0" />
                  Role Driver
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedRole(UserRole.ADMIN);
                    setErrorMessage('');
                  }}
                  className={`flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 sm:px-4 sm:text-sm ${
                    selectedRole === UserRole.ADMIN
                      ? 'bg-white text-slate-900 shadow-xs'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  Admin Dispatcher
                </button>
              </div>
            )}

            {errorMessage && (
              <div
                role="alert"
                className="mt-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-xs font-medium text-red-700 sm:text-sm"
              >
                {errorMessage}
              </div>
            )}

            {/* DRIVER LOGIN FORM */}
            {selectedRole === UserRole.DRIVER ? (
              <form onSubmit={handleDriverSubmit} className="mt-5 space-y-4 sm:mt-6 sm:space-y-5">
                <div>
                  <div>
                    <label
                      htmlFor="driver-id-select"
                      className="block text-sm font-semibold text-slate-800"
                    >
                      ID Driver
                    </label>
                  </div>

                  <div className="relative mt-1.5">
                    <select
                      id="driver-id-select"
                      value={selectedDriverId}
                      onChange={(e) => {
                        setSelectedDriverId(e.target.value);
                        setErrorMessage('');
                      }}
                      className="min-h-[46px] w-full appearance-none rounded-xl border border-slate-300 bg-white py-2.5 pl-3.5 pr-10 text-sm font-medium text-slate-900 transition-colors focus:border-slate-900 focus:outline-none"
                    >
                      <option value="">
                        {activeDrivers.length > 0
                          ? '-- Pilih ID Driver --'
                          : '-- Belum ada data Master Driver --'}
                      </option>
                      {activeDrivers.map((drv) => (
                        <option key={drv.id} value={drv.id}>
                          {drv.id} — {drv.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
                  </div>

                  {activeDrivers.length === 0 && (
                    <p className="mt-2 text-xs leading-relaxed text-amber-700">
                      Data Master Driver masih kosong (tanpa data dummy). Masuk
                      ke{' '}
                      <button
                        type="button"
                        onClick={() => {
                          setDriverOnlyView(false);
                          setSelectedRole(UserRole.ADMIN);
                        }}
                        className="font-semibold underline hover:text-amber-900"
                      >
                        Admin Dispatcher
                      </button>{' '}
                      untuk menghubungkan Google Sheets atau menambahkan Master
                      Driver.
                    </p>
                  )}

                  {selectedDriverObj && (
                    <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-slate-600">
                      <span className="font-semibold text-slate-900">
                        {selectedDriverObj.name}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span className="font-mono tabular-nums">
                        {selectedDriverObj.id}
                      </span>
                      <span aria-hidden="true">·</span>
                      <span>{selectedDriverObj.licenseType}</span>
                      {!selectedDriverObj.pin && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="text-emerald-700">
                            Tanpa PIN (langsung masuk)
                          </span>
                        </>
                      )}
                    </div>
                  )}
                </div>

                <div>
                  <label
                    htmlFor="driver-pin-input"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    PIN Driver{' '}
                    {selectedDriverObj && !selectedDriverObj.pin && (
                      <span className="font-normal text-slate-500">
                        (Opsional)
                      </span>
                    )}
                  </label>
                  <div className="relative mt-1.5">
                    <input
                      id="driver-pin-input"
                      type={showPin ? 'text' : 'password'}
                      inputMode="numeric"
                      autoComplete="off"
                      value={driverPin}
                      onChange={(e) => setDriverPin(e.target.value)}
                      placeholder={
                        selectedDriverObj && !selectedDriverObj.pin
                          ? 'PIN tidak disetel — langsung tekan Masuk'
                          : 'Masukkan PIN Driver Anda'
                      }
                      className="min-h-[46px] w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-3.5 pr-11 font-mono text-sm text-slate-900 tabular-nums transition-colors focus:border-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin((prev) => !prev)}
                      className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    >
                      {showPin ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || activeDrivers.length === 0}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <LogIn className="h-4 w-4 shrink-0" />
                  {submitting
                    ? 'Memverifikasi Akses...'
                    : 'Masuk sebagai Driver'}
                </button>

                {driverOnlyView && (
                  <div className="pt-1 text-center">
                    <button
                      type="button"
                      onClick={() => {
                        setDriverOnlyView(false);
                        setSelectedRole(UserRole.ADMIN);
                        setErrorMessage('');
                      }}
                      className="min-h-[36px] text-xs font-medium text-slate-500 underline-offset-4 hover:text-slate-900 hover:underline"
                    >
                      Bukan Driver? Masuk sebagai Admin Dispatcher
                    </button>
                  </div>
                )}
              </form>
            ) : (
              /* ADMIN DISPATCHER LOGIN FORM */
              <form onSubmit={handleAdminSubmit} className="mt-5 space-y-4 sm:mt-6 sm:space-y-5">
                <div>
                  <label
                    htmlFor="admin-pin-input"
                    className="block text-sm font-semibold text-slate-800"
                  >
                    PIN Admin Dispatcher
                  </label>
                  <div className="relative mt-1.5">
                    <KeyRound className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                    <input
                      id="admin-pin-input"
                      type={showPin ? 'text' : 'password'}
                      inputMode="numeric"
                      autoComplete="off"
                      value={adminPin}
                      onChange={(e) => setAdminPin(e.target.value)}
                      placeholder="Masukkan PIN Admin Dispatcher"
                      className="min-h-[46px] w-full rounded-xl border border-slate-300 bg-white py-2.5 pl-10 pr-11 font-mono text-sm text-slate-900 tabular-nums transition-colors focus:border-slate-900 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin((prev) => !prev)}
                      className="absolute right-2 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                      aria-label={showPin ? 'Sembunyikan PIN' : 'Tampilkan PIN'}
                    >
                      {showPin ? (
                        <EyeOff className="h-4 w-4" />
                      ) : (
                        <Eye className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                  {config.isDefaultPin && (
                    <p className="mt-2 text-xs text-slate-500">
                      PIN awal standar:{' '}
                      <span className="font-mono font-semibold text-slate-800 tabular-nums">
                        123456
                      </span>
                      . Anda dapat mengubah PIN sendiri setelah masuk.
                    </p>
                  )}
                </div>

                <button
                  type="submit"
                  disabled={submitting}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-slate-800 disabled:opacity-50"
                >
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  {submitting
                    ? 'Memverifikasi PIN...'
                    : 'Masuk Portal Dispatcher'}
                </button>
              </form>
            )}

            {!isDirectInstallLink && (
              <div className="mt-5 border-t border-slate-200/90 pt-4 space-y-2">
                <PWAInstallButton variant="store-card" showAlways />
              </div>
            )}
          </div>
        </section>
      </main>
    </div>
  );
};
