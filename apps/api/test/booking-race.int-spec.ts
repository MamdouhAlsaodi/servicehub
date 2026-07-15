/**
 * Phase 3 — Concurrent-create race regression (B4).
 *
 * The Postgres EXCLUDE constraint `booking_no_overlap` on
 * "Booking"("vendorId", "time_range") is the source of truth for
 * slot uniqueness. The best-effort pre-check in
 * BookingsService.createBooking helps normal traffic return clean
 * 409s, but it is NOT a guarantee — a burst of truly concurrent
 * requests can all slip past the pre-check before any insert lands,
 * so only the EXCLUDE constraint can serialise them.
 *
 * This isolated integration test proves the safety net end-to-end:
 *   - 10 different customers race to book the same slot.
 *   - Exactly 1 must succeed.
 *   - Exactly 9 must reject with ConflictException.
 *   - Exactly 1 booking row must exist for that (vendor, slot).
 *
 * Test isolation:
 *   - Uses the existing getTestPrisma / cleanDatabase /
 *     disconnectPrisma lifecycle so it shares the singleton with
 *     other specs.
 *   - The test DB is enforced by setup-env.ts loading .env.test
 *     and by the runtime guard inside prisma-test-db.ts.
 *   - truncateAll() runs in beforeEach AND afterAll to leave the
 *     DB clean for downstream specs — no leak between files.
 *
 * File-naming note: the `.int-spec.ts` suffix marks this as an
 * integration test. Jest's standard `*.spec.ts` regex does not
 * match it; Yui invokes it explicitly by path (or it is wired up
 * via a separate integration runner) per the B4 packet convention.
 */
import { Test } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import {
  BookingStatus,
  type Booking,
  UserRole,
  VendorStatus,
} from '@prisma/client';
import { BookingsService } from '../src/modules/bookings/bookings.service';
import { PrismaService } from '../src/shared/modules/prisma/prisma.service';
import {
  cleanDatabase,
  disconnectPrisma,
  prisma,
} from '../src/test/setup';

describe('BookingsService — concurrent createBooking race (B4)', () => {
  let service: BookingsService;
  let vendorId: string;
  let serviceId: string;
  let customerIds: string[] = [];

  beforeEach(async () => {
    await cleanDatabase();

    const moduleRef = await Test.createTestingModule({
      providers: [
        BookingsService,
        // Same prisma singleton the legacy spec files use. The
        // testing module reuses it so Nest's @Injectable metadata
        // resolves to a connected, in-test-DB PrismaService.
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = moduleRef.get<BookingsService>(BookingsService);

    /* Seed all fixtures inside the test DB. FK chain satisfied:
     *   category -> vendorProfile -> service
     *   10 distinct customer users (no other FK dependents). */
    const category = await prisma.category.create({
      data: { nameAr: 'سباق', nameEn: 'Race Category B4' },
    });

    const vendorUser = await prisma.user.create({
      data: {
        name: 'Race Vendor B4',
        email: `race-vendor-b4-${Date.now()}@race.test`,
        role: UserRole.VENDOR,
      },
    });
    const vendor = await prisma.vendorProfile.create({
      data: {
        userId: vendorUser.id,
        businessName: 'Race Bistro B4',
        categoryId: category.id,
        status: VendorStatus.APPROVED,
        timezone: 'UTC',
      },
    });
    vendorId = vendor.id;

    const svc = await prisma.service.create({
      data: {
        vendorId: vendor.id,
        title: 'Race Slot B4',
        price: '100.00',
        durationMinutes: 60,
        categoryId: category.id,
      },
    });
    serviceId = svc.id;

    customerIds = [];
    for (let i = 0; i < 10; i++) {
      const c = await prisma.user.create({
        data: {
          name: `Racer B4 ${i + 1}`,
          email: `race-cust-b4-${Date.now()}-${i}@race.test`,
          role: UserRole.CUSTOMER,
        },
      });
      customerIds.push(c.id);
    }
  });

  afterAll(async () => {
    /* Idempotent cleanup so the next spec starts from a known-empty
     * DB even if this test body threw mid-flight. */
    await cleanDatabase();
    await disconnectPrisma();
  });

  it('(B4.RACE.1) ten concurrent createBooking attempts for the same slot yield exactly one success and nine ConflictException', async () => {
    /* One future ISO slot, anchored 14 days out at 12:00:00.000Z so:
     *   - it survives the createBooking "must be in the future"
     *     guard (no BadRequestException),
     *   - the (vendor, service, startTime) equality used in the
     *     count assertion aligns with how Prisma serialises Dates
     *     into Postgres timestamptz (millisecond-precise). */
    const future = new Date(Date.now() + 14 * 24 * 60 * 60_000);
    future.setUTCMinutes(0, 0, 0);
    future.setUTCSeconds(0, 0);
    future.setUTCMilliseconds(0);
    future.setUTCHours(12, 0, 0, 0);
    const startTimeIso = future.toISOString();

    const dto = { serviceId, startTime: startTimeIso };

    /* Fire all 10 simultaneously so the pre-check + EXCLUDE race
     * actually exercises the safety net. Promise.allSettled waits
     * for every attempt to settle — fulfilled OR rejected. We do
     * NOT mock Prisma or the conflict constraint: this is the real
     * BookingsService against the real Postgres DB. */
    const attempts = customerIds.map((customerId) =>
      service.createBooking(dto, customerId),
    );
    const results: PromiseSettledResult<Booking>[] = await Promise.allSettled(
      attempts,
    );

    const fulfilled: PromiseFulfilledResult<Booking>[] = results.filter(
      (r): r is PromiseFulfilledResult<Booking> => r.status === 'fulfilled',
    );
    const rejected: PromiseRejectedResult[] = results.filter(
      (r): r is PromiseRejectedResult => r.status === 'rejected',
    );

    /* Exactly one survivor. */
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(9);

    /* Every rejection must be ConflictException — proves the
     * service correctly translates the EXCLUDE violation (and
     * the pre-check winner where applicable) to a clean
     * 409-equivalent. No raw Prisma error leaks to callers. */
    for (const r of rejected) {
      expect(r.reason).toBeInstanceOf(ConflictException);
    }

    /* DB-level proof: the EXCLUDE constraint enforced what the
     * service promised. Exactly one row for the
     * (vendor, service, startTime) triplet — no phantom siblings
     * left behind by the 9 racing losers. */
    const persisted = await prisma.booking.count({
      where: { vendorId, serviceId, startTime: future },
    });
    expect(persisted).toBe(1);

    /* The winning booking is the one we just created:
     *   - PENDING_PAYMENT is the createBooking steady state,
     *   - customerId belongs to one of the 10 seeded customers
     *     (no stale row from a previous run leaking through). */
    const winner = fulfilled[0];
    if (!winner) {
      throw new Error(
        'precondition violated: fulfilled[0] must exist after toHaveLength(1)',
      );
    }
    expect(winner.value.status).toBe(BookingStatus.PENDING_PAYMENT);
    expect(customerIds).toContain(winner.value.customerId);
  });
});
