/**
 * B5 — Authenticated reviewer submits a moderation report.
 *
 * The reason is mandatory and bounded: we need an auditable reason on
 * every report, but we don't want the audit row abused as free-form
 * storage. The DB has a matching CHECK constraint so the limit
 * survives even if a future writer bypasses application validation.
 *
 * No reviewId here: the review id arrives in the route so the URL
 * is the single source of truth.
 */
import { IsString, MinLength, MaxLength } from 'class-validator';

export class ReportReviewDto {
  @IsString()
  @MinLength(3, { message: 'reason must be at least 3 characters' })
  @MaxLength(1000, { message: 'reason must be at most 1000 characters' })
  reason!: string;
}