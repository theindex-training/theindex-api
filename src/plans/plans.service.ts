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

/** A TIME plan lasts either a number of days or of calendar months. */
function assertTimeDuration(plan: {
  durationDays?: number | null;
  durationMonths?: number | null;
}): void {
  const hasDays = !!plan.durationDays && plan.durationDays > 0;
  const hasMonths = !!plan.durationMonths && plan.durationMonths > 0;
  if (!hasDays && !hasMonths)
    throw new BadRequestException(
      'Time plan requires durationDays or durationMonths',
    );
  if (hasDays && hasMonths)
    throw new BadRequestException(
      'Time plan takes durationDays or durationMonths, not both',
    );
}

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
    if (dto.type === PlanType.TIME) assertTimeDuration(dto);

    const plan = this.planRepo.create({
      type: dto.type,
      title: dto.title.trim(),
      priceCents: dto.priceCents,
      credits: dto.type === PlanType.PUNCH ? dto.credits! : null,
      durationDays:
        dto.type === PlanType.TIME ? (dto.durationDays ?? null) : null,
      durationMonths:
        dto.type === PlanType.TIME ? (dto.durationMonths ?? null) : null,
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
    if (dto.durationMonths !== undefined)
      plan.durationMonths =
        dto.durationMonths === null ? null : dto.durationMonths;
    // Sending one duration alone switches the plan to it.
    if (dto.durationDays && dto.durationMonths === undefined)
      plan.durationMonths = null;
    if (dto.durationMonths && dto.durationDays === undefined)
      plan.durationDays = null;

    // Validate consistency
    if (plan.type === PlanType.PUNCH) {
      if (!plan.credits || plan.credits <= 0)
        throw new BadRequestException('Punch plan requires credits');
      plan.durationDays = null;
      plan.durationMonths = null;
    } else {
      assertTimeDuration(plan);
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
