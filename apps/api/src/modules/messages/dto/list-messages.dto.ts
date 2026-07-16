/**
 * B6 — Query for the booking-thread message read model.
 * `limit` is clamped to [1, 100] by the service. `cursor` is the
 * opaque token returned in the previous page's `nextCursor`.
 *
 * The underlying cursor encodes a `(createdAt, id)` pair so the
 * pagination is stable even when multiple messages share a
 * `createdAt` to millisecond precision. base64url keeps the token
 * URL-safe (no `+`, `/`, padding) and ASCII-only.
 */
import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const MESSAGE_LIST_DEFAULT_LIMIT = 50;
export const MESSAGE_LIST_MAX_LIMIT = 100;

export class ListMessagesQueryDto {
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    const n = parseInt(String(value), 10);
    return Number.isFinite(n) ? n : value; // let the validator reject
  })
  @IsOptional()
  @IsInt({ message: 'limit must be an integer' })
  @Min(1, { message: 'limit must be >= 1' })
  @Max(MESSAGE_LIST_MAX_LIMIT, {
    message: `limit must be <= ${MESSAGE_LIST_MAX_LIMIT}`,
  })
  limit?: number;

  @IsOptional()
  @IsString()
  cursor?: string;
}
