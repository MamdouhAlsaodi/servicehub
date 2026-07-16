/**
 * Vendor-facing input for `POST /payouts`.
 *
 * Validation:
 *   - `amount` must be a finite, positive number with at most two
 *     fractional digits. The CHECK constraint on the DB column
 *     (`amount > 0`) is the durable floor; class-validator gives
 *     early 400s with a clear message.
 *
 * Money safety:
 *   - Decimal type is enforced at the service layer (`Prisma.Decimal`).
 *   - The DTO only validates the *shape*; arithmetic happens against
 *     the eligible-balance Decimal in `PayoutsService.createRequest`,
 *     which is the only authoritative source of truth.
 */
import { IsNumber, IsOptional, IsString, MaxLength, Min } from 'class-validator';

export class CreatePayoutRequestDto {
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  @Min(0.01, { message: 'amount must be greater than 0' })
  amount!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  vendorNote?: string;
}