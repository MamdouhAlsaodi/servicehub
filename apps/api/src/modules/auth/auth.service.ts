import {
  Injectable,
  UnauthorizedException,
  ConflictException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { PasswordService } from '../../shared/security/password.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RequestResetDto } from './dto/request-reset.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private passwordService: PasswordService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (existingUser) {
      throw new ConflictException('User with this email already exists');
    }

    const passwordHash = await this.passwordService.hash(dto.password);

    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        passwordHash,
        role: dto.role,
      },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        createdAt: true,
      },
    });

    // Create vendor profile if role is VENDOR
    if (dto.role === 'VENDOR' && dto.businessName) {
      await this.prisma.vendorProfile.create({
        data: {
          userId: user.id,
          businessName: dto.businessName,
          categoryId: dto.categoryId || '',
          address: dto.address,
        },
      });
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      user,
      ...tokens,
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    // Check if account is locked
    if (user.isLocked || (user.lockUntil && user.lockUntil > new Date())) {
      const lockUntil = user.lockUntil;
      const remainingMinutes = lockUntil
        ? Math.ceil((lockUntil.getTime() - Date.now()) / 60000)
        : 15;
      throw new UnauthorizedException(
        `Account is locked. Try again in ${remainingMinutes} minutes.`,
      );
    }

    // Verify password
    const isPasswordValid = await this.passwordService.verify(
      user.passwordHash || '',
      dto.password,
    );

    if (!isPasswordValid) {
      // Increment failed login attempts
      const failedAttempts = user.failedLoginAttempts + 1;
      const shouldLock = failedAttempts >= 5;

      await this.prisma.user.update({
        where: { id: user.id },
        data: {
          failedLoginAttempts: failedAttempts,
          isLocked: shouldLock,
          lockUntil: shouldLock ? new Date(Date.now() + 15 * 60 * 1000) : undefined,
        },
      });

      throw new UnauthorizedException('Invalid credentials');
    }

    // Success: reset lockout fields
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginAttempts: 0,
        isLocked: false,
        lockUntil: null,
      },
    });

    // Check vendor status for VENDOR role
    let vendorStatus: 'PENDING' | 'APPROVED' | 'SUSPENDED' | null = null;
    if (user.role === 'VENDOR') {
      const vendorProfile = await this.prisma.vendorProfile.findFirst({
        where: { userId: user.id },
        select: { status: true },
      });
      vendorStatus = vendorProfile?.status ?? 'PENDING';
    }

    const tokens = await this.generateTokens(user.id, user.email, user.role);

    await this.saveRefreshToken(user.id, tokens.refreshToken);

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        vendorStatus, // VENDOR role sees their status in login response
      },
      ...tokens,
    };
  }

  async refresh(refreshToken: string) {
    const storedToken = await this.prisma.refreshToken.findUnique({
      where: { token: refreshToken },
      include: { user: true },
    });

    if (!storedToken || storedToken.revokedAt) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (storedToken.expiresAt < new Date()) {
      throw new UnauthorizedException('Refresh token expired');
    }

    // Revoke old token
    await this.prisma.refreshToken.update({
      where: { id: storedToken.id },
      data: { revokedAt: new Date() },
    });

    // Generate new tokens
    const tokens = await this.generateTokens(
      storedToken.user.id,
      storedToken.user.email,
      storedToken.user.role,
    );

    await this.saveRefreshToken(storedToken.user.id, tokens.refreshToken);

    return tokens;
  }

  async logout(userId: string) {
    // Revoke all refresh tokens for the user
    await this.prisma.refreshToken.updateMany({
      where: { userId },
      data: { revokedAt: new Date() },
    });

    return { message: 'Logged out successfully' };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        phone: true,
        locale: true,
        createdAt: true,
        vendorProfile: {
          select: {
            id: true,
            businessName: true,
            status: true,
          },
        },
      },
    });

    if (!user) {
      throw new BadRequestException('User not found');
    }

    return user;
  }

  async getVendorStatus(userId: string): Promise<{ status: 'PENDING' | 'APPROVED' | 'SUSPENDED' }> {
    const vendorProfile = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      select: { status: true },
    });

    if (!vendorProfile) {
      throw new BadRequestException('Vendor profile not found');
    }

    return { status: vendorProfile.status };
  }

  async requestPasswordReset(email: string): Promise<{ token?: string; message: string }> {
    const user = await this.prisma.user.findUnique({
      where: { email },
    });

    // Always return success message to prevent email enumeration
    if (!user) {
      return { message: 'If an account with that email exists, a password reset link has been sent.' };
    }

    // Generate random 32-char token
    const token = require('crypto').randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        token,
        expiresAt,
      },
    });

    // In production, send email here. For dev, return token directly.
    return { 
      token, // Remove in production
      message: 'If an account with that email exists, a password reset link has been sent.' 
    };
  }

  async resetPassword(token: string, newPassword: string): Promise<{ message: string }> {
    const resetRecord = await this.prisma.passwordReset.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!resetRecord) {
      throw new BadRequestException('Invalid reset token');
    }

    if (resetRecord.expiresAt < new Date()) {
      throw new BadRequestException('Reset token has expired');
    }

    if (resetRecord.usedAt) {
      throw new BadRequestException('Reset token has already been used');
    }

    // Update password hash
    const passwordHash = await this.passwordService.hash(newPassword);
    await this.prisma.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash },
    });

    // Mark token as used
    await this.prisma.passwordReset.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() },
    });

    // Revoke all refresh tokens for security
    await this.prisma.refreshToken.updateMany({
      where: { userId: resetRecord.userId },
      data: { revokedAt: new Date() },
    });

    return { message: 'Password has been reset successfully' };
  }

  private async generateTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const accessToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '15m',
    });

    const refreshToken = this.jwtService.sign(payload, {
      secret: process.env.JWT_SECRET,
      expiresIn: '7d',
    });

    return { accessToken, refreshToken };
  }

  private async saveRefreshToken(userId: string, token: string) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    await this.prisma.refreshToken.create({
      data: {
        token,
        userId,
        expiresAt,
      },
    });
  }
}
