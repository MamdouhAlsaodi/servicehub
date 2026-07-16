/**
 * B5 — Admin resolves an OPEN review report.
 *
 * The action is a closed enum (`KEEP_VISIBLE` | `HIDE`); class-validator's
 * `@IsEnum` enforces the wire shape. The optional note is the admin's
 * free-text rationale stored on the report row for the audit trail.
 */
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ReviewReportAction } from '@prisma/client';

export class ResolveReportDto {
  @IsEnum(ReviewReportAction, {
    message: 'action must be KEEP_VISIBLE or HIDE',
  })
  action!: ReviewReportAction;

  @IsOptional()
  @IsString()
  @MaxLength(1000, { message: 'note must be at most 1000 characters' })
  note?: string;
}