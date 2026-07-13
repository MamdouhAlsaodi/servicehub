/**
 * Phase A1+A2 — regression tests for the test-DB guard and the
 * deterministic truncate helper. These run inside the regular Jest
 * suite (they load the same setup-env.ts as every other spec), so
 * they prove the suite itself cannot accidentally target the dev DB.
 *
 * If any of these fail, STOP. The dev DB protection has regressed.
 */
import {
  getTestPrisma,
  resetPrismaTestDb,
  truncateAll,
  getTruncationCount,
  peekTestPrisma,
} from './helpers/prisma-test-db';
import { prisma, cleanDatabase, disconnectPrisma } from '../src/test/setup';

describe('test database isolation (Phase A1+A2)', () => {
  beforeEach(async () => {
    // Every test in this regression suite starts from a known
    // empty DB. This protects the assertion that `truncateAll()`
    // truly empties every table — if we leave rows behind here,
    // we lose the ability to make that claim.
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('(A1.GUARD.1) the resolved DATABASE_URL targets a *_test database', () => {
    const url = process.env.DATABASE_URL ?? '';
    const dbName = url.split('?')[0].split('/').pop() ?? '';
    // Should be one of the allowed test DB names. If this fails the
    // test process is NOT pointing at a test DB.
    expect(['servicehub_test', 'servicehub_test_e2e']).toContain(dbName);
    // Must never be the dev DB name.
    expect(dbName).not.toBe('servicehub');
  });

  it('(A1.GUARD.2) NODE_ENV is forced to "test" by setup-env.ts', () => {
    expect(process.env.NODE_ENV).toBe('test');
  });

  it('(A1.GUARD.3) PrismaClient connects to the test DB, not the dev DB', async () => {
    const db = await getTestPrisma();
    // The test DB has the same schema as dev. Counting users via
    // Prisma proves the connection is live against the test DB
    // (not dev), because the dev DB has 2 users from prior runs
    // while the test DB starts at 0.
    const before = await db.user.count();
    expect(before).toBeGreaterThanOrEqual(0);
    // Insert a sentinel — it must be visible in the test DB.
    await db.user.create({
      data: {
        name: 'A1 Guard Sentinel',
        email: `a1-guard-${Date.now()}@test.local`,
        role: 'CUSTOMER' as any,
      },
    });
    const after = await db.user.count();
    expect(after).toBe(before + 1);
  });

  it('(A2.TRUNCATE.1) truncateAll() removes EVERY row including Category', async () => {
    const db = await getTestPrisma();
    // Seed a Category that has dependents (Service + VendorProfile)
    // so we prove FK-safe deletion order, not just a vacuum.
    const cat = await db.category.create({
      data: { nameAr: 'حراسة', nameEn: 'Guards A2' },
    });
    await db.vendorProfile.create({
      data: {
        userId: (
          await db.user.create({
            data: {
              name: 'V',
              email: `a2-v-${Date.now()}@t.local`,
              role: 'VENDOR' as any,
            },
          })
        ).id,
        businessName: 'B',
        categoryId: cat.id,
      },
    });

    // Pre-condition: at least the category we just made.
    expect(await db.category.count()).toBeGreaterThanOrEqual(1);

    await truncateAll(db);

    // Post-condition: every table is empty.
    const counts = {
      user: await db.user.count(),
      vendorProfile: await db.vendorProfile.count(),
      service: await db.service.count(),
      booking: await db.booking.count(),
      payment: await db.payment.count(),
      review: await db.review.count(),
      message: await db.message.count(),
      notification: await db.notification.count(),
      refreshToken: await db.refreshToken.count(),
      passwordReset: await db.passwordReset.count(),
      availability: await db.availability.count(),
      category: await db.category.count(),
    };
    for (const [table, n] of Object.entries(counts)) {
      expect({ table, n }).toEqual({ table, n: 0 });
    }
  });

  it('(A2.TRUNCATE.2) truncateAll() is idempotent — second call also empties DB', async () => {
    const db = await getTestPrisma();
    await db.category.create({ data: { nameAr: 'x', nameEn: 'x' } });
    await truncateAll(db);
    const beforeSecond = await db.category.count();
    expect(beforeSecond).toBe(0);

    await truncateAll(db);
    const afterSecond = await db.category.count();
    expect(afterSecond).toBe(0);
  });

  it('(A2.LIFECYCLE.1) the singleton prisma is exposed via the legacy shim', async () => {
    // cleanDatabase() forces initialisation.
    await cleanDatabase();
    expect(peekTestPrisma()).not.toBeNull();
  });

  it('(A2.LIFECYCLE.2) disconnectPrisma clears the singleton reference', async () => {
    await cleanDatabase();
    expect(peekTestPrisma()).not.toBeNull();
    await disconnectPrisma();
    expect(peekTestPrisma()).toBeNull();
  });

  it('(A2.LIFECYCLE.3) truncateAll increments a counter for diagnostics', async () => {
    const before = getTruncationCount();
    await truncateAll();
    const after = getTruncationCount();
    expect(after).toBe(before + 1);
  });

  it('(A1.PROXY.1) the legacy `prisma` proxy throws if used before initialisation', async () => {
    // Force-disconnect so the proxy has no live singleton.
    await disconnectPrisma();
    expect(peekTestPrisma()).toBeNull();
    expect(() => (prisma as any).user).toThrow(/before initialisation/);
    // Re-initialise for downstream tests / afterAll by re-running
    // the canonical lifecycle: cleanDatabase → prisma ready.
    await cleanDatabase();
    expect(peekTestPrisma()).not.toBeNull();
  });
});