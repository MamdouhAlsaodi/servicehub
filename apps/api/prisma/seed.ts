/**
 * ServiceHub — Development Seed
 * =============================
 *
 * Idempotent: safe to run any number of times; same result each time.
 *
 * Creates the canonical development dataset:
 *   • Admin  → admin@servicehub.local  / admin123
 *   • Vendor → sara@servicehub.local   / vendor123
 *   • Customer → ahmad@servicehub.local / customer123
 *
 * Plus: services, availability, one CONFIRMED booking with a mock
 * payment and a review — giving the UI realistic data to exercise
 * all the important flows without Stripe credentials.
 *
 * Run via:
 *   npx prisma db seed
 *   npm run dev:fixtures:seed   # see package.json scripts
 */

import { PrismaClient, UserRole, VendorStatus, BookingStatus, PaymentStatus, PaymentProvider } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

// ── Canonical canonical identities ────────────────────────────────────────────

const ADMIN_EMAIL   = 'admin@servicehub.local';
const VENDOR_EMAIL  = 'sara@servicehub.local';
const CUSTOMER_EMAIL = 'ahmad@servicehub.local';

const ADMIN_PASSWORD_PLAIN  = 'admin123';
const VENDOR_PASSWORD_PLAIN = 'vendor123';
const CUSTOMER_PASSWORD_PLAIN = 'customer123';

// ── Canonical categories ─────────────────────────────────────────────────────

const CANONICAL_CATEGORIES = [
  { id: 'cat-salon',      nameAr: 'صالونات تجميل', nameEn: 'Beauty Salons',  icon: '💇' },
  { id: 'cat-fitness',    nameAr: 'لياقة بدنية',   nameEn: 'Fitness',        icon: '💪' },
  { id: 'cat-repair',     nameAr: 'صيانة',          nameEn: 'Repair',         icon: '🔧' },
  { id: 'cat-consulting', nameAr: 'استشارات',       nameEn: 'Consulting',     icon: '🧑‍💼' },
];

// ── Vendor business data ──────────────────────────────────────────────────────

const VENDOR_BUSINESS = {
  businessName: 'صالون سارة للتجميل',
  description:   'صالون تجميل متكامل — شعر، أظافر، مكياج',
  address:       'São Paulo, SP',
  lat:           -23.5505,
  lng:           -46.6333,
  timezone:      'America/Sao_Paulo',
};

// ── Canonical services (3) ───────────────────────────────────────────────────

const CANONICAL_SERVICES = [
  { id: 'svc-haircut',   title: 'قص شعر نسائي',    description: 'قص + غسل + تصفيف', price: 80,  durationMinutes: 60  },
  { id: 'svc-manicure',  title: 'مانيكير',          description: 'أظافر + طلاء',       price: 40,  durationMinutes: 45  },
  { id: 'svc-makeup',    title: 'مكياج احترافي',    description: 'مكياج للمناسبات',     price: 150, durationMinutes: 90  },
];

// ── Availability: Sunday–Thursday (dayOfWeek 0–4), 09:00–17:00 ──────────────

const AVAILABILITY_DAYS = [0, 1, 2, 3, 4]; // Sunday → Thursday

// ── Helper ────────────────────────────────────────────────────────────────────

async function hash(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

async function upsertCategory(data: typeof CANONICAL_CATEGORIES[number]) {
  return prisma.category.upsert({
    where: { id: data.id },
    update: { nameAr: data.nameAr, nameEn: data.nameEn, icon: data.icon },
    create: { id: data.id, nameAr: data.nameAr, nameEn: data.nameEn, icon: data.icon },
  });
}

async function upsertAvailability(
  vendorProfileId: string,
  dayOfWeek: number,
) {
  return prisma.availability.upsert({
    where: { id: `avail-${vendorProfileId}-${dayOfWeek}` },
    update: { startTime: '09:00', endTime: '17:00', isException: false },
    create: {
      id: `avail-${vendorProfileId}-${dayOfWeek}`,
      vendorId: vendorProfileId,
      dayOfWeek,
      startTime: '09:00',
      endTime: '17:00',
      isException: false,
    },
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🌱  Seeding ServiceHub (dev)...\n');

  // ── 1. Categories ───────────────────────────────────────────────────────────
  for (const cat of CANONICAL_CATEGORIES) {
    await upsertCategory(cat);
    console.log(`  ✓ category  ${cat.id}  ${cat.nameEn} / ${cat.nameAr}`);
  }

  // ── 2. Admin ───────────────────────────────────────────────────────────────
  const adminHash = await hash(ADMIN_PASSWORD_PLAIN);
  const admin = await prisma.user.upsert({
    where: { email: ADMIN_EMAIL },
    update: { name: 'Platform Admin', role: UserRole.ADMIN, locale: 'ar', isLocked: false, failedLoginAttempts: 0 },
    create: { name: 'Platform Admin', email: ADMIN_EMAIL, passwordHash: adminHash, role: UserRole.ADMIN, locale: 'ar' },
  });
  console.log(`  ✓ admin     ${ADMIN_EMAIL}  id=${admin.id}`);

  // ── 3. Vendor ───────────────────────────────────────────────────────────────
  const vendorHash = await hash(VENDOR_PASSWORD_PLAIN);
  const vendorUser = await prisma.user.upsert({
    where: { email: VENDOR_EMAIL },
    update: { name: VENDOR_BUSINESS.businessName, role: UserRole.VENDOR, locale: 'ar', isLocked: false, failedLoginAttempts: 0 },
    create: {
      name: VENDOR_BUSINESS.businessName,
      email: VENDOR_EMAIL,
      passwordHash: vendorHash,
      role: UserRole.VENDOR,
      locale: 'ar',
    },
  });

  const vendorProfile = await prisma.vendorProfile.upsert({
    where: { userId: vendorUser.id },
    update: {
      businessName: VENDOR_BUSINESS.businessName,
      description: VENDOR_BUSINESS.description,
      categoryId: 'cat-salon',
      address: VENDOR_BUSINESS.address,
      lat: VENDOR_BUSINESS.lat,
      lng: VENDOR_BUSINESS.lng,
      timezone: VENDOR_BUSINESS.timezone,
      status: VendorStatus.APPROVED,
    },
    create: {
      userId: vendorUser.id,
      businessName: VENDOR_BUSINESS.businessName,
      description: VENDOR_BUSINESS.description,
      categoryId: 'cat-salon',
      address: VENDOR_BUSINESS.address,
      lat: VENDOR_BUSINESS.lat,
      lng: VENDOR_BUSINESS.lng,
      timezone: VENDOR_BUSINESS.timezone,
      status: VendorStatus.APPROVED,
    },
  });
  console.log(`  ✓ vendor     ${VENDOR_EMAIL}  profileId=${vendorProfile.id}`);

  // ── 4. Services ─────────────────────────────────────────────────────────────
  for (const svc of CANONICAL_SERVICES) {
    await prisma.service.upsert({
      where: { id: svc.id },
      update: {
        vendorId: vendorProfile.id,
        title: svc.title,
        description: svc.description,
        price: svc.price,
        durationMinutes: svc.durationMinutes,
        categoryId: 'cat-salon',
        isActive: true,
      },
      create: {
        id: svc.id,
        vendorId: vendorProfile.id,
        title: svc.title,
        description: svc.description,
        price: svc.price,
        durationMinutes: svc.durationMinutes,
        categoryId: 'cat-salon',
        isActive: true,
      },
    });
    console.log(`  ✓ service   ${svc.id}  ${svc.title}  BRL ${svc.price}`);
  }

  // ── 5. Availability ─────────────────────────────────────────────────────────
  for (const day of AVAILABILITY_DAYS) {
    await upsertAvailability(vendorProfile.id, day);
  }
  console.log(`  ✓ availability  Sun–Thu 09:00–17:00`);

  // ── 6. Customer ─────────────────────────────────────────────────────────────
  const customerHash = await hash(CUSTOMER_PASSWORD_PLAIN);
  const customer = await prisma.user.upsert({
    where: { email: CUSTOMER_EMAIL },
    update: { name: 'أحمد', role: UserRole.CUSTOMER, locale: 'ar', isLocked: false, failedLoginAttempts: 0 },
    create: { name: 'أحمد', email: CUSTOMER_EMAIL, passwordHash: customerHash, role: UserRole.CUSTOMER, locale: 'ar' },
  });
  console.log(`  ✓ customer  ${CUSTOMER_EMAIL}  id=${customer.id}`);

  // ── 7. Confirmed booking ────────────────────────────────────────────────────
  //
  // Pick the first service (haircut) and create a confirmed booking for
  // today + 2 days at 10:00.  The time slot is deliberately chosen to not
  // collide with seed re-runs (today+2 avoids "slot in the past" errors).
  const service = await prisma.service.findUnique({ where: { id: 'svc-haircut' } });
  if (!service) throw new Error('svc-haircut not found — run seed categories + vendor first');

  const baseDate = new Date();
  baseDate.setDate(baseDate.getDate() + 2);
  // Keep the demo booking inside the vendor's Sunday–Thursday availability,
  // even when the seed is re-run near a weekend.
  while (!AVAILABILITY_DAYS.includes(baseDate.getDay())) {
    baseDate.setDate(baseDate.getDate() + 1);
  }
  baseDate.setHours(10, 0, 0, 0);

  const endDate = new Date(baseDate);
  endDate.setMinutes(endDate.getMinutes() + service.durationMinutes);

  // Use a deterministic ID so re-runs are idempotent
  const bookingId = 'seed-booking-haircut-001';
  const commissionRate = 0.10;
  const priceNum = Number(service.price);
  const commission = priceNum * commissionRate;

  const booking = await prisma.booking.upsert({
    where: { id: bookingId },
    update: {
      customerId: customer.id,
      vendorId: vendorProfile.id,
      serviceId: service.id,
      startTime: baseDate,
      endTime: endDate,
      status: BookingStatus.CONFIRMED,
      priceAtBooking: priceNum,
      commissionAmount: commission,
      holdExpiresAt: null,
    },
    create: {
      id: bookingId,
      customerId: customer.id,
      vendorId: vendorProfile.id,
      serviceId: service.id,
      startTime: baseDate,
      endTime: endDate,
      status: BookingStatus.CONFIRMED,
      priceAtBooking: priceNum,
      commissionAmount: commission,
      holdExpiresAt: null,
    },
  });
  console.log(
    `  ✓ booking    ${booking.id}  CONFIRMED  ` +
      `${baseDate.toISOString().replace(/T.*/, '')} 10:00`,
  );

  // ── 8. Mock payment (MOCK provider — no Stripe needed) ─────────────────────
  const paymentId = `seed-pay-${booking.id}`;
  const mockStripeId = `seed-ext-pay-${booking.id}`;

  await prisma.payment.upsert({
    where: { bookingId: booking.id },
    update: {
      provider: PaymentProvider.MOCK,
      externalId: mockStripeId,
      amount: priceNum,
      currency: 'brl',
      status: PaymentStatus.SUCCEEDED,
      refundedAmount: 0,
    },
    create: {
      id: paymentId,
      bookingId: booking.id,
      provider: PaymentProvider.MOCK,
      externalId: mockStripeId,
      amount: priceNum,
      currency: 'brl',
      status: PaymentStatus.SUCCEEDED,
      refundedAmount: 0,
    },
  });
  console.log(`  ✓ payment   ${paymentId}  SUCCEEDED  SAR ${priceNum}`);

  // ── 9. Review ────────────────────────────────────────────────────────────────
  const reviewId = `seed-review-${booking.id}`;

  await prisma.review.upsert({
    where: { bookingId: booking.id },
    update: { userId: customer.id, rating: 5, comment: 'خدمة ممتازة! شكراً 💇‍♀️' },
    create: { id: reviewId, bookingId: booking.id, userId: customer.id, rating: 5, comment: 'خدمة ممتازة! شكراً 💇‍♀️' },
  });
  console.log(`  ✓ review    ⭐ 5  "خدمة ممتازة!"`);

  // ── Done ─────────────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!\n');
  console.log('  👤 Admin    :', ADMIN_EMAIL,     '/', ADMIN_PASSWORD_PLAIN);
  console.log('  👤 Vendor   :', VENDOR_EMAIL,    '/', VENDOR_PASSWORD_PLAIN);
  console.log('  👤 Customer :', CUSTOMER_EMAIL,  '/', CUSTOMER_PASSWORD_PLAIN);
  console.log('\n  📅 Confirmed booking  :', booking.id);
  console.log('  💳 Mock payment      :', paymentId, '(SUCCEEDED)');
  console.log('  ⭐ Review            : 5 stars\n');
}

main()
  .catch((err) => {
    console.error('\n❌ Seed failed:', err.message);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
