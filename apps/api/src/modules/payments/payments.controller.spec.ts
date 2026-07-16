import { ForbiddenException } from '@nestjs/common';
import { UserRole } from '@prisma/client';
import { PaymentsController } from './payments.controller';

describe('PaymentsController payment reads', () => {
  const payment = {
    id: 'payment-1',
    booking: {
      customerId: 'customer-1',
      vendor: { userId: 'vendor-1' },
    },
  };

  let prisma: { payment: { findUnique: jest.Mock; findMany: jest.Mock } };
  let controller: PaymentsController;

  beforeEach(() => {
    prisma = {
      payment: {
        findUnique: jest.fn().mockResolvedValue(payment),
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    controller = new PaymentsController({ refund: jest.fn() } as any, undefined, prisma as any);
  });

  it('allows the booking customer to read a payment', async () => {
    await expect(
      controller.findOne({ id: 'customer-1', role: UserRole.CUSTOMER }, payment.id),
    ).resolves.toBe(payment);
  });

  it('allows the owning vendor and an admin to read a payment', async () => {
    await expect(
      controller.findOne({ id: 'vendor-1', role: UserRole.VENDOR }, payment.id),
    ).resolves.toBe(payment);
    await expect(
      controller.findOne({ id: 'admin-1', role: UserRole.ADMIN }, payment.id),
    ).resolves.toBe(payment);
  });

  it('rejects an unrelated user with ForbiddenException without returning payment data', async () => {
    await expect(
      controller.findOne({ id: 'other-customer', role: UserRole.CUSTOMER }, payment.id),
    ).rejects.toThrow(ForbiddenException);
  });

  it('scopes list reads to customer, owning vendor, or all payments for admin', async () => {
    await controller.myPayments({ id: 'customer-1', role: UserRole.CUSTOMER });
    expect(prisma.payment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { booking: { customerId: 'customer-1' } } }),
    );

    await controller.myPayments({ id: 'vendor-1', role: UserRole.VENDOR });
    expect(prisma.payment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { booking: { vendor: { userId: 'vendor-1' } } } }),
    );

    await controller.myPayments({ id: 'admin-1', role: UserRole.ADMIN });
    expect(prisma.payment.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: {} }),
    );
  });
});
