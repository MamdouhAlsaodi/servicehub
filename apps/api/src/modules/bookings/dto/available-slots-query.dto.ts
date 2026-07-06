/**
 * Query DTO for available-slots lookup.
 *
 * Phase 3.4 — GET available slots.
 *
 * Used by the public booking flow: "show me open 30-minute slots on
 * 2026-07-15 for service X". The service expands the vendor's weekly
 * availability into per-slot start times, then removes any slot that
 * conflicts with an existing CONFIRMED or live PENDING_PAYMENT booking.
 */
import { IsString, IsISO8601, IsInt, Min, Max, IsOptional, IsNotEmpty } from 'class-validator';
import { Transform } from 'class-transformer';

export class AvailableSlotsQueryDto {
  @IsString()
  @IsNotEmpty()
  serviceId!: string;

  /**
   * Day to query, ISO 8601 date (YYYY-MM-DD). Vendor's local timezone
   * is honoured; the vendor profile's `timezone` column is used.
   */
  @IsISO8601()
  @Transform(({ value }: { value: string }) => {
    if (!value) return value;
    const d = new Date(value);
    if (isNaN(d.getTime())) return value;
    return d.toISOString().slice(0, 10);
  })
  date!: string;

  /**
   * Optional override for the slot duration step (defaults to the
   * service's durationMinutes). Useful for short demo queries.
   */
  @IsInt()
  @Min(15)
  @Max(240)
  @IsOptional()
  @Transform(({ value }: { value: string }) =>
    value === undefined || value === '' ? undefined : parseInt(value, 10),
  )
  slotMinutes?: number;
}