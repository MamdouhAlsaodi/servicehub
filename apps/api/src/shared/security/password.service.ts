import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

@Injectable()
export class PasswordService {
  private readonly SALT_ROUNDS = 12;

  async hash(password: string): Promise<string> {
    return bcrypt.hash(password, this.SALT_ROUNDS);
  }

  async verify(hashedPassword: string, plainPassword: string): Promise<boolean> {
    if (!hashedPassword) return false;
    return bcrypt.compare(plainPassword, hashedPassword);
  }
}