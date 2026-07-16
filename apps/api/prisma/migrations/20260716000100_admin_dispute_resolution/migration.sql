-- Admin-only resolution audit for the existing cancelled-booking dispute queue.
-- This does not introduce a customer claim-opening workflow.
CREATE TYPE "DisputeResolutionAction" AS ENUM ('FULL_REFUND', 'PARTIAL_REFUND', 'REJECT');
CREATE TYPE "DisputeResolutionStatus" AS ENUM ('PROCESSING', 'RESOLVED');

CREATE TABLE "DisputeResolution" (
  "id" TEXT NOT NULL,
  "bookingId" TEXT NOT NULL,
  "action" "DisputeResolutionAction" NOT NULL,
  "amount" DECIMAL(10,2),
  "reason" TEXT NOT NULL,
  "status" "DisputeResolutionStatus" NOT NULL DEFAULT 'PROCESSING',
  "decidedByUserId" TEXT NOT NULL,
  "decidedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "DisputeResolution_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DisputeResolution_bookingId_key" UNIQUE ("bookingId"),
  CONSTRAINT "DisputeResolution_reason_nonempty_check" CHECK (length(btrim("reason")) > 0),
  CONSTRAINT "DisputeResolution_reason_length_check" CHECK (length("reason") <= 1000),
  CONSTRAINT "DisputeResolution_amount_by_action_check" CHECK (("action" = 'REJECT' AND "amount" IS NULL) OR ("action" IN ('FULL_REFUND', 'PARTIAL_REFUND') AND "amount" IS NOT NULL AND "amount" > 0)),
  CONSTRAINT "DisputeResolution_finalization_check" CHECK (("status" = 'PROCESSING' AND "resolvedAt" IS NULL) OR ("status" = 'RESOLVED' AND "resolvedAt" IS NOT NULL))
);
ALTER TABLE "DisputeResolution" ADD CONSTRAINT "DisputeResolution_bookingId_fkey" FOREIGN KEY ("bookingId") REFERENCES "Booking"("id") ON DELETE CASCADE;
CREATE INDEX "DisputeResolution_status_idx" ON "DisputeResolution"("status");
CREATE INDEX "DisputeResolution_decidedByUserId_idx" ON "DisputeResolution"("decidedByUserId");
CREATE INDEX "DisputeResolution_decidedAt_idx" ON "DisputeResolution"("decidedAt");
