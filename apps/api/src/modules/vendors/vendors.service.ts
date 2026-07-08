import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../shared/modules/prisma/prisma.service';
import { CreateVendorDto, UpdateVendorDto } from './dto/create-vendor.dto';

@Injectable()
export class VendorsService {
  constructor(private prisma: PrismaService) {}

  async findAll(params: {
    categoryId?: string;
    search?: string;
    minPrice?: number;
    maxPrice?: number;
    minRating?: number;
    page?: number;
    limit?: number;
  }) {
    const {
      categoryId,
      search,
      minPrice,
      maxPrice,
      minRating,
      page = 1,
      limit = 20,
    } = params;
    const skip = (page - 1) * limit;

    const where: any = {
      status: 'APPROVED',
    };

    if (categoryId) {
      where.categoryId = categoryId;
    }

    if (search) {
      where.OR = [
        { businessName: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
      ];
    }

    /* Price filter: vendor has services; require at least one
     * service whose price falls within [min, max]. We translate to
     * an `services.some` clause — Prisma converts it to a subquery. */
    if (minPrice !== undefined || maxPrice !== undefined) {
      const priceClause: any = {};
      if (minPrice !== undefined) priceClause.gte = minPrice;
      if (maxPrice !== undefined) priceClause.lte = maxPrice;
      where.services = { some: { price: priceClause, isActive: true } };
    }

    /* Rating filter on the vendor's cached avgRating. */
    if (minRating !== undefined && minRating > 0) {
      where.avgRating = { gte: minRating };
    }

    const [vendors, total] = await Promise.all([
      this.prisma.vendorProfile.findMany({
        where,
        include: {
          category: {
            select: {
              id: true,
              nameAr: true,
              nameEn: true,
              icon: true,
            },
          },
          user: {
            select: {
              id: true,
              name: true,
            },
          },
        },
        skip,
        take: limit,
        orderBy: { avgRating: 'desc' },
      }),
      this.prisma.vendorProfile.count({ where }),
    ]);

    return {
      data: vendors,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { id },
      include: {
        category: true,
        user: {
          select: {
            id: true,
            name: true,
          },
        },
        services: {
          where: { isActive: true },
          include: {
            category: {
              select: {
                id: true,
                nameAr: true,
                nameEn: true,
              },
            },
          },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor not found');
    }

    return vendor;
  }

  async getMyProfile(userId: string) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
      include: {
        category: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        services: {
          where: { isActive: true },
        },
        _count: {
          select: {
            bookings: true,
          },
        },
      },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor profile not found');
    }

    return vendor;
  }

  async updateMyProfile(userId: string, dto: UpdateVendorDto) {
    const vendor = await this.prisma.vendorProfile.findUnique({
      where: { userId },
    });

    if (!vendor) {
      throw new NotFoundException('Vendor profile not found');
    }

    return this.prisma.vendorProfile.update({
      where: { userId },
      data: {
        description: dto.description,
        address: dto.address,
        lat: dto.lat,
        lng: dto.lng,
        categoryId: dto.categoryId,
      },
      include: {
        category: true,
      },
    });
  }
}
