/**
 * B6 Task 14 — Messages service tests.
 *
 * servicehub_test conventions: real test DB, Prisma singleton,
 * `cleanDatabase()` per beforeEach, class-token DI override for
 * PrismaService. Bookings get unique 60-min slot indices so the
 * EXCLUDE constraint cannot reject fixtures.
 *
 * Coverage: send (customer/vendor happy paths; outsider / foreign
 * vendor / admin forbidden; trim+empty; length cap; control-char
 * sanitation allow \t\n reject \r / DEL / NUL; senderId always the
 * authenticated actor). list (oldest→newest + cursor walk; default
 * + max limits; bogus cursor → 400; admin read does NOT stamp
 * readAt; participant read stamps only the *other* side; outsider →
 * 403).
 */
import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { BookingStatus, UserRole, VendorStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { MessagesService } from './messages.service';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { prisma, cleanDatabase, disconnectPrisma } from '../../test/setup';
import {
  MESSAGE_LIST_DEFAULT_LIMIT,
  MESSAGE_LIST_MAX_LIMIT,
} from './dto/list-messages.dto';

describe('MessagesService', () => {
  let service: MessagesService;

  let customerUserId: string;
  let otherCustomerUserId: string;
  let vendorUserId: string;
  let otherVendorUserId: string;
  let adminUserId: string;
  let vendorId: string;
  let serviceId: string;

  /* Each fixture booking lands on a unique 60-min slot so the
   * EXCLUDE constraint never rejects fixture inserts. */
  let slotCounter = 0;
  async function makeBooking(): Promise<string> {
    const future = new Date(Date.now() + (48 + slotCounter) * 60 * 60_000);
    future.setMinutes(0, 0, 0);
    slotCounter += 1;
    return (
      await prisma.booking.create({
        data: {
          customerId: customerUserId, vendorId, serviceId,
          startTime: future,
          endTime: new Date(future.getTime() + 60 * 60_000),
          status: BookingStatus.CONFIRMED,
          priceAtBooking: '100.00', commissionAmount: '10.00',
        },
      })
    ).id;
  }

  /* Seed an alternating customer/vendor thread. */
  async function seedThread(bookingId: string, n: number): Promise<void> {
    for (let i = 0; i < n; i += 1) {
      await prisma.message.create({
        data: {
          bookingId,
          senderId: i % 2 === 0 ? customerUserId : vendorUserId,
          content: `msg ${i}`,
          createdAt: new Date(Date.now() - (n - i) * 1000),
        },
      });
    }
  }

  beforeEach(async () => {
    await cleanDatabase();

    const module: TestingModule = await Test.createTestingModule({
      providers: [MessagesService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get<MessagesService>(MessagesService);

    const passwordHash = await bcrypt.hash('password123', 4);
    const mkUser = (name: string, email: string, role: UserRole) =>
      prisma.user.create({ data: { name, email, passwordHash, role } });

    customerUserId = (await mkUser('C', 'c@t.test', UserRole.CUSTOMER)).id;
    otherCustomerUserId = (await mkUser('O', 'o@t.test', UserRole.CUSTOMER)).id;
    const vendorUser = await mkUser('V', 'v@t.test', UserRole.VENDOR);
    vendorUserId = vendorUser.id;
    otherVendorUserId = (await mkUser('V2', 'v2@t.test', UserRole.VENDOR)).id;
    adminUserId = (await mkUser('A', 'a@t.test', UserRole.ADMIN)).id;

    const cat = await prisma.category.create({
      data: { nameAr: 'مطاعم', nameEn: 'Restaurants' },
    });
    vendorId = (await prisma.vendorProfile.create({
      data: {
        userId: vendorUser.id, businessName: 'B', categoryId: cat.id,
        status: VendorStatus.APPROVED, timezone: 'UTC',
      },
    })).id;
    await prisma.vendorProfile.create({
      data: {
        userId: otherVendorUserId, businessName: 'B2', categoryId: cat.id,
        status: VendorStatus.APPROVED, timezone: 'UTC',
      },
    });
    serviceId = (await prisma.service.create({
      data: {
        vendorId, title: 'Lunch', price: '100.00', durationMinutes: 60,
        categoryId: cat.id,
      },
    })).id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  /* ═══ SEND ═══ */

  describe('sendMessage', () => {
    it('customer can send on their own booking', async () => {
      const bookingId = await makeBooking();
      const m = await service.sendMessage(
        customerUserId, UserRole.CUSTOMER, bookingId, { content: 'مرحباً' },
      );
      expect(m.bookingId).toBe(bookingId);
      expect(m.senderId).toBe(customerUserId);
      expect(m.content).toBe('مرحباً');
      expect(m.readAt).toBeNull();
    });

    it('owning vendor can send on their booking', async () => {
      const bookingId = await makeBooking();
      const m = await service.sendMessage(
        vendorUserId, UserRole.VENDOR, bookingId, { content: 'hi' },
      );
      expect(m.senderId).toBe(vendorUserId);
      expect(m.content).toBe('hi');
    });

    it('outsider customer is Forbidden (no rows written)', async () => {
      const bookingId = await makeBooking();
      await expect(
        service.sendMessage(otherCustomerUserId, UserRole.CUSTOMER, bookingId, {
          content: 'sneaky',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(await prisma.message.count({ where: { bookingId } })).toBe(0);
    });

    it('a different vendor is Forbidden', async () => {
      const bookingId = await makeBooking();
      await expect(
        service.sendMessage(otherVendorUserId, UserRole.VENDOR, bookingId, {
          content: 'not mine',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('admin cannot send (read-only)', async () => {
      const bookingId = await makeBooking();
      await expect(
        service.sendMessage(adminUserId, UserRole.ADMIN, bookingId, {
          content: 'admin speaks',
        }),
      ).rejects.toThrow(ForbiddenException);
    });

    it('trims and rejects whitespace-only', async () => {
      const bookingId = await makeBooking();
      const m = await service.sendMessage(
        customerUserId, UserRole.CUSTOMER, bookingId,
        { content: '   مرحباً   ' },
      );
      expect(m.content).toBe('مرحباً');
      await expect(
        service.sendMessage(customerUserId, UserRole.CUSTOMER, bookingId, {
          content: '   ',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects content over 1000 chars', async () => {
      const bookingId = await makeBooking();
      await expect(
        service.sendMessage(customerUserId, UserRole.CUSTOMER, bookingId, {
          content: 'a'.repeat(1001),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects control chars except \\t and \\n (NUL, CR, DEL all rejected)', async () => {
      const bookingId = await makeBooking();
      for (const bad of ['before\u0000after', 'crlf\rinjected', 'del\u007Fmid']) {
        await expect(
          service.sendMessage(customerUserId, UserRole.CUSTOMER, bookingId, {
            content: bad,
          }),
        ).rejects.toThrow(BadRequestException);
      }
    });

    it('preserves \\t and \\n unchanged', async () => {
      const bookingId = await makeBooking();
      const m = await service.sendMessage(
        customerUserId, UserRole.CUSTOMER, bookingId,
        { content: 'first\tline\nsecond' },
      );
      expect(m.content).toBe('first\tline\nsecond');
    });

    it('senderId always matches the authenticated actor', async () => {
      const bookingId = await makeBooking();
      const a = await service.sendMessage(
        vendorUserId, UserRole.VENDOR, bookingId, { content: 'v' },
      );
      const b = await service.sendMessage(
        customerUserId, UserRole.CUSTOMER, bookingId, { content: 'c' },
      );
      expect(a.senderId).toBe(vendorUserId);
      expect(b.senderId).toBe(customerUserId);
    });
  });

  /* ═══ LIST ═══ */

  describe('listMessages', () => {
    const orderRows = (bookingId: string) =>
      prisma.message.findMany({
        where: { bookingId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      });

    it('orders oldest→newest and cursor walks pages', async () => {
      const bookingId = await makeBooking();
      await seedThread(bookingId, 7);

      const p1 = await service.listMessages(
        customerUserId, UserRole.CUSTOMER, bookingId, { limit: 3 },
      );
      expect(p1.items.map((m) => m.content)).toEqual(['msg 0', 'msg 1', 'msg 2']);
      expect(p1.nextCursor).toBeTruthy();

      const p2 = await service.listMessages(
        customerUserId, UserRole.CUSTOMER, bookingId,
        { limit: 3, cursor: p1.nextCursor ?? undefined },
      );
      expect(p2.items.map((m) => m.content)).toEqual(['msg 3', 'msg 4', 'msg 5']);

      const p3 = await service.listMessages(
        customerUserId, UserRole.CUSTOMER, bookingId,
        { limit: 3, cursor: p2.nextCursor ?? undefined },
      );
      expect(p3.items.map((m) => m.content)).toEqual(['msg 6']);
      expect(p3.nextCursor).toBeNull();
    });

    it('admin read does NOT mark messages read', async () => {
      const bookingId = await makeBooking();
      await seedThread(bookingId, 3);

      await service.listMessages(adminUserId, UserRole.ADMIN, bookingId, {
        limit: 50,
      });
      const rows = await orderRows(bookingId);
      expect(rows.every((m) => m.readAt === null)).toBe(true);
    });

    it('vendor read stamps customer messages only', async () => {
      const bookingId = await makeBooking();
      /* 0=customer, 1=vendor, 2=customer, 3=vendor. */
      await seedThread(bookingId, 4);

      await service.listMessages(
        vendorUserId, UserRole.VENDOR, bookingId, { limit: 50 },
      );
      const rows = await orderRows(bookingId);
      expect(rows[0].readAt).not.toBeNull(); // vendor stamped customer
      expect(rows[1].readAt).toBeNull();    // vendor own never self-marked
      expect(rows[2].readAt).not.toBeNull();
      expect(rows[3].readAt).toBeNull();
    });

    it('customer read stamps vendor messages only', async () => {
      const bookingId = await makeBooking();
      await seedThread(bookingId, 4);

      await service.listMessages(
        customerUserId, UserRole.CUSTOMER, bookingId, { limit: 50 },
      );
      const rows = await orderRows(bookingId);
      expect(rows[0].readAt).toBeNull();
      expect(rows[1].readAt).not.toBeNull();
      expect(rows[2].readAt).toBeNull();
      expect(rows[3].readAt).not.toBeNull();
    });

    it('caps response at MESSAGE_LIST_MAX_LIMIT', async () => {
      const bookingId = await makeBooking();
      await seedThread(bookingId, MESSAGE_LIST_MAX_LIMIT + 5);
      const page = await service.listMessages(
        customerUserId, UserRole.CUSTOMER, bookingId, { limit: 10_000 },
      );
      expect(page.items).toHaveLength(MESSAGE_LIST_MAX_LIMIT);
      expect(page.nextCursor).toBeTruthy();
    });

    it('uses MESSAGE_LIST_DEFAULT_LIMIT when limit omitted', async () => {
      const bookingId = await makeBooking();
      await seedThread(bookingId, MESSAGE_LIST_DEFAULT_LIMIT + 5);
      const page = await service.listMessages(
        customerUserId, UserRole.CUSTOMER, bookingId,
      );
      expect(page.items).toHaveLength(MESSAGE_LIST_DEFAULT_LIMIT);
      expect(page.nextCursor).toBeTruthy();
    });

    it('malformed cursor → BadRequest', async () => {
      const bookingId = await makeBooking();
      await expect(
        service.listMessages(customerUserId, UserRole.CUSTOMER, bookingId, {
          cursor: 'not-base64-garbage',
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('outsider listing → Forbidden', async () => {
      const bookingId = await makeBooking();
      await expect(
        service.listMessages(otherCustomerUserId, UserRole.CUSTOMER, bookingId, {}),
      ).rejects.toThrow(ForbiddenException);
    });
  });
});
