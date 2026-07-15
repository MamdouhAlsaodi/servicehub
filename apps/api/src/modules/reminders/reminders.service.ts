/**
 * B4 — Reminders Service (deterministic, callable scheduler abstraction).
 *
 * Emits in-app reminder notifications for confirmed bookings whose
 * start time falls inside a narrow "due" window (24h and 1h before
 * the appointment), with atomic deduplication and strict exclusion
 * of non-CONFIRMED bookings.
 *
 * Deliberately NOT here:
 *   - `@nestjs/schedule`, `setInterval`, controllers, email/SMS, or
 *     any external network call. This service is the scheduler
 *     abstraction; B8 wires operations execution (cron / CronJob /
 *     BullMQ) to call `runDueReminders(now)`.
 *
 * Due windows (intentionally ±5 minutes around the target offset):
 *   - 24h: [now + 23h55m, now + 24h05m] before booking start
 *   - 1h:  [now +   55m,   now +   65m] before booking start
 *
 * The DB unique index on `Notification.dedupeKey` is the authoritative
 * dedup gate. On Prisma P2002 (unique constraint violation) the
 * duplicate is counted as `skipped` and the method does not throw —
 * so the service is safe to invoke on overlapping cadences.
 *
 * Payload contract (in-app reminder notifications only):
 *   { bookingId, serviceTitle, startTime, reminderHours }
 *
 * Dedupe key contract:
 *   `booking:<bookingId>:reminder:<24h|1h>`
 */
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { BookingStatus } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';

/** Slack minutes around the nominal reminder offset. */
const DUE_WINDOW_SLACK_MINUTES = 5;

const REMINDER_24H_HOURS = 24;
const REMINDER_1H_HOURS = 1;

export interface RunDueRemindersResult {
  /** Newly persisted reminder notifications. */
  emitted: number;
  /** Attempts that lost a unique-key race (already sent). */
  skipped: number;
  /** Bookings observed inside a due window (emitted + skipped). */
  candidates: number;
  /** Echo of `now` so callers and tests can correlate. */
  now: Date;
}

interface ReminderWindow {
  hours: 24 | 1;
  type: 'BOOKING_REMINDER_24H' | 'BOOKING_REMINDER_1H';
  keySuffix: '24h' | '1h';
}

const REMINDER_WINDOWS: readonly ReminderWindow[] = [
  { hours: REMINDER_24H_HOURS, type: 'BOOKING_REMINDER_24H', keySuffix: '24h' },
  { hours: REMINDER_1H_HOURS,  type: 'BOOKING_REMINDER_1H',  keySuffix: '1h'  },
];

@Injectable()
export class RemindersService {
  private readonly logger = new Logger(RemindersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Emit any due in-app reminders for the given `now`.
   *
   * Callers pass `now` explicitly so tests and operations tooling
   * drive the scheduler deterministically — no background loop, no
   * observer pattern, no `Date.now()` inside the service body.
   */
  async runDueReminders(now: Date): Promise<RunDueRemindersResult> {
    let emitted = 0;
    let skipped = 0;
    let candidates = 0;

    for (const window of REMINDER_WINDOWS) {
      const { low, high } = this.computeDueRange(now, window.hours);

      /* CONFIRMED is the only eligibility gate we need — the same
       * query also excludes PENDING_PAYMENT, CANCELLED, COMPLETED
       * and NO_SHOW because none of them match `status: CONFIRMED`. */
      const bookings = await this.prisma.booking.findMany({
        where: {
          status: BookingStatus.CONFIRMED,
          startTime: { gte: low, lte: high },
        },
        include: {
          service: { select: { title: true } },
          customer: { select: { id: true } },
        },
      });

      candidates += bookings.length;

      for (const booking of bookings) {
        const dedupeKey = this.buildDedupeKey(booking.id, window.keySuffix);
        const payload = {
          bookingId: booking.id,
          serviceTitle: booking.service.title,
          startTime: booking.startTime.toISOString(),
          reminderHours: window.hours,
        };

        try {
          await this.notifications.create({
            userId: booking.customer.id,
            type: window.type,
            payload,
            dedupeKey,
          });
          emitted += 1;
        } catch (e) {
          /* Atomic dedup: if another run already persisted this
           * exact key, Prisma raises P2002. Count it as skipped
           * and move on. Anything else bubbles up so operators
           * see real failures. */
          if (this.isUniqueConstraintError(e)) {
            skipped += 1;
            this.logger.debug?.(
              `Reminder dedup hit for key=${dedupeKey} (booking=${booking.id})`,
            );
          } else {
            throw e;
          }
        }
      }
    }

    return { emitted, skipped, candidates, now };
  }

  /* ─────────────────────────────────────────────────────────────────
     INTERNAL HELPERS
     ───────────────────────────────────────────────────────────────── */

  /**
   * Half-open window of booking `startTime` values that are "due"
   * at `now` for a given target offset (hours). Window is
   * ±DUE_WINDOW_SLACK_MINUTES around the nominal offset.
   */
  private computeDueRange(now: Date, hours: number): { low: Date; high: Date } {
    const offsetMs = hours * 60 * 60_000;
    const slackMs = DUE_WINDOW_SLACK_MINUTES * 60_000;
    return {
      low: new Date(now.getTime() + offsetMs - slackMs),
      high: new Date(now.getTime() + offsetMs + slackMs),
    };
  }

  /** Centralised dedupe-key format. Single source of truth. */
  private buildDedupeKey(bookingId: string, keySuffix: '24h' | '1h'): string {
    return `booking:${bookingId}:reminder:${keySuffix}`;
  }

  /** Prisma P2002 = unique constraint violation. */
  private isUniqueConstraintError(e: unknown): boolean {
    if (typeof e !== 'object' || e === null) return false;
    return (e as { code?: string }).code === 'P2002';
  }
}