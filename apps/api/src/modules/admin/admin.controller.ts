/**
 * Phase 7 — Admin Controller.
 *
 * All routes guarded with JwtAuthGuard + RolesGuard(UserRole.ADMIN).
 *
 * Routes:
 *   GET  /admin/vendors/pending          — list PENDING vendors
 *   PATCH /admin/vendors/:id/approve    — APPROVE
 *   PATCH /admin/vendors/:id/suspend    — SUSPEND
 *   GET  /admin/kpis                    — system snapshot
 *   GET  /admin/reports/revenue         — time-bucketed revenue
 *   GET  /admin/reports/top-vendors     — leaderboard
 *   GET  /admin/disputes                — recent CANCELLED-by-customer bookings
 */
import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  /* VENDOR MANAGEMENT */

  @Get('vendors/pending')
  pendingVendors() {
    return this.adminService.listPendingVendors();
  }

  @Patch('vendors/:id/approve')
  approveVendor(@Param('id') id: string) {
    return this.adminService.approveVendor(id);
  }

  @Patch('vendors/:id/suspend')
  suspendVendor(
    @Param('id') id: string,
    @Body() body: { reason: string },
  ) {
    if (!body?.reason?.trim()) {
      return { error: 'reason is required' };
    }
    return this.adminService.suspendVendor(id, body.reason);
  }

  /* REPORTS */

  @Get('kpis')
  kpis() {
    return this.adminService.kpis();
  }

  @Get('reports/revenue')
  revenueReport(@Query('days') days?: string) {
    return this.adminService.revenueByDay(
      days ? Math.min(parseInt(days, 10) || 30, 90) : 30,
    );
  }

  @Get('reports/top-vendors')
  topVendors(@Query('limit') limit?: string) {
    return this.adminService.topVendors(
      limit ? Math.min(parseInt(limit, 10) || 10, 50) : 10,
    );
  }

  /* DISPUTES */

  @Get('disputes')
  disputes() {
    return this.adminService.listDisputes();
  }
}