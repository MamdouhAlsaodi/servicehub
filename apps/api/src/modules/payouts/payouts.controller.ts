/**
 * B5 — Payouts Controller. Vendor routes @Roles(VENDOR), admin routes
 * @Roles(ADMIN). Service re-checks the role for defence in depth.
 *
 *   POST   /payouts                — vendor creates a REQUESTED payout.
 *   GET    /payouts/me             — vendor lists own.
 *   GET    /payouts/eligibility/me — vendor checks available balance.
 *   GET    /payouts                — admin lists all (?status= filter).
 *   PATCH  /payouts/:id/approve    — admin: REQUESTED → APPROVED.
 *   PATCH  /payouts/:id/reject     — admin: REQUESTED|APPROVED → REJECTED.
 *   PATCH  /payouts/:id/pay        — admin: APPROVED → PAID.
 */
import {
  BadRequestException, Body, Controller, Get, Param, Patch, Post,
  Query, UseGuards,
} from '@nestjs/common';
import { PayoutStatus, UserRole } from '@prisma/client';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PayoutsService } from './payouts.service';
import { CreatePayoutRequestDto } from './dto/create-payout-request.dto';
import { PayoutDecisionDto, PayoutPaidDto } from './dto/payout-decision.dto';

@Controller('payouts')
export class PayoutsController {
  constructor(private readonly payoutsService: PayoutsService) {}

  /* VENDOR */

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreatePayoutRequestDto,
  ) {
    return this.payoutsService.createRequest(userId, dto.amount, dto.vendorNote);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async myPayouts(
    @CurrentUser('id') userId: string,
    @Query('limit') limit?: string,
  ) {
    const n = limit ? parseInt(limit, 10) : 50;
    return this.payoutsService.listForVendor(userId, Number.isFinite(n) ? n : 50);
  }

  @Get('eligibility/me')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async myEligibility(@CurrentUser('id') userId: string) {
    return this.payoutsService.getEligibilityForVendor(userId);
  }

  /* ADMIN */

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async listAll(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
  ) {
    if (status !== undefined) {
      const allowed = Object.values(PayoutStatus) as string[];
      if (!allowed.includes(status)) {
        throw new BadRequestException(
          `status must be one of: ${allowed.join(', ')}`,
        );
      }
    }
    const n = limit ? parseInt(limit, 10) : 100;
    return this.payoutsService.listAll({
      status: status as PayoutStatus | undefined,
      limit: Number.isFinite(n) ? n : 100,
    });
  }

  @Patch(':id/approve')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async approve(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: PayoutDecisionDto,
  ) {
    return this.payoutsService.approveRequest(userId, id, dto.reason);
  }

  @Patch(':id/reject')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async reject(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: PayoutDecisionDto,
  ) {
    return this.payoutsService.rejectRequest(userId, id, dto.reason);
  }

  @Patch(':id/pay')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async pay(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
    @Body() dto: PayoutPaidDto,
  ) {
    return this.payoutsService.markPaidRequest(userId, id, dto.note);
  }
}