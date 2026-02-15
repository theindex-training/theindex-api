import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

    if (dto.startTime !== undefined) item.startTime = dto.startTime;
    if (dto.endTime !== undefined) item.endTime = dto.endTime;

    return this.repo.save(item);
  }

  async delete(id: string) {
    const item = await this.edit(id);
    await this.repo.remove(item);
    return { deleted: true };
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
