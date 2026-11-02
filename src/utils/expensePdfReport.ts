import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { DriverExpense, FleetCardMaster } from '../types';
import { formatRealTimeTimestamp } from './media';

export type ExpensePdfPeriodMode = 'DAILY' | 'MONTHLY';

const MONTH_NAMES_ID = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

function formatIdrPlain(value: number): string {
  const safe = Number.isFinite(value) ? Math.round(value) : 0;
  const absFormatted = new Intl.NumberFormat('id-ID').format(Math.abs(safe));
  return safe < 0 ? `-Rp ${absFormatted}` : `Rp ${absFormatted}`;
}

export function normalizeCardKey(val: string | undefined): string {
  return String(val || '')
    .trim()
    .replace(/[\s-]+/g, '')
    .toUpperCase();
}

export function resolveExpenseEffectiveDate(exp: DriverExpense): string {
  const raw =
    exp.tanggalPengiriman || exp.tanggal || exp.timestamp || '';
  const trimmed = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    return trimmed.slice(0, 10);
  }
  const parsed = new Date(trimmed);
  if (!Number.isNaN(parsed.getTime())) {
    try {
      return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Asia/Jakarta',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(parsed);
    } catch {
      return parsed.toISOString().slice(0, 10);
    }
  }
  return '';
}

export function formatIndonesianDateLabel(ymd: string): string {
  const m = String(ymd || '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return ymd || '-';
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const day = parseInt(m[3], 10);
  const monthName = MONTH_NAMES_ID[monthIdx] || m[2];
  return `${day} ${monthName} ${year}`;
}

export function formatIndonesianMonthLabel(ym: string): string {
  const m = String(ym || '')
    .trim()
    .match(/^(\d{4})-(\d{2})$/);
  if (!m) return ym || '-';
  const year = m[1];
  const monthIdx = parseInt(m[2], 10) - 1;
  const monthName = MONTH_NAMES_ID[monthIdx] || m[2];
  return `${monthName} ${year}`;
}

export function filterDriverExpensesForPdf(
  expenses: DriverExpense[],
  options: {
    periodMode: ExpensePdfPeriodMode;
    selectedDate: string;
    selectedMonth: string;
    fleetCardFilter: string;
  }
): DriverExpense[] {
  const normCardFilter =
    options.fleetCardFilter && options.fleetCardFilter !== 'ALL'
      ? normalizeCardKey(options.fleetCardFilter)
      : '';

  return [...expenses]
    .filter((exp) => {
      if (normCardFilter) {
        const expCardNorm = normalizeCardKey(exp.fleetCardNumber);
        const expIdNorm = normalizeCardKey(exp.fleetCardId);
        if (expCardNorm !== normCardFilter && expIdNorm !== normCardFilter) {
          return false;
        }
      }

      const effDate = resolveExpenseEffectiveDate(exp);
      const reportDate = String(exp.tanggal || '').trim().slice(0, 10);

      if (options.periodMode === 'DAILY') {
        if (!options.selectedDate) return true;
        return (
          effDate === options.selectedDate ||
          (!exp.tanggalPengiriman && reportDate === options.selectedDate)
        );
      }

      if (!options.selectedMonth) return true;
      return (
        effDate.startsWith(options.selectedMonth) ||
        (!exp.tanggalPengiriman && reportDate.startsWith(options.selectedMonth))
      );
    })
    .sort(
      (a, b) =>
        new Date(a.timestamp || a.tanggal).getTime() -
        new Date(b.timestamp || b.tanggal).getTime()
    );
}

export function downloadFleetCardExpensePdfReport(params: {
  expenses: DriverExpense[];
  fleetCards: FleetCardMaster[];
  periodMode: ExpensePdfPeriodMode;
  selectedDate: string;
  selectedMonth: string;
  fleetCardFilter: string;
}): { rowCount: number; fileName: string } {
  const filtered = filterDriverExpensesForPdf(params.expenses, {
    periodMode: params.periodMode,
    selectedDate: params.selectedDate,
    selectedMonth: params.selectedMonth,
    fleetCardFilter: params.fleetCardFilter,
  });

  const matchedMasterCard =
    params.fleetCardFilter !== 'ALL'
      ? params.fleetCards.find(
          (fc) =>
            normalizeCardKey(fc.cardNumber) ===
              normalizeCardKey(params.fleetCardFilter) ||
            normalizeCardKey(fc.id) === normalizeCardKey(params.fleetCardFilter)
        ) || null
      : null;

  const totalBbm = filtered.reduce(
    (sum, e) => sum + (Math.round(Number(e.totalPengirimanBbm)) || 0),
    0
  );
  const totalTol = filtered.reduce(
    (sum, e) => sum + (Math.round(Number(e.totalPengeluaranTol)) || 0),
    0
  );
  const grandTotal = filtered.reduce((sum, e) => {
    const rowTot =
      Number.isFinite(e.totalPengeluaran) && e.totalPengeluaran > 0
        ? Math.round(e.totalPengeluaran)
        : (Math.round(Number(e.totalPengirimanBbm)) || 0) +
          (Math.round(Number(e.totalPengeluaranTol)) || 0);
    return sum + rowTot;
  }, 0);

  const periodTitle =
    params.periodMode === 'DAILY' ? 'HARIAN' : 'BULANAN';
  const periodLabel =
    params.periodMode === 'DAILY'
      ? formatIndonesianDateLabel(params.selectedDate)
      : formatIndonesianMonthLabel(params.selectedMonth);
  const cardFilterLabel =
    params.fleetCardFilter === 'ALL'
      ? `Semua Nomor Kartu Fleet Card (${params.fleetCards.length} Kartu Master)`
      : matchedMasterCard
      ? `${matchedMasterCard.cardNumber} (ID: ${matchedMasterCard.id})`
      : params.fleetCardFilter;

  const currentBalanceLabel =
    params.fleetCardFilter === 'ALL'
      ? formatIdrPlain(
          params.fleetCards.reduce(
            (acc, fc) => acc + (Number(fc.balance) || 0),
            0
          )
        )
      : matchedMasterCard
      ? formatIdrPlain(matchedMasterCard.balance)
      : '-';

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 12;

  // Header Banner
  doc.setFillColor(15, 23, 42); // slate-900
  doc.rect(0, 0, pageWidth, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('CRK LOGISTIK DELIVERY SISTEM', marginX, 11);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.setTextColor(203, 213, 225);
  doc.text(
    `LAPORAN DETAIL PENGELUARAN ${periodTitle} DRIVER — FILTER NOMOR KARTU FLEET CARD`,
    marginX,
    18
  );

  const printedAtWib = formatRealTimeTimestamp(new Date());
  doc.setFontSize(8.5);
  doc.text(`Dicetak: ${printedAtWib}`, pageWidth - marginX, 11, {
    align: 'right',
  });
  doc.text(`Periode: ${periodLabel}`, pageWidth - marginX, 18, {
    align: 'right',
  });

  // Metadata Box
  let cursorY = 32;
  doc.setDrawColor(203, 213, 225);
  doc.setFillColor(248, 250, 252);
  doc.roundedRect(marginX, cursorY, pageWidth - marginX * 2, 16, 2, 2, 'FD');

  doc.setTextColor(51, 65, 85);
  doc.setFontSize(8.5);
  doc.setFont('helvetica', 'bold');
  doc.text('Jenis & Periode Laporan:', marginX + 4, cursorY + 6);
  doc.setFont('helvetica', 'normal');
  doc.text(
    `Laporan ${params.periodMode === 'DAILY' ? 'Harian' : 'Bulanan'} — ${periodLabel}`,
    marginX + 46,
    cursorY + 6
  );

  doc.setFont('helvetica', 'bold');
  doc.text('Filter Nomor Fleet Card:', marginX + 4, cursorY + 12);
  doc.setFont('helvetica', 'normal');
  doc.text(cardFilterLabel, marginX + 46, cursorY + 12);

  doc.setFont('helvetica', 'bold');
  doc.text('Sisa Saldo Fleet Card Saat Ini:', pageWidth / 2 + 12, cursorY + 6);
  doc.setFont('helvetica', 'bold');
  doc.setTextColor(4, 120, 87);
  doc.text(currentBalanceLabel, pageWidth / 2 + 64, cursorY + 6);

  doc.setTextColor(51, 65, 85);
  doc.setFont('helvetica', 'bold');
  doc.text('Jumlah Data Transaksi:', pageWidth / 2 + 12, cursorY + 12);
  doc.setFont('helvetica', 'normal');
  doc.text(`${filtered.length} Laporan Pengeluaran`, pageWidth / 2 + 64, cursorY + 12);

  cursorY += 20;

  // 4 KPI Summary Boxes
  const kpiGap = 4;
  const kpiWidth = (pageWidth - marginX * 2 - kpiGap * 3) / 4;
  const kpiItems = [
    {
      label: 'TOTAL TRANSAKSI',
      value: `${filtered.length} Laporan`,
      rgb: [15, 23, 42] as [number, number, number],
    },
    {
      label: 'TOTAL PEMBELIAN BBM',
      value: formatIdrPlain(totalBbm),
      rgb: [3, 105, 161] as [number, number, number],
    },
    {
      label: 'TOTAL PENGELUARAN TOL',
      value: formatIdrPlain(totalTol),
      rgb: [15, 23, 42] as [number, number, number],
    },
    {
      label: 'GRAND TOTAL PENGELUARAN',
      value: formatIdrPlain(grandTotal),
      rgb: [4, 120, 87] as [number, number, number],
    },
  ];

  kpiItems.forEach((item, idx) => {
    const boxX = marginX + idx * (kpiWidth + kpiGap);
    doc.setDrawColor(226, 232, 240);
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(boxX, cursorY, kpiWidth, 15, 2, 2, 'FD');

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(100, 116, 139);
    doc.text(item.label, boxX + 3.5, cursorY + 5.5);

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.setTextColor(item.rgb[0], item.rgb[1], item.rgb[2]);
    doc.text(item.value, boxX + 3.5, cursorY + 12);
  });

  cursorY += 19;

  // Detail Table
  const tableRows =
    filtered.length > 0
      ? filtered.map((exp, idx) => {
          const bbmVal = Math.round(Number(exp.totalPengirimanBbm)) || 0;
          const tolVal = Math.round(Number(exp.totalPengeluaranTol)) || 0;
          const rowTotal =
            Number.isFinite(exp.totalPengeluaran) && exp.totalPengeluaran > 0
              ? Math.round(exp.totalPengeluaran)
              : bbmVal + tolVal;
          const effTgl = resolveExpenseEffectiveDate(exp) || exp.tanggal || '-';
          return [
            String(idx + 1),
            formatRealTimeTimestamp(exp.timestamp || exp.tanggal),
            effTgl,
            `${exp.driverName}\n(${exp.driverId})`,
            exp.plateNumber || '-',
            exp.tujuanPengiriman || '-',
            exp.fleetCardId && exp.fleetCardId !== '-' && exp.fleetCardId !== 'MANUAL'
              ? `${exp.fleetCardNumber}\n(${exp.fleetCardId})`
              : exp.fleetCardNumber || '-',
            formatIdrPlain(bbmVal),
            formatIdrPlain(tolVal),
            formatIdrPlain(rowTotal),
            exp.catatan ||
              (exp.completedAssignmentNos
                ? `ST: ${exp.completedAssignmentNos}`
                : '-'),
          ];
        })
      : [
          [
            '-',
            '-',
            '-',
            'Tidak ada transaksi pengeluaran pada periode & kartu ini',
            '-',
            '-',
            params.fleetCardFilter === 'ALL' ? 'Semua Kartu' : params.fleetCardFilter,
            'Rp 0',
            'Rp 0',
            'Rp 0',
            '-',
          ],
        ];

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    head: [
      [
        'No',
        'Timestamp Otomatis',
        'Tgl Pengiriman',
        'Driver',
        'No. Polisi',
        'Tujuan Pengiriman',
        'Nomor Fleet Card',
        'Total Pembelian BBM',
        'Total Pengeluaran Tol',
        'Total Pengeluaran',
        'Catatan / Surat Tugas',
      ],
    ],
    body: tableRows,
    foot: [
      [
        '',
        '',
        '',
        '',
        '',
        '',
        'GRAND TOTAL',
        formatIdrPlain(totalBbm),
        formatIdrPlain(totalTol),
        formatIdrPlain(grandTotal),
        `${filtered.length} Transaksi`,
      ],
    ],
    showFoot: 'lastPage',
    styles: {
      font: 'helvetica',
      fontSize: 7.5,
      cellPadding: 2.2,
      textColor: [15, 23, 42],
      lineColor: [226, 232, 240],
      lineWidth: 0.2,
      valign: 'middle',
    },
    headStyles: {
      fillColor: [15, 23, 42],
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    footStyles: {
      fillColor: [241, 245, 249],
      textColor: [15, 23, 42],
      fontStyle: 'bold',
      fontSize: 8,
    },
    alternateRowStyles: {
      fillColor: [248, 250, 252],
    },
    columnStyles: {
      0: { cellWidth: 9, halign: 'center' },
      1: { cellWidth: 28 },
      2: { cellWidth: 22, halign: 'center' },
      3: { cellWidth: 28 },
      4: { cellWidth: 21, halign: 'center' },
      5: { cellWidth: 34 },
      6: { cellWidth: 32 },
      7: { cellWidth: 27, halign: 'right' },
      8: { cellWidth: 27, halign: 'right' },
      9: { cellWidth: 27, halign: 'right', fontStyle: 'bold' },
      10: { cellWidth: 'auto' },
    },
  });

  // Page footer numbers
  const totalPages = doc.getNumberOfPages();
  const pageHeight = doc.internal.pageSize.getHeight();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(100, 116, 139);
    doc.text(
      `CRK Logistik Delivery Sistem — Laporan Detail Pengeluaran ${
        params.periodMode === 'DAILY' ? 'Harian' : 'Bulanan'
      }`,
      marginX,
      pageHeight - 6
    );
    doc.text(
      `Halaman ${p} dari ${totalPages}`,
      pageWidth - marginX,
      pageHeight - 6,
      { align: 'right' }
    );
  }

  const safeCardSlug =
    params.fleetCardFilter === 'ALL'
      ? 'SEMUA-KARTU'
      : String(params.fleetCardFilter)
          .replace(/[^a-zA-Z0-9_-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .toUpperCase() || 'KARTU';
  const safePeriodSlug =
    params.periodMode === 'DAILY'
      ? `HARIAN-${params.selectedDate || 'SEMUA'}`
      : `BULANAN-${params.selectedMonth || 'SEMUA'}`;

  const fileName = `Laporan-Pengeluaran-FleetCard-${safeCardSlug}-${safePeriodSlug}.pdf`;
  doc.save(fileName);

  return {
    rowCount: filtered.length,
    fileName,
  };
}
