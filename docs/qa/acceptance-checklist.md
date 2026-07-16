# ServiceHub acceptance checklist

**Purpose:** record reproducible automated evidence and browser evidence without treating either as complete until it is actually run.  Every manual row begins **NOT RUN**; replace it only with the tester, date, browser/device, outcome, and durable evidence location.

## Evidence rules

- A passing test command proves only the assertions in that test; it does not prove an untested browser, production deployment, Stripe, email, or external OAuth integration.
- Commands below are exact repository commands and must be run from the stated directory. Test suites that use the test database require the repository's configured `servicehub_test` prerequisite; a failed prerequisite is recorded as a failure/blocker, not as a pass.
- The demo Google endpoint is a local simulation. Do not label it Google OAuth evidence.
- Attach a screenshot, video, HAR, CI URL, or terminal transcript in the `Evidence` field. Do not use a checkbox alone as evidence.

## Automated evidence matrix

| Required flow | Existing executable evidence | Working directory | Automated result | Manual browser result | Evidence |
|---|---|---|---|---|---|
| Auth login/logout refresh revocation and local demo-Google disclosure | `npx jest test/security-acceptance-gap.spec.ts --runInBand` | `apps/api` | **PASS** — included in the 2026-07-15 combined run (95 tests across 5 suites) | **NOT RUN** | Terminal output: combined Jest command in worker report |
| Auth/admin/vendor/message authorization boundaries, malformed message rejection, and Swagger security surface | `npx jest test/security-acceptance.spec.ts --runInBand` | `apps/api` | **PASS** — included in the 2026-07-15 combined run (95 tests across 5 suites) | **NOT RUN** | Terminal output: combined Jest command in worker report |
| Discovery → booking conflict protection / 10-way race | `npx jest test/booking-race.int-spec.ts --runInBand` | `apps/api` | **NOT RUN** | **NOT RUN** | |
| Booking payment/refund behavior | `npx jest src/modules/payments/payments.service.spec.ts src/modules/payments/payments.controller.spec.ts --runInBand` | `apps/api` | **PASS** — included in the 2026-07-16 full suite (242 tests / 17 suites) | **NOT RUN** | Terminal output: full Jest run |
| Admin dispute decision / audit workflow | `npx jest src/modules/admin/admin.service.spec.ts --runInBand` | `apps/api` | **PASS** — includes reject/full/partial decisions, duplicate claim protection, and provider-failure handling in the 2026-07-16 full suite | **NOT RUN** | Terminal output: full Jest run |
| Booking-linked messaging send/list/participant isolation | `npx jest src/modules/messages/messages.service.spec.ts --runInBand` | `apps/api` | **PASS** — included in the 2026-07-15 combined run (95 tests across 5 suites) | **NOT RUN** | Terminal output: combined Jest command in worker report |
| Completed-booking review and average-rating behavior | `npx jest src/modules/reviews/reviews.service.spec.ts --runInBand` | `apps/api` | **PASS** — included in the 2026-07-15 combined run (95 tests across 5 suites) | **NOT RUN** | Terminal output: combined Jest command in worker report |
| Review abuse-report/moderation behavior | `npx jest src/modules/reviews/reviews-moderation.service.spec.ts --runInBand` | `apps/api` | **PASS** — included in the 2026-07-15 combined run (95 tests across 5 suites) | **NOT RUN** | Terminal output: combined Jest command in worker report |
| Public API liveness endpoint | `npx jest --testRegex 'health\.int-spec\.ts$' --runInBand` | `apps/api` | **PASS** — 1 test / 1 suite on 2026-07-15 | **NOT RUN** | Terminal output: health Jest command in worker report |
| Refund/dispute/commission/export path | `npx jest src/modules/admin/export/financial-csv.service.spec.ts --runInBand` and `npx jest src/modules/payouts/payouts.service.spec.ts --runInBand` | `apps/api` | **NOT RUN** | **NOT RUN** | |
| Public health/docs timing sample | `API_BASE_URL=http://127.0.0.1:3001 ITERATIONS=20 sh scripts/performance-baseline.sh` | repository root | **NOT RUN** (requires an already-running API; this checklist does not start one) | n/a | |
| CI-equivalent clean clone / Compose run | No automated evidence is claimed by this checklist. Follow `docs/operations/local-and-deploy-runbook.md` only in a separately approved environment. | n/a | **NOT RUN** | n/a | |

## Manual browser QA evidence

Run each flow in both Arabic RTL and English LTR using `docs/qa/browser-qa-template.md`. The browser result stays **NOT RUN** until the template has a pass/fail result and evidence reference.

| Required browser flow | Arabic RTL | English LTR | Evidence |
|---|---|---|---|
| Public discovery and vendor detail | **NOT RUN** | **NOT RUN** | |
| Register/login/reset and demo-Google disclosure | **NOT RUN** | **NOT RUN** | |
| Customer booking, checkout, booking list, review, and notifications | **NOT RUN** | **NOT RUN** | |
| Booking-linked message thread | **NOT RUN** | **NOT RUN** | |
| Vendor dashboard, services, schedule, and bookings | **NOT RUN** | **NOT RUN** | |
| Admin dashboard and review/report controls | **NOT RUN** | **NOT RUN** | |

## Sign-off

| Role | Name | Date (UTC) | Scope reviewed | Decision | Evidence |
|---|---|---|---|---|---|
| QA | | | | **NOT RUN** | |
| Engineering | | | | **NOT RUN** | |
| Product | | | | **NOT RUN** | |
