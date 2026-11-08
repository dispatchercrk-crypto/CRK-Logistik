import React, { useMemo } from 'react';
import {
  CheckCircle2,
  Clock,
  Copy,
  Navigation,
  PackageCheck,
  Users,
  X,
} from 'lucide-react';
import { Assignment, WhatsAppNotificationLog } from '../types';
import {
  buildFleetStatusHistoryWaMessage,
  buildWhatsAppGroupUrl,
  launchWhatsAppUrl,
  resolveAssignmentStatusTimeline,
} from '../utils/whatsapp';

interface AssignmentStatusTimelineViewProps {
  assignment: Assignment;
  notifications: WhatsAppNotificationLog[];
  compact?: boolean;
}

export const AssignmentStatusTimelineView: React.FC<
  AssignmentStatusTimelineViewProps
> = ({ assignment, notifications, compact = false }) => {
  const [nowMs, setNowMs] = React.useState<number>(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const timeline = useMemo(
    () => resolveAssignmentStatusTimeline(assignment, notifications, nowMs),
    [assignment, notifications, nowMs]
  );

  return (
    <div className="space-y-4">
      {/* Summary Header Bar: Keberangkatan -> Delivered Transition Highlight */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 sm:grid-cols-3">
        <div className="bg-slate-50/90 px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">
            Waktu Keberangkatan
          </p>
          <p className="mt-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
            {timeline.stages[1]?.fullTimeText || '-'}
          </p>
        </div>

        <div className="bg-slate-50/90 px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">
            Waktu Tiba (Delivered)
          </p>
          <p className="mt-1 font-mono text-xs font-semibold text-slate-900 tabular-nums">
            {timeline.stages[2]?.fullTimeText || '-'}
          </p>
        </div>

        <div className="bg-slate-50/90 px-4 py-3">
          <p className="text-[11px] font-medium text-slate-500">
            Durasi Keberangkatan → Delivered
          </p>
          <p className="mt-1 font-mono text-xs font-bold text-slate-900 tabular-nums">
            {timeline.departToDeliveredText
              ? timeline.departToDeliveredText
              : timeline.liveInTransitText
              ? `${timeline.liveInTransitText} (Sedang Berjalan)`
              : 'Menunggu Transisi'}
          </p>
        </div>
      </div>

      {/* Vertical Fleet Status Timeline */}
      <div className="relative pl-1">
        {timeline.stages.map((stage, idx) => {
          const isLast = idx === timeline.stages.length - 1;
          const StageIcon =
            stage.key === 'DEPARTURE'
              ? Navigation
              : stage.key === 'DELIVERED'
              ? PackageCheck
              : stage.key === 'HANDOVER'
              ? CheckCircle2
              : Clock;

          return (
            <div
              key={stage.key}
              className={`relative flex gap-3.5 ${isLast ? '' : 'pb-5'}`}
            >
              {!isLast && (
                <div
                  aria-hidden="true"
                  className={`absolute left-[13px] top-7 bottom-0 w-px ${
                    stage.reached ? 'bg-slate-400' : 'bg-slate-200'
                  }`}
                />
              )}

              <div
                className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border ${
                  stage.isCurrent
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : stage.reached
                    ? 'border-emerald-600 bg-emerald-50 text-emerald-700'
                    : 'border-slate-200 bg-white text-slate-400'
                }`}
              >
                <StageIcon className="h-3.5 w-3.5" />
              </div>

              <div className="min-w-0 flex-1 pt-0.5">
                <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:justify-between sm:gap-3">
                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="font-mono font-semibold text-slate-400 tabular-nums">
                      {stage.stepNumber}.
                    </span>
                    <span
                      className={`font-semibold ${
                        stage.reached ? 'text-slate-900' : 'text-slate-400'
                      }`}
                    >
                      {stage.title}
                    </span>
                    <span aria-hidden="true" className="text-slate-300">
                      ·
                    </span>
                    <span
                      className={`font-medium ${
                        stage.isCurrent
                          ? 'text-sky-800'
                          : stage.reached
                          ? 'text-emerald-700'
                          : 'text-slate-400'
                      }`}
                    >
                      {stage.statusLabel}
                    </span>
                  </div>

                  <span
                    className={`font-mono text-xs tabular-nums ${
                      stage.reached
                        ? 'font-semibold text-slate-800'
                        : 'text-slate-400'
                    }`}
                  >
                    {stage.fullTimeText}
                  </span>
                </div>

                <p className="mt-0.5 text-xs text-slate-600">{stage.subtitle}</p>

                {stage.elapsedFromPreviousText && (
                  <p className="mt-1 font-mono text-[11px] font-semibold text-sky-800 tabular-nums">
                    {stage.elapsedFromPreviousText}
                  </p>
                )}

                {!compact && stage.metrics.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-slate-500">
                    {stage.metrics.map((metric, mIdx) => (
                      <React.Fragment key={`${stage.key}-${mIdx}`}>
                        {mIdx > 0 && <span aria-hidden="true">·</span>}
                        <span className="font-mono tabular-nums">{metric}</span>
                      </React.Fragment>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

interface FleetStatusHistoryModalProps {
  assignment: Assignment | null;
  notifications: WhatsAppNotificationLog[];
  groupName?: string;
  onCopyText: (text: string, label: string) => void;
  onClose: () => void;
  isReadOnlyView?: boolean;
}

export const FleetStatusHistoryModal: React.FC<
  FleetStatusHistoryModalProps
> = ({ assignment, notifications, groupName, onCopyText, onClose, isReadOnlyView = false }) => {
  if (!assignment) return null;

  const waMessage = buildFleetStatusHistoryWaMessage(
    assignment,
    notifications,
    groupName
  );
  const displayOrigin =
    assignment.departureData?.titikKeberangkatan || assignment.origin;

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-950/50 p-0 backdrop-blur-[1px] sm:items-center sm:p-4">
      <div className="sheet-enter max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-slate-200 bg-white p-5 pb-safe shadow-2xl sm:rounded-2xl sm:p-6">
        <div className="mx-auto mb-3 h-1.5 w-11 rounded-full bg-slate-300 sm:hidden" />
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 pb-4">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900">
              Riwayat Status Armada
            </h3>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-slate-600">
              <span className="font-mono font-semibold text-slate-900 tabular-nums">
                {assignment.noPenugasan}
              </span>
              <span aria-hidden="true">·</span>
              <span className="font-mono font-semibold text-slate-800">
                {assignment.plateNumber}
              </span>
              <span aria-hidden="true">·</span>
              <span>
                {assignment.driverId} - {assignment.driverName}
              </span>
            </div>
            <p className="mt-0.5 truncate text-xs text-slate-500">
              {displayOrigin} → {assignment.destination}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            aria-label="Tutup riwayat status armada"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5">
          <AssignmentStatusTimelineView
            assignment={assignment}
            notifications={notifications}
          />
        </div>

        <div className="mt-6 flex flex-col gap-2.5 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {!isReadOnlyView && (
              <button
                type="button"
                onClick={() =>
                  launchWhatsAppUrl(buildWhatsAppGroupUrl(waMessage))
                }
                className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-semibold text-white hover:bg-emerald-700 sm:min-h-0 sm:rounded-lg"
              >
                <Users className="h-3.5 w-3.5 shrink-0" />
                Kirim ke Grup WA
              </button>
            )}
            <button
              type="button"
              onClick={() =>
                onCopyText(
                  waMessage,
                  `Riwayat Status Armada (${assignment.noPenugasan})`
                )
              }
              className="inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 sm:min-h-0 sm:rounded-lg"
            >
              <Copy className="h-3.5 w-3.5 shrink-0" />
              Salin Timeline
            </button>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="min-h-[42px] w-full rounded-xl bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 sm:min-h-0 sm:w-auto sm:rounded-lg"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
};
