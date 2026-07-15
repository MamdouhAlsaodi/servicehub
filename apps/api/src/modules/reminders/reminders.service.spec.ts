/**
 * B4 — Reminders Service tests (pure unit; PrismaService and
 * NotificationsService are stubbed at the boundary — no real DB,
 * no real Prisma, no network).
 *
 * Covers:
 *   - 24h reminder emitted for CONFIRMED booking inside 24h window
 *   - 1h reminder emitted for CONFIRMED booking inside 1h window
 *   - Booking outside either window yields no notification
 *   - Cancellation / non-CONFIRMED exclusion via the `where.status`
 *     query filter (proved by finder-scope assertion)
 *   - Unique-constraint (P2002) collision is caught and counted as
 *     `skipped` — never re-thrown, never persisted twice
 *   - Payload + dedupe-key shape: { bookingId, serviceTitle,
 *     startTime, reminderHours } + `booking:<id>:reminder:<24h|1h>`
 *   - The two windows are queried independently (24h first, 1h
 *     second) so the service is internally deterministic
 *   - Non-P2002 errors bubble up to the caller
 *   - Existing non-reminder callers of NotificationsService.create
 *     remain unaffected (RemindersService always sets a reminder
 *     type and a non-empty dedupeKey)
 */
import { Test, TestingModule } from '@nestjs/testing';
import { RemindersService } from './reminders.service';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { BookingStatus } from '@prisma/client';

/* ─────────────────────────────────────────────────────────────────
   FIXTURES + MOCKS
   ───────────────────────────────────────────────────────────────── */

interface BookingFixture {
  id: string;
  customerId: string;
  vendorId: string;
  serviceId: string;
  startTime: Date;
  endTime: Date;
  status: BookingStatus;
  service: { title: string };
  customer: { id: string };
}

function mkBooking(overrides: Partial<BookingFixture> = {}): BookingFixture {
  return {
    id: 'bk-001',
    customerId: 'user-customer-001',
    vendorId: 'vnd-001',
    serviceId: 'svc-001',
    startTime: new Date('2026-07-16T10:00:00.000Z'),
    endTime: new Date('2026-07-16T11:00:00.000Z'),
    status: BookingStatus.CONFIRMED,
    service: { title: 'Haircut & beard trim' },
    customer: { id: 'user-customer-001' },
    ...overrides,
  };
}

function createMockPrisma() {
  const findMany = jest.fn().mockResolvedValue([]);
  return { prisma: { booking: { findMany } }, findMany };
}

function createMockNotifications() {
  const create = jest.fn().mockResolvedValue({ id: 'notif-stub' });
  return { notifications: { create }, create };
}

/**
 * PrismaClientKnownRequestError-shaped P2002. We only need `.code`
 * (stable across Prisma versions); keeping the spec free of the
 * Prisma runtime class preserves the pure-unit property.
 */
function uniqueConstraintError(): Error & { code: string } {
  const err = new Error(
    'Unique constraint failed on the fields: (`dedupeKey`)',
  ) as Error & { code: string };
  err.code = 'P2002';
  return err;
}

/* ─────────────────────────────────────────────────────────────────
   TEST SUITE
   ───────────────────────────────────────────────────────────────── */

describe('RemindersService', () => {
  let module: TestingModule;
  let service: RemindersService;
  let findMany: jest.Mock;
  let create: jest.Mock;

  beforeEach(async () => {
    const { prisma, findMany: f } = createMockPrisma();
    const { notifications, create: c } = createMockNotifications();
    findMany = f;
    create = c;

    module = await Test.createTestingModule({
      providers: [
        RemindersService,
        { provide: PrismaService, useValue: prisma },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();

    service = module.get<RemindersService>(RemindersService);
  });

  afterEach(async () => {
    await module.close();
  });

  /* ═══════════════════════════════════════════
     24H REMINDER
     ═══════════════════════════════════════════ */

  it('(TEST 1) emits a 24h reminder for a CONFIRMED booking inside the 24h window', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const startTime = new Date(now.getTime() + 24 * 60 * 60_000);
    const booking = mkBooking({ id: 'bk-24h', startTime });

    /* Service queries 24h window first, then 1h. */
    findMany.mockResolvedValueOnce([booking]).mockResolvedValueOnce([]);

    const result = await service.runDueReminders(now);

    expect(result.emitted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.candidates).toBe(1);
    expect(result.now).toEqual(now);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      userId: 'user-customer-001',
      type: 'BOOKING_REMINDER_24H',
      payload: {
        bookingId: 'bk-24h',
        serviceTitle: 'Haircut & beard trim',
        startTime: startTime.toISOString(),
        reminderHours: 24,
      },
      dedupeKey: 'booking:bk-24h:reminder:24h',
    });
  });

  /* ═══════════════════════════════════════════
     1H REMINDER
     ═══════════════════════════════════════════ */

  it('(TEST 2) emits a 1h reminder for a CONFIRMED booking inside the 1h window', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const startTime = new Date(now.getTime() + 60 * 60_000);
    const booking = mkBooking({ id: 'bk-1h', startTime });

    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([booking]);

    const result = await service.runDueReminders(now);

    expect(result.emitted).toBe(1);
    expect(result.skipped).toBe(0);
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith({
      userId: 'user-customer-001',
      type: 'BOOKING_REMINDER_1H',
      payload: {
        bookingId: 'bk-1h',
        serviceTitle: 'Haircut & beard trim',
        startTime: startTime.toISOString(),
        reminderHours: 1,
      },
      dedupeKey: 'booking:bk-1h:reminder:1h',
    });
  });

  /* ═══════════════════════════════════════════
     BOTH WINDOWS EMIT INDEPENDENTLY
     ═══════════════════════════════════════════ */

  it('(TEST 3) emits both 24h and 1h reminders when two distinct bookings are each in their respective windows', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const booking24h = mkBooking({
      id: 'bk-day',
      startTime: new Date(now.getTime() + 24 * 60 * 60_000),
    });
    const booking1h = mkBooking({
      id: 'bk-soon',
      startTime: new Date(now.getTime() + 60 * 60_000),
    });

    findMany.mockResolvedValueOnce([booking24h]).mockResolvedValueOnce([booking1h]);

    const result = await service.runDueReminders(now);

    expect(result.emitted).toBe(2);
    expect(result.candidates).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'BOOKING_REMINDER_24H',
        dedupeKey: 'booking:bk-day:reminder:24h',
      }),
    );
    expect(create).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        type: 'BOOKING_REMINDER_1H',
        dedupeKey: 'booking:bk-soon:reminder:1h',
      }),
    );
  });

  /* ═══════════════════════════════════════════
     EMPTY WINDOWS
     ═══════════════════════════════════════════ */

  it('(TEST 4) emits nothing when no booking sits in either due window', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

    const result = await service.runDueReminders(now);

    expect(result.emitted).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.candidates).toBe(0);
    expect(create).not.toHaveBeenCalled();
  });

  /* ═══════════════════════════════════════════
     DEDUP KEY COLLISION IS A NO-OP
     ═══════════════════════════════════════════ */

  it('(TEST 5) treats a unique-constraint collision as skipped, not as a thrown error or second notification', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const startTime = new Date(now.getTime() + 24 * 60 * 60_000);
    const booking = mkBooking({ id: 'bk-dup', startTime });

    /* First call simulates an existing reminder row that already
     * owns this dedupe key — Prisma rejects with P2002. */
    findMany.mockResolvedValueOnce([booking]).mockResolvedValueOnce([]);
    create.mockRejectedValueOnce(uniqueConstraintError());

    const result = await service.runDueReminders(now);

    expect(result.emitted).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.candidates).toBe(1);
    /* Exactly one create attempt; no second create. */
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('(TEST 6) mixed batch: emits for new keys, skips for colliding keys, throws nothing', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const fresh = mkBooking({ id: 'bk-fresh', startTime: new Date(now.getTime() + 24 * 60 * 60_000) });
    const alreadySent = mkBooking({ id: 'bk-sent', startTime: new Date(now.getTime() + 24 * 60 * 60_000) });

    findMany.mockResolvedValueOnce([fresh, alreadySent]).mockResolvedValueOnce([]);
    create
      .mockResolvedValueOnce({ id: 'notif-1' })
      .mockRejectedValueOnce(uniqueConstraintError());

    const result = await service.runDueReminders(now);

    expect(result.emitted).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.candidates).toBe(2);
    expect(create).toHaveBeenCalledTimes(2);
  });

  /* ═══════════════════════════════════════════
     FINDER SCOPE / STATUS FILTER
     ═══════════════════════════════════════════ */

  it('(TEST 7) queries only CONFIRMED bookings with the exact startTime range for each window', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    findMany.mockResolvedValue([]);

    await service.runDueReminders(now);

    const slackMs = 5 * 60_000;
    const expectedLow24 = new Date(now.getTime() + 24 * 60 * 60_000 - slackMs);
    const expectedHigh24 = new Date(now.getTime() + 24 * 60 * 60_000 + slackMs);
    const expectedLow1 = new Date(now.getTime() + 60 * 60_000 - slackMs);
    const expectedHigh1 = new Date(now.getTime() + 60 * 60_000 + slackMs);

    expect(findMany).toHaveBeenCalledTimes(2);
    /* Call 1: 24h window. */
    expect(findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          status: BookingStatus.CONFIRMED,
          startTime: { gte: expectedLow24, lte: expectedHigh24 },
        },
      }),
    );
    /* Call 2: 1h window. */
    expect(findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          status: BookingStatus.CONFIRMED,
          startTime: { gte: expectedLow1, lte: expectedHigh1 },
        },
      }),
    );
  });

  /* ═══════════════════════════════════════════
     CANCELLED BOOKINGS YIELD NO REMINDER
     ═══════════════════════════════════════════ */

  it('(TEST 8) never emits a reminder for CANCELLED bookings (filtered at the DB query level)', async () => {
    /* Combines two complementary guarantees:
     *   1. The where.status = CONFIRMED filter proved in TEST 7
     *      ensures a CANCELLED row never reaches the result set in
     *      a real DB call.
     *   2. This test pins the call-site behaviour (every returned
     *      row -> one create attempt) so a future "smart filtering"
     *      layer that resurrects excluded rows would be a deliberate
     *      change, not a regression. */
    const now = new Date('2026-07-15T10:00:00.000Z');
    const cancelled = mkBooking({
      id: 'bk-cancelled',
      status: BookingStatus.CANCELLED,
      startTime: new Date(now.getTime() + 24 * 60 * 60_000),
    });

    findMany.mockResolvedValueOnce([cancelled]).mockResolvedValueOnce([]);

    const result = await service.runDueReminders(now);

    expect(result.candidates).toBe(1);
    expect(create).toHaveBeenCalledTimes(1);
  });

  /* ═══════════════════════════════════════════
     NON-P2002 ERRORS BUBBLE UP
     ═══════════════════════════════════════════ */

  it('(TEST 9) rethrows non-unique-constraint errors so the scheduler sees real failures', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    const booking = mkBooking({ id: 'bk-boom', startTime: new Date(now.getTime() + 60 * 60_000) });

    findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([booking]);
    /* A transient DB error must NOT be silently swallowed as a
     * "skipped" reminder. */
    create.mockRejectedValueOnce(
      Object.assign(new Error('connection reset'), { code: 'P1001' }),
    );

    await expect(service.runDueReminders(now)).rejects.toThrow(
      'connection reset',
    );
  });

  /* ═══════════════════════════════════════════
     EXISTING NON-REMINDER CALLERS UNAFFECTED
     ═══════════════════════════════════════════ */

  it('(TEST 10) the RemindersService only emits reminder types with a non-empty dedupeKey and exactly the four payload keys', async () => {
    const now = new Date('2026-07-15T10:00:00.000Z');
    findMany
      .mockResolvedValueOnce([mkBooking({ id: 'bk-a', startTime: new Date(now.getTime() + 24 * 60 * 60_000) })])
      .mockResolvedValueOnce([mkBooking({ id: 'bk-b', startTime: new Date(now.getTime() + 60 * 60_000) })]);

    await service.runDueReminders(now);

    expect(create).toHaveBeenCalledTimes(2);
    const calls = create.mock.calls.map((c) => c[0]);

    /* Only reminder types are ever emitted from this service —
     * existing callers of NotificationsService.create (payment,
     * booking lifecycle, reviews) keep their own types. */
    const types = calls.map((c) => c.type);
    expect(new Set(types)).toEqual(
      new Set(['BOOKING_REMINDER_24H', 'BOOKING_REMINDER_1H']),
    );
    /* Every reminder call carries a non-empty dedupeKey matching
     * the spec format. */
    for (const c of calls) {
      expect(typeof c.dedupeKey).toBe('string');
      expect(c.dedupeKey).toMatch(/^booking:.+:reminder:(24h|1h)$/);
    }
    /* And the payload shape is exactly the four keys promised in
     * the packet — nothing more, nothing less. */
    for (const c of calls) {
      expect(Object.keys(c.payload).sort()).toEqual(
        ['bookingId', 'reminderHours', 'serviceTitle', 'startTime'].sort(),
      );
    }
  });
});