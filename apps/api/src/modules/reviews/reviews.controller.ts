/**
 * Phase 5 + B5 — Reviews Controller.
 *
 * Routes:
 *   POST /reviews                       — create (5.4)
 *   GET  /reviews/vendor/:vendorId      — public list (HIDDEN filtered)
 *   GET  /reviews/vendor/:vendorId/stats — public stats (HIDDEN filtered)
 *   GET  /reviews/me                    — my reviews (HIDDEN visible w/ moderation)
 *   POST /reviews/:reviewId/reports     — open a moderation report (non-author)
 *   GET  /reviews/reports               — admin queue (?status= filter)
 *   PATCH /reviews/reports/:id/resolve  — admin: KEEP_VISIBLE | HIDE
 *
 * Notes:
 *   - No public DELETE route for a Review. Moderation is HIDE + a
 *     ReviewReport row; the underlying Review is never removed.
 *   - Route declaration order matters: `GET /reviews/reports` is
 *     declared BEFORE `GET /reviews/vendor/:vendorId` so the wildcard
 *     does not swallow the admin queue path.
 */
import {
  Controller, Get, Post, Patch, Body, Param, Query,
  UseGuards, HttpCode, HttpStatus,
} from '@nestjs/common';
import { ReviewReportStatus, UserRole } from '@prisma/client';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { ReportReviewDto } from './dto/report-review.dto';
import { ResolveReportDto } from './dto/resolve-report.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  /* ── B5 — Moderation reports (declared before wildcard vendor route) ── */

  @Get('reports')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async listReports(
    @CurrentUser('id') userId: string,
    @Query('status') status?: ReviewReportStatus,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 100;
    return this.reviewsService.listReports(userId, {
      status, limit: Number.isFinite(n) ? n : 100,
    });
  }

  @Patch('reports/:id/resolve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async resolveReport(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: ResolveReportDto,
  ) {
    return this.reviewsService.resolveReport(userId, id, dto.action, dto.note);
  }

  @Post(':reviewId/reports')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async report(
    @CurrentUser('id') userId: string,
    @Param('reviewId') reviewId: string,
    @Body() dto: ReportReviewDto,
  ) {
    return this.reviewsService.reportReview(userId, reviewId, dto);
  }

  /* ── Phase 5 — Create + read ── */

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateReviewDto,
  ) {
    return this.reviewsService.createReview(userId, dto);
  }

  @Get('vendor/:vendorId')
  async listForVendor(
    @Param('vendorId') vendorId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.reviewsService.findForVendor(
      vendorId, page ? parseInt(page, 10) : 1, limit ? parseInt(limit, 10) : 20,
    );
  }

  @Get('vendor/:vendorId/stats')
  async statsForVendor(@Param('vendorId') vendorId: string) {
    return this.reviewsService.statsForVendor(vendorId);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async myReviews(@CurrentUser('id') userId: string) {
    return this.reviewsService.findMine(userId);
  }
}