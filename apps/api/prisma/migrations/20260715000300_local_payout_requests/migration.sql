-- ============================================================================
-- B5 — Local payout-request state machine
-- ============================================================================
-- Goal: persist an auditable local state machine that tracks a vendor's
-- request to withdraw eligible earnings and an admin's response.
--
-- Why local-only (no provider call):
--   - This MVP records REQUEST → APPROVED/REJECTED → PAID as explicit
--     states that any operator can see in the admin UI. It does NOT call
--     any bank, payment provider, or external payout service.
--   - No `provider`, `externalPayoutId`, `accountNumber`, `iban`, `pixKey`,
--     or any payout credential is stored here. Marking PAID is an admin's
--     declaration that an out-of-band settlement has been performed.
--
-- Layout:
--   1. Enum `PayoutStatus` (REQUESTED / APPROVED / REJECTED / PAID).
--   2. Table `PayoutRequest` with vendor FK (cascade on vendor delete).
--   3. Three CHECK constraints: positive amount, currency fixed to 'brl'.
--   4. Plain indexes for vendor-scoped list and admin filters.
--   5. PARTIAL unique index that allows at most one ACTIVE (REQUESTED |
--      APPROVED) payout per vendor — the database-level guard for the
--      "no double allocation" business rule.
--
-- Safety properties:
--   - All money columns are DECIMAL(10,2); arithmetic must use Decimal
--     (never float) in the application layer.
--   - The partial unique index is what makes the conflict testable and
--     race-free: two concurrent insert attempts will deterministically
--     produce a P2002 unique-violation for the second one.
--   - CASCADE on vendor delete prevents orphan rows even if a vendor
--     profile is purged for GDPR / cleanup reasons.

-- 1. Enum.
CREATE TYPE "PayoutStatus" AS ENUM (
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'PAID'
);

-- 2. Table.
CREATE TABLE "PayoutRequest" (
    "id"                 TEXT NOT NULL,
    "vendorId"           TEXT NOT NULL,
    "amount"             DECIMAL(10,2) NOT NULL,
    "currency"           TEXT NOT NULL DEFAULT 'brl',
    "status"             "PayoutStatus" NOT NULL DEFAULT 'REQUESTED',
    "vendorNote"         TEXT,
    "adminReason"        TEXT,
    "requestedByUserId"  TEXT NOT NULL,
    "decidedByUserId"    TEXT,
    "paidByUserId"       TEXT,
    "requestedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt"          TIMESTAMP(3),
    "paidAt"             TIMESTAMP(3),
    "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PayoutRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PayoutRequest_amount_positive_check"
      CHECK ("amount" > 0),
    CONSTRAINT "PayoutRequest_currency_brl_check"
      CHECK ("currency" = 'brl')
);

-- 3. Vendor FK — cascade keeps the table clean if a vendor profile is
--    ever purged (e.g. account deletion). Mirrors Service → vendor FK.
ALTER TABLE "PayoutRequest"
  ADD CONSTRAINT "PayoutRequest_vendorId_fkey"
  FOREIGN KEY ("vendorId") REFERENCES "VendorProfile"("id")
  ON DELETE CASCADE;

-- 4. Plain indexes for the read paths.
--    - vendor-scoped list: (vendorId, requestedAt DESC) is the common sort.
--    - admin filter by status: (status) for dashboard queries.
--    - vendor + status compound for "my active payout" lookups.
CREATE INDEX "PayoutRequest_vendorId_idx"
  ON "PayoutRequest"("vendorId");
CREATE INDEX "PayoutRequest_status_idx"
  ON "PayoutRequest"("status");
CREATE INDEX "PayoutRequest_vendorId_requestedAt_idx"
  ON "PayoutRequest"("vendorId", "requestedAt");
CREATE INDEX "PayoutRequest_vendorId_status_idx"
  ON "PayoutRequest"("vendorId", "status");

-- 5. Partial unique index: at most one ACTIVE payout per vendor.
--    ACTIVE ≡ (REQUESTED OR APPROVED). PAID and REJECTED are terminal
--    and do not participate, so a vendor can request again after a
--    PAID or REJECTED request completes. The WHERE clause uses the
--    enum equality form Prisma uses in its own generated SQL, keeping
--    `prisma migrate diff` a no-op against this migration.
CREATE UNIQUE INDEX "PayoutRequest_one_active_per_vendor_uniq"
  ON "PayoutRequest"("vendorId")
  WHERE "status" IN ('REQUESTED', 'APPROVED');