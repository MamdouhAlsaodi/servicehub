/**
 * B5 — Local payout-request service. State machine:
 *   REQUESTED → APPROVED → PAID
 *   REQUESTED → REJECTED
 *   APPROVED  → REJECTED
 * Anything else throws ConflictException. The DB partial unique
 * index (one active per vendor) backs "no double allocation"; the
 * service maps its P2002 → 409. Money is Decimal throughout;
 * currency is fixed to BRL by both the service and the DB CHECK.
 * No payment provider / bank API call is made — PAID is an admin's
 * local declaration. No provider id, account number, IBAN, PIX key,
 * or any payout credential is stored on the row.
 */
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PaymentStatus, Prisma, PayoutStatus, UserRole } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';

const FIXED_CURRENCY = 'brl';
const PRISMA_UNIQUE_VIOLATION = 'P2002';

@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /* ─── CREATE ─── */

  async createRequest(actorUserId: string, amountNumber: number, vendorNote?: string) {
    if (!Number.isFinite(amountNumber)) {
      throw new BadRequestException('amount must be a finite number');
    }
    const amount = new Prisma.Decimal(amountNumber.toString());
    if (amount.lessThanOrEqualTo(0)) {
      throw new BadRequestException('amount must be greater than 0');
    }
    if (amount.decimalPlaces() > 2) {
      throw new BadRequestException('amount must have at most 2 decimal places');
    }

    const profile = await this.findOwnedVendorProfile(actorUserId);
    const eligible = await this.computeEligibility(profile.id);

    if (amount.greaterThan(eligible.available)) {
      throw new BadRequestException(
        `Requested amount ${amount.toFixed(2)} exceeds available ` +
          `eligible balance ${eligible.available.toFixed(2)}`,
      );
    }

    try {
      const created = await this.prisma.payoutRequest.create({
        data: {
          vendorId: profile.id,
          amount,
          currency: FIXED_CURRENCY,
          status: PayoutStatus.REQUESTED,
          vendorNote: vendorNote?.trim() || null,
          requestedByUserId: actorUserId,
        },
      });
      this.logger.log(
        `payout-request ${created.id} created vendor=${profile.id} amount=${amount.toFixed(2)}`,
      );
      return this.toResponse(created);
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException(
          'You already have an active payout request (REQUESTED or APPROVED). ' +
            'Resolve it before submitting another.',
        );
      }
      throw err;
    }
  }

  /* ─── READ ─── */

  async listForVendor(actorUserId: string, limit = 50) {
    const profile = await this.findOwnedVendorProfile(actorUserId);
    const rows = await this.prisma.payoutRequest.findMany({
      where: { vendorId: profile.id },
      orderBy: { requestedAt: 'desc' },
      take: Math.min(Math.max(limit, 1), 100),
    });
    return {
      items: rows.map((r) => this.toResponse(r)),
      eligibility: await this.computeEligibility(profile.id),
    };
  }

  async listAll(opts: { status?: PayoutStatus; limit?: number } = {}) {
    const where: Prisma.PayoutRequestWhereInput = opts.status ? { status: opts.status } : {};
    const rows = await this.prisma.payoutRequest.findMany({
      where,
      orderBy: { requestedAt: 'desc' },
      take: Math.min(Math.max(opts.limit ?? 100, 1), 200),
    });
    return rows.map((r) => this.toResponse(r));
  }

  async getEligibilityForVendor(actorUserId: string) {
    const profile = await this.findOwnedVendorProfile(actorUserId);
    const e = await this.computeEligibility(profile.id);
    return {
      vendorId: profile.id,
      available: this.toMoneyString(e.available),
      earned: this.toMoneyString(e.earned),
      refunded: this.toMoneyString(e.refunded),
      commission: this.toMoneyString(e.commission),
      outstandingPayouts: this.toMoneyString(e.outstandingPayouts),
    };
  }

  /** earned=Σpayment.amount, refunded=Σpayment.refundedAmount,
   *  commission=Σbooking.commissionAmount, outstanding=Σpayout.amount
   *  (REQUESTED|APPROVED|PAID). REJECTED is excluded — capital released.
   *  available = earned − refunded − commission − outstanding. */
  async computeEligibility(vendorId: string) {
    const [succeeded, outstanding] = await Promise.all([
      this.prisma.payment.findMany({
        where: { status: PaymentStatus.SUCCEEDED, booking: { vendorId } },
        select: {
          amount: true, refundedAmount: true,
          booking: { select: { commissionAmount: true } },
        },
      }),
      this.prisma.payoutRequest.aggregate({
        where: {
          vendorId,
          status: { in: [PayoutStatus.REQUESTED, PayoutStatus.APPROVED, PayoutStatus.PAID] },
        },
        _sum: { amount: true },
      }),
    ]);

    let earned = new Prisma.Decimal(0);
    let refunded = new Prisma.Decimal(0);
    let commission = new Prisma.Decimal(0);
    for (const p of succeeded) {
      earned = earned.plus(p.amount);
      refunded = refunded.plus(p.refundedAmount);
      commission = commission.plus(p.booking.commissionAmount);
    }
    const outstandingPayouts = new Prisma.Decimal(outstanding._sum.amount?.toString() ?? '0');
    const available = earned.minus(refunded).minus(commission).minus(outstandingPayouts);
    return { available, earned, refunded, commission, outstandingPayouts };
  }

  /* ─── TRANSITIONS ─── */

  /** Re-checks eligibility at decision time (balance may have shifted since the request was made — refunds, etc.). */
  async approveRequest(adminUserId: string, payoutId: string, reason?: string) {
    await this.assertAdminActor(adminUserId);
    const payout = await this.requirePayout(payoutId);
    this.assertTransitionAllowed(payout.status, PayoutStatus.APPROVED);

    /* available already excludes this REQUESTED payout; compare against
     * available + this.amount. If that pool has shrunk, refuse. */
    const pool = (await this.computeEligibility(payout.vendorId)).available.plus(payout.amount);
    if (payout.amount.greaterThan(pool)) {
      throw new ConflictException(
        `Cannot approve: payout amount ${payout.amount.toFixed(2)} ` +
          `exceeds current eligible balance ${pool.toFixed(2)}`,
      );
    }
    return this.applyTransition(payoutId, PayoutStatus.APPROVED, {
      adminReason: reason?.trim() || null,
      decidedByUserId: adminUserId,
      decidedAt: new Date(),
    });
  }

  async rejectRequest(adminUserId: string, payoutId: string, reason?: string) {
    await this.assertAdminActor(adminUserId);
    const payout = await this.requirePayout(payoutId);
    this.assertTransitionAllowed(payout.status, PayoutStatus.REJECTED);
    return this.applyTransition(payoutId, PayoutStatus.REJECTED, {
      adminReason: reason?.trim() || null,
      decidedByUserId: adminUserId,
      decidedAt: new Date(),
    });
  }

  async markPaidRequest(adminUserId: string, payoutId: string, note?: string) {
    await this.assertAdminActor(adminUserId);
    const payout = await this.requirePayout(payoutId);
    this.assertTransitionAllowed(payout.status, PayoutStatus.PAID);
    return this.applyTransition(payoutId, PayoutStatus.PAID, {
      adminReason: note?.trim() ?? payout.adminReason ?? null,
      paidByUserId: adminUserId,
      paidAt: new Date(),
    });
  }

  /** Shared write path. Caller must have validated with assertTransitionAllowed. */
  private async applyTransition(
    payoutId: string,
    target: PayoutStatus,
    extra: Prisma.PayoutRequestUpdateInput,
  ) {
    const updated = await this.prisma.payoutRequest.update({
      where: { id: payoutId },
      data: { status: target, ...extra },
    });
    this.logger.log(`payout-request ${payoutId} → ${target}`);
    return this.toResponse(updated);
  }

  /* ─── INTERNAL HELPERS ─── */

  private async findOwnedVendorProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }, select: { id: true, role: true },
    });
    if (!user) throw new ForbiddenException('Unknown user');
    if (user.role !== UserRole.VENDOR) {
      throw new ForbiddenException('Only VENDOR accounts may request payouts');
    }
    const profile = await this.prisma.vendorProfile.findUnique({
      where: { userId }, select: { id: true, status: true },
    });
    if (!profile) throw new NotFoundException('Vendor profile not found');
    return profile;
  }

  /** Defence-in-depth role check — guards may be bypassed; service is the last line. */
  private async assertAdminActor(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role !== UserRole.ADMIN) throw new ForbiddenException('Admin role required');
  }

  private async requirePayout(payoutId: string) {
    const payout = await this.prisma.payoutRequest.findUnique({ where: { id: payoutId } });
    if (!payout) throw new NotFoundException('Payout request not found');
    return payout;
  }

  private assertTransitionAllowed(from: PayoutStatus, to: PayoutStatus): void {
    const allowed: Record<PayoutStatus, ReadonlyArray<PayoutStatus>> = {
      [PayoutStatus.REQUESTED]: [PayoutStatus.APPROVED, PayoutStatus.REJECTED],
      [PayoutStatus.APPROVED]: [PayoutStatus.PAID, PayoutStatus.REJECTED],
      [PayoutStatus.REJECTED]: [],
      [PayoutStatus.PAID]: [],
    };
    if (!allowed[from].includes(to)) {
      throw new ConflictException(`Invalid payout transition: ${from} → ${to}`);
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' && err !== null && 'code' in err &&
      (err as { code?: string }).code === PRISMA_UNIQUE_VIOLATION
    );
  }

  /** Two-decimal monetary string for API responses. Zero serialises as
   *  '0' (not '0.00') so consumers can distinguish "no money" from
   *  "rounding" without losing sign semantics. Decimal math itself
   *  remains exact; this only formats the response shape. */
  private toMoneyString(d: Prisma.Decimal): string {
    return d.isZero() ? '0' : d.toFixed(2);
  }

  /** Decimal amounts serialised as STRINGS to preserve precision. */
  private toResponse(
    row: Awaited<ReturnType<PrismaClient['payoutRequest']['findUnique']>>,
  ) {
    const r = row!;
    const iso = (d: Date | null) => (d ? d.toISOString() : null);
    return {
      id: r.id, vendorId: r.vendorId,
      amount: r.amount.toString(), currency: r.currency, status: r.status,
      vendorNote: r.vendorNote, adminReason: r.adminReason,
      requestedByUserId: r.requestedByUserId,
      decidedByUserId: r.decidedByUserId, paidByUserId: r.paidByUserId,
      requestedAt: r.requestedAt.toISOString(),
      decidedAt: iso(r.decidedAt), paidAt: iso(r.paidAt),
      updatedAt: r.updatedAt.toISOString(),
    };
  }
}