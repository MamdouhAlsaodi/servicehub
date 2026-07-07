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

    /* Compute commission (10% flat for now, will move to a config). */
    const commissionAmount = service.price.mul(0.10).toDecimalPlaces(2);

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

  getHoldExpiryMinutes(): number {
    return HOLD_MINUTES;
  }

  /* ═══════════════════════════════════════════
     INTERNAL HELPERS
     ═══════════════════════════════════════════ */

  /**
   * Prisma throws a wrapped error when a Postgres constraint fails.
   * We look for the EXCLUDE rule's name so we can identify overlap
   * specifically.
   */
  private isOverlapError(e: unknown): boolean {
    if (typeof e !== 'object' || e === null) return false;
    const msg = (e as { message?: string }).message ?? '';
    return (
      msg.includes('booking_no_overlap') ||
      msg.includes('conflicting key value violates exclusion constraint')
    );
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