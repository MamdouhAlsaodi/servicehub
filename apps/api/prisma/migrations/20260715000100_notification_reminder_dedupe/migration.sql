-- ============================================================================
-- B4 — Appointment reminder deduplication column on Notification
-- ============================================================================
-- Goal: enable atomic, database-enforced deduplication of in-app reminder
-- notifications so the RemindersService can call `notification.create` with
-- a stable key like `booking:<bookingId>:reminder:<24h|1h>` and rely on
-- Postgres to reject duplicate keys with a P2002 error.
--
-- Why a NULLABLE column + UNIQUE index (not a partial index):
--   - Existing non-reminder notifications (booking confirmed, payment
--     received, review posted, etc.) do not carry a dedupe key. They
--     must keep inserting rows freely.
--   - Postgres UNIQUE indexes treat NULL as distinct, so existing
--     rows (and any new row that explicitly does not set dedupeKey)
--     remain unaffected. Only reminder rows that supply a key are
--     subject to the uniqueness constraint.
--
-- Safety:
--   - Purely additive: a new nullable column + a new index. No
--     destructive DDL. No NOT NULL defaults. No data backfill
--     required (existing rows get NULL automatically).
--   - ADD COLUMN IF NOT EXISTS / CREATE INDEX IF NOT EXISTS make the
--     migration idempotent for re-runs against a partially-migrated
--     database (e.g. if a prior attempt was interrupted).
--   - Uses the same `Notification_dedupeKey_key` index name that
--     Prisma's `@unique` would generate, keeping the schema and the
--     migration in lockstep so future `prisma migrate diff` runs are
--     a no-op against this migration.

ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "dedupeKey" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Notification_dedupeKey_key"
  ON "Notification"("dedupeKey");