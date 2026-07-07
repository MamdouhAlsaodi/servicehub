/**
 * Phase 6 — Notifications Service (lite: REST polling, no WebSocket).
 *
 * Owns:
 *   - create         — internal helper called by other services when
 *                      something happens (booking confirmed, cancelled,
 *                      review posted, etc.)
 *   - findMine       — for the bell-icon badge in the navbar
 *   - markRead       — single notification
 *   - markAllRead    — convenience for "mark all as read"
 *
 * Why REST polling instead of WebSocket:
 *   - Hermes orchestrator already handles fan-out to Telegram. The
 *     in-app bell is a nice-to-have for desktop users; 30s polling is
 *     enough for a PWA/mobile experience and avoids the dependency
 *     surface of socket.io + Redis adapter + horizontal scaling.
 *   - WebSocket can be layered on later without changing the schema
 *     or the service contract — just hook a gateway onto create().
 */
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { Notification } from '@prisma/client';

export type NotificationType =
  | 'BOOKING_CONFIRMED'
  | 'BOOKING_CANCELLED'
  | 'BOOKING_CREATED'
  | 'PAYMENT_RECEIVED'
  | 'PAYMENT_FAILED'
  | 'REVIEW_RECEIVED';

interface CreateInput {
  userId: string;
  type: NotificationType;
  payload: Record<string, unknown>;
}

@Injectable()
export class NotificationsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Persist + return. Callers fan-out via Telegram/Hermes separately. */
  async create(input: CreateInput): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        userId: input.userId,
        type: input.type,
        payload: input.payload as object,
      },
    });
  }

  async findMine(userId: string, limit = 30) {
    return this.prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  async unreadCount(userId: string): Promise<number> {
    return this.prisma.notification.count({
      where: { userId, readAt: null },
    });
  }

  async markRead(notificationId: string, userId: string): Promise<Notification> {
    const n = await this.prisma.notification.findUnique({
      where: { id: notificationId },
    });
    if (!n) throw new NotFoundException('Notification not found');
    if (n.userId !== userId) {
      throw new ForbiddenException('You cannot mark this notification');
    }
    if (n.readAt) return n; // idempotent
    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(userId: string): Promise<{ count: number }> {
    const res = await this.prisma.notification.updateMany({
      where: { userId, readAt: null },
      data: { readAt: new Date() },
    });
    return { count: res.count };
  }
}