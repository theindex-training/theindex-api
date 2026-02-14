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
import { CreateGymSubscriptionDto } from './dto/create-gym-subscription.dto';
import { ListGymSubscriptionsQueryDto } from './dto/list-gym-subscriptions.query.dto';
import { UpdateGymSubscriptionDto } from './dto/update-gym-subscription.dto';
import { GymSubscriptionsService } from './gym-subscriptions.service';

@ApiTags('gym-subscriptions')
@ApiBearerAuth('jwt')
@Controller('gym-subscriptions')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(AccountRole.ADMIN, AccountRole.TRAINER)
export class GymSubscriptionsController {
  constructor(private readonly service: GymSubscriptionsService) {}

  @Post()
  create(@Body() dto: CreateGymSubscriptionDto) {
    return this.service.create(dto);
  }

  @Get()
  list(@Query() q: ListGymSubscriptionsQueryDto) {
    return this.service.list(q);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.service.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateGymSubscriptionDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.deactivate(id);
  }
}
