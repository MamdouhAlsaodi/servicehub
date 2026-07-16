import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from './modules/auth/auth.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { ServicesModule } from './modules/services/services.module';
import { CategoriesModule } from './modules/categories/categories.module';
import { AvailabilityModule } from './modules/availability/availability.module';
import { BookingsModule } from './modules/bookings/bookings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReviewsModule } from './modules/reviews/reviews.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { RemindersModule } from './modules/reminders/reminders.module';
import { AdminModule } from './modules/admin/admin.module';
import { PayoutsModule } from './modules/payouts/payouts.module';
import { MessagesModule } from './modules/messages/messages.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env'],
    }),
    HealthModule,
    AuthModule,
    VendorsModule,
    ServicesModule,
    CategoriesModule,
    AvailabilityModule,
    BookingsModule,
    PaymentsModule,
    ReviewsModule,
    NotificationsModule,
    RemindersModule,
    AdminModule,
    PayoutsModule,
    MessagesModule,
  ],
})
export class AppModule {}
