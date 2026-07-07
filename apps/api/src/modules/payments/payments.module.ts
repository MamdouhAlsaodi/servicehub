/**
 * Phase 4 — Payments Module.
 *
 * Selects the payment provider at module construction:
 *   - PAYMENTS_PROVIDER=mock  (default, no Stripe keys required)
 *   - PAYMENTS_PROVIDER=stripe (requires STRIPE_SECRET_KEY)
 *
 * Production safety:
 *   - If NODE_ENV=production and provider=mock, we throw at boot.
 *   - Stripe provider is loaded lazily so dev/test don't need Stripe.
 */
import { Module, Logger } from '@nestjs/common';
import { PaymentsService } from './payments.service';
import { PaymentsController } from './payments.controller';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { StripePaymentProvider } from './providers/stripe-payment.provider';
import { PaymentProvider } from './providers/payment-provider.interface';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/notifications.service';

const logger = new Logger('PaymentsModule');

function selectProvider(): PaymentProvider {
  const choice = (process.env.PAYMENTS_PROVIDER ?? 'mock').toLowerCase();
  if (choice === 'stripe') {
    logger.log('Payment provider: STRIPE');
    return new StripePaymentProvider();
  }
  if (choice === 'mock') {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'PAYMENTS_PROVIDER=mock is not allowed in production. ' +
          'Set PAYMENTS_PROVIDER=stripe and provide STRIPE_SECRET_KEY.',
      );
    }
    logger.warn(
      'Payment provider: MOCK — only for development. ' +
        'Do not deploy this configuration to production.',
    );
    return new MockPaymentProvider();
  }
  throw new Error(`Unknown PAYMENTS_PROVIDER: ${choice}`);
}

const provider = selectProvider();

@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController],
  providers: [
    {
      provide: 'PAYMENT_PROVIDER',
      useValue: provider,
    },
    {
      provide: MockPaymentProvider,
      useValue: provider.name === 'MOCK' ? provider : undefined,
    },
    PaymentsService,
    NotificationsService,
  ],
  exports: [PaymentsService, NotificationsService],
})
export class PaymentsModule {
  constructor() {
    /* Provider instance is created once at module evaluation time. */
    logger.log(
      `PaymentsModule ready — provider=${provider.name} ` +
        `currency=brl`,
    );
  }
}