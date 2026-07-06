-- Add timezone column to VendorProfile (default UTC for existing rows).
ALTER TABLE "VendorProfile"
  ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'UTC';
