/**
 * Pre-test environment loader for Jest.
 *
 * IMPORTANT: This file is referenced from `jest.config.js` via
 * `setupFiles` (NOT `setupFilesAfterEach`). That distinction matters:
 * `setupFiles` runs BEFORE the test framework and BEFORE the SUT is
 * imported, so `process.env.DATABASE_URL` is already set to the
 * test-only value by the time PrismaClient is constructed.
 *
 * Responsibilities:
 *   1. Load `.env.test` (override any pre-existing values).
 *   2. Force NODE_ENV=test.
 *   3. Fail-fast guard: if the resolved DATABASE_URL targets a
 *      development database, abort the suite before any test code
 *      runs and before Prisma ever connects.
 *
 * This is the primary A1 / A2 line of defence. If you ever weaken
 * the allow-list, you re-open the door to tests silently writing
 * to the development database.
 */
import * as path from 'path';
import * as dotenv from 'dotenv';

// __dirname when this file runs through ts-jest is apps/api/test,
// so one '..' lands on apps/api. Two '..' lands on apps/, which
// would silently pick up the wrong .env.test (or none).
const API_ROOT = path.resolve(__dirname, '..'); // apps/api
const ENV_TEST_PATH = path.join(API_ROOT, '.env.test');

/* 1. Load .env.test with override semantics so a leaked dev DATABASE_URL
 *    in the shell or in .env cannot survive into the test process.
 *    `quiet: true` suppresses dotenv's "injected env (5)" chatter that
 *    otherwise leaks into every Jest test output. */
const result = dotenv.config({
  path: ENV_TEST_PATH,
  override: true,
  quiet: true,
});

if (result.error) {
  // .env.test is missing — surface a clear, actionable error.
  // We deliberately do not auto-create it: the developer must
  // consciously opt in to test DB credentials.
  // eslint-disable-next-line no-console
  console.error(
    `[test-env] FATAL: could not load ${ENV_TEST_PATH}.\n` +
      `          Copy apps/api/.env.test.example to .env.test first.\n` +
      `          Underlying error: ${result.error.message}`,
  );
  process.exit(1);
}

/* 2. Force NODE_ENV=test regardless of what the shell exported. */
process.env.NODE_ENV = 'test';

/* 3. Fail-fast guard. The allow-list of test DB names is intentionally
 *    narrow. If your test DB has a different convention name, update
 *    BOTH this list AND apps/api/.env.test.example. */
const ALLOWED_TEST_DB_NAMES = new Set<string>([
  'servicehub_test',
  'servicehub_test_e2e',
]);

function extractDbName(databaseUrl: string): string {
  // Strip query string, then take the last path segment.
  const noQuery = databaseUrl.split('?')[0];
  const lastSlash = noQuery.lastIndexOf('/');
  return noQuery.slice(lastSlash + 1);
}

const dbUrl = process.env.DATABASE_URL ?? '';
if (!dbUrl) {
  // eslint-disable-next-line no-console
  console.error(
    '[test-env] FATAL: DATABASE_URL is empty after loading .env.test.\n' +
      '          Refusing to run tests against an unset database.',
  );
  process.exit(1);
}

const dbName = extractDbName(dbUrl);

/* A canonical dev DB name. Hard-coded to catch the most dangerous
 * misconfiguration even if someone renames the test DB. */
const FORBIDDEN_DEV_DB_NAMES = new Set<string>([
  'servicehub',
  'servicehub_dev',
  'servicehub_production',
  'postgres',
]);

if (FORBIDDEN_DEV_DB_NAMES.has(dbName)) {
  // eslint-disable-next-line no-console
  console.error(
    `[test-env] FATAL: tests refuse to run against database "${dbName}".\n` +
      `          DATABASE_URL=${dbUrl}\n` +
      `          Update .env.test to point at a *_test database ` +
      `(e.g. servicehub_test) and re-run.`,
  );
  process.exit(1);
}

if (!ALLOWED_TEST_DB_NAMES.has(dbName)) {
  // eslint-disable-next-line no-console
  console.error(
    `[test-env] FATAL: DATABASE_URL points at unrecognised database "${dbName}".\n` +
      `          Allowed test DB names: ${[...ALLOWED_TEST_DB_NAMES].join(', ')}.\n` +
      `          Add the new name to ALLOWED_TEST_DB_NAMES in ` +
      `apps/api/test/setup-env.ts AND to .env.test.example.`,
  );
  process.exit(1);
}

// Quiet by default — the FATAL messages above are enough signal.
// Set SERVICEHUB_TEST_ENV_VERBOSE=1 to see this line in CI logs.
if (process.env.SERVICEHUB_TEST_ENV_VERBOSE === '1') {
  // eslint-disable-next-line no-console
  console.log(
    `[test-env] OK: NODE_ENV=${process.env.NODE_ENV} DATABASE_URL targets "${dbName}".`,
  );
}