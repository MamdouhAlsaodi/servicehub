# ServiceHub — تقرير مطابقة PRD ونسبة الاكتمال

**تاريخ التحليل:** 2026-07-14
**مصدر المتطلبات:** `docs/PRD.docx` (Product Requirements Document v1.0)
**نطاق الفحص:** كود `apps/api` و`apps/web`، الاختبارات، البناء، Git، وإعدادات النشر.
**نوع التقرير:** تحليل read-only للكود الحالي؛ لا يثبت تكاملات خارجية غير مُشغّلة مثل Stripe production أو البريد أو الاستضافة.

---

## الحكم التنفيذي

**نسبة اكتمال المشروع مقابل PRD: 61%**

ServiceHub وصل إلى **MVP قوي وظيفياً**: المسار الأساسي موجود (حسابات، Vendor، availability، حجز محمي من التعارض، payments abstraction، reviews، notifications، admin، discovery)، والـ API والـ Web يبنيان بنجاح، كما أن تغطية الوحدات الحرجة تتجاوز حد الـ PRD.

لكنه **ليس Production-ready بعد**. أكبر الفجوات ليست تجميلية: i18n عربي/إنجليزي حقيقي، WebSocket/email notifications، OAuth/تحقق البريد، تخزين التوكنات في HttpOnly cookies، عناصر Vendor Dashboard ما زالت mock/localStorage، ثم CI/CD وDocker وقياس الأداء/المراقبة.

> **التوصيف الصحيح الآن:** MVP تدريبي قابل للعرض والتطوير، وليس منصة منشورة أو جاهزة لمعالجة دفع حقيقي.

---

## منهجية حساب النسبة

النسبة ليست عدداً لملفات الكود؛ هي وزن لما طلبه الـ PRD:

| المحور | الوزن | النتيجة | سبب التقييم |
|---|---:|---:|---|
| المتطلبات الوظيفية | 70% | 60% | المسارات الأساسية موجودة، لكن متطلبات عالية مهمة ناقصة أو جزئية |
| الجودة/الأمان/الاختبارات | 20% | 78% | builds ناجحة وcoverage حرجة جيدة، مقابل ثغرات auth/client وغياب E2E/CI |
| التشغيل والنشر | 10% | 32% | إعداد محلي جيد، لكن لا Docker/CI/CD/monitoring/backup مُثبت |
| **المجموع الموزون** | **100%** | **60.8% → 61%** | تقريب لأقرب نسبة صحيحة |

حالة كل بند في الجداول التالية: **مكتمل** = دليل مباشر في الكود، **جزئي** = جزء من المطلوب أو بديل تطويري، **ناقص** = لا يوجد دليل قابل للتحقق في المستودع.

---

## أدلة التحقق المنفذة

| الفحص | النتيجة |
|---|---|
| API production build | ✅ `nest build` نجح |
| Web production build | ✅ `next build` نجح؛ 16 صفحة مولدة |
| API test coverage | ✅ `69/69` tests نجحت في 7 suites |
| Critical coverage | ✅ Auth `70.23%` lines، Bookings `74.13%`، Payments `87.61%` |
| All measured coverage | ✅ `77.70%` lines / `75.76%` statements |
| Git cleanliness | ⚠️ مجلدان غير متتبعين: `.hermes/` و`artifacts/` |
| Project Doctor | ⚠️ لا ملفات كبيرة؛ لكنه يؤكد Git غير نظيف قبل أي deploy |
| Root workspace commands | ⚠️ لا توجد npm workspaces فعلية في root؛ أوامر التحقق يجب تشغيلها من `apps/api` و`apps/web` |

---

## مطابقة المتطلبات الوظيفية

### 1) Auth وإدارة الحسابات

| PRD | الحالة | الدليل / الفجوة |
|---|---|---|
| AUTH-01 تسجيل email/password مع تفعيل البريد | **جزئي** | التسجيل موجود في `auth.service.ts`؛ لا email verification flow. |
| AUTH-02 Google OAuth 2.0 | **ناقص** | لا strategy أو routes أو package evidence لـ OAuth. |
| AUTH-03 Access/Refresh JWT في HttpOnly Cookie | **جزئي** | JWT + refresh-token revocation موجودان؛ Web يخزّن tokens في `localStorage` وcookie مكتوب client-side، وليس HttpOnly. |
| AUTH-04 Password reset صالح 15 دقيقة | **جزئي** | token وexpiry موجودان؛ في dev يعود token في response ولا يوجد email delivery production. |
| AUTH-05 Customer/Vendor + vendor approval | **مكتمل** | role، VendorProfile، وحالات pending/approve/suspend موجودة. |
| AUTH-06 lockout بعد 5 محاولات | **مكتمل** | `failedLoginAttempts` و15 دقيقة lock في `auth.service.ts`. |
| AUTH-07 logout/revocation | **مكتمل** | `refreshToken.updateMany({ revokedAt })` موجود. |

### 2) Vendor Dashboard والخدمات

| PRD | الحالة | الدليل / الفجوة |
|---|---|---|
| VEN-01 CRUD خدمة مع الصور | **جزئي** | CRUD محمي بالـ guards موجود؛ لا دليل لتخزين/رفع الصور في schema أو service. |
| VEN-02 recurring availability + exceptions | **مكتمل** | `availability` module يحتوي schedule وexceptions. |
| VEN-03 تقويم بصري يومي/أسبوعي/شهري | **جزئي** | صفحة schedule موجودة، لكنها تقرأ `localStorage` mock حالياً. |
| VEN-04 تأكيد/رفض/إتمام الحجز مع سبب | **جزئي** | توجد إدارة وعرض حجوزات؛ لا endpoint موثق لتغيير كل الحالات المطلوبة مع reason إلزامي. |
| VEN-05 KPI/charts | **جزئي** | صفحة dashboard موجودة لكن بها demo/mock data. |
| VEN-06 payout request/history | **ناقص** | لا module أو schema أو endpoints. |
| VEN-07 public reply to review | **ناقص** | لا model/endpoint لرد Vendor على review. |

### 3) Booking Engine

| PRD | الحالة | الدليل / الفجوة |
|---|---|---|
| BOOK-01 available slots من availability والحجوزات | **مكتمل** | `GET /bookings/available-slots` وBookingsService موجودان. |
| BOOK-02 منع double booking في DB | **مكتمل** | `EXCLUDE USING gist`/`tstzrange` موثق في BookingService ومختبر. |
| BOOK-03 hold لمدة 5 دقائق | **مكتمل** | `holdExpiresAt` و`HOLD_MINUTES` والتعامل مع انتهاء hold موجود. |
| BOOK-04 customer cancellation policy | **مكتمل** | endpoint cancel وقواعد الإلغاء مغطاة بالاختبارات. |
| BOOK-05 reminders قبل 24h و1h | **ناقص** | لا scheduler/cron evidence. |
| BOOK-06 booking history للطرفين | **مكتمل** | endpoints `GET /bookings/me` وصفحات customer/vendor موجودة. |

### 4) Payments وCommission

| PRD | الحالة | الدليل / الفجوة |
|---|---|---|
| PAY-01 Stripe Test Mode | **جزئي** | abstraction لـ Stripe/Mock موجود؛ الواجهة الحالية تعتمد mock-confirm في dev ولم يُثبت Stripe E2E. |
| PAY-02 adjustable commission | **جزئي** | commission محفوظة في البيانات؛ لا دليل endpoint Admin لتعديلها. |
| PAY-03 signed Stripe webhook قبل confirm | **مكتمل** | raw body + verification + idempotent handling موجودة في bootstrap/payments. |
| PAY-04 full/partial refunds | **مكتمل** | refund endpoint وPaymentsService tests موجودة. |
| PAY-05 CSV financial export | **جزئي** | توجد خدمة التصدير واختبار وحدة في `apps/api/src/modules/admin/export/financial-csv.service.spec.ts`؛ لا يوجد في هذا التقرير دليل تشغيل HTTP أو browser/export فعلي. |

### 5) Admin وDiscovery وReviews

| المجال | الحالة | الدليل / الفجوة |
|---|---|---|
| ADM-01 approve/reject Vendor مع documents | **جزئي** | approve/suspend موجودان؛ لا documents verification أو rejection reason واضح. |
| ADM-02 suspend Vendor/Customer | **جزئي** | suspend Vendor موجود؛ لا دليل لإدارة Customer. |
| ADM-03 revenue/report filtering | **مكتمل** | `admin/reports/revenue` وKPI/top-vendors موجودة. |
| ADM-04 disputes/refund decision | **مكتمل ضمن نطاق الـ MVP** | `POST /admin/disputes/:bookingId/resolve` يدعم `FULL_REFUND`/`PARTIAL_REFUND`/`REJECT` للحجوزات الملغاة في queue، بسجل تدقيق دائم ومنع القرار المكرر. لا توجد بعد بوابة مستقلة لفتح claims من العميل. |
| ADM-05 category management | **مكتمل** | Categories CRUD محمي. |
| SRCH-01 text search | **مكتمل** | vendor discovery/search موجود. |
| SRCH-02 category/price/rating/location/radius | **جزئي** | filters موجودة؛ لا دليل geospatial radius حقيقي أو full PostgreSQL FTS. |
| SRCH-03 sort (nearest/rating/price/newest) | **جزئي** | جزء من sorting موجود؛ nearest يعتمد على geospatial غير مثبت. |
| SRCH-04 public SEO vendor page | **مكتمل** | route `vendors/[id]` موجودة. |
| REV-01 verified review فقط بعد completed booking | **مكتمل** | ReviewsService يتحقق من booking/ownership/status. |
| REV-02 1–5 + comment + optional photos | **جزئي** | rating/comment موجودان؛ لا صور. |
| REV-03 avg rating في البحث | **مكتمل** | avgRating recompute/query موجود. |
| REV-04 abuse report | **جزئي** | توجد اختبارات moderation/report في `apps/api/src/modules/reviews/reviews-moderation.service.spec.ts`؛ لا يوجد في هذا التقرير دليل تشغيل browser أو workflow تشغيلي فعلي. |

### 6) Messaging وNotifications وi18n

| PRD | الحالة | الدليل / الفجوة |
|---|---|---|
| MSG-01 booking-linked direct chat | **جزئي** | توجد `MessagesController` و`MessagesService` واختبارات خدمة في `apps/api/src/modules/messages/messages.service.spec.ts`، وصفحة `apps/web/src/app/bookings/[id]/messages/page.tsx`؛ لم يُسجل browser acceptance evidence هنا. |
| NOTIF-01 WebSocket real-time | **جزئي** | notifications موجودة، لكن التنفيذ REST polling كل 30 ثانية صراحةً، لا Socket.io. |
| NOTIF-02 fallback email | **ناقص** | لا mail provider/queue. |
| I18N-01 Arabic RTL + English LTR كامل | **جزئي** | يوجد تبديل locale في `apps/web/src/contexts/PreferencesContext.tsx` وكتالوج في `apps/web/src/i18n/messages.ts`، مع ضبط `lang`/`dir` في `apps/web/src/app/layout.tsx`؛ لا يوجد browser QA مُنفذ وموثق في هذا التقرير. |
| I18N-02 translatable service content | **ناقص** | `Service.title/description` حقول أحادية اللغة. |

---

## متطلبات غير وظيفية: الحالة والمخاطر

| المجال | الحالة | الملاحظة |
|---|---|---|
| Password hashing / ORM / validation | ✅ جيد | bcrypt، Prisma، وValidationPipe whitelist موجودة. |
| Authorization / IDOR | ✅ جيد مبدئياً | guards موجودة في الموديولات الحساسة؛ يلزم E2E negative tests أوسع. |
| CSRF | ⚠️ Double-submit guard مركّب لكن غير مختبر في الإنتاج | `CsrfGuard` عام على `AuthModule`، يقرأ `csrf_token` (JS-readable) + `x-csrf-token` فقط حين يكون `access_token` cookie موجوداً؛ تغطية وحدة للـ guard في `guards/csrf.guard.spec.ts`. لا يثبت حماية deployments حقيقية (انظر "حدود النطاق" أدناه). |
| API throttling | ✅ موجود | Auth module يستخدم Throttler. |
| Secrets | ✅ جيد | `.env.*` مستثنى و`.env.example` مسموح. |
| Swagger/OpenAPI | ❌ ناقص | لا `SwaggerModule` في `main.ts` ولا route `/api/docs`. |
| Redis caching | ❌ ناقص | لا Redis integration evidence. |
| Pagination | ✅ موجود في عدة قوائم | `take`/limit في vendors/services/reviews/notifications/admin. |
| Performance P95 <300ms / LCP <2.5s | ❌ غير مقاس | يوجد harness قابل للتكرار في `scripts/performance-baseline.sh` لقياس health وdocs على API يعمل مسبقاً، لكن لا توجد عينات منفذة أو LCP/production telemetry موثقة. |
| Backup/restore | ❌ ناقص | لا automated backup/restore evidence. |
| Docker + CI/CD | ❌ ناقص | لم يُعثر على Dockerfile أو compose أو GitHub Actions workflow. |
| Monitoring (Sentry/Uptime) | ❌ ناقص | لا integration evidence. |

---

## أدلة B1-4 (CSRF + HttpOnly) — حدود النطاق

| البند | الدليل المحقق فعلياً | غير مُثبت |
|---|---|---|
| `csrf_token` cookie | يُصدر مع كل login / refresh / demo-google-login عبر `crypto.randomBytes(32).toString('hex')`، ويُلغى مع logout بنفس attributes (`path=/`, `sameSite=lax`, `secure` في production فقط، `httpOnly:false`). | لا E2E curl-jarsmoke محدد لهذه المهمة (انخفض عن B1-3 smoke لإبقاء النطاق محصوراً). |
| `CsrfGuard` | مسجّل كـ `APP_GUARD` في `AuthModule`، يمرّر GET/HEAD/Options ويُفعّل الفحص فقط عند وجود `access_token` cookie، يقارن بـ `timingSafeEqual` بعد equal-length check. | لا اختبار E2E يثبته عبر HTTP stack كامل. |
| `apiFetch` (web) | يضيف `x-csrf-token` فقط على POST/PUT/PATCH/DELETE من `document.cookie`؛ لا يقرأ `access_token` أو `refresh_token`. | — |
| Tests | `apps/api/src/modules/auth/guards/csrf.guard.spec.ts` يغطي: safe-method pass، no-cookie pass، match accept، mismatch reject، missing cookie/header reject، length mismatch reject، empty cookie reject، multi-value header accept. | لا integration suite يحاكي تسجيل دخول كامل ثم logout مع/بدون CSRF header. |

> **حدود صريحة:** هذه الأدلة تَصِف ما هو مكتوب ومُختبَر كوحدة منعزلة في حدود `apps/api` و`apps/web` لهذا الـ commit. لا تثبت أمان deployments حقيقية، ولا تحل محل E2E tests، ولا تختبر على متصفح حقيقي، ولا تتحقق من إعدادات reverse-proxy / SameSite=None / cross-site context. النسبة الإجمالية تبقى **61%** إلى أن تُنفّذ اختبارات قبول كاملة ومقاييس أداء فعلية.

---

## لقطة أدلة B9 الجزئية (2026-07-15)

هذه اللقطة تضيف مراجع قابلة للتنفيذ فقط، ولا تعلن إكمال B9 أو تغيّر نسبة **61%**. تم تشغيل الأمر التالي من `apps/api` بنجاح:

```sh
npx jest test/security-acceptance.spec.ts test/security-acceptance-gap.spec.ts src/modules/messages/messages.service.spec.ts src/modules/reviews/reviews.service.spec.ts src/modules/reviews/reviews-moderation.service.spec.ts test/health.int-spec.ts --runInBand
```

النتيجة المسجلة: **5 suites / 95 tests passed**. لاحظ أن `test/health.int-spec.ts` لا يطابق `testRegex` الافتراضي (`\\.spec\\.ts$`) ولذلك شُغّل التحقق الصحي أيضاً بالأمر التالي:

```sh
npx jest --testRegex 'health\.int-spec\.ts$' --runInBand
```

والنتيجة: **1 suite / 1 test passed** لـ `GET /api/v1/health`.

المراجع التي تغطيها هذه اللقطة هي `test/security-acceptance.spec.ts` و`test/security-acceptance-gap.spec.ts` و`src/modules/messages/messages.service.spec.ts` و`src/modules/reviews/reviews.service.spec.ts` و`src/modules/reviews/reviews-moderation.service.spec.ts` و`test/health.int-spec.ts`. لا توجد في هذه اللقطة أدلة browser QA أو قياس HTTP فعلي أو Lighthouse أو CI/Compose clean-run؛ تظل هذه البنود deferred كما هي.

---

## أهم الفجوات مرتبة حسب الأولوية

1. **Auth hardening:** نقل tokens إلى secure HttpOnly cookies، CSRF strategy، email verification، وGoogle OAuth.
2. **حقيقة بيانات Vendor Dashboard:** استبدال `localStorage` وdemo/mock data بـ API endpoints حقيقية، وإكمال status transitions للحجز.
3. **i18n حقيقي:** Arabic/English switch، RTL/LTR، ثم content model قابل للترجمة.
4. **قنوات المستخدم:** Socket.io أو real-time layer، booking-linked messaging، email fallback، وreminders.
5. **تشغيل آمن:** Swagger، CI pipeline، Docker/compose، secret validation، migrations/deploy runbook، backups وmonitoring.
6. **الأجزاء التجارية المتبقية:** payout requests، CSV exports، review moderation، service/review media، category/commission controls.
7. **اختبارات قبول حقيقية:** E2E لـ auth → booking race → Stripe webhook → refund → notifications، ثم browser RTL/LTR flows وperformance baseline.

---

## معيار إعادة التقييم

يمكن رفع النسبة إلى قرابة **75–80%** بعد إكمال البنود 1–4 مع E2E tests. الوصول إلى **90%+** يتطلب أيضاً أن ينجح deploy قابل للتكرار وCI، وأن تُقاس acceptance metrics في PRD فعلياً: P95، LCP، webhook Stripe test flow، وعدم وجود double-booking تحت concurrent requests.

---

## المراجع المباشرة

- PRD: `docs/PRD.docx`
- Roadmap: `PLAN.md`
- API bootstrap: `apps/api/src/main.ts`
- Auth: `apps/api/src/modules/auth/`
- Booking constraint: `apps/api/src/modules/bookings/bookings.service.ts`
- Payments: `apps/api/src/modules/payments/`
- Web auth storage: `apps/web/src/contexts/AuthContext.tsx`
- Web mock screens: `apps/web/src/app/dashboard/`
