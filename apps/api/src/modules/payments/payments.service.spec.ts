/**
 * Phase A4 — PaymentsService unit tests.
 *
 * All DB access is mocked via a typed PrismaService mock so tests
 * run without a real database. PaymentProvider and NotificationsService
 * are also fully mocked to isolate the service logic.
 *
 * Covers:
 *   4.1 createIntent  — non-owner, expired hold, idempotent reuse,
 *                      happy-path persistence
 *   4.2 handleWebhook — unknown externalId, idempotent duplicate,
 *                      success → confirmPayment
 *   refund           — non-owner / invalid amount
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentProvider } from './providers/payment-provider.interface';
import { BookingStatus, PaymentStatus, PaymentProvider as PrismaPaymentProvider, Prisma, UserRole } from '@prisma/client';

/* ─────────────────────────────────────────────────────────────────
   TYPES
   ───────────────────────────────────────────────────────────────── */

type BookingFixture = Parameters<PrismaService['booking']['findUnique']>[0] extends { where: infer W } ? NonNullable<Awaited<ReturnType<PrismaService['booking']['findUnique']>>> : never;

type PaymentFixture = NonNullable<Awaited<ReturnType<PrismaService['payment']['findUnique']>>>;

type BookingWithPayment = {
  id: string;
  customerId: string;
  vendorId: string;
  serviceId: string;
  status: BookingStatus;
  priceAtBooking: unknown;
  holdExpiresAt: Date | null;
  vendor: { userId: string };
  payment: PaymentFixture | null;
};

type BookingWithPaymentInclude = {
  id: string;
  customerId: string;
  vendorId: string;
  serviceId: string;
  status: BookingStatus;
  priceAtBooking: unknown;
  holdExpiresAt: Date | null;
  vendor: { userId: string };
  service: { title: string };
  payment: PaymentFixture | null;
};

/* ─────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────── */

function mkBooking(overrides: Partial<{
  id: string;
  customerId: string;
  vendorId: string;
  serviceId: string;
  status: BookingStatus;
  priceAtBooking: unknown;
  holdExpiresAt: Date | null;
  vendor: { userId: string };
  service: { title: string };
  payment: PaymentFixture | null;
}> = {}): BookingWithPaymentInclude {
  return {
    id: 'bk-001',
    customerId: 'user-customer',
    vendorId: 'vendor-001',
    serviceId: 'svc-001',
    status: BookingStatus.PENDING_PAYMENT,
    priceAtBooking: '150.00',
    holdExpiresAt: new Date(Date.now() + 10 * 60_000),
    vendor: { userId: 'user-vendor' },
    service: { title: 'Canonical Service' },
    payment: null,
    ...overrides,
  };
}

function mkPayment(overrides: Partial<{
  id: string;
  bookingId: string;
  status: PaymentStatus;
  externalId: string;
  clientSecret: string;
  amount: unknown;
  currency: string;
  refundedAmount: unknown;
  lastEventId: string | null;
}> = {}): PaymentFixture {
  return ({
    id: 'pay-001',
    bookingId: 'bk-001',
    provider: PrismaPaymentProvider.MOCK,
    externalId: 'mock_pi_abc123',
    amount: '150.00' as unknown as PaymentFixture['amount'],
    currency: 'brl',
    status: PaymentStatus.PENDING,
    refundedAmount: '0.00' as unknown as PaymentFixture['refundedAmount'],
    clientSecret: 'mock_pi_abc123_secret_xyz',
    lastEventId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  }) as unknown as PaymentFixture;
}

/* ─────────────────────────────────────────────────────────────────
   MOCK FACTORIES
   ───────────────────────────────────────────────────────────────── */

function createMockPrisma(overrides: Partial<{
  bookingFindUnique: BookingWithPaymentInclude | null;
  paymentFindUnique: PaymentFixture | null;
  paymentCreate: PaymentFixture;
  paymentUpdate: PaymentFixture;
  bookingUpdate: unknown;
  notificationCreate: unknown;
}> = {}): any {
  const prisma: any = {
    booking: {
      findUnique: jest.fn().mockResolvedValue(overrides.bookingFindUnique ?? null),
      update: jest.fn().mockResolvedValue(overrides.bookingUpdate ?? {}),
    },
    payment: {
      findUnique: jest.fn().mockResolvedValue(overrides.paymentFindUnique ?? null),
      create: jest.fn().mockResolvedValue(overrides.paymentCreate ?? mkPayment()),
      update: jest.fn().mockResolvedValue(
        overrides.paymentUpdate ?? mkPayment({ status: PaymentStatus.SUCCEEDED }),
      ),
    },
    notification: {
      create: jest.fn().mockResolvedValue(overrides.notificationCreate ?? {}),
    },
  };
  prisma.$transaction = jest.fn((callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma));
  return prisma;
}

function createMockProvider(): jest.Mocked<PaymentProvider> {
  return {
    name: 'MOCK',
    createIntent: jest.fn().mockResolvedValue({
      externalId: 'mock_pi_new001',
      clientSecret: 'mock_pi_new001_secret_abc',
    }),
    verifyWebhook: jest.fn(),
    refund: jest.fn().mockResolvedValue({
      status: PaymentStatus.REFUNDED,
      refundedAmount: 150.0,
    }),
  } as jest.Mocked<PaymentProvider>;
}

function createMockNotifications(): jest.Mocked<Partial<NotificationsService>> {
  return {
    create: jest.fn().mockResolvedValue({}),
  };
}

/* ─────────────────────────────────────────────────────────────────
   TEST SUITE
   ───────────────────────────────────────────────────────────────── */

describe('PaymentsService', () => {
  let module: TestingModule;
  let service: PaymentsService;
  let mockPrisma: any;
  let mockProvider: jest.Mocked<PaymentProvider>;
  let mockNotifications: jest.Mocked<Partial<NotificationsService>>;

  beforeEach(async () => {
    mockProvider = createMockProvider();
    mockNotifications = createMockNotifications();
    mockPrisma = createMockPrisma();

    module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: 'PAYMENT_PROVIDER', useValue: mockProvider },
        { provide: NotificationsService, useValue: mockNotifications },
      ],
    }).compile();

    service = module.get<PaymentsService>(PaymentsService);
  });

  afterEach(async () => {
    await module.close();
  });

  /* ═══════════════════════════════════════════
     4.1 CREATE INTENT
     ═══════════════════════════════════════════ */

  describe('createIntent', () => {
    it('(TEST 1) rejects payment by a non-owner', async () => {
      const booking = mkBooking({ customerId: 'user-customer' });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);

      await expect(
        service.createIntent(booking.id, 'stranger-user'),
      ).rejects.toThrow(ForbiddenException);

      await expect(
        service.createIntent(booking.id, 'stranger-user'),
      ).rejects.toThrow('Only the customer can pay this booking');
    });

    it('(TEST 2) rejects an expired hold', async () => {
      const expired = new Date(Date.now() - 60_000); // 1 min in the past
      const booking = mkBooking({ holdExpiresAt: expired });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);

      await expect(
        service.createIntent(booking.id, booking.customerId),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.createIntent(booking.id, booking.customerId),
      ).rejects.toThrow('Hold expired');
    });

    it('(TEST 3) reuses existing PENDING payment without calling provider.createIntent', async () => {
      const existingPayment = mkPayment({ status: PaymentStatus.PENDING });
      const booking = mkBooking({ payment: existingPayment });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);
      mockPrisma.payment!.findUnique = jest.fn().mockResolvedValue(existingPayment);

      const result = await service.createIntent(booking.id, booking.customerId);

      expect(result.externalId).toBe(existingPayment.externalId);
      expect(result.clientSecret).toBe(existingPayment.clientSecret);
      expect(mockProvider.createIntent).not.toHaveBeenCalled();
    });

    it('(TEST 4) persists new PENDING payment after provider result', async () => {
      const booking = mkBooking({ payment: null });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);
      mockPrisma.payment!.findUnique = jest.fn().mockResolvedValue(null);

      const createdPayment = mkPayment({
        id: 'pay-new',
        status: PaymentStatus.PENDING,
        externalId: 'mock_pi_new001',
        clientSecret: 'mock_pi_new001_secret_abc',
      });
      mockPrisma.payment!.create = jest.fn().mockResolvedValue(createdPayment);

      const result = await service.createIntent(booking.id, booking.customerId);

      expect(mockProvider.createIntent).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payment!.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.payment!.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            bookingId: booking.id,
            provider: 'MOCK',
            status: PaymentStatus.PENDING,
          }),
        }),
      );
      expect(result.externalId).toBe('mock_pi_new001');
      expect(result.clientSecret).toBe('mock_pi_new001_secret_abc');
    });

    it('(TEST 4b) createIntent throws BadRequestException for already-paid booking', async () => {
      const booking = mkBooking({
        status: BookingStatus.CONFIRMED,
        payment: mkPayment({ status: PaymentStatus.SUCCEEDED }),
      });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);
      mockPrisma.payment!.findUnique = jest.fn().mockResolvedValue(booking.payment);

      await expect(
        service.createIntent(booking.id, booking.customerId),
      ).rejects.toThrow(BadRequestException);
    });

    it('(TEST 4c) createIntent throws NotFoundException for unknown booking', async () => {
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(null);

      await expect(
        service.createIntent('does-not-exist', 'any-user'),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /* ═══════════════════════════════════════════
     4.2 WEBHOOK HANDLER
     ═══════════════════════════════════════════ */

  describe('handleWebhook', () => {
    it('(TEST 5) ignores unknown externalId safely', async () => {
      mockProvider.verifyWebhook = jest.fn().mockResolvedValue({
        id: 'evt_001',
        type: 'payment_intent.succeeded',
        externalId: 'unknown-external-id',
        status: PaymentStatus.SUCCEEDED,
      });
      mockPrisma.payment!.findUnique = jest.fn().mockResolvedValue(null);

      const result = await service.handleWebhook('{}', 'sig-ok');

      expect(result).toEqual({ received: true, applied: false });
    });

    it('(TEST 6) idempotently ignores a duplicate event ID', async () => {
      const payment = mkPayment({ lastEventId: 'evt_001' });
      mockProvider.verifyWebhook = jest.fn().mockResolvedValue({
        id: 'evt_001',
        type: 'payment_intent.succeeded',
        externalId: payment.externalId,
        status: PaymentStatus.SUCCEEDED,
      });
      mockPrisma.payment!.findUnique = jest.fn().mockResolvedValue(payment);

      const result = await service.handleWebhook('{}', 'sig-ok');

      expect(result).toEqual({ received: true, applied: false });
      // No update call means the DB transaction was never entered
      expect(mockPrisma.payment!.update).not.toHaveBeenCalled();
    });

    it('(TEST 7) on success dispatches confirmPayment and confirms expected handling', async () => {
      const payment = mkPayment({ status: PaymentStatus.PENDING, lastEventId: null });
      const confirmedPayment = mkPayment({ status: PaymentStatus.SUCCEEDED, lastEventId: 'evt_002' });

      mockProvider.verifyWebhook = jest.fn().mockResolvedValue({
        id: 'evt_002',
        type: 'payment_intent.succeeded',
        externalId: payment.externalId,
        status: PaymentStatus.SUCCEEDED,
      });

      // First call → finds by externalId → payment
      // Second call (inside confirmPayment tx) → finds by paymentId → payment
      // Third call (notification lookup) → full include
      mockPrisma.payment!.findUnique
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce({ ...payment, booking: mkBooking() });

      mockPrisma.payment!.update = jest.fn().mockResolvedValue(confirmedPayment);
      mockPrisma.booking!.update = jest.fn().mockResolvedValue({});

      const result = await service.handleWebhook('{}', 'sig-ok');

      expect(result).toEqual({ received: true, applied: true });
      // The transaction wrapper was called
      expect(mockPrisma.payment!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: payment.id },
          data: expect.objectContaining({ status: PaymentStatus.SUCCEEDED }),
        }),
      );
      // Notification fan-out was attempted (best-effort)
      expect(mockNotifications.create).toHaveBeenCalled();
    });

    it('(TEST 7b) on FAILED webhook calls failPayment', async () => {
      const payment = mkPayment({ status: PaymentStatus.PENDING, lastEventId: null });

      mockProvider.verifyWebhook = jest.fn().mockResolvedValue({
        id: 'evt_003',
        type: 'payment_intent.payment_failed',
        externalId: payment.externalId,
        status: PaymentStatus.FAILED,
      });

      mockPrisma.payment!.findUnique
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce(payment);

      mockPrisma.payment!.update = jest.fn().mockResolvedValue(
        mkPayment({ status: PaymentStatus.FAILED, lastEventId: 'evt_003' }),
      );
      mockPrisma.booking!.update = jest.fn().mockResolvedValue({});

      const result = await service.handleWebhook('{}', 'sig-ok');

      expect(result).toEqual({ received: true, applied: true });
      expect(mockPrisma.payment!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: payment.id },
          data: expect.objectContaining({ status: PaymentStatus.FAILED }),
        }),
      );
    });

    it('(TEST 7c) on REFUNDED webhook calls refundPayment', async () => {
      const payment = mkPayment({ status: PaymentStatus.SUCCEEDED, lastEventId: null });

      mockProvider.verifyWebhook = jest.fn().mockResolvedValue({
        id: 'evt_004',
        type: 'charge.refunded',
        externalId: payment.externalId,
        status: PaymentStatus.REFUNDED,
        refundedAmount: 150,
      });

      mockPrisma.payment!.findUnique
        .mockResolvedValueOnce(payment)
        .mockResolvedValueOnce(payment);

      mockPrisma.payment!.update = jest.fn().mockResolvedValue(
        mkPayment({ status: PaymentStatus.REFUNDED, lastEventId: 'evt_004' }),
      );

      const result = await service.handleWebhook('{}', 'sig-ok');

      expect(result).toEqual({ received: true, applied: true });
      expect(mockPrisma.payment!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: payment.id },
          data: expect.objectContaining({
            status: PaymentStatus.REFUNDED,
          }),
        }),
      );
    });
  });

  /* ═══════════════════════════════════════════
     REFUND
     ═══════════════════════════════════════════ */

  describe('refund', () => {
    it('(TEST 8) rejects refund by non-owner', async () => {
      const payment = mkPayment({ status: PaymentStatus.SUCCEEDED });
      const booking = mkBooking({ payment });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);

      await expect(
        service.refund(booking.id, { id: 'stranger-user', role: UserRole.VENDOR }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('(TEST 8a) permits the booking customer to refund', async () => {
      const payment = mkPayment({ status: PaymentStatus.SUCCEEDED });
      const booking = mkBooking({ payment });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);

      await service.refund(booking.id, {
        id: booking.customerId,
        role: UserRole.CUSTOMER,
      });

      expect(mockProvider.refund).toHaveBeenCalledWith(payment.externalId, 150);
    });

    it('(TEST 8a) permits the owning vendor to refund', async () => {
      const payment = mkPayment({ status: PaymentStatus.SUCCEEDED });
      const booking = mkBooking({ payment });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);

      await service.refund(booking.id, {
        id: booking.vendor.userId,
        role: UserRole.VENDOR,
      });

      expect(mockProvider.refund).toHaveBeenCalledWith(payment.externalId, 150);
    });

    it('(TEST 8a) permits an admin to refund any booking', async () => {
      const payment = mkPayment({ status: PaymentStatus.SUCCEEDED });
      const booking = mkBooking({ payment });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);

      await service.refund(booking.id, {
        id: 'admin-user',
        role: UserRole.ADMIN,
      });

      expect(mockProvider.refund).toHaveBeenCalledWith(payment.externalId, 150);
    });

    it('(TEST 8b) rejects refund with amount <= 0', async () => {
      const payment = mkPayment({ status: PaymentStatus.SUCCEEDED });
      const booking = mkBooking({
        payment,
        // Simulate fully refunded
      });
      // Patch payment.findUnique to return the payment when called with bookingId
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue({
        ...booking,
        payment: { ...payment, refundedAmount: '150.00' },
      });

      await expect(
        service.refund(booking.id, { id: booking.customerId, role: UserRole.CUSTOMER }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.refund(booking.id, { id: booking.customerId, role: UserRole.CUSTOMER }),
      ).rejects.toThrow('Nothing to refund');
    });

    it('(TEST 8c) rejects refund on a payment that has no refundable success state', async () => {
      const payment = mkPayment({ status: PaymentStatus.PENDING });
      const booking = mkBooking({ payment });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);

      await expect(
        service.refund(booking.id, { id: booking.customerId, role: UserRole.CUSTOMER }),
      ).rejects.toThrow(BadRequestException);

      await expect(
        service.refund(booking.id, { id: booking.customerId, role: UserRole.CUSTOMER }),
      ).rejects.toThrow('Only succeeded or partially refunded payments can be refunded');
    });

    it('(TEST 8d) rejects refund for booking with no payment', async () => {
      const booking = mkBooking({ payment: null });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);

      await expect(
        service.refund(booking.id, { id: booking.customerId, role: UserRole.CUSTOMER }),
      ).rejects.toThrow(NotFoundException);
    });

    it('(TEST 8e) successful refund calls provider.refund and updates payment', async () => {
      const payment = mkPayment({
        status: PaymentStatus.SUCCEEDED,
        refundedAmount: '0.00',
      });
      const booking = mkBooking({ payment });
      mockPrisma.booking!.findUnique = jest.fn().mockResolvedValue(booking);
      mockProvider.refund = jest.fn().mockResolvedValue({
        status: PaymentStatus.REFUNDED,
        refundedAmount: 150.0,
      });
      mockPrisma.payment!.update = jest.fn().mockResolvedValue(
        mkPayment({ status: PaymentStatus.REFUNDED, refundedAmount: '150.00' }),
      );

      const result = await service.refund(booking.id, { id: booking.customerId, role: UserRole.CUSTOMER });

      expect(mockProvider.refund).toHaveBeenCalledWith(
        payment.externalId,
        150.0,
      );
      expect(mockPrisma.payment!.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: payment.id },
          data: expect.objectContaining({ status: PaymentStatus.REFUNDED }),
        }),
      );
      expect(result.status).toBe(PaymentStatus.REFUNDED);
    });
  });
});
