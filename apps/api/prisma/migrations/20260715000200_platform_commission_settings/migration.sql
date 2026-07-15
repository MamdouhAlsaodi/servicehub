-- B5 — Singleton platform commission settings.
--
-- commissionRate is a decimal fraction: 10% is stored as 0.100000.
-- DECIMAL(7,6) exactly represents a percentage with up to four fractional
-- digits after conversion to a fraction (for example, 12.3456% = 0.123456).
-- The CHECK constraints keep the row singleton and the stored fraction in
-- range even if a future writer bypasses application validation.

CREATE TABLE "PlatformSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "commissionRate" DECIMAL(7,6) NOT NULL DEFAULT 0.100000,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlatformSettings_singleton_id_check" CHECK ("id" = 1),
    CONSTRAINT "PlatformSettings_commission_rate_check"
      CHECK ("commissionRate" >= 0 AND "commissionRate" <= 1)
);

-- Preserve an existing singleton if this insert is replayed independently;
-- otherwise establish the backward-compatible 10% default.
INSERT INTO "PlatformSettings" ("id", "commissionRate", "updatedAt")
VALUES (1, 0.100000, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO NOTHING;
