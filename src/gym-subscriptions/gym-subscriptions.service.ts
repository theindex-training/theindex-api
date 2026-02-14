import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateGymSubscriptionDto } from './dto/create-gym-subscription.dto';
import { ListGymSubscriptionsQueryDto } from './dto/list-gym-subscriptions.query.dto';
import { UpdateGymSubscriptionDto } from './dto/update-gym-subscription.dto';
import { GymSubscriptionEntity } from './gym-subscription.entity';

@Injectable()
export class GymSubscriptionsService {
  constructor(
    @InjectRepository(GymSubscriptionEntity)
    private readonly repo: Repository<GymSubscriptionEntity>,
  ) {}

  async create(dto: CreateGymSubscriptionDto) {
    const entity = this.repo.create({
      name: dto.name.trim(),
      isActive: true,
    });

    return this.repo.save(entity);
  }

  async list(q: ListGymSubscriptionsQueryDto) {
    const includeInactive = q.includeInactive === 'true';

    return this.repo.find({
      where: includeInactive ? {} : { isActive: true },
      order: { name: 'ASC' },
    });
  }

  async get(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Gym subscription not found');
    return item;
  }

  async update(id: string, dto: UpdateGymSubscriptionDto) {
    const item = await this.get(id);

    if (dto.name !== undefined) item.name = dto.name.trim();

    return this.repo.save(item);
  }

  async deactivate(id: string) {
    const item = await this.get(id);
    item.isActive = false;
    return this.repo.save(item);
  }
}
