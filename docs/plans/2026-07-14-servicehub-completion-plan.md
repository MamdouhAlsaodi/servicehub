# ServiceHub Completion Implementation Plan

> **For Yui:** نفّذ هذا الـ plan بمهمات صغيرة، مع اختبار ثم مراجعة لكل مهمة قبل الانتقال لغيرها.

**Goal:** رفع ServiceHub من MVP تدريبي متوافق جزئياً مع PRD إلى مشروع Portfolio-ready قابل للعرض والتشغيل المحلي الموثوق، مع استكمال متطلبات الـ PRD ذات الأولوية.

**Architecture:** يبقى المشروع Modular Monolith: NestJS + Prisma + PostgreSQL للـ API وNext.js للـ Web. لا نغيّر محرك الحجز أو Payment Provider abstraction اللذين يعملان حالياً؛ نكمل حدود المنتج فوقهما، ثم نضيف quality/deployment readiness. Google OAuth سيكون **محاكاة Demo فقط** دون credentials أو اتصال بخدمة Google.

**Tech Stack:** NestJS, Prisma, PostgreSQL, Next.js 14, TypeScript, Jest/Supertest, `next-intl`, Swagger/OpenAPI, Docker, GitHub Actions.

**Baseline verified (2026-07-14):** API/Web builds pass؛ `69/69` tests pass؛ coverage lines: Auth 70.23%, Bookings 74.13%, Payments 87.61%.

---

## قواعد تنفيذ غير قابلة للتفاوض

1. لا OAuth حقيقي ولا Google Client ID/secret ولا redirect خارجي في هذا المشروع.
2. يضاف هذا التعليق حرفياً بجانب mock provider وواجهة الدخول والـ README:

```ts
// DEMO ONLY: Google OAuth is simulated for this portfolio project.
// No Google credentials, external authorization, or real user identity is used.
```

3. يبقى `MockPaymentProvider` هو المسار الافتراضي محلياً. Stripe الحقيقي لا يُفعّل أو تُضاف مفاتيحه أثناء هذه الخطة.
4. لا أسرار في Git. تبقى `.env`, `.env.*`, artifacts و`.hermes/` خارج الـ commit.
5. كل تعديل سلوكي يبدأ باختبار فاشل، ثم أقل تنفيذ يمرره، ثم test suite/build مناسب.
6. لا GitHub push تلقائياً؛ بعد كل milestone يُقدَّم diff ونتائج تحقق لممدوح أولاً.

---

## ترتيب المراحل والنتيجة المتوقعة

| المرحلة | الاسم | يرفع حالة المشروع إلى | شرط الإغلاق |
|---:|---|---|---|
| B1 | Auth Demo-Safe | Auth قابل للعرض بدون ادعاء OAuth حقيقي | simulated Google login + secure local auth boundary + tests |
| B2 | Vendor الحقيقة | Vendor dashboard متصل بالـ API | لا localStorage/mock data في workflows الأساسية |
| B3 | i18n الحقيقي | عربي RTL وإنجليزي LTR | switch شامل وواجهة سليمة باللغتين |
| B4 | Booking lifecycle | دورة الحجز مكتملة | transitions/reminders/notifications قابلة للاختبار |
| B5 | Marketplace commercial gaps | Admin/Vendor features المهمة | commission, export, payouts, moderation واضحة |
| B6 | Realtime communication | رسائل وتنبيهات مناسبة للـ MVP | booking-linked chat + realtime policy مثبتة |
| B7 | API & security finish | API قابلة للتجربة والتدقيق | Swagger + auth/CSRF/IDOR acceptance tests |
| B8 | Deploy readiness | تشغيل قابل للتكرار | Docker, CI, backup/monitoring runbook |
| B9 | Acceptance & portfolio release | PRD evidence-backed | E2E, performance baseline, final report ≥90% |

---

## B1 — Auth Demo-Safe

**Objective:** استكمال تجربة auth المتوقعة في الـ PRD من دون Google OAuth حقيقي، وإزالة الادعاء غير الدقيق بأن tokens هي HttpOnly إذا بقيت client-side.

### Task 1: تعريف عقد simulated Google login

**Files:**
- Create: `apps/api/src/modules/auth/dto/demo-google-login.dto.ts`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `apps/api/src/modules/auth/auth.service.ts`
- Test: `apps/api/src/modules/auth/auth.service.spec.ts`

**Steps:**
1. أضف test يثبت أن `POST /auth/demo-google-login` يقبل فقط identity demo محددة (`name`, `email`, `role`) ويُنشئ/يعيد user تجريبي.
2. نفّذ method صريح باسم `demoGoogleLogin`، ولا تسمّه OAuth callback.
3. أضف تعليق `DEMO ONLY` الحرفي أعلى method والـ endpoint.
4. تحقق: test auth targeted ثم `npm test -- --runInBand` من `apps/api`.

**Acceptance:** لا `googleapis` ولا client secrets ولا external redirect؛ response يوضح `authProvider: 'demo-google'`.

### Task 2: واجهة Google demo شفافة

**Files:**
- Modify: `apps/web/src/app/(auth)/login/page.tsx`
- Create/Modify: `apps/web/src/components/auth/DemoGoogleSignIn.tsx`
- Modify: `README.md`

**Steps:**
1. أضف test/component test أو assertion منطقي لكون الزر يحمل `Google (Demo)` وليس `Continue with Google`.
2. اعرض disclosure عربي/إنجليزي: «محاكاة للعرض فقط — لا يتم الاتصال بـ Google ولا استخدام حساب حقيقي».
3. ضع تعليق `DEMO ONLY` في component وREADME.
4. تحقق: `npm run build` من `apps/web`.

**Acceptance:** أي شخص يشاهد الـ UI يفهم أنها محاكاة، ولا يمكن أن يخلطها مع Google OAuth الحقيقي.

### Task 3: قرار token transport للـ portfolio

**Files:**
- Modify: `apps/web/src/contexts/AuthContext.tsx`
- Modify: `apps/api/src/modules/auth/auth.controller.ts`
- Modify: `docs/PRD-COMPLIANCE-REPORT-2026-07-14.md`
- Test: `apps/api/src/modules/auth/auth.service.spec.ts`

**Steps:**
1. اختر تنفيذ cookie-based demo آمن محلياً (HttpOnly access/refresh cookie + `credentials: include`) أو وثّق أن localStorage demo-only خارج production scope.
2. إن اختير cookie: أضف CSRF strategy واختبارات رفض الطلب state-changing دون token مناسب.
3. حدّث التقرير فقط بدليل اختبار، لا بوعد.
4. تحقق: auth tests + API build + Web build.

**Acceptance:** لا توجد فجوة بين ما تدعيه README/PRD وما يفعله التطبيق.

---

## B2 — Vendor Dashboard الحقيقة

**Objective:** استبدال `localStorage` وmock data في pages Vendor بمصادر API حقيقية، مع إكمال transitions للحجز.

### Task 4: API read models للوحة Vendor

**Files:**
- Modify: `apps/api/src/modules/bookings/bookings.service.ts`
- Modify: `apps/api/src/modules/bookings/bookings.controller.ts`
- Modify: `apps/api/src/modules/vendors/vendors.service.ts`
- Test: `apps/api/src/modules/bookings/bookings.service.spec.ts`

**Steps:**
1. اكتب tests لملخص Vendor: bookings اليوم، revenue، cancellations، services الأكثر طلباً.
2. أضف endpoint tenant-scoped لا يعيد إلا بيانات الـ Vendor المسجل.
3. أضف pagination وحدود limit صريحة.
4. تحقق: unit tests + IDOR negative test.

### Task 5: ربط dashboard والسجل والتوفر

**Files:**
- Modify: `apps/web/src/app/dashboard/page.tsx`
- Modify: `apps/web/src/app/dashboard/schedule/page.tsx`
- Modify: `apps/web/src/app/dashboard/bookings/page.tsx`
- Modify: `apps/web/src/app/dashboard/services/page.tsx`

**Steps:**
1. استبدل كل `localStorage`/demo object في workflow أساسي بـ `apiFetch`.
2. أضف loading, empty, error states.
3. تحقق من عدم بقاء `localStorage as mock API` في هذه الصفحات.
4. تحقق: API + Web builds، ثم browser QA لمسار Vendor.

### Task 6: booking status transitions

**Files:**
- Create: `apps/api/src/modules/bookings/dto/update-booking-status.dto.ts`
- Modify: `apps/api/src/modules/bookings/bookings.controller.ts`
- Modify: `apps/api/src/modules/bookings/bookings.service.ts`
- Test: `apps/api/src/modules/bookings/bookings.service.spec.ts`

**Steps:**
1. اختبر matrix الصلاحيات: Vendor يغيّر حجوزه فقط، Admin له policy منفصلة، Customer لا يفرض status.
2. نفذ transitions المسموحة وسبب إلزامي للرفض/cancel عند الحاجة.
3. تحقق من عدم كسر EXCLUDE/hold/payment invariants.
4. تحقق: bookings tests + race test لاحقاً في B9.

---

## B3 — i18n الحقيقي

**Objective:** Arabic RTL وEnglish LTR لجميع مسارات الـ Web الموجودة، دون ترجمة المحتوى الديناميكي خارج نطاق MVP.

### Task 7: تأسيس locale routing وmessages

**Files:**
- Create: `apps/web/messages/ar.json`
- Create: `apps/web/messages/en.json`
- Create/Modify: `apps/web/src/i18n/*`
- Modify: `apps/web/src/app/layout.tsx`
- Modify: `apps/web/src/middleware.ts`

**Steps:**
1. أضف `next-intl` فقط بعد pin للنسخة المتوافقة مع Next 14.
2. اكتب tests/smoke checks لمساري `/ar` و`/en`.
3. اجعل `<html lang dir>` ناتجاً من locale لا ثابتاً.
4. تحقق: `npm run build`.

### Task 8: ترجمة workflows الأساسية

**Files:**
- Modify: صفحات auth, discovery, vendor detail, book, checkout, bookings, notifications, dashboard, admin.

**Steps:**
1. انقل strings الثابتة إلى messages files، من دون تبديل محتوى services المخزن بعد.
2. أضف language switcher في navbar يحافظ على path عند الإمكان.
3. نفذ browser QA لكل من RTL/LTR: nav, cards, forms, calendar, checkout.
4. سجّل screenshots/نتائج QA في `docs/qa/` (لا تضع binaries كبيرة في Git).

**Acceptance:** لا يوجد نص ثابت رئيسي مكسور أو اتجاه مختلط في اللغة الأخرى.

---

## B4 — Booking Lifecycle وتنبيهات المواعيد

**Objective:** إكمال ما ينقص booking engine من reminders وتأكيد السلوك تحت concurrency، مع الإبقاء على DB constraint كمصدر الحقيقة.

### Task 9: reminder scheduler abstractions

**Files:**
- Create: `apps/api/src/modules/reminders/reminders.module.ts`
- Create: `apps/api/src/modules/reminders/reminders.service.ts`
- Modify: `apps/api/src/app.module.ts`
- Test: `apps/api/src/modules/reminders/reminders.service.spec.ts`

**Steps:**
1. لا ترسل email فعلياً؛ أنشئ `ReminderProvider` محلياً يسجل in-app notification قابلة للاختبار.
2. اختبر 24h و1h، dedup، وعدم إرسال reminder لحجز cancelled.
3. ضع comment واضح أن provider محلي لعرض المشروع وليس mail delivery production.
4. تحقق: targeted tests + full suite.

### Task 10: E2E booking race evidence

**Files:**
- Create: `apps/api/test/booking-race.int-spec.ts`
- Modify: `apps/api/test/setup.ts`

**Steps:**
1. استخدم test database منفصلة فقط.
2. أرسل 10 requests متوازية لنفس vendor/slot.
3. assert: نجاح واحد فقط والبقية `409`, ثم count في DB يساوي 1.
4. تحقق: `npm test -- --runInBand`.

---

## B5 — Marketplace Commercial Gaps

**Objective:** تنفيذ المتطلبات التجارية التي يطلبها PRD من دون دمج تحويلات مالية حقيقية.

### Task 11: Admin commission settings

**Files:**
- Modify: `apps/api/prisma/schema.prisma`
- Create: migration جديدة
- Modify: `apps/api/src/modules/admin/*`
- Test: `apps/api/src/modules/admin/admin.service.spec.ts`

**Steps:** أضف PlatformSettings singleton، endpoint Admin فقط، validation لنسبة 0–100، وأثبت أن payment intent يقرأ القيمة الصحيحة.

### Task 12: financial CSV exports

**Files:**
- Create: `apps/api/src/modules/admin/export/*`
- Modify: `apps/api/src/modules/admin/admin.controller.ts`
- Test: export spec

**Steps:** اكتب CSV streaming لا يحمل كل البيانات في الذاكرة؛ اختبر headers، date filter، authorization، وescaping للخانات.

### Task 13: Payout requests + review moderation + media decision

**Files:**
- Create: modules/models/DTOs حسب feature ownership.
- Modify: Prisma schema + migrations + Admin/Vendor pages.

**Steps:**
1. Payout = request state machine محلي (`REQUESTED/APPROVED/REJECTED/PAID`) بلا bank transfer.
2. Review report = flag → Admin resolution؛ لا حذف صامت.
3. Media: استخدم `imageUrl` validated URL فقط في MVP؛ لا تضف S3/Cloudinary قبل قرار نشر.
4. اختبر authorization وstate transitions.

---

## B6 — Messaging وRealtime policy

**Objective:** ربط المحادثة بحجز محدد وإكمال notifications ضمن مستوى MVP واضح.

### Task 14: booking-linked messaging

**Files:**
- Create: `apps/api/src/modules/messages/*`
- Modify: `apps/api/prisma/schema.prisma` + migration
- Create: `apps/web/src/app/bookings/[id]/messages/page.tsx` أو component مملوك لمسار booking
- Test: messages service spec

**Steps:** اختبر أن Customer/Vendor المشاركين فقط يمكنهما القراءة/الإرسال، وأن Admin read-only عند نزاع. أضف pagination وsanitization policy.

### Task 15: اتخاذ قرار realtime وتنفيذه

**Decision rule:** REST polling مقبول في MVP إذا وُثق كاختيار واعٍ؛ WebSocket يضاف فقط إذا كان الهدف هو PRD-complete demo وليس مجرد زيادة stack.

**Files:**
- Modify: `README.md`, `docs/PRD-COMPLIANCE-REPORT-2026-07-14.md`
- If WebSocket approved: create `apps/api/src/modules/realtime/*`, adapt notifications/messages Web UI.

**Acceptance:** لا ندّعي «WebSocket» بينما التطبيق polling. أولوية هذا الـ task تعتمد على قرار ممدوح بين MVP أو PRD-complete.

---

## B7 — API Documentation & Security Finish

### Task 16: Swagger/OpenAPI

**Files:**
- Modify: `apps/api/src/main.ts`
- Modify: controllers/DTOs بالـ annotations اللازمة
- Test: API docs smoke test

**Steps:** أضف `SwaggerModule` و`DocumentBuilder` وBearer auth؛ تحقق أن `/api/docs` يرد 200 من API فعلي.

### Task 17: security acceptance suite

**Files:**
- Create: `apps/api/test/security.int-spec.ts`
- Modify: auth guards/config فقط إن كشف الاختبار نقصاً.

**Test matrix:** IDOR services/bookings/payments; Vendor/Admin boundaries; invalid DTO fields stripped/rejected; throttling; refresh revocation; demo Google no-external-call proof.

---

## B8 — Deploy Readiness

### Task 18: reproducible local stack

**Files:**
- Create: `Dockerfile.api`, `Dockerfile.web`, `docker-compose.yml`
- Create: `.github/workflows/ci.yml`
- Create: `docs/operations/local-and-deploy-runbook.md`

**Steps:**
1. Compose يستخدم env variables فقط ولا يحمل `.env` إلى image layers.
2. CI يشغل install locked، Prisma validate/generate، tests، coverage gate، API build، Web build، secret scan.
3. runbook يشرح migration/rollback/health checks، ولا يدّعي نشر provider غير موجود.
4. تحقق: `docker compose config` ثم CI-equivalent commands محلياً.

### Task 19: backup + monitoring runbook

**Files:**
- Create: `scripts/backup-postgres.sh`
- Create: `scripts/restore-postgres.sh`
- Create: `docs/operations/backup-restore-drill.md`

**Steps:** scripts لا تحتوي passwords، تستخدم environment variables، وتثبت restore إلى DB مؤقتة. Monitoring MVP = `/health` + documented Uptime target؛ Sentry يحتاج DSN وقرار منفصل.

---

## B9 — Acceptance، Performance، والتسليم

### Task 20: full acceptance suite

**Files:**
- Create: `docs/qa/acceptance-checklist.md`
- Create: E2E test files حسب المسارات الناقصة
- Modify: `docs/PRD-COMPLIANCE-REPORT-2026-07-14.md`

**Required evidence:**
1. Auth → simulated Google login disclosure → vendor/customer role checks.
2. Discovery → booking → 10-way race → payment mock webhook → confirmed booking → review → notification.
3. Refund/dispute/commission/export paths.
4. Arabic RTL + English LTR browser QA.
5. API P95 baseline via repeatable local script، وLighthouse baseline للصفحة الرئيسية.
6. CI-equivalent clean run من clone جديد أو Docker compose.

### Task 21: final review and completion score

**Files:**
- Modify: `docs/PRD-COMPLIANCE-REPORT-2026-07-14.md`
- Create: `docs/RELEASE-READINESS.md`

**Steps:**
1. أعد تقييم كل PRD requirement فقط من evidence قابل للتنفيذ.
2. اذكر كل deferred item صراحةً (مثل payment real money أو monitoring provider إن لم يُعتمد).
3. لا تعلن 90%+ إلا إذا كان CI/build/E2E/i18n/deploy evidence موجوداً.
4. راجع git diff والأسرار قبل أي commit؛ الـ push قرار ممدوح.

---

## بوابة البداية المقترحة

ابدأ بـ **B1 — Auth Demo-Safe**. فهي تمنع تقديم OAuth محاكاة كأنه تكامل حقيقي، وتُغلق أكبر فجوة ثقة في التقرير قبل توسيع الميزات.

**أول task للتنفيذ عند الموافقة:** Task 1 فقط — عقد `demoGoogleLogin` واختباراته، دون لمس UI أو auth transport في نفس الدفعة.
