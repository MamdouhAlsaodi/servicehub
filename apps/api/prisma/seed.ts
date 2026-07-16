/**
 * ServiceHub — Development Seed
 * =============================
 *
 * Idempotent: safe to run any number of times; same result each time.
 *
 * Creates the canonical development dataset:
 *   • Admin  → admin@servicehub.local
 *   • Vendor → sara@servicehub.local
 *   • Customer → ahmad@servicehub.local
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

function requireSeedPassword(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(
      `Missing required ${name}. Set it to a non-empty password before running the development seed.`,
    );
  }
  return value;
}

const ADMIN_PASSWORD_PLAIN = requireSeedPassword('SEED_ADMIN_PASSWORD');
const VENDOR_PASSWORD_PLAIN = requireSeedPassword('SEED_VENDOR_PASSWORD');
const CUSTOMER_PASSWORD_PLAIN = requireSeedPassword('SEED_CUSTOMER_PASSWORD');

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
// === LARGE SYNTHETIC DATASET EXTENSION =======================================
// 4 extra categories to reach 8 total.
const EXTRA_CATEGORIES = [
  { id: 'cat-cleaning',    nameAr: 'خدمات التنظيف', nameEn: 'Cleaning',    icon: '🧹' },
  { id: 'cat-education',   nameAr: 'تعليم ودروس',  nameEn: 'Education',   icon: '📚' },
  { id: 'cat-medical',     nameAr: 'صحة وطب',       nameEn: 'Health',      icon: '⚕️' },
  { id: 'cat-photography', nameAr: 'تصوير وفيديو',   nameEn: 'Photography', icon: '📷' },
];

interface NewVendorRow {
  idx: number; email: string; businessName: string; description: string;
  categoryId: string; address: string; lat: number; lng: number; timezone: string;
  serviceTitles: string[]; servicePrices: number[]; serviceDurations: number[];
}

// 17 additional approved vendors (18 total with canonical sara).
const NEW_VENDORS: NewVendorRow[] = [
  { idx: 1,  email: 'sara1@servicehub.local',  businessName: 'صالون لمسة فاتنة',     description: 'خدمات صالون نسائية متكاملة',  categoryId: 'cat-salon',       address: 'Riyadh',      lat: 24.7136, lng: 46.6753, timezone: 'Asia/Riyadh',       serviceTitles: ['قص شعر رجالي','صبغة شعر','تصفيف عروس'],                       servicePrices: [60, 120, 250],     serviceDurations: [45, 90, 120] },
  { idx: 2,  email: 'sara2@servicehub.local',  businessName: 'استوديو لياقة بلس',    description: 'تدريب شخصي وجماعي',           categoryId: 'cat-fitness',     address: 'Jeddah',      lat: 21.4858, lng: 39.1925, timezone: 'Asia/Riyadh',       serviceTitles: ['جلسة تدريب','برنامج لياقة','استشارة تغذية'],                  servicePrices: [100, 200, 80],      serviceDurations: [60, 90, 45] },
  { idx: 3,  email: 'sara3@servicehub.local',  businessName: 'مصلح سريع المعتمد',    description: 'صيانة منزلية وأجهزة',          categoryId: 'cat-repair',      address: 'Dammam',      lat: 26.4207, lng: 50.0888, timezone: 'Asia/Riyadh',       serviceTitles: ['صيانة تكييف','صيانة غسالة','صيانة ثلاجة','تركيب إضاءة'],    servicePrices: [120, 100, 130, 80], serviceDurations: [60, 60, 75, 45] },
  { idx: 4,  email: 'sara4@servicehub.local',  businessName: 'مكتب استشارات بلس',    description: 'استشارات إدارية ومالية',       categoryId: 'cat-consulting',  address: 'Cairo',       lat: 30.0444, lng: 31.2357, timezone: 'Africa/Cairo',      serviceTitles: ['استشارة أعمال','دراسة جدوى','تخطيط استراتيجي'],             servicePrices: [300, 500, 450],     serviceDurations: [60, 90, 90] },
  { idx: 5,  email: 'sara5@servicehub.local',  businessName: 'شركة تنظيف بريق',      description: 'تنظيف منازل ومكاتب',            categoryId: 'cat-cleaning',    address: 'Casablanca',  lat: 33.5731, lng: -7.5898, timezone: 'Africa/Casablanca', serviceTitles: ['تنظيف عميق','تنظيف مكاتب','غسيل سجاد','تلميع زجاج'],           servicePrices: [150, 120, 80, 100],  serviceDurations: [120, 90, 60, 75] },
  { idx: 6,  email: 'sara6@servicehub.local',  businessName: 'أكاديمية تعليمكم',     description: 'دروس خصوصية ومجموعات',         categoryId: 'cat-education',   address: 'Amman',       lat: 31.9454, lng: 35.9284, timezone: 'Asia/Amman',        serviceTitles: ['درس رياضيات','درس لغة عربية','درس فيزياء'],                servicePrices: [70, 70, 80],        serviceDurations: [60, 60, 60] },
  { idx: 7,  email: 'sara7@servicehub.local',  businessName: 'عيادة شفاء',           description: 'طب عام واستشاري',              categoryId: 'cat-medical',     address: 'Dubai',       lat: 25.2048, lng: 55.2708, timezone: 'Asia/Dubai',        serviceTitles: ['كشف عام','استشارة طبية','فحص دوري','متابعة حمل'],             servicePrices: [200, 150, 180, 250], serviceDurations: [30, 30, 45, 60] },
  { idx: 8,  email: 'sara8@servicehub.local',  businessName: 'ستوديو لقطة',          description: 'تصوير احترافي للمناسبات',       categoryId: 'cat-photography', address: 'Doha',        lat: 25.2854, lng: 51.5310, timezone: 'Asia/Qatar',        serviceTitles: ['تصوير أعراس','تصوير منتجات','جلسة تصوير شخصية'],          servicePrices: [800, 300, 200],     serviceDurations: [180, 90, 60] },
  { idx: 9,  email: 'sara9@servicehub.local',  businessName: 'صالون النخبة',         description: 'صالون رجالي فاخر',             categoryId: 'cat-salon',       address: 'Kuwait City', lat: 29.3759, lng: 47.9774, timezone: 'Asia/Kuwait',       serviceTitles: ['حلاقة ذكور','عناية بشرة','تدليك رأس'],                    servicePrices: [40, 90, 50],        serviceDurations: [30, 45, 30] },
  { idx: 10, email: 'sara10@servicehub.local', businessName: 'نادي الأبطال',         description: 'نادي رياضي شامل',              categoryId: 'cat-fitness',     address: 'Manama',      lat: 26.2285, lng: 50.5860, timezone: 'Asia/Bahrain',      serviceTitles: ['اشتراك شهري','تدريب كروس فت','حصص يوغا','تدريب أزياء'],         servicePrices: [250, 100, 80, 120],  serviceDurations: [60, 60, 60, 75] },
  { idx: 11, email: 'sara11@servicehub.local', businessName: 'فني صيانة ذهبي',      description: 'سباكة وكهرباء',                 categoryId: 'cat-repair',      address: 'Muscat',      lat: 23.5880, lng: 58.3829, timezone: 'Asia/Muscat',       serviceTitles: ['كشف تسرب','تركيب سباكة','إصلاح كهرباء'],                  servicePrices: [100, 150, 120],     serviceDurations: [60, 75, 60] },
  { idx: 12, email: 'sara12@servicehub.local', businessName: 'مستشار أعمال برو',     description: 'استشارات تجارية متقدمة',       categoryId: 'cat-consulting',  address: 'Abu Dhabi',   lat: 24.4539, lng: 54.3773, timezone: 'Asia/Dubai',        serviceTitles: ['استشارة تسويق','تخطيط مالي','استشارة موارد بشرية','استشارة تقنية'], servicePrices: [350, 400, 300, 320], serviceDurations: [60, 75, 60, 60] },
  { idx: 13, email: 'sara13@servicehub.local', businessName: 'نظافة احترافية',        description: 'تنظيف بعد البناء والفعاليات',   categoryId: 'cat-cleaning',    address: 'Tunis',       lat: 36.8065, lng: 10.1815, timezone: 'Africa/Tunis',      serviceTitles: ['تنظيف بعد بناء','تنظيف واجهات','تعقيم شامل'],             servicePrices: [300, 200, 150],     serviceDurations: [180, 120, 90] },
  { idx: 14, email: 'sara14@servicehub.local', businessName: 'معلم خصوصي أونلاين',  description: 'دروس لغات ومهارات',            categoryId: 'cat-education',   address: 'Algiers',     lat: 36.7538, lng: 3.0588,  timezone: 'Africa/Algiers',    serviceTitles: ['درس إنجليزي','درس فرنسي','درس برمجة'],                    servicePrices: [60, 60, 100],       serviceDurations: [60, 60, 90] },
  { idx: 15, email: 'sara15@servicehub.local', businessName: 'طبيب أسنان متخصص',     description: 'طب وجراحة أسنان',              categoryId: 'cat-medical',     address: 'Beirut',      lat: 33.8938, lng: 35.5018, timezone: 'Asia/Beirut',       serviceTitles: ['كشف أسنان','تنظيف أسنان','حشو عصب'],                     servicePrices: [120, 150, 400],     serviceDurations: [30, 45, 90] },
  { idx: 16, email: 'sara16@servicehub.local', businessName: 'مصور محترف فري لانس',  description: 'تصوير إعلاني وطبيعي',          categoryId: 'cat-photography', address: 'Tripoli',     lat: 32.8872, lng: 13.1913, timezone: 'Africa/Tripoli',    serviceTitles: ['تصوير عقاري','تصوير طعام','تصوير حدث'],                   servicePrices: [500, 250, 600],     serviceDurations: [120, 60, 180] },
  { idx: 17, email: 'sara17@servicehub.local', businessName: 'صالون رويال الفاخر',   description: 'صالون نسائي راقي',              categoryId: 'cat-salon',       address: 'Sanaa',       lat: 15.3694, lng: 44.1910, timezone: 'Asia/Aden',         serviceTitles: ['تسريحة عروس','صبغة شعر','علاج شعر','مكياج سهرة'],        servicePrices: [400, 200, 180, 250], serviceDurations: [150, 90, 90, 75] },
];

// Deterministic Arabic name pools for the 54 synthetic customers.
const AR_FIRST = ['محمد','أحمد','علي','حسن','يوسف','عمر','خالد','سعيد','فهد','ناصر','طارق','كريم','بدر','فيصل','زياد','راشد','ماجد','عبدالله','سامي','وليد','هاني','بلال','إياد','رياض','جمال','ياسر','عادل','معاذ','حمد','سلطان','صالح','مروان','رامي','ثامر','مشعل','أنس','ضياء','عبدالرحمن','سلمان','تركي','محسن','بسام','رائد','سعد','هشام','فؤاد','ماهر','رفيق','فاروق','إبراهيم','نبيل','عصام','حاتم','راغب','لمى','سارة','نورة','هند','مريم','عائشة','فاطمة','أمل','ريم','شيماء'];
const AR_LAST  = ['العتيبي','الشمري','الحربي','الزهراني','القحطاني','الغامدي','البلوي','الجهني','الرشيدي','المالكي','الدوسري','العنزي','المطيري','السبيعي','الخالدي','الهاشمي','الفهد','النعيمي','الكسابي','الشراري','الفيفي','البقمي','الرويلي','العسيري','القرشي','المهري','الشعيبي','النفيعي','العامري','الحكم'];
const NEW_CUSTOMER_PASSWORD = requireSeedPassword('SEED_DEMO_CUSTOMER_PASSWORD');
const NEW_VENDOR_PASSWORD = requireSeedPassword('SEED_DEMO_VENDOR_PASSWORD');


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

// === Synthetic dataset helpers ===============================================

async function upsertNewVendor(v: NewVendorRow, passwordHash: string) {
  const userId    = `usr-vendor-${String(v.idx).padStart(2, '0')}`;
  const profileId = `vnd-${String(v.idx).padStart(2, '0')}`;
  const user = await prisma.user.upsert({
    where: { email: v.email },
    update: { name: v.businessName, role: UserRole.VENDOR, locale: 'ar', isLocked: false, failedLoginAttempts: 0 },
    create: { id: userId, name: v.businessName, email: v.email, passwordHash, role: UserRole.VENDOR, locale: 'ar' },
  });
  const profile = await prisma.vendorProfile.upsert({
    where: { userId: user.id },
    update: { businessName: v.businessName, description: v.description, categoryId: v.categoryId, address: v.address, lat: v.lat, lng: v.lng, timezone: v.timezone, status: VendorStatus.APPROVED },
    create: { id: profileId, userId: user.id, businessName: v.businessName, description: v.description, categoryId: v.categoryId, address: v.address, lat: v.lat, lng: v.lng, timezone: v.timezone, status: VendorStatus.APPROVED },
  });
  return { user, profile };
}

async function upsertNewService(s: { id: string; vendorProfileId: string; title: string; description: string; price: number; durationMinutes: number; categoryId: string }) {
  return prisma.service.upsert({
    where: { id: s.id },
    update: { vendorId: s.vendorProfileId, title: s.title, description: s.description, price: s.price, durationMinutes: s.durationMinutes, categoryId: s.categoryId, isActive: true },
    create: { id: s.id, vendorId: s.vendorProfileId, title: s.title, description: s.description, price: s.price, durationMinutes: s.durationMinutes, categoryId: s.categoryId, isActive: true },
  });
}

async function upsertNewCustomer(idx: number, passwordHash: string) {
  const id = `usr-customer-${String(idx).padStart(2, '0')}`;
  const name = `${AR_FIRST[idx % AR_FIRST.length]} ${AR_LAST[(idx + 7) % AR_LAST.length]}`;
  const email = `cust${idx}@servicehub.local`;
  return prisma.user.upsert({
    where: { email },
    update: { name, role: UserRole.CUSTOMER, locale: 'ar', isLocked: false, failedLoginAttempts: 0 },
    create: { id, name, email, passwordHash, role: UserRole.CUSTOMER, locale: 'ar' },
  });
}

/** Slot → (start, end, status). slotIdx 0..7, status covers all 5 BookingStatus values.
 *  For 9 of 18 vendors (idx 1..9) slot 2 is COMPLETED instead of CANCELLED,
 *  giving 45 COMPLETED bookings total — enough for 45 reviews and the
 *  100-payment target (45 COMPLETED + 37 CONFIRMED + 18 PENDING_PAYMENT). */
function computeSlotTime(vIdx: number, slotIdx: number): { start: Date; end: Date; status: BookingStatus } {
  let daysOffset: number;
  let status: BookingStatus;
  if (slotIdx === 0 || slotIdx === 1) { daysOffset = -((slotIdx + 1) * 5); status = BookingStatus.COMPLETED; }
  else if (slotIdx === 2)              { daysOffset = -15; status = (vIdx >= 1 && vIdx <= 9) ? BookingStatus.COMPLETED : BookingStatus.CANCELLED; }
  else if (slotIdx === 3)              { daysOffset = -20;                          status = BookingStatus.NO_SHOW; }
  else if (slotIdx === 4 || slotIdx === 5) { daysOffset = (slotIdx - 3) * 3;        status = BookingStatus.CONFIRMED; }
  else                                  { daysOffset = (slotIdx - 5) * 3;           status = BookingStatus.PENDING_PAYMENT; }
  // 6 distinct hours across 8 slots, all non-overlapping for one vendor.
  const hour = 9 + (slotIdx % 6);
  const start = new Date();
  start.setDate(start.getDate() + daysOffset);
  start.setHours(hour, 0, 0, 0);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  return { start, end, status };
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
  // === LARGE SYNTHETIC DATASET (additive — does not touch canonical rows) ===

  // 10. Extra categories (8 total).
  for (const cat of EXTRA_CATEGORIES) {
    await upsertCategory(cat);
    console.log(`  ✓ category  ${cat.id}  ${cat.nameEn} / ${cat.nameAr}`);
  }

  // 11. 17 new approved vendors + their services + availability.
  const newVendorHash   = await hash(NEW_VENDOR_PASSWORD);
  const newCustomerHash = await hash(NEW_CUSTOMER_PASSWORD);
  type VendorEntry = { idx: number; userId: string; profileId: string; serviceIds: { id: string; price: number; durationMinutes: number }[] };
  const vendorPool: VendorEntry[] = [{
    idx: 0,
    userId: vendorUser.id,
    profileId: vendorProfile.id,
    serviceIds: CANONICAL_SERVICES.map((s) => ({ id: s.id, price: s.price, durationMinutes: s.durationMinutes })),
  }];

  for (const v of NEW_VENDORS) {
    const { user, profile } = await upsertNewVendor(v, newVendorHash);
    const serviceIds: { id: string; price: number; durationMinutes: number }[] = [];
    for (let i = 0; i < v.serviceTitles.length; i++) {
      const svcId = `svc-v${String(v.idx).padStart(2, '0')}-${String(i + 1).padStart(2, '0')}`;
      await upsertNewService({
        id: svcId, vendorProfileId: profile.id, title: v.serviceTitles[i],
        description: `خدمة ${v.serviceTitles[i]} من ${v.businessName}`,
        price: v.servicePrices[i], durationMinutes: v.serviceDurations[i], categoryId: v.categoryId,
      });
      serviceIds.push({ id: svcId, price: v.servicePrices[i], durationMinutes: v.serviceDurations[i] });
    }
    for (const day of AVAILABILITY_DAYS) await upsertAvailability(profile.id, day);
    vendorPool.push({ idx: v.idx, userId: user.id, profileId: profile.id, serviceIds });
    console.log(`  ✓ vendor    ${v.email}  ${serviceIds.length} services  ${AVAILABILITY_DAYS.length} availability rows`);
  }
  const totalServices = vendorPool.reduce((acc, v) => acc + v.serviceIds.length, 0);
  console.log(`  ✓ vendors   ${vendorPool.length} approved  (${totalServices} active services)`);

  // 12. 54 new customers (55 total with ahmad).
  const allCustomerIds: string[] = [customer.id];
  for (let i = 1; i <= 54; i++) {
    const c = await upsertNewCustomer(i, newCustomerHash);
    allCustomerIds.push(c.id);
  }
  console.log(`  ✓ customers +54 synthetic  (total: ${allCustomerIds.length})`);

  // 13. 144 new bookings (18 vendors × 8 slots). Non-overlapping per vendor.
  type BookingRec = { id: string; vendorProfileId: string; vendorUserId: string; customerId: string; status: BookingStatus };
  const allBookings: BookingRec[] = [{
    id: booking.id, vendorProfileId: vendorProfile.id, vendorUserId: vendorUser.id,
    customerId: customer.id, status: BookingStatus.CONFIRMED,
  }];
  const newBookingStats = { COMPLETED: 0, CONFIRMED: 0, PENDING_PAYMENT: 0, CANCELLED: 0, NO_SHOW: 0 };
  for (const v of vendorPool) {
    for (let slotIdx = 0; slotIdx < 8; slotIdx++) {
      const { start, end, status } = computeSlotTime(v.idx, slotIdx);
      const svc = v.serviceIds[slotIdx % v.serviceIds.length];
      const custId = allCustomerIds[(v.idx * 8 + slotIdx) % allCustomerIds.length];
      const priceNum = Number(svc.price);
      const commission = priceNum * commissionRate;
      const bookingId = `bk-v${String(v.idx).padStart(2, '0')}-s${slotIdx}`;
      await prisma.booking.upsert({
        where: { id: bookingId },
        update: { customerId: custId, vendorId: v.profileId, serviceId: svc.id, startTime: start, endTime: end, status, priceAtBooking: priceNum, commissionAmount: commission, holdExpiresAt: status === BookingStatus.PENDING_PAYMENT ? new Date(Date.now() + 5 * 60 * 1000) : null },
        create: { id: bookingId, customerId: custId, vendorId: v.profileId, serviceId: svc.id, startTime: start, endTime: end, status, priceAtBooking: priceNum, commissionAmount: commission, holdExpiresAt: status === BookingStatus.PENDING_PAYMENT ? new Date(Date.now() + 5 * 60 * 1000) : null },
      });
      newBookingStats[status]++;
      allBookings.push({ id: bookingId, vendorProfileId: v.profileId, vendorUserId: v.userId, customerId: custId, status });
    }
  }
  console.log(`  ✓ bookings  +${newBookingStats.COMPLETED + newBookingStats.CONFIRMED + newBookingStats.PENDING_PAYMENT + newBookingStats.CANCELLED + newBookingStats.NO_SHOW}  (${newBookingStats.COMPLETED} COMPLETED, ${newBookingStats.CONFIRMED} CONFIRMED, ${newBookingStats.PENDING_PAYMENT} PENDING, ${newBookingStats.CANCELLED} CANCELLED, ${newBookingStats.NO_SHOW} NO_SHOW)`);

  // 14. 100 payments (MOCK provider only).
  const completedBookings = allBookings.filter((b) => b.status === BookingStatus.COMPLETED);
  const confirmedBookings = allBookings.filter((b) => b.status === BookingStatus.CONFIRMED);
  const pendingBookings   = allBookings.filter((b) => b.status === BookingStatus.PENDING_PAYMENT);
  const paymentTargets: { bookingId: string; status: PaymentStatus; amount: number }[] = [];
  for (const b of completedBookings) {
    const rec = await prisma.booking.findUnique({ where: { id: b.id } });
    paymentTargets.push({ bookingId: b.id, status: PaymentStatus.SUCCEEDED, amount: Number(rec?.priceAtBooking ?? 0) });
  }
  for (const b of confirmedBookings) {
    const rec = await prisma.booking.findUnique({ where: { id: b.id } });
    paymentTargets.push({ bookingId: b.id, status: PaymentStatus.SUCCEEDED, amount: Number(rec?.priceAtBooking ?? 0) });
  }
  for (let i = 0; i < 18 && i < pendingBookings.length; i++) {
    const rec = await prisma.booking.findUnique({ where: { id: pendingBookings[i].id } });
    paymentTargets.push({ bookingId: pendingBookings[i].id, status: PaymentStatus.PENDING, amount: Number(rec?.priceAtBooking ?? 0) });
  }
  for (const t of paymentTargets) {
    await prisma.payment.upsert({
      where: { bookingId: t.bookingId },
      update: { provider: PaymentProvider.MOCK, externalId: `mock-pay-${t.bookingId}`, amount: t.amount, currency: 'brl', status: t.status, refundedAmount: 0 },
      create: { id: `pay-${t.bookingId}`, bookingId: t.bookingId, provider: PaymentProvider.MOCK, externalId: `mock-pay-${t.bookingId}`, amount: t.amount, currency: 'brl', status: t.status, refundedAmount: 0 },
    });
  }
  console.log(`  ✓ payments  ${paymentTargets.length}  (MOCK only)`);

  // 15. 45 reviews — every one on a COMPLETED booking.
  const reviewComments = [
    'خدمة ممتازة وأنصح بها!', 'تجربة رائعة، شكراً جزيلاً', 'احترافية عالية وأسعار معقولة',
    'سرعة في الإنجاز ودقة في الموعد', 'نتيجة مميزة وفاقت توقعاتي', 'تعامل راقي وخدمة نظيفة',
    'سأعود مرة أخرى بالتأكيد', 'الجودة ممتازة ويستحق التجربة', 'فريق عمل ودود ومتعاون',
    'موقع مناسب ومواعيد مرنة', 'اهتمام بأدق التفاصيل', 'يستحق كل ريال',
    'ممتاز جداً وأنصح به بشدة', 'تجربة احترافية من البداية للنهاية', 'سعر ممتاز مقابل الخدمة',
  ];
  const reviewTargets = completedBookings.slice(0, 45);
  for (let i = 0; i < reviewTargets.length; i++) {
    const b = reviewTargets[i];
    const rating = 3 + ((i * 7) % 3); // 3..5
    await prisma.review.upsert({
      where: { bookingId: b.id },
      update: { userId: b.customerId, rating, comment: reviewComments[i % reviewComments.length] },
      create: { id: `rev-${b.id}`, bookingId: b.id, userId: b.customerId, rating, comment: reviewComments[i % reviewComments.length] },
    });
  }
  console.log(`  ✓ reviews   ${reviewTargets.length}  (all on COMPLETED bookings)`);

  // 16. 40 messages — sender ∈ {booking.customer, booking.vendor.user}.
  const messageBookings = allBookings.filter((b) => b.status !== BookingStatus.CANCELLED).slice(0, 20);
  const messageTemplates = ['مرحباً، أؤكد الحجز', 'أهلاً وسهلاً، الموعد مؤكد', 'هل يمكنني تغيير الموعد؟', 'بالتأكيد، متى يناسبك؟'];
  let msgCount = 0;
  for (let i = 0; i < messageBookings.length; i++) {
    const b = messageBookings[i];
    await prisma.message.upsert({
      where: { id: `msg-${b.id}-a` },
      update: { content: messageTemplates[i % messageTemplates.length], readAt: new Date() },
      create: { id: `msg-${b.id}-a`, bookingId: b.id, senderId: b.customerId, content: messageTemplates[i % messageTemplates.length], readAt: new Date() },
    });
    msgCount++;
    await prisma.message.upsert({
      where: { id: `msg-${b.id}-b` },
      update: { content: messageTemplates[(i + 1) % messageTemplates.length], readAt: null },
      create: { id: `msg-${b.id}-b`, bookingId: b.id, senderId: b.vendorUserId, content: messageTemplates[(i + 1) % messageTemplates.length], readAt: null },
    });
    msgCount++;
  }
  console.log(`  ✓ messages  ${msgCount}`);

  // 17. 120 notifications across 74 users (admin + 18 vendors + 55 customers).
  const notifTypes = ['booking.confirmed','booking.cancelled','booking.completed','payment.succeeded','message.received','review.received'];
  let notifCount = 0;
  for (let i = 0; i < 2; i++) {
    await prisma.notification.upsert({
      where: { id: `notif-admin-${i + 1}` },
      update: { type: notifTypes[i], payload: { sample: i } },
      create: { id: `notif-admin-${i + 1}`, userId: admin.id, type: notifTypes[i], payload: { sample: i }, readAt: i === 0 ? new Date() : null },
    });
    notifCount++;
  }
  for (const v of vendorPool) {
    for (let i = 0; i < 2; i++) {
      const id = `notif-${v.userId}-${i + 1}`;
      await prisma.notification.upsert({
        where: { id },
        update: { type: notifTypes[notifCount % notifTypes.length], payload: { v: v.idx, n: i } },
        create: { id, userId: v.userId, type: notifTypes[notifCount % notifTypes.length], payload: { v: v.idx, n: i }, readAt: i === 0 ? new Date() : null },
      });
      notifCount++;
    }
  }
  for (let cIdx = 0; cIdx < allCustomerIds.length; cIdx++) {
    const custId = allCustomerIds[cIdx];
    const n = cIdx < 27 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const id = `notif-${custId}-${i + 1}`;
      await prisma.notification.upsert({
        where: { id },
        update: { type: notifTypes[notifCount % notifTypes.length], payload: { c: cIdx, n: i } },
        create: { id, userId: custId, type: notifTypes[notifCount % notifTypes.length], payload: { c: cIdx, n: i }, readAt: i === 0 ? new Date() : null },
      });
      notifCount++;
    }
  }
  console.log(`  ✓ notifications  ${notifCount}`);


  // ── Done ─────────────────────────────────────────────────────────────────────
  console.log('\n✅ Seed complete!\n');
  console.log('  👤 Admin    :', ADMIN_EMAIL);
  console.log('  👤 Vendor   :', VENDOR_EMAIL);
  console.log('  👤 Customer :', CUSTOMER_EMAIL);
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
