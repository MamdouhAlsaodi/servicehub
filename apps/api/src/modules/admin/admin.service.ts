/**
 * Phase 7 — Admin Service.
 *
 * Owns:
 *   - listPendingVendors
 *   - approveVendor / suspendVendor
 *   - revenueReport (totals, per-vendor, time-bucketed)
 *   - dispute list / resolve (refund / partial / reject)
 *   - system KPIs (users, vendors, bookings, revenue, GMV)
 *
 * Role enforcement:
 *   - The controller uses @Roles(UserRole.ADMIN) to gate entry.
 *   - We never trust role checks from the DB; they live in the JWT.
 *
 * Why a separate module (not in `vendors`):
 *   - Admin endpoints cross-cut: they need bookings, payments,
 *     vendors, reviews. Importing all of that into VendorsService
 *     creates circular dependencies. A dedicated module keeps the
 *     dependency arrows one-way: Admin → others.
 */
import {
  Injectable,
  BadRequestException,
  ConflictException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { BookingStatus, PaymentStatus, VendorStatus, Prisma } from '@prisma/client';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly prisma: PrismaService) {}

  /* ═══════════════════════════════════════════
     VENDOR MANAGEMENT
     ═══════════════════════════════════════════ */

  async listPendingVendors() {
    return this.prisma.vendorProfile.findMany({
      where: { status: VendorStatus.PENDING },
      orderBy: { createdAt: 'asc' },
      include: {
        user: { select: { id: true, name: true, email: true, phone: true } },
        category: { select: { nameEn: true, nameAr: true } },
      },
    });
  }

  async approveVendor(vendorId: string) {
    const v = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId },
    });
    if (!v) throw new NotFoundException('Vendor not found');
    if (v.status === VendorStatus.APPROVED) {
      throw new ConflictException('Already approved');
    }
    return this.prisma.vendorProfile.update({
      where: { id: vendorId },
      data: { status: VendorStatus.APPROVED },
    });
  }

  async suspendVendor(vendorId: string, reason: string) {
    const v = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId },
    });
    if (!v) throw new NotFoundException('Vendor not found');
    if (v.status === VendorStatus.SUSPENDED) {
      throw new ConflictException('Already suspended');
    }
    return this.prisma.vendorProfile.update({
      where: { id: vendorId },
      data: { status: VendorStatus.SUSPENDED },
    });
  }

  /* ═══════════════════════════════════════════
     REPORTS
     ═══════════════════════════════════════════ */

  /**
   * KPI snapshot for the admin dashboard hero row.
   * Returns everything in a single response so the dashboard doesn't
   * ping the API 5 times on load.
   */
  async kpis() {
    const [users, vendors, approvedVendors, bookings, succeededPayments, refundsAgg] =
      await Promise.all([
        this.prisma.user.count(),
        this.prisma.vendorProfile.count(),
        this.prisma.vendorProfile.count({ where: { status: VendorStatus.APPROVED } }),
        this.prisma.booking.count(),
        this.prisma.payment.aggregate({
          where: { status: PaymentStatus.SUCCEEDED },
          _sum: { amount: true, refundedAmount: true },
          _count: { _all: true },
        }),
        this.prisma.payment.aggregate({
          where: {
            status: { in: [PaymentStatus.REFUNDED, PaymentStatus.PARTIALLY_REFUNDED] },
          },
          _sum: { refundedAmount: true },
        }),
      ]);

    const gmv = Number(succeededPayments._sum.amount ?? 0);
    const netRevenue = gmv - Number(refundsAgg._sum.refundedAmount ?? 0);
    /* Commission is per-booking.commissionAmount — we sum across
     * succeeded payments to get the platform's actual take. */
    const commissionAgg = await this.prisma.booking.aggregate({
      where: {
        payment: { status: PaymentStatus.SUCCEEDED },
      },
      _sum: { commissionAmount: true },
    });
    const commission = Number(commissionAgg._sum.commissionAmount ?? 0);

    return {
      users,
      vendors,
      approvedVendors,
      bookings,
      succeededPayments: succeededPayments._count._all,
      gmv,
      refunds: Number(refundsAgg._sum.refundedAmount ?? 0),
      netRevenue,
      commission,
    };
  }

  /**
   * Time-bucketed revenue (last N days).
   * Uses a SQL query for accuracy — aggregates over tstzrange but
   * we just bucket by date_trunc('day', paidAt).
   */
  async revenueByDay(days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60_000);
    const payments = await this.prisma.payment.findMany({
      where: {
        status: PaymentStatus.SUCCEEDED,
        updatedAt: { gte: since },
      },
      select: { amount: true, updatedAt: true },
    });

    const buckets = new Map<string, { amount: number; count: number }>();
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.now() - i * 24 * 60 * 60_000);
      const key = d.toISOString().slice(0, 10);
      buckets.set(key, { amount: 0, count: 0 });
    }
    for (const p of payments) {
      const key = p.updatedAt.toISOString().slice(0, 10);
      const b = buckets.get(key);
      if (b) {
        b.amount += Number(p.amount);
        b.count += 1;
      }
    }

    return Array.from(buckets.entries())
      .map(([date, v]) => ({ date, amount: v.amount, count: v.count }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Top vendors by GMV (last 30 days).
   * Aggregates payments through bookings → vendor.
   */
  async topVendors(limit = 10) {
    const rows = await this.prisma.booking.groupBy({
      by: ['vendorId'],
      where: {
        payment: { status: PaymentStatus.SUCCEEDED },
        updatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60_000) },
      },
      _sum: { priceAtBooking: true, commissionAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { priceAtBooking: 'desc' } },
      take: limit,
    });

    /* Hydrate vendor names in one query. */
    const ids = rows.map((r) => r.vendorId);
    const vendors = await this.prisma.vendorProfile.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        businessName: true,
        avgRating: true,
        category: { select: { nameEn: true } },
      },
    });
    const byId = new Map(vendors.map((v) => [v.id, v]));

    return rows.map((r) => {
      const v = byId.get(r.vendorId);
      return {
        vendorId: r.vendorId,
        businessName: v?.businessName ?? '(deleted)',
        category: v?.category?.nameEn ?? null,
        avgRating: v?.avgRating ?? 0,
        gmv: Number(r._sum.priceAtBooking ?? 0),
        commission: Number(r._sum.commissionAmount ?? 0),
        bookings: r._count._all,
      };
    });
  }

  /* ═══════════════════════════════════════════
     DISPUTES (placeholder: stub for Phase 7.x)
     ═══════════════════════════════════════════ */

  async listDisputes() {
    /* Disputes aren't in the schema yet; for now we surface
     * CANCELLED bookings with non-system cancellation reasons as
     * the de facto dispute queue. */
    return this.prisma.booking.findMany({
      where: {
        status: BookingStatus.CANCELLED,
        cancelledBy: { not: 'system:payment' },
        cancellationReason: { not: null },
      },
      orderBy: { updatedAt: 'desc' },
      take: 50,
      include: {
        customer: { select: { name: true, email: true } },
        vendor: { select: { businessName: true } },
        service: { select: { title: true } },
      },
    });
  }
}