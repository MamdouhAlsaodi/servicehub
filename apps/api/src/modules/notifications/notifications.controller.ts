/**
 * Phase 6 — Notifications Controller (REST polling).
 *
 * Routes:
 *   GET  /notifications           — my list (latest 30)
 *   GET  /notifications/unread    — count only (for the bell badge)
 *   POST /notifications/:id/read  — mark one
 *   POST /notifications/read-all  — mark all
 */
import {
  Controller,
  Get,
  Post,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  async list(@CurrentUser('id') userId: string) {
    const [items, unread] = await Promise.all([
      this.notificationsService.findMine(userId),
      this.notificationsService.unreadCount(userId),
    ]);
    return { items, unread };
  }

  @Get('unread')
  async unread(@CurrentUser('id') userId: string) {
    return { count: await this.notificationsService.unreadCount(userId) };
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.notificationsService.markRead(id, userId);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAll(@CurrentUser('id') userId: string) {
    return this.notificationsService.markAllRead(userId);
  }
}