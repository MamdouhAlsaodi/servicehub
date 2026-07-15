# ServiceHub

> Multi-vendor booking marketplace — restaurants, salons, consultants,
> repair. Customers discover → book → pay → review. Vendors manage
> services, availability, and see their earnings.

Built as a multi-tenant SaaS with three first-class roles:
**Customer**, **Vendor**, **Admin**. Built in two days as a focused
MVP that you can actually deploy.

## Stack

| Layer | Tech |
| --- | --- |
| API | NestJS 11 + Prisma 5 + PostgreSQL 16 |
| Web | Next.js 14 (App Router) + Tailwind v4 |
| Auth | JWT (refresh tokens, role-based access) |
| Payments | Pluggable — Stripe (production) or Mock (dev/test) |
| Real-time | REST polling every 30s (no socket.io dep) |
| Tests | Jest + ts-jest, 26 specs covering Bookings + Reviews |

## Highlights

- **Race-safe booking engine** with a Postgres `EXCLUDE USING gist`
  constraint on `(vendorId, tstzrange)` — two simultaneous bookings on
  the same slot can never both succeed, even under heavy contention.
- **Provider-agnostic payments** — `StripePaymentProvider` and
  `MockPaymentProvider` share an interface; flip `PAYMENTS_PROVIDER`
  to swap. Production refuses to boot in `mock` mode.
- **Webhook handling** with raw-body capture (Express `verify`),
  HMAC verification, and idempotent state transitions — replays of
  the same Stripe event are no-ops.
- **Distinctive design system** built once and reused everywhere:
  forest-glass dark UI with Fraunces / Inter / JetBrains Mono, no
  template scaffolding.

## Features

### Customer
- Discover vendors by category, search, price range, rating
- View vendor profiles with services and reviews
- Book a service for a specific date/slot (5-min hold while paying)
- Pay via Stripe (or MOCK in dev)
- Cancel (>24h ahead) with reason
- Submit 1–5★ reviews after the booking is confirmed
- Real-time notification inbox (booking confirmed, payment received,
  payment failed, etc.)

### Vendor
- Apply (status starts PENDING, admin approves)
- CRUD services (title, price, durationMinutes, category)
- Set weekly availability (Mon–Fri 09:00–17:00 etc.) + exceptions
- See bookings inbox grouped by day
- Cancel any of their own bookings at any time
- Dashboard with KPI hero + bookings table

### Admin
- Approve / suspend vendors
- KPI snapshot (users, vendors, GMV, commission)
- 30-day revenue time-series
- Top vendors leaderboard
- Disputes queue (customer-cancelled bookings)

## Project layout

```
apps/
  api/                    NestJS service
    prisma/
      schema.prisma       Single source of truth for the data model
      migrations/         Forward-only schema migrations
    src/
      modules/
        auth/             register, login, refresh, vendor status, password reset
        vendors/          public profile + IDOR-safe reads + filters
        services/         CRUD with IDOR protection
        categories/       admin CRUD (45 seeded)
        availability/     weekly schedule + exceptions
        bookings/         create / available-slots / cancel + EXCLUDE
        payments/         Stripe + Mock abstraction + webhook handler
        reviews/          rating + comments + avgRating recompute
        notifications/    REST polling, fan-out from payments
        admin/            vendor mgmt + KPIs + reports + disputes
      shared/
        modules/prisma/   global PrismaService
        security/         password hashing (bcrypt)
    test/setup.ts         Prisma helpers (cleanDatabase, etc.)
  web/                    Next.js 14
    src/app/
      page.tsx            /                discovery + filters
      vendors/[id]/      vendor profile + services + reviews
      book/[serviceId]/  date picker + slot grid → booking
      bookings/          customer's bookings list
      checkout/[id]/     payment confirmation
      review/[bookingId]/ 5★ review
      notifications/     inbox (polling)
      admin/             dashboard
      dashboard/         vendor portal
      (auth)/            login / register / forgot-password / reset-password
docs/
  ARCHITECTURE.md
PLAN.md                   the full roadmap (Phases 1–7 in PLAN, plus the discovery extension)
```

## Quick start

```bash
# 1. Database
createdb servicehub
createuser servicehub --pwprompt   # password 'servicehub'
psql -d servicehub -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"

# 2. API
cd apps/api
cp .env.example .env              # then edit secrets
npm install
npx prisma migrate deploy
npx prisma generate
npm run build && npm start

# 3. Web (separate terminal)
cd apps/web
npm install
npm run build && npm start        # http://localhost:3000
```

For dev with hot-reload:
```bash
cd apps/api && npm run start:dev
cd apps/web && npm run dev
```

### MOCK payments

By default `PAYMENTS_PROVIDER=mock`. The MOCK provider exposes
`POST /api/v1/payments/mock-confirm` so the frontend can simulate
"payment succeeded" or "payment failed" without real Stripe keys.
Switch to `PAYMENTS_PROVIDER=stripe` in production and provide
`STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`.

### Local Stripe webhooks (optional)

```bash
stripe listen --forward-to localhost:3001/api/v1/payments/webhook
```

### Demo authentication (portfolio simulation only)

```
// DEMO ONLY: Google OAuth is simulated for this portfolio project.
// No Google credentials, external authorization, or real user identity is used.
```

The **Google (Demo)** button on `/login` does **not** talk to Google. It
calls a local `POST /api/v1/auth/demo-google-login` endpoint that mints
a real JWT for a fixed demo `CUSTOMER` identity. **Local only** — no
external network call, no OAuth SDK, no client ID, no redirect, no real
user identity. The disclosure is rendered under the button in Arabic
(مَحاكاة لِلعرض فَقط — لا يَتِم الاتِّصال بـ Google ولا استِخدام حِساب
حَقيقي) and English so portfolio evaluators cannot mistake the mock
for a production OAuth integration.

## Tests

```bash
cd apps/api
npx jest bookings    # 13 specs — happy path, overlap, race, cancel rules
npx jest reviews     # 7 specs — happy path, ownership, duplicate, distribution
```

## Roadmap

| Phase | Status |
| --- | --- |
| 1 — Auth (register, login, JWT, password reset) | ✅ |
| 2 — Vendor dashboard | ✅ |
| 3 — Booking engine + EXCLUDE constraint | ✅ |
| 4 — Payments (Stripe + Mock) | ✅ |
| 5 — Reviews + avgRating | ✅ |
| 6 — Notifications (REST polling) | ✅ |
| 7 — Admin dashboard | ✅ |
| 8 — Discovery (search, filters, vendor profile) | ✅ |

See `PLAN.md` for the original spec.

## License

Proprietary. © 2026.