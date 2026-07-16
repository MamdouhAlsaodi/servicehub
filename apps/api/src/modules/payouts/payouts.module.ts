/**
 * B5 — Payouts Module.
 *
 * Registers the payout-request state machine. No external dependencies
 * (no payment-provider module, no notifications module). The service
 * runs against the shared PrismaService via the global PrismaModule.
 *
 * Why no NotificationsModule dep:
 *   - The PAID transition is purely local; emitting a "payout paid"
 *     notification is out of scope for this MVP and would couple this
 *     module to the notifications package. Add later behind a feature
 *     flag if product wants it.
 */
import { Module } from '@nestjs/common';
import { PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

@Module({
  controllers: [PayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}