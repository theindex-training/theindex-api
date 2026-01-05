import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CreateGymLocationDto } from './dto/create-gym-location.dto';
import { ListGymLocationsQueryDto } from './dto/list-gym-locations.query.dto';
import { UpdateGymLocationDto } from './dto/update-gym-location.dto';
import { GymLocationEntity } from './gym-location.entity';

@Injectable()
export class GymLocationsService {
  constructor(
    @InjectRepository(GymLocationEntity)
    private readonly repo: Repository<GymLocationEntity>,
  ) {}

  async create(dto: CreateGymLocationDto) {
    const entity = this.repo.create({
      name: dto.name,
      address: dto.address ?? null,
      notes: dto.notes ?? null,
      isActive: true,
    });
    return this.repo.save(entity);
  }

  async list(q: ListGymLocationsQueryDto) {
    const includeInactive = q.includeInactive === 'true';
    return this.repo.find({
      where: includeInactive ? {} : { isActive: true },
      order: { name: 'ASC' },
    });
  }

  async get(id: string) {
    const item = await this.repo.findOne({ where: { id } });
    if (!item) throw new NotFoundException('Location not found');
    return item;
  }

  async update(id: string, dto: UpdateGymLocationDto) {
    const item = await this.get(id);

    if (dto.name !== undefined) item.name = dto.name;
    if (dto.address !== undefined) item.address = dto.address ?? null;
    if (dto.notes !== undefined) item.notes = dto.notes ?? null;

    return this.repo.save(item);
  }

  // Recommended delete: soft delete
  async deactivate(id: string) {
    const item = await this.get(id);
    item.isActive = false;
    return this.repo.save(item);
  }

  // Optional: hard delete (use carefully)
  async hardDelete(id: string) {
    const item = await this.get(id);
    await this.repo.remove(item);
    return { deleted: true };
  }
}
