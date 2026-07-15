/**
 * Phase 3 — Bookings Service.
 *
 * Owns:
 *   - createBooking (3.1)         — creates a PENDING_PAYMENT booking
 *                                   with a 5-min hold and idempotency.
 *   - findAvailableSlots (3.4)    — expands vendor availability for a
 *                                   given day into discrete start slots
 *                                   and filters out booked ones.
 *   - cancelBooking (3.5)         — enforces the 24-hour window and
 *                                   ownership rules.
 *   - getHoldExpiry (3.3)         — small helper used by the controller.
 *
 * Concurrency:
 *   - Two clients may try to grab the same slot at the same time.
 *   - The DB has an EXCLUDE USING gist constraint (added by migration
 *     20260705000000_booking_no_overlap) on (vendorId, tstzrange)
 *     which guarantees no two ACTIVE bookings overlap.
 *   - We do an upfront best-effort check (`$queryRaw`) so 99% of
 *     conflicts return a clean 409 instead of the raw constraint
 *     error. The constraint is the safety net.
 *
 * Hold semantics:
 *   - A PENDING_PAYMENT booking holds the slot for 5 minutes.
 *   - Expired holds are filtered out by both:
 *       (a) the checkBeforeInsert raw query (`holdExpiresAt > now`)
 *       (b) the EXCLUDE constraint is *partial* and only applies to
 *           ACTIVE statuses (see migration).
 *   - When a payment succeeds (Phase 4), hold is cleared and status
 *     moves to CONFIRMED.
 */
import {
  Injectable,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { Booking, BookingStatus, Prisma, UserRole } from '@prisma/client';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';

const HOLD_MINUTES = 5;
const CANCELLATION_WINDOW_HOURS = 24;
const DEFAULT_COMMISSION_RATE = new Prisma.Decimal('0.10');

/** Shape returned by getVendorDashboard. */
export interface VendorDashboardDto {
  summary: { todayBookings: number; confirmedRevenue: number; cancellations: number };
  topServices: { serviceId: string; title: string; bookings: number; revenue: number }[];
  upcomingBookings: Array<{
    id: string; startTime: Date; endTime: Date; status: BookingStatus;
    service: { id: string; title: string };
    customer: { id: string; name: string };
  }>;
}

@Injectable()
export class BookingsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ═══════════════════════════════════════════
     3.1 CREATE BOOKING
     ═══════════════════════════════════════════ */

  async createBooking(dto: CreateBookingDto, customerId: string): Promise<Booking> {
    const startTime = new Date(dto.startTime);
    if (startTime.getTime() <= Date.now()) {
      throw new BadRequestException('startTime must be in the future');
    }

    /* Idempotency: if a request with the same key exists, return it. */
    if (dto.idempotencyKey) {
      const existing = await this.prisma.booking.findFirst({
        where: {
          customerId,
          // We don't store idempotencyKey directly — derive a stable hash
          // from (serviceId, startTime) instead since the request body
          // already encodes everything we need.
          serviceId: dto.serviceId,
          startTime,
          status: { not: BookingStatus.CANCELLED },
        },
      });
      if (existing) return existing;
    }

    /* Look up the service. Derive vendorId + durationMinutes + price.
     * We also verify the vendor is APPROVED in the same query to keep
     * the read path short. */
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, isActive: true },
      include: {
        vendor: {
          include: {
            user: { select: { name: true, email: true } },
          },
        },
      },
    });
    if (!service) {
      throw new NotFoundException('Service not found or inactive');
    }
    if (service.vendor.status !== 'APPROVED') {
      throw new BadRequestException('Vendor is not approved for bookings');
    }

    const endTime = new Date(startTime.getTime() + service.durationMinutes * 60_000);
    const holdExpiresAt = new Date(Date.now() + HOLD_MINUTES * 60_000);

    /* Best-effort pre-check: any non-cancelled booking overlapping? */
    const conflict = await this.prisma.$queryRaw<{ id: string }[]>(
      Prisma.sql`
        SELECT id FROM "Booking"
        WHERE "vendorId" = ${service.vendorId}
          AND tstzrange("startTime", "endTime", '[)') &&
              tstzrange(${startTime.toISOString()}::timestamptz,
                        ${endTime.toISOString()}::timestamptz,
                        '[)')
          AND (
            "status" <> 'CANCELLED'
            AND ("holdExpiresAt" IS NULL OR "holdExpiresAt" > NOW())
          )
        LIMIT 1
      `,
    );
    if (conflict.length > 0) {
      throw new ConflictException('Slot is no longer available');
    }

    /* Snapshot the current global rate onto this booking. Decimal arithmetic
     * keeps both the configured fraction and the persisted amount exact.
     * The fallback preserves the historical 10% behavior if the singleton
     * is unexpectedly absent; existing bookings are never recalculated. */
    const platformSettings = await this.prisma.platformSettings.findUnique({
      where: { id: 1 },
      select: { commissionRate: true },
    });
    const commissionRate =
      platformSettings?.commissionRate ?? DEFAULT_COMMISSION_RATE;
    const commissionAmount = service.price
      .mul(commissionRate)
      .toDecimalPlaces(2);

    /* Attempt insert. The EXCLUDE constraint is the authoritative
     * safety net — if two requests slip past the pre-check, one of
     * them will fail here with a P2010 (Postgres error). We translate
     * it back to ConflictException. */
    try {
      return await this.prisma.booking.create({
        data: {
          customerId,
          vendorId: service.vendorId,
          serviceId: service.id,
          startTime,
          endTime,
          status: BookingStatus.PENDING_PAYMENT,
          priceAtBooking: service.price,
          commissionAmount,
          holdExpiresAt,
        },
      });
    } catch (e: unknown) {
      if (this.isOverlapError(e)) {
        throw new ConflictException('Slot is no longer available');
      }
      throw e;
    }
  }

  /* ═══════════════════════════════════════════
     3.4 FIND AVAILABLE SLOTS
     ═══════════════════════════════════════════ */

  async findAvailableSlots(
    serviceId: string,
    dateIso: string,
    slotMinutes?: number,
  ): Promise<{ date: string; slots: string[] }> {
    const service = await this.prisma.service.findFirst({
      where: { id: serviceId, isActive: true },
      include: { vendor: { include: { availability: true } } },
    });
    if (!service) {
      throw new NotFoundException('Service not found or inactive');
    }
    if (service.vendor.status !== 'APPROVED') {
      throw new BadRequestException('Vendor is not approved');
    }

    /* Parse the requested date as a calendar day in the vendor's
     * timezone (default to UTC if missing). Anchor at 12:00 UTC so
     * noon falls in the same calendar day in any tz between UTC-12 and
     * UTC+14, regardless of DST. */
    const tz = service.vendor.timezone || 'UTC';
    const day = new Date(dateIso + 'T12:00:00Z');
    if (isNaN(day.getTime())) {
      throw new BadRequestException('Invalid date');
    }
    const dayOfWeek = this.dayOfWeekInTimezone(day, tz); // 0=Sun..6=Sat

    /* Find the vendor's normal weekly availability for this day, plus
     * any date-specific exceptions. */
    const daySlots = service.vendor.availability.filter(
      (a) => !a.isException && a.dayOfWeek === dayOfWeek,
    );
    if (daySlots.length === 0) {
      return { date: dateIso, slots: [] };
    }

    /* Pull all bookings for that day that would block slots. */
    const dayStart = new Date(day);
    const dayEnd = new Date(day.getTime() + 24 * 60 * 60_000);
    const bookings = await this.prisma.booking.findMany({
      where: {
        vendorId: service.vendorId,
        status: { not: BookingStatus.CANCELLED },
        AND: [
          { startTime: { lt: dayEnd } },
          { endTime: { gt: dayStart } },
          {
            OR: [
              { holdExpiresAt: null },
              { holdExpiresAt: { gt: new Date() } },
            ],
          },
        ],
      },
      select: { startTime: true, endTime: true },
    });

    /* Expand availability windows into discrete start slots. */
    const step = slotMinutes ?? service.durationMinutes;
    const allSlots: string[] = [];
    for (const window of daySlots) {
      const [startHour, startMin] = window.startTime.split(':').map(Number);
      const [endHour, endMin] = window.endTime.split(':').map(Number);

      const windowStartMin = startHour * 60 + startMin;
      const windowEndMin = endHour * 60 + endMin;

      for (let m = windowStartMin; m + step <= windowEndMin; m += step) {
        // Build a UTC instant for the slot's calendar day in the tz.
        const slotUtc = this.minutesToUtcInstant(dateIso, m, tz);
        if (slotUtc.getTime() <= Date.now()) continue;
        allSlots.push(slotUtc.toISOString());
      }
    }

    /* Filter out slots that overlap any blocking booking. */
    const free = allSlots.filter((iso) => {
      const slotStart = new Date(iso);
      const slotEnd = new Date(slotStart.getTime() + step * 60_000);
      return !bookings.some((b) => {
        return slotStart < b.endTime && slotEnd > b.startTime;
      });
    });

    return { date: dateIso, slots: free };
  }

  /* ═══════════════════════════════════════════
     3.5 CANCEL BOOKING
     ═══════════════════════════════════════════ */

  async cancelBooking(
    bookingId: string,
    userId: string,
    userRole: UserRole,
    dto: CancelBookingDto,
  ): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      include: { vendor: true },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    /* Ownership rules:
     *   - Customer can cancel their own booking.
     *   - Vendor (via VendorProfile.userId) can cancel any of their bookings.
     *   - Admin can cancel anything.
     */
    const isOwner = booking.customerId === userId;
    const isVendorOwner =
      userRole === UserRole.VENDOR && booking.vendor.userId === userId;
    const isAdmin = userRole === UserRole.ADMIN;
    if (!isOwner && !isVendorOwner && !isAdmin) {
      throw new ForbiddenException('You cannot cancel this booking');
    }

    if (booking.status === BookingStatus.CANCELLED) {
      throw new BadRequestException('Booking already cancelled');
    }
    if (booking.status === BookingStatus.COMPLETED) {
      throw new BadRequestException('Cannot cancel a completed booking');
    }

    /* Customer-initiated cancellations enforce the 24h window.
     * Vendors and admins can cancel at any time. */
    if (
      isOwner &&
      !isAdmin &&
      booking.startTime.getTime() - Date.now() <
        CANCELLATION_WINDOW_HOURS * 60 * 60_000
    ) {
      throw new BadRequestException(
        `Cancellation window (${CANCELLATION_WINDOW_HOURS}h) has passed`,
      );
    }

    return this.prisma.booking.update({
      where: { id: bookingId },
      data: {
        status: BookingStatus.CANCELLED,
        cancellationReason: dto.reason,
        cancelledBy: userId,
        holdExpiresAt: null,
      },
    });
  }

  /* ═══════════════════════════════════════════
     READ HELPERS
     ═══════════════════════════════════════════ */

  async findOne(id: string, userId: string, userRole: UserRole): Promise<Booking> {
    const booking = await this.prisma.booking.findUnique({
      where: { id },
      include: {
        service: { select: { id: true, title: true, durationMinutes: true } },
        vendor: { select: { id: true, businessName: true, userId: true } },
        customer: { select: { id: true, name: true, email: true } },
      },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const isCustomer = booking.customerId === userId;
    const isVendorOwner =
      userRole === UserRole.VENDOR && booking.vendor.userId === userId;
    const isAdmin = userRole === UserRole.ADMIN;
    if (!isCustomer && !isVendorOwner && !isAdmin) {
      throw new ForbiddenException('You cannot view this booking');
    }
    return booking;
  }

  async findMyBookings(
    userId: string,
    role: UserRole,
    status?: BookingStatus,
  ): Promise<Booking[]> {
    if (role === UserRole.CUSTOMER) {
      const bookings = await this.prisma.booking.findMany({
        where: {
          customerId: userId,
          ...(status ? { status } : {}),
        },
        orderBy: { startTime: 'desc' },
        include: {
          service: { select: { title: true, durationMinutes: true } },
          vendor: { select: { businessName: true } },
          review: { select: { id: true } },
        },
      });
      /* Surface a `hasReview` boolean for the frontend to decide
       * whether to show a "قيّم" CTA. The shape stays backward-compatible
       * — Prisma's `review: { select }` adds the field but clients
       * that ignore unknown keys keep working. */
      return bookings.map((b) => ({
        ...b,
        hasReview: b.review !== null,
      })) as unknown as Booking[];
    }
    if (role === UserRole.VENDOR) {
      const vendor = await this.prisma.vendorProfile.findFirst({
        where: { userId },
        select: { id: true },
      });
      if (!vendor) return [];
      return this.prisma.booking.findMany({
        where: {
          vendorId: vendor.id,
          ...(status ? { status } : {}),
        },
        orderBy: { startTime: 'desc' },
        include: {
          service: { select: { title: true, durationMinutes: true } },
          customer: { select: { name: true } },
          review: { select: { rating: true } },
        },
      });
    }
    // ADMIN
    return this.prisma.booking.findMany({
      where: status ? { status } : {},
      orderBy: { startTime: 'desc' },
      include: {
        service: { select: { title: true } },
        vendor: { select: { businessName: true } },
        customer: { select: { name: true } },
        review: { select: { rating: true } },
      },
    });
  }

  /* VENDOR DASHBOARD (B2 Task 4). "Today" is the UTC calendar day
   * containing `now` — bucketed in UTC on purpose so the metric is
   * stable across DST and consistent regardless of vendor tz.
   * Limit clamped to [1, 20] defensively. Tenant isolation: every
   * read is gated on the VendorProfile owned by `userId`. */
  async getVendorDashboard(userId: string, limit: number): Promise<VendorDashboardDto> {
    const safeLimit = Math.min(Math.max(Math.trunc(limit || 5), 1), 20);

    const vendor = await this.prisma.vendorProfile.findFirst({ where: { userId }, select: { id: true } });
    if (!vendor) {
      return {
        summary: { todayBookings: 0, confirmedRevenue: 0, cancellations: 0 },
        topServices: [],
        upcomingBookings: [],
      };
    }

    const now = new Date();
    const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

    const [todayBookings, confirmedAgg, cancellations] = await Promise.all([
      this.prisma.booking.count({
        where: { vendorId: vendor.id, startTime: { gte: dayStart, lt: dayEnd } },
      }),
      this.prisma.booking.aggregate({
        where: { vendorId: vendor.id, status: BookingStatus.CONFIRMED }, _sum: { priceAtBooking: true },
      }),
      this.prisma.booking.count({ where: { vendorId: vendor.id, status: BookingStatus.CANCELLED } }),
    ]);
    const confirmedRevenue = confirmedAgg._sum.priceAtBooking ? Number(confirmedAgg._sum.priceAtBooking) : 0;

    /* Top services: CONFIRMED-only, ordered by revenue then bookings. */
    const topRows = await this.prisma.booking.groupBy({
      by: ['serviceId'],
      where: { vendorId: vendor.id, status: BookingStatus.CONFIRMED },
      _count: { _all: true }, _sum: { priceAtBooking: true },
      orderBy: [{ _sum: { priceAtBooking: 'desc' } }, { _count: { serviceId: 'desc' } }],
      take: safeLimit,
    });
    const serviceIds = topRows.map((r) => r.serviceId);
    const services = serviceIds.length
      ? await this.prisma.service.findMany({ where: { id: { in: serviceIds } }, select: { id: true, title: true } })
      : [];
    const titleById = new Map(services.map((s) => [s.id, s.title]));
    const topServices = topRows.map((r) => ({
      serviceId: r.serviceId,
      title: titleById.get(r.serviceId) ?? '',
      bookings: r._count._all,
      revenue: Number(r._sum.priceAtBooking ?? 0),
    }));

    /* Upcoming: CONFIRMED + future, soonest first. */
    const upcomingBookings = await this.prisma.booking.findMany({
      where: { vendorId: vendor.id, status: BookingStatus.CONFIRMED, startTime: { gte: now } },
      orderBy: { startTime: 'asc' }, take: safeLimit,
      include: { service: { select: { id: true, title: true } }, customer: { select: { id: true, name: true } } },
    });

    return { summary: { todayBookings, confirmedRevenue, cancellations }, topServices, upcomingBookings };
  }

  getHoldExpiryMinutes(): number {
    return HOLD_MINUTES;
  }

  /* ═══════════════════════════════════════════
     INTERNAL HELPERS
     ═══════════════════════════════════════════ */

  /**
   * Detect the `booking_no_overlap` EXCLUDE constraint violation added
   * by migration 20260705120000 and translate it to a clean 409.
   *
   * The Postgres server returns SQLSTATE `23P01` (exclusion_violation)
   * with the constraint name (`booking_no_overlap`) embedded in the
   * message or in `meta.constraint` / `meta.code` depending on how
   * the Prisma engine wraps the response. In Prisma 5 the engine can
   * surface this as a `PrismaClientUnknownRequestError` whose top
   * level message is sanitised and no longer contains the constraint
   * name; in that case the diagnostic survives only in `meta.code`
   * (23P01) or in a nested `cause`.
   *
   * To stay narrow and avoid swallowing unrelated Prisma errors we
   * only recognise three signals:
   *   1. the literal constraint name `booking_no_overlap`,
   *   2. PostgreSQL SQLSTATE `23P01` (the only code that means
   *      exclusion_violation),
   *   3. the exact Postgres wording
   *      `conflicting key value violates exclusion constraint`.
   *
   * The walk is bounded: depth ≤ 3, WeakSet cycle guard, and we only
   * read well-known scalar keys (`message`, `code`, `cause`, `meta`,
   * `meta.code`, `meta.constraint`, `meta.message`) — never an
   * unbounded enumerable iteration of arbitrary properties. Anything
   * that does not match one of the three signals is rethrown unchanged
   * by `createBooking`.
   */
  private isOverlapError(e: unknown): boolean {
    if (typeof e !== 'object' || e === null) return false;

    const TEXT_TOKENS = [
      'booking_no_overlap',
      'conflicting key value violates exclusion constraint',
    ] as const;
    const PG_SQLSTATE_EXCLUSION = '23P01';

    const matchesText = (s: unknown): boolean =>
      typeof s === 'string' && TEXT_TOKENS.some((t) => s.includes(t));

    const seen = new WeakSet<object>();
    const walk = (err: unknown, depth: number): boolean => {
      if (depth > 3) return false;
      if (typeof err !== 'object' || err === null) return false;
      const ref = err as object;
      if (seen.has(ref)) return false;
      seen.add(ref);

      const o = err as Record<string, unknown>;

      // 1. Standard Error.message.
      if (matchesText(o.message)) return true;

      // 2. SQLSTATE 23P01 at top level (Prisma engine sometimes sets
      //    `.code` to the Postgres SQLSTATE for unknown errors).
      if (o.code === PG_SQLSTATE_EXCLUSION) return true;

      // 3. Bounded inspection of Prisma's `.meta` object — known keys only.
      const meta = o.meta;
      if (meta !== null && typeof meta === 'object') {
        const m = meta as Record<string, unknown>;
        if (m.code === PG_SQLSTATE_EXCLUSION) return true;
        if (matchesText(m.constraint)) return true;
        if (matchesText(m.message)) return true;
      }

      // 4. Nested `.cause` chain (Prisma wraps the original PG error).
      if (o.cause !== undefined && o.cause !== null) {
        if (walk(o.cause, depth + 1)) return true;
      }

      return false;
    };

    return walk(e, 0);
  }

  /**
   * Get the day of week (0=Sunday..6=Saturday) for a UTC instant in
   * a given IANA timezone.
   */
  private dayOfWeekInTimezone(d: Date, tz: string): number {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short',
    });
    const w = fmt.format(d); // 'Sun', 'Mon', ...
    return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(w);
  }

  /**
   * Convert "minutes since midnight in vendor tz" on `dateIso` to a
   * UTC Date. We do this by anchoring at noon UTC of the date and
   * using the tz offset to land at the right wall-clock minute.
   */
  private minutesToUtcInstant(dateIso: string, mins: number, tz: string): Date {
    const [y, m, d] = dateIso.split('-').map(Number);
    const hh = Math.floor(mins / 60);
    const mm = mins % 60;
    // Build the wall-clock string, then ask Node what UTC instant it
    // resolves to in the given tz.
    const wallClockIso = `${dateIso}T${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00`;
    // Use Intl.DateTimeFormat's parts to figure the tz offset for that
    // wall-clock instant in the given zone, then subtract it.
    const utcOfWallClock = new Date(wallClockIso + 'Z');
    const tzFmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      timeZoneName: 'shortOffset',
    });
    const parts = tzFmt.formatToParts(utcOfWallClock);
    const offsetPart = parts.find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+0';
    // offsetPart is like "GMT-3" or "GMT+5:30"
    const match = offsetPart.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/);
    let offsetMinutes = 0;
    if (match) {
      const sign = match[1] === '+' ? 1 : -1;
      const hh2 = parseInt(match[2], 10);
      const mm2 = match[3] ? parseInt(match[3], 10) : 0;
      offsetMinutes = sign * (hh2 * 60 + mm2);
    }
    // The wall-clock instant we want in tz = utcOfWallClock - offsetMinutes.
    // So the actual UTC instant = utcOfWallClock - offsetMinutes.
    return new Date(utcOfWallClock.getTime() - offsetMinutes * 60_000);
  }
}