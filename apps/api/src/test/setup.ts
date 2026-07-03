import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

// Export a function to clean the database that can be called from beforeEach
export async function cleanDatabase(): Promise<void> {
  // Clean DB before each test
  await prisma.refreshToken.deleteMany();
  await prisma.passwordReset.deleteMany();
  await prisma.message.deleteMany();
  await prisma.notification.deleteMany();
  await prisma.review.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.availability.deleteMany();
  await prisma.service.deleteMany();
  await prisma.vendorProfile.deleteMany();
  await prisma.user.deleteMany();
}

// Cleanup after all tests
export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
}
