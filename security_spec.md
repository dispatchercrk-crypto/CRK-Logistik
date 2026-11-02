# Security Specification — CRK LOGISTIK DELIVERY SISTEM (Firestore Zero-Trust Rules)

## 1. Data Invariants

1. **Global Default-Deny**: Any path not explicitly matched is unconditionally denied (`allow read, write: if false;`).
2. **Verified Identity Gate**: Every read and write operation requires `request.auth != null && request.auth.token.email_verified == true`. Unverified email tokens (`email_verified == false`) are strictly rejected even if the email string matches the bootstrap admin (`dispatchercrk@gmail.com`).
3. **Path Variable Hardening**: Every single-document operation (`get`, `create`, `update`, `delete`) validates all path IDs against `^[a-zA-Z0-9_\-]+$` with length `1..128` (`1..64` for master codes).
4. **PII Split-Collection & Atomic Parent Sync**:
   - Driver PII (`phone`, `pin`) is isolated in `/drivers/{driverId}/private/credentials` (`secretId == 'credentials'`).
   - Creating `/drivers/{driverId}` atomically requires `existsAfter(/databases/$(database)/documents/drivers/$(driverId)/private/credentials)`.
   - Creating `/drivers/{driverId}/private/credentials` atomically requires `existsAfter(/databases/$(database)/documents/drivers/$(driverId))` and `getAfter(...).data.ownerUid == request.auth.uid`.
   - Reading, updating, or deleting `/drivers/{driverId}/private/credentials` fetches the parent `/drivers/{driverId}` via `get()` to verify `data.ownerUid == request.auth.uid` (Master Gate).
5. **Strict Blueprint Validation (`hasAll` + `hasOnly`)**: Every `create` and `update` begins with `isValid[Entity](incoming())`, enforcing exact key allowlists (including `FleetCardDoc` at `/fleet_cards/{fleetCardId}` with `id` `<= 64`, `cardNumber` `<= 80`, numeric `balance`, and `DriverExpenseDoc` at `/driver_expenses/{expenseId}` with bounded strings and optional Drive URLs `fotoStrukBbmUrl` `<= 300` & `fotoStrukTolUrl` `<= 300` — never raw base64 images — plus multi-Surat-Jalan `noSuratJalanFisik` `<= 500`, optional `beratMuatan` `<= 64`, optional `deliveredAt` `<= 64`, bounded optional Google Drive metadata `driveFolderUrl` `<= 300`, `driveRootFolderId` `<= 160`, `driveRootFolderUrl` `<= 300`, and optional `publicPortalBaseUrl` `<= 300`), string length bounds matching `firebase-blueprint.json`, regex patterns, enum memberships (`depJenisKendaraan` in `['', 'Mobil Pendingin', 'Non Pendingin']`), and `ownerUid == request.auth.uid` (or Tier 2 Driver identity matching `driverCode`).
6. **Immortal Fields & Temporal Integrity**:
   - `ownerUid`, `createdAt`, and primary `id` / `uid` / `driverId` fields cannot be mutated on `update` (and Tier 2 Driver updates additionally lock `sequenceNumber`, `noPenugasan`, and `driverCode`).
   - `createdAt == request.time` on `create`; `updatedAt == request.time` on both `create` and `update`.
7. **Terminal State Locking on Assignments**:
   - Assignment status strictly validates against `['Menunggu Berangkat', 'Dalam Perjalanan', 'Delivered', 'Handover', 'Selesai']`.
   - Once an assignment reaches a terminal completion state (`status == 'Selesai'` or `status == 'Handover'`), non-admin state mutations are locked out (`existing().status != 'Selesai' && existing().status != 'Handover'`), except for an explicit archive-link-only attachment (`incoming().status == existing().status && incoming().diff(existing()).affectedKeys().hasOnly(['driveFolderUrl', 'updatedAt'])`) or a verified admin (`isAdmin()`) corrective update, both strictly bound by `isValidAssignmentDoc(incoming())` and `affectedKeys().hasOnly(...)`.
8. **Zero-Blanket Secure List Queries**:
   - Collections that never require list queries (`/admins`, `/drivers/{id}/private`, `/configs`) omit `allow list` entirely.
   - Collections supporting real-time queries (`/drivers`, `/vehicles`, `/routes`, `/fleet_cards`, `/driver_expenses`, `/assignments`) enforce `resource.data.ownerUid == request.auth.uid` with zero `get()`/`exists()` calls inside `allow list`.

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 01 — Identity Spoofing (`ownerUid` mismatch)**: Authenticated user `uid_attacker` creates `/vehicles/UNT-001` with `ownerUid: "uid_victim"` -> `PERMISSION_DENIED`.
2. **Payload 02 — Email Spoofing (`email_verified: false`)**: Token claims `email: "dispatchercrk@gmail.com"` with `email_verified: false` creating `/admins/uid_spoof` -> `PERMISSION_DENIED`.
3. **Payload 03 — Shadow Field Injection (`isVerified: true`)**: Updating `/vehicles/UNT-001` with extra key `isVerified: true` -> `PERMISSION_DENIED`.
4. **Payload 04 — ID Poisoning (2,000-byte path ID / invalid chars)**: Creating `/routes/RT$INVALID!..` or >128-char ID -> `PERMISSION_DENIED`.
5. **Payload 05 — Value / Size Poisoning**: Updating `plateNumber` on `/vehicles/UNT-001` with a 500-char string (exceeding `maxLength: 32`) or boolean -> `PERMISSION_DENIED`.
6. **Payload 06 — Orphaned Subcollection Write**: Creating `/drivers/DRV-GHOST/private/credentials` without parent `/drivers/DRV-GHOST` in batch -> `PERMISSION_DENIED`.
7. **Payload 07 — Unpaired Driver Creation (Atomicity Violation)**: Creating `/drivers/DRV-001` without atomically writing `/drivers/DRV-001/private/credentials` -> `PERMISSION_DENIED`.
8. **Payload 08 — Terminal State Bypass**: Non-admin owner attempting to update `/assignments/ASG-001` when `existing().status == "Selesai"` or `"Handover"` -> `PERMISSION_DENIED`.
9. **Payload 09 — Immortal Field Mutation**: Owner updating `/routes/RT-001` while modifying `createdAt` or `ownerUid` -> `PERMISSION_DENIED`.
10. **Payload 10 — Forged Client Timestamp**: Creating `/routes/RT-001` with `createdAt` or `updatedAt` != `request.time` -> `PERMISSION_DENIED`.
11. **Payload 11 — Cross-Tenant PII Read**: Authenticated user `uid_other` attempting `get` on `/drivers/DRV-001/private/credentials` owned by `uid_dispatcher` -> `PERMISSION_DENIED`.
12. **Payload 12 — Blanket List Scraping**: Authenticated user running an unfiltered `list` query on `/assignments` where documents belong to another `ownerUid` -> `PERMISSION_DENIED`.

---

## 3. Test Runner Reference

Executable verification suite: `firestore.rules.test.ts` (validates structural invariants, blueprint parity, ESLint cleanliness, and evaluates all 12 Dirty Dozen payloads to confirm `PERMISSION_DENIED`).
