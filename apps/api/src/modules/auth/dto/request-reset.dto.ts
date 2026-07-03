import { IsEmail, IsNotEmpty } from 'class-validator';

export class RequestResetDto {
  @IsEmail()
  @IsNotEmpty()
  email: string;
}
