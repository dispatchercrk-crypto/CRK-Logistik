import React, { useEffect, useMemo, useState } from 'react';
import { ImageOff, Printer, Snowflake, Truck, X } from 'lucide-react';
import { Assignment } from '../types';
import { readCachedAssignmentMediaFromVault } from '../services/persistentVault';
import {
  AssignmentPhotoSlotDescriptor,
  buildAssignmentPhotoDescriptors,
  buildMediaCandidateUrls,
} from './AssignmentPhotoGalleryModal';
import {
  calculateTripDurationMinutes,
  evaluateAssignmentOtd,
  formatDurationMinutes,
  formatRealTimeTimestamp,
  parseSuratJalanList,
} from '../utils/media';

interface PrintableAssignmentModalProps {
  assignment: Assignment | null;
  onClose: () => void;
}

interface PrintablePhotoFrameProps {
  assignmentId: string;
  slot: AssignmentPhotoSlotDescriptor;
}

const PrintablePhotoFrame: React.FC<PrintablePhotoFrameProps> = ({
  assignmentId,
  slot,
}) => {
  const candidates = useMemo(
    () =>
      buildMediaCandidateUrls({
        assignmentId,
        apiSlot: slot.apiSlot,
        primarySrc: slot.primarySrc,
        vaultSrc: slot.vaultSrc,
        driveUrl: slot.driveUrl,
        probeServerIfEmpty: slot.hasEvidenceSignal,
      }),
    [
      assignmentId,
      slot.apiSlot,
      slot.primarySrc,
      slot.vaultSrc,
      slot.driveUrl,
      slot.hasEvidenceSignal,
    ]
  );

  const candidateKey = candidates.join('|');
  const [candidateIdx, setCandidateIdx] = useState<number>(0);
  const [allFailed, setAllFailed] = useState<boolean>(false);

  useEffect(() => {
    setCandidateIdx(0);
    setAllFailed(false);
  }, [candidateKey]);

  const activeImgSrc =
    !allFailed && candidates[candidateIdx] ? candidates[candidateIdx] : '';

  const handleImgError = () => {
    if (candidateIdx + 1 < candidates.length) {
      setCandidateIdx((prev) => prev + 1);
    } else {
      setAllFailed(true);
    }
  };

  return (
    <div className="print-avoid-break flex flex-col overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="border-b border-slate-200 bg-slate-50 px-3 py-1.5 font-semibold text-slate-800">
        <span className="block truncate">{slot.title}</span>
      </div>
      <div className="relative flex h-48 items-center justify-center bg-white p-2">
        {activeImgSrc ? (
          <img
            src={activeImgSrc}
            alt={slot.title}
            loading="eager"
            decoding="sync"
            referrerPolicy="no-referrer"
            onError={handleImgError}
            className={`h-full w-full rounded ${
              slot.isSignature ? 'object-contain bg-white p-1.5' : 'object-contain'
            }`}
          />
        ) : candidates.length > 0 && allFailed ? (
          <div className="flex flex-col items-center gap-1.5 px-3 text-center text-slate-400">
            <ImageOff className="h-5 w-5 text-slate-400" />
            <span>Belum ada foto diunggah pada slot ini</span>
          </div>
        ) : (
          <span className="text-slate-400">Tidak ada lampiran foto</span>
        )}
      </div>
      <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-1.5 font-mono text-[10px] text-slate-600 tabular-nums">
        <span className="block truncate">{slot.caption}</span>
      </div>
    </div>
  );
};

export const PrintableAssignmentModal: React.FC<
  PrintableAssignmentModalProps
> = ({ assignment, onClose }) => {
  const [vaultMedia, setVaultMedia] = useState<Pick<
    Assignment,
    'departureData' | 'deliveredData' | 'handoverData'
  > | null>(null);

  useEffect(() => {
    if (!assignment?.id) {
      setVaultMedia(null);
      return;
    }
    let active = true;
    readCachedAssignmentMediaFromVault(assignment.id)
      .then((cached) => {
        if (active) setVaultMedia(cached);
      })
      .catch(() => {
        if (active) setVaultMedia(null);
      });
    return () => {
      active = false;
    };
  }, [assignment?.id]);

  if (!assignment) return null;

  const durationMins = calculateTripDurationMinutes(
    assignment.departureData?.timestamp,
    assignment.handoverData?.timestamp ||
      assignment.deliveredData?.timestamp ||
      assignment.deliveredAt
  );
  const otdEval = evaluateAssignmentOtd(assignment);

  const startKm = assignment.departureData?.kmAwal;
  const endKm =
    assignment.deliveredData?.kmSampai ?? assignment.handoverData?.kmAkhir;
  const distanceTraveled =
    startKm !== undefined && endKm !== undefined && endKm >= startKm
      ? endKm - startKm
      : null;

  const jenisKendaraan =
    assignment.deliveredData?.jenisKendaraan ||
    assignment.departureData?.jenisKendaraan ||
    'Mobil Pendingin';
  const isPendingin = jenisKendaraan !== 'Non Pendingin';
  const titikKeberangkatan =
    assignment.departureData?.titikKeberangkatan ||
    assignment.origin ||
    'Menunggu Titik Keberangkatan Driver';
  const sjList = parseSuratJalanList(assignment.noSuratJalanFisik);

  const mediaSlots = buildAssignmentPhotoDescriptors(assignment, vaultMedia);

  const handlePrintPdf = async () => {
    try {
      const imgs = Array.from(
        document.querySelectorAll<HTMLImageElement>(
          '#printable-assignment-sheet img'
        )
      );
      await Promise.allSettled(
        imgs.map((img) =>
          img.complete
            ? Promise.resolve()
            : typeof img.decode === 'function'
            ? img.decode()
            : new Promise<void>((resolve) => {
                img.addEventListener('load', () => resolve(), { once: true });
                img.addEventListener('error', () => resolve(), { once: true });
              })
        )
      );
    } catch {
      // Proceed to print even if decode settles with warning
    }
    window.print();
  };

  return (
    <div
      id="printable-report-overlay"
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-950/60 p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
    >
      <div
        id="printable-assignment-sheet"
        className="w-full max-w-4xl rounded-xl border border-slate-200 bg-white p-6 shadow-2xl sm:p-10"
      >
        {/* Top Action Bar (Hidden when printing) */}
        <div className="no-print mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="text-sm font-semibold text-slate-700">
            Pratinjau Laporan Cetak / PDF ({assignment.noPenugasan})
          </div>
          <div className="flex items-center gap-2.5">
            <button
              type="button"
              onClick={handlePrintPdf}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-xs font-semibold text-white hover:bg-slate-800 whitespace-nowrap"
            >
              <Printer className="h-4 w-4" />
              Cetak / Simpan PDF
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <X className="h-4 w-4" />
              Tutup
            </button>
          </div>
        </div>

        {/* Official Report Header */}
        <div className="flex flex-col justify-between gap-4 border-b-2 border-slate-900 pb-5 sm:flex-row sm:items-end">
          <div>
            <div className="flex items-center gap-2 text-xs font-bold tracking-wider text-sky-800">
              {isPendingin ? (
                <Snowflake className="h-4 w-4" />
              ) : (
                <Truck className="h-4 w-4" />
              )}
              <span>
                {isPendingin
                  ? 'COLD CHAIN LOGISTICS REPORT'
                  : 'FLEET DELIVERY & HANDOVER REPORT'}
              </span>
            </div>
            <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
              CRK LOGISTIK DELIVERY SISTEM
            </h1>
            <p className="mt-0.5 text-xs text-slate-600">
              {isPendingin
                ? 'Dokumen Resmi Surat Tugas, Monitoring Suhu & Berita Acara Serah Terima Rantai Pengiriman Dingin'
                : 'Dokumen Resmi Surat Tugas & Berita Acara Serah Terima Pengiriman Armada Non Pendingin'}
            </p>
          </div>

          <div className="text-left sm:text-right font-mono text-xs tabular-nums">
            <p className="font-bold text-slate-900">
              No. Penugasan: {assignment.noPenugasan}
            </p>
            <p className="mt-0.5 text-slate-600">
              Jadwal Tugas: {assignment.tanggalTugas}
              {assignment.jadwalJamTiba
                ? ` · Target ${assignment.jadwalJamTiba}`
                : ''}
            </p>
            <p className="mt-0.5 font-semibold text-slate-800">
              Status: {assignment.status}
              {otdEval.category === 'ON_TIME'
                ? ' · Tepat Waktu'
                : otdEval.category === 'LATE_COMPLETED'
                ? ` · Terlambat (+${formatDurationMinutes(otdEval.delayMinutes)})`
                : otdEval.category === 'OVERDUE_ACTIVE'
                ? ` · Lewat Jadwal (+${formatDurationMinutes(otdEval.delayMinutes)})`
                : ''}
            </p>
          </div>
        </div>

        {/* Section 1: Informasi Penugasan, Surat Jalan Fisik & Kode Segel */}
        <div className="print-avoid-break mt-6 grid grid-cols-1 gap-4 rounded-lg border border-slate-200 p-4 text-xs sm:grid-cols-3">
          <div>
            <p className="text-slate-500">
              No. Surat Jalan Fisik
              {sjList.length > 1 ? ` (${sjList.length} Dokumen)` : ''}
            </p>
            {sjList.length > 1 ? (
              <div className="mt-1 space-y-0.5 font-mono text-xs font-bold text-slate-900 tabular-nums">
                {sjList.map((sj, idx) => (
                  <p key={`${sj}-${idx}`}>
                    {idx + 1}. {sj}
                  </p>
                ))}
              </div>
            ) : (
              <p className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
                {sjList[0] || '-'}
              </p>
            )}
          </div>
          <div>
            <p className="text-slate-500">Kode Segel Kendaraan</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
              {assignment.kodeSegel || '-'}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Durasi Perjalanan Total</p>
            <p className="mt-0.5 font-mono text-sm font-bold text-slate-900 tabular-nums">
              {formatDurationMinutes(durationMins)}
            </p>
          </div>

          <div>
            <p className="text-slate-500">Driver Bertugas</p>
            <p className="mt-0.5 font-semibold text-slate-900">
              {assignment.driverName} ({assignment.driverId})
            </p>
            <p className="font-mono text-slate-600">
              {assignment.driverPhone || '-'}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Unit Armada</p>
            <p className="mt-0.5 font-mono font-semibold text-slate-900">
              {assignment.plateNumber}
            </p>
            <p className="text-slate-600">
              {assignment.vehicleType || '-'}
              {assignment.departureData ? ` · ${jenisKendaraan}` : ''}
            </p>
          </div>
          <div>
            <p className="text-slate-500">Muatan / Komoditas Pengiriman</p>
            <p className="mt-0.5 font-semibold text-slate-900">
              {assignment.purpose || '-'}
            </p>
            {(assignment.beratMuatan || assignment.volumeCbm) && (
              <p className="mt-0.5 font-mono text-slate-600 tabular-nums">
                {[
                  assignment.beratMuatan
                    ? `Berat: ${assignment.beratMuatan}`
                    : null,
                  assignment.volumeCbm
                    ? `Volume: ${assignment.volumeCbm}`
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>

          <div className="sm:col-span-3 border-t border-slate-200 pt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <p className="text-slate-500">Titik Keberangkatan Driver</p>
              <p className="mt-0.5 font-semibold text-slate-900">
                {titikKeberangkatan}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Lokasi Tujuan Pengiriman</p>
              <p className="mt-0.5 font-semibold text-slate-900">
                {assignment.destination}
              </p>
            </div>
          </div>

          {assignment.notes && (
            <div className="sm:col-span-3 border-t border-slate-200 pt-2">
              <p className="text-slate-500">Instruksi / Catatan Dispatcher:</p>
              <p className="mt-0.5 text-slate-800">{assignment.notes}</p>
            </div>
          )}
        </div>

        {/* Section 2: Log Timestamp Keberangkatan & Serah Terima */}
        <div className="print-avoid-break mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-lg border border-slate-200 p-4 text-xs">
            <h2 className="text-sm font-bold text-slate-900">
              01. Data Keberangkatan Driver
            </h2>
            {assignment.departureData ? (
              <dl className="mt-3 space-y-1.5">
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Timestamp Real-Time:</dt>
                  <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                    {formatRealTimeTimestamp(assignment.departureData.timestamp)}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Titik Keberangkatan:</dt>
                  <dd className="font-semibold text-slate-900 text-right">
                    {titikKeberangkatan}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Jenis Armada:</dt>
                  <dd className="font-semibold text-slate-900">
                    {jenisKendaraan}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Odometer KM Awal:</dt>
                  <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                    {assignment.departureData.kmAwal.toLocaleString('id-ID')} km
                  </dd>
                </div>
                {isPendingin && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Suhu Monitor Awal:</dt>
                    <dd className="font-mono font-semibold text-sky-800 tabular-nums">
                      {assignment.departureData.suhuAwal || '-'}
                    </dd>
                  </div>
                )}
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Posisi BBM Awal:</dt>
                  <dd className="text-slate-900">
                    {assignment.departureData.bbmAwal}
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-slate-500">Kondisi Unit:</dt>
                  <dd className="text-slate-900 text-right">
                    {assignment.departureData.kondisiKendaraan}
                  </dd>
                </div>
                <div className="pt-1 border-t border-slate-100">
                  <dt className="text-slate-500">Catatan Keberangkatan:</dt>
                  <dd className="mt-0.5 text-slate-800">
                    {assignment.departureData.catatanBerangkat || '-'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-slate-500">
                Belum ada laporan keberangkatan tercatat.
              </p>
            )}
          </div>

          <div className="rounded-lg border border-slate-200 p-4 text-xs">
            <h2 className="text-sm font-bold text-slate-900">
              02. Data Delivered (Sampai) &amp; Berita Acara Serah Terima
            </h2>
            {assignment.deliveredData || assignment.handoverData ? (
              <dl className="mt-3 space-y-1.5">
                {(assignment.deliveredData?.timestamp || assignment.deliveredAt) && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Waktu Sampai (Delivered):</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {formatRealTimeTimestamp(
                        assignment.deliveredData?.timestamp ||
                          assignment.deliveredAt ||
                          ''
                      )}
                    </dd>
                  </div>
                )}
                {endKm !== undefined && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Odometer KM Sampai:</dt>
                    <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                      {endKm.toLocaleString('id-ID')} km
                      {distanceTraveled !== null
                        ? ` (${distanceTraveled.toLocaleString('id-ID')} km)`
                        : ''}
                    </dd>
                  </div>
                )}
                {isPendingin && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Suhu Serah Sampai:</dt>
                    <dd className="font-mono font-semibold text-sky-800 tabular-nums">
                      {assignment.deliveredData?.suhuSampai ||
                        assignment.handoverData?.suhuAkhir ||
                        '-'}
                    </dd>
                  </div>
                )}
                {(assignment.deliveredData?.bbmSampai ||
                  assignment.handoverData?.bbmAkhir) && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">Posisi BBM Sampai:</dt>
                    <dd className="text-slate-900">
                      {assignment.deliveredData?.bbmSampai ||
                        assignment.handoverData?.bbmAkhir}
                    </dd>
                  </div>
                )}
                {(assignment.deliveredData?.kondisiSampai ||
                  assignment.handoverData?.kondisiAkhir) && (
                  <div className="flex justify-between gap-2">
                    <dt className="text-slate-500">
                      Kondisi Muatan &amp; Segel Sampai:
                    </dt>
                    <dd className="text-slate-900 text-right">
                      {assignment.deliveredData?.kondisiSampai ||
                        assignment.handoverData?.kondisiAkhir}
                    </dd>
                  </div>
                )}
                {assignment.handoverData && (
                  <>
                    <div className="pt-1.5 border-t border-slate-100 flex justify-between gap-2">
                      <dt className="text-slate-500">Waktu Serah Terima:</dt>
                      <dd className="font-mono font-semibold text-slate-900 tabular-nums">
                        {formatRealTimeTimestamp(
                          assignment.handoverData.timestamp
                        )}
                      </dd>
                    </div>
                    <div className="flex justify-between gap-2">
                      <dt className="text-slate-500">
                        Nama Penerima Serah Terima:
                      </dt>
                      <dd className="font-semibold text-slate-900">
                        {assignment.handoverData.penerimaNama || '-'}
                      </dd>
                    </div>
                  </>
                )}
                <div className="pt-1 border-t border-slate-100">
                  <dt className="text-slate-500">Catatan Serah Terima:</dt>
                  <dd className="mt-0.5 text-slate-800">
                    {assignment.handoverData?.catatanSerahTerima ||
                      assignment.deliveredData?.catatanSampai ||
                      '-'}
                  </dd>
                </div>
              </dl>
            ) : (
              <p className="mt-3 text-slate-500">
                Belum ada laporan Delivered (Sampai) maupun Berita Acara Serah
                Terima tercatat.
              </p>
            )}
          </div>
        </div>

        {/* Section 3: Dokumentasi Foto Odometer, Monitor Suhu, Bukti & Tanda Tangan */}
        <div className="mt-6">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-bold text-slate-900">
              03. Lampiran Foto Dokumentasi &amp; Tanda Tangan Penerima
            </h2>
          </div>

          <div
            className={`mt-3 grid grid-cols-2 gap-4 text-xs ${
              mediaSlots.length >= 6 || isPendingin
                ? 'sm:grid-cols-3'
                : 'sm:grid-cols-2'
            }`}
          >
            {mediaSlots.map((slot) => (
              <PrintablePhotoFrame
                key={slot.apiSlot}
                assignmentId={assignment.id}
                slot={slot}
              />
            ))}
          </div>
        </div>

        {/* Footer Sign-Off */}
        <div className="print-avoid-break mt-8 flex items-center justify-between border-t border-slate-200 pt-4 text-[11px] text-slate-500">
          <span>
            Dicetak melalui CRK LOGISTIK DELIVERY SISTEM pada{' '}
            {formatRealTimeTimestamp(new Date())}
          </span>
          {assignment.handoverData?.penerimaNama && (
            <span className="font-semibold text-slate-800">
              Diterima oleh: {assignment.handoverData.penerimaNama}
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
