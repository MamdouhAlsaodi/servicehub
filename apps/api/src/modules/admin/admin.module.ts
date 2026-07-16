import { Module } from '@nestjs/common';
import { AdminService } from './admin.service';
import { AdminController } from './admin.controller';
import { FinancialCsvExportService } from './export/financial-csv.service';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [PaymentsModule],
  controllers: [AdminController],
  providers: [AdminService, FinancialCsvExportService],
  exports: [AdminService, FinancialCsvExportService],
})
export class AdminModule {}