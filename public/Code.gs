/**
 * CRK Logistik Delivery Sistem — Google Apps Script Backend (Code.gs)
 * Salin seluruh kode ini ke editor Apps Script Anda.
 */

function doGet(e) {
  const action = e && e.parameter ? e.parameter.action : '';
  if (action === 'getData') {
    return ContentService.createTextOutput(
      JSON.stringify({ success: true, state: getAllAppData_() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('CRK Logistik Delivery Sistem')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function doPost(e) {
  try {
    const rawData = e && e.postData ? e.postData.contents : '{}';
    const payload = JSON.parse(rawData);
    const action = payload.action;
    const ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'updateAssignmentStatus') {
      const id = payload.id;
      const status = payload.status;
      const sheet = getOrCreateSheet_(ss, 'Surat_Tugas', [
        'ID Internal', 'Urutan', 'No Penugasan', 'No Surat Jalan Fisik', 'Kode Segel',
        'Tanggal Tugas', 'ID Driver', 'Nama Driver', 'No WA Driver', 'Kode Unit',
        'No Polisi', 'Tipe Kendaraan', 'Jenis Armada (Pendingin/Non)', 'Titik Keberangkatan Driver',
        'Kode Rute', 'Lokasi Tujuan', 'Muatan Pengiriman', 'Status', 'Timestamp Berangkat',
        'KM Awal', 'Suhu Awal', 'BBM Awal', 'Kondisi Berangkat', 'Catatan Berangkat',
        'Status Foto Berangkat', 'Timestamp Serah Terima', 'KM Akhir', 'Suhu Serah Terima',
        'BBM Akhir', 'Penerima Serah Terima', 'Kondisi Akhir', 'Catatan Serah Terima',
        'Status Foto & TTD Serah Terima', 'Catatan Dispatcher', 'Dibuat Pada', 'Target Jam Tiba',
        'Berat Muatan', 'Link Folder Google Drive', 'Link Foto Odometer Keberangkatan',
        'Link Foto Suhu Keberangkatan', 'Link Foto Odometer Serah Terima', 'Link Foto Suhu Serah Terima',
        'Link Foto Bukti Serah Terima', 'Link Tanda Tangan Penerima', 'Waktu Tiba (Delivered)', 'Volume Muatan (CBM)'
      ]);
      const rows = sheet.getDataRange().getValues();
      for (let i = 1; i < rows.length; i++) {
        if (String(rows[i][0]) === String(id)) {
          sheet.getRange(i + 1, 18).setValue(status); // Column 18 is Status
          break;
        }
      }
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, state: getAllAppData_() })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    if (action === 'submitExpense') {
      const sheet = getOrCreateSheet_(ss, 'Pengeluaran_Driver', [
        'ID Pengeluaran', 'Timestamp Otomatis', 'Tanggal', 'ID Driver', 'Nama Driver',
        'No Polisi', 'No Surat Tugas Selesai', 'ID Fleet Card', 'Nomor Kartu Fleet Card',
        'Total Pembelian BBM', 'Link Foto Struk BBM', 'Total Pengeluaran Tol', 'Link Foto Struk Tol',
        'Total Pengeluaran', 'Catatan', 'Tanggal Pengiriman', 'Tujuan Pengiriman'
      ]);
      const now = new Date();
      const totalBbm = Number(payload.totalPembelianBbm) || 0;
      const totalTol = Number(payload.totalPengeluaranTol) || 0;
      const total = totalBbm + totalTol;

      sheet.appendRow([
        'EXP-' + Date.now(),
        now.toISOString(),
        Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd'),
        payload.driverId,
        payload.driverName,
        '-',
        '-',
        payload.fleetCardId,
        payload.fleetCardNumber,
        totalBbm,
        '-',
        totalTol,
        '-',
        total,
        payload.catatan || '',
        Utilities.formatDate(now, 'Asia/Jakarta', 'yyyy-MM-dd'),
        '-'
      ]);

      // Deduct Fleet Card balance
      const fcSheet = getOrCreateSheet_(ss, 'Master_Fleet_Card', ['ID Fleet Card', 'Nomor Kartu Fleet Card', 'Saldo Fleet Card']);
      const fcRows = fcSheet.getDataRange().getValues();
      for (let i = 1; i < fcRows.length; i++) {
        if (String(fcRows[i][0]) === String(payload.fleetCardId)) {
          const currentBal = Number(fcRows[i][2]) || 0;
          fcSheet.getRange(i + 1, 3).setValue(Math.max(0, currentBal - total));
          break;
        }
      }

      return ContentService.createTextOutput(
        JSON.stringify({ success: true, state: getAllAppData_() })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: 'Action tidak dikenal' })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: err.message })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function getAllAppData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return {
    drivers: getSheetDataAsObjects_(ss, 'Master_Driver'),
    vehicles: getSheetDataAsObjects_(ss, 'Master_Armada'),
    routes: getSheetDataAsObjects_(ss, 'Master_Rute'),
    fleetCards: getSheetDataAsObjects_(ss, 'Master_Fleet_Card'),
    driverExpenses: getSheetDataAsObjects_(ss, 'Pengeluaran_Driver'),
    assignments: getSheetDataAsObjects_(ss, 'Surat_Tugas'),
    config: { spreadsheetId: ss.getId(), spreadsheetTitle: ss.getName() }
  };
}

function getOrCreateSheet_(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    if (headers && headers.length > 0) {
      sheet.appendRow(headers);
    }
  }
  return sheet;
}

function getSheetDataAsObjects_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length <= 1) return [];
  const headers = rows[0];
  const results = [];
  for (let i = 1; i < rows.length; i++) {
    const obj = {};
    for (let j = 0; j < headers.length; j++) {
      const key = String(headers[j]).trim().toLowerCase().replace(/\s+/g, '_');
      obj[key] = rows[i][j];
      if (j === 0) obj['id'] = String(rows[i][j]);
      if (j === 1) obj['name'] = String(rows[i][j]);
    }
    // Specific mapping helpers
    if (name === 'Surat_Tugas') {
      obj['id'] = String(rows[i][0]);
      obj['noPenugasan'] = String(rows[i][2]);
      obj['driverId'] = String(rows[i][6]);
      obj['driverName'] = String(rows[i][7]);
      obj['plateNumber'] = String(rows[i][10]);
      obj['destination'] = String(rows[i][15]);
      obj['status'] = String(rows[i][17] || 'Menunggu Berangkat');
      obj['volumeCbm'] = String(rows[i][44] || '0');
    } else if (name === 'Master_Driver') {
      obj['id'] = String(rows[i][0]);
      obj['name'] = String(rows[i][1]);
      obj['phone'] = String(rows[i][2]);
    } else if (name === 'Master_Fleet_Card') {
      obj['id'] = String(rows[i][0]);
      obj['cardNumber'] = String(rows[i][1]);
      obj['balance'] = Number(rows[i][2]) || 0;
    } else if (name === 'Pengeluaran_Driver') {
      obj['id'] = String(rows[i][0]);
      obj['timestamp'] = String(rows[i][1]);
      obj['driverName'] = String(rows[i][4]);
      obj['fleetCardNumber'] = String(rows[i][8]);
      obj['totalPengeluaran'] = Number(rows[i][13]) || 0;
    }
    results.push(obj);
  }
  return results;
}
