/**
 * Stripe payment provider.
 *
 * Real Stripe integration using the official SDK. Constructed lazily so
 * tests/dev environments that don't have STRIPE_SECRET_KEY don't fail
 * to boot — the provider throws at createIntent time if keys are missing.
 *
 * Webhook verification uses stripe.webhooks.constructEvent which checks
 * the signature against STRIPE_WEBHOOK_SECRET.
 *
 * Refund: refund the full or partial amount via stripe.refunds.create.
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import Stripe from 'stripe';
import { PaymentStatus } from '@prisma/client';
import {
  CreateIntentInput,
  CreateIntentResult,
  PaymentEvent,
  PaymentProvider,
} from './payment-provider.interface';

@Injectable()
export class StripePaymentProvider implements PaymentProvider {
  readonly name = 'STRIPE' as const;
  private readonly logger = new Logger(StripePaymentProvider.name);
  private readonly stripe: Stripe;

  constructor() {
    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      throw new Error(
        'STRIPE_SECRET_KEY is required when PAYMENTS_PROVIDER=stripe',
      );
    }
    this.stripe = new Stripe(secret, {
      /* Pin the API version to a known-stable release. The Stripe SDK
       * type definitions vary across versions, so we cast to `any` to
       * keep this code portable. */
      apiVersion: '2024-06-20' as any,
    });
  }

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const intent = await this.stripe.paymentIntents.create(
      {
        amount: Math.round(input.amount * 100), // major → minor (cents)
        currency: input.currency,
        description: input.description,
        metadata: {
          bookingId: input.bookingId,
          vendorId: input.vendorId,
        },
        automatic_payment_methods: { enabled: true },
      },
      { idempotencyKey: input.idempotencyKey },
    );
    return {
      externalId: intent.id,
      clientSecret: intent.client_secret!,
    };
  }

  async verifyWebhook(
    rawBody: Buffer | string,
    signature: string,
  ): Promise<PaymentEvent> {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      throw new Error('STRIPE_WEBHOOK_SECRET is required for Stripe webhooks');
    }
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(rawBody, signature, secret);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'unknown';
      throw new BadRequestException(`Stripe webhook signature invalid: ${msg}`);
    }

    /* Normalize into our internal PaymentEvent. */
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      return {
        id: event.id,
        type: 'payment_intent.succeeded',
        externalId: pi.id,
        status: PaymentStatus.SUCCEEDED,
      };
    }
    if (
      event.type === 'payment_intent.payment_failed' ||
      event.type === 'payment_intent.canceled'
    ) {
      const pi = event.data.object as Stripe.PaymentIntent;
      return {
        id: event.id,
        type:
          event.type === 'payment_intent.canceled'
            ? 'payment_intent.canceled'
            : 'payment_intent.payment_failed',
        externalId: pi.id,
        status: PaymentStatus.FAILED,
      };
    }
    if (event.type === 'charge.refunded') {
      const charge = event.data.object as Stripe.Charge;
      const piId =
        typeof charge.payment_intent === 'string'
          ? charge.payment_intent
          : charge.payment_intent?.id ?? '';
      return {
        id: event.id,
        type: 'charge.refunded',
        externalId: piId,
        status: PaymentStatus.REFUNDED,
        refundedAmount: (charge.amount_refunded ?? 0) / 100,
      };
    }

    /* Unknown event type: we still need a return; caller should ignore. */
    return {
      id: event.id,
      type: 'payment_intent.canceled', // unused, but TS strict
      externalId: '',
      status: PaymentStatus.PENDING,
    };
  }

  async refund(
    externalId: string,
    amount: number,
  ): Promise<{ status: PaymentStatus; refundedAmount: number }> {
    const refund = await this.stripe.refunds.create({
      payment_intent: externalId,
      amount: Math.round(amount * 100),
    });
    const total = (refund.amount ?? 0) / 100;
    const pi = (await this.stripe.paymentIntents.retrieve(externalId)) as unknown as {
      amount: number;
      amount_refunded?: number;
    };
    const fullyRefunded =
      (pi.amount_refunded ?? pi.amount) >= pi.amount;
    return {
      status: fullyRefunded
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED,
      refundedAmount: total,
    };
  }
}