import fs from 'fs';
import path from 'path';
import {
  pushAllTabsViaServiceAccount,
  SERVER_SHEET_HEADERS,
} from '../src/server/googleServiceAccount.ts';

const storePath = path.resolve(process.cwd(), 'data/dispatch-store.json');
const mediaPath = path.resolve(process.cwd(), 'data/media');

async function main() {
  console.log('=== CLEARING ALL LOCAL & GOOGLE SPREADSHEET DATA ===');

  // 1. Wipe local store JSON
  if (fs.existsSync(storePath)) {
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    store.drivers = [];
    store.vehicles = [];
    store.routes = [];
    store.fleetCards = [];
    store.assignments = [];
    store.driverExpenses = [];
    store.lastSequence = 0;
    store.syncedDriverIds = [];
    store.syncedVehicleIds = [];
    store.syncedRouteIds = [];
    store.syncedFleetCardIds = [];
    store.syncedAssignmentNos = [];
    store.syncedExpenseIds = [];
    store.unsyncedDriverIds = [];
    store.unsyncedVehicleIds = [];
    store.unsyncedRouteIds = [];
    store.unsyncedFleetCardIds = [];
    store.wasIntentionallyCleared = true;
    store.lastSyncedAt = new Date().toISOString();
    store.needsMasterSheetSync = false;
    store.deletedTombstones = {
      assignments: [],
      drivers: [],
      vehicles: [],
      routes: [],
      fleetCards: [],
      driverExpenses: [],
    };
    fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
    console.log('1. Local dispatch-store.json wiped clean.');
  }

  // 2. Wipe local media directory
  if (fs.existsSync(mediaPath)) {
    try {
      fs.rmSync(mediaPath, { recursive: true, force: true });
      console.log('2. Local media vault wiped clean.');
    } catch (e) {
      console.error('Error removing media directory:', e);
    }
  }

  // 3. Clear remote Google Spreadsheet tabs via Service Account
  const spreadsheetId = '1CDskFRovW_ZH6xwipwqn3A6fga1ZMylJzL4MrhaB2Ac';
  console.log(`3. Clearing remote Google Spreadsheet (${spreadsheetId})...`);

  const emptyTabsPayload = {
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
  };

  try {
    await pushAllTabsViaServiceAccount(spreadsheetId, emptyTabsPayload);
    console.log('Successfully cleared remote Google Spreadsheet tabs!');
  } catch (err) {
    console.error('Warning: Error pushing empty tabs to Google Sheets:', err);
  }

  console.log('=== DATA CLEAR COMPLETE ===');
}

main().catch((err) => {
  console.error('Error clearing data:', err);
  process.exit(1);
});
