/**
 * Mock payment provider — for local development and E2E tests when no
 * real Stripe keys are available.
 *
 * The "createIntent" returns a fake but stable clientSecret that the
 * frontend can post back to /payments/mock-confirm to simulate a
 * successful or failed charge. The webhook flow is bypassed entirely:
 * the mock-confirm endpoint invokes the same PaymentsService logic
 * that the Stripe webhook would.
 *
 * IMPORTANT: this provider MUST be disabled in production. The PaymentsModule
 * chooses the provider from `process.env.PAYMENTS_PROVIDER` and refuses to
 * boot as 'MOCK' when NODE_ENV=production.
 */
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { PaymentStatus } from '@prisma/client';
import {
  CreateIntentInput,
  CreateIntentResult,
  PaymentEvent,
  PaymentProvider,
} from './payment-provider.interface';

@Injectable()
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK' as const;
  private readonly logger = new Logger(MockPaymentProvider.name);

  /**
   * In-memory store of intents so we can look them up by id. In a real
   * system the provider stores them; for the mock we just hold them here.
   * Survives within one process. Tests reset by restarting the API.
   */
  private readonly intents = new Map<
    string,
    { input: CreateIntentInput; status: PaymentStatus; refunded: number }
  >();

  /** Set by the controller so the mock-confirm route can verify it. */
  public readonly webhookSecret =
    process.env.PAYMENTS_MOCK_WEBHOOK_SECRET ?? 'mock-webhook-secret-dev-only';

  async createIntent(input: CreateIntentInput): Promise<CreateIntentResult> {
    const externalId = `mock_pi_${randomBytes(12).toString('hex')}`;
    const clientSecret = `${externalId}_secret_${randomBytes(8).toString('hex')}`;
    this.intents.set(externalId, {
      input,
      status: PaymentStatus.PENDING,
      refunded: 0,
    });
    this.logger.log(
      `[MOCK] Created intent ${externalId} for booking ${input.bookingId} (${input.amount} ${input.currency.toUpperCase()})`,
    );
    return { externalId, clientSecret };
  }

  /**
   * Verify a mock webhook signature.
   *
   * Signature format: `t=<unix-ts>,v1=<hex-hmac>`
   * HMAC body = `<ts>.<rawBody>`
   */
  async verifyWebhook(
    rawBody: Buffer | string,
    signature: string,
  ): Promise<PaymentEvent> {
    const bodyStr =
      typeof rawBody === 'string' ? rawBody : rawBody.toString('utf-8');

    if (!signature) {
      throw new BadRequestException('mock webhook: missing signature header');
    }
    const parts = Object.fromEntries(
      signature.split(',').map((kv) => {
        const [k, v] = kv.split('=');
        return [k, v];
      }),
    );
    if (!parts.t || !parts.v1) {
      throw new BadRequestException('mock webhook: malformed signature header');
    }
    const expected = createHmac('sha256', this.webhookSecret)
      .update(`${parts.t}.${bodyStr}`)
      .digest('hex');
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(parts.v1, 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new BadRequestException('mock webhook: signature mismatch');
    }
    let parsed: {
      id: string;
      type: PaymentEvent['type'];
      externalId: string;
      refundedAmount?: number;
    };
    try {
      parsed = JSON.parse(bodyStr);
    } catch {
      throw new BadRequestException('mock webhook: body is not valid JSON');
    }
    const status = this.eventTypeToStatus(parsed.type);
    return {
      id: parsed.id,
      type: parsed.type,
      externalId: parsed.externalId,
      status,
      refundedAmount: parsed.refundedAmount,
    };
  }

  async refund(
    externalId: string,
    amount: number,
  ): Promise<{ status: PaymentStatus; refundedAmount: number }> {
    const intent = this.intents.get(externalId);
    if (!intent) {
      throw new Error(`mock: intent ${externalId} not found`);
    }
    intent.refunded += amount;
    const status =
      intent.refunded >= Number(intent.input.amount)
        ? PaymentStatus.REFUNDED
        : PaymentStatus.PARTIALLY_REFUNDED;
    this.logger.log(
      `[MOCK] Refund ${amount} on ${externalId} → total ${intent.refunded}/${intent.input.amount} (${status})`,
    );
    return { status, refundedAmount: intent.refunded };
  }

  /** Helper for tests: simulate a state change without going through Stripe. */
  public setIntentStatus(externalId: string, status: PaymentStatus): void {
    const intent = this.intents.get(externalId);
    if (intent) intent.status = status;
  }

  public getIntent(externalId: string) {
    return this.intents.get(externalId);
  }

  /** Helper for the mock-confirm controller route: forge a signed event. */
  public signMockEvent(event: Omit<PaymentEvent, 'status'>): {
    body: string;
    signature: string;
  } {
    const ts = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      id: event.id,
      type: event.type,
      externalId: event.externalId,
      refundedAmount: event.refundedAmount,
    });
    const v1 = createHmac('sha256', this.webhookSecret)
      .update(`${ts}.${body}`)
      .digest('hex');
    return { body, signature: `t=${ts},v1=${v1}` };
  }

  private eventTypeToStatus(type: PaymentEvent['type']): PaymentStatus {
    switch (type) {
      case 'payment_intent.succeeded':
        return PaymentStatus.SUCCEEDED;
      case 'payment_intent.payment_failed':
      case 'payment_intent.canceled':
        return PaymentStatus.FAILED;
      case 'charge.refunded':
        return PaymentStatus.REFUNDED;
    }
  }
}