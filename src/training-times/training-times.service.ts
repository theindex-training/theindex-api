import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import {
  ScheduleSlotEntity,
  ScheduleTemplateSlotEntity,
} from '../schedules/schedule.entity';
import { CreateTrainingTimeDto } from './dto/create-training-time.dto';
import { UpdateTrainingTimeDto } from './dto/update-training-time.dto';
import { TrainingTimeEntity } from './training-time.entity';

@Injectable()
export class TrainingTimesService {
  constructor(
    @InjectRepository(TrainingTimeEntity)
    private readonly repo: Repository<TrainingTimeEntity>,
  ) {}

  async list() {
    return this.repo.find({ order: { startTime: 'ASC' } });
  }

  async create(dto: CreateTrainingTimeDto) {
    this.validateTimeRange(dto.startTime, dto.endTime);

    const entity = this.repo.create({
      startTime: dto.startTime,
      endTime: dto.endTime,
    });

    return this.repo.save(entity);
  }

  async edit(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Training time not found');
    return item;
  }

  async update(id: string, dto: UpdateTrainingTimeDto) {
    const item = await this.edit(id);

    const nextStart = dto.startTime ?? item.startTime;
    const nextEnd = dto.endTime ?? item.endTime;
    this.validateTimeRange(nextStart, nextEnd);
    if (
      this.toMinutes(nextStart) !== this.toMinutes(item.startTime) ||
      this.toMinutes(nextEnd) !== this.toMinutes(item.endTime)
    ) {
      await this.assertNotScheduled(id);
    }

    if (dto.startTime !== undefined) item.startTime = dto.startTime;
    if (dto.endTime !== undefined) item.endTime = dto.endTime;

    return this.repo.save(item);
  }

  async delete(id: string) {
    const item = await this.edit(id);
    try {
      await this.repo.remove(item);
    } catch (error) {
      // Schedules (templates and weeks) point to their training times.
      if (
        error instanceof QueryFailedError &&
        (error.driverError as { code?: string } | undefined)?.code === '23503'
      ) {
        throw new ConflictException(
          'This training time is used in a schedule and cannot be deleted',
        );
      }
      throw error;
    }
    return { deleted: true };
  }

  /**
   * Schedules (templates and weeks) show their training times' hours, so changing the hours of
   * one they use would rewrite them, past days included. A new training time is added instead.
   */
  private async assertNotScheduled(id: string) {
    // Without the schedules module (some test setups) there are no schedules.
    if (!this.repo.manager.connection.hasMetadata(ScheduleSlotEntity)) return;
    const used =
      (await this.repo.manager.exists(ScheduleTemplateSlotEntity, {
        where: { trainingTimeId: id },
      })) ||
      (await this.repo.manager.exists(ScheduleSlotEntity, {
        where: { trainingTimeId: id },
      }));
    if (used) {
      throw new ConflictException(
        'This training time is used in a schedule, so its hours cannot change; add a new training time instead',
      );
    }
  }

  private validateTimeRange(startTime: string, endTime: string) {
    const start = this.toMinutes(startTime);
    const end = this.toMinutes(endTime);

    if (end <= start) {
      throw new BadRequestException('endTime must be after startTime');
    }
  }

  private toMinutes(value: string): number {
    const [hours, minutes] = value.split(':').map((v) => Number(v));
    return hours * 60 + minutes;
  }
}
