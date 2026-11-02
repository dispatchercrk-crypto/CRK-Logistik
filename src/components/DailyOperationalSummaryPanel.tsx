import React, { useMemo, useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  MessageSquare,
  Users,
} from 'lucide-react';
import {
  AppConfig,
  Assignment,
  DriverMaster,
  VehicleMaster,
  WhatsAppNotificationLog,
} from '../types';
import {
  buildDailyOperationalSummaryWaMessage,
  buildWhatsAppDirectUrl,
  buildWhatsAppGroupUrl,
  computeDailyOperationalSummary,
  getWibTodayYmd,
  launchWhatsAppUrl,
  shiftWibDateYmd,
} from '../utils/whatsapp';

interface DailyOperationalSummaryPanelProps {
  assignments: Assignment[];
  vehicles: VehicleMaster[];
  drivers: DriverMaster[];
  notifications: WhatsAppNotificationLog[];
  config: AppConfig;
  onCopyText: (text: string, label: string) => void;
  defaultShowPreview?: boolean;
}

export const DailyOperationalSummaryPanel: React.FC<
  DailyOperationalSummaryPanelProps
> = ({
  assignments,
  vehicles,
  drivers,
  notifications,
  config,
  onCopyText,
  defaultShowPreview = false,
}) => {
  const todayYmd = getWibTodayYmd();
  const yesterdayYmd = shiftWibDateYmd(todayYmd, -1);

  const [selectedDate, setSelectedDate] = useState<string>(todayYmd);
  const [showPreview, setShowPreview] = useState<boolean>(defaultShowPreview);

  const summary = useMemo(
    () =>
      computeDailyOperationalSummary(
        selectedDate,
        assignments,
        vehicles,
        drivers,
        notifications
      ),
    [selectedDate, assignments, vehicles, drivers, notifications]
  );

  const previewMessage = useMemo(
    () =>
      buildDailyOperationalSummaryWaMessage(
        summary,
        config.whatsappGroupName,
        new Date()
      ),
    [summary, config.whatsappGroupName]
  );

  const handleSendToGroup = () => {
    const freshMsg = buildDailyOperationalSummaryWaMessage(
      summary,
      config.whatsappGroupName,
      new Date()
    );
    launchWhatsAppUrl(buildWhatsAppGroupUrl(freshMsg));
  };

  const handleSendToDispatcher = () => {
    const freshMsg = buildDailyOperationalSummaryWaMessage(
      summary,
      config.whatsappGroupName,
      new Date()
    );
    launchWhatsAppUrl(
      buildWhatsAppDirectUrl(config.dispatcherWaPhone || '', freshMsg, false)
    );
  };

  const handleCopySummary = () => {
    const freshMsg = buildDailyOperationalSummaryWaMessage(
      summary,
      config.whatsappGroupName,
      new Date()
    );
    onCopyText(
      freshMsg,
      `Ringkasan Operasional Harian (${summary.dateYmd})`
    );
  };

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-5 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h2 className="text-base font-bold text-slate-900">
            Ringkasan Harian Performa Operasional Armada (WhatsApp)
          </h2>
          <p className="mt-1 text-xs sm:text-sm text-slate-600">
            Rangkuman otomatis penugasan harian, transisi waktu Keberangkatan →
            Delivered, utilitas muatan, dan kesiapan seluruh unit armada untuk
            dikirim 1-klik ke WhatsApp.
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
            <span className="font-medium text-slate-800">
              {summary.readableDate}
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Armada Aktif: {summary.activeFleetAssignedCount}/
              {summary.totalFleetUnits} Unit
            </span>
            <span aria-hidden="true">·</span>
            <span className="font-mono tabular-nums">
              Driver Bertugas: {summary.activeDriversAssignedCount}
            </span>
          </div>
        </div>

        {/* Date Filter Controls */}
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <div className="inline-flex items-center gap-1 rounded-lg bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setSelectedDate(todayYmd)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                selectedDate === todayYmd
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Hari Ini
            </button>
            <button
              type="button"
              onClick={() => setSelectedDate(yesterdayYmd)}
              className={`rounded-md px-2.5 py-1.5 text-xs font-semibold transition-colors ${
                selectedDate === yesterdayYmd
                  ? 'bg-white text-slate-900 shadow-sm'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              Kemarin
            </button>
          </div>

          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value || todayYmd)}
            aria-label="Pilih tanggal ringkasan operasional harian"
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 font-mono text-xs font-semibold text-slate-900 tabular-nums focus:border-slate-900 focus:outline-none"
          />
        </div>
      </div>

      {/* Daily Fleet Operational KPI Strip */}
      <div className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-5">
        <div className="bg-slate-50/70 p-4">
          <p className="text-[11px] font-medium text-slate-500">
            Penugasan Hari Itu
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {summary.totalAssignments}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
            Jalan {summary.perjalananCount} · Tunggu {summary.menungguCount}
          </p>
        </div>

        <div className="bg-slate-50/70 p-4">
          <p className="text-[11px] font-medium text-slate-500">
            Delivered &amp; Handover
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-emerald-700 tabular-nums">
            {summary.arrivedOrCompletedCount}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
            Delivered {summary.deliveredCount} · Selesai {summary.handoverCount}
          </p>
        </div>

        <div className="bg-slate-50/70 p-4">
          <p className="text-[11px] font-medium text-slate-500">
            Rata-Rata Berangkat → Delivered
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {summary.avgDepartToDeliveredText}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
            Jarak: {summary.totalDistanceKm.toLocaleString('id-ID')} km
          </p>
        </div>

        <div className="bg-slate-50/70 p-4">
          <p className="text-[11px] font-medium text-slate-500">
            Ketepatan Waktu (OTD)
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {summary.otdRatePct !== null ? `${summary.otdRatePct}%` : '—'}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
            {summary.otdEvaluatedCount > 0
              ? `${summary.otdOnTimeCount} tepat · ${summary.otdLateCount} terlambat`
              : 'Menunggu jadwal SLA'}
          </p>
        </div>

        <div className="col-span-2 bg-slate-50/70 p-4 sm:col-span-1">
          <p className="text-[11px] font-medium text-slate-500">
            Muatan &amp; Utilitas
          </p>
          <p className="mt-1 font-mono text-xl font-bold text-slate-900 tabular-nums">
            {summary.totalWeightDisplay}
          </p>
          <p className="mt-0.5 font-mono text-[11px] text-slate-500 tabular-nums">
            {summary.avgLoadUtilizationPct !== null
              ? `Utilitas rata-rata ${summary.avgLoadUtilizationPct}%`
              : `Siap jalan ${summary.readyUnitsCount} unit`}
          </p>
        </div>
      </div>

      {/* 1-Click WhatsApp Actions + Preview Toggle */}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleSendToGroup}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-700 whitespace-nowrap"
          >
            <Users className="h-3.5 w-3.5" />
            Kirim Ringkasan ke Grup WhatsApp
          </button>

          <button
            type="button"
            onClick={handleSendToDispatcher}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-300 bg-emerald-50 px-3.5 py-2 text-xs font-semibold text-emerald-900 transition-colors hover:bg-emerald-100 whitespace-nowrap"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Kirim ke WA Dispatcher
          </button>

          <button
            type="button"
            onClick={handleCopySummary}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-50 whitespace-nowrap"
          >
            <Copy className="h-3.5 w-3.5" />
            Salin Teks Ringkasan
          </button>
        </div>

        <button
          type="button"
          onClick={() => setShowPreview((prev) => !prev)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-700 transition-colors hover:bg-slate-100 whitespace-nowrap"
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {showPreview ? 'Sembunyikan Pratinjau WA' : 'Lihat Pratinjau WA'}
          {showPreview ? (
            <ChevronUp className="h-3.5 w-3.5" />
          ) : (
            <ChevronDown className="h-3.5 w-3.5" />
          )}
        </button>
      </div>

      {showPreview && (
        <div className="mt-4">
          <pre className="max-h-80 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800 whitespace-pre-wrap">
            {previewMessage}
          </pre>
        </div>
      )}
    </section>
  );
};
