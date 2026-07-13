/**
 * Phase A1 — Provision / reset the test database.
 *
 * This script:
 *   1. Loads `.env.test` (with override) and refuses to run if
 *      DATABASE_URL does not target a *_test database.
 *   2. Recreates the schema from the current prisma/schema.prisma
 *      using `prisma migrate reset --force --skip-seed`, but only
 *      against the test database URL.
 *   3. Never touches the development database.
 *
 * Usage:
 *   npm run db:test:reset
 *
 * Required env: a working `psql` (it shells out to `prisma`) and a
 * Postgres role that can CREATE / DROP the test database.
 */
import { execSync } from 'node:child_process';
import * as path from 'node:path';
import * as dotenv from 'dotenv';

const API_ROOT = path.resolve(__dirname, '..');
const ENV_TEST_PATH = path.join(API_ROOT, '.env.test');

const result = dotenv.config({ path: ENV_TEST_PATH, override: true });
if (result.error) {
  // eslint-disable-next-line no-console
  console.error(
    `[reset-test-db] FATAL: missing ${ENV_TEST_PATH}. ` +
      `Copy apps/api/.env.test.example to .env.test first.`,
  );
  process.exit(1);
}

const ALLOWED_TEST_DB_NAMES = new Set<string>([
  'servicehub_test',
  'servicehub_test_e2e',
]);

const dbUrl = process.env.DATABASE_URL ?? '';
const dbName = dbUrl.split('?')[0].split('/').pop() ?? '';

if (!ALLOWED_TEST_DB_NAMES.has(dbName)) {
  // eslint-disable-next-line no-console
  console.error(
    `[reset-test-db] FATAL: DATABASE_URL targets "${dbName}", ` +
      `which is NOT in the test allow-list. Refusing to reset.`,
  );
  process.exit(1);
}

// eslint-disable-next-line no-console
console.log(
  `[reset-test-db] Resetting schema in "${dbName}" via prisma migrate reset --force...`,
);

try {
  execSync('npx prisma migrate reset --force --skip-seed --schema=prisma/schema.prisma', {
    cwd: API_ROOT,
    stdio: 'inherit',
    env: {
      ...process.env,
      DATABASE_URL: dbUrl, // belt-and-braces
    },
  });
  // eslint-disable-next-line no-console
  console.log(`[reset-test-db] OK: "${dbName}" reset and migrations applied.`);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`[reset-test-db] FAILED: ${(err as Error).message}`);
  process.exit(1);
}