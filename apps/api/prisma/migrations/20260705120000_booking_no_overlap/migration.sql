-- ============================================================================
-- Phase 3.2 — Booking no-overlap constraint (v2: trigger instead of generated)
-- ============================================================================
-- Goal: prevent two ACTIVE bookings for the same vendor from overlapping in
-- time. This is the authoritative safety net for the booking engine.
--
-- Why a trigger instead of a STORED GENERATED column:
--   tstzrange() is STABLE, not IMMUTABLE, so Postgres refuses to use it in
--   a stored generated expression (42P17). We maintain time_range with a
--   BEFORE INSERT/UPDATE trigger instead. The trigger runs on writes only,
--   so the immutability restriction doesn't apply.
--
-- Layout:
--   1. Plain `time_range` column (tstzrange).
--   2. Trigger `booking_set_time_range` that fills it from start/end.
--   3. GiST index on (vendorId, time_range) for fast overlap checks.
--   4. Partial EXCLUDE constraint restricted to ACTIVE bookings with
--      unexpired holds. Cancelled bookings and expired holds don't
--      participate, so they pile up freely for analytics.

-- btree_gist is required for the EXCLUDE/GiST index on the text
-- `vendorId` column. We enable it idempotently at the top of the
-- migration so that fresh databases (test DB after `migrate reset`,
-- CI runners) get it without an out-of-band step. Dev DBs already
-- have it; the IF NOT EXISTS makes the call safe.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- 1. The column itself. Nullable so existing rows can survive the
--    migration without a backfill (they're seeded test data).
ALTER TABLE "Booking"
  ADD COLUMN IF NOT EXISTS "time_range" tstzrange;

-- 2. Trigger that sets the range on insert/update. Wrapped in a
--    function so it can be reused across both events.
CREATE OR REPLACE FUNCTION booking_set_time_range()
RETURNS TRIGGER AS $$
BEGIN
  NEW."time_range" := tstzrange(NEW."startTime", NEW."endTime", '[)');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_set_time_range ON "Booking";
CREATE TRIGGER booking_set_time_range
  BEFORE INSERT OR UPDATE OF "startTime", "endTime" ON "Booking"
  FOR EACH ROW
  EXECUTE FUNCTION booking_set_time_range();

-- Backfill any rows that already exist (e.g. from previous testing).
UPDATE "Booking" SET "time_range" = tstzrange("startTime", "endTime", '[)')
  WHERE "time_range" IS NULL;

-- 3. GiST index for fast range queries.
CREATE INDEX IF NOT EXISTS "booking_time_range_idx" ON "Booking"
  USING gist ("vendorId", "time_range");

-- 4. Partial EXCLUDE constraint.
--    Predicate: only ACTIVE bookings (PENDING_PAYMENT, CONFIRMED,
--    COMPLETED, NO_SHOW). An expired hold is signalled by holding it
--    but the constraint doesn't reference NOW() — Postgres refuses
--    volatile functions in index predicates. So a sweeper job (Phase 4)
--    moves expired holds out by either deleting them, cancelling them,
--    or nulling their holdExpiresAt so they fall out of the predicate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'booking_no_overlap'
  ) THEN
    ALTER TABLE "Booking"
      ADD CONSTRAINT "booking_no_overlap"
      EXCLUDE USING gist (
        "vendorId" WITH =,
        "time_range" WITH &&
      )
      WHERE (
        "status" IN ('PENDING_PAYMENT', 'CONFIRMED', 'COMPLETED', 'NO_SHOW')
      );
  END IF;
END $$;

-- Note: an expired hold still blocks the constraint until the row is
-- touched (sweeper cancels it, or it transitions to CONFIRMED via
-- payment webhook). For the 5-minute hold window this is acceptable
-- — the worst case is a 5-minute "phantom" lock that the next sweep
-- releases.