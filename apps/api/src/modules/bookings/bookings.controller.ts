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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { BookingStatus, UserRole } from '@prisma/client';

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
}