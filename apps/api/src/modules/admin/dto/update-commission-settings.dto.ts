import { IsNumber, Max, Min } from 'class-validator';

/** Admin API input. The persisted setting is converted to a decimal fraction. */
export class UpdateCommissionSettingsDto {
  @IsNumber({
    allowNaN: false,
    allowInfinity: false,
    maxDecimalPlaces: 4,
  })
  @Min(0)
  @Max(100)
  commissionRatePercent!: number;
}
