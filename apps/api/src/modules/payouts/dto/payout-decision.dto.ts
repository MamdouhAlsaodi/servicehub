/**
 * Admin-facing inputs for the three state transitions on
 * `PayoutRequest`: APPROVE, REJECT, MARK PAID.
 *
 * All fields are optional. The admin may add a free-text reason or
 * note to make the audit trail legible, but the service treats the
 * DTO as advisory — the transition itself is what matters.
 */
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class PayoutDecisionDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PayoutPaidDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}