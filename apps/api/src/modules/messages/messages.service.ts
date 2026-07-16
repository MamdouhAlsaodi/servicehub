/**
 * B6 Task 14 — Booking-linked plain-text messaging.
 *
 * A booking has two participants (customer, owning vendor); both
 * can READ + WRITE. ADMIN can READ but cannot WRITE and must not
 * trigger the readAt side effect. All others: Forbidden.
 *
 * `assertParticipant` is reused by send + list and decides from
 * `(userId, role)` only — never request fields. sendMessage adds an
 * explicit admin rejection on top of the gate.
 *
 * Cursor pagination: order `createdAt ASC, id ASC`, take over-fetch
 * of 1, encode cursor as base64url(JSON({ts:ISO, id})) so a single
 * `(createdAt, id)` tuple keeps millisecond-ties deterministic.
 *
 * Read receipts: a participant read stamps messages from the *other*
 * side (senderId != actor, readAt null) to now inside the same
 * transaction as the fetch. ADMIN reads intentionally skip this.
 */
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, UserRole } from '@prisma/client';
import type { Message } from '@prisma/client';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { CreateMessageDto } from './dto/create-message.dto';
import {
  MESSAGE_LIST_DEFAULT_LIMIT,
  MESSAGE_LIST_MAX_LIMIT,
} from './dto/list-messages.dto';

const MAX_CONTENT_LENGTH = 1000;
const MAX_CURSOR_BYTES = 256;

export interface MessageThreadPage {
  items: Message[];
  nextCursor: string | null;
}

interface ResolvedBooking {
  id: string;
  customerId: string;
  vendorUserId: string;
}

interface CursorPayload {
  ts: string;
  id: string;
}

@Injectable()
export class MessagesService {
  constructor(private readonly prisma: PrismaService) {}

  /* ═══ SEND (CUSTOMER / owning VENDOR only) ═══ */

  async sendMessage(
    actorUserId: string,
    actorRole: UserRole,
    bookingId: string,
    dto: CreateMessageDto,
  ): Promise<Message> {
    /* Reject admin BEFORE the participant gate so a future routing
     * change cannot silently admit admin writes. */
    if (actorRole === UserRole.ADMIN) {
      throw new ForbiddenException('Admins cannot send messages');
    }

    /* Defence-in-depth content checks (DTO already validates). */
    const content = (dto.content ?? '').trim();
    if (!content) {
      throw new BadRequestException('content cannot be empty');
    }
    if (content.length > MAX_CONTENT_LENGTH) {
      throw new BadRequestException(
        `content cannot exceed ${MAX_CONTENT_LENGTH} characters`,
      );
    }
    if (/[\x00-\x08\x0B-\x1F\x7F]/.test(content)) {
      throw new BadRequestException(
        'content contains disallowed control characters',
      );
    }

    const booking = await this.assertParticipant(
      actorUserId, actorRole, bookingId,
    );

    return this.prisma.message.create({
      data: { bookingId: booking.id, senderId: actorUserId, content },
    });
  }

  /* ═══ LIST (CUSTOMER / owning VENDOR / ADMIN read-only) ═══ */

  async listMessages(
    actorUserId: string,
    actorRole: UserRole,
    bookingId: string,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<MessageThreadPage> {
    const booking = await this.assertParticipant(
      actorUserId, actorRole, bookingId,
    );

    const limit = this.clampLimit(opts.limit);
    const cursor = opts.cursor ? this.decodeCursor(opts.cursor) : null;

    return this.prisma.$transaction(async (tx) => {
      const isParticipantRead =
        booking.customerId === actorUserId ||
        booking.vendorUserId === actorUserId;

      if (isParticipantRead) {
        await tx.message.updateMany({
          where: {
            bookingId: booking.id,
            senderId: { not: actorUserId },
            readAt: null,
          },
          data: { readAt: new Date() },
        });
      }

      const where: Prisma.MessageWhereInput = {
        bookingId: booking.id,
        ...(cursor
          ? {
              OR: [
                { createdAt: { gt: cursor.date } },
                { createdAt: cursor.date, id: { gt: cursor.id } },
              ],
            }
          : {}),
      };

      const rows = await tx.message.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: limit + 1,
        include: { sender: { select: { id: true, name: true, role: true } } },
      });

      const hasMore = rows.length > limit;
      const page = hasMore ? rows.slice(0, limit) : rows;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last
          ? this.encodeCursor({ ts: last.createdAt.toISOString(), id: last.id })
          : null;

      return { items: page, nextCursor };
    });
  }

  /* ═══ HELPERS ═══ */

  /** Single gate reused by send + list. Booking-missing → 404 to
   *  avoid leaking existence; outsider → 403. */
  private async assertParticipant(
    actorUserId: string,
    actorRole: UserRole,
    bookingId: string,
  ): Promise<ResolvedBooking> {
    if (!actorUserId || typeof actorUserId !== 'string') {
      throw new ForbiddenException('Authentication required');
    }

    const booking = await this.prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, customerId: true, vendor: { select: { userId: true } } },
    });
    if (!booking) throw new NotFoundException('Booking not found');

    const isCustomer = booking.customerId === actorUserId;
    const isVendorOwner =
      actorRole === UserRole.VENDOR && booking.vendor.userId === actorUserId;
    const isAdmin = actorRole === UserRole.ADMIN;

    if (!isCustomer && !isVendorOwner && !isAdmin) {
      throw new ForbiddenException('You do not have access to this booking thread');
    }

    return {
      id: booking.id,
      customerId: booking.customerId,
      vendorUserId: booking.vendor.userId,
    };
  }

  private clampLimit(raw: number | undefined): number {
    if (raw === undefined || raw === null) return MESSAGE_LIST_DEFAULT_LIMIT;
    const n = Math.trunc(Number(raw));
    if (!Number.isFinite(n) || n < 1) return MESSAGE_LIST_DEFAULT_LIMIT;
    return Math.min(n, MESSAGE_LIST_MAX_LIMIT);
  }

  private encodeCursor(payload: CursorPayload): string {
    return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  }

  private decodeCursor(raw: string): { date: Date; id: string } {
    if (!raw || typeof raw !== 'string' || raw.length > MAX_CURSOR_BYTES) {
      throw new BadRequestException('cursor is malformed');
    }
    let payload: CursorPayload;
    try {
      payload = JSON.parse(
        Buffer.from(raw, 'base64url').toString('utf8'),
      ) as CursorPayload;
    } catch {
      throw new BadRequestException('cursor is malformed');
    }
    if (
      !payload ||
      typeof payload.ts !== 'string' ||
      typeof payload.id !== 'string' ||
      payload.id.length === 0
    ) {
      throw new BadRequestException('cursor is malformed');
    }
    const date = new Date(payload.ts);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException('cursor is malformed');
    }
    return { date, id: payload.id };
  }
}
