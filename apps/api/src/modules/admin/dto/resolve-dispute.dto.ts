import { Type } from 'class-transformer';
import { IsEnum, IsNotEmpty, IsNumber, IsString, MaxLength, ValidateIf } from 'class-validator';
import { DisputeResolutionAction } from '@prisma/client';

export class ResolveDisputeDto {
  @IsEnum(DisputeResolutionAction)
  action!: DisputeResolutionAction;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;

  @ValidateIf((dto) => dto.action === DisputeResolutionAction.PARTIAL_REFUND)
  @Type(() => Number)
  @IsNumber({ allowNaN: false, allowInfinity: false, maxDecimalPlaces: 2 })
  amount?: number;
}
