import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { FinancialCsvExportService } from './export/financial-csv.service';

@Module({
  controllers: [AdminController],
  providers: [AdminService, FinancialCsvExportService],
  exports: [AdminService, FinancialCsvExportService],
})
export class AdminModule {}