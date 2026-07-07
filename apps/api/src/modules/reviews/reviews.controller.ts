/**
 * Phase 5 — Reviews Controller.
 *
 * Routes:
 *   POST /reviews                  — create (5.4)
 *   GET  /reviews/vendor/:vendorId — list for a vendor (public)
 *   GET  /reviews/vendor/:vendorId/stats — distribution + average
 *   GET  /reviews/me               — my reviews
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

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
      vendorId,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 20,
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