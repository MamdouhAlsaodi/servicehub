import {
  IsNotEmpty, IsString, IsNumber, IsOptional, IsBoolean, IsUrl,
  Min, MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * B5 — Media MVP. `imageUrl` is the only media field supported: an
 * optional absolute http/https URL supplied by the vendor. We DO NOT
 * accept uploads, S3/Cloudinary keys, or any provider-specific blob
 * references. Validation:
 *   - @IsUrl({ protocols: ['http','https'] }) — protocol whitelist
 *     enforced at the class-validator layer; bad protocols are 400.
 *   - @MaxLength(2048) — common practical cap so a malicious payload
 *     cannot bloat the row.
 * No remote fetch is performed. No proxying. The URL is stored verbatim
 * and surfaced verbatim by the public service endpoints.
 *
 * UpdateServiceDto is also exported from this file (matching the
 * pre-existing project convention). update-service.dto.ts separately
 * re-derives it from CreateServiceDto via PartialType — both forms
 * see the same imageUrl validation through the prototype chain.
 */
export class CreateServiceDto {
  @IsString()
  @IsNotEmpty()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price: number;

  @IsNumber()
  @Min(1)
  @Type(() => Number)
  durationMinutes: number;

  @IsString()
  @IsNotEmpty()
  categoryId: string;

  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, {
    message: 'imageUrl must be an absolute URL with http or https protocol',
  })
  @MaxLength(2048)
  imageUrl?: string;
}

export class UpdateServiceDto {
  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Type(() => Number)
  price?: number;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Type(() => Number)
  durationMinutes?: number;

  @IsOptional()
  @IsString()
  categoryId?: string;

  @IsOptional()
  @IsString()
  @IsUrl({ protocols: ['http', 'https'], require_protocol: true }, {
    message: 'imageUrl must be an absolute URL with http or https protocol',
  })
  @MaxLength(2048)
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}