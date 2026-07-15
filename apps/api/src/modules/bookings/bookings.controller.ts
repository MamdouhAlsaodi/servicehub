/**
 * Phase 3 — Bookings Controller.
 *
 * Routes:
 *   POST /bookings                    — create (3.1)         [customer]
 *   GET  /bookings/available-slots    — find free slots (3.4)[public]
 *   GET  /bookings/me                 — my bookings list     [any]
 *   GET  /bookings/:id                — single booking        [owner]
 *   POST /bookings/:id/cancel         — cancel (3.5)          [owner]
 */
import {
  BadRequestException,
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
import { BookingsService } from './bookings.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { AvailableSlotsQueryDto } from './dto/available-slots-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingStatus, UserRole } from '@prisma/client';

/* Hard cap on `limit` for the vendor dashboard read model. Clamped
 * in the controller (and re-clamped in the service) so a single
 * endpoint can never ask the DB for more than 20 rows. */
const DASHBOARD_DEFAULT_LIMIT = 5;
const DASHBOARD_MAX_LIMIT = 20;

@Controller('bookings')
export class BookingsController {
  constructor(private readonly bookingsService: BookingsService) {}

  /* ═══════════════════════════════════════════
     3.1 CREATE BOOKING
     ═══════════════════════════════════════════ */

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateBookingDto,
  ) {
    const booking = await this.bookingsService.createBooking(dto, userId);
    return {
      booking,
      holdExpiresAt: booking.holdExpiresAt,
      holdMinutes: this.bookingsService.getHoldExpiryMinutes(),
      message:
        'Booking created. Complete payment within the hold window to confirm.',
    };
  }

  /* ═══════════════════════════════════════════
     3.4 AVAILABLE SLOTS
     ═══════════════════════════════════════════ */

  @Get('available-slots')
  async availableSlots(@Query() query: AvailableSlotsQueryDto) {
    return this.bookingsService.findAvailableSlots(
      query.serviceId,
      query.date,
      query.slotMinutes,
    );
  }

  /* ═══════════════════════════════════════════
     READ
     ═══════════════════════════════════════════ */

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async myBookings(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Query('status') status?: BookingStatus,
  ) {
    return this.bookingsService.findMyBookings(userId, role, status);
  }

  /* ═══════════════════════════════════════════
     VENDOR DASHBOARD (B2 Task 4)
     ═══════════════════════════════════════════ */

  /* Declared BEFORE @Get(':id') so NestJS routes the literal
   * 'vendor/dashboard' segment here instead of treating 'vendor'
   * as an :id parameter. */
  @Get('vendor/dashboard')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async vendorDashboard(
    @CurrentUser('id') userId: string,
    @Query('limit') limitRaw?: string,
  ) {
    const limit = this.parseDashboardLimit(limitRaw);
    return this.bookingsService.getVendorDashboard(userId, limit);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  async findOne(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id') id: string,
  ) {
    return this.bookingsService.findOne(id, userId, role);
  }

  /* ═══════════════════════════════════════════
     3.5 CANCEL
     ═══════════════════════════════════════════ */

  @Post(':id/cancel')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async cancel(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('id') id: string,
    @Body() dto: CancelBookingDto,
  ) {
    return this.bookingsService.cancelBooking(id, userId, role, dto);
  }

  /**
   * Parse `?limit=` into [1, DASHBOARD_MAX_LIMIT]. Default is
   * DASHBOARD_DEFAULT_LIMIT when absent. Non-integers and out-of-range
   * values are rejected with 400 (not silently clamped) so caller bugs
   * surface immediately.
   */
  private parseDashboardLimit(raw?: string): number {
    if (raw === undefined || raw === '') return DASHBOARD_DEFAULT_LIMIT;
    const trimmed = raw.trim();
    if (!/^-?\d+$/.test(trimmed)) throw new BadRequestException('limit must be an integer');
    const n = parseInt(trimmed, 10);
    if (!Number.isFinite(n) || n < 1) throw new BadRequestException('limit must be >= 1');
    if (n > DASHBOARD_MAX_LIMIT) throw new BadRequestException(`limit must be <= ${DASHBOARD_MAX_LIMIT}`);
    return n;
  }
}