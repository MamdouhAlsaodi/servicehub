/**
 * B5 — PayoutsService unit tests. Real test DB + class-token PrismaService
 * override per the project's established DI convention. Pre-requisite:
 * migration `20260715000300_local_payout_requests` must be applied.
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException, ConflictException, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { PayoutsService } from './payouts.service';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { prisma, cleanDatabase, disconnectPrisma } from '../../test/setup';
import {
  BookingStatus, PaymentStatus, PaymentProvider,
  PayoutStatus, UserRole, VendorStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('PayoutsService', () => {
  let service: PayoutsService;
  let categoryId: string;

  async function seedUser(role: UserRole, name: string) {
    const passwordHash = await bcrypt.hash('password123', 4);
    return prisma.user.create({
      data: { name, email: `${name.toLowerCase()}@p.test`, passwordHash, role },
    });
  }
  async function seedVendor(userId: string) {
    return prisma.vendorProfile.create({
      data: { userId, businessName: 'B', categoryId,
              status: VendorStatus.APPROVED, avgRating: 4.5 },
    });
  }
  async function seedSvc(vendorId: string, price: string) {
    return prisma.service.create({
      data: { vendorId, title: 'S', price, durationMinutes: 60, categoryId },
    });
  }
  async function seedBk(vendorId: string, customerId: string, svc: { id: string },
                        amount: string, comm: string, refunded = '0', slotIndex = 0) {
    const start = new Date(Date.now() + 24 * 60 * 60_000);
    start.setMinutes(0, 0, 0);
    /* Deterministic slot offset (hours). Tests that seed multiple bookings
     * under the SAME vendor must pass distinct slotIndex values, otherwise
     * the real `booking_no_overlap` EXCLUDE constraint rejects the second
     * insert. Per-vendor tests don't need to pass anything — slotIndex=0
     * preserves the original single-booking behaviour. */
    start.setHours(start.getHours() + slotIndex);
    const b = await prisma.booking.create({
      data: {
        customerId, vendorId, serviceId: svc.id, startTime: start,
        endTime: new Date(start.getTime() + 60 * 60_000),
        status: BookingStatus.CONFIRMED,
        priceAtBooking: amount, commissionAmount: comm,
      },
    });
    await prisma.payment.create({
      data: {
        bookingId: b.id, provider: PaymentProvider.MOCK,
        externalId: `mock_pi_${b.id}`, amount, refundedAmount: refunded,
        status: PaymentStatus.SUCCEEDED,
      },
    });
  }

  beforeEach(async () => {
    await cleanDatabase();
    await prisma.platformSettings.deleteMany();
    const module: TestingModule = await Test.createTestingModule({
      providers: [PayoutsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<PayoutsService>(PayoutsService);
    const cat = await prisma.category.create({ data: { nameAr: 'مطاعم', nameEn: 'Restaurants' } });
    categoryId = cat.id;
  });
  afterAll(async () => { await disconnectPrisma(); });

  it('(TEST 1) customer is forbidden from create / list / eligibility', async () => {
    const c = await seedUser(UserRole.CUSTOMER, 'C');
    await expect(service.createRequest(c.id, 100)).rejects.toThrow(ForbiddenException);
    await expect(service.listForVendor(c.id)).rejects.toThrow(ForbiddenException);
    await expect(service.getEligibilityForVendor(c.id)).rejects.toThrow(ForbiddenException);
  });

  it('(TEST 2) eligibility is scoped per-vendor — no cross-vendor leak', async () => {
    const ua = await seedUser(UserRole.VENDOR, 'VA');
    const pa = await seedVendor(ua.id);
    const ub = await seedUser(UserRole.VENDOR, 'VB');
    const pb = await seedVendor(ub.id);
    const cust = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(pa.id, cust.id, await seedSvc(pa.id, '500'), '500', '50');
    await seedBk(pb.id, cust.id, await seedSvc(pb.id, '500'), '500', '50');
    const ea = await service.getEligibilityForVendor(ua.id);
    const eb = await service.getEligibilityForVendor(ub.id);
    expect(ea.vendorId).toBe(pa.id);
    expect(eb.vendorId).toBe(pb.id);
    expect(ea.available).toBe('450.00');
    expect(eb.available).toBe('450.00');
  });

  it('(TEST 2b) admin transitions reject non-admin actors; no state mutation occurs', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    const p = await seedVendor(u.id);
    const cust = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(p.id, cust.id, await seedSvc(p.id, '100'), '100', '10');
    const pay = await service.createRequest(u.id, 50);
    await expect(service.approveRequest(u.id, pay.id)).rejects.toThrow(ForbiddenException);
    await expect(service.rejectRequest(u.id, pay.id)).rejects.toThrow(ForbiddenException);
    await expect(service.markPaidRequest(u.id, pay.id)).rejects.toThrow(ForbiddenException);

    /* Security-sensitive assertion: the role recheck must run BEFORE any
     * mutation. The payout must still be REQUESTED with no audit fields
     * populated — otherwise a non-admin caller could transition state by
     * racing the un-awaited role check. */
    const stillRequested = await prisma.payoutRequest.findUniqueOrThrow({
      where: { id: pay.id },
    });
    expect(stillRequested.status).toBe(PayoutStatus.REQUESTED);
    expect(stillRequested.decidedByUserId).toBeNull();
    expect(stillRequested.decidedAt).toBeNull();
    expect(stillRequested.paidByUserId).toBeNull();
    expect(stillRequested.paidAt).toBeNull();
  });

  it('(TEST 3) zero / negative / NaN / Infinity / > 2 decimals rejected', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    await seedVendor(u.id);
    for (const bad of [0, -1, -0.01, NaN, Infinity, -Infinity, 1.234]) {
      await expect(service.createRequest(u.id, bad as number)).rejects.toThrow(BadRequestException);
    }
  });

  it('(TEST 4) amount > available rejected with descriptive error', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    const p = await seedVendor(u.id);
    const c = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(p.id, c.id, await seedSvc(p.id, '100'), '100', '10'); /* available = 90 */
    await expect(service.createRequest(u.id, 90.01))
      .rejects.toThrow(/exceeds available eligible balance/);
  });

  it('(TEST 5) REQUESTED row persists with currency=brl and audit fields', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    const p = await seedVendor(u.id);
    const c = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(p.id, c.id, await seedSvc(p.id, '200'), '200', '20');
    const result = await service.createRequest(u.id, 100, 'note-1');
    expect(result).toMatchObject({
      vendorId: p.id, amount: '100', currency: 'brl',
      status: 'REQUESTED', vendorNote: 'note-1',
      requestedByUserId: u.id,
      decidedByUserId: null, paidByUserId: null,
      decidedAt: null, paidAt: null,
    });
    expect(result.id).toMatch(/^c/);
    expect(result.requestedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('(TEST 6) a second ACTIVE payout → Conflict; after REJECT a new one is allowed', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    const p = await seedVendor(u.id);
    const admin = await seedUser(UserRole.ADMIN, 'A');
    const c = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(p.id, c.id, await seedSvc(p.id, '500'), '500', '50');
    const first = await service.createRequest(u.id, 100);
    await expect(service.createRequest(u.id, 50)).rejects.toThrow(ConflictException);
    await service.rejectRequest(admin.id, first.id);
    const second = await service.createRequest(u.id, 100);
    expect(second.status).toBe('REQUESTED');
    expect(second.id).not.toBe(first.id);
  });

  it('(TEST 7) allowed transitions populate audit fields', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    const p = await seedVendor(u.id);
    const admin = await seedUser(UserRole.ADMIN, 'A');
    const c = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(p.id, c.id, await seedSvc(p.id, '500'), '500', '50');

    /* REQUESTED → APPROVED → PAID */
    const p1 = await service.createRequest(u.id, 100);
    const ap = await service.approveRequest(admin.id, p1.id, 'looks good');
    expect(ap.status).toBe('APPROVED');
    expect(ap.adminReason).toBe('looks good');
    expect(ap.decidedByUserId).toBe(admin.id);
    expect(ap.decidedAt).not.toBeNull();
    const paid = await service.markPaidRequest(admin.id, p1.id, 'settled');
    expect(paid.status).toBe('PAID');
    expect(paid.paidByUserId).toBe(admin.id);
    expect(paid.paidAt).not.toBeNull();
    expect(paid.adminReason).toBe('settled');

    /* REQUESTED → REJECTED */
    const p2 = await service.createRequest(u.id, 50);
    const rj = await service.rejectRequest(admin.id, p2.id, 'insufficient');
    expect(rj.status).toBe('REJECTED');
    expect(rj.adminReason).toBe('insufficient');

    /* APPROVED → REJECTED */
    const p3 = await service.createRequest(u.id, 25);
    await service.approveRequest(admin.id, p3.id);
    const rj2 = await service.rejectRequest(admin.id, p3.id, 'changed mind');
    expect(rj2.status).toBe('REJECTED');
  });

  it('(TEST 8) PAID and REJECTED are terminal — every transition is rejected', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    const p = await seedVendor(u.id);
    const admin = await seedUser(UserRole.ADMIN, 'A');
    const c = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(p.id, c.id, await seedSvc(p.id, '500'), '500', '50');

    /* PAID path. */
    const p1 = await service.createRequest(u.id, 100);
    await service.approveRequest(admin.id, p1.id);
    await service.markPaidRequest(admin.id, p1.id);
    await expect(service.approveRequest(admin.id, p1.id)).rejects.toThrow(ConflictException);
    await expect(service.rejectRequest(admin.id, p1.id)).rejects.toThrow(ConflictException);
    await expect(service.markPaidRequest(admin.id, p1.id)).rejects.toThrow(ConflictException);

    /* REJECTED path. */
    const p2 = await service.createRequest(u.id, 100);
    await service.rejectRequest(admin.id, p2.id);
    await expect(service.approveRequest(admin.id, p2.id)).rejects.toThrow(ConflictException);
    await expect(service.markPaidRequest(admin.id, p2.id)).rejects.toThrow(ConflictException);

    /* REQUESTED → PAID direct is not allowed. */
    const p3 = await service.createRequest(u.id, 100);
    await expect(service.markPaidRequest(admin.id, p3.id)).rejects.toThrow(ConflictException);

    /* Unknown id. */
    await expect(service.approveRequest(admin.id, 'nope'))
      .rejects.toThrow(NotFoundException);
  });

  it('(TEST 9) admin sees all; vendor sees only own; ?status= filter', async () => {
    const ua = await seedUser(UserRole.VENDOR, 'VA');
    const pa = await seedVendor(ua.id);
    const ub = await seedUser(UserRole.VENDOR, 'VB');
    const pb = await seedVendor(ub.id);
    const admin = await seedUser(UserRole.ADMIN, 'A');
    const cust = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(pa.id, cust.id, await seedSvc(pa.id, '500'), '500', '50');
    await seedBk(pb.id, cust.id, await seedSvc(pb.id, '500'), '500', '50');

    const paId = (await service.createRequest(ua.id, 50)).id;
    const pbId = (await service.createRequest(ub.id, 50)).id;
    const all = (await service.listAll()) as Array<{ id: string }>;
    expect(all.map((x) => x.id)).toEqual(expect.arrayContaining([paId, pbId]));
    const mine = await service.listForVendor(ua.id);
    const mineIds = (mine.items as Array<{ id: string }>).map((x) => x.id);
    expect(mineIds).toEqual([paId]);
    expect(mineIds).not.toContain(pbId);

    await service.rejectRequest(admin.id, paId);
    const onlyReq = (await service.listAll({ status: PayoutStatus.REQUESTED })) as Array<{ id: string }>;
    const onlyRej = (await service.listAll({ status: PayoutStatus.REJECTED })) as Array<{ id: string }>;
    expect(onlyReq.map((x) => x.id)).toEqual([pbId]);
    expect(onlyRej.map((x) => x.id)).toEqual([paId]);
  });

  it('(TEST 10) eligibility subtracts refunds, commission, and outstanding payouts', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    const p = await seedVendor(u.id);
    const admin = await seedUser(UserRole.ADMIN, 'A');
    const cust = await seedUser(UserRole.CUSTOMER, 'C');
    const s = await seedSvc(p.id, '500');
    /* 1) 500/50/30 refunded → 420 net.  2) 200/20/0 → 180 net.
       earned 700, refunded 30, commission 70, available 600.
       Distinct slotIndex values keep the two rows inside the
       booking_no_overlap EXCLUDE constraint. */
    await seedBk(p.id, cust.id, s, '500', '50', '30', 0);
    await seedBk(p.id, cust.id, s, '200', '20', '0', 1);

    const e0 = await service.getEligibilityForVendor(u.id);
    expect(e0).toMatchObject({
      earned: '700.00', refunded: '30.00',
      commission: '70.00', outstandingPayouts: '0', available: '600.00',
    });

    const pr = await service.createRequest(u.id, 200);
    const assertPool = async () => {
      const e = await service.getEligibilityForVendor(u.id);
      expect(e.outstandingPayouts).toBe('200.00');
      expect(e.available).toBe('400.00');
    };
    await assertPool();
    await service.approveRequest(admin.id, pr.id);
    await assertPool();
    await service.markPaidRequest(admin.id, pr.id);
    await assertPool();

    /* REJECT a new 50 — REJECTED releases capital. */
    const pr2 = await service.createRequest(u.id, 50);
    await service.rejectRequest(admin.id, pr2.id);
    await assertPool();
  });

  it('(TEST P1) Decimal math stays exact: 100.55 - 10.05 = 90.50; currency=brl', async () => {
    const u = await seedUser(UserRole.VENDOR, 'V');
    const p = await seedVendor(u.id);
    const cust = await seedUser(UserRole.CUSTOMER, 'C');
    await seedBk(p.id, cust.id, await seedSvc(p.id, '100.55'), '100.55', '10.05');
    const result = await service.createRequest(u.id, 90.5);
    expect(result.amount).toBe('90.5');
    const persisted = await prisma.payoutRequest.findUniqueOrThrow({
      where: { id: result.id },
    });
    expect(persisted.currency).toBe('brl');
    expect(persisted.amount.toFixed(2)).toBe('90.50');
  });
});