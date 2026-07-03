# ServiceHub — دليل التنفيذ العملي (Execution Playbook)

> **المشروع:** ServiceHub — منصة SaaS متعددة المستأجرين لحجز الخدمات
> **الـ PRD:** `docs/PRD.docx`
> **تاريخ الإنشاء:** 2026-07-03
> **المدة المتوقعة:** 10-12 أسبوع (3h/day × 4 أيام/أسبوع)
> **ملاحظة:** Docker غير مطلوب في هذه المرحلة — سنعمل مباشرة مع PostgreSQL المحلي

---

## Phase 0 — البنية التحتية (1 أسبوع)

### 0.1 إنشاء Monorepo Structure
**الهدف:** هيكل مشروع نظيف يفصل API عن Web
**طريقة التنفيذ:**
```bash
cd /home/server/projects/servicehub
npm init -y
# إعداد workspaces في package.json الرئيسي
```
```json
{
  "name": "servicehub",
  "private": true,
  "workspaces": ["apps/api", "apps/web"],
  "scripts": {
    "dev:api": "npm --workspace @servicehub/api run start:dev",
    "dev:web": "npm --workspace @servicehub/web run dev",
    "build:api": "npm --workspace @servicehub/api run build",
    "test:api": "npm --workspace @servicehub/api run test"
  }
}
```
```bash
mkdir -p apps/api apps/web
```
**✅ تم عندما:** `npm run dev:api` و `npm run dev:web` يعملان من الجذر

---

### 0.2 إعداد NestJS Backend
**الهدف:** سيرفر NestJS يعمل على port 3001
**طريقة التنفيذ:**
```bash
cd apps/api
npm init -y  # name: @servicehub/api
npm install @nestjs/core @nestjs/common @nestjs/platform-express reflect-metadata rxjs
npm install @nestjs/config @nestjs/swagger
npm install -D @nestjs/cli typescript @types/node ts-node
```
أنشئ `apps/api/src/main.ts`:
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: ['http://localhost:3000'], credentials: true });
  await app.listen(3001);
  console.log(`🚀 ServiceHub API running on http://localhost:3001/api/v1`);
}
bootstrap();
```
أنشئ `apps/api/src/app.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env.local', '.env'] }),
  ],
})
export class AppModule {}
```
أنشئ `apps/api/.env`:
```
DATABASE_URL="postgresql://servicehub:servicehub@localhost:5432/servicehub"
JWT_SECRET="CHANGE-ME-IN-PRODUCTION"
JWT_ACCESS_EXPIRES_IN="15m"
JWT_REFRESH_EXPIRES_IN="7d"
STRIPE_SECRET_KEY="sk_test_XXX"
STRIPE_WEBHOOK_SECRET="whsec_XXX"
PORT=3001
```
أنشئ `apps/api/.env.example` (نفس المحتوى لكن بقيم placeholder)
**✅ تم عندما:** `npm run start:dev` يبدأ والـ `curl http://localhost:3001/api/v1/health` يرجع 200

---

### 0.3 إعداد Next.js 14
**الهدف:** واجهة ويب تعمل على port 3000
**طريقة التنفيذ:**
```bash
cd apps/web
npx create-next-app@latest . --typescript --tailwind --app --src-dir --import-alias "@/*"
```
أضف في `apps/web/next.config.mjs`:
```javascript
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: 'http://localhost:3001/api/v1/:path*',
      },
    ];
  },
};
export default nextConfig;
```
**✅ تم عندما:** `npm run dev` يفتح على `http://localhost:3000` ويعرض صفحة Next.js الافتراضية

---

### 0.4 تصميم Prisma Schema (8 كيانات)
**الهدف:** قاعدة بيانات كاملة من اليوم الأول
**طريقة التنفيذ:**
```bash
cd apps/api
npm install @prisma/client
npm install -D prisma
npx prisma init
```
ثم اكتب `apps/api/prisma/schema.prisma` كاملاً (الكيانات الثمانية حسب الـ PRD):
```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── Users & Auth ───
enum UserRole {
  CUSTOMER
  VENDOR
  ADMIN
}

model User {
  id           String   @id @default(cuid())
  name         String
  email        String   @unique
  passwordHash String?
  role         UserRole @default(CUSTOMER)
  phone        String?
  locale       String   @default("ar")
  googleId     String?  @unique
  isLocked     Boolean  @default(false)
  failedLoginAttempts Int @default(0)
  lockUntil    DateTime?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt

  vendorProfile VendorProfile?
  bookingsAsCustomer Booking[] @relation("CustomerBookings")
  reviews       Review[]
  messagesSent  Message[]  @relation("SentMessages")
  notifications Notification[]
  refreshTokens RefreshToken[]

  @@index([role])
  @@index([email])
}

model RefreshToken {
  id        String   @id @default(cuid())
  token     String   @unique
  userId    String
  expiresAt DateTime
  revokedAt DateTime?
  createdAt DateTime @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId])
  @@index([token)
}

// ─── Vendor ───
enum VendorStatus {
  PENDING
  APPROVED
  SUSPENDED
}

model VendorProfile {
  id             String       @id @default(cuid())
  userId         String       @unique
  businessName   String
  description    String?
  categoryId     String
  address        String?
  lat            Float?
  lng            Float?
  commissionRate Float        @default(0.10) // 10%
  status         VendorStatus @default(PENDING)
  avgRating      Float?       @default(0)
  createdAt      DateTime     @default(now())
  updatedAt      DateTime     @updatedAt

  user      User       @relation(fields: [userId], references: [id], onDelete: Cascade)
  category  Category   @relation(fields: [categoryId], references: [id])
  services  Service[]
  bookings  Booking[]  @relation("VendorBookings")

  @@index([status])
  @@index([categoryId])
}

// ─── Catalog ───
model Category {
  id      String @id @default(cuid())
  nameAr  String
  nameEn  String
  icon    String?

  vendors      VendorProfile[]
  services     Service[]
}

model Service {
  id              String   @id @default(cuid())
  vendorId        String
  title           String
  description     String?
  price           Decimal  @db.Decimal(10, 2)
  durationMinutes Int
  categoryId      String
  isActive        Boolean  @default(true)
  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt

  vendor   VendorProfile @relation(fields: [vendorId], references: [id], onDelete: Cascade)
  category Category      @relation(fields: [categoryId], references: [id])
  bookings Booking[]

  @@index([vendorId])
  @@index([categoryId])
  @@index([isActive])
}

// ─── Availability ───
model Availability {
  id           String   @id @default(cuid())
  vendorId     String
  dayOfWeek    Int      // 0=Sunday ... 6=Saturday
  startTime    String   // "09:00"
  endTime      String   // "17:00"
  isException  Boolean  @default(false)
  exceptionDate DateTime?

  vendor VendorProfile @relation(fields: [vendorId], references: [id], onDelete: Cascade)

  @@index([vendorId, dayOfWeek])
}

// ─── Booking Engine ───
enum BookingStatus {
  PENDING_PAYMENT
  CONFIRMED
  COMPLETED
  CANCELLED
  NO_SHOW
}

model Booking {
  id                String       @id @default(cuid())
  customerId        String
  vendorId          String
  serviceId         String
  startTime         DateTime
  endTime           DateTime
  status            BookingStatus @default(PENDING_PAYMENT)
  priceAtBooking    Decimal      @db.Decimal(10, 2)
  commissionAmount  Decimal      @db.Decimal(10, 2)
  holdExpiresAt     DateTime?
  cancellationReason String?
  cancelledBy       String?
  createdAt         DateTime     @default(now())
  updatedAt         DateTime     @updatedAt

  customer User          @relation("CustomerBookings", fields: [customerId], references: [id])
  vendor   VendorProfile @relation("VendorBookings", fields: [vendorId], references: [id])
  service  Service       @relation(fields: [serviceId], references: [id])
  payment  Payment?
  review   Review?

  @@index([vendorId, startTime, endTime])
  @@index([customerId])
  @@index([status])
}

// ─── Payments ───
enum PaymentStatus {
  PENDING
  SUCCEEDED
  FAILED
  REFUNDED
  PARTIALLY_REFUNDED
}

model Payment {
  id                   String        @id @default(cuid())
  bookingId            String        @unique
  stripePaymentIntentId String      @unique
  amount               Decimal       @db.Decimal(10, 2)
  status               PaymentStatus @default(PENDING)
  refundedAmount       Decimal       @default(0) @db.Decimal(10, 2)
  createdAt            DateTime      @default(now())
  updatedAt            DateTime      @updatedAt

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)

  @@index([status])
}

// ─── Reviews ───
model Review {
  id        String   @id @default(cuid())
  bookingId String   @unique
  userId    String
  rating    Int      // 1-5
  comment   String?
  createdAt DateTime @default(now())

  booking Booking @relation(fields: [bookingId], references: [id], onDelete: Cascade)
  user    User    @relation(fields: [userId], references: [id])

  @@index([userId])
}

// ─── Messaging & Notifications ───
model Message {
  id        String    @id @default(cuid())
  bookingId String
  senderId  String
  content   String
  readAt    DateTime?

  booking Booking @relation(fields: [bookingId], references: [id])  // requires Booking.message relation
  sender  User    @relation("SentMessages", fields: [senderId], references: [id])

  @@index([bookingId])
  @@index([senderId])
}

model Notification {
  id        String    @id @default(cuid())
  userId    String
  type      String
  payload   Json
  readAt    DateTime?
  createdAt DateTime  @default(now())

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([userId, readAt])
}

// ملاحظة: Booking يحتاج إضافة relation للـ Messages
// أضف داخل model Booking:
//   messages Message[]
```

---

### 0.5 إنشاء PostgreSQL Database
**الهدف:** قاعدة بيانات جاهزة للـ migration
**طريقة التنفيذ:**
```bash
# إنشاء user + database
sudo -u postgres psql -c "CREATE USER servicehub WITH PASSWORD 'servicehub';"
sudo -u postgres psql -c "CREATE DATABASE servicehub OWNER servicehub;"
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE servicehub TO servicehub;"

# تفعيل btree_gist (مطلوب لـ EXCLUDE constraint في Phase 3)
sudo -u postgres psql -d servicehub -c "CREATE EXTENSION IF NOT EXISTS btree_gist;"
```
**✅ تم عندما:** `psql -U servicehub -d servicehub -c "\dt"` يعمل بدون خطأ

---

### 0.6 أول Prisma Migration
**الهدف:** إنشاء كل الجداول في قاعدة البيانات
**طريقة التنفيذ:**
```bash
cd apps/api
npx prisma migrate dev --name init
```
**✅ تم عندما:** `npx prisma studio` يفتح ويعرض كل الجداول

---

### 0.7 ESLint + Prettier
**الهدف:** كود نظيف من اليوم الأول
**طريقة التنفيذ:**
```bash
# في الجذر
npm install -D eslint @typescript-eslint/parser @typescript-eslint/eslint-plugin prettier
```
أنشئ `.eslintrc.js`:
```javascript
module.exports = {
  root: true,
  parser: '@typescript-eslint/parser',
  plugins: ['@typescript-eslint'],
  extends: ['eslint:recommended', 'plugin:@typescript-eslint/recommended'],
  rules: {
    '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    '@typescript-eslint/explicit-module-boundary-types': 'off',
  },
  ignorePatterns: ['dist', 'node_modules', '.next'],
};
```
أنشئ `.prettierrc`:
```json
{
  "semi": true,
  "singleQuote": true,
  "trailingComma": "all",
  "printWidth": 100,
  "tabWidth": 2
}
```
**✅ تم عندما:** `npx eslint apps/api/src/**/*.ts` لا يعطي أخطاء

---

### 0.8 GitHub Repo + .gitignore
**ال_goal:** repo نظيف آمن
**طريقة التنفيذ:**
```bash
cd /home/server/projects/servicehub
git init
```
أنشئ `.gitignore`:
```
# Node
node_modules/
dist/
.next/
out/

# Env
.env
.env.local
*.local

# DB
*.db
*.db-journal
prisma/dev.db

# Hermes
.hermes/
.hskill/
.hplan/

# OS
.DS_Store
Thumbs.db

# Build
*.tsbuildinfo
coverage/

# IDE
.vscode/
.idea/
*.swp
```
```bash
git add -A
git commit -m "Phase 0: Initial monorepo structure (NestJS + Next.js + Prisma)"
# أنشئ repo على GitHub أولاً ثم:
git remote add origin https://github.com/MamdouhAlsaodi/servicehub.git
git branch -M main
git push -u origin main
```
**✅ تم عندما:** GitHub repo يحتوي على structure نظيف بدون secrets

---

### 0.9 Seed Script أولي
**الهدف:** بيانات تجريبية لتطوير وتجربة الواجهة
**typescript:**
أنشئ `apps/api/prisma/seed.ts`:
```typescript
import { PrismaClient, UserRole, VendorStatus, BookingStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding ServiceHub...');

  // 1. Admin user
  const adminPassword = await bcrypt.hash('admin123', 12);
  const admin = await prisma.user.upsert({
    where: { email: 'admin@servicehub.local' },
    update: {},
    create: {
      name: 'Platform Admin',
      email: 'admin@servicehub.local',
      passwordHash: adminPassword,
      role: UserRole.ADMIN,
      locale: 'ar',
    },
  });

  // 2. Categories
  const categories = await Promise.all([
    prisma.category.upsert({ where: { id: 'cat-salon' }, update: {}, create: { id: 'cat-salon', nameAr: 'صالونات تجميل', nameEn: 'Beauty Salons', icon: '💇' } }),
    prisma.category.upsert({ where: { id: 'cat-fitness' }, update: {}, create: { id: 'cat-fitness', nameAr: 'لياقة بدنية', nameEn: 'Fitness', icon: '💪' } }),
    prisma.category.upsert({ where: { id: 'cat-repair' }, update: {}, create: { id: 'cat-repair', nameAr: 'صيانة', nameEn: 'Repair', icon: '🔧' } }),
    prisma.category.upsert({ where: {_id: 'cat-consulting'}, update: {}, create: { id: 'cat-consulting', nameAr: 'استشارات', nameEn: 'Consulting', icon: '🧑‍💼' } }),
  ]);

  // 3. Vendor users + profiles
  const vendorPassword = await bcrypt.hash('vendor123', 12);
  const vendorUser = await prisma.user.upsert({
    where: { email: 'sara@servicehub.local' },
    update: {},
    create: {
      name: 'صالون سارة',
      email: 'sara@servicehub.local',
      passwordHash: vendorPassword,
      role: UserRole.VENDOR,
      locale: 'ar',
      vendorProfile: {
        create: {
          businessName: 'صالون سارة للتجميل',
          description: 'صالون تجميل متكامل - شعر، أظافر، مكياج',
          categoryId: 'cat-salon',
          address: 'São Paulo, SP',
          lat: -23.5505,
          lng: -46.6333,
          status: VendorStatus.APPROVED,
        },
      },
    },
  });

  // 4. Services
  await prisma.service.createMany({
    data: [
      { vendorId: vendorUser.vendorProfile!.id, title: 'قص شعر نسائي', description: 'قص + غسل + تصفيف', price: 80, durationMinutes: 60, categoryId: 'cat-salon' },
      { vendorId: vendorUser.vendorProfile!.id, title: 'مانيكير', description: 'أظافر + طلاء', price: 40, durationMinutes: 45, categoryId: 'cat-salon' },
      { vendorId: vendorUser.vendorProfile!.id, title: 'مكياج احترافي', description: 'مكياج للمناسبات', price: 150, durationMinutes: 90, categoryId: 'cat-salon' },
    ],
    skipDuplicates: true,
  });

  // 5. Availability (Sunday-Thursday, 9-17)
  for (let day = 0; day <= 4; day++) {
    await prisma.availability.create({
      data: { vendorId: vendorVendor.vendorProfile!.id, dayOfWeek: day, startTime: '09:00', endTime: '17:00' },
    });
  }

  // 6. Customer user
  const customerPassword = await bcrypt.hash('customer123', 12);
  await prisma.user.upsert({
    where: { email: 'ahmad@servicehub.local' },
    update: {},
    create: {
      name: 'أحمد',
      email: 'ahmad@servicehub.local',
      password: customerPassword,
      role: UserRole.CUSTOMER,
      locale: 'ar',
    },
  });

  console.log('✅ Seed complete!');
  console.log('  Admin: admin@servicehub.local / admin123');
  console.log('  Vendor: sara@servicehub.local / vendor123');
  console.log('  Customer: ahmad@servicehub.local / customer123');
}

main().finally(() => prisma.$disconnect());
```
**✅ تم عندما:** `npx prisma db seed` ينشئ المستخدمين + الفئات + الخدمات بدون أخطاء

---

## Phase 1 — المصادقة وإدارة الحسابات (2 أسبوع)

### 1.1 Auth Module: register, login, refresh, logout
**الهدف:** نظام مصادقة كامل بـ JWT (Access 15min + Refresh 7d)
**طريقة التنفيذ:**
```bash
cd apps/api
npx nest g module auth
npx nest g controller auth
npx nest g service auth
```
الـ Auth Service يحتوي على:
- `register(dto)`: إنشاء User + hash password + إنشاء tokens
- `login(dto)`: التحقق من password + إصدار tokens
- `refreshToken(token)`: التحقق من refresh token في DB + إصدار جديد
- `logout(userId)`: revoke كل refresh tokens للمستخدم
**طريقة الحماية (Guards):**
```typescript
// jwt-auth.guard.ts
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {}

// roles.guard.ts
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private reflector: Reflector) {}
  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!requiredRoles) return true;
    const { user } = context.switchToHttp().getRequest();
    return requiredRoles.some((role) => user?.role === role);
  }
}
```
**✅ تم عندما:**
- `POST /api/v1/auth/register` ينشئ مستخدم ويرجع tokens
- `POST /api/v1/auth/login` يرجع tokens
- `POST /api/v1/auth/refresh` يجدد access token
- `POST /api/v1/auth/logout` يبطل refresh token

---

### 1.2 Password Hashing (bcrypt)
**الهدف:** كلمات مرور مشفرة
**طريقة التنفيذ:**
أنشئ `apps/api/src/shared/security/password.service.ts`:
```typescript
import * as bcrypt from 'bcrypt';
const SALT_ROUNDS = 12;

@Injectable()
export class PasswordService {
  hash(password: string): Promise<string> {
    return bcrypt.hash(password, SALT_ROUNDS);
  }
  verify(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }
}
```
**✅ تم عندما:** كلمة المرور `admin123` تُخزّن كـ `$2b$12$...` في DB

---

### 1.3 Rate Limiting على /auth/login
**الهدف:** منع brute force
**طريقة التنفيذ:**
```bash
npm install @nestjs/throttler
```
أضف في `app.module.ts`:
```typescript
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 20 }]), // 20 req/min globally
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
```
للقفل الخاص بـ login (5 محاولات/دقيقة):
```typescript
// في AuthService.login()
const recentAttempts = await this.prisma.user.findUnique({
  where: { email },
  select: { failedLoginAttempts: true, lockUntil: true }
});
if (user.isLocked || (user.lockUntil && user.lockUntil > new Date())) {
  throw new UnauthorizedException('Account locked. Try again in 15 minutes.');
}
```
**✅ تم عندما:** 6 محاولات دخول فاشلة متتالية تقفل الحساب 15 دقيقة

---

### 1.4 Account Lockout بعد 5 محاولات
**الهدف:** أمان إضافي ضد brute force
**طريقة التنفيذ:**
```typescript
// في AuthService.login() — عند فشل كلمة المرور:
await this.prisma.user.update({
  where: { id: user.id },
  data: {
    failedLoginAttempts: { increment: 1 },
    lockUntil: user.failedLoginAttempts + 1 >= 5
      ? new Date(Date.now() + 15 * 60 * 1000) // 15 min lock
      : null,
  },
});

// عند نجاح الدخول — reset
await this.prisma user.update({
  where: { id: user.id },
  data: { failedLoginAttempts: 0, lockUntil: null, isLocked: false },
});
```
**✅ تم عندما:** الحساب يقفل بعد 5 محاولات ويفتح تلقائياً بعد 15 دقيقة

---

###  module)
**الهدف:** 3 أدوار منفصلة بصلاحيات واضحة
**窑ريقة التنفيذ:**
أنشئ `apps/api/src/modules/auth/decorators/roles.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';
import { UserRole } from '@prisma/client';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
```
استخدامه في Controller:
```typescript
@Post('register')
@Roles(UserRole.ADMIN) // فقط Admin يمكنه الموافقة على Vendors
approveVendor(@Body() dto: ApproveVendorDto) { ... }

@Get('me')
@UseGuards(JwtAuthGuard)
getProfile(@CurrentUser() user) { return user; }

@Get('all')
@Roles(UserRole.ADMIN)
@UseGuards(JwtAuthGuard, RolesGuard)
getAllUsers() { ... }
```
**✅ зап:** عامل بائع لا يستطيع الوصول لـ `GET /api/v1/users` (Admin only)

---

### 1.6 Vendor Registration → status: pending
**الهدف:** البائعون يحتاجون موافقة Admin
**طريقة التنفيذ:**
في `AuthService.register()`، إذا كان `role === VENDOR`:
```typescript
if (dto.role === UserRole.VENDOR) {
  return await this.prisma.user.create({
    data: {
      ...userData,
      role: UserRole.VENDOR,
      vendorProfile: {
        create: {
          businessName: dto.businessName,
          categoryId: dto.categoryId,
          address: dto.address,
          // ... other fields
          status: VendorStatus.PENDING,
        },
      },
    },
    include: { vendorProfile: true },
  });
}
```
**✅ تم عندما:** Vendor جديد يسجل → `status: PENDING` → لا يمكنه login حتى يوافق Admin

---

### 1.7 Password Reset (OTP / Link)
**الهدف:** استعادة كلمة المرور بأمان
**طريقة التنفيذ:**
أنشئ `apps/api/src/modules/auth/dto/reset-password.dto.ts`:
```typescript
// ResetPassword Module (مبسّط — بدون email، token-based)
// 1. POST /auth/forgot-password { email } → ينشئ token صالح 15min + يرجع token (dev mode)
//    (في production يرسل عبر email)
// 2. POST /auth/reset-password { token, newPassword } → يتحقق + يحدّث password

// أضف table في Prisma:
model PasswordReset {
  id        String   @id @default(cuid())
  email     String
  token     String   @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime @default(now())

  @@index([email])
}
```
**✅ تم عندما:** `POST /auth/forgot-password` يرجع token و `POST /auth/reset-password` يغيّر كلمة المرور

---

### 1.8 Google OAuth 2.0
**الهدف:** تسجيل دخول سريع
**طريقة التنفيذ:**
```bash
npm install passport passport-google-oauth20
```
```typescript
// google.strategy.ts
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor() {
    super({
      clientID: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      callbackURL: '/api/v1/auth/google/callback',
      scope: ['email', 'profile'],
    });
  }
  async validate(accessToken, refreshToken, profile, done) {
    const { emails, displayName } = profile;
    // 1. ابحث عن User بـ googleId أو email
    // 2. إن لم يوجد → أنشئه (role: CUSTOMER افتراضياً)
    // 3. أصدِر JWT tokens
    done(null, user);
  }
}
```
**✅ تم عندما:** `GET /api/v1/auth/google` يعيد توجيه إلى Google login page

---

### 1.9 Auth Unit Tests
**الهدف:** ≥70% coverage على Auth module
**طريقة التنفيذ:**
```bash
npx jest --config apps/api/jest.config.js auth
```
أنشئ `apps/api/test/auth.int-spec.ts`:
```typescript
describe('Auth Integration', () => {
  it('should register a new customer', async () => {});
  it('should login and return tokens', async () => {});
  it('should refresh token', async () => {
    // login → wait → refresh → new access token
  });
  it('should reject duplicate email', async () => {});
  it('should lock account after 5 failed attempts', async () => {});
  curl 'id' // IDOR test
  it('should reject role escalation (customer → admin)', async () => {});
  it('should logout (revoke refresh token)', async () => {});
});
```
**✅ تم عندما:** `npm test -- auth` يمر بنجاح و coverage ≥70%

---

### 1.10 Next.js: Register + Login + Forgot Password
**الهدف:** صفحات مصادقة كاملة بالعربية
**طريقة التنفيذ:**
أنشئ `apps/web/src/app/(auth)/login/page.tsx`:
```tsx
'use client';
import { useState } from 'react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  // POST to /api/v1/auth/login
  // خزّن access token في memory، refresh token في httpOnly cookie (يضعه server)
  // redirect based on role:
  //   CUSTOMER → /
  //   VENDOR → /dashboard
  //   ADMIN → /admin
}
```
أنشئ `apps/web/src/app/(auth)/register/page.tsx`, `forgot-password/page.tsx`.
أضف RTL support: `<html lang="ar" dir="rtl">` في root layout.
**✅ تم عندما:** مسجل دخول بنجاح + يتحول لصفحة حسب الدور + واجهة عربية RTL

---

### 1.11 Next.js: Protected Routes (Middleware)
**الهدف:** منع الوصول بدون تسجيل دخول
**τريقة التنفيذ:**
أنشئ `apps/web/middleware.ts`:
```typescript
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value;
  const path = request.nextUrl.pathname;
  const protectedPaths = ['/dashboard', '/admin', '/bookings', '/profile'];
  const isProtected = protectedPaths.some(p => path.startsWith(p));

  if (isProtected && !token) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  // Role-based redirect
  if (token && (path === '/login' || path === '/register')) {
    return NextResponse.redirect(new URL('/', request.url));
  }
}
export const config = {
  matcher: ['/dashboard/:path*', '/admin/:path*', '/bookings/:path*', '/profile/:path*', '/login', '/register'],
};
```
**✅ تم عندما:** زيارة `/dashboard` بدون login → redirect لـ `/login`

---

## Phase 2 — لوحة Vendor + الخدمات (1.5 أسبوع)

### 2.1 VendorProfile Module
**الهدف:** ملف بائع كامل (اسم تجاري، فئة، عنوان، إحداثيات)
**طريقة التنفيذ:**
```bash
npx nest g module vendors
npx nest g controller vendors
npx nest g service vendors
```
Endpoints:
```typescript
@Get('vendors') // public — list approved vendors
@Get('vendors/:id') // public — vendor profile
@Post('vendors') // @Roles(VENDOR) — create own profile
@Patch('vendors/:id') // @Roles(VENDOR) — update own profile only
```
**✅ تم عندما:** Vendor يسجل → ينشئ profile → يظهر في public listing بعد الموافقة

---

### 2.2 Service Module (CRUD)
**الهدف:** إدارة خدمات البائع
**طريقة التنفيذ:**
```typescript
@Post('services')
@Roles(UserRole.VENDOR)
async createService(@Body() dto: CreateServiceDto, @CurrentUser() user) {
  // تحقق: user.vendorProfile exists + status === APPROVED
  return this.prisma.service.create({
    data: { ...dto, vendorId: user.vendorProfile.id },
  });
}

@Get('services')
@Roles(UserRole.VENDOR)
async listMyServices(@CurrentUser() user) {
  return this.prisma.service.findMany({
    where: { vendorId: user.vendorProfile.id },
    orderBy: { createdAt: 'desc' },
  });
}

@Patch('services/:id')
@Roles(UserRole.VENDOR)
async updateService(@Param('id') id: string, @Body() dto: UpdateServiceDto, @CurrentUser() user) {
  // IDOR protection: تحقق أن الخدمة تخص هذا الـ vendor فقط
  const service = await this.prisma.service.findUnique({ where: { id } });
  if (!service || service.vendorId !== user.vendorProfile.id) {
    throw new NotFoundException;
  }
  return this.prisma.service.update({ where: { id }, data: dto });
}
```
**✅ تم عندما:** Vendor يضيف/يعدّل/يحذف خدماته، ولا يمكنه التعديل على خدمات vendor آخر

---

### 2.3 Category Module
**الهدف:** فئات الخدمات (يديرها Admin)
**طريقة التنفيذ:**
```typescript
@Controller('categories')
export class CategoriesController {
  @Get() // public
  findAll() { return this.prisma.category.findMany(); }

  @Post() @Roles(UserRole.ADMIN)
  create(@Body() dto: CreateCategoryDto) { return this.prisma.category.create({ data: dto }); }
}
```
**✅ ف** Vendor يرى الفئات المتاحة في dropdown عند إنشاء خدمة

---

### 2.4 Availability Module (Recurring + Exceptions)
**الهدف:** جدول أسبوعي متكرر + استثناءات (إجازات)
**طريقة التنفيذ:**
```typescript
// 1. Vendor يحدد أوقات عمله الأسبوعية:
// POST /api/v1/vendors/me/availability
// { schedule: [{ dayOfWeek: 0, startTime: "09:00", endTime: "17:00" }, ...] }

// 2. Vendor يضيف استثناءات:
// POST /api/v1/vendors/me/availability/exceptions
// { date: "2026-07-15", isWorkingDay: false } // عطلة
```
**✅ تم عندما:** Vendor يحدد أيام عمله، والـ availability يحسب slots متاحة

---

### 2.5 Image Upload (Cloudinary)
**الpreset:** رفع صور الخدمات والبائعين
**طريقة التنفيذ:**
```bash
npm install cloudinary multer @nestjs/platform-express multer-storage-cloudinary
```
```typescript
// image-upload.service.ts
@Injectable()
export class ImageUploadService {
  async uploadServiceImage(file: Express.Multer.File, serviceId: string): Promise<string> {
    const result = await this.cloudinary.uploader.upload(file.path, {
      folder: `servicehub/services/${serviceId}`,
    });
    return result.secure_url;
  }
}
```
**✅ تم عندما:** Vendor يرفع صورة خدمة → تظهر في صفحته العامة

---

### 2.6-2.9 Next.js: Vendor Dashboard
**الهدف:** لوحة تحكم كاملة للبائع
**طريقة التنفيذ:**
أنشئ الصفحات التالية في `apps/web/src/app/dashboard/`:
```bash
mkdir -p apps/web/src/app/dashboard/{services,availability,bookings,stats}
```
- `dashboard/page.tsx` — Overview stats (revenue, bookings count, rating)
- `dashboard/services/page.tsx` — Services table + Create/Edit modal
- `dashboard/services/new/page.tsx` — Create service form
- `dashboard/availability/page.tsx` — Weekly schedule editor
- `dashboard/bookings/page.tsx` — Bookings list + calendar
- `dashboard/stats/page.tsx` — Revenue charts (Recharts)
Layout:
```tsx
// apps/web/src/app/dashboard/layout.tsx
export default function DashboardLayout({ children }) {
  return (
    <div className="flex min-h-screen">
      <VendorSidebar /> {/* Links: Overview, Services, Availability, Bookings, Stats */}
      <main className="flex-1 p-8">{children}</main>
    </dashboard-layout>
  );
}
```
**✅ تم عندما:** Vendor يسجل دخول → يرى dashboard كامل → يدير خدماته ووقته

---

## Phase 3 — محرك الحجز (2 أسبوع) 🔴 حرج

### 3.1 Booking Module
**الهدف:** إنشاء حجز جديد
**طريقة التنفيذ:**
```bash
npx nest g module bookings
npx nيرجب ان g controller bookings
npx nest g service bookings
```
```typescript
@Post('bookings')
@UseGuards(JwtAuthGuard)
async createBooking(@Body() dto: CreateBookingDto, @CurrentUser() user) {
  return this.bookingsService.createBooking(dto, user.id);
}
```

---

### 3.2 DB Constraint لمنع التعارض (CRITICAL)
**الهدف:** منع حجزين لنفس البائع في نفس الوقت على مستوى قاعدة البيانات
**طريقة التنفيذ:**
أنشئ migration جديد:
```bash
cd apps/api
npx prisma migrate dev --name add_booking_exclude_constraint
```
```sql
-- في ملف الـ migration SQL:
-- 1. أضف عمود tstzrange لتمثيل النطاق الزمني
ALTER TABLE "Booking" ADD COLUMN IF NOT EXISTS time_range tstzrange;

-- 2. حدّث السجلات الموجودة
UPDATE "Booking" SET time_range = tstzrange("startTime", "endTime", '[)');

-- 3. أنشئ الـ constraint
CREATE UNIQUE INDEX IF NOT EXISTS booking_no_overlap_idx ON "Booking"
USING gist (vendorId, time_range);

-- 4. أضف trigger لتعبئة time_range تلقائياً
CREATE OR REPLACE FUNCTION set_booking_time_range()
RETURNS TRIGGER AS $$
BEGIN
  NEW.time_range = tstzrange(NEW."startTime", NEW."endTime", '[)');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER booking_time_range_trigger
BEFORE INSERT OR UPDATE ON "Booking"
FOR EACH ROW EXECUTE FUNCTION set_booking_time_range();
```
**✅ تم عندما:** محاولة إنشاء حجزين متعارضين → قاعدة البيانات ترفض بـ `ExclusionViolation`

---

### 3.3 Booking Hold (5-min lock)
**الهدف:** قفل الوقت أثناء الدفع
**طريقة التنفيذ:**
```typescript
async createBooking(dto: CreateBookingDto, customerId: string) {
  return await this.prisma.$transaction(async (tx) => {
    // 1. تحقق من توفر الوقت
    const conflict = await tx.$queryRaw`
      SELECT 1 FROM "Booking"
      WHERE "vendorId" = ${dto.vendorId}
        AND "status" NOT IN ('CANCELLED', 'NO_SHOW')
        AND time_range && tstzrange(${dto.startTime}, ${dto.endTime}, '[)')
      LIMIT 1
    `;
    if (conflict.length > 0) throw new ConflictException('Time slot not available');

    // 2. أنشئ حجز مؤقت
    const commissionRate = 0.10; // 10% default
    const price = Number(service.price);
    const commission = price * commissionRate;
    const booking = await tx.booking.create({
      data: {
        customerId,
        vendorId: dto.vendorId,
        serviceId: dto.serviceId,
        startTime: dto.startTime,
        endTime: dto.endTime,
        status: BookingStatus.PENDING_PAYMENT,
        priceAtBooking: price,
        commissionAmount: commission,
        holdExpiresAt: new Date(Date.now() + 5 * 60 * 1000), // 5 دقائق
      },
    });
    return booking;
  });
}
```
**✅ تم عندما:** حجز `PENDING_PAYMENT` لا يمكن حجزه من عميل آخر لنفس الوقت

---

### 3.4 GET Available Slots
**الهدف:** عرض الأوقات المتاحة فقط
**طريقة التنفيذ: expired holds

    return slots;
  }
```
**✅ تم عندما:** Customer يفتح صفحة Vendor → يرى فقط الأوقات المتاحة

---

### 3.5 Cancel Booking
**ال-goal:** إلغاء حجز بسياسة محددة
**طريقة التنفيذ:**
```typescript
@Patch('bookings/:id/cancel')
async cancelBooking(@Param('id') id: string, @Body() dto: CancelBookingDto, @CurrentUser() user) {
  const booking = await this.prisma.booking.findUnique({ where: { id }, include: { payment: true } });

  // Policy: Customer can cancel up to 24h before
  if (user.id === booking.customerId) {
    const hoursUntilBooking = (booking.startTime.getTime() - Date.now()) / 3600000;
    if (hoursUntilBooking < 24) throw new BadRequestException('Cancellation period expired');
  }
  // Vendor / Admin can cancel anytime
  // Process refund if payment succeeded
  if (booking.payment?.status === 'SUCCEEDED') {
    await this.stripe.refunds.create({ payment_intent: booking.payment.stripePaymentIntentId });
  }
  return this.prisma.booking.update({
    where: { id },
    data: { status: BookingStatus.CANCELLED, cancellationReason: dto.reason, cancelledBy: user.id },
  });
}
```
**✅ تم عندما:** Customer يلغي قبل 24h → حجز يُلغى + refund

---

### 3.6-3.10 Booking Tests + Next.js Pages
**الهدف:** اختبارات شاملة + واجهة حجز كاملة
**طريقة التنفيذ:**
اختبارات (الحرج: **تعارض متزامن**):
```typescript
// booking.conflict.int-spec.ts
it('should NOT allow double booking (race condition test)', async () => {
  // أنشئ حجزين متوازيين لنفس الوقت
  const [result1, result2] = await Promise.allSettled([
    app.inject({ method: 'POST', url: '/api/v1/bookings', payload: bookingDto, headers: auth1 }),
    app.inject({ method: 'POST', url: '/  bookings', payload: bookingDto, headers: auth2 }),
  ]);
  expect(result1.status).toBe('fulfilled'); // success
  expect(result2.status).toBe('rejected'); // conflict!
});
```
Next.js pages:
- `apps/web/src/app/vendors/[id]/book/page.tsx` — Slot picker + booking form
- `apps/web/src/app/bookings/page.tsx` — Customer bookings history
- `apps/web/src/app/dashboard/bookings/page.tsx` — Vendor bookings calendar
**✅ تم عندما:** اختبار التعارض المتزامن يفشل للحجز الثاني بنجاح

---

## Phase 4 — المدفوعات والعمولات (1.5 أسبوع)

### 4.1-4.3 Stripe Integration (Payment Intent + Webhook)
**الهدف:** دفع حقيقي (Test Mode) + تأكيد عبر webhook فقط
**طريقة التنفيذ:**
```bash
npm install stripe
npx nest g module payments
npx nest g controller payments
npx nest g service payments
```
```typescript
// 4.1: Payment Intent
async createPaymentIntent(bookingId: string) {
  const booking = await this.prisma.booking.findUnique({
    where: { id: bookingId },
    include: { vendor: true },
  });
  const intent = await this.stripe.paymentIntents.create({
    amount: Math.round(Number(booking.priceAtBooking) * 100), // cents
    currency: 'brl',
    metadata: { bookingId: booking.id, vendorId: booking.vendorId },
  });
  await this.prisma.payment.create({
    data: {
      bookingId,
      stripePaymentIntentId: intent.id,
      amount: booking.priceAtBooking,
      status: 'PENDING',
    },
  });
  return { clientSecret: intent.client_secret };
}

// 4.2: Webhook (CRITICAL — no frontend trust)
@Post('webhook')
async handleWebhook(@Req() request: RawBodyRequest<Request>) {
  const sig = request.headers['stripe-signature'];
  const event = this.stripe.webhooks.constructEvent(
    request.rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET
  );
  switch (event.type) {
    case 'payment_intent.succeeded':
      await this.confirmBooking(event.data.object.metadata.bookingId);
      break;
    case 'payment_intent.payment_failed':
      await this.failBooking(event.data.object.metadata.bookingServiceId);
      // also release the hold
      break;
  }
  return { received: true };
}

// 4.3: Confirm booking only after webhook
private async confirmBooking(bookingId: string) {
  await this.prisma.$transaction(async (tx) => {
    await tx.booking.update({
      where: { id: webhookBookingId },
      data: { status: BookingStatus.CONFIRMED, holdExpiresAt: null },
    });
    await tx.payment.update({
      where: { bookingId },
      data: { status: 'SUCCEEDED' },
    });
  });
}
```
**✅ tupian تم عندما:** Stripe webhook يؤكد الحجز → status: CONFIRMED
**⚠️ مهم:** الـ webhook يحتاج raw body. إعداد خاص في NestJS:
```typescript
// main.ts — ضروري لـ Stripe webhook
const app = await NestFactory.create(AppModule, {
  bodyParser: false,
});
const express = require('express');
app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf; } }));
```
**⚠️ Stripe CLI:** لاختبار webhooks محلياً:
```bash
stripe listen --forward-to localhost:3001/api/v1/payments/webhook
```

---

### 4.4 Commission Calculation
**الهدف:** اقتطاع 10% عمولة المنصة تلقائياً
**طريقة التنفيذ:**
```typescript
// تم حسابها مسبقاً في createBooking() — commissionAmount
// عند refund، احسب العمولة بنفس النسبة:
async refundBooking(bookingId: string, amount?: number) {
  const booking = await this.prisma booking.findUnique({ where: { id: bookingId }, include: { payment: true } });
  const refund = await this.stripe.refunds.create({
    payment_intent: booking.payment.stripePaymentIntentId,
    amount: amount ? Math.round(amount * 100) : undefined,
  });
  await this.prisma.payment.update({
    where: { bookingId },
    data: {
      refundedAmount: amount ? (booking.payment.refundedAmount + amount) : booking.payment.amount,
      status: amount && amount < Number(booking.payment.amount) ? 'PARTIALLY_REFUNDED' : 'REFUNDED',
    },
  });
}
```
**✅ تم عندما:** كل معاملة تسجل commissionAmount و vendor receives (price - commission)

---

### 4.5-4.10 Refund + Next.js Payment UI
**الهدف:** استرداد + واجهة دفع 3 خطوات
**طريقة التنفيذ:**
Next.js Payment Page (3 خطوات):
```tsx
// apps/web/src/app/book/[vendorId]/[serviceId]/page.tsx
// Step 1: Choose date & time → GET /api/v1/vendors/:id/availability?date=
// Step 2: Confirm details → POST /api/v1/bookings
// Step 3: Pay → Stripe Elements (React Stripe.js)
//   import { Elements } from '@stripe/react-stripe-js';
//   import { loadStripe } from '@stripe/stripe-js';
//   const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_KEY);
//   <Elements stripe={stripePromise}>
//     <PaymentForm clientSecret={clientSecret} />
//   </Elements>
```
**✅ تم عندما:** Customer يختار خدمة → وقت → يدفع → يتأكد الحجز

---

## Phase 5 — البحث والتقييمات (1.5 أسبوع)

### 5.1-5.3 Search + Filter + Sort
**الهدف:** بحث كامل (نصي، فئة، سعر، تقييم، موقع)
**طريقة التنفيذ:**
```typescript
@Get('vendors')
async searchVendors(
  @Query('q') q?: string,
  @Query('category') category?: string,
  @Post('vendors/search') @...
  @Query('minPrice') minPrice?: number,
  @Query('maxPrice') maxPrice?: number,
  @Query('minRating') minRating?: number,
  @Query('lat') lat?: number,
  @Query('lng') lng?: number,
  @Query('radius') radius?: number, // km
  @Query('sort') sort?: 'nearest' | 'rating' | 'price_low' | 'price_high' | 'newest',
) {
  const where = {
    status: 'APPROVED',
    ...(category && { categoryId: category }),
    ...(minRating && { avgRating: { gte: minRating } }),
    services: minPrice || maxPrice ? {
      some: { price: { gte: minPrice ?? 0, lte: maxPrice ?? 999999 } }
    } : undefined,
    // Full-text search على businessName + description
    ...(q && {
      OR: [
        { businessName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ]
    }),
  };
  // Geo filtering: باستخدام PostgreSQL earthdist أو حساب يدوي (haversine)
  // Sort logic
  return this.prisma.vendorProfile.findMany({ where, include: { services: true } });
}
```
**✅ تم عندما:** البحث بـ "صالون" + فلترة "تقييم ≥4" + ترتيب "الأقل سعراً" يعمل

---

### 5.5-5.7 Review Module
**الهدف:** تقييمات حقيقية فقط (بعد حجز مكتمل)
**طريقة التنفيذ:**
```typescript
@Post('reviews')
@UseGuards(JwtAuthGuard)
async createReview(@Body() dto: CreateReviewDto, @CurrentUser() user) {
  const booking = await this.prisma.booking.findFirst({
    where: { id: dto.bookingId, customerId: user.id, status: 'COMPLETED' },
  });
  if (!booking) throw new BadRequestException('You can only review completed bookings');
  // Unique constraint: bookingId @unique في الـ schema → مراجعة واحدة فقط
  const review = await this.prisma.review.create({
    data: { ...dto, userId: user.id },
  });
  // Update vendor avgRating
  await this.updateVendorRating(booking.vendorId);
  return review;
}

private async updateVendorRating(vendorId: string) {
  const avg = await this.prisma.review.aggregate({
    _avg: { rating: true },
    where: { booking: { vendorId } },
  });
  await this.prisma.vendorProfile.update({
    where: { id: vendorId },
    data: { avgRating: avg._avg.rating ?? 0 },
  });
}
```
**✅ تم عندما:** عميل يقيّم حجز مكتمل → تقييمه يسجل + متوسط تقييم البائع يتحدّث

---

## Phase 6 — الرسائل والإشعارات اللحظية (1 أسبوع)

### 6.1-6.2 WebSocket + Notifications
**الهدف:** إشعارات لحظية عند تأكيد/إلغاء حجز
**طريقة التنفيذ:**
```bash
npm install @nestjs/websockets @nestjs/platform-socket.io socket.io
npx nest g gateway notifications
```
```typescript
@WebSocketGateway({ cors: true })
export class NotificationsGateway {
  @WebSocketServer() server: Server;

  async sendNotification(userId: string, type: string, payload: any) {
    const notification = await this.prisma.notification.create({
      data: { userId, type, payload },
    });
    this.server.to(userId).emit('notification', notification);
  }

  @SubscribeMessage('join')
  handleJoin(@MessageBody() userId: string, @ConnectedSocket() client: Socket) {
    client.join(userId);
  }
}
```
```typescript
// في BookingService — عند تأكيد حجز:
this.notificationsGateway.sendNotification(booking.vendorId, 'BOOKING_CONFIRMED', {
  bookingId, customerName, serviceName, startTime,
});
```
**✅ تم عندما:** Vendor يرى إشعار لحظي في المتصفح عند حجز جديد

---

### 6.3 Message Module (Booking-linked chat)
**الهدف:** محادثة بين Customer و Vendor مرتبطة بـ booking
**طريقة التنفيذ:**
```typescript
@Post('messages')
@UseGuards(JwtAuthGuard)
async sendMessage(@Body() dto: SendMessageDto, @CurrentUser() user) {
  // تحقق: sender هو customer أو vendor في هذا الحجز
  const booking = await this.prisma.booking.findUnique({
    where: { id: dto.bookingId },
  });
  if (user.id !== booking.customerId && user.id !== booking.vendorId) {
    throw new ForbiddenException('Not part of this booking');
  }
  const message = await this.prisma.message.create({
    data: { ...dto, senderId: user.id },
  });
  // Real-time via WebSocket
  const recipientId = user.id === booking.customerId ? booking.vendorId : booking.customerId;
  this.server.to(recipientId).emit('message', message);
  return message;
}
```
**铃✅ تم عندما:** Customer يرسل رسالة → Vendor يراها لحظياً في المتصفح

---

## Phase 7 — لوحة Admin (1 أسبوع)

### 7.1-7.10 Admin Module
**الهدف:** لوحة تحكم كاملة للمدير
**طريقة التنفيذ:**
```bash
npx nest g module admin
npx nest g controller admin
npx nest g service admin
```
Endpoints:
```typescript
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  @Get('vendors/pending') // قائمة بانتظار الموافقة
  @Patch('vendors/:id/approve') // الموافقة على vendor
  @Patch('vendors/:id/suspend') // إيقاف vendor
  @Get('reports/revenue') // تقرير مالي شامل
  @Get('disputes') // قائمة النزاعات
  @Patch('disputes/:id/resolve') // حل نزاع (refund/partial/reject)
  @Get('categories') @Post('categories') @Patch('categories/:id') // فئات
  @Patch('settings/commission') // تعديل نسبة العمولة
}
```
Next.js Admin pages:
- `apps/web/src/app/admin/page.tsx` — Overview stats (KPIs + charts)
- `apps/web/src/app/admin/vendors/page.tsx` — Vendor approval/rejection
- `aps/web/src/app/admin/reports/page.tsx` — Financial reports + charts
- `apps/web/src/app/admin/disputes/page.tsx` -- Dispute resolution
- `apps/web/src/app/admin/settings/page.tsx` — Commission rate + categories
**✅ تم عندما:** Admin يسجل دخول → يرى كل التقارير → يوافق على vendor → يحل نزاع

---

## Phase  ServiceHub مشاريع نهائية

### 8.1-8.2 Tests (≥70% coverage)
**الهدف:** اختبارات شاملة على Auth + Booking + Payments
**طريقة التنفيذ:**
```bash
npm install -D jest @types/jest supertest ts-jest
```
أنشئ `apps/api/jest.config.js`:
```javascript
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testRegex: '.*\\.int-spec\\.ts$',
  coverageDirectory: 'coverage',
  coverageThreshold: {
    global: { branches: 70, functions: 70, lines: 70, statements: 70 },
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/main.ts',
    '!src/**/*.module.ts',
    '!src/**/*.dto.ts',
  ],
  setupFilesAfterEach: ['<rootDir>/test/setup.ts'],
};
```
**✅ تم عندما:** `npm test -- --coverage` يمر بنجاح و coverage ≥70%

---

### 8.3-8.4 i18n (AR + EN)
**الهدف:** واجهة ثنائية اللغة (RTL/LTR)
**طريقة التنفيذ:**
```bash
npm install next-intl  # أو react-i18next
```
أنشئ `apps/web/messages/ar.json` و `apps/web/messages/en.json`.
أضف language switcher في navbar.
RTL: `<html lang="ar" dir="rtl">` / LTR: `<html lang="en" dir="ltr">`.
**✅ تم عندما:** تبديل اللغة يعكس تخطيط الواجهة بالكامل

---

### 8.5 Swagger/OpenAPI
**الgoal:** API موثق وقابل للتجربة
**طريقة التنفيذ:**
```typescript
// main.ts
const config = new DocumentBuilder()
  .setTitle('ServiceHub API')
  .setDescription('Multi-Vendor Booking Marketplace API')
  .setVersion('1.0')
  .addBearerAuth()
  .build();
const document = SwaggerModule.createDocument(app, config);
SwaggerModule.setup('api/docs', app, document);
```
أضف `@ApiTags`, `@ApiOperation`, `@ApiResponse` على كل controller.
**✅ تم عندما:** `http://localhost:3001/api/docs` يعرض Swagger UI تفاعلي

---

###  PLAYBOOK COMPLETE 🎉
```
> **Total tasks:** 87
> **Estimated time:** 10-12 weeks (3h/day)
> **Repository:** `/home/server/projects/servicehub`
> **Plan:** `PLAN.md` (this file)
> **PRD:** `docs/PRD.doc الأكثر أهمية في المشروع.
