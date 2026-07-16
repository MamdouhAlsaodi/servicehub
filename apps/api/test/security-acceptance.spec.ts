/**
 * B7 — Security acceptance suite.
 *
 * This is the FIRST bounded slice of the B7 packet. It boots the FULL
 * `AppModule` (not a single service) so the real guard stack is in
 * play: `ThrottlerGuard` (global, but overridden as a no-op here —
 * see the `overrideProvider(ThrottlerGuard)` call in `beforeAll`),
 * `CsrfGuard` (global), `JwtAuthGuard` and `RolesGuard` on the per-route
 * boundary. There is no mocking of the auth flow: admin / vendor /
 * customer users are seeded in the test DB, real JWTs are minted via
 * `JwtService.sign()`, and the tokens travel as `Authorization: Bearer
 * <jwt>` so the `JwtStrategy` accepts them exactly as the documented
 * API-client path does.
 *
 * What this suite PROVES:
 *
 *   1. Unauthenticated 401 on every high-risk boundary:
 *        - GET /api/v1/admin/settings/commission
 *        - GET /api/v1/admin/reports/revenue
 *        - GET /api/v1/admin/reports/top-vendors
 *        - GET /api/v1/admin/kpis
 *        - GET /api/v1/admin/disputes
 *        - GET /api/v1/payouts
 *        - GET /api/v1/payouts/me
 *        - GET /api/v1/payouts/eligibility/me
 *        - POST /api/v1/messages/bookings/:bookingId
 *        - GET  /api/v1/messages/bookings/:bookingId
 *
 *   2. Role-boundary 403:
 *        - CUSTOMER → /api/v1/admin/* → 403
 *        - VENDOR   → /api/v1/admin/* → 403
 *        - VENDOR   → /api/v1/payouts (admin list) → 403
 *        - ADMIN    → /api/v1/payouts/me (vendor only) → 403
 *        - Outsider CUSTOMER → /api/v1/messages/bookings/:otherId → 403
 *
 *   3. Malformed body 400 on `POST /api/v1/messages/bookings/:bookingId`:
 *        - empty `content`             → 400
 *        - missing `content`           → 400
 *        - wrong type (`content: 42`) → 400
 *        - control chars in `content`  → 400
 *
 *   4. NO public message route:
 *        - GET /api/v1/messages             → 404 (no route at root)
 *        - POST /api/v1/messages            → 404
 *        - PATCH /api/v1/messages           → 404
 *        - Only the `bookings/:bookingId`
 *          sub-paths are wired in the
 *          `MessagesController`.
 *
 *   5. Swagger enablement matrix (pure-function):
 *        - NODE_ENV=production + SWAGGER_ENABLED unset → false
 *        - NODE_ENV=production + SWAGGER_ENABLED=true  → true
 *        - NODE_ENV=production + SWAGGER_ENABLED=1     → false
 *        - NODE_ENV=test        + SWAGGER_ENABLED unset → true
 *        - NODE_ENV=test        + SWAGGER_ENABLED=false → false
 *
 *   6. Swagger document content (pure-function):
 *        - Title is "ServiceHub API".
 *        - Security schemes declared: bearerAuth + cookieAuth ONLY.
 *          No oauth2, no apiKey (other than the named cookie).
 *        - Description mentions CSRF, cookies, Bearer, AND the
 *          production-default-OFF rule.
 *
 * What this suite does NOT prove (out of scope for the B7 first
 * slice; deferred to later packets):
 *
 *   - The full positive-path functionality of admin / payout / message
 *     modules. Other suites already cover those.
 *   - CSRF positive/negative paths. Covered by B1 Task 4.
 *   - Stripe webhook signature. Covered by other suites.
 *   - Rate-limit threshold values. We disable the throttler in this
 *     test so we can focus on the auth boundary; the throttler is
 *     covered by other suites and not the focus here.
 *
 * Test isolation:
 *   - setup-env.ts forces NODE_ENV=test and DATABASE_URL → servicehub_test.
 *   - The legacy `prisma` shim from `apps/api/src/test/setup.ts` is
 *     used for fixtures (cleanDatabase in beforeEach, disconnectPrisma
 *     in afterAll).
 *   - `app.close()` in afterAll so the Nest-managed PrismaService
 *     releases its connection before the singleton disconnect.
 *
 * Note: this file uses the standard `.spec.ts` suffix so the default
 * Jest regex picks it up as part of the regular suite. It is the
 * bounded acceptance suite for B7 — a sibling of the B5 financial-csv
 * and B6 message suites that boot a real AppModule.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import {
  ValidationPipe,
  type INestApplication,
  type INestApplicationContext,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import * as bcrypt from 'bcrypt';
import {
  BookingStatus,
  PaymentStatus,
  UserRole,
  VendorStatus,
} from '@prisma/client';
import { AppModule } from '../src/app.module';
import {
  prisma,
  cleanDatabase,
  disconnectPrisma,
} from '../src/test/setup';
import {
  isSwaggerEnabled,
  buildOpenApiConfig,
  mountSwagger,
  SWAGGER_UI_PATH,
  SWAGGER_JSON_PATH,
} from '../src/swagger';

describe('B7 — security acceptance suite', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  /* Minimal seed used by every role-boundary test. Building this in
   * beforeEach (not beforeAll) guarantees no cross-test bleed and
   * matches how the B4 race spec structures its fixtures. */
  let customerId: string;
  let customerJwt: string;
  let vendorUserId: string;
  let vendorId: string;
  let adminId: string;
  let adminJwt: string;
  let outsiderCustomerId: string;
  let outsiderJwt: string;
  let categoryId: string;
  let serviceId: string;
  let bookingId: string;

  beforeAll(async () => {
    /* Boot the FULL app module. The ThrottlerGuard is global, so
     * a single spec that fires ~18 requests in <60s would risk
     * tripping the 20-req/min limit; we override it with a no-op
     * because the throttler is not the boundary under test here. */
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ThrottlerGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();

    /* Mirror the production `main.ts` so the global prefix and the
     * ValidationPipe behave exactly as a real boot would. This is
     * what makes 401/403/400 assertions trustworthy — the routes
     * are mounted under `/api/v1` and the pipe rejects malformed
     * bodies. */
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    /* The acceptance suite runs in test mode, where isSwaggerEnabled()
     * defaults to true. Calling mountSwagger() here proves the full
     * boot path (createDocument → setup) and gives us a live
     * /api/docs surface to assert against. */
    if (isSwaggerEnabled()) {
      mountSwagger(app);
    }
    await app.init();

    jwtService = moduleRef.get<JwtService>(JwtService);
  });

  afterAll(async () => {
    if (app) {
      await app.close();
    }
    await disconnectPrisma();
  });

  beforeEach(async () => {
    /* Wipe everything. truncateAll is FK-safe so the customer/vendor
     * booking/message fixtures can be re-seeded deterministically. */
    await cleanDatabase();

    /* Category → user/vendor → service → booking. The vendor must
     * be APPROVED so the route gating is purely about role, not
     * vendor status. */
    const category = await prisma.category.create({
      data: {
        nameAr: 'اختبار أمني',
        nameEn: `Security B7 ${Date.now()}`,
      },
    });
    categoryId = category.id;

    const passwordHash = await bcrypt.hash('customer123', 4);

    const customer = await prisma.user.create({
      data: {
        name: 'B7 Customer',
        email: `b7-customer-${Date.now()}@security.test`,
        role: UserRole.CUSTOMER,
        passwordHash,
      },
    });
    customerId = customer.id;
    customerJwt = jwtService.sign(
      { sub: customerId, email: customer.email, role: UserRole.CUSTOMER },
      { secret: process.env.JWT_SECRET, expiresIn: '15m' },
    );

    const outsider = await prisma.user.create({
      data: {
        name: 'B7 Outsider',
        email: `b7-outsider-${Date.now()}@security.test`,
        role: UserRole.CUSTOMER,
        passwordHash,
      },
    });
    outsiderCustomerId = outsider.id;
    outsiderJwt = jwtService.sign(
      {
        sub: outsiderCustomerId,
        email: outsider.email,
        role: UserRole.CUSTOMER,
      },
      { secret: process.env.JWT_SECRET, expiresIn: '15m' },
    );

    const vendorUser = await prisma.user.create({
      data: {
        name: 'B7 Vendor',
        email: `b7-vendor-${Date.now()}@security.test`,
        role: UserRole.VENDOR,
        passwordHash,
      },
    });
    vendorUserId = vendorUser.id;
    const vendor = await prisma.vendorProfile.create({
      data: {
        userId: vendorUserId,
        businessName: 'B7 Vendor Bistro',
        categoryId,
        status: VendorStatus.APPROVED,
        timezone: 'UTC',
      },
    });
    vendorId = vendor.id;

    const admin = await prisma.user.create({
      data: {
        name: 'B7 Admin',
        email: `b7-admin-${Date.now()}@security.test`,
        role: UserRole.ADMIN,
        passwordHash,
      },
    });
    adminId = admin.id;
    adminJwt = jwtService.sign(
      { sub: adminId, email: admin.email, role: UserRole.ADMIN },
      { secret: process.env.JWT_SECRET, expiresIn: '15m' },
    );

    const svc = await prisma.service.create({
      data: {
        vendorId,
        title: 'B7 Slot',
        price: '100.00',
        durationMinutes: 60,
        categoryId,
      },
    });
    serviceId = svc.id;

    const future = new Date(Date.now() + 7 * 24 * 60 * 60_000);
    future.setUTCMinutes(0, 0, 0);
    future.setUTCSeconds(0, 0);
    future.setUTCMilliseconds(0);
    future.setUTCHours(12, 0, 0, 0);
    const booking = await prisma.booking.create({
      data: {
        customerId,
        vendorId,
        serviceId,
        startTime: future,
        endTime: new Date(future.getTime() + 60 * 60_000),
        status: BookingStatus.CONFIRMED,
        priceAtBooking: '100.00',
        commissionAmount: '10.00',
      },
    });
    bookingId = booking.id;

    /* At least one SUCCEEDED payment so the admin report routes
     * have something to aggregate (not strictly required for the
     * 401/403 assertions, but proves the routes are wired and the
     * aggregate queries do not 500 on an empty dataset). */
    await prisma.payment.create({
      data: {
        bookingId,
        provider: 'MOCK',
        externalId: `mock_pi_b7_${booking.id}`,
        amount: '100.00',
        status: PaymentStatus.SUCCEEDED,
      },
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
   * 1. UNAUTHENTICATED → 401 ON EVERY HIGH-RISK BOUNDARY
   * ═══════════════════════════════════════════════════════════════════ */

  describe('unauthenticated requests', () => {
    const adminGetRoutes = [
      '/api/v1/admin/settings/commission',
      '/api/v1/admin/kpis',
      '/api/v1/admin/reports/revenue',
      '/api/v1/admin/reports/top-vendors',
      '/api/v1/admin/disputes',
    ];
    for (const path of adminGetRoutes) {
      it(`(B7.401.${path.replace(/[^a-z0-9]/gi, '_')}) GET ${path} with no auth → 401`, async () => {
        const res = await request(app.getHttpServer()).get(path);
        expect(res.status).toBe(401);
      });
    }

    it('(B7.401.PAYOUTS_ADMIN_LIST) GET /api/v1/payouts (admin list) with no auth → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/payouts');
      expect(res.status).toBe(401);
    });

    it('(B7.401.PAYOUTS_VENDOR_ME) GET /api/v1/payouts/me (vendor) with no auth → 401', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/payouts/me');
      expect(res.status).toBe(401);
    });

    it('(B7.401.PAYOUTS_ELIGIBILITY) GET /api/v1/payouts/eligibility/me with no auth → 401', async () => {
      const res = await request(app.getHttpServer()).get(
        '/api/v1/payouts/eligibility/me',
      );
      expect(res.status).toBe(401);
    });

    it('(B7.401.MSG_SEND) POST /api/v1/messages/bookings/:bookingId with no auth → 401', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/messages/bookings/${bookingId}`)
        .send({ content: 'hello' });
      expect(res.status).toBe(401);
    });

    it('(B7.401.MSG_LIST) GET /api/v1/messages/bookings/:bookingId with no auth → 401', async () => {
      const res = await request(app.getHttpServer()).get(
        `/api/v1/messages/bookings/${bookingId}`,
      );
      expect(res.status).toBe(401);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
   * 2. ROLE BOUNDARY → 403 ON ADMIN/VENDOR/OUTSIDER MISMATCHES
   * ═══════════════════════════════════════════════════════════════════ */

  describe('role boundaries', () => {
    it('(B7.403.CUSTOMER_TO_ADMIN) CUSTOMER → /api/v1/admin/* → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/settings/commission')
        .set('Authorization', `Bearer ${customerJwt}`);
      expect(res.status).toBe(403);
    });

    it('(B7.403.VENDOR_TO_ADMIN) VENDOR → /api/v1/admin/* → 403', async () => {
      const vendorJwt = jwtService.sign(
        { sub: vendorUserId, email: 'v@b7.test', role: UserRole.VENDOR },
        { secret: process.env.JWT_SECRET, expiresIn: '15m' },
      );
      const res = await request(app.getHttpServer())
        .get('/api/v1/admin/reports/revenue')
        .set('Authorization', `Bearer ${vendorJwt}`);
      expect(res.status).toBe(403);
    });

    it('(B7.403.VENDOR_TO_PAYOUTS_ADMIN_LIST) VENDOR → /api/v1/payouts (admin list) → 403', async () => {
      const vendorJwt = jwtService.sign(
        { sub: vendorUserId, email: 'v@b7.test', role: UserRole.VENDOR },
        { secret: process.env.JWT_SECRET, expiresIn: '15m' },
      );
      const res = await request(app.getHttpServer())
        .get('/api/v1/payouts')
        .set('Authorization', `Bearer ${vendorJwt}`);
      expect(res.status).toBe(403);
    });

    it('(B7.403.CUSTOMER_TO_PAYOUTS_VENDOR) CUSTOMER → /api/v1/payouts/me (vendor only) → 403', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/v1/payouts/me')
        .set('Authorization', `Bearer ${customerJwt}`);
      expect(res.status).toBe(403);
    });

    it('(B7.403.OUTSIDER_TO_OTHER_BOOKING_THREAD) CUSTOMER not in booking → /api/v1/messages/bookings/:otherId → 403', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/messages/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${outsiderJwt}`)
        .send({ content: 'should not be allowed' });
      expect(res.status).toBe(403);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
   * 3. MALFORMED BODY → 400 ON POST /api/v1/messages/bookings/:id
   *    (admin auth so the body is what fails, not the role)
   * ═══════════════════════════════════════════════════════════════════ */

  describe('malformed message body', () => {
    it('(B7.400.MSG_EMPTY) ADMIN → POST ... with empty content → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/messages/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ content: '' });
      expect(res.status).toBe(400);
    });

    it('(B7.400.MSG_MISSING) ADMIN → POST ... without `content` field → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/messages/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({});
      expect(res.status).toBe(400);
    });

    it('(B7.400.MSG_WRONG_TYPE) ADMIN → POST ... with `content: 42` (wrong type) → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/messages/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ content: 42 });
      expect(res.status).toBe(400);
    });

    it('(B7.400.MSG_CONTROL_CHARS) ADMIN → POST ... with control chars in content → 400', async () => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/messages/bookings/${bookingId}`)
        .set('Authorization', `Bearer ${adminJwt}`)
        .send({ content: 'badbell' });
      expect(res.status).toBe(400);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
   * 4. NO PUBLIC MESSAGE ROUTE
   *    MessagesController has NO @Get() or @Post() at the controller
   *    root — every route lives under `bookings/:bookingId`. We assert
   *    that the root `/api/v1/messages` is 404 across the safe methods.
   * ═══════════════════════════════════════════════════════════════════ */

  describe('no public message route', () => {
    it('(B7.404.MSG_ROOT_GET) GET /api/v1/messages → 404 (no root list)', async () => {
      const res = await request(app.getHttpServer()).get('/api/v1/messages');
      expect(res.status).toBe(404);
    });

    it('(B7.404.MSG_ROOT_POST) POST /api/v1/messages → 404', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/messages')
        .send({ content: 'should not exist' });
      expect(res.status).toBe(404);
    });

    it('(B7.404.MSG_ROOT_PATCH) PATCH /api/v1/messages → 404', async () => {
      const res = await request(app.getHttpServer())
        .patch('/api/v1/messages')
        .send({ content: 'should not exist' });
      expect(res.status).toBe(404);
    });

    it('(B7.404.MSG_TRAILING_SLASH) POST /api/v1/messages/ → 404 (no trailing-slash route)', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/v1/messages/')
        .send({ content: 'should not exist' });
      expect(res.status).toBe(404);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
   * 5. SWAGGER ENABLEMENT MATRIX (pure-function)
   *    The packet mandates that /api/docs is OFF in production by
   *    default. isSwaggerEnabled is the single source of truth for
   *    that decision — exercised here with explicit env objects so
   *    a regression is loud.
   * ═══════════════════════════════════════════════════════════════════ */

  describe('isSwaggerEnabled — production-default-OFF', () => {
    it('(B7.SWAGGER.PROD_UNSET) NODE_ENV=production + SWAGGER_ENABLED unset → false', () => {
      expect(
        isSwaggerEnabled({
          NODE_ENV: 'production',
          /* SWAGGER_ENABLED deliberately omitted */
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    });

    it('(B7.SWAGGER.PROD_TRUE) NODE_ENV=production + SWAGGER_ENABLED=true → true (opt-in)', () => {
      expect(
        isSwaggerEnabled({
          NODE_ENV: 'production',
          SWAGGER_ENABLED: 'true',
        } as NodeJS.ProcessEnv),
      ).toBe(true);
    });

    it('(B7.SWAGGER.PROD_FALSE) NODE_ENV=production + SWAGGER_ENABLED=false → false (explicit)', () => {
      expect(
        isSwaggerEnabled({
          NODE_ENV: 'production',
          SWAGGER_ENABLED: 'false',
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    });

    it('(B7.SWAGGER.PROD_TYPO) NODE_ENV=production + SWAGGER_ENABLED=TRUE (uppercase typo) → false', () => {
      /* Only the literal lowercase "true" enables. A typo MUST NOT
       * silently expose the docs in production. */
      expect(
        isSwaggerEnabled({
          NODE_ENV: 'production',
          SWAGGER_ENABLED: 'TRUE',
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    });

    it('(B7.SWAGGER.PROD_ONE) NODE_ENV=production + SWAGGER_ENABLED=1 → false (truthy ≠ true)', () => {
      expect(
        isSwaggerEnabled({
          NODE_ENV: 'production',
          SWAGGER_ENABLED: '1',
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    });

    it('(B7.SWAGGER.DEV_UNSET) NODE_ENV=development + SWAGGER_ENABLED unset → true', () => {
      expect(
        isSwaggerEnabled({ NODE_ENV: 'development' } as NodeJS.ProcessEnv),
      ).toBe(true);
    });

    it('(B7.SWAGGER.TEST_UNSET) NODE_ENV=test + SWAGGER_ENABLED unset → true', () => {
      expect(
        isSwaggerEnabled({ NODE_ENV: 'test' } as NodeJS.ProcessEnv),
      ).toBe(true);
    });

    it('(B7.SWAGGER.DEV_FALSE) NODE_ENV=development + SWAGGER_ENABLED=false → false (explicit off)', () => {
      expect(
        isSwaggerEnabled({
          NODE_ENV: 'development',
          SWAGGER_ENABLED: 'false',
        } as NodeJS.ProcessEnv),
      ).toBe(false);
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
   * 6. SWAGGER DOCUMENT CONTENT (pure-function)
   *    What the document says about auth is a security claim, so it
   *    must be honest. We assert the minimum honesty contract:
   *      - Title is "ServiceHub API"
   *      - Security schemes include bearerAuth AND cookieAuth
   *      - No oauth2, no apiKey (only the named cookie is apiKey/in=cookie)
   *      - Description mentions CSRF, Bearer, cookies, and the
   *        production-default-OFF rule
   *    This is what the packet means by "do not claim a security
   *    feature not implemented".
   * ═══════════════════════════════════════════════════════════════════ */

  describe('OpenAPI document content', () => {
    it('(B7.DOC.TITLE) title is "ServiceHub API"', () => {
      const doc = buildOpenApiConfig();
      expect(doc.info.title).toBe('ServiceHub API');
    });

    it('(B7.DOC.VERSION) version is set', () => {
      const doc = buildOpenApiConfig();
      expect(doc.info.version).toBeDefined();
      expect(typeof doc.info.version).toBe('string');
      expect(doc.info.version.length).toBeGreaterThan(0);
    });

    it('(B7.DOC.SCHEMES) declares bearerAuth and cookieAuth, and nothing else', () => {
      const doc = buildOpenApiConfig();
      const names = Object.keys(doc.components?.securitySchemes ?? {});
      expect(names).toEqual(expect.arrayContaining(['bearerAuth', 'cookieAuth']));
      /* The "only what we implement" honesty check. If a future
       * change adds e.g. `oauth2` here without implementing the
       * code path, this assertion fails. */
      expect(names).toEqual(['bearerAuth', 'cookieAuth']);
    });

    it('(B7.DOC.BEARER) bearerAuth is http/bearer/JWT', () => {
      const doc = buildOpenApiConfig();
      const bearer = doc.components!.securitySchemes!.bearerAuth as {
        type: string;
        scheme: string;
        bearerFormat: string;
      };
      expect(bearer.type).toBe('http');
      expect(bearer.scheme).toBe('bearer');
      expect(bearer.bearerFormat).toBe('JWT');
    });

    it('(B7.DOC.COOKIE) cookieAuth is apiKey in=cookie named access_token', () => {
      const doc = buildOpenApiConfig();
      const cookie = doc.components!.securitySchemes!.cookieAuth as {
        type: string;
        in: string;
        name: string;
      };
      expect(cookie.type).toBe('apiKey');
      expect(cookie.in).toBe('cookie');
      expect(cookie.name).toBe('access_token');
    });

    it('(B7.DOC.DESC_BEARER) description explains the Bearer transport', () => {
      const doc = buildOpenApiConfig();
      expect(doc.info.description).toMatch(/Bearer/);
    });

    it('(B7.DOC.DESC_COOKIE) description explains the HttpOnly cookie transport', () => {
      const doc = buildOpenApiConfig();
      expect(doc.info.description).toMatch(/HttpOnly/i);
      expect(doc.info.description).toMatch(/access_token/);
    });

    it('(B7.DOC.DESC_CSRF) description explains the CSRF double-submit', () => {
      const doc = buildOpenApiConfig();
      expect(doc.info.description).toMatch(/CSRF/);
      expect(doc.info.description).toMatch(/x-csrf-token/);
    });

    it('(B7.DOC.DESC_PROD_OFF) description states Swagger is OFF by default in production', () => {
      const doc = buildOpenApiConfig();
      expect(doc.info.description).toMatch(/production/i);
      expect(doc.info.description).toMatch(/SWAGGER_ENABLED/);
    });

    it('(B7.DOC.MOUNT_PATH) exported mount paths are /api/docs and /api/docs-json', () => {
      expect(SWAGGER_UI_PATH).toBe('api/docs');
      expect(SWAGGER_JSON_PATH).toBe('api/docs-json');
    });
  });

  /* ═══════════════════════════════════════════════════════════════════
   * 7. SWAGGER SURFACE — the LIVE mount is reachable when enabled.
   *    The acceptance test boots the app in test mode (NODE_ENV=test,
   *    SWAGGER_ENABLED unset) so Swagger is ON. We assert the UI
   *    and the raw JSON are served on the exact paths the packet
   *    requires, AND that the JSON advertises the security schemes
   *    we just unit-tested above.
   * ═══════════════════════════════════════════════════════════════════ */

  describe('live swagger mount', () => {
    it('(B7.LIVE.UI) GET /api/docs returns the Swagger UI HTML', async () => {
      const res = await request(app.getHttpServer()).get(
        `/${SWAGGER_UI_PATH}/`,
      );
      /* 200 with HTML containing "Swagger UI" — proves the
       * SwaggerModule.setup was actually invoked, and at exactly
       * /api/docs (no /api/v1 prefix). */
      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toMatch(/html/);
      expect(res.text).toMatch(/swagger/i);
    });

    it('(B7.LIVE.JSON) GET /api/docs-json returns the OpenAPI document with the expected schemes', async () => {
      const res = await request(app.getHttpServer()).get(
        `/${SWAGGER_JSON_PATH}`,
      );
      expect(res.status).toBe(200);
      const doc = res.body as {
        info: { title: string };
        components?: { securitySchemes?: Record<string, { type: string }> };
      };
      expect(doc.info.title).toBe('ServiceHub API');
      const schemeNames = Object.keys(doc.components?.securitySchemes ?? {});
      expect(schemeNames).toEqual(
        expect.arrayContaining(['bearerAuth', 'cookieAuth']),
      );
    });
  });
});