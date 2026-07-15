import { IsEmail, Matches } from 'class-validator';

/**
 * DEMO ONLY: This DTO intentionally accepts a SINGLE field (email) and
 * rejects any value that is not the fixed local demo identity.
 * No Google ID, OAuth code, token, name, role, or password is accepted.
 */
export class DemoGoogleLoginDto {
  @IsEmail()
  @Matches(/^demo\.customer@servicehub\.local$/, {
    message:
      'Demo Google login is restricted to the fixed local demo identity.',
  })
  email: string;
}
