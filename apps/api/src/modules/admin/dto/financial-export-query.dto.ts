/**
 * Admin financial CSV export query DTO.
 *
 * All fields are optional. Validation rules:
 *   - `from`, `to` must be ISO-8601 date or datetime strings (strict mode).
 *   - `batchSize` is the Prisma cursor page size; hard-bounded to
 *     FINANCIAL_EXPORT_MAX_BATCH_SIZE (500) so a malicious client
 *     cannot request a giant page and exhaust memory.
 *
 * The cross-field check that `from <= to` lives on the service because
 * class-validator decorators only see a single field at a time.
 */
import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, Max, Min } from 'class-validator';

/** Default cursor page size when the caller omits `batchSize`. */
export const FINANCIAL_EXPORT_DEFAULT_BATCH_SIZE = 500;
/** Hard upper bound for `batchSize` regardless of what the client sends. */
export const FINANCIAL_EXPORT_MAX_BATCH_SIZE = 500;

export class FinancialExportQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  from?: string;

  @IsOptional()
  @IsISO8601({ strict: true })
  to?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(FINANCIAL_EXPORT_MAX_BATCH_SIZE)
  batchSize?: number;
}