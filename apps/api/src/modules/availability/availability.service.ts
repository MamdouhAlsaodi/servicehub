import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { CreateAvailabilityDto, BatchAvailabilityDto, CreateAvailabilityExceptionDto } from './dto/create-availability.dto';

@Injectable()
export class AvailabilityService {
  constructor(private prisma: PrismaService) {}

  async getMySchedule(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new ForbiddenException('Vendor profile not found');
    }

    const [regularSchedule, exceptions] = await Promise.all([
      this.prisma.availability.findMany({
        where: {
          vendorId: vendor.id,
          isException: false,
        },
        orderBy: { dayOfWeek: 'asc' },
      }),
      this.prisma.availability.findMany({
        where: {
          vendorId: vendor.id,
          isException: true,
        },
        orderBy: { exceptionDate: 'asc' },
      }),
    ]);

    return {
      schedule: regularSchedule,
      exceptions,
    };
  }

  async createBatch(userId: string, dto: BatchAvailabilityDto) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new ForbiddenException('Vendor profile not found');
    }

    // Delete existing regular schedule
    await this.prisma.availability.deleteMany({
      where: {
        vendorId: vendor.id,
        isException: false,
      },
    });

    // Create new schedule
    if (dto.schedule.length > 0) {
      await this.prisma.availability.createMany({
        data: dto.schedule.map((item) => ({
          vendorId: vendor.id,
          dayOfWeek: item.dayOfWeek,
          startTime: item.startTime,
          endTime: item.endTime,
          isException: false,
        })),
      });
    }

    return this.getMySchedule(userId);
  }

  async createException(userId: string, dto: CreateAvailabilityExceptionDto) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new ForbiddenException('Vendor profile not found');
    }

    return this.prisma.availability.create({
      data: {
        vendorId: vendor.id,
        dayOfWeek: -1, // Indicate exception day
        startTime: dto.startTime || '00:00',
        endTime: dto.endTime || '00:00',
        isException: true,
        exceptionDate: new Date(dto.date),
      },
    });
  }

  async deleteException(userId: string, exceptionId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new ForbiddenException('Vendor profile not found');
    }

    const exception = await this.prisma.availability.findUnique({
      where: { id: exceptionId },
    });

    if (!exception) {
      throw new NotFoundException('Exception not found');
    }

    if (exception.vendorId !== vendor.id) {
      throw new ForbiddenException('You do not own this exception');
    }

    if (!exception.isException) {
      throw new ForbiddenException('Cannot delete regular schedule entry this way');
    }

    return this.prisma.availability.delete({
      where: { id: exceptionId },
    });
  }

  async checkAvailability(vendorId: string, dayOfWeek: number, time: string) {
    const schedule = await this.prisma.availability.findFirst({
      where: {
        vendorId,
        dayOfWeek,
        isException: false,
      },
    });

    if (!schedule) {
      return { available: false, reason: 'No schedule defined' };
    }

    const [checkHour, checkMin] = time.split(':').map(Number);
    const [startHour, startMin] = schedule.startTime.split(':').map(Number);
    const [endHour, endMin] = schedule.endTime.split(':').map(Number);

    const checkMinutes = checkHour * 60 + checkMin;
    const startMinutes = startHour * 60 + startMin;
    const endMinutes = endHour * 60 + endMin;

    if (checkMinutes < startMinutes || checkMinutes > endMinutes) {
      return { available: false, reason: 'Outside working hours' };
    }

    // Check for exceptions on this day
    const today = new Date();
    const dayOfWeekNum = today.getDay();
    const exception = await this.prisma.availability.findFirst({
      where: {
        vendorId,
        isException: true,
        exceptionDate: {
          gte: new Date(today.setHours(0, 0, 0, 0)),
          lt: new Date(today.setHours(23, 59, 59, 999)),
        },
      },
    });

    if (exception) {
      return { available: false, reason: 'Exception day (holiday)' };
    }

    return { available: true };
  }
}
