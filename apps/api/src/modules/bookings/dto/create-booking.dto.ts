/**
 * Create booking DTO.
 *
 * Phase 3 — Booking Engine.
 *
 * The customer picks:
 *  - serviceId (must belong to an APPROVED vendor and be isActive)
 *  - startTime (ISO 8601, must be in the future)
 *
 * The service is looked up server-side to derive durationMinutes and
 * priceAtBooking. The vendorId and endTime are NOT accepted from the
 * client — they are derived to prevent client-side tampering.
 */
import {
  IsString,
  IsISO8601,
  IsNotEmpty,
  IsOptional,
} from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateBookingDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  /**
   * ISO 8601 with timezone offset, e.g. "2026-07-15T14:30:00-03:00".
   * class-validator's IsISO8601 accepts both with and without offset.
   */
  @IsISO8601()
  @Transform(({ value }: { value: string }) => {
    if (!value) return value;
    // Normalize: ensure we send a Date when class-transformer is enabled.
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toISOString();
  })
  startTime!: string;

  /**
   * Optional idempotency key — clients should pass the same key when
   * retrying a create. Lets the server return the existing booking
   * instead of failing the unique constraint on the second attempt.
   */
  @IsString()
  @IsOptional()
  idempotencyKey?: string;
}