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
import {
  BookingStatus,
  DisputeResolutionAction,
  DisputeResolutionStatus,
  PaymentStatus,
  VendorStatus,
  Prisma,
} from '@prisma/client';
import { PaymentsService, RefundProviderException } from '../payments/payments.service';
import { ResolveDisputeDto } from './dto/resolve-dispute.dto';

const PLATFORM_SETTINGS_ID = 1;
const DEFAULT_COMMISSION_RATE = new Prisma.Decimal('0.10');
const COMMISSION_VALIDATION_MESSAGE =
  'commissionRatePercent must be from 0 to 100 with at most four fractional digits';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly paymentsService: PaymentsService,
  ) {}

  /* ═══════════════════════════════════════════
     PLATFORM SETTINGS
     ═══════════════════════════════════════════ */

  async getPlatformSettings() {
    const existing = await this.prisma.platformSettings.findUnique({
      where: { id: PLATFORM_SETTINGS_ID },
      select: { commissionRate: true, updatedAt: true },
    });
    const settings =
      existing ??
      (await this.prisma.platformSettings.upsert({
        where: { id: PLATFORM_SETTINGS_ID },
        update: {},
        create: {
          id: PLATFORM_SETTINGS_ID,
          commissionRate: DEFAULT_COMMISSION_RATE,
        },
        select: { commissionRate: true, updatedAt: true },
      }));

    return {
      commissionRatePercent: settings.commissionRate.mul(100).toNumber(),
      updatedAt: settings.updatedAt,
    };
  }

  async updateCommissionRate(commissionRatePercent: number) {
    if (
      typeof commissionRatePercent !== 'number' ||
      !Number.isFinite(commissionRatePercent)
    ) {
      throw new BadRequestException(COMMISSION_VALIDATION_MESSAGE);
    }

    const percent = new Prisma.Decimal(commissionRatePercent.toString());
    if (
      percent.lessThan(0) ||
      percent.greaterThan(100) ||
      percent.decimalPlaces() > 4
    ) {
      throw new BadRequestException(COMMISSION_VALIDATION_MESSAGE);
    }

    const settings = await this.prisma.platformSettings.upsert({
      where: { id: PLATFORM_SETTINGS_ID },
      update: { commissionRate: percent.div(100) },
      create: {
        id: PLATFORM_SETTINGS_ID,
        commissionRate: percent.div(100),
      },
      select: { commissionRate: true, updatedAt: true },
    });

    return {
      commissionRatePercent: settings.commissionRate.mul(100).toNumber(),
      updatedAt: settings.updatedAt,
    };
  }

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
     DISPUTES — Admin resolution of cancelled-booking candidates
     ═══════════════════════════════════════════ */

  async listDisputes() {
    /* The current MVP queue consists of customer-cancelled bookings with
     * a non-system reason. Resolution is recorded separately in
     * DisputeResolution; this is not a customer claim-opening portal. */
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

  async resolveDispute(bookingId: string, adminUserId: string, dto: ResolveDisputeDto) {
    const reason = dto.reason?.trim();
    if (!reason) throw new BadRequestException('reason is required');
    if ((dto.action === DisputeResolutionAction.REJECT || dto.action === DisputeResolutionAction.FULL_REFUND) && dto.amount !== undefined) {
      throw new BadRequestException(`${dto.action} must not include an amount`);
    }

    const claim = await this.prisma.$transaction(async (tx) => {
      const booking = await tx.booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.status !== BookingStatus.CANCELLED) throw new BadRequestException('Only cancelled bookings are dispute candidates');
      if (!booking.cancellationReason?.trim() || booking.cancelledBy === 'system:payment') {
        throw new BadRequestException('Booking is not an admin dispute candidate');
      }
      if (!booking.payment) throw new ConflictException('Booking has no payment');

      const remaining = new Prisma.Decimal(booking.payment.amount).minus(booking.payment.refundedAmount);
      if (remaining.lessThanOrEqualTo(0)) throw new ConflictException('Payment has no refundable balance');
      let amount: Prisma.Decimal | null = null;
      if (dto.action === DisputeResolutionAction.FULL_REFUND) {
        amount = remaining;
      } else if (dto.action === DisputeResolutionAction.PARTIAL_REFUND) {
        if (typeof dto.amount !== 'number' || !Number.isFinite(dto.amount)) {
          throw new BadRequestException('PARTIAL_REFUND requires a finite positive amount');
        }
        amount = new Prisma.Decimal(dto.amount.toString());
        if (amount.decimalPlaces() > 2 || amount.lessThanOrEqualTo(0) || amount.greaterThanOrEqualTo(remaining)) {
          throw new BadRequestException('Partial refund must be positive, have at most 2 decimals, and be less than the remaining balance');
        }
      }
      if (dto.action !== DisputeResolutionAction.REJECT && booking.payment.status !== PaymentStatus.SUCCEEDED && booking.payment.status !== PaymentStatus.PARTIALLY_REFUNDED) {
        throw new ConflictException('Payment is not refundable');
      }

      try {
        return await tx.disputeResolution.create({
          data: {
            bookingId, action: dto.action, amount, reason, decidedByUserId: adminUserId,
            status: dto.action === DisputeResolutionAction.REJECT ? DisputeResolutionStatus.RESOLVED : DisputeResolutionStatus.PROCESSING,
            resolvedAt: dto.action === DisputeResolutionAction.REJECT ? new Date() : null,
          },
        });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new ConflictException('This dispute already has a resolution decision');
        }
        throw error;
      }
    });

    if (claim.action === DisputeResolutionAction.REJECT) return this.auditResponse(claim);
    try {
      await this.paymentsService.refund(bookingId, { id: adminUserId, role: 'ADMIN' }, Number(claim.amount));
    } catch (error) {
      /* Only an explicit pre-write provider rejection is retryable. Any other
       * error retains PROCESSING for reconciliation, preventing a double refund. */
      if (error instanceof RefundProviderException) {
        await this.prisma.disputeResolution.delete({ where: { bookingId } });
        throw new BadRequestException('Refund provider rejected the request; no decision was recorded');
      }
      this.logger.error(`Refund outcome for dispute ${bookingId} requires reconciliation`, error instanceof Error ? error.stack : undefined);
      throw new ConflictException('Refund outcome is processing and requires reconciliation');
    }

    const resolved = await this.prisma.$transaction((tx) => tx.disputeResolution.update({
      where: { bookingId }, data: { status: DisputeResolutionStatus.RESOLVED, resolvedAt: new Date() },
    }));
    return this.auditResponse(resolved);
  }

  private auditResponse(resolution: {
    bookingId: string; action: DisputeResolutionAction; amount: Prisma.Decimal | null;
    reason: string; status: DisputeResolutionStatus; decidedByUserId: string;
    decidedAt: Date; resolvedAt: Date | null;
  }) {
    return {
      bookingId: resolution.bookingId, action: resolution.action,
      amount: resolution.amount === null ? null : Number(resolution.amount),
      reason: resolution.reason, status: resolution.status,
      decidedByUserId: resolution.decidedByUserId, decidedAt: resolution.decidedAt,
      resolvedAt: resolution.resolvedAt,
    };
  }
}