/**
 * Phase 7 — Admin Controller.
 *
 * All routes guarded with JwtAuthGuard + RolesGuard(UserRole.ADMIN).
 *
 * Routes:
 *   GET   /admin/settings/commission     — read platform commission percent
 *   PATCH /admin/settings/commission     — update platform commission percent
 *   GET   /admin/vendors/pending          — list PENDING vendors
 *   PATCH /admin/vendors/:id/approve    — APPROVE
 *   PATCH /admin/vendors/:id/suspend    — SUSPEND
 *   GET  /admin/kpis                    — system snapshot
 *   GET  /admin/reports/revenue         — time-bucketed revenue
 *   GET  /admin/reports/top-vendors     — leaderboard
 *   GET  /admin/disputes                — recent CANCELLED-by-customer bookings
 *   GET  /admin/exports/financial.csv   — streamed financial CSV (B5)
 */
import {
  Controller,
  Get,
  Patch,
  Param,
  Body,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AdminService } from './admin.service';
import { FinancialCsvExportService } from './export/financial-csv.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';
import { UpdateCommissionSettingsDto } from './dto/update-commission-settings.dto';
import { FinancialExportQueryDto } from './dto/financial-export-query.dto';

@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly financialCsv: FinancialCsvExportService,
  ) {}

  /* PLATFORM SETTINGS */

  @Get('settings/commission')
  commissionSettings() {
    return this.adminService.getPlatformSettings();
  }

  @Patch('settings/commission')
  updateCommissionSettings(@Body() dto: UpdateCommissionSettingsDto) {
    return this.adminService.updateCommissionRate(dto.commissionRatePercent);
  }

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

  /* FINANCIAL EXPORT (B5) */

  /**
   * Streams every SUCCEEDED payment as CSV. Cursor-paginated so
   * memory use is O(batchSize) regardless of dataset size. Validation
   * runs BEFORE headers so a bad filter yields 400, not a truncated
   * download; mid-stream errors destroy the socket so the client can
   * safely retry.
   */
  @Get('exports/financial.csv')
  async exportFinancialCsv(
    @Query() query: FinancialExportQueryDto,
    @Res({ passthrough: false }) res: Response,
  ): Promise<void> {
    /* Eager validation: service re-validates as defence in depth,
     * but doing it here keeps 400 synchronous. */
    this.financialCsv.validateQuery(query);

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${this.financialCsv.buildFilename()}"`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');

    try {
      for await (const chunk of this.financialCsv.streamFinancialCsv(query)) {
        res.write(chunk);
      }
      res.end();
    } catch (err) {
      /* Headers are on the wire; we cannot change the status code.
       * Destroy the socket so the client sees an incomplete download. */
      if (!res.headersSent) {
        throw err;
      }
      res.destroy(err instanceof Error ? err : new Error('Export failed'));
    }
  }
}