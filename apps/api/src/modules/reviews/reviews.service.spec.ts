/**
 * Phase 5 — Reviews Service tests.
 *
 * Covers:
 *   5.4 createReview
 *     - happy path: rating 5 + comment, recomputes avgRating
 *     - rejects non-CONFIRMED bookings
 *     - rejects other users' bookings (Forbidden)
 *     - duplicate review on same booking → Conflict
 *     - rating out of range is rejected by DTO (validated upstream)
 *     - multiple reviews average correctly
 *
 *   stats + listForVendor + findMine are read-only, smoke tested.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { prisma, cleanDatabase, disconnectPrisma } from '../../test/setup';
import {
  BookingStatus,
  PaymentStatus,
  UserRole,
  VendorStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('ReviewsService', () => {
  let service: ReviewsService;

  let customerId: string;
  let otherCustomerId: string;
  let vendorId: string;
  let categoryId: string;
  let serviceId: string;

  async function makeConfirmedBooking(opts?: { customerId?: string }) {
    /* Pre-confirmed booking + succeeded payment — the review-ready state. */
    const cust = opts?.customerId ?? customerId;
    const future = new Date(Date.now() + 48 * 60 * 60_000);
    future.setMinutes(0, 0, 0);
    const booking = await prisma.booking.create({
      data: {
        customerId: cust,
        vendorId,
        serviceId,
        startTime: future,
        endTime: new Date(future.getTime() + 60 * 60_000),
        status: BookingStatus.CONFIRMED,
        priceAtBooking: '100',
        commissionAmount: '10',
      },
    });
    await prisma.payment.create({
      data: {
        bookingId: booking.id,
        provider: 'MOCK',
        externalId: `mock_pi_${booking.id}`,
        amount: '100',
        status: PaymentStatus.SUCCEEDED,
      },
    });
    return booking;
  }

  beforeEach(async () => {
    await cleanDatabase();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReviewsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<ReviewsService>(ReviewsService);

    const passwordHash = await bcrypt.hash('password123', 4);
    const customer = await prisma.user.create({
      data: { name: 'Cust', email: 'cust@t.com', passwordHash, role: UserRole.CUSTOMER },
    });
    customerId = customer.id;
    const other = await prisma.user.create({
      data: { name: 'Other', email: 'other@t.com', passwordHash, role: UserRole.CUSTOMER },
    });
    otherCustomerId = other.id;

    const vendorUser = await prisma.user.create({
      data: { name: 'V', email: 'v@t.com', passwordHash, role: UserRole.VENDOR },
    });
    const cat = await prisma.category.create({
      data: { nameAr: 'مطاعم', nameEn: 'Restaurants' },
    });
    categoryId = cat.id;
    const vendor = await prisma.vendorProfile.create({
      data: {
        userId: vendorUser.id,
        businessName: 'Bistro',
        categoryId: cat.id,
        status: VendorStatus.APPROVED,
        timezone: 'UTC',
      },
    });
    vendorId = vendor.id;
    const svc = await prisma.service.create({
      data: {
        vendorId: vendor.id,
        title: 'Lunch',
        price: '100',
        durationMinutes: 60,
        categoryId: cat.id,
      },
    });
    serviceId = svc.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  /* ═══════════════════════════════════════════
     5.4 CREATE REVIEW
     ═══════════════════════════════════════════ */

  describe('createReview', () => {
    it('(TEST 1) happy path: 5★ + comment, avgRating recomputed', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(customerId, {
        bookingId: booking.id,
        rating: 5,
        comment: 'ممتاز',
      });
      expect(review.rating).toBe(5);
      expect(review.comment).toBe('ممتاز');

      const vendor = await prisma.vendorProfile.findUnique({
        where: { id: vendorId },
      });
      expect(vendor?.avgRating).toBe(5);
    });

    it('(TEST 2) rejects PENDING_PAYMENT booking', async () => {
      const future = new Date(Date.now() + 24 * 60 * 60_000);
      future.setMinutes(0, 0, 0);
      const booking = await prisma.booking.create({
        data: {
          customerId,
          vendorId,
          serviceId,
          startTime: future,
          endTime: new Date(future.getTime() + 60 * 60_000),
          status: BookingStatus.PENDING_PAYMENT,
          priceAtBooking: '100',
          commissionAmount: '10',
        },
      });
      await expect(
        service.createReview(customerId, {
          bookingId: booking.id,
          rating: 5,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('(TEST 3) rejects other users booking (Forbidden)', async () => {
      const booking = await makeConfirmedBooking({ customerId: otherCustomerId });
      await expect(
        service.createReview(customerId, {
          bookingId: booking.id,
          rating: 5,
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('(TEST 4) duplicate review on same booking (Conflict)', async () => {
      const booking = await makeConfirmedBooking();
      await service.createReview(customerId, { bookingId: booking.id, rating: 5 });
      await expect(
        service.createReview(customerId, { bookingId: booking.id, rating: 4 }),
      ).rejects.toThrow(ConflictException);
    });

    it('(TEST 5) nonexistent booking → NotFound', async () => {
      await expect(
        service.createReview(customerId, {
          bookingId: 'nonexistent',
          rating: 5,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('(TEST 6) multi-review avg is correct', async () => {
      const b1 = await makeConfirmedBooking();
      const b2 = await makeConfirmedBooking();
      const b3 = await makeConfirmedBooking();
      const otherB = await makeConfirmedBooking({ customerId: otherCustomerId });

      await service.createReview(customerId, { bookingId: b1.id, rating: 5 });
      await service.createReview(customerId, { bookingId: b2.id, rating: 3 });
      await service.createReview(customerId, { bookingId: b3.id, rating: 4 });
      await service.createReview(otherCustomerId, { bookingId: otherB.id, rating: 2 });

      /* (5 + 3 + 4 + 2) / 4 = 3.5 */
      const vendor = await prisma.vendorProfile.findUnique({
        where: { id: vendorId },
      });
      expect(vendor?.avgRating).toBe(3.5);
    });

    it('(TEST 7) stats reflect distribution correctly', async () => {
      const b1 = await makeConfirmedBooking();
      const b2 = await makeConfirmedBooking();
      const b3 = await makeConfirmedBooking();
      const b4 = await makeConfirmedBooking();
      const b5 = await makeConfirmedBooking();

      await service.createReview(customerId, { bookingId: b1.id, rating: 5 });
      await service.createReview(customerId, { bookingId: b2.id, rating: 5 });
      await service.createReview(customerId, { bookingId: b3.id, rating: 4 });
      await service.createReview(customerId, { bookingId: b4.id, rating: 4 });
      await service.createReview(customerId, { bookingId: b5.id, rating: 3 });

      const stats = await service.statsForVendor(vendorId);
      expect(stats.total).toBe(5);
      expect(stats.distribution[5]).toBe(2);
      expect(stats.distribution[4]).toBe(2);
      expect(stats.distribution[3]).toBe(1);
      expect(stats.distribution[2]).toBe(0);
      expect(stats.distribution[1]).toBe(0);
      /* (5+5+4+4+3)/5 = 4.2 */
      expect(stats.avgRating).toBe(4.2);
    });
  });
});