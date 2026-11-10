import fs from 'fs';
import path from 'path';
import {
  pushAllTabsViaServiceAccount,
  getServiceAccountAccessToken,
} from '../src/server/googleServiceAccount.ts';

const storePath = path.resolve(process.cwd(), 'data/dispatch-store.json');
const mediaPath = path.resolve(process.cwd(), 'data/media');
const spreadsheetId = '1CDskFRovW_ZH6xwipwqn3A6fga1ZMylJzL4MrhaB2Ac';

async function main() {
  console.log('=== FORCE CLEANING ALL STORE & GOOGLE SHEETS ===');

  // 1. Clear remote Google Spreadsheet
  try {
    const res = await pushAllTabsViaServiceAccount(spreadsheetId, {
      driversRows: [],
      vehiclesRows: [],
      routesRows: [],
      fleetCardsRows: [],
      driverExpensesRows: [],
      assignmentsRows: [],
      configRows: [
        ['admin_pin', '044183'],
        ['letter_prefix', 'ST-CRK'],
        ['last_sequence', '0'],
      ],
    });
    console.log('Google Sheets batchClear and push result:', res);
  } catch (e) {
    console.error('Error pushing empty tabs to Google Sheets:', e);
  }

  // 2. Wipe local store file completely
  const cleanStore = {
    adminPin: '044183',
    isDefaultPin: false,
    spreadsheetId,
    spreadsheetTitle: 'CRK LOGISTIK DELIVERY SISTEM Database',
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
    appsScriptUrl: 'https://script.google.com/macros/s/AKfycbz8pCRDJCL9JhbYRMHmYlPlgefG-KyQNDgiAOnb9MrSOHsKjVbv5jj-FIvcRnd1OEBS/exec',
    liveCsvReadable: true,
    driveRootFolderId: '1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-',
    driveRootFolderUrl: 'https://drive.google.com/drive/folders/1KxUKh-Lu-CebrkUmP-VP69-kPXFMJql-',
    lastSyncedAt: new Date().toISOString(),
    lastSyncedSpreadsheetId: spreadsheetId,
    wasIntentionallyCleared: true,
    drivers: [],
    vehicles: [],
    routes: [],
    fleetCards: [],
    adminViews: [
      {
        id: 'AV-001',
        name: 'Viewer Operasional Logistik',
        pin: '123456',
        active: true,
        description: 'Akses Pantau Dashboard Logistik Saja (Read-Only)',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ],
    assignments: [],
    driverExpenses: [],
    notifications: [],
    lastSequence: 0,
    needsMasterSheetSync: false,
    syncedDriverIds: [],
    syncedVehicleIds: [],
    syncedRouteIds: [],
    syncedFleetCardIds: [],
    syncedAssignmentNos: [],
    syncedExpenseIds: [],
    unsyncedDriverIds: [],
    unsyncedVehicleIds: [],
    unsyncedRouteIds: [],
    unsyncedFleetCardIds: [],
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
  };

  fs.writeFileSync(storePath, JSON.stringify(cleanStore, null, 2), 'utf8');
  console.log('Local store dispatch-store.json set to clean 0-record state.');

  // 3. Clear local media vault
  if (fs.existsSync(mediaPath)) {
    try {
      fs.rmSync(mediaPath, { recursive: true, force: true });
      console.log('Local media directory purged.');
    } catch (e) {}
  }

  console.log('=== FORCE CLEAN COMPLETE ===');
}

main().catch(err => {
  console.error('Fatal error in force clean script:', err);
  process.exit(1);
});
