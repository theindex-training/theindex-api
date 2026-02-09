import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PlanType } from '../common/enums/plan-type.enum';
import { CreatePlanDto } from './dto/create-plan.dto';
import { UpdatePlanDto } from './dto/update-plan.dto';
import { PlanEntity } from './plan.entity';

@Injectable()
export class PlansService {
  constructor(
    @InjectRepository(PlanEntity)
    private readonly planRepo: Repository<PlanEntity>,
  ) {}

  async list(active?: boolean) {
    const where = active === undefined ? {} : { isActive: active };
    return this.planRepo.find({ where, order: { createdAt: 'DESC' } });
  }

  async getById(id: string) {
    const plan = await this.planRepo.findOne({ where: { id } });
    if (!plan) throw new NotFoundException('Plan not found');
    return plan;
  }

  async create(dto: CreatePlanDto) {
    // Validate plan shape
    if (dto.type === PlanType.PUNCH) {
      if (!dto.credits || dto.credits <= 0)
        throw new BadRequestException('Punch plan requires credits');
    }
    if (dto.type === PlanType.TIME) {
      if (!dto.durationDays || dto.durationDays <= 0)
        throw new BadRequestException('Time plan requires durationDays');
    }

    const plan = this.planRepo.create({
      type: dto.type,
      title: dto.title.trim(),
      priceCents: dto.priceCents,
      credits: dto.type === PlanType.PUNCH ? dto.credits! : null,
      durationDays: dto.type === PlanType.TIME ? dto.durationDays! : null,
      isActive: dto.isActive ?? true,
    });

    return this.planRepo.save(plan);
  }

  async update(id: string, dto: UpdatePlanDto) {
    const plan = await this.getById(id);

    if (dto.type !== undefined) plan.type = dto.type;
    if (dto.title !== undefined) plan.title = dto.title.trim();
    if (dto.priceCents !== undefined) plan.priceCents = dto.priceCents;
    if (dto.isActive !== undefined) plan.isActive = dto.isActive;

    // Handle nullable fields intentionally
    if (dto.credits !== undefined)
      plan.credits = dto.credits === null ? null : dto.credits;
    if (dto.durationDays !== undefined)
      plan.durationDays = dto.durationDays === null ? null : dto.durationDays;

    // Validate consistency
    if (plan.type === PlanType.PUNCH) {
      if (!plan.credits || plan.credits <= 0)
        throw new BadRequestException('Punch plan requires credits');
      plan.durationDays = null;
    } else {
      if (!plan.durationDays || plan.durationDays <= 0)
        throw new BadRequestException('Time plan requires durationDays');
      plan.credits = null;
    }

    return this.planRepo.save(plan);
  }

  async deactivate(id: string) {
    const plan = await this.getById(id);
    plan.isActive = false;
    return this.planRepo.save(plan);
  }

  async hardDelete(id: string) {
    const plan = await this.getById(id);
    await this.planRepo.remove(plan);
    return { deleted: true };
  }
}
