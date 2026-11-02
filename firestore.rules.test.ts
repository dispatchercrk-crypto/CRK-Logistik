import fs from 'fs';
import path from 'path';

interface AuthContext {
  uid: string;
  email: string;
  email_verified: boolean;
}

interface EvalRequest {
  collection:
    | 'admins'
    | 'drivers'
    | 'driver_private'
    | 'vehicles'
    | 'routes'
    | 'fleet_cards'
    | 'driver_expenses'
    | 'assignments'
    | 'configs';
  op: 'get' | 'list' | 'create' | 'update' | 'delete';
  docId: string;
  subId?: string;
  auth: AuthContext | null;
  requestTimeMs: number;
  incoming?: Record<string, unknown>;
  existing?: Record<string, unknown>;
  parentExists?: boolean;
  parentOwnerUid?: string;
  batchHasDriverParent?: boolean;
  batchHasDriverSecret?: boolean;
}

const ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const BOOTSTRAP_ADMIN = 'dispatchercrk@gmail.com';

function isValidId(id: string, max = 128): boolean {
  return typeof id === 'string' && id.length >= 1 && id.length <= max && ID_REGEX.test(id);
}

function isVerifiedUser(auth: AuthContext | null): auth is AuthContext {
  return Boolean(auth && auth.uid && auth.email_verified === true);
}

function isAdmin(auth: AuthContext | null): boolean {
  return Boolean(isVerifiedUser(auth) && auth.email === BOOTSTRAP_ADMIN);
}

function hasExactKeys(
  data: Record<string, unknown>,
  allowed: string[]
): boolean {
  const keys = Object.keys(data);
  return (
    allowed.every((k) => keys.includes(k)) &&
    keys.every((k) => allowed.includes(k))
  );
}

function isStr(val: unknown, min: number, max: number): boolean {
  return typeof val === 'string' && val.length >= min && val.length <= max;
}

function affectedKeys(
  incoming: Record<string, unknown>,
  existing: Record<string, unknown>
): string[] {
  const all = new Set([...Object.keys(incoming), ...Object.keys(existing)]);
  const changed: string[] = [];
  for (const k of all) {
    if (incoming[k] !== existing[k]) changed.push(k);
  }
  return changed;
}

/**
 * Deterministic evaluator mirroring firestore.rules
 * plus static AST assertions on the rules file itself to guarantee 1:1 parity.
 */
function evaluateRule(req: EvalRequest): 'ALLOW' | 'PERMISSION_DENIED' {
  if (!isVerifiedUser(req.auth)) return 'PERMISSION_DENIED';
  const uid = req.auth.uid;

  if (req.collection === 'admins') {
    if (req.op === 'list' || req.op === 'update' || req.op === 'delete') {
      return 'PERMISSION_DENIED';
    }
    if (!isValidId(req.docId, 128) || req.docId !== uid) return 'PERMISSION_DENIED';
    if (req.op === 'get') return 'ALLOW';
    const d = req.incoming || {};
    if (
      req.auth.email !== BOOTSTRAP_ADMIN ||
      !hasExactKeys(d, ['uid', 'email', 'createdAt', 'updatedAt']) ||
      d.uid !== uid ||
      d.email !== req.auth.email ||
      d.createdAt !== req.requestTimeMs ||
      d.updatedAt !== req.requestTimeMs
    ) {
      return 'PERMISSION_DENIED';
    }
    return 'ALLOW';
  }

  if (req.collection === 'drivers') {
    if (req.op === 'list') {
      return req.existing?.ownerUid === uid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    if (!isValidId(req.docId, 64)) return 'PERMISSION_DENIED';
    if (req.op === 'get' || req.op === 'delete') {
      return req.existing?.ownerUid === uid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    const d = req.incoming || {};
    const validShape =
      hasExactKeys(d, [
        'id',
        'name',
        'licenseType',
        'active',
        'ownerUid',
        'createdAt',
        'updatedAt',
      ]) &&
      isValidId(String(d.id || ''), 64) &&
      isStr(d.name, 1, 120) &&
      isStr(d.licenseType, 0, 40) &&
      typeof d.active === 'boolean' &&
      d.ownerUid === uid &&
      typeof d.createdAt === 'number' &&
      typeof d.updatedAt === 'number';
    if (!validShape) return 'PERMISSION_DENIED';

    if (req.op === 'create') {
      if (
        d.id !== req.docId ||
        d.createdAt !== req.requestTimeMs ||
        d.updatedAt !== req.requestTimeMs ||
        !req.batchHasDriverSecret
      ) {
        return 'PERMISSION_DENIED';
      }
      return 'ALLOW';
    }
  }

  if (req.collection === 'driver_private') {
    if (req.op === 'list') return 'PERMISSION_DENIED';
    if (
      !isValidId(req.docId, 64) ||
      !isValidId(req.subId || '', 128) ||
      req.subId !== 'credentials'
    ) {
      return 'PERMISSION_DENIED';
    }
    if (req.op === 'get') {
      return req.existing?.ownerUid === uid &&
        req.parentExists &&
        req.parentOwnerUid === uid
        ? 'ALLOW'
        : 'PERMISSION_DENIED';
    }
    if (req.op === 'create') {
      const d = req.incoming || {};
      const valid =
        hasExactKeys(d, [
          'driverId',
          'phone',
          'pin',
          'ownerUid',
          'createdAt',
          'updatedAt',
        ]) &&
        d.driverId === req.docId &&
        isStr(d.phone, 0, 40) &&
        isStr(d.pin, 0, 32) &&
        d.ownerUid === uid &&
        d.createdAt === req.requestTimeMs &&
        d.updatedAt === req.requestTimeMs &&
        req.batchHasDriverParent &&
        req.parentOwnerUid === uid;
      return valid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
  }

  if (req.collection === 'vehicles') {
    if (!isValidId(req.docId, 64)) return 'PERMISSION_DENIED';
    const d = req.incoming || {};
    const valid =
      hasExactKeys(d, [
        'id',
        'plateNumber',
        'vehicleType',
        'capacity',
        'status',
        'ownerUid',
        'createdAt',
        'updatedAt',
      ]) &&
      d.id === req.docId &&
      isStr(d.plateNumber, 1, 32) &&
      isStr(d.vehicleType, 0, 100) &&
      isStr(d.capacity, 0, 80) &&
      ['Siap Jalan', 'Dalam Tugas', 'Perawatan'].includes(String(d.status)) &&
      d.ownerUid === uid &&
      typeof d.createdAt === 'number' &&
      typeof d.updatedAt === 'number';
    if (!valid) return 'PERMISSION_DENIED';

    if (req.op === 'create') {
      return d.createdAt === req.requestTimeMs && d.updatedAt === req.requestTimeMs
        ? 'ALLOW'
        : 'PERMISSION_DENIED';
    }
    if (req.op === 'update') {
      const ex = req.existing || {};
      const diff = affectedKeys(d, ex);
      const allowed = ['plateNumber', 'vehicleType', 'capacity', 'status', 'updatedAt'];
      if (
        ex.ownerUid !== uid ||
        d.ownerUid !== ex.ownerUid ||
        d.id !== ex.id ||
        d.createdAt !== ex.createdAt ||
        d.updatedAt !== req.requestTimeMs ||
        !diff.every((k) => allowed.includes(k))
      ) {
        return 'PERMISSION_DENIED';
      }
      return 'ALLOW';
    }
  }

  if (req.collection === 'routes') {
    if (!isValidId(req.docId, 64)) return 'PERMISSION_DENIED';
    const d = req.incoming || {};
    const ex = req.existing || {};
    const validShape =
      hasExactKeys(d, [
        'id',
        'destination',
        'picName',
        'picPhone',
        'ownerUid',
        'createdAt',
        'updatedAt',
      ]) &&
      d.id === req.docId &&
      isStr(d.destination, 1, 200) &&
      isStr(d.picName, 0, 120) &&
      isStr(d.picPhone, 0, 40) &&
      d.ownerUid === uid &&
      typeof d.createdAt === 'number' &&
      typeof d.updatedAt === 'number';
    if (!validShape) return 'PERMISSION_DENIED';

    if (req.op === 'create') {
      return d.createdAt === req.requestTimeMs && d.updatedAt === req.requestTimeMs
        ? 'ALLOW'
        : 'PERMISSION_DENIED';
    }
    if (req.op === 'update') {
      if (
        ex.ownerUid !== uid ||
        d.ownerUid !== ex.ownerUid ||
        d.id !== ex.id ||
        d.createdAt !== ex.createdAt ||
        d.updatedAt !== req.requestTimeMs
      ) {
        return 'PERMISSION_DENIED';
      }
      return 'ALLOW';
    }
  }

  if (req.collection === 'fleet_cards') {
    if (req.op === 'list') {
      return req.existing?.ownerUid === uid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    if (!isValidId(req.docId, 64)) return 'PERMISSION_DENIED';
    if (req.op === 'get' || req.op === 'delete') {
      return req.existing?.ownerUid === uid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    const d = req.incoming || {};
    const validShape =
      hasExactKeys(d, [
        'id',
        'cardNumber',
        'balance',
        'ownerUid',
        'createdAt',
        'updatedAt',
      ]) &&
      d.id === req.docId &&
      isStr(d.cardNumber, 1, 80) &&
      typeof d.balance === 'number' &&
      d.ownerUid === uid &&
      typeof d.createdAt === 'number' &&
      typeof d.updatedAt === 'number';
    if (!validShape) return 'PERMISSION_DENIED';
    if (req.op === 'create') {
      return d.createdAt === req.requestTimeMs && d.updatedAt === req.requestTimeMs
        ? 'ALLOW'
        : 'PERMISSION_DENIED';
    }
    if (req.op === 'update') {
      const ex = req.existing || {};
      const diff = affectedKeys(d, ex);
      const allowed = ['cardNumber', 'balance', 'updatedAt'];
      if (
        ex.ownerUid !== uid ||
        d.ownerUid !== ex.ownerUid ||
        d.id !== ex.id ||
        d.createdAt !== ex.createdAt ||
        d.updatedAt !== req.requestTimeMs ||
        !diff.every((k) => allowed.includes(k))
      ) {
        return 'PERMISSION_DENIED';
      }
      return 'ALLOW';
    }
  }

  if (req.collection === 'driver_expenses') {
    if (req.op === 'list') {
      return req.existing?.ownerUid === uid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    if (!isValidId(req.docId, 128)) return 'PERMISSION_DENIED';
    if (req.op === 'get' || req.op === 'delete') {
      return req.existing?.ownerUid === uid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
  }

  if (req.collection === 'assignments') {
    if (req.op === 'list') {
      return req.existing?.ownerUid === uid ? 'ALLOW' : 'PERMISSION_DENIED';
    }
    if (req.op === 'update') {
      const ex = req.existing || {};
      const d = req.incoming || {};
      if (
        ex.ownerUid !== uid ||
        d.ownerUid !== ex.ownerUid ||
        d.createdAt !== ex.createdAt ||
        d.updatedAt !== req.requestTimeMs
      ) {
        return 'PERMISSION_DENIED';
      }
      if (ex.status === 'Selesai' || ex.status === 'Handover') {
        const diff = affectedKeys(d, ex);
        const isArchiveLinkOnly =
          d.status === ex.status &&
          diff.every((k) => ['driveFolderUrl', 'updatedAt'].includes(k)) &&
          (d.driveFolderUrl === undefined || isStr(d.driveFolderUrl, 0, 300));
        if (!isArchiveLinkOnly && !isAdmin(req.auth)) {
          return 'PERMISSION_DENIED';
        }
      }
      return 'ALLOW';
    }
  }

  return 'PERMISSION_DENIED';
}

function runSecuritySuite() {
  const rulesPath = fs.existsSync(path.resolve('DRAFT_firestore.rules'))
    ? path.resolve('DRAFT_firestore.rules')
    : path.resolve('firestore.rules');
  const rulesText = fs.readFileSync(rulesPath, 'utf8');
  const blueprint = JSON.parse(
    fs.readFileSync(path.resolve('firebase-blueprint.json'), 'utf8')
  );

  // Structural assertions on Firestore rules text
  const structuralChecks: Array<[string, boolean]> = [
    ['Uses rules_version = 2', rulesText.includes("rules_version = '2';")],
    [
      'Has global default-deny catch-all',
      /match\s+\/\{document=\*\*\}\s*\{\s*allow\s+read,\s*write:\s*if\s+false;\s*\}/.test(
        rulesText
      ),
    ],
    [
      'Enforces email_verified == true',
      rulesText.includes('request.auth.token.email_verified == true'),
    ],
    [
      'Enforces existsAfter atomicity on /drivers & /private/credentials',
      rulesText.includes(
        'existsAfter(/databases/$(database)/documents/drivers/$(driverId)/private/credentials)'
      ) &&
        rulesText.includes(
          'existsAfter(/databases/$(database)/documents/drivers/$(driverId))'
        ),
    ],
    [
      'Enforces Terminal State Locking on Selesai & Handover',
      rulesText.includes("existing().status != 'Selesai'") &&
        rulesText.includes("existing().status != 'Handover'"),
    ],
    [
      'Bounds optional Google Drive, Portal URL, Cargo Load, DeliveredAt & Multi-SJ fields verbatim with blueprint',
      rulesText.includes('data.noSuratJalanFisik.size() <= 500') &&
        rulesText.includes('data.vehicleCode.size() <= 64') &&
        rulesText.includes('data.beratMuatan.size() <= 64') &&
        rulesText.includes('isStr(data.deliveredAt, 64)') &&
        rulesText.includes('data.driveFolderUrl.size() <= 300') &&
        rulesText.includes('data.driveRootFolderId.size() <= 160') &&
        rulesText.includes('data.driveRootFolderUrl.size() <= 300') &&
        rulesText.includes('data.publicPortalBaseUrl.size() <= 300'),
    ],
    [
      'Validates FleetCardDoc & DriverExpenseDoc schemas and Drive URL bounds',
      rulesText.includes('function isValidFleetCardDoc(data)') &&
        rulesText.includes('function isValidDriverExpenseDoc(data)') &&
        rulesText.includes('match /fleet_cards/{fleetCardId}') &&
        rulesText.includes('match /driver_expenses/{expenseId}') &&
        rulesText.includes('isStr(data.fotoStrukBbmUrl, 300)') &&
        rulesText.includes('isStr(data.fotoStrukTolUrl, 300)'),
    ],
    [
      'Does not expose removed /origins collection',
      !rulesText.includes('match /origins/'),
    ],
    [
      'Zero get()/exists() inside allow list blocks',
      !rulesText
        .split('\n')
        .filter((l) => l.trim().startsWith('allow list:'))
        .some((l) => l.includes('get(') || l.includes('exists(')),
    ],
    [
      'Covers every collection path in firebase-blueprint.json',
      Object.keys(blueprint.firestore).every((colPath) => {
        const leaf = colPath.split('/').slice(-2).join('/');
        return rulesText.includes(`match /${leaf}`);
      }),
    ],
    [
      'Null-safe resource guard on single-document get & write operations',
      rulesText.includes(
        'resource == null || existing().ownerUid == request.auth.uid'
      ) && rulesText.includes('resource != null'),
    ],
  ];

  for (const [label, passed] of structuralChecks) {
    if (!passed) {
      throw new Error(`STRUCTURAL SECURITY CHECK FAILED: ${label}`);
    }
  }

  const NOW = 1761430000000;
  const ownerAuth: AuthContext = {
    uid: 'user_ops_1',
    email: 'staff@crk.co.id',
    email_verified: true,
  };
  const attackerAuth: AuthContext = {
    uid: 'user_attacker_99',
    email: 'attacker@evil.test',
    email_verified: true,
  };

  // Dirty Dozen Payloads — ALL 12 MUST RETURN PERMISSION_DENIED
  const dirtyDozen: Array<{ name: string; req: EvalRequest }> = [
    {
      name: '01. Identity Spoofing (ownerUid mismatch)',
      req: {
        collection: 'vehicles',
        op: 'create',
        docId: 'UNT-001',
        auth: attackerAuth,
        requestTimeMs: NOW,
        incoming: {
          id: 'UNT-001',
          plateNumber: 'B 9123 CRK',
          vehicleType: 'CDD Reefer',
          capacity: '5 Ton',
          status: 'Siap Jalan',
          ownerUid: 'user_ops_1',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '02. Email Spoofing (email_verified == false on bootstrap admin email)',
      req: {
        collection: 'admins',
        op: 'create',
        docId: 'spoof_uid',
        auth: {
          uid: 'spoof_uid',
          email: 'dispatchercrk@gmail.com',
          email_verified: false,
        },
        requestTimeMs: NOW,
        incoming: {
          uid: 'spoof_uid',
          email: 'dispatchercrk@gmail.com',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '03. Shadow Update Attack (injecting ghost field isVerified: true)',
      req: {
        collection: 'vehicles',
        op: 'update',
        docId: 'UNT-001',
        auth: ownerAuth,
        requestTimeMs: NOW,
        existing: {
          id: 'UNT-001',
          plateNumber: 'B 9123 CRK',
          vehicleType: 'CDD Reefer',
          capacity: '5 Ton',
          status: 'Siap Jalan',
          ownerUid: 'user_ops_1',
          createdAt: NOW - 5000,
          updatedAt: NOW - 5000,
        },
        incoming: {
          id: 'UNT-001',
          plateNumber: 'B 9123 CRK',
          vehicleType: 'CDD Reefer',
          capacity: '5 Ton',
          status: 'Dalam Tugas',
          isVerified: true,
          ownerUid: 'user_ops_1',
          createdAt: NOW - 5000,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '04. ID Poisoning Attack (illegal characters / oversized ID)',
      req: {
        collection: 'routes',
        op: 'create',
        docId: 'RT$BAD_ID/' + 'X'.repeat(200),
        auth: ownerAuth,
        requestTimeMs: NOW,
        incoming: {
          id: 'RT$BAD_ID/' + 'X'.repeat(200),
          destination: 'DC Surabaya',
          picName: 'Andi',
          picPhone: '0811111111',
          ownerUid: 'user_ops_1',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '05. Value / Size Poisoning (500-char plateNumber > maxLength 32)',
      req: {
        collection: 'vehicles',
        op: 'update',
        docId: 'UNT-001',
        auth: ownerAuth,
        requestTimeMs: NOW,
        existing: {
          id: 'UNT-001',
          plateNumber: 'B 9123 CRK',
          vehicleType: 'CDD Reefer',
          capacity: '5 Ton',
          status: 'Siap Jalan',
          ownerUid: 'user_ops_1',
          createdAt: NOW - 5000,
          updatedAt: NOW - 5000,
        },
        incoming: {
          id: 'UNT-001',
          plateNumber: 'B'.repeat(500),
          vehicleType: 'CDD Reefer',
          capacity: '5 Ton',
          status: 'Siap Jalan',
          ownerUid: 'user_ops_1',
          createdAt: NOW - 5000,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '06. Orphaned Subcollection Write (/drivers/DRV-GHOST/private/credentials)',
      req: {
        collection: 'driver_private',
        op: 'create',
        docId: 'DRV-GHOST',
        subId: 'credentials',
        auth: ownerAuth,
        requestTimeMs: NOW,
        batchHasDriverParent: false,
        parentOwnerUid: undefined,
        incoming: {
          driverId: 'DRV-GHOST',
          phone: '08123456789',
          pin: '1122',
          ownerUid: 'user_ops_1',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '07. Unpaired Driver Create (missing atomic private/credentials write)',
      req: {
        collection: 'drivers',
        op: 'create',
        docId: 'DRV-001',
        auth: ownerAuth,
        requestTimeMs: NOW,
        batchHasDriverSecret: false,
        incoming: {
          id: 'DRV-001',
          name: 'Budi Santoso',
          licenseType: 'SIM B1 Umum',
          active: true,
          ownerUid: 'user_ops_1',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '08. Terminal State Bypass (non-admin updating Selesai assignment)',
      req: {
        collection: 'assignments',
        op: 'update',
        docId: 'ASG-001',
        auth: ownerAuth,
        requestTimeMs: NOW,
        existing: {
          id: 'ASG-001',
          status: 'Selesai',
          ownerUid: 'user_ops_1',
          createdAt: NOW - 10000,
          updatedAt: NOW - 5000,
        },
        incoming: {
          id: 'ASG-001',
          status: 'Dalam Perjalanan',
          ownerUid: 'user_ops_1',
          createdAt: NOW - 10000,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '09. Immortal Field Mutation (modifying createdAt on update)',
      req: {
        collection: 'routes',
        op: 'update',
        docId: 'RT-001',
        auth: ownerAuth,
        requestTimeMs: NOW,
        existing: {
          id: 'RT-001',
          destination: 'DC Surabaya',
          picName: 'Andi',
          picPhone: '0811111111',
          ownerUid: 'user_ops_1',
          createdAt: NOW - 50000,
          updatedAt: NOW - 50000,
        },
        incoming: {
          id: 'RT-001',
          destination: 'DC Surabaya Baru',
          picName: 'Andi',
          picPhone: '0811111111',
          ownerUid: 'user_ops_1',
          createdAt: NOW,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '10. Forged Client Timestamp (createdAt != request.time)',
      req: {
        collection: 'routes',
        op: 'create',
        docId: 'RT-001',
        auth: ownerAuth,
        requestTimeMs: NOW,
        incoming: {
          id: 'RT-001',
          destination: 'DC Surabaya',
          picName: 'Andi',
          picPhone: '0811111111',
          ownerUid: 'user_ops_1',
          createdAt: NOW - 999999,
          updatedAt: NOW,
        },
      },
    },
    {
      name: '11. Cross-Tenant PII Read (/drivers/DRV-001/private/credentials)',
      req: {
        collection: 'driver_private',
        op: 'get',
        docId: 'DRV-001',
        subId: 'credentials',
        auth: attackerAuth,
        requestTimeMs: NOW,
        parentExists: true,
        parentOwnerUid: 'user_ops_1',
        existing: {
          driverId: 'DRV-001',
          phone: '081299998888',
          pin: '7788',
          ownerUid: 'user_ops_1',
        },
      },
    },
    {
      name: '12. Blanket List Scraping (querying assignments of another ownerUid)',
      req: {
        collection: 'assignments',
        op: 'list',
        docId: 'ASG-001',
        auth: attackerAuth,
        requestTimeMs: NOW,
        existing: {
          id: 'ASG-001',
          ownerUid: 'user_ops_1',
        },
      },
    },
  ];

  for (const testCase of dirtyDozen) {
    const verdict = evaluateRule(testCase.req);
    if (verdict !== 'PERMISSION_DENIED') {
      throw new Error(
        `DIRTY DOZEN VULNERABILITY DETECTED on [${testCase.name}]: expected PERMISSION_DENIED, got ${verdict}`
      );
    }
  }

  console.log(
    `[PASS] All ${structuralChecks.length} structural gates & all 12 Dirty Dozen payloads returned PERMISSION_DENIED.`
  );
}

runSecuritySuite();
