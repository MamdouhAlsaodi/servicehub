import { PrismaClient, UserRole, VendorStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding ServiceHub...');

  const adminHash = await bcrypt.hash('admin123', 12);
  await prisma.user.upsert({
    where: { email: 'admin@servicehub.local' },
    update: {},
    create: { name: 'Admin', email: 'admin@servicehub.local', passwordHash: adminHash, role: UserRole.ADMIN, locale: 'ar' },
  });

  const categories = await Promise.all([
    prisma.category.upsert({ where: { id: 'cat-salon' }, update: {}, create: { id: 'cat-salon', nameAr: 'صالونات', nameEn: 'Salons', icon: '💇' } }),
    prisma.category.upsert({ where: { id: 'cat-fitness' }, update: {}, create: { id: 'cat-fitness', nameAr: 'لياقة', nameEn: 'Fitness', icon: '💪' } }),
    prisma.category.upsert({ where: { id: 'cat-repair' }, update: {}, create: { id: 'cat-repair', nameAr: 'صيانة', nameEn: 'Repair', icon: '🔧' } }),
    prisma.category.upsert({ where: { id: 'cat-consulting' }, update: {}, create: { id: 'cat-consulting', nameAr: 'استشارات', nameEn: 'Consulting', icon: '🧑‍💼' } }),
  ]);

  const vendorHash = await bcrypt.hash('vendor123', 12);
  const vendor = await prisma.user.upsert({
    where: { email: 'sara@servicehub.local' },
    update: {},
    create: {
      name: 'صالون سارة', email: 'sara@servicehub.local', passwordHash: vendorHash, role: UserRole.VENDOR, locale: 'ar',
      vendorProfile: {
        create: { businessName: 'صالون سارة', description: 'صالون تجميل متكامل', categoryId: 'cat-salon', address: 'São Paulo', status: VendorStatus.APPROVED },
      },
    },
    include: { vendorProfile: true },
  });

  await prisma.service.createMany({
    data: [
      { vendorId: vendor.vendorProfile!.id, title: 'قص شعر', price: 80, durationMinutes: 60, categoryId: 'cat-salon' },
      { vendorId: vendor.vendorProfile!.id, title: 'مانيكير', price: 40, durationMinutes: 45, categoryId: 'cat-salon' },
      { vendorId: vendor.vendorProfile!.id, title: 'مكياج', price: 150, durationMinutes: 90, categoryId: 'cat-salon' },
    ],
    skipDuplicates: true,
  });

  for (let day = 0; day <= 4; day++) {
    await prisma.availability.create({
      data: { vendorId: vendor.vendorProfile!.id, dayOfWeek: day, startTime: '09:00', endTime: '17:00' },
    });
  }

  const customerHash = await bcrypt.hash('customer123', 12);
  await prisma.user.upsert({
    where: { email: 'ahmad@servicehub.local' },
    update: {},
    create: { name: 'أحمد', email: 'ahmad@servicehub.local', passwordHash: customerHash, role: UserRole.CUSTOMER, locale: 'ar' },
  });

  console.log('✅ Seed complete!');
  console.log('  Admin: admin@servicehub.local / admin123');
  console.log('  Vendor: sara@servicehub.local / vendor123');
  console.log('  Customer: ahmad@servicehub.local / customer123');
}

main().catch(console.error).finally(() => prisma.$disconnect());
