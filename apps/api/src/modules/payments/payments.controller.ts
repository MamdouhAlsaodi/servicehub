/**
 * Phase 4 — Payments Controller.
 *
 * Routes:
 *   POST /payments/intent                — create payment intent (4.1)
 *   POST /payments/webhook               — provider webhook (4.2)
 *   POST /payments/mock-confirm          — dev-only: simulate webhook (MOCK)
 *   POST /payments/:bookingId/refund     — refund
 *   GET  /payments/:paymentId            — single payment status
 *   GET  /payments/me                    — my payments
 *
 * Webhook routing note: we register the webhook route BEFORE the
 * global raw-body middleware in main.ts. The webhook handler reads
 * `request.rawBody` and `request.headers['stripe-signature']` /
 * `request.headers['x-mock-signature']` directly.
 */
import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Req,
  Headers,
  HttpCode,
  HttpStatus,
  UseGuards,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MockPaymentProvider } from './providers/mock-payment.provider';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';

type PaymentActor = { id: string; role: UserRole };

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    /** Injected lazily so the controller doesn't need a hard dep on Mock. */
    private readonly mock: MockPaymentProvider | undefined,
    private readonly prisma: PrismaService,
  ) {}

  /* ═══════════════════════════════════════════
     4.1 CREATE PAYMENT INTENT
     ═══════════════════════════════════════════ */

  @Post('intent')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createIntent(
    @CurrentUser('id') userId: string,
    @Body() body: { bookingId: string },
  ) {
    if (!body?.bookingId) {
      throw new BadRequestException('bookingId is required');
    }
    return this.paymentsService.createIntent(body.bookingId, userId);
  }

  /* ═══════════════════════════════════════════
     4.2 WEBHOOK (raw body)
     ═══════════════════════════════════════════ */

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() req: Request,
    @Headers('stripe-signature') stripeSig: string | undefined,
    @Headers('x-mock-signature') mockSig: string | undefined,
  ) {
    const rawBody = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!rawBody) {
      throw new BadRequestException(
        'Webhook missing raw body — did you set bodyParser.verify in main.ts?',
      );
    }
    /* Stripe signature takes priority; mock is a fallback for dev. */
    const signature = stripeSig ?? mockSig ?? '';
    return this.paymentsService.handleWebhook(rawBody, signature);
  }

  /* ═══════════════════════════════════════════
     DEV-ONLY: simulate a webhook for the MOCK provider
     ═══════════════════════════════════════════ */

  @Post('mock-confirm')
  @HttpCode(HttpStatus.OK)
  async mockConfirm(
    @Body()
    body: {
      externalId: string;
      outcome: 'succeeded' | 'failed';
    },
  ) {
    if (!this.mock) {
      throw new NotFoundException(
        'Mock provider not active — set PAYMENTS_PROVIDER=mock',
      );
    }
    if (!body?.externalId || !body.outcome) {
      throw new BadRequestException('externalId and outcome are required');
    }

    const eventType =
      body.outcome === 'succeeded'
        ? 'payment_intent.succeeded'
        : 'payment_intent.payment_failed';
    const signed = this.mock.signMockEvent({
      id: `evt_mock_${Date.now()}`,
      type: eventType,
      externalId: body.externalId,
    });

    /* Reuse the same webhook handler — keeps behavior identical to
     * the real provider. */
    return this.paymentsService.handleWebhook(
      signed.body,
      signed.signature,
    );
  }

  /* ═══════════════════════════════════════════
     REFUND
     ═══════════════════════════════════════════ */

  @Post(':bookingId/refund')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async refund(
    @CurrentUser() actor: PaymentActor,
    @Param('bookingId') bookingId: string,
    @Body() body: { amount?: number },
  ) {
    return this.paymentsService.refund(bookingId, actor, body?.amount);
  }

  /* ═══════════════════════════════════════════
     READ
     ═══════════════════════════════════════════ */

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async myPayments(@CurrentUser() actor: PaymentActor) {
    return this.findPaymentsForUser(actor);
  }

  @Get(':paymentId')
  @UseGuards(JwtAuthGuard)
  async findOne(
    @CurrentUser() actor: PaymentActor,
    @Param('paymentId') paymentId: string,
  ) {
    const payment = await this.prisma.payment.findUnique({
      where: { id: paymentId },
      include: { booking: { include: { vendor: true } } },
    });
    if (!payment) throw new NotFoundException('Payment not found');

    const permitted =
      actor.role === UserRole.ADMIN ||
      (actor.role === UserRole.CUSTOMER && payment.booking.customerId === actor.id) ||
      (actor.role === UserRole.VENDOR && payment.booking.vendor.userId === actor.id);
    if (!permitted) {
      throw new ForbiddenException('You cannot view this payment');
    }
    return payment;
  }

  /* ═══════════════════════════════════════════
     Internal helper — minimal, avoids cross-module coupling.
     ═══════════════════════════════════════════ */

  private async findPaymentsForUser(actor: PaymentActor) {
    const where =
      actor.role === UserRole.ADMIN
        ? {}
        : actor.role === UserRole.VENDOR
          ? { booking: { vendor: { userId: actor.id } } }
          : { booking: { customerId: actor.id } };
    return this.prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: { booking: { select: { id: true, startTime: true, status: true } } },
    });
  }
}