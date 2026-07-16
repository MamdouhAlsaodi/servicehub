/**
 * B6 Task 14 — Messages HTTP layer.
 *
 * Routes (mounted under `/api/v1`):
 *   POST /messages/bookings/:bookingId — write
 *   GET  /messages/bookings/:bookingId — read (paginated)
 *
 * Both rely on the global ValidationPipe (`whitelist: true,
 * transform: true`); participant rules are enforced in the service.
 * Admin sends are rejected inside the service.
 *
 * Deliberately NOT exposed on a public vendor surface: reviews has
 * `/reviews/vendor/:vendorId`; messages do not. Threads are private
 * to the two parties (plus admin).
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { UserRole } from '@prisma/client';
import { MessagesService } from './messages.service';
import { CreateMessageDto } from './dto/create-message.dto';
import { ListMessagesQueryDto } from './dto/list-messages.dto';

@Controller('messages')
export class MessagesController {
  constructor(private readonly messagesService: MessagesService) {}

  @Post('bookings/:bookingId')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async send(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('bookingId') bookingId: string,
    @Body() dto: CreateMessageDto,
  ) {
    const message = await this.messagesService.sendMessage(
      userId, role, bookingId, dto,
    );
    return { message };
  }

  @Get('bookings/:bookingId')
  @UseGuards(JwtAuthGuard)
  async list(
    @CurrentUser('id') userId: string,
    @CurrentUser('role') role: UserRole,
    @Param('bookingId') bookingId: string,
    @Query() query: ListMessagesQueryDto,
  ) {
    return this.messagesService.listMessages(userId, role, bookingId, {
      limit: query.limit,
      cursor: query.cursor,
    });
  }
}
