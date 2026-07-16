/**
 * Phase 5 + B5 — Reviews Service.
 *
 * B5 additions: review moderation lifecycle and ReviewReport audit
 * trail. No Review row is ever deleted by moderation — only state
 * changes. reportReview (non-author, unique-per-reporter) and
 * resolveReport (admin only, OPEN → RESOLVED) are the new entry
 * points. Public surfaces filter HIDDEN out; findMine keeps HIDDEN
 * visible with moderation fields populated.
 */
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import {
  BookingStatus,
  Prisma,
  ReviewModerationStatus,
  ReviewReportAction,
  ReviewReportStatus,
  UserRole,
} from '@prisma/client';
import type { Review, ReviewReport } from '@prisma/client';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';

const PRISMA_UNIQUE_VIOLATION = 'P2002';

/* Public surfaces count VISIBLE+FLAGGED; HIDDEN is excluded. */
const PUBLIC_REVIEW_WHERE: Prisma.ReviewWhereInput['moderationStatus'] = {
  in: [ReviewModerationStatus.VISIBLE, ReviewModerationStatus.FLAGGED],
};

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ═══ CREATE ═══ */

  async createReview(userId: string, dto: CreateReviewDto): Promise<Review> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: { review: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    if (booking.customerId !== userId) {
      throw new ForbiddenException('You can only review your own bookings');
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException(
        `Booking must be CONFIRMED to review (current: ${booking.status})`,
      );
    }
    if (booking.review) throw new ConflictException('This booking already has a review');

    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          bookingId: dto.bookingId, userId,
          rating: dto.rating, comment: dto.comment ?? null,
        },
      });

      /* B5 — avgRating from VISIBLE+FLAGGED only. */
      const agg = await tx.review.aggregate({
        where: { booking: { vendorId: booking.vendorId }, moderationStatus: PUBLIC_REVIEW_WHERE },
        _avg: { rating: true }, _count: { _all: true },
      });

      const rounded = Math.round((agg._avg.rating ?? 0) * 10) / 10;
      await tx.vendorProfile.update({
        where: { id: booking.vendorId },
        data: { avgRating: rounded },
      });

      return review;
    });
  }

  /* ═══ READ (HIDDEN filtered on public surfaces) ═══ */

  async findForVendor(vendorId: string, page = 1, limit = 20) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId }, select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const skip = (page - 1) * limit;
    const where: Prisma.ReviewWhereInput = {
      booking: { vendorId }, moderationStatus: PUBLIC_REVIEW_WHERE,
    };
    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: limit,
        include: {
          booking: { select: { service: { select: { title: true } } } },
          user: { select: { name: true } },
        },
      }),
      this.prisma.review.count({ where }),
    ]);

    const shaped = reviews.map((r) => ({
      id: r.id, bookingId: r.bookingId, userId: r.userId,
      rating: r.rating, comment: r.comment, createdAt: r.createdAt,
      customer: r.user, serviceTitle: r.booking.service.title,
    }));

    return {
      reviews: shaped as unknown as Array<Review & { customer: { name: string } }>,
      meta: { total, page, limit },
    };
  }

  async findMine(userId: string) {
    /* B5 — owner-facing list shows every authored review INCLUDING
     * HIDDEN, so the author can see the moderation status. */
    return this.prisma.review.findMany({
      where: { userId }, orderBy: { createdAt: 'desc' },
      include: {
        booking: {
          select: {
            id: true, startTime: true,
            service: { select: { title: true } },
            vendor: { select: { id: true, businessName: true } },
          },
        },
      },
    });
  }

  async statsForVendor(vendorId: string) {
    const where: Prisma.ReviewWhereInput = {
      booking: { vendorId }, moderationStatus: PUBLIC_REVIEW_WHERE,
    };
    const agg = await this.prisma.review.aggregate({
      where, _avg: { rating: true }, _count: { _all: true },
    });
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'], where, _count: { _all: true },
    });
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const g of grouped) {
      distribution[g.rating as 1 | 2 | 3 | 4 | 5] = g._count._all;
    }
    return {
      avgRating: Math.round((agg._avg.rating ?? 0) * 10) / 10,
      total: agg._count._all, distribution,
    };
  }

  /* ═══ B5 — MODERATION (audit-only) ═══ */

  /** Open a moderation report against a review. Author cannot self-report.
   *  Duplicate (reviewId, reporterUserId) → Conflict. First report also
   *  FLAGS the review so the public surface still shows it pending
   *  admin review (no silent removal). */
  async reportReview(
    reporterUserId: string, reviewId: string, dto: ReportReviewDto,
  ): Promise<ReviewReport> {
    const review = await this.prisma.review.findUnique({
      where: { id: reviewId }, select: { id: true, userId: true, moderationStatus: true },
    });
    if (!review) throw new NotFoundException('Review not found');
    if (review.userId === reporterUserId) {
      throw new ForbiddenException('You cannot report your own review');
    }

    const reason = dto.reason.trim();
    if (!reason) throw new BadRequestException('reason cannot be blank');

    try {
      return await this.prisma.$transaction(async (tx) => {
        const report = await tx.reviewReport.create({
          data: { reviewId, reporterUserId, reason, status: ReviewReportStatus.OPEN },
        });
        if (review.moderationStatus === ReviewModerationStatus.VISIBLE) {
          await tx.review.update({
            where: { id: reviewId },
            data: {
              moderationStatus: ReviewModerationStatus.FLAGGED,
              moderationChangedAt: new Date(),
            },
          });
        }
        return report;
      });
    } catch (err) {
      if (this.isUniqueViolation(err)) {
        throw new ConflictException('You have already reported this review');
      }
      throw err;
    }
  }

  /** Admin queue. Defence-in-depth: re-checks ADMIN role even though
   *  RolesGuard guards the route. */
  async listReports(
    adminUserId: string, opts: { status?: ReviewReportStatus; limit?: number } = {},
  ): Promise<ReviewReport[]> {
    await this.assertAdminActor(adminUserId);
    const where: Prisma.ReviewReportWhereInput = opts.status ? { status: opts.status } : {};
    return this.prisma.reviewReport.findMany({
      where, orderBy: { reportedAt: 'desc' },
      take: Math.min(Math.max(opts.limit ?? 100, 1), 200),
    });
  }

  /** Admin resolves an OPEN report. Updates both the report (status +
   *  audit fields) and the Review.moderationStatus atomically. The
   *  Review row is never deleted. */
  async resolveReport(
    adminUserId: string, reportId: string,
    action: ReviewReportAction, note?: string,
  ): Promise<ReviewReport> {
    await this.assertAdminActor(adminUserId);
    const report = await this.prisma.reviewReport.findUnique({ where: { id: reportId } });
    if (!report) throw new NotFoundException('Report not found');
    if (report.status !== ReviewReportStatus.OPEN) {
      throw new ConflictException(
        `Report is already ${report.status} and cannot be re-resolved`,
      );
    }

    const target: ReviewModerationStatus =
      action === ReviewReportAction.HIDE
        ? ReviewModerationStatus.HIDDEN
        : ReviewModerationStatus.VISIBLE;
    const trimmedNote = note?.trim() || null;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.reviewReport.update({
        where: { id: reportId },
        data: {
          status: ReviewReportStatus.RESOLVED,
          resolutionAction: action, resolutionNote: trimmedNote,
          resolvedByUserId: adminUserId, resolvedAt: new Date(),
        },
      });
      await tx.review.update({
        where: { id: report.reviewId },
        data: {
          moderationStatus: target,
          moderationChangedAt: new Date(),
          moderationNote: trimmedNote,
        },
      });
      return updated;
    });
  }

  /* ─── INTERNAL ─── */

  private async assertAdminActor(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId }, select: { role: true },
    });
    if (!user || user.role !== UserRole.ADMIN) {
      throw new ForbiddenException('Admin role required');
    }
  }

  private isUniqueViolation(err: unknown): boolean {
    return (
      typeof err === 'object' && err !== null && 'code' in err &&
      (err as { code?: string }).code === PRISMA_UNIQUE_VIOLATION
    );
  }
}