-- ============================================================================
-- B5 — Review moderation, ReviewReport audit table, Service.imageUrl
-- ============================================================================
-- Goal: auditable review moderation (no silent deletes) + media MVP that
-- stores ONLY an absolute imageUrl (no upload route, no provider, no
-- remote fetch).
--
-- Additive only: 3 enums, 3 new Review columns (DEFAULT VISIBLE keeps
-- historical behaviour), 1 new table, 1 nullable Service column. No
-- existing column is renamed/dropped/retyped; existing Review rows
-- see moderationStatus = VISIBLE via the DEFAULT.

-- 1. Enums
-- ────────────────────────────────────────────────────────────────────────────

CREATE TYPE "ReviewModerationStatus" AS ENUM ('VISIBLE', 'FLAGGED', 'HIDDEN');
CREATE TYPE "ReviewReportStatus"    AS ENUM ('OPEN', 'RESOLVED');
CREATE TYPE "ReviewReportAction"    AS ENUM ('KEEP_VISIBLE', 'HIDE');

-- 2. Review: moderation columns
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Review"
  ADD COLUMN "moderationStatus"    "ReviewModerationStatus" NOT NULL DEFAULT 'VISIBLE',
  ADD COLUMN "moderationChangedAt" TIMESTAMP(3),
  ADD COLUMN "moderationNote"      TEXT;

-- Supports the public list/stats filter.
CREATE INDEX "Review_moderationStatus_idx"
  ON "Review"("moderationStatus");

-- 3. ReviewReport table
-- ────────────────────────────────────────────────────────────────────────────

CREATE TABLE "ReviewReport" (
    "id"                 TEXT NOT NULL,
    "reviewId"           TEXT NOT NULL,
    "reporterUserId"     TEXT NOT NULL,
    "reason"             TEXT NOT NULL,
    "status"             "ReviewReportStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionAction"   "ReviewReportAction",
    "resolutionNote"     TEXT,
    "resolvedByUserId"   TEXT,
    "resolvedAt"         TIMESTAMP(3),
    "reportedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReviewReport_pkey" PRIMARY KEY ("id"),
    -- DB-level floor on reason: non-empty and <= 1000 chars, so the
    -- audit row cannot be abused as free-form storage even if a
    -- future writer bypasses application validation.
    CONSTRAINT "ReviewReport_reason_nonempty_check"
      CHECK (length(btrim("reason")) > 0),
    CONSTRAINT "ReviewReport_reason_length_check"
      CHECK (length("reason") <= 1000)
);

-- FK cascade: if a Review is deleted, its reports go with it.
ALTER TABLE "ReviewReport"
  ADD CONSTRAINT "ReviewReport_reviewId_fkey"
  FOREIGN KEY ("reviewId") REFERENCES "Review"("id")
  ON DELETE CASCADE;

-- Duplicate prevention: UNIQUE (reviewId, reporterUserId). Service maps P2002 → 409.
CREATE UNIQUE INDEX "ReviewReport_reviewId_reporterUserId_key"
  ON "ReviewReport"("reviewId", "reporterUserId");

-- Read paths: admin queue (status), per-review history, per-user history.
CREATE INDEX "ReviewReport_status_idx"
  ON "ReviewReport"("status");
CREATE INDEX "ReviewReport_reviewId_idx"
  ON "ReviewReport"("reviewId");
CREATE INDEX "ReviewReport_reporterUserId_idx"
  ON "ReviewReport"("reporterUserId");

-- ────────────────────────────────────────────────────────────────────────────
-- 4. Service.imageUrl — media MVP (URL only; no upload route, no provider)
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE "Service"
  ADD COLUMN "imageUrl" TEXT;