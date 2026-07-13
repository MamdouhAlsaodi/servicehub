# ServiceHub — Development Data Guide

> **Scope:** this file documents the canonical development dataset created by
> `prisma/seed.ts` and the fixture-audit/cleanup tooling in `scripts/`.

---

## Canonical Identities

All three accounts use the same locale (`ar`) and are unlocked by default.

| Role      | Email                       | Password    | Notes                                         |
|-----------|-----------------------------|-------------|-----------------------------------------------|
| Admin     | `admin@servicehub.local`    | `admin123`  | Full platform access, no vendor profile       |
| Vendor    | `sara@servicehub.local`     | `vendor123` | APPROVED, "صالون سارة" in São Paulo           |
| Customer  | `ahmad@servicehub.local`    | `customer123` | Unaffiliated; makes the canonical booking   |

**Dev/test identities that should NOT exist in production:**

| Email    | Role     | Status                              |
|----------|----------|-------------------------------------|
| `a@t.com` | CUSTOMER | Noisy — delete via audit/cleanup   |
| `b@t.com` | CUSTOMER | Noisy — delete via audit/cleanup   |

These two accounts (and any categories named `Restaurants`, `Test Category`,
or `Test`) are the target of `scripts/audit-and-clean-dev-fixtures.ts`.

---

## Canonical Categories

| ID              | English          | Arabic          | Icon |
|-----------------|------------------|-----------------|------|
| `cat-salon`     | Beauty Salons    | صالونات تجميل   | 💇   |
| `cat-fitness`   | Fitness          | لياقة بدنية     | 💪   |
| `cat-repair`    | Repair           | صيانة           | 🔧   |
| `cat-consulting`| Consulting       | استشارات        | 🧑‍💼  |

These four are the only categories the seed creates.  Categories named
`Restaurants`, `Test Category`, or `Test` are considered noisy fixtures
and are removed by the audit script when they have no vendor or service
references.

---

## Vendor: Sara's Salon

- **VendorProfile ID:** `vendorprofile-<cuid of sara@... user>`
- **Business:** صالون سارة للتجميل
- **Address:** São Paulo, SP (lat: −23.5505, lng: −46.6333)
- **Timezone:** `America/Sao_Paulo`
- **Status:** `APPROVED`
- **Availability:** Sunday–Thursday, 09:00–17:00 (local time)

### Services

| ID               | Title             | Duration | Price (BRL) |
|------------------|-------------------|----------|-------------|
| `svc-haircut`    | قص شعر نسائي      | 60 min   | 80          |
| `svc-manicure`   | مانيكير           | 45 min   | 40          |
| `svc-makeup`     | مكياج احترافي     | 90 min   | 150         |

---

## Canonical Confirmed Booking

- **Booking ID:** `seed-booking-haircut-001`
- **Status:** `CONFIRMED`
- **Date:** today + 2 days at 10:00 local time (deterministic — re-runs
  of seed update this to the future date automatically)
- **Service:** `svc-haircut` (BRL 80)
- **Commission:** BRL 8.00 (10 %)

### Mock Payment

- **Payment ID:** `seed-pay-seed-booking-haircut-001`
- **Provider:** `MOCK` (not Stripe — no credentials required)
- **Status:** `SUCCEEDED`
- **External ID:** `pi_mock_<timestamp>_seed-booking-haircut-001`
- **Amount:** BRL 80.00

### Review

- **Rating:** ⭐ 5
- **Comment:** "خدمة ممتازة! شكراً 💇‍♀️"
- **Linked to:** `seed-booking-haircut-001`

---

## Fixture Audit & Cleanup

### Why?

During development it is common to accumulate noisy data:

- Left-over categories from early schema sketches (`Restaurants`,
  `Test Category`, `Test`)
- Stray test users (`a@t.com`, `b@t.com`) created by ad-hoc scripts or
  buggy seed attempts

These pollute `prisma studio`, complicate manual testing, and can cause
flaky E2E tests.

### How it works

`scripts/audit-and-clean-dev-fixtures.ts` detects:

1. **Categories** whose `nameEn` or `nameAr` matches one of:
   `Restaurants`, `Test Category`, `Test` — and that have **zero
   VendorProfile or Service FK references**.
2. **Users** whose email is `a@t.com` or `b@t.com` — that have **zero
   Booking, Review, Message, Notification, or VendorProfile references**.

Only completely unreferenced rows are flagged for deletion.  Rows that are
noisy but still have FK references are reported but **skipped**.

### Guards

| Condition                          | Audit mode    | Apply mode                                   |
|------------------------------------|---------------|----------------------------------------------|
| DB name ≠ `servicehub`             | Warns, skips  | **Exits 1**                                  |
| `SERVICEHUB_DEV_CLEANUP_CONFIRM` missing or wrong | — | **Exits 1** |
| `--apply` flag absent             | N/A           | Exits 1 (must be explicit)                   |

### Commands

```bash
# Always-safe: audit only
npm run dev:fixtures:audit
npx ts-node scripts/audit-and-clean-dev-fixtures.ts

# Apply cleanup (guarded)
SERVICEHUB_DEV_CLEANUP_CONFIRM=clean-servicehub-fixtures \
  npm run dev:fixtures:apply
SERVICEHUB_DEV_CLEANUP_CONFIRM=clean-servicehub-fixtures \
  npx ts-node scripts/audit-and-clean-dev-fixtures.ts --apply
```

Expected output (audit mode):

```
════════════════════════════════════════════════════
  ServiceHub — Dev-Fixture Audit & Cleanup
════════════════════════════════════════════════════

[audit-fixtures] OK    Database guard: "servicehub" ✓
[audit-fixtures] DRY RUN — no changes will be made. Pass --apply to execute cleanup.

────────────────────────────────────────────────────
  Categories (noisy display names)
────────────────────────────────────────────────────
  • 1 unreferenced noisy category(ies) — will be deleted:
      id="cat-restaurants" nameEn="Restaurants" nameAr="مطاعم"
  • 0 noisy category(ies) with FK references — SKIPPED

────────────────────────────────────────────────────
  Users (noisy emails)
────────────────────────────────────────────────────
  • 2 unreferenced noisy user(s) — will be deleted:
      id="..." email="a@t.com" role="CUSTOMER"
      id="..." email="b@t.com" role="CUSTOMER"

────────────────────────────────────────────────────
  Summary
────────────────────────────────────────────────────
  • Categories to delete : 1
  • Users to delete       : 2
  • Total rows to remove  : 3

[audit-fixtures] Audit complete. Run with --apply to execute deletions.
```

---

## Seed Idempotency

The seed script is fully idempotent — safe to run after `prisma migrate dev`
and after partial manual data manipulation:

- All users use `upsert` (by unique `email`).
- All categories use `upsert` (by unique `id`).
- VendorProfile uses `upsert` (by unique `userId`).
- Services use `upsert` (by fixed `id` fields — `svc-haircut`, etc.).
- Availability uses `upsert` (by composite key `id`).
- The confirmed booking uses `upsert` (fixed ID `seed-booking-haircut-001`),
  updating `startTime` to today+2 each run.
- Payment and Review use `upsert` (by `bookingId` / fixed IDs).

---

## Safety boundary

This workflow intentionally has **no development reset command**. The supported path is:

1. Take a database backup.
2. Run the audit command and inspect its output.
3. Apply only the guarded fixture cleanup when every target is expected.
4. Run the idempotent demo seed.

A full schema reset is not part of normal development data maintenance, because it would destroy data that the audit cannot prove is test-only.
