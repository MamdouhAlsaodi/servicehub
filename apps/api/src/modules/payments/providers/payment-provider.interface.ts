/**
 * Payment Provider abstraction.
 *
 * The payments service talks to any provider through this interface so
 * we can:
 *   - Test locally with a Mock provider (no Stripe keys required).
 *   - Swap to Stripe in production by setting PAYMENTS_PROVIDER=stripe.
 *   - Add new providers (Pix, MercadoPago, etc.) without changing the
 *     service layer.
 *
 * Two responsibilities:
 *   1. createIntent — server-side, returns opaque clientSecret for
 *      the frontend + a stable externalId we store.
 *   2. verifyWebhookSignature — raw body + signature → event, or throws.
 */

import { PaymentStatus } from '@prisma/client';

export interface CreateIntentInput {
  /** Internal booking id; provider stores it as metadata. */
  bookingId: string;
  /** Vendor id (passed to provider metadata for analytics). */
  vendorId: string;
  /** Amount in major units (e.g. BRL 100.00 — NOT cents). */
  amount: number;
  /** ISO currency code, lowercase ('brl', 'usd', 'sar'). */
  currency: string;
  /** Optional human description shown on the receipt. */
  description?: string;
  /** Idempotency: provider must return the same intent if called twice
   * with the same key. We use `${bookingId}:${attempt}`. */
  idempotencyKey: string;
}

export interface CreateIntentResult {
  /** Provider's stable id (e.g. pi_abc123 for Stripe). */
  externalId: string;
  /** Opaque client secret handed to the frontend SDK. */
  clientSecret: string;
}

export interface PaymentEvent {
  /** Provider's event id (used to deduplicate webhook calls). */
  id: string;
  type:
    | 'payment_intent.succeeded'
    | 'payment_intent.payment_failed'
    | 'payment_intent.canceled'
    | 'charge.refunded';
  /** External id of the PaymentIntent this event refers to. */
  externalId: string;
  /** New status derived from the event. */
  status: PaymentStatus;
  /** Refund amount in major units (only for refund events). */
  refundedAmount?: number;
}

export interface PaymentProvider {
  readonly name: 'STRIPE' | 'MOCK';

  createIntent(input: CreateIntentInput): Promise<CreateIntentResult>;

  /**
   * Verify a webhook delivery. Throws if the signature is invalid.
   * Returns the parsed event (only the fields we use).
   */
  verifyWebhook(
    rawBody: Buffer | string,
    signature: string,
  ): Promise<PaymentEvent>;

  /**
   * Refund a payment. Most providers need the externalId and an amount.
   * Returns the new status + refunded amount.
   */
  refund(
    externalId: string,
    amount: number,
  ): Promise<{ status: PaymentStatus; refundedAmount: number }>;
}