import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BookingStatus,
  PaymentStatus,
  UserRole,
  VendorStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import {
  cleanDatabase,
  disconnectPrisma,
  prisma,
} from '../src/test/setup';

/**
 * B7 gap closure: real-AppModule, HTTP-boundary evidence for tenant
 * isolation, refresh-token revocation, and the deliberately local demo
 * Google simulation. setup-env.ts routes this suite to servicehub_test.
 */
describe('B7 security acceptance gap closure', () => {
  let app: INestApplication;
  let jwtService: JwtService;

  let vendorAJwt: string;
  let customerBOwnerJwt: string;
  let customerBAttackerJwt: string;
  let serviceBId: string;
  let bookingBId: string;
  let paymentBId: string;
  let customerBOwnerEmail: string;

  const password = 'B7-gap-password';

  beforeAll(async () => {
    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    jwtService = moduleRef.get(JwtService);
  });

  afterAll(async () => {
    await app?.close();
    await disconnectPrisma();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const suffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const passwordHash = await bcrypt.hash(password, 4);
    const category = await prisma.category.create({
      data: { nameAr: 'اختبار B7', nameEn: `B7 security ${suffix}` },
    });

    const vendorAUser = await prisma.user.create({
      data: {
        name: 'B7 Vendor A',
        email: `b7-vendor-a-${suffix}@security.test`,
        role: UserRole.VENDOR,
        passwordHash,
      },
    });
    const vendorA = await prisma.vendorProfile.create({
      data: {
        userId: vendorAUser.id,
        businessName: 'B7 Vendor A',
        categoryId: category.id,
        status: VendorStatus.APPROVED,
        timezone: 'UTC',
      },
    });

    const vendorBUser = await prisma.user.create({
      data: {
        name: 'B7 Vendor B',
        email: `b7-vendor-b-${suffix}@security.test`,
        role: UserRole.VENDOR,
        passwordHash,
      },
    });
    const vendorB = await prisma.vendorProfile.create({
      data: {
        userId: vendorBUser.id,
        businessName: 'B7 Vendor B',
        categoryId: category.id,
        status: VendorStatus.APPROVED,
        timezone: 'UTC',
      },
    });
    const serviceB = await prisma.service.create({
      data: {
        vendorId: vendorB.id,
        categoryId: category.id,
        title: 'B7 Vendor B service',
        price: '100.00',
        durationMinutes: 60,
      },
    });
    serviceBId = serviceB.id;

    customerBOwnerEmail = `b7-customer-owner-${suffix}@security.test`;
    const customerBOwner = await prisma.user.create({
      data: {
        name: 'B7 Booking Owner',
        email: customerBOwnerEmail,
        role: UserRole.CUSTOMER,
        passwordHash,
      },
    });
    const customerBAttacker = await prisma.user.create({
      data: {
        name: 'B7 Tenant Attacker',
        email: `b7-customer-attacker-${suffix}@security.test`,
        role: UserRole.CUSTOMER,
        passwordHash,
      },
    });

    const startTime = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    startTime.setUTCHours(12, 0, 0, 0);
    const bookingB = await prisma.booking.create({
      data: {
        customerId: customerBOwner.id,
        vendorId: vendorB.id,
        serviceId: serviceB.id,
        startTime,
        endTime: new Date(startTime.getTime() + 60 * 60 * 1000),
        status: BookingStatus.CONFIRMED,
        priceAtBooking: '100.00',
        commissionAmount: '10.00',
      },
    });
    bookingBId = bookingB.id;
    const paymentB = await prisma.payment.create({
      data: {
        bookingId: bookingB.id,
        provider: 'MOCK',
        externalId: `b7-payment-${suffix}`,
        amount: '100.00',
        status: PaymentStatus.SUCCEEDED,
      },
    });
    paymentBId = paymentB.id;

    const sign = (id: string, email: string, role: UserRole) =>
      jwtService.sign(
        { sub: id, email, role },
        { secret: process.env.JWT_SECRET, expiresIn: '15m' },
      );
    vendorAJwt = sign(vendorAUser.id, vendorAUser.email, UserRole.VENDOR);
    customerBOwnerJwt = sign(
      customerBOwner.id,
      customerBOwner.email,
      UserRole.CUSTOMER,
    );
    customerBAttackerJwt = sign(
      customerBAttacker.id,
      customerBAttacker.email,
      UserRole.CUSTOMER,
    );
  });

  describe('cross-tenant IDOR denial', () => {
    it('denies one vendor from changing another vendor’s service over HTTP', async () => {
      const response = await request(app.getHttpServer())
        .patch(`/api/v1/services/${serviceBId}`)
        .set('Authorization', `Bearer ${vendorAJwt}`)
        .send({ title: 'attacker overwrite' });

      expect(response.status).toBe(403);
      expect(
        (await prisma.service.findUnique({ where: { id: serviceBId } }))?.title,
      ).toBe('B7 Vendor B service');
    });

    it('denies a customer from reading or cancelling another tenant’s booking over HTTP', async () => {
      const read = await request(app.getHttpServer())
        .get(`/api/v1/bookings/${bookingBId}`)
        .set('Authorization', `Bearer ${customerBAttackerJwt}`);
      const cancel = await request(app.getHttpServer())
        .post(`/api/v1/bookings/${bookingBId}/cancel`)
        .set('Authorization', `Bearer ${customerBAttackerJwt}`)
        .send({ reason: 'attacker cancellation' });

      expect(read.status).toBe(403);
      expect(cancel.status).toBe(403);
      expect(
        (await prisma.booking.findUnique({ where: { id: bookingBId } }))?.status,
      ).toBe(BookingStatus.CONFIRMED);
    });

    it('denies a customer from reading another tenant’s payment over HTTP', async () => {
      const response = await request(app.getHttpServer())
        .get(`/api/v1/payments/${paymentBId}`)
        .set('Authorization', `Bearer ${customerBAttackerJwt}`);

      // The current controller deliberately returns BadRequestException here;
      // this pins its implemented non-disclosure contract rather than claiming
      // a 403/404 behavior that the route does not implement.
      expect(response.status).toBe(400);
      expect(JSON.stringify(response.body)).not.toContain(paymentBId);
      expect(JSON.stringify(response.body)).not.toContain('b7-payment-');
    });
  });

  it('revokes an issued refresh token: logout makes its old cookie fail at /auth/refresh', async () => {
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ email: customerBOwnerEmail, password });
    expect(login.status).toBe(200);
    const setCookies = login.headers['set-cookie'];
    const refreshCookie = (Array.isArray(setCookies)
      ? setCookies
      : setCookies
        ? [setCookies]
        : []
    ).find((cookie) => cookie.startsWith('refresh_token='));
    expect(refreshCookie).toBeDefined();
    const oldRefreshCookie = refreshCookie!.split(';', 1)[0];

    const logout = await request(app.getHttpServer())
      .post('/api/v1/auth/logout')
      .set('Authorization', `Bearer ${customerBOwnerJwt}`);
    expect(logout.status).toBe(200);

    const refresh = await request(app.getHttpServer())
      .post('/api/v1/auth/refresh')
      .set('Cookie', oldRefreshCookie);
    expect(refresh.status).toBe(401);
  });

  it('uses the Demo Google endpoint as a fixed local simulation, not an external identity input', async () => {
    const accepted = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-google-login')
      .send({
        email: 'demo.customer@servicehub.local',
        idToken: 'untrusted-external-token',
        googleId: 'untrusted-google-id',
        role: 'ADMIN',
      });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({
      authProvider: 'demo-google',
      user: { email: 'demo.customer@servicehub.local', role: UserRole.CUSTOMER },
    });

    const simulatedUser = await prisma.user.findUnique({
      where: { email: 'demo.customer@servicehub.local' },
    });
    expect(simulatedUser?.googleId).toBeNull();
    expect(simulatedUser?.passwordHash).toBeNull();

    const rejected = await request(app.getHttpServer())
      .post('/api/v1/auth/demo-google-login')
      .send({ email: 'real.user@example.com' });
    expect(rejected.status).toBe(400);
  });
});
