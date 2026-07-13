/**
 * Legacy test setup file — kept as a thin shim that delegates to
 * the new deterministic helper at `apps/api/test/helpers/prisma-test-db.ts`.
 *
 * Existing spec files import `{ prisma, cleanDatabase, disconnectPrisma }`
 * from this module. We preserve that API so the diff stays minimal,
 * but every operation now goes through the singleton client and the
 * FK-safe `truncateAll()`.
 *
 * The earlier implementation was missing:
 *   - Category (the table that polluted the dev DB during the
 *     previous test runs, leaving 217 stray rows).
 *   - A test-DB guard.
 *   - Deterministic single-instance lifecycle.
 *
 * The new helper fixes all three. See `prisma-test-db.ts`.
 */
import type { PrismaClient } from '@prisma/client';
import {
  getTestPrisma,
  resetPrismaTestDb,
  truncateAll,
} from '../../test/helpers/prisma-test-db';

/* Lazily-resolved singleton. We export a Proxy so call-sites can
 * write `prisma.user.create(...)` exactly as before. */
let cached: PrismaClient | null = null;
async function client(): Promise<PrismaClient> {
  if (!cached) cached = await getTestPrisma();
  return cached;
}

/**
 * Synchronous prisma accessor. Throws if the singleton is not yet
 * initialised. Existing spec files use this directly inside `it`
 * blocks, by which point the `beforeEach` has already called
 * `cleanDatabase()` and therefore `getTestPrisma()`.
 *
 * If a future spec forgets to call `cleanDatabase()` first, this
 * will throw — that is intentional: it surfaces lifecycle misuse
 * immediately instead of silently auto-connecting.
 */
export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    if (!cached) {
      throw new Error(
        '[test/setup] prisma accessed before initialisation. ' +
          'Call `await cleanDatabase()` in beforeEach or use ' +
          '`await getTestPrisma()` from apps/api/test/helpers/prisma-test-db.',
      );
    }
    return Reflect.get(cached, prop, receiver);
  },
});

/**
 * Cleanup helper — now FK-safe and includes Category.
 * Called from `beforeEach` in every spec file.
 */
export async function cleanDatabase(): Promise<void> {
  const db = await client();
  await truncateAll(db);
}

/**
 * Disconnect the singleton. Called from `afterAll`.
 *
 * Truncates first so the next test run starts from a known-empty
 * DB even if the spec file forgot to clean up after itself. This
 * is what makes the "test DB is empty after every run" claim hold.
 * Safe to call multiple times.
 */
export async function disconnectPrisma(): Promise<void> {
  if (cached) {
    try {
      await truncateAll(cached);
    } catch {
      /* swallow: teardown must never throw */
    }
  }
  await resetPrismaTestDb();
  cached = null;
}