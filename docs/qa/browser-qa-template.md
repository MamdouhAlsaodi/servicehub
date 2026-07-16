# ServiceHub browser QA evidence template

Use one completed copy of this template per browser/device and locale. This is an evidence form, not a claim that any item passed. Set every row to **PASS**, **FAIL**, **BLOCKED**, or **NOT RUN** and link durable evidence (screenshot/video/HAR) for every PASS or FAIL.

## Session metadata

| Field | Value |
|---|---|
| Tester | |
| Date/time (UTC) | |
| Environment / base URL | |
| Browser and version | |
| OS / viewport | |
| Test accounts / fixture identifiers (no passwords or tokens) | |
| Build / commit identifier, if known | |
| Network notes | |

## Locale and direction setup

| Check | Arabic RTL | English LTR | Result / evidence |
|---|---|---|---|
| Set locale using the visible global language control | **NOT RUN** | **NOT RUN** | |
| Root document has expected `lang` and `dir` (`ar`/`rtl`; `en`/`ltr`) | **NOT RUN** | **NOT RUN** | |
| Header, menus, icons, keyboard focus, and logical alignment match text direction | **NOT RUN** | **NOT RUN** | |
| Locale remains correct after navigation and refresh | **NOT RUN** | **NOT RUN** | |
| No clipped, overlapping, untranslated, or reversed static UI is observed | **NOT RUN** | **NOT RUN** | |

## Public screens

| Screen / visual check | Arabic RTL result | English LTR result | Evidence / defect ID |
|---|---|---|---|
| Home/discovery: navigation, search/filter controls, cards, loading/error states | **NOT RUN** | **NOT RUN** | |
| Vendor detail: service data, ratings/reviews, booking call-to-action, responsive layout | **NOT RUN** | **NOT RUN** | |
| Public keyboard navigation and visible focus order | **NOT RUN** | **NOT RUN** | |

## Auth screens

| Screen / visual check | Arabic RTL result | English LTR result | Evidence / defect ID |
|---|---|---|---|
| Register: labels, validation, errors, submit state | **NOT RUN** | **NOT RUN** | |
| Login: labels, validation, error state, password visibility/control layout | **NOT RUN** | **NOT RUN** | |
| Forgot/reset password: form, validation, success/error state | **NOT RUN** | **NOT RUN** | |
| Demo-Google control is accurately disclosed as a local simulation, not external OAuth | **NOT RUN** | **NOT RUN** | |

## Customer booking, messaging, and post-booking screens

| Screen / visual check | Arabic RTL result | English LTR result | Evidence / defect ID |
|---|---|---|---|
| Booking page: slot selection, date/time formatting, validation, submit state | **NOT RUN** | **NOT RUN** | |
| Checkout: payment state, errors, confirmation hierarchy | **NOT RUN** | **NOT RUN** | |
| My bookings: list, status badges, dates, empty/error states | **NOT RUN** | **NOT RUN** | |
| Booking message thread: message direction, long text wrapping, timestamps, compose validation | **NOT RUN** | **NOT RUN** | |
| Review: rating input, comment, validation, success/error state | **NOT RUN** | **NOT RUN** | |
| Notifications: list, timestamps, read/unread visual state | **NOT RUN** | **NOT RUN** | |

## Vendor dashboard screens

| Screen / visual check | Arabic RTL result | English LTR result | Evidence / defect ID |
|---|---|---|---|
| Dashboard summary/KPIs: cards, charts, numeric/date formatting | **NOT RUN** | **NOT RUN** | |
| Services list/new-service form: controls, validation, responsive layout | **NOT RUN** | **NOT RUN** | |
| Schedule: calendar direction, dates, controls, overflow | **NOT RUN** | **NOT RUN** | |
| Vendor bookings: status controls, details, empty/error states | **NOT RUN** | **NOT RUN** | |

## Admin screens

| Screen / visual check | Arabic RTL result | English LTR result | Evidence / defect ID |
|---|---|---|---|
| Admin dashboard: tables/cards, filters, overflow, empty/error states | **NOT RUN** | **NOT RUN** | |
| Review/report moderation controls and confirmation/error states, where authorized | **NOT RUN** | **NOT RUN** | |

## Final result

| Area | Result | Evidence / notes |
|---|---|---|
| Arabic RTL public/auth/booking/dashboard/messaging | **NOT RUN** | |
| English LTR public/auth/booking/dashboard/messaging | **NOT RUN** | |
| Blocking defects | **NOT RUN** | |
| Follow-up owner / date | **NOT RUN** | |
