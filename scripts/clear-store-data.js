import fs from 'fs';
import path from 'path';

const storePath = path.resolve(process.cwd(), 'data/dispatch-store.json');

export function clearDummyData() {
  if (!fs.existsSync(storePath)) return;
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
  store.needsMasterSheetSync = true;
  store.deletedTombstones = {
    assignments: [],
    drivers: [],
    vehicles: [],
    routes: [],
    fleetCards: [],
    driverExpenses: [],
  };

  fs.writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf8');
  
  const mediaPath = path.resolve(process.cwd(), 'data/media');
  if (fs.existsSync(mediaPath)) {
    try {
      fs.rmSync(mediaPath, { recursive: true, force: true });
      console.log('Cleared all files in data/media');
    } catch (e) {}
  }
  console.log('Cleared all dummy data from dispatch-store.json');
}

if (process.argv[1] && process.argv[1].endsWith('clear-store-data.js')) {
  clearDummyData();
}
