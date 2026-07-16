/**
 * B6 — Create a plain-text message on a booking thread.
 * Validation contract:
 *   - string (Whitelist strips anything else)
 *   - trimmed, then non-empty after trim
 *   - max 1000 chars after trim
 *   - control chars rejected except `\t` and `\n` (rendering layer
 *     treats messages as plain text — no HTML interpretation)
 *
 * `senderId` is NOT a DTO field; the JWT-derived user is the single
 * source of truth.
 */
import { Transform } from 'class-transformer';
import {
  IsNotEmpty,
  IsString,
  MaxLength,
  registerDecorator,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';

@ValidatorConstraint({ name: 'NoIllegalControlChars', async: false })
export class NoIllegalControlCharsConstraint implements ValidatorConstraintInterface {
  /* Allow \t (0x09) and \n (0x0A); reject every other C0 control
   * char (U+0000..U+001F except the two named above) AND DEL (U+007F).
   * C1 controls (U+0080..U+009F) are intentionally allowed because
   * Arabic text sometimes carries them through copy-paste pipelines.
   */
  validate(value: unknown): boolean {
    if (typeof value !== 'string') return false;
    // eslint-disable-next-line no-control-regex
    return !/[\x00-\x08\x0B-\x1F\x7F]/.test(value);
  }

  defaultMessage(): string {
    return 'content contains disallowed control characters (only tab and newline are allowed)';
  }
}

export function NoIllegalControlChars(options?: ValidationOptions): PropertyDecorator {
  return (target: object, propertyName: string | symbol): void => {
    registerDecorator({
      target: target.constructor,
      propertyName: propertyName as string,
      options,
      constraints: [],
      validator: NoIllegalControlCharsConstraint,
    });
  };
}

export class CreateMessageDto {
  /** Plain-text body. Trimmed and validated server-side. */
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty({ message: 'content cannot be empty' })
  @MaxLength(1000, { message: 'content cannot exceed 1000 characters' })
  @NoIllegalControlChars()
  content!: string;
}
