/**
 * B4 — Reminders Module.
 *
 * Composition:
 *   - Imports NotificationsModule so we can reuse the existing
 *     `NotificationsService.create` contract (extended in B4 to
 *     accept reminder types and an optional `dedupeKey`).
 *   - Provides RemindersService (no controller, no HTTP surface).
 *   - Exports RemindersService so other modules can wire it into
 *     cron runners / schedulers in B8.
 *
 * Deliberately not imported:
 *   - `@nestjs/schedule` — the packet explicitly forbids introducing
 *     a scheduler dependency in this task. The RemindersService is
 *     a plain callable; B8 will wrap it in whatever cron primitive
 *     operations picks (system cron, Kubernetes CronJob, BullMQ…).
 *   - BookingsModule — we depend only on PrismaService for read
 *     access, not on BookingsService. Importing BookingsModule would
 *     pull in payment webhook handlers, cancellation logic, etc.,
 *     none of which are needed to evaluate reminder eligibility.
 */
import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  providers: [RemindersService],
  exports: [RemindersService],
})
export class RemindersModule {}