/**
 * ServiceHub — Audit & Clean Dev Fixtures Script
 * ===============================================
 *
 * Purpose
 * -------
 * During iterative development noisy fixture data (e.g. "Restaurants",
 * "Test Category", "Test") and stray test users (a@t.com, b@t.com)
 * accumulate and pollute the dev database. This script detects and, when
 * explicitly requested, removes them so `prisma seed` always starts from a
 * clean canonical state.
 *
 * Safety guards
 * -------------
 * 1. DEFAULT (no --apply flag) — audit only; prints findings, makes ZERO
 *    changes.
 * 2. --apply flag requires BOTH:
 *      - env SERVICEHUB_DEV_CLEANUP_CONFIRM=clean-servicehub-fixtures
 *      - DATABASE_URL database name must be exactly "servicehub"
 *    If either condition fails the script exits non-zero immediately.
 * 3. Only deletes categories that are completely unreferenced
 *    (no VendorProfile, no Service rows).
 * 4. Only deletes users whose email is one of the known noisy addresses
 *    AND who have no FK references (bookings, reviews, etc.).
 *
 * Usage
 * -----
 *   # Audit only (safe, always allowed)
 *   npx ts-node scripts/audit-and-clean-dev-fixtures.ts
 *
 *   # Audit only (explicit)
 *   npx ts-node scripts/audit-and-clean-dev-fixtures.ts --audit
 *
 *   # Apply cleanup (guarded)
 *   SERVICEHUB_DEV_CLEANUP_CONFIRM=clean-servicehub-fixtures \
 *     npx ts-node scripts/audit-and-clean-dev-fixtures.ts --apply
 *
 *   # Via npm scripts (see package.json)
 *   npm run dev:fixtures:audit
 *   npm run dev:fixtures:apply
 *
 * Exit codes
 * ---------
 *   0 – completed (audit mode always exits 0; apply exits 0 on success)
 *   1 – guard violation, DB name mismatch, or operation error
 */

import { parseArgs } from 'node:util';
import { PrismaClient } from '@prisma/client';

// ── Env & flag parsing ────────────────────────────────────────────────────────

const { values: flags } = parseArgs({
  options: {
    apply: { type: 'boolean', short: 'a', default: false },
    audit: { type: 'boolean', short: 'd', default: false }, // explicit audit flag
  },
  strict: false,
});

const isDryRun = !flags.apply;

const CONFIRM_TOKEN = 'clean-servicehub-fixtures';
const ALLOWED_DB = 'servicehub';

// ── Guards ───────────────────────────────────────────────────────────────────

const dbUrl = process.env.DATABASE_URL ?? '';
const dbName = (dbUrl.split('?')[0].split('/').pop() ?? '').toLowerCase();

// ── Logging helpers ───────────────────────────────────────────────────────────

type LogFn = (msg: string, ...rest: unknown[]) => void;
const info: LogFn = (msg, ...r) => console.log(`[audit-fixtures] INFO  ${msg}`, ...r);
const warn: LogFn = (msg, ...r) => console.warn(`[audit-fixtures] WARN  ${msg}`, ...r);
const ok: LogFn = (msg, ...r) => console.log(`[audit-fixtures] OK    ${msg}`, ...r);
const section = (title: string) =>
  console.log(`\n${'─'.repeat(72)}\n  ${title}\n${'─'.repeat(72)}`);

function bullet(label: string, ...rest: unknown[]) {
  console.log(`  • ${label}`, ...rest);
}

// ── Target data definitions ──────────────────────────────────────────────────

/** Category display names that are known development noise. */
const NOISY_CATEGORY_NAMES = new Set<string>([
  'Restaurants',  // typo/legacy leftover
  'Test Category',
  'Test',
]);

/** Email addresses that are known development/test noise. */
const NOISY_EMAILS = new Set<string>(['a@t.com', 'b@t.com']);

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log(
    `\n${'═'.repeat(72)}\n  ServiceHub — Dev-Fixture Audit & Cleanup\n${'═'.repeat(72)}`,
  );

  // ── Guard 1: database name ────────────────────────────────────────────────
  if (dbName !== ALLOWED_DB) {
    if (isDryRun) {
      warn(
        `Skipping database-name guard in AUDIT mode. ` +
          `Current DB="${dbName}", expected="${ALLOWED_DB}".`,
      );
    } else {
      console.error(
        `\n[audit-fixtures] FATAL: Cannot apply cleanup — ` +
          `database name resolves to "${dbName}", but this script only operates on ` +
          `"${ALLOWED_DB}".\n` +
          `  Hint: point DATABASE_URL at the approved development database.\n`,
      );
      process.exit(1);
    }
  } else {
    ok(`Database guard: "${ALLOWED_DB}" ✓`);
  }

  // ── Guard 2: confirmation token (only in apply mode) ─────────────────────
  if (isDryRun) {
    info(`DRY RUN — no changes will be made. Pass --apply to execute cleanup.`);
  } else {
    const token = process.env.SERVICEHUB_DEV_CLEANUP_CONFIRM ?? '';
    if (token !== CONFIRM_TOKEN) {
      console.error(
        `\n[audit-fixtures] FATAL: Missing or incorrect ` +
          `SERVICEHUB_DEV_CLEANUP_CONFIRM env var.\n` +
          `  Expected : ${CONFIRM_TOKEN}\n` +
          `  Got      : ${token || '(empty)'}\n` +
          `  Hint: SERVICEHUB_DEV_CLEANUP_CONFIRM=clean-servicehub-fixtures\n`,
      );
      process.exit(1);
    }
    ok(`Confirmation token verified ✓`);
  }

  const prisma = new PrismaClient();
  let hasErrors = false;

  try {
    // ── 1. Audit categories ──────────────────────────────────────────────────
    section('Categories (noisy display names)');

    const allCategories = await prisma.category.findMany({
      include: { _count: { select: { vendors: true, services: true } } },
      orderBy: { nameEn: 'asc' },
    });

    const noisyCategories = allCategories.filter(
      (c) =>
        NOISY_CATEGORY_NAMES.has(c.nameEn) ||
        NOISY_CATEGORY_NAMES.has(c.nameAr),
    );

    const unreferencedNoisyCategories = noisyCategories.filter(
      (c) => c._count.vendors === 0 && c._count.services === 0,
    );

    const referencedNoisyCategories = noisyCategories.filter(
      (c) => c._count.vendors > 0 || c._count.services > 0,
    );

    if (noisyCategories.length === 0) {
      ok('No noisy categories found.');
    } else {
      if (unreferencedNoisyCategories.length > 0) {
        bullet(
          `${unreferencedNoisyCategories.length} unreferenced noisy category(ies) — ` +
            `will be deleted:`,
        );
        for (const c of unreferencedNoisyCategories) {
          console.log(
            `      id="${c.id}" nameEn="${c.nameEn}" nameAr="${c.nameAr}"`,
          );
        }
      }
      if (referencedNoisyCategories.length > 0) {
        bullet(
          `${referencedNoisyCategories.length} noisy category(ies) with FK references — ` +
            `SKIPPED (will NOT be deleted):`,
        );
        for (const c of referencedNoisyCategories) {
          console.log(
            `      id="${c.id}" nameEn="${c.nameEn}" ` +
              `vendors=${c._count.vendors} services=${c._count.services}`,
          );
        }
      }
    }

    // ── 2. Audit noisy users ─────────────────────────────────────────────────
    section('Users (noisy emails)');

    const noisyUsers = await prisma.user.findMany({
      where: { email: { in: [...NOISY_EMAILS] } },
      include: {
        _count: {
          select: {
            bookings: true,
            reviews: true,
            messages: true,
            notifications: true,
            refreshTokens: true,
            passwordResets: true,
            vendorProfile: true,
          },
        },
      },
    });

    const unreferencedNoisyUsers = noisyUsers.filter(
      (u) =>
        u._count.bookings === 0 &&
        u._count.reviews === 0 &&
        u._count.messages === 0 &&
        u._count.notifications === 0 &&
        u._count.refreshTokens === 0 &&
        u._count.passwordResets === 0 &&
        u._count.vendorProfile === 0,
    );

    const referencedNoisyUsers = noisyUsers.filter(
      (u) =>
        u._count.bookings > 0 ||
        u._count.reviews > 0 ||
        u._count.messages > 0 ||
        u._count.notifications > 0 ||
        u._count.refreshTokens > 0 ||
        u._count.passwordResets > 0 ||
        u._count.vendorProfile > 0,
    );

    if (noisyUsers.length === 0) {
      ok('No noisy users found.');
    } else {
      if (unreferencedNoisyUsers.length > 0) {
        bullet(
          `${unreferencedNoisyUsers.length} unreferenced noisy user(s) — ` +
            `will be deleted:`,
        );
        for (const u of unreferencedNoisyUsers) {
          console.log(
            `      id="${u.id}" email="${u.email}" role="${u.role}"`,
          );
        }
      }
      if (referencedNoisyUsers.length > 0) {
        bullet(
          `${referencedNoisyUsers.length} noisy user(s) with FK references — ` +
            `SKIPPED (will NOT be deleted):`,
        );
        for (const u of referencedNoisyUsers) {
          console.log(
            `      id="${u.id}" email="${u.email}" ` +
              `bookings=${u._count.bookings} reviews=${u._count.reviews}`,
          );
        }
      }
    }

    // ── 3. Summary ───────────────────────────────────────────────────────────
    section('Summary');

    const totalToDelete =
      unreferencedNoisyCategories.length + unreferencedNoisyUsers.length;

    if (totalToDelete === 0) {
      ok('No noisy fixtures detected — database is clean.');
    } else {
      bullet(`Categories to delete : ${unreferencedNoisyCategories.length}`);
      bullet(`Users to delete       : ${unreferencedNoisyUsers.length}`);
      bullet(`Total rows to remove  : ${totalToDelete}`);
    }

    if (isDryRun) {
      info(
        `Audit complete. Run with --apply to execute deletions ` +
          `(requires SERVICEHUB_DEV_CLEANUP_CONFIRM=${CONFIRM_TOKEN}).`,
      );
    } else {
      // ── 4. Execute deletions ────────────────────────────────────────────────
      section('Executing deletions...');

      let deletedCategories = 0;
      let deletedUsers = 0;

      await prisma.$transaction(async (tx) => {
        // Delete categories first (no cascade needed since they're unreferenced)
        for (const c of unreferencedNoisyCategories) {
          await tx.category.delete({ where: { id: c.id } });
          deletedCategories++;
          console.log(`  DEL  category  id="${c.id}" nameEn="${c.nameEn}"`);
        }

        // Delete users (no FK references by definition)
        for (const u of unreferencedNoisyUsers) {
          await tx.user.delete({ where: { id: u.id } });
          deletedUsers++;
          console.log(`  DEL  user      id="${u.id}" email="${u.email}"`);
        }
      });

      section('Done');
      ok(
        `Deleted ${deletedCategories} category/ies and ${deletedUsers} user(s).`,
      );
    }
  } catch (err) {
    hasErrors = true;
    console.error(`\n[audit-fixtures] ERROR: ${(err as Error).message}`);
    if (!isDryRun) {
      console.error(
        '[audit-fixtures] Transaction rolled back — no partial changes committed.',
      );
    }
  } finally {
    await prisma.$disconnect();
  }

  if (hasErrors) process.exit(1);
}

main().catch((err) => {
  console.error('[audit-fixtures] FATAL:', err);
  process.exit(1);
});
