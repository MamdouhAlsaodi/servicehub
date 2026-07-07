-- Phase 4: Payment provider abstraction.
-- 1. New enum PaymentProvider.
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE', 'MOCK');

-- 2. Add provider column with default STRIPE for existing rows.
ALTER TABLE "Payment"
  ADD COLUMN "provider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE';

-- 3. Rename stripePaymentIntentId → externalId (provider-agnostic).
ALTER TABLE "Payment" RENAME COLUMN "stripePaymentIntentId" TO "externalId";

-- 4. Add currency (default BRL — matches the existing Stripe config).
ALTER TABLE "Payment"
  ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'brl';

-- 5. Add clientSecret + lastEventId for webhook handling.
ALTER TABLE "Payment" ADD COLUMN "clientSecret" TEXT;
ALTER TABLE "Payment" ADD COLUMN "lastEventId" TEXT;

-- 6. The externalId index already exists (was on the old column). Add
--    a (provider, externalId) composite index for cross-provider safety.
CREATE INDEX "Payment_provider_externalId_idx" ON "Payment"("provider", "externalId");
