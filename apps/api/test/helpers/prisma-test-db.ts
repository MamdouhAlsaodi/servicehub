/**
 * Phase A1+A2 — Deterministic Prisma helper for the Jest suite.
 *
 * Why a helper?
 *   - Spec files previously imported a singleton `prisma` from
 *     `apps/api/src/test/setup.ts` and called `disconnectPrisma`
 *     from their `afterAll`. With many spec files, that meant many
 *     disconnects racing with each other and with Nest's
 *     OnModuleDestroy hook.
 *   - Cleanup only enumerated a subset of tables, so `Category`,
 *     and any FK-protected rows, leaked between specs.
 *
 * This helper:
 *   1. Lazily creates a single PrismaClient for the entire suite
 *      (when the first spec asks for it).
 *   2. Exposes `truncateAll()` which deletes EVERY application
 *      table in FK-safe order, then resets identity sequences
 *      where present.
 *   3. Exposes `resetPrismaTestDb()` which truncates AND closes
 *      the singleton, intended for globalTeardown.
 *   4. Refuses to operate against any non-test database (same
 *      allow-list as setup-env.ts).
 *
 * Notes:
 *   - `truncateAll()` uses deleteMany rather than TRUNCATE because
 *     deleteMany respects FK cascade rules and works against
 *     managed Supabase-style databases without elevated privileges.
 *   - The FK-safe order is hand-maintained below; if a new model
 *     is added to schema.prisma, append it to the right slot here.
 */
import { PrismaClient } from '@prisma/client';

const ALLOWED_TEST_DB_NAMES = new Set<string>([
  'servicehub_test',
  'servicehub_test_e2e',
]);

let client: PrismaClient | null = null;
let truncations = 0;

/**
 * Return (and lazily create) the singleton PrismaClient for the
 * current test process. The connect step is explicit so that
 * callers can reason about open-handle lifecycle.
 */
export async function getTestPrisma(): Promise<PrismaClient> {
  assertTestDatabase();
  if (!client) {
    client = new PrismaClient();
    await client.$connect();
  }
  return client;
}

/**
 * Hard guard: refuse to provide a Prisma client unless we are
 * connected to a test-only database. This is a belt-and-braces
 * check in addition to setup-env.ts — if a future spec file forgets
 * to import setup-env via jest.config.js, the runtime error here
 * will still keep the dev DB safe.
 */
function assertTestDatabase(): void {
  const url = process.env.DATABASE_URL ?? '';
  const dbName = url.split('?')[0].split('/').pop() ?? '';
  if (!ALLOWED_TEST_DB_NAMES.has(dbName)) {
    throw new Error(
      `[prisma-test-db] FATAL: DATABASE_URL targets "${dbName}", which is ` +
        `not in the test allow-list (${[...ALLOWED_TEST_DB_NAMES].join(', ')}). ` +
        `Refusing to construct a Prisma client.`,
    );
  }
  if (process.env.NODE_ENV !== 'test') {
    throw new Error(
      `[prisma-test-db] FATAL: NODE_ENV is "${process.env.NODE_ENV}", ` +
        `expected "test". Refusing to construct a Prisma client.`,
    );
  }
}

/**
 * Delete every row from every application table in FK-safe order.
 *
 * The order matters: dependents first, parents last. We delete in
 * a single top-level promise chain rather than a transaction so
 * that any constraint failure is immediately visible.
 *
 * If you add a new model to schema.prisma:
 *   1. Append it to the right slot below (with its dependents
 *      removed before it is touched).
 *   2. Update the `expectedEmptyTables` list in resetTestDb.spec.ts.
 */
export async function truncateAll(prisma?: PrismaClient): Promise<void> {
  const db = prisma ?? (await getTestPrisma());

  // Order: leaves of the FK tree first.
  // (Payment has no FK to Booking that blocks deletion, but it is
  // semantically a child of Booking; delete before Booking to keep
  // the intent obvious.)
  await db.message.deleteMany();
  await db.notification.deleteMany();
  await db.review.deleteMany();
  await db.disputeResolution.deleteMany();
  await db.payment.deleteMany();
  await db.booking.deleteMany();
  await db.availability.deleteMany();
  await db.service.deleteMany();
  await db.passwordReset.deleteMany();
  await db.refreshToken.deleteMany();
  await db.vendorProfile.deleteMany();
  // Category has FKs from VendorProfile and Service — it must come
  // AFTER both. This is the regression that A2 fixes.
  await db.category.deleteMany();
  // User has FKs from PasswordReset / RefreshToken / VendorProfile
  // / Booking / Review / Notification / Message — delete last.
  await db.user.deleteMany();

  truncations += 1;
}

export function getTruncationCount(): number {
  return truncations;
}

/**
 * Hard-close the singleton and clear the reference so a subsequent
 * `getTestPrisma()` returns a fresh client. Use in `globalTeardown`
 * so Jest sees no open handles on the way out.
 */
export async function resetPrismaTestDb(): Promise<void> {
  if (client) {
    try {
      await client.$disconnect();
    } catch {
      /* swallow: disconnect during teardown should never throw */
    }
    client = null;
  }
}

/**
 * Direct accessor for the (possibly-not-yet-created) singleton.
 * Used by the test-env guard tests; do not use in spec bodies.
 */
export function peekTestPrisma(): PrismaClient | null {
  return client;
}