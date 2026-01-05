import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { AccountRole } from '../common/enums/account-role.enum';
import { CreateGymLocationDto } from './dto/create-gym-location.dto';
import { ListGymLocationsQueryDto } from './dto/list-gym-locations.query.dto';
import { UpdateGymLocationDto } from './dto/update-gym-location.dto';
import { GymLocationsService } from './gym-locations.service';

@ApiTags('gym-locations')
@ApiBearerAuth('jwt')
@Controller('gym-locations')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class GymLocationsController {
  constructor(private readonly service: GymLocationsService) {}

  @Post()
  create(@Body() dto: CreateGymLocationDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() q: ListGymLocationsQueryDto) {
    return this.service.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGymLocationDto) {
    return this.service.update(id, dto);
  }

  // Soft delete (recommended)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
