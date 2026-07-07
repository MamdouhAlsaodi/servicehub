/**
 * Create review DTO.
 *
 * Constraints enforced by service:
 *   - rating 1..5 (validated here)
 *   - the booking must be CONFIRMED (i.e. payment succeeded)
 *   - the booking must belong to this user
 *   - the booking must not already have a review (one per booking)
 */
import { IsString, IsInt, Min, Max, IsNotEmpty, IsOptional, MaxLength } from 'class-validator';

export class CreateReviewDto {
  @IsString()
  @IsNotEmpty()
  bookingId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsString()
  @IsOptional()
  @MaxLength(2000)
  comment?: string;
}