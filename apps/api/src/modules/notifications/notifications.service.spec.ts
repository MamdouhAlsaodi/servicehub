/**
 * Phase 6 — Notifications Service tests.
 *
 * Covers:
 *   - create + persistence
 *   - findMine ordered by createdAt desc
 *   - unreadCount only counts unread
 *   - markRead idempotent (no-op if already read)
 *   - markAllRead returns count of newly-read items
 *   - authorization: can't mark someone else's notification
 */
import { Test, TestingModule } from '@nestjs/testing';
import {
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { prisma, cleanDatabase, disconnectPrisma } from '../../test/setup';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

describe('NotificationsService', () => {
  let service: NotificationsService;
  let userAId: string;
  let userBId: string;

  beforeEach(async () => {
    await cleanDatabase();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();
    service = module.get<NotificationsService>(NotificationsService);

    const passwordHash = await bcrypt.hash('password123', 4);
    const a = await prisma.user.create({
      data: { name: 'A', email: 'a@t.com', passwordHash, role: UserRole.CUSTOMER },
    });
    userAId = a.id;
    const b = await prisma.user.create({
      data: { name: 'B', email: 'b@t.com', passwordHash, role: UserRole.CUSTOMER },
    });
    userBId = b.id;
  });

  afterAll(async () => {
    await disconnectPrisma();
  });

  it('(TEST 1) creates a notification', async () => {
    const n = await service.create({
      userId: userAId,
      type: 'BOOKING_CONFIRMED',
      payload: { bookingId: 'abc' },
    });
    expect(n.type).toBe('BOOKING_CONFIRMED');
    expect(n.userId).toBe(userAId);
    expect(n.readAt).toBeNull();
  });

  it('(TEST 2) findMine returns the user notifications only', async () => {
    await service.create({ userId: userAId, type: 'BOOKING_CONFIRMED', payload: {} });
    await service.create({ userId: userAId, type: 'PAYMENT_RECEIVED', payload: {} });
    await service.create({ userId: userBId, type: 'BOOKING_CANCELLED', payload: {} });

    const a = await service.findMine(userAId);
    const b = await service.findMine(userBId);
    expect(a.length).toBe(2);
    expect(b.length).toBe(1);
  });

  it('(TEST 3) unreadCount counts only null readAt', async () => {
    await service.create({ userId: userAId, type: 'BOOKING_CONFIRMED', payload: {} });
    await service.create({ userId: userAId, type: 'PAYMENT_RECEIVED', payload: {} });
    await service.create({ userId: userAId, type: 'BOOKING_CANCELLED', payload: {} });
    expect(await service.unreadCount(userAId)).toBe(3);

    const all = await service.findMine(userAId);
    await service.markRead(all[0].id, userAId);
    expect(await service.unreadCount(userAId)).toBe(2);
  });

  it('(TEST 4) markRead is idempotent', async () => {
    const n = await service.create({
      userId: userAId,
      type: 'BOOKING_CONFIRMED',
      payload: {},
    });
    const first = await service.markRead(n.id, userAId);
    const second = await service.markRead(n.id, userAId);
    /* Second call should not throw and should return the same row. */
    expect(first.id).toBe(second.id);
    expect(second.readAt).not.toBeNull();
  });

  it('(TEST 5) markRead rejects other users notification', async () => {
    const n = await service.create({
      userId: userAId,
      type: 'BOOKING_CONFIRMED',
      payload: {},
    });
    await expect(service.markRead(n.id, userBId)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('(TEST 6) markRead throws on missing notification', async () => {
    await expect(
      service.markRead('does-not-exist', userAId),
    ).rejects.toThrow(NotFoundException);
  });

  it('(TEST 7) markAllRead returns count of newly-read', async () => {
    await service.create({ userId: userAId, type: 'BOOKING_CONFIRMED', payload: {} });
    await service.create({ userId: userAId, type: 'PAYMENT_RECEIVED', payload: {} });
    const result1 = await service.markAllRead(userAId);
    expect(result1.count).toBe(2);

    /* Second call should be 0. */
    const result2 = await service.markAllRead(userAId);
    expect(result2.count).toBe(0);
  });
});