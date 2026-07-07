/**
 * Phase 5 — Reviews Service.
 *
 * Owns:
 *   - createReview     — rating 1..5 for a CONFIRMED booking; recomputes
 *                        the VendorProfile.avgRating in the same tx.
 *   - findForVendor    — public listing, paginated, sorted by date desc.
 *   - findMine         — for the "my reviews" page.
 *
 * Why avgRating is recomputed in-app:
 *   - Postgres triggers can do this, but doing it inside the same
 *     transaction as the review insert means we never see a half-state.
 *   - We round to 1 decimal place so the UI doesn't display 4.33333.
 *
 * Concurrency:
 *   - Two simultaneous reviews on the same booking would race on the
 *     unique constraint on Review.bookingId. We rely on that to dedupe
 *     — no application-level lock needed.
 */
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { BookingStatus, Review } from '@prisma/client';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ═══════════════════════════════════════════
     5.4 CREATE REVIEW
     ═══════════════════════════════════════════ */

  async createReview(userId: string, dto: CreateReviewDto): Promise<Review> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: dto.bookingId },
      include: { review: true },
    });
    if (!booking) {
      throw new NotFoundException('Booking not found');
    }
    if (booking.customerId !== userId) {
      throw new ForbiddenException('You can only review your own bookings');
    }
    if (booking.status !== BookingStatus.CONFIRMED) {
      throw new BadRequestException(
        `Booking must be CONFIRMED to review (current: ${booking.status})`,
      );
    }
    if (booking.review) {
      throw new ConflictException('This booking already has a review');
    }

    /* Single transaction: insert the review and recompute avgRating
     * from the full set of vendor reviews. This is cheap (one
     * aggregate query) and avoids stale aggregates. */
    return this.prisma.$transaction(async (tx) => {
      const review = await tx.review.create({
        data: {
          bookingId: dto.bookingId,
          userId,
          rating: dto.rating,
          comment: dto.comment ?? null,
        },
      });

      const agg = await tx.review.aggregate({
        where: { booking: { vendorId: booking.vendorId } },
        _avg: { rating: true },
        _count: { _all: true },
      });

      const avg = agg._avg.rating ?? 0;
      /* Round to 1 decimal so the badge stays readable. */
      const rounded = Math.round(avg * 10) / 10;

      await tx.vendorProfile.update({
        where: { id: booking.vendorId },
        data: { avgRating: rounded },
      });

      return review;
    });
  }

  /* ═══════════════════════════════════════════
     READ HELPERS
     ═══════════════════════════════════════════ */

  async findForVendor(
    vendorId: string,
    page = 1,
    limit = 20,
  ): Promise<{
    reviews: Array<Review & { customer: { name: string } }>;
    meta: { total: number; page: number; limit: number };
  }> {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { id: vendorId },
      select: { id: true },
    });
    if (!vendor) throw new NotFoundException('Vendor not found');

    const skip = (page - 1) * limit;
    const [reviews, total] = await Promise.all([
      this.prisma.review.findMany({
        where: { booking: { vendorId } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        include: {
          booking: {
            select: {
              service: { select: { title: true } },
            },
          },
          user: { select: { name: true } },
        },
      }),
      this.prisma.review.count({
        where: { booking: { vendorId } },
      }),
    ]);

    /* Flatten user → customer for the response shape. */
    const shaped = reviews.map((r) => ({
      id: r.id,
      bookingId: r.bookingId,
      userId: r.userId,
      rating: r.rating,
      comment: r.comment,
      createdAt: r.createdAt,
      customer: r.user,
      serviceTitle: r.booking.service.title,
    }));

    return {
      reviews: shaped as unknown as Array<
        Review & { customer: { name: string } }
      >,
      meta: { total, page, limit },
    };
  }

  async findMine(userId: string) {
    return this.prisma.review.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        booking: {
          select: {
            id: true,
            startTime: true,
            service: { select: { title: true } },
            vendor: { select: { id: true, businessName: true } },
          },
        },
      },
    });
  }

  async statsForVendor(vendorId: string): Promise<{
    avgRating: number;
    total: number;
    distribution: Record<1 | 2 | 3 | 4 | 5, number>;
  }> {
    const agg = await this.prisma.review.aggregate({
      where: { booking: { vendorId } },
      _avg: { rating: true },
      _count: { _all: true },
    });

    /* Rating distribution (how many 1-star, 2-star, etc.) — useful
     * for the vendor dashboard chart later. */
    const grouped = await this.prisma.review.groupBy({
      by: ['rating'],
      where: { booking: { vendorId } },
      _count: { _all: true },
    });
    const distribution: Record<1 | 2 | 3 | 4 | 5, number> = {
      1: 0,
      2: 0,
      3: 0,
      4: 0,
      5: 0,
    };
    for (const g of grouped) {
      distribution[g.rating as 1 | 2 | 3 | 4 | 5] = g._count._all;
    }

    return {
      avgRating: Math.round((agg._avg.rating ?? 0) * 10) / 10,
      total: agg._count._all,
      distribution,
    };
  }
}