/**
 * Phase 3 — Bookings Service tests.
 *
 * Covers:
 *   3.1 createBooking
 *     - happy path creates PENDING_PAYMENT with 5-min hold
 *     - rejects past startTime
 *     - rejects inactive service
 *     - rejects non-approved vendor
 *     - rejects when another booking overlaps (ConflictException)
 *     - DB-level EXCLUDE constraint catches the race
 *
 *   3.3 booking hold
 *     - holdExpiresAt is set ~5 minutes in the future
 *
 *   3.4 available-slots
 *     - returns slots expanded from vendor availability
 *     - excludes slots overlapping existing bookings
 *
 *   3.5 cancelBooking
 *     - customer can cancel own booking
 *     - customer cannot cancel < 24h before (BadRequest)
 *     - vendor can cancel at any time
 *     - third-party cannot cancel (Forbidden)
 *     - cancelling already-cancelled fails (BadRequest)
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { BookingsService } from './bookings.service';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { prisma, cleanDatabase, disconnectPrisma } from '../../test/setup';
import {
  BookingStatus,
  UserRole,
  VendorStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('BookingsService', () => {
  let service: BookingsService;

  /* Test fixtures */
  let customerId: string;
  let otherCustomerId: string;
  let vendorUserId: string;
  let vendorId: string;
  let categoryId: string;
  let serviceId: string;

  beforeEach(async () => {
    await cleanDatabase();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BookingsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<BookingsService>(BookingsService);

    /* Seed: 1 category, 1 APPROVED vendor with availability, 1 service,
     * 2 customers. */
    const passwordHash = await bcrypt.hash('password123', 4);

    const customer = await prisma.user.create({
      data: {
        name: 'Customer',
        email: 'cust@test.com',
        passwordHash,
        role: UserRole.CUSTOMER,
      },
    });
    customerId = customer.id;

    const otherCustomer = await prisma.user.create({
      data: {
        name: 'Other',
        email: 'other@test.com',
        passwordHash,
        role: UserRole.CUSTOMER,
      },
    });
    otherCustomerId = otherCustomer.id;

    const vendorUser = await prisma.user.create({
      data: {
        name: 'Vendor',
        email: 'vendor@test.com',
        passwordHash,
        role: UserRole.VENDOR,
      },
    });
    vendorUserId = vendorUser.id;

    const category = await prisma.category.create({
      data: { nameAr: 'مطاعم', nameEn: 'Restaurants' },
    });
    categoryId = category.id;

    const vendor = await prisma.vendorProfile.create({
      data: {
        userId: vendorUser.id,
        businessName: 'Test Bistro',
        categoryId: category.id,
        status: VendorStatus.APPROVED,
        timezone: 'America/Sao_Paulo',
      },
    });
    vendorId = vendor.id;

    /* Mon–Fri 09:00–17:00 */
    for (let dow = 1; dow <= 5; dow++) {
      await prisma.availability.create({
        data: {
          vendorId: vendor.id,
          dayOfWeek: dow,
          startTime: '09:00',
          endTime: '17:00',
        },
      });
    }

    const svc = await prisma.service.create({
      data: {
        vendorId: vendor.id,
        title: 'Lunch Reservation',
        price: '100.00',
        durationMinutes: 60,
        categoryId: category.id,
      },
    });
    serviceId = svc.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  /* ═══════════════════════════════════════════
     3.1 CREATE BOOKING
     ═══════════════════════════════════════════ */

  describe('createBooking', () => {
    it('(TEST 1) happy path creates PENDING_PAYMENT with 5-min hold', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60_000); // tomorrow
      future.setHours(10, 0, 0, 0);

      const booking = await service.createBooking(
        { serviceId, startTime: future.toISOString() },
        customerId,
      );

      expect(booking.status).toBe(BookingStatus.PENDING_PAYMENT);
      expect(booking.customerId).toBe(customerId);
      expect(booking.vendorId).toBe(vendorId);
      expect(booking.priceAtBooking.toString()).toBe('100');
      expect(Number(booking.commissionAmount)).toBeCloseTo(10.0, 2);
      expect(booking.holdExpiresAt).toBeTruthy();

      const holdMs = booking.holdExpiresAt!.getTime() - booking.createdAt.getTime();
      expect(holdMs).toBeGreaterThanOrEqual(4 * 60_000);
      expect(holdMs).toBeLessThanOrEqual(6 * 60_000);
    });

    it('(TEST 2) rejects past startTime', async () => {
      const past = new Date(Date.now() - 60_000);
      await expect(
        service.createBooking(
          { serviceId, startTime: past.toISOString() },
          customerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('(TEST 3) rejects inactive service', async () => {
      await prisma.service.update({
        where: { id: serviceId },
        data: { isActive: false },
      });
      const future = new Date(Date.now() + 24 * 60 * 60_000);
      future.setHours(10, 0, 0, 0);

      await expect(
        service.createBooking(
          { serviceId, startTime: future.toISOString() },
          customerId,
        ),
      ).rejects.toThrow(NotFoundException);
    });

    it('(TEST 4) rejects non-APPROVED vendor', async () => {
      await prisma.vendorProfile.update({
        where: { id: vendorId },
        data: { status: VendorStatus.PENDING },
      });
      const future = new Date(Date.now() + 24 * 60 * 60_000);
      future.setHours(10, 0, 0, 0);

      await expect(
        service.createBooking(
          { serviceId, startTime: future.toISOString() },
          customerId,
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('(TEST 5) rejects overlap with existing CONFIRMED booking', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60_000);
      future.setHours(10, 0, 0, 0);

      /* Insert a CONFIRMED booking at 10:00 first. */
      await prisma.booking.create({
        data: {
          customerId,
          vendorId,
          serviceId,
          startTime: new Date(future),
          endTime: new Date(future.getTime() + 60 * 60_000),
          status: BookingStatus.CONFIRMED,
          priceAtBooking: '100',
          commissionAmount: '10',
        },
      });

      /* Now try to grab the same 10:00 slot — must fail. */
      await expect(
        service.createBooking(
          { serviceId, startTime: future.toISOString() },
          otherCustomerId,
        ),
      ).rejects.toThrow(ConflictException);
    });

    it('(TEST 6) DB constraint catches the race when pre-check is bypassed', async () => {
      /* Simulate a race: two parallel bookings for the exact same slot.
       * The pre-check should catch one, but if both slip through, the
       * EXCLUDE constraint fires. We assert at least one of the two
       * attempts fails. */
      const future = new Date(Date.now() + 24 * 60 * 60_000);
      future.setHours(11, 0, 0, 0);

      const dto = { serviceId, startTime: future.toISOString() };
      const results = await Promise.allSettled([
        service.createBooking(dto, customerId),
        service.createBooking(dto, otherCustomerId),
      ]);
      const failed = results.filter((r) => r.status === 'rejected');
      expect(failed.length).toBeGreaterThanOrEqual(1);
    });
  });

  /* ═══════════════════════════════════════════
     3.4 AVAILABLE SLOTS
     ═══════════════════════════════════════════ */

  describe('findAvailableSlots', () => {
    it('(TEST 7) returns slots expanded from vendor availability', async () => {
      /* Pick next Monday at 00:00 UTC as the query date.
       * Vendor is in Sao Paulo (UTC-3), so the day is the same. */
      const date = nextDayOfWeekAt(1); // Monday
      const result = await service.findAvailableSlots(serviceId, date);
      expect(result.slots.length).toBeGreaterThan(0);
      /* 09:00–17:00, 60-min step = 8 slots */
      expect(result.slots.length).toBe(8);
    });

    it('(TEST 8) excludes slots overlapping existing bookings', async () => {
      const date = nextDayOfWeekAt(1);
      /* Block the 10:00 slot */
      const dayStartUtc = utcStartOfDate(date);
      const blocked = new Date(dayStartUtc.getTime() + 13 * 60 * 60_000); // 10:00 BRT = 13:00 UTC
      await prisma.booking.create({
        data: {
          customerId,
          vendorId,
          serviceId,
          startTime: blocked,
          endTime: new Date(blocked.getTime() + 60 * 60_000),
          status: BookingStatus.CONFIRMED,
          priceAtBooking: '100',
          commissionAmount: '10',
        },
      });

      const result = await service.findAvailableSlots(serviceId, date);
      /* 8 - 1 = 7 */
      expect(result.slots.length).toBe(7);
      /* None of the slots should match the blocked hour */
      const blockedIso = blocked.toISOString();
      expect(result.slots).not.toContain(blockedIso);
    });
  });

  /* ═══════════════════════════════════════════
     3.5 CANCEL BOOKING
     ═══════════════════════════════════════════ */

  describe('cancelBooking', () => {
    let bookingId: string;
    let future: Date;

    beforeEach(async () => {
      future = new Date(Date.now() + 48 * 60 * 60_000); // 2 days out
      future.setHours(10, 0, 0, 0);
      const b = await service.createBooking(
        { serviceId, startTime: future.toISOString() },
        customerId,
      );
      bookingId = b.id;
    });

    it('(TEST 9) customer can cancel own booking (>24h)', async () => {
      const cancelled = await service.cancelBooking(
        bookingId,
        customerId,
        UserRole.CUSTOMER,
        { reason: 'plans changed' },
      );
      expect(cancelled.status).toBe(BookingStatus.CANCELLED);
      expect(cancelled.cancellationReason).toBe('plans changed');
      expect(cancelled.cancelledBy).toBe(customerId);
    });

    it('(TEST 10) customer cannot cancel < 24h before', async () => {
      /* Make the booking 12h out */
      const soon = new Date(Date.now() + 12 * 60 * 60_000);
      soon.setMinutes(0, 0, 0);
      const b = await service.createBooking(
        { serviceId, startTime: soon.toISOString() },
        otherCustomerId,
      );
      await expect(
        service.cancelBooking(b.id, otherCustomerId, UserRole.CUSTOMER, {
          reason: 'urgent',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('(TEST 11) vendor can cancel at any time', async () => {
      const soon = new Date(Date.now() + 12 * 60 * 60_000);
      soon.setMinutes(0, 0, 0);
      const b = await service.createBooking(
        { serviceId, startTime: soon.toISOString() },
        otherCustomerId,
      );
      const cancelled = await service.cancelBooking(
        b.id,
        vendorUserId,
        UserRole.VENDOR,
        { reason: 'vendor sick' },
      );
      expect(cancelled.status).toBe(BookingStatus.CANCELLED);
    });

    it('(TEST 12) third party cannot cancel (Forbidden)', async () => {
      await expect(
        service.cancelBooking(bookingId, otherCustomerId, UserRole.CUSTOMER, {
          reason: 'hacker',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('(TEST 13) cannot cancel already-cancelled booking', async () => {
      await service.cancelBooking(bookingId, customerId, UserRole.CUSTOMER, {
        reason: 'first',
      });
      await expect(
        service.cancelBooking(bookingId, customerId, UserRole.CUSTOMER, {
          reason: 'second',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });
});

/* ═══════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════ */

/**
 * Return the next occurrence of a given day-of-week (0=Sun..6=Sat)
 * at 00:00:00Z, formatted YYYY-MM-DD. Uses UTC for stability across
 * DST changes.
 */
function nextDayOfWeekAt(targetDow: number): string {
  const now = new Date();
  const currentDow = now.getUTCDay();
  let diff = targetDow - currentDow;
  if (diff <= 0) diff += 7;
  // Pick a date several days out so even a tz behind UTC has the same
  // weekday in both UTC and the vendor's tz. Monday-as-Monday is what
  // we want, regardless of tz offset.
  const d = new Date(
    Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() + diff,
    ),
  );
  return d.toISOString().slice(0, 10);
}

function utcStartOfDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
}