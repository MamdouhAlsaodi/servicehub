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
  NotFoundException,
} from '@nestjs/common';
import { Request } from 'express';
import { PaymentsService } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { MockPaymentProvider } from './providers/mock-payment.provider';

@Controller('payments')
export class PaymentsController {
  constructor(
    private readonly paymentsService: PaymentsService,
    /** Injected lazily so the controller doesn't need a hard dep on Mock. */
    private readonly mock: MockPaymentProvider | undefined,
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
    @CurrentUser('id') userId: string,
    @Param('bookingId') bookingId: string,
    @Body() body: { amount?: number },
  ) {
    return this.paymentsService.refund(bookingId, userId, body?.amount);
  }

  /* ═══════════════════════════════════════════
     READ
     ═══════════════════════════════════════════ */

  @Get('me')
  @UseGuards(JwtAuthGuard)
  async myPayments(@CurrentUser('id') userId: string) {
    return this.findPaymentsForUser(userId);
  }

  @Get(':paymentId')
  @UseGuards(JwtAuthGuard)
  async findOne(
    @CurrentUser('id') userId: string,
    @Param('paymentId') paymentId: string,
  ) {
    /* Lookup pattern mirrors BookingsService — see authorization
     * notes there. */
    const { PrismaService } = await import('../../shared/modules/prisma/prisma.service');
    const prisma = new PrismaService();
    try {
      const p = await prisma.payment.findUnique({
        where: { id: paymentId },
        include: { booking: { include: { vendor: true } } },
      });
      if (!p) throw new NotFoundException('Payment not found');
      const isCustomer = p.booking.customerId === userId;
      // Vendor access: fetch the user's vendor profile to compare ids.
      // We keep this minimal here; the canonical check is in
      // BookingsService.findOne.
      if (!isCustomer) {
        throw new BadRequestException(
          'You cannot view this payment',
        );
      }
      return p;
    } finally {
      await prisma.$disconnect();
    }
  }

  /* ═══════════════════════════════════════════
     Internal helper — minimal, avoids cross-module coupling.
     ═══════════════════════════════════════════ */

  private async findPaymentsForUser(userId: string) {
    /* Direct Prisma access for now — in Phase 5 this moves behind
     * a PaymentsRepository. */
    const { PrismaService } = await import('../../shared/modules/prisma/prisma.service');
    const prisma = new PrismaService();
    try {
      return prisma.payment.findMany({
        where: { booking: { customerId: userId } },
        orderBy: { createdAt: 'desc' },
        include: { booking: { select: { id: true, startTime: true, status: true } } },
      });
    } finally {
      await prisma.$disconnect();
    }
  }
}