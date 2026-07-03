import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { PasswordService } from '../../shared/security/password.service';
import { UserRole } from '@prisma/client';
import { prisma, cleanDatabase, disconnectPrisma } from '../../test/setup';

describe('AuthService', () => {
  let authService: AuthService;
  let passwordService: PasswordService;

  beforeEach(async () => {
    // Clean DB before each test
    await cleanDatabase();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: PrismaService,
          useValue: prisma,
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn().mockReturnValue('mocked-token'),
          },
        },
        PasswordService,
      ],
    }).compile();

    authService = module.get<AuthService>(AuthService);
    passwordService = module.get<PasswordService>(PasswordService);
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  describe('register', () => {
    it('(TEST 1) register CUSTOMER success', async () => {
      const registerDto = {
        name: 'Test Customer',
        email: 'customer@test.com',
        password: 'password123',
        role: UserRole.CUSTOMER,
      };

      const result = await authService.register(registerDto);

      expect(result).toHaveProperty('user');
      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(registerDto.email);
      expect(result.user.name).toBe(registerDto.name);
      expect(result.user.role).toBe(UserRole.CUSTOMER);

      // Verify user exists in DB
      const dbUser = await prisma.user.findUnique({
        where: { email: registerDto.email },
      });
      expect(dbUser).not.toBeNull();
      expect(dbUser?.passwordHash).toBeDefined();
    });

    it('(TEST 2) register VENDOR creates VendorProfile with PENDING status', async () => {
      // First create a category for the vendor (required by FK)
      const categoryId = `cat-test-${Date.now()}`;
      const category = await prisma.category.create({
        data: {
          id: categoryId,
          nameAr: 'اختبار',
          nameEn: 'Test Category',
        },
      });

      const registerDto = {
        name: 'Test Vendor',
        email: 'vendor@test.com',
        password: 'password123',
        role: UserRole.VENDOR,
        businessName: 'Test Business',
        categoryId: categoryId,
        address: 'Test Address',
      };

      const result = await authService.register(registerDto);

      expect(result.user.role).toBe(UserRole.VENDOR);

      // Verify vendor profile exists with PENDING status
      const vendorProfile = await prisma.vendorProfile.findUnique({
        where: { userId: result.user.id },
      });
      expect(vendorProfile).not.toBeNull();
      expect(vendorProfile?.businessName).toBe('Test Business');
      expect(vendorProfile?.status).toBe('PENDING');
      expect(vendorProfile?.categoryId).toBe(category.id);
      expect(vendorProfile?.address).toBe('Test Address');
    });

    it('(TEST 3) register rejects duplicate email with ConflictException', async () => {
      const registerDto = {
        name: 'First User',
        email: 'duplicate@test.com',
        password: 'password123',
        role: UserRole.CUSTOMER,
      };

      // First registration should succeed
      await authService.register(registerDto);

      // Second registration with same email should throw ConflictException
      await expect(
        authService.register({
          ...registerDto,
          name: 'Second User',
        }),
      ).rejects.toThrow(ConflictException);

      await expect(
        authService.register({
          ...registerDto,
          name: 'Second User',
        }),
      ).rejects.toThrow('User with this email already exists');
    });
  });

  describe('login', () => {
    const testUserEmail = 'login-test@test.com';
    const testUserPassword = 'correctPassword123';

    beforeEach(async () => {
      // Create a test user for login tests
      const passwordHash = await passwordService.hash(testUserPassword);
      await prisma.user.create({
        data: {
          name: 'Login Test User',
          email: testUserEmail,
          passwordHash,
          role: UserRole.CUSTOMER,
          failedLoginAttempts: 0,
          isLocked: false,
        },
      });
    });

    it('(TEST 4) login with correct password returns tokens and resets failedLoginAttempts', async () => {
      // First, set failedLoginAttempts to a non-zero value
      await prisma.user.update({
        where: { email: testUserEmail },
        data: { failedLoginAttempts: 2 },
      });

      const loginDto = {
        email: testUserEmail,
        password: testUserPassword,
      };

      const result = await authService.login(loginDto);

      expect(result).toHaveProperty('accessToken');
      expect(result).toHaveProperty('refreshToken');
      expect(result.user.email).toBe(testUserEmail);

      // Verify failedLoginAttempts is reset to 0
      const dbUser = await prisma.user.findUnique({
        where: { email: testUserEmail },
      });
      expect(dbUser?.failedLoginAttempts).toBe(0);
      expect(dbUser?.isLocked).toBe(false);

      // Verify refresh token was saved
      const refreshToken = await prisma.refreshToken.findFirst({
        where: { userId: dbUser?.id },
      });
      expect(refreshToken).not.toBeNull();
      expect(refreshToken?.revokedAt).toBeNull();
    });

    it('(TEST 5) login with wrong password increments failedLoginAttempts', async () => {
      const loginDto = {
        email: testUserEmail,
        password: 'wrongPassword',
      };

      try {
        await authService.login(loginDto);
      } catch (e) {
        // Expected to throw UnauthorizedException
      }

      const dbUser = await prisma.user.findUnique({
        where: { email: testUserEmail },
      });
      expect(dbUser?.failedLoginAttempts).toBe(1);
    });

    it('(TEST 6) 5 failed login attempts locks account (isLocked=true, lockUntil set)', async () => {
      const loginDto = {
        email: testUserEmail,
        password: 'wrongPassword',
      };

      // Attempt 5 failed logins
      for (let i = 1; i <= 5; i++) {
        try {
          await authService.login(loginDto);
        } catch (e) {
          // Expected
        }
      }

      // 6th attempt should be locked
      await expect(authService.login(loginDto)).rejects.toThrow(
        'Account is locked',
      );

      // Verify lockout state in DB
      const dbUser = await prisma.user.findUnique({
        where: { email: testUserEmail },
      });
      expect(dbUser?.isLocked).toBe(true);
      expect(dbUser?.lockUntil).not.toBeNull();
      expect(dbUser?.lockUntil?.getTime()).toBeGreaterThan(Date.now());
      expect(dbUser?.failedLoginAttempts).toBe(5);
    });
  });

  describe('password reset', () => {
    it('(TEST 7) forgot-password returns token for existing user, generic message for non-existent', async () => {
      const existingEmail = 'existing@test.com';
      const nonExistentEmail = 'nonexistent@test.com';

      // Create existing user
      const passwordHash = await passwordService.hash('somepassword');
      await prisma.user.create({
        data: {
          name: 'Existing User',
          email: existingEmail,
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      });

      // Test with existing user - should return token
      const existingResult = await authService.requestPasswordReset(existingEmail);
      expect(existingResult.message).toBeDefined();
      expect(existingResult.token).toBeDefined();
      expect(existingResult.token).toHaveLength(32); // 16 bytes = 32 hex chars

      // Verify password reset record was created
      const resetRecord = await prisma.passwordReset.findFirst({
        where: { user: { email: existingEmail } },
      });
      expect(resetRecord).not.toBeNull();
      expect(resetRecord?.token).toBe(existingResult.token);

      // Test with non-existent user - should return generic message without token
      const nonExistentResult = await authService.requestPasswordReset(nonExistentEmail);
      expect(nonExistentResult.message).toBeDefined();
      expect(nonExistentResult.token).toBeUndefined();

      // Verify no password reset record was created for non-existent email
      const nonExistentRecord = await prisma.passwordReset.findFirst({
        where: { user: { email: nonExistentEmail } },
      });
      expect(nonExistentRecord).toBeNull();
    });

    it('(TEST 8) reset-password with valid token updates passwordHash, marks usedAt, revokes refresh tokens', async () => {
      const resetTestEmail = 'reset-test@test.com';
      const originalPassword = 'originalPassword123';
      const newPassword = 'newPassword456';

      // Create user
      const passwordHash = await passwordService.hash(originalPassword);
      const user = await prisma.user.create({
        data: {
          name: 'Reset Test User',
          email: resetTestEmail,
          passwordHash,
          role: UserRole.CUSTOMER,
        },
      });

      // Create a valid reset token
      const token = require('crypto').randomBytes(16).toString('hex');
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
      await prisma.passwordReset.create({
        data: {
          userId: user.id,
          token,
          expiresAt,
        },
      });

      // Create some refresh tokens
      await prisma.refreshToken.createMany({
        data: [
          {
            userId: user.id,
            token: 'token1',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
          {
            userId: user.id,
            token: 'token2',
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        ],
      });

      // Perform password reset
      const result = await authService.resetPassword(token, newPassword);
      expect(result.message).toBe('Password has been reset successfully');

      // Verify password was updated
      const dbUser = await prisma.user.findUnique({
        where: { email: resetTestEmail },
      });
      expect(dbUser?.passwordHash).not.toBe(passwordHash);

      // Verify new password works
      const isNewPasswordValid = await passwordService.verify(
        dbUser?.passwordHash || '',
        newPassword,
      );
      expect(isNewPasswordValid).toBe(true);

      // Verify token is marked as used
      const resetRecord = await prisma.passwordReset.findUnique({
        where: { token },
      });
      expect(resetRecord?.usedAt).not.toBeNull();

      // Verify all refresh tokens were revoked
      const refreshTokens = await prisma.refreshToken.findMany({
        where: { userId: user.id },
      });
      expect(refreshTokens.every((t) => t.revokedAt !== null)).toBe(true);
    });
  });
});
