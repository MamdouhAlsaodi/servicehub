/**
 * B5 — Reviews moderation spec.
 *
 * 1. URL validation for Service.imageUrl — pure class-validator, no DB.
 * 2. Moderation service — DB-backed; requires migration `20260715000400_*`
 *    applied to the test DB to pass at runtime.
 */
import { Test, TestingModule } from '@nestjs/testing';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
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
  BookingStatus, PaymentStatus, ReviewModerationStatus,
  ReviewReportAction, ReviewReportStatus, UserRole, VendorStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { CreateServiceDto, UpdateServiceDto } from '../services/dto/create-service.dto';

describe('ReviewsService — B5 moderation', () => {
  let service: ReviewsService;
  let authorId: string;
  let reporterId: string;
  let adminId: string;
  let vendorId: string;
  let serviceId: string;

  let slotCounter = 0;
  async function makeConfirmedBooking(opts?: { customerId?: string }) {
    const cust = opts?.customerId ?? authorId;
    const future = new Date(Date.now() + (48 + slotCounter) * 60 * 60_000);
    future.setMinutes(0, 0, 0);
    slotCounter += 1;
    const booking = await prisma.booking.create({
      data: {
        customerId: cust, vendorId, serviceId,
        startTime: future,
        endTime: new Date(future.getTime() + 60 * 60_000),
        status: BookingStatus.CONFIRMED,
        priceAtBooking: '100', commissionAmount: '10',
      },
    });
    await prisma.payment.create({
      data: {
        bookingId: booking.id, provider: 'MOCK',
        externalId: `mock_pi_${booking.id}`,
        amount: '100', status: PaymentStatus.SUCCEEDED,
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
    const author = await prisma.user.create({
      data: { name: 'Author', email: 'author@m.test', passwordHash, role: UserRole.CUSTOMER },
    });
    authorId = author.id;
    const reporter = await prisma.user.create({
      data: { name: 'Reporter', email: 'reporter@m.test', passwordHash, role: UserRole.CUSTOMER },
    });
    reporterId = reporter.id;
    adminId = (await prisma.user.create({
      data: { name: 'Admin', email: 'admin@m.test', passwordHash, role: UserRole.ADMIN },
    })).id;

    const vendorUser = await prisma.user.create({
      data: { name: 'V', email: 'v@m.test', passwordHash, role: UserRole.VENDOR },
    });
    const cat = await prisma.category.create({
      data: { nameAr: 'مطاعم', nameEn: 'Restaurants' },
    });
    const vendor = await prisma.vendorProfile.create({
      data: {
        userId: vendorUser.id, businessName: 'Bistro', categoryId: cat.id,
        status: VendorStatus.APPROVED, timezone: 'UTC',
      },
    });
    vendorId = vendor.id;
    serviceId = (await prisma.service.create({
      data: {
        vendorId: vendor.id, title: 'Lunch', price: '100',
        durationMinutes: 60, categoryId: cat.id,
      },
    })).id;
  });

  afterAll(async () => { await disconnectPrisma(); });

  /* REPORT */

  describe('reportReview', () => {
    it('(TEST 1) non-author can open a report; review auto-FLAGGED', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 2 });
      const report = await service.reportReview(reporterId, review.id, { reason: 'abusive language' });
      expect(report.status).toBe(ReviewReportStatus.OPEN);
      expect(report.reporterUserId).toBe(reporterId);
      expect(report.reason).toBe('abusive language');
      expect(report.resolvedByUserId).toBeNull();
      const reloaded = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(reloaded.moderationStatus).toBe(ReviewModerationStatus.FLAGGED);
      expect(reloaded.moderationChangedAt).toBeInstanceOf(Date);
    });

    it('(TEST 2) author cannot report own review → Forbidden', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 1 });
      await expect(
        service.reportReview(authorId, review.id, { reason: 'self' }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('(TEST 3) duplicate report by same reporter → Conflict', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 3 });
      await service.reportReview(reporterId, review.id, { reason: 'first' });
      await expect(
        service.reportReview(reporterId, review.id, { reason: 'second' }),
      ).rejects.toThrow(ConflictException);
    });

    it('(TEST 4) blank reason → BadRequest', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 4 });
      await expect(
        service.reportReview(reporterId, review.id, { reason: '   ' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('(TEST 5) nonexistent review → NotFound', async () => {
      await expect(
        service.reportReview(reporterId, 'nope', { reason: 'spam' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('(TEST 6) review row never deleted — only flagged/hidden', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 1, comment: 'harsh' });
      await service.reportReview(reporterId, review.id, { reason: 'rude' });
      const reloaded = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(reloaded.comment).toBe('harsh');
      expect(reloaded.moderationStatus).toBe(ReviewModerationStatus.FLAGGED);
    });
  });

  /* RESOLVE */

  describe('resolveReport', () => {
    it('(TEST 7) admin HIDE → review HIDDEN, audit persisted, no deletion', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 1, comment: 'bad' });
      const report = await service.reportReview(reporterId, review.id, { reason: 'spam' });

      const resolved = await service.resolveReport(adminId, report.id, ReviewReportAction.HIDE, 'confirmed spam');
      expect(resolved.status).toBe(ReviewReportStatus.RESOLVED);
      expect(resolved.resolutionAction).toBe(ReviewReportAction.HIDE);
      expect(resolved.resolutionNote).toBe('confirmed spam');
      expect(resolved.resolvedByUserId).toBe(adminId);
      expect(resolved.resolvedAt).toBeInstanceOf(Date);

      const reloaded = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(reloaded.moderationStatus).toBe(ReviewModerationStatus.HIDDEN);
      expect(reloaded.moderationNote).toBe('confirmed spam');

      /* No silent deletion. */
      expect(await prisma.review.count({ where: { id: review.id } })).toBe(1);
      expect(await prisma.reviewReport.count({ where: { id: report.id } })).toBe(1);
    });

    it('(TEST 8) admin KEEP_VISIBLE → review back to VISIBLE', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 2 });
      const report = await service.reportReview(reporterId, review.id, { reason: 'disagreement' });
      await service.resolveReport(adminId, report.id, ReviewReportAction.KEEP_VISIBLE);
      const reloaded = await prisma.review.findUniqueOrThrow({ where: { id: review.id } });
      expect(reloaded.moderationStatus).toBe(ReviewModerationStatus.VISIBLE);
    });

    it('(TEST 9) non-admin cannot resolve → Forbidden; report stays OPEN', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 5 });
      const report = await service.reportReview(reporterId, review.id, { reason: 't' });
      await expect(
        service.resolveReport(reporterId, report.id, ReviewReportAction.HIDE),
      ).rejects.toThrow(ForbiddenException);
      const reloaded = await prisma.reviewReport.findUniqueOrThrow({ where: { id: report.id } });
      expect(reloaded.status).toBe(ReviewReportStatus.OPEN);
      expect(reloaded.resolvedByUserId).toBeNull();
    });

    it('(TEST 10) double-resolve → Conflict', async () => {
      const booking = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: booking.id, rating: 3 });
      const report = await service.reportReview(reporterId, review.id, { reason: 'r' });
      await service.resolveReport(adminId, report.id, ReviewReportAction.HIDE);
      await expect(
        service.resolveReport(adminId, report.id, ReviewReportAction.KEEP_VISIBLE),
      ).rejects.toThrow(ConflictException);
    });

    it('(TEST 11) resolving nonexistent report → NotFound', async () => {
      await expect(
        service.resolveReport(adminId, 'nope', ReviewReportAction.HIDE),
      ).rejects.toThrow(NotFoundException);
    });
  });

  /* PUBLIC SURFACES */

  describe('public surfaces', () => {
    it('(TEST 12) HIDDEN excluded from public list+stats; owner still sees it', async () => {
      const b1 = await makeConfirmedBooking();
      const b2 = await makeConfirmedBooking();
      const r1 = await service.createReview(authorId, { bookingId: b1.id, rating: 5 });
      const r2 = await service.createReview(authorId, { bookingId: b2.id, rating: 1 });
      const rep = await service.reportReview(reporterId, r2.id, { reason: 'spam' });
      const resolutionNote = 'confirmed spam — hidden from public surfaces';
      await service.resolveReport(adminId, rep.id, ReviewReportAction.HIDE, resolutionNote);

      const list = await service.findForVendor(vendorId);
      expect(list.meta.total).toBe(1);
      expect(list.reviews.map((r) => r.id)).toEqual([r1.id]);

      const stats = await service.statsForVendor(vendorId);
      expect(stats.total).toBe(1);
      expect(stats.avgRating).toBe(5);

      const mine = await service.findMine(authorId);
      expect(mine.map((r) => r.id).sort()).toEqual([r1.id, r2.id].sort());
      const hidden = mine.find((r) => r.id === r2.id)!;
      expect(hidden.moderationStatus).toBe(ReviewModerationStatus.HIDDEN);
      expect(hidden.moderationNote).toBe(resolutionNote);
    });

    it('(TEST 13) FLAGGED stays visible in public list/stats pending resolution', async () => {
      const b = await makeConfirmedBooking();
      const review = await service.createReview(authorId, { bookingId: b.id, rating: 2 });
      await service.reportReview(reporterId, review.id, { reason: 'rude' });

      const list = await service.findForVendor(vendorId);
      expect(list.meta.total).toBe(1);
      expect(list.reviews.map((r) => r.id)).toEqual([review.id]);

      const stats = await service.statsForVendor(vendorId);
      expect(stats.total).toBe(1);
      expect(stats.avgRating).toBe(2);
    });
  });

  /* DEFAULTS */

  it('(TEST 14) new review defaults to VISIBLE moderationStatus', async () => {
    const b = await makeConfirmedBooking();
    const review = await service.createReview(authorId, { bookingId: b.id, rating: 5 });
    expect(review.moderationStatus).toBe(ReviewModerationStatus.VISIBLE);
  });

  /* ADMIN LIST */

  it('(TEST 15) admin sees reports; non-admin Forbidden; status filter', async () => {
    const b = await makeConfirmedBooking();
    const review = await service.createReview(authorId, { bookingId: b.id, rating: 3 });
    await service.reportReview(reporterId, review.id, { reason: 'one' });

    await expect(service.listReports(reporterId)).rejects.toThrow(ForbiddenException);

    const queue = await service.listReports(adminId);
    expect(queue.length).toBe(1);
    expect(queue[0].status).toBe(ReviewReportStatus.OPEN);

    await service.resolveReport(adminId, queue[0].id, ReviewReportAction.HIDE);
    expect((await service.listReports(adminId, { status: ReviewReportStatus.OPEN })).length).toBe(0);
    expect((await service.listReports(adminId, { status: ReviewReportStatus.RESOLVED })).length).toBe(1);
  });
});

/* Service.imageUrl — DTO validation (no DB needed) */

async function validateDto<T extends object>(cls: new () => T, plain: Record<string, unknown>) {
  const instance = plainToInstance(cls, plain, { enableImplicitConversion: false });
  return validate(instance as object, { whitelist: true });
}

describe('Service DTO — imageUrl validation', () => {
  const valid = { title: 'Lunch', price: 100, durationMinutes: 60, categoryId: 'cat-1' };

  it('accepts https and http URLs', async () => {
    for (const u of ['https://cdn.example.com/img/photo.jpg', 'http://example.com/x.png']) {
      const errors = await validateDto(CreateServiceDto, { ...valid, imageUrl: u });
      expect(errors).toHaveLength(0);
    }
  });

  it('accepts omission (imageUrl is optional)', async () => {
    for (const blank of [null, undefined]) {
      const errors = await validateDto(CreateServiceDto, { ...valid, imageUrl: blank as any });
      expect(errors.some((e) => e.property === 'imageUrl')).toBe(false);
    }
  });

  it('rejects empty / whitespace strings (no accidental blanks)', async () => {
    for (const bad of ['', '   ']) {
      const errors = await validateDto(CreateServiceDto, { ...valid, imageUrl: bad as any });
      expect(errors.some((e) => e.property === 'imageUrl')).toBe(true);
    }
  });

  it('rejects missing protocol', async () => {
    const errors = await validateDto(CreateServiceDto, { ...valid, imageUrl: 'example.com/photo.jpg' });
    expect(errors.some((e) => e.property === 'imageUrl')).toBe(true);
  });

  it('rejects non-http protocols (ftp, file, javascript, data)', async () => {
    for (const bad of [
      'ftp://example.com/a.jpg',
      'file:///etc/passwd',
      'javascript:alert(1)',
      'data:image/png;base64,AAA',
    ]) {
      const errors = await validateDto(CreateServiceDto, { ...valid, imageUrl: bad });
      expect(errors.some((e) => e.property === 'imageUrl')).toBe(true);
    }
  });

  it('rejects non-string types', async () => {
    const errors = await validateDto(CreateServiceDto, { ...valid, imageUrl: 123 as any });
    expect(errors.some((e) => e.property === 'imageUrl')).toBe(true);
  });

  it('rejects oversize URL and UpdateServiceDto follows the same rules', async () => {
    const longUrl = 'https://example.com/' + 'a'.repeat(3000);
    const long = await validateDto(CreateServiceDto, { ...valid, imageUrl: longUrl });
    expect(long.some((e) => e.property === 'imageUrl' && e.constraints?.maxLength)).toBe(true);
    expect(await validateDto(UpdateServiceDto, { imageUrl: 'https://e.com/x' })).toHaveLength(0);
    const bad = await validateDto(UpdateServiceDto, { imageUrl: 'ftp://e.com/x' });
    expect(bad.some((e) => e.property === 'imageUrl')).toBe(true);
  });
});