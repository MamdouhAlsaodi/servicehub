/**
 * Cancel booking DTO.
 *
 * Phase 3.5 — Cancel Booking.
 *
 * Customers can cancel their own bookings. Vendors can cancel any of
 * their own bookings. The service enforces the 24-hour cancellation
 * window and ownership rules.
 */
import { IsString, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CancelBookingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(500)
  reason!: string;

  @IsString()
  @IsOptional()
  @MaxLength(500)
  internalNote?: string;
}