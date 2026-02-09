import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateTrainerDto } from './dto/create-trainer.dto';
import { UpdateTrainerDto } from './dto/update-trainer.dto';
import { TrainerProfileEntity } from './trainer-profile.entity';

@Injectable()
export class TrainerProfilesService {
  constructor(
    @InjectRepository(TrainerProfileEntity)
    private readonly trainerRepo: Repository<TrainerProfileEntity>,
  ) {}

  async list(active?: boolean) {
    const where = active === undefined ? {} : { isActive: active };
    return this.trainerRepo.find({ where, order: { name: 'ASC' } });
  }

  async getById(id: string) {
    const trainer = await this.trainerRepo.findOne({ where: { id } });
    if (!trainer) throw new NotFoundException('Trainer not found');
    return trainer;
  }

  async create(dto: CreateTrainerDto) {
    // Optional uniqueness check for accountId (DB has unique index but this gives nicer error)
    if (dto.accountId) {
      const existing = await this.trainerRepo.findOne({
        where: { accountId: dto.accountId },
      });
      if (existing)
        throw new BadRequestException(
          'This account is already linked to another trainer',
        );
    }

    const trainer = this.trainerRepo.create({
      name: dto.name.trim(),
      nickname: dto.nickname ?? null,
      accountId: dto.accountId ?? null,
      isActive: dto.isActive ?? true,
    });

    return this.trainerRepo.save(trainer);
  }

  async update(id: string, dto: UpdateTrainerDto) {
    const trainer = await this.getById(id);

    if (dto.name !== undefined) trainer.name = dto.name.trim();

    if (dto.nickname !== undefined) trainer.nickname = dto.nickname.trim();

    if (dto.isActive !== undefined) trainer.isActive = dto.isActive;

    if (dto.accountId !== undefined) {
      // allow unlink: null
      const nextAccountId = dto.accountId === null ? null : dto.accountId;

      if (nextAccountId) {
        const existing = await this.trainerRepo.findOne({
          where: { accountId: nextAccountId },
        });
        if (existing && existing.id !== trainer.id) {
          throw new BadRequestException(
            'This account is already linked to another trainer',
          );
        }
      }

      trainer.accountId = nextAccountId;
    }

    return this.trainerRepo.save(trainer);
  }

  async deactivate(id: string) {
    const trainer = await this.getById(id);
    trainer.isActive = false;
    return this.trainerRepo.save(trainer);
  }

  async hardDelete(id: string) {
    const trainer = await this.getById(id);
    await this.trainerRepo.remove(trainer);
    return { deleted: true };
  }
}
