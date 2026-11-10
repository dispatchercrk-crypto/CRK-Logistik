import fs from 'fs';
import path from 'path';

const storePath = path.resolve(process.cwd(), 'data/dispatch-store.json');
const serviceAccountKeyPath = path.resolve(process.cwd(), 'gen-lang-client-0326301182-928a225aeee9.json');

const INITIAL_DRIVERS = [
  { id: 'DRV-001', nama: 'Budi Santoso', noTelepon: '081234567890', status: 'Aktif' },
  { id: 'DRV-002', nama: 'Ahmad Dahlan', noTelepon: '082198765432', status: 'Aktif' },
  { id: 'DRV-003', nama: 'Siti Rahma', noTelepon: '083812345678', status: 'Aktif' },
  { id: 'DRV-004', nama: 'Dedi Kurniawan', noTelepon: '085711223344', status: 'Aktif' },
  { id: 'DRV-005', nama: 'Eko Prasetyo', noTelepon: '087855667788', status: 'Aktif' },
  { id: 'DRV-006', nama: 'Fajar Nugraha', noTelepon: '081399887766', status: 'Aktif' },
  { id: 'DRV-007', nama: 'Gilang Ramadhan', noTelepon: '082233445566', status: 'Aktif' },
  { id: 'DRV-008', nama: 'Hendra Setiawan', noTelepon: '085677889900', status: 'Aktif' },
  { id: 'DRV-009', nama: 'Irfan Bachdim', noTelepon: '087712341234', status: 'Aktif' },
  { id: 'DRV-010', nama: 'Joko Widodo', noTelepon: '089699001122', status: 'Aktif' },
];

const INITIAL_VEHICLES = [
  { id: 'UNT-001', nopol: 'B 9123 CRK', jenisKendaraan: 'Tronton Box Refrigerated', nopolDanJenis: 'B 9123 CRK - Tronton Box Refrigerated', status: 'Tersedia', capacityCbm: 45 },
  { id: 'UNT-002', nopol: 'B 9124 CRK', jenisKendaraan: 'Wingbox Cold Chain', nopolDanJenis: 'B 9124 CRK - Wingbox Cold Chain', status: 'Tersedia', capacityCbm: 50 },
  { id: 'UNT-003', nopol: 'B 9456 CRK', jenisKendaraan: 'CDD Long Box Pendingin', nopolDanJenis: 'B 9456 CRK - CDD Long Box Pendingin', status: 'Tersedia', capacityCbm: 28 },
  { id: 'UNT-004', nopol: 'B 9789 CRK', jenisKendaraan: 'CDE Box Chiller', nopolDanJenis: 'B 9789 CRK - CDE Box Chiller', status: 'Tersedia', capacityCbm: 14 },
  { id: 'UNT-005', nopol: 'B 9111 CRK', jenisKendaraan: 'Blind Van Pharma Frozen', nopolDanJenis: 'B 9111 CRK - Blind Van Pharma Frozen', status: 'Tersedia', capacityCbm: 6 },
  { id: 'UNT-006', nopol: 'B 9222 CRK', jenisKendaraan: 'Fuso Heavy Refrigerated', nopolDanJenis: 'B 9222 CRK - Fuso Heavy Refrigerated', status: 'Tersedia', capacityCbm: 36 },
];

const INITIAL_ROUTES = [
  { id: 'RT-001', namaRute: 'Jakarta - Bandung Super Express', uangJalan: 1200000, eToll: 250000, bbm: 450000 },
  { id: 'RT-002', namaRute: 'Jakarta - Surabaya Trans Java', uangJalan: 3500000, eToll: 750000, bbm: 1400000 },
  { id: 'RT-003', namaRute: 'Jakarta - Semarang Distribution', uangJalan: 2400000, eToll: 450000, bbm: 950000 },
  { id: 'RT-004', namaRute: 'Jakarta - Merak Port Relay', uangJalan: 1100000, eToll: 180000, bbm: 400000 },
  { id: 'RT-005', namaRute: 'Bandung - Surabaya Intercity Cold Chain', uangJalan: 3200000, eToll: 650000, bbm: 1300000 },
  { id: 'RT-006', namaRute: 'Jabodetabek Cold Line Inner Ring', uangJalan: 650000, eToll: 120000, bbm: 250000 },
  { id: 'RT-007', namaRute: 'Jakarta - Solo Logistics Arterial', uangJalan: 2600000, eToll: 500000, bbm: 1050000 },
  { id: 'RT-008', namaRute: 'Jakarta - Malang Refrigerated Route', uangJalan: 3800000, eToll: 800000, bbm: 1550000 },
  { id: 'RT-009', namaRute: 'Surabaya - Denpasar Maritime Cross', uangJalan: 4200000, eToll: 350000, bbm: 1700000 },
  { id: 'RT-010', namaRute: 'Jakarta - Cirebon Industrial Corridor', uangJalan: 1600000, eToll: 300000, bbm: 600000 },
];

const INITIAL_FLEET_CARDS = [
  { id: 'FC-001', cardNumber: '1122-3344-5566-7788', balance: 5000000 },
  { id: 'FC-002', cardNumber: '2233-4455-6677-8899', balance: 3500000 },
  { id: 'FC-003', cardNumber: '3344-5566-7788-9900', balance: 7500000 },
  { id: 'FC-004', cardNumber: '4455-6677-8899-0011', balance: 2000000 },
];

const createSynthesizedMediaBadge = (label, status, details, hexColor) => {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400">
    <rect width="600" height="400" fill="#0f172a"/>
    <rect x="20" y="20" width="560" height="360" rx="16" fill="#1e293b" stroke="${hexColor}" stroke-width="4"/>
    <circle cx="300" cy="110" r="45" fill="${hexColor}" opacity="0.2"/>
    <path d="M280 110 L295 125 L325 95" stroke="${hexColor}" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <text x="300" y="190" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="bold" fill="#ffffff" text-anchor="middle">${label}</text>
    <text x="300" y="225" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600" fill="${hexColor}" text-anchor="middle">${status}</text>
    <rect x="50" y="250" width="500" height="1" fill="#334155"/>
    <text x="300" y="290" font-family="monospace" font-size="14" fill="#94a3b8" text-anchor="middle">${details[0] || ''}</text>
    <text x="300" y="315" font-family="monospace" font-size="14" fill="#94a3b8" text-anchor="middle">${details[1] || ''}</text>
    <text x="300" y="340" font-family="monospace" font-size="12" fill="#64748b" text-anchor="middle">CRK LOGISTIK DIGITAL VERIFICATION SYSTEM</text>
  </svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
};

const buildSeedAssignments = () => {
  const list = [];
  const statusCycle = ['Tugas Dibuat', 'Dalam Perjalanan', 'Handover', 'Selesai'];

  for (let i = 1; i <= 25; i++) {
    const pad = String(i).padStart(4, '0');
    const month = i % 2 === 0 ? '08' : '09';
    const noPenugasan = `ST-CRK/2026/${month}/${pad}`;
    const id = `asg-seed-2026-${month}-${pad}`;
    const driverObj = INITIAL_DRIVERS[(i - 1) % INITIAL_DRIVERS.length];
    const vehicleObj = INITIAL_VEHICLES[(i - 1) % INITIAL_VEHICLES.length];
    const routeObj = INITIAL_ROUTES[(i - 1) % INITIAL_ROUTES.length];
    const fleetCardObj = INITIAL_FLEET_CARDS[(i - 1) % INITIAL_FLEET_CARDS.length];
    const status = statusCycle[(i - 1) % statusCycle.length];

    const isDep = status === 'Dalam Perjalanan' || status === 'Handover' || status === 'Selesai';
    const isHand = status === 'Handover' || status === 'Selesai';

    const odoBerangkat = 125000 + (i * 140);
    const odoSampai = odoBerangkat + 320;

    const departureData = isDep ? {
      driverId: driverObj.id,
      namaDriver: driverObj.nama,
      noHandphone: driverObj.noTelepon,
      vehicleId: vehicleObj.id,
      nopol: vehicleObj.nopol,
      jenisKendaraan: vehicleObj.jenisKendaraan,
      titikKeberangkatan: 'Pool Utama CRK Logistik Jakarta',
      odometerBerangkat: odoBerangkat,
      suhuKendaraanBerangkat: -18.5,
      fotoOdometerBerangkat: createSynthesizedMediaBadge('FOTO ODOMETER KEBERANGKATAN', 'TERVERIFIKASI DIGITAL', [`No ST: ${noPenugasan}`, `Odometer: ${odoBerangkat} KM | Temp: -18.5 C`], '#10b981'),
      fotoSuhuBerangkat: createSynthesizedMediaBadge('FOTO SUHU CHILLER KEBERANGKATAN', 'TERVERIFIKASI DIGITAL', [`No ST: ${noPenugasan}`, `Suhu Target: -18.5 C | Status: Normal`], '#3b82f6'),
      timestamp: `2026-${month}-${String((i % 28) + 1).padStart(2, '0')}T07:30:00.000Z`,
    } : undefined;

    const deliveredData = isHand ? {
      nopol: vehicleObj.nopol,
      jenisKendaraan: vehicleObj.jenisKendaraan,
      odometerSampai: odoSampai,
      suhuKendaraanSampai: -18.0,
      fotoOdometerSampai: createSynthesizedMediaBadge('FOTO ODOMETER KEDATANGAN', 'TERVERIFIKASI DIGITAL', [`No ST: ${noPenugasan}`, `Odometer Sampai: ${odoSampai} KM`], '#10b981'),
      fotoSuhuSampai: createSynthesizedMediaBadge('FOTO SUHU CHILLER KEDATANGAN', 'TERVERIFIKASI DIGITAL', [`No ST: ${noPenugasan}`, `Suhu Tiba: -18.0 C | Quality PASS`], '#3b82f6'),
      timestamp: `2026-${month}-${String((i % 28) + 1).padStart(2, '0')}T14:45:00.000Z`,
    } : undefined;

    const handoverData = isHand ? {
      namaPenerima: `Bpk. Receiver ${i} (Logistik Warehouse)`,
      fotoOdometerSerahTerima: createSynthesizedMediaBadge('FOTO ODOMETER SERAH TERIMA', 'TERVERIFIKASI DIGITAL', [`No ST: ${noPenugasan}`, `Odo Final: ${odoSampai} KM`], '#10b981'),
      fotoSuhuSerahTerima: createSynthesizedMediaBadge('FOTO SUHU SERAH TERIMA', 'TERVERIFIKASI DIGITAL', [`No ST: ${noPenugasan}`, `Suhu Final: -18.0 C`], '#3b82f6'),
      fotoBuktiSerahTerima: createSynthesizedMediaBadge('BUKTI SERAH TERIMA BARANG', 'DOKUMEN SAH', [`No ST: ${noPenugasan}`, `Penerima: Bpk. Receiver ${i}`], '#f59e0b'),
      tandaTanganPenerima: createSynthesizedMediaBadge('TANDA TANGAN DIGITAL PENERIMA', 'TERVERIFIKASI', [`No ST: ${noPenugasan}`, `Signed by Receiver ${i}`], '#8b5cf6'),
      catatanPenerima: 'Barang diterima dalam kondisi dingin sempurna, segel utuh.',
      timestamp: `2026-${month}-${String((i % 28) + 1).padStart(2, '0')}T15:00:00.000Z`,
    } : undefined;

    const folderUrl = `https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-${i}`;
    const driveMedia = isDep ? {
      folderUrl,
      fotoOdometerBerangkatUrl: `${folderUrl}/foto_odometer_berangkat.jpg`,
      fotoSuhuBerangkatUrl: `${folderUrl}/foto_suhu_berangkat.jpg`,
      fotoOdometerSerahTerimaUrl: isHand ? `${folderUrl}/foto_odometer_serah_terima.jpg` : undefined,
      fotoSuhuSerahTerimaUrl: isHand ? `${folderUrl}/foto_suhu_serah_terima.jpg` : undefined,
      fotoBuktiSerahTerimaUrl: isHand ? `${folderUrl}/foto_bukti_serah_terima.jpg` : undefined,
      tandaTanganPenerimaUrl: isHand ? `${folderUrl}/tanda_tangan_penerima.png` : undefined,
    } : undefined;

    list.push({
      id,
      sequenceNumber: i,
      noPenugasan,
      driverId: driverObj.id,
      namaDriver: driverObj.nama,
      noHandphone: driverObj.noTelepon,
      vehicleId: vehicleObj.id,
      nopol: vehicleObj.nopol,
      jenisKendaraan: vehicleObj.jenisKendaraan,
      routeId: routeObj.id,
      namaRute: routeObj.namaRute,
      uangJalan: routeObj.uangJalan,
      eToll: routeObj.eToll,
      bbm: routeObj.bbm,
      fleetCardId: fleetCardObj.id,
      fleetCardNumber: fleetCardObj.cardNumber,
      tanggalPenugasan: `2026-${month}-${String((i % 28) + 1).padStart(2, '0')}`,
      status,
      deliveredAt: isHand ? `2026-${month}-${String((i % 28) + 1).padStart(2, '0')}T15:00:00.000Z` : undefined,
      beratMuatan: 12500 + (i * 250),
      volumeCbm: vehicleObj.capacityCbm,
      departureData,
      deliveredData,
      handoverData,
      driveFolderUrl: folderUrl,
      driveMedia,
      needsSheetSync: true,
      createdAt: `2026-${month}-${String((i % 28) + 1).padStart(2, '0')}T06:00:00.000Z`,
      updatedAt: `2026-${month}-${String((i % 28) + 1).padStart(2, '0')}T15:05:00.000Z`,
    });
  }

  return list;
};

const INITIAL_EXPENSES = [
  {
    id: 'EXP-2026-001',
    assignmentId: 'asg-seed-2026-08-0001',
    noPenugasan: 'ST-CRK/2026/08/0001',
    driverId: 'DRV-001',
    namaDriver: 'Budi Santoso',
    tanggalPengiriman: '2026-08-01',
    tujuanPengiriman: 'Jakarta - Bandung Super Express',
    nominalBbm: 450000,
    fotoStrukBbm: createSynthesizedMediaBadge('STRUK BBM SOLAR PERTAMINA', 'TERVERIFIKASI', ['No ST: ST-CRK/2026/08/0001', 'Nominal: Rp 450.000'], '#10b981'),
    fotoStrukBbmUrl: 'https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-1/struk_bbm.jpg',
    nominalTol: 250000,
    fotoStrukTol: createSynthesizedMediaBadge('STRUK E-TOLL CIPULARANG', 'TERVERIFIKASI', ['No ST: ST-CRK/2026/08/0001', 'Nominal: Rp 250.000'], '#3b82f6'),
    fotoStrukTolUrl: 'https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-1/struk_tol.jpg',
    nominalLainnya: 50000,
    keteranganLainnya: 'Parkir Cold Storage Bandung',
    totalPengeluaran: 750000,
    needsSheetSync: true,
    createdAt: '2026-08-01T16:00:00.000Z',
    updatedAt: '2026-08-01T16:00:00.000Z',
  },
  {
    id: 'EXP-2026-002',
    assignmentId: 'asg-seed-2026-09-0002',
    noPenugasan: 'ST-CRK/2026/09/0002',
    driverId: 'DRV-002',
    namaDriver: 'Ahmad Dahlan',
    tanggalPengiriman: '2026-09-02',
    tujuanPengiriman: 'Jakarta - Surabaya Trans Java',
    nominalBbm: 1400000,
    fotoStrukBbm: createSynthesizedMediaBadge('STRUK BBM SOLAR PERTAMINA', 'TERVERIFIKASI', ['No ST: ST-CRK/2026/09/0002', 'Nominal: Rp 1.400.000'], '#10b981'),
    fotoStrukBbmUrl: 'https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-2/struk_bbm.jpg',
    nominalTol: 750000,
    fotoStrukTol: createSynthesizedMediaBadge('STRUK E-TOLL TRANS JAWA', 'TERVERIFIKASI', ['No ST: ST-CRK/2026/09/0002', 'Nominal: Rp 750.000'], '#3b82f6'),
    fotoStrukTolUrl: 'https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-2/struk_tol.jpg',
    nominalLainnya: 100000,
    keteranganLainnya: 'Timbang Muatan Brebes & Rest Area',
    totalPengeluaran: 2250000,
    needsSheetSync: true,
    createdAt: '2026-09-02T18:00:00.000Z',
    updatedAt: '2026-09-02T18:00:00.000Z',
  },
  {
    id: 'EXP-2026-003',
    assignmentId: 'asg-seed-2026-08-0003',
    noPenugasan: 'ST-CRK/2026/08/0003',
    driverId: 'DRV-003',
    namaDriver: 'Siti Rahma',
    tanggalPengiriman: '2026-08-03',
    tujuanPengiriman: 'Jakarta - Semarang Distribution',
    nominalBbm: 950000,
    fotoStrukBbm: createSynthesizedMediaBadge('STRUK BBM SOLAR PERTAMINA', 'TERVERIFIKASI', ['No ST: ST-CRK/2026/08/0003', 'Nominal: Rp 950.000'], '#10b981'),
    fotoStrukBbmUrl: 'https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-3/struk_bbm.jpg',
    nominalTol: 450000,
    fotoStrukTol: createSynthesizedMediaBadge('STRUK E-TOLL PALIMANAN', 'TERVERIFIKASI', ['No ST: ST-CRK/2026/08/0003', 'Nominal: Rp 450.000'], '#3b82f6'),
    fotoStrukTolUrl: 'https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-3/struk_tol.jpg',
    nominalLainnya: 75000,
    keteranganLainnya: 'Kebersihan & Parkir Hub Semarang',
    totalPengeluaran: 1475000,
    needsSheetSync: true,
    createdAt: '2026-08-03T17:30:00.000Z',
    updatedAt: '2026-08-03T17:30:00.000Z',
  },
];

async function main() {
  console.log('Building restored store payload...');
  const assignments = buildSeedAssignments();

  let existingStore = {};
  if (fs.existsSync(storePath)) {
    try {
      existingStore = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    } catch (err) {}
  }

  const restoredStore = {
    ...existingStore,
    adminPin: existingStore.adminPin || '044183',
    isDefaultPin: false,
    spreadsheetId: '1CDskFRovW_ZH6xwipwqn3A6fga1ZMylJzL4MrhaB2Ac',
    spreadsheetTitle: 'CRK LOGISTIK DELIVERY SISTEM Database',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/1CDskFRovW_ZH6xwipwqn3A6fga1ZMylJzL4MrhaB2Ac/edit',
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycbz8pCRDJCL9JhbYRMHmYlPlgefG-KyQNDgiAOnb9MrSOHsKjVbv5jj-FIvcRnd1OEBS/exec',
    liveCsvReadable: true,
    driveRootFolderId: '1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-',
    driveRootFolderUrl: 'https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-',
    drivers: INITIAL_DRIVERS,
    vehicles: INITIAL_VEHICLES,
    routes: INITIAL_ROUTES,
    fleetCards: INITIAL_FLEET_CARDS,
    driverExpenses: INITIAL_EXPENSES,
    assignments,
    lastSequence: 25,
    needsMasterSheetSync: true,
    pendingMasterDeletionPush: false,
    pendingAssignmentDeletionPush: false,
    pendingExpenseDeletionPush: false,
    deletedTombstones: {
      assignments: [],
      drivers: [],
      vehicles: [],
      routes: [],
      fleetCards: [],
      driverExpenses: [],
    },
    syncedDriverIds: [],
    syncedVehicleIds: [],
    syncedRouteIds: [],
    syncedFleetCardIds: [],
    syncedAssignmentNos: [],
    syncedExpenseIds: [],
    unsyncedDriverIds: INITIAL_DRIVERS.map(d => d.id),
    unsyncedVehicleIds: INITIAL_VEHICLES.map(v => v.id),
    unsyncedRouteIds: INITIAL_ROUTES.map(r => r.id),
    unsyncedFleetCardIds: INITIAL_FLEET_CARDS.map(f => f.id),
    lastSyncedAt: new Date().toISOString(),
  };

  fs.writeFileSync(storePath, JSON.stringify(restoredStore, null, 2), 'utf8');
  console.log(`Successfully wrote ${assignments.length} assignments and master data to ${storePath}`);
}

main().catch(err => {
  console.error('Error in populate-and-push script:', err);
  process.exit(1);
});
