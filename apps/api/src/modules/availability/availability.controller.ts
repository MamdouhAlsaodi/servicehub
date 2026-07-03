import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AvailabilityService } from './availability.service';
import { BatchAvailabilityDto, CreateAvailabilityExceptionDto } from './dto/create-availability.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('availability')
export class AvailabilityController {
  constructor(private readonly availabilityService: AvailabilityService) {}

  @Get('me/schedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  async getMySchedule(@CurrentUser('id') userId: string) {
    return this.availabilityService.getMySchedule(userId);
  }

  @Post('me/schedule')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  async createBatch(
    @CurrentUser('id') userId: string,
    @Body() dto: BatchAvailabilityDto,
  ) {
    return this.availabilityService.createBatch(userId, dto);
  }

  @Post('me/exceptions')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.CREATED)
  async createException(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateAvailabilityExceptionDto,
  ) {
    return this.availabilityService.createException(userId, dto);
  }

  @Delete('me/exceptions/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.VENDOR)
  @HttpCode(HttpStatus.OK)
  async deleteException(
    @CurrentUser('id') userId: string,
    @Param('id') id: string,
  ) {
    return this.availabilityService.deleteException(userId, id);
  }
}
