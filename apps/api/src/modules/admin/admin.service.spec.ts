/**
 * Phase 7 — Admin Service tests.
 *
 * Covers:
 *   - commission settings default, validation, and persistence
 *   - listPendingVendors filters by status
 *   - approveVendor transitions PENDING → APPROVED
 *   - suspendVendor transitions APPROVED → SUSPENDED
 *   - kpis aggregates correctly across users/vendors/bookings/payments
 *   - revenueByDay buckets payments into per-day totals
 *   - topVendors orders by GMV desc and includes category/rating
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { UpdateCommissionSettingsDto } from './dto/update-commission-settings.dto';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { prisma, cleanDatabase, disconnectPrisma } from '../../test/setup';
import {
  BookingStatus,
  PaymentStatus,
  UserRole,
  VendorStatus,
} from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { validate } from 'class-validator';

describe('AdminService', () => {
  let service: AdminService;
  let categoryId: string;
  let vendorAId: string;
  let vendorBId: string;

  async function seedVendor(opts: {
    name: string;
    status: VendorStatus;
    categoryId: string;
  }) {
    const passwordHash = await bcrypt.hash('password123', 4);
    const u = await prisma.user.create({
      data: { name: opts.name, email: `${opts.name.toLowerCase()}@t.com`, passwordHash, role: UserRole.VENDOR },
    });
    const v = await prisma.vendorProfile.create({
      data: {
        userId: u.id,
        businessName: `${opts.name} Bistro`,
        categoryId: opts.categoryId,
        status: opts.status,
        avgRating: 4.5,
      },
    });
    return v.id;
  }

  async function seedConfirmedBooking(opts: {
    vendorId: string;
    serviceId: string;
    customerId: string;
    amount: string;
    commission: string;
    daysFromNow: number;
  }) {
    const start = new Date(Date.now() + opts.daysFromNow * 24 * 60 * 60_000);
    start.setMinutes(0, 0, 0);
    const b = await prisma.booking.create({
      data: {
        customerId: opts.customerId,
        vendorId: opts.vendorId,
        serviceId: opts.serviceId,
        startTime: start,
        endTime: new Date(start.getTime() + 60 * 60_000),
        status: BookingStatus.CONFIRMED,
        priceAtBooking: opts.amount,
        commissionAmount: opts.commission,
      },
    });
    await prisma.payment.create({
      data: {
        bookingId: b.id,
        provider: 'MOCK',
        externalId: `mock_pi_${b.id}`,
        amount: opts.amount,
        status: PaymentStatus.SUCCEEDED,
      },
    });
    return b;
  }

  beforeEach(async () => {
    await cleanDatabase();
    await prisma.platformSettings.deleteMany();
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdminService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<AdminService>(AdminService);

    const cat = await prisma.category.create({
      data: { nameAr: 'مطاعم', nameEn: 'Restaurants' },
    });
    categoryId = cat.id;

    vendorAId = await seedVendor({ name: 'A', status: VendorStatus.PENDING, categoryId });
    vendorBId = await seedVendor({ name: 'B', status: VendorStatus.APPROVED, categoryId });
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  /* ═══════════════════════════════════════════
     PLATFORM SETTINGS
     ═══════════════════════════════════════════ */

  describe('commission settings', () => {
    it('(B5 TEST 1) creates and returns the durable 10% default as a percent', async () => {
      const settings = await service.getPlatformSettings();

      expect(settings).toEqual({
        commissionRatePercent: 10,
        updatedAt: expect.any(Date),
      });
      expect(settings).not.toHaveProperty('commissionRate');

      const persisted = await prisma.platformSettings.findUniqueOrThrow({
        where: { id: 1 },
      });
      expect(persisted.commissionRate.toFixed(6)).toBe('0.100000');
    });

    it('(B5 TEST 2) persists 0%, 12.5%, and 100% exactly', async () => {
      const cases = [
        { percent: 0, fraction: '0.000000' },
        { percent: 12.5, fraction: '0.125000' },
        { percent: 100, fraction: '1.000000' },
      ];

      for (const { percent, fraction } of cases) {
        const updated = await service.updateCommissionRate(percent);
        expect(updated.commissionRatePercent).toBe(percent);
        expect(updated).not.toHaveProperty('commissionRate');

        const persisted = await prisma.platformSettings.findUniqueOrThrow({
          where: { id: 1 },
        });
        expect(persisted.commissionRate.toFixed(6)).toBe(fraction);
        expect((await service.getPlatformSettings()).commissionRatePercent).toBe(
          percent,
        );
      }
    });

    it('(B5 TEST 3) rejects invalid DTO values and service bypasses', async () => {
      const invalidInputs: unknown[] = [-0.0001, 100.0001, 12.34567, '12.5', Number.NaN];

      for (const value of invalidInputs) {
        const dto = Object.assign(new UpdateCommissionSettingsDto(), {
          commissionRatePercent: value,
        });
        expect(await validate(dto)).not.toHaveLength(0);
        await expect(
          service.updateCommissionRate(value as number),
        ).rejects.toThrow(BadRequestException);
      }
    });
  });

  /* ═══════════════════════════════════════════
     VENDOR MANAGEMENT
     ═══════════════════════════════════════════ */

  describe('vendor management', () => {
    it('(TEST 1) listPendingVendors returns only PENDING', async () => {
      const pending = await service.listPendingVendors();
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe(vendorAId);
      expect(pending[0].status).toBe('PENDING');
    });

    it('(TEST 2) approveVendor PENDING → APPROVED', async () => {
      const v = await service.approveVendor(vendorAId);
      expect(v.status).toBe('APPROVED');
    });

    it('(TEST 3) approveVendor twice → Conflict', async () => {
      await service.approveVendor(vendorAId);
      await expect(service.approveVendor(vendorAId)).rejects.toThrow(
        ConflictException,
      );
    });

    it('(TEST 4) approveVendor unknown → NotFound', async () => {
      await expect(service.approveVendor('does-not-exist')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('(TEST 5) suspendVendor APPROVED → SUSPENDED', async () => {
      const v = await service.suspendVendor(vendorBId, 'audit');
      expect(v.status).toBe('SUSPENDED');
    });
  });

  /* ═══════════════════════════════════════════
     REPORTS
     ═══════════════════════════════════════════ */

  describe('reports', () => {
    it('(TEST 6) kpis includes users, vendors, GMV, commission', async () => {
      /* Seed a customer + booking */
      const passwordHash = await bcrypt.hash('password123', 4);
      const c = await prisma.user.create({
        data: { name: 'Cust', email: 'cust@t.com', passwordHash, role: UserRole.CUSTOMER },
      });
      const svc = await prisma.service.create({
        data: {
          vendorId: vendorBId,
          title: 'Lunch',
          price: '100',
          durationMinutes: 60,
          categoryId,
        },
      });
      await seedConfirmedBooking({
        vendorId: vendorBId,
        serviceId: svc.id,
        customerId: c.id,
        amount: '100',
        commission: '10',
        daysFromNow: 1,
      });
      await seedConfirmedBooking({
        vendorId: vendorBId,
        serviceId: svc.id,
        customerId: c.id,
        amount: '200',
        commission: '20',
        daysFromNow: 2,
      });

      const k = await service.kpis();
      expect(k.users).toBeGreaterThanOrEqual(3); // 2 vendors + 1 customer
      expect(k.vendors).toBe(2);
      expect(k.approvedVendors).toBe(1); // only B is APPROVED
      expect(k.bookings).toBe(2);
      expect(k.succeededPayments).toBe(2);
      expect(k.gmv).toBe(300); // 100 + 200
      expect(k.commission).toBe(30); // 10 + 20
      expect(k.netRevenue).toBe(300); // no refunds yet
    });

    it('(TEST 7) revenueByDay buckets by day and returns the requested span', async () => {
      const r = await service.revenueByDay(7);
      expect(r.length).toBe(7);
      /* Each entry is a date string + amount + count */
      for (const p of r) {
        expect(p.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(typeof p.amount).toBe('number');
        expect(typeof p.count).toBe('number');
      }
    });

    it('(TEST 8) topVendors orders by GMV desc and includes category', async () => {
      const passwordHash = await bcrypt.hash('password123', 4);
      const c = await prisma.user.create({
        data: { name: 'C', email: 'c@t.com', passwordHash, role: UserRole.CUSTOMER },
      });
      const svc = await prisma.service.create({
        data: { vendorId: vendorBId, title: 'Lunch', price: '100', durationMinutes: 60, categoryId },
      });
      await seedConfirmedBooking({
        vendorId: vendorBId,
        serviceId: svc.id,
        customerId: c.id,
        amount: '500',
        commission: '50',
        daysFromNow: 1,
      });

      const top = await service.topVendors(5);
      expect(top.length).toBeGreaterThanOrEqual(1);
      expect(top[0].gmv).toBeGreaterThanOrEqual(500);
      expect(top[0].category).toBe('Restaurants');
      expect(top[0].avgRating).toBe(4.5);
    });

    it('(TEST 9) disputes returns customer-cancelled bookings', async () => {
      const passwordHash = await bcrypt.hash('password123', 4);
      const c = await prisma.user.create({
        data: { name: 'C', email: 'c@t.com', passwordHash, role: UserRole.CUSTOMER },
      });
      const svc = await prisma.service.create({
        data: { vendorId: vendorBId, title: 'Lunch', price: '100', durationMinutes: 60, categoryId },
      });
      const b = await prisma.booking.create({
        data: {
          customerId: c.id,
          vendorId: vendorBId,
          serviceId: svc.id,
          startTime: new Date(Date.now() + 24 * 60 * 60_000),
          endTime: new Date(Date.now() + 25 * 60 * 60_000),
          status: BookingStatus.CANCELLED,
          priceAtBooking: '100',
          commissionAmount: '10',
          cancellationReason: 'plans changed',
          cancelledBy: c.id,
        },
      });

      const disputes = await service.listDisputes();
      expect(disputes.length).toBe(1);
      expect(disputes[0].id).toBe(b.id);
      expect(disputes[0].cancellationReason).toBe('plans changed');
    });
  });
});