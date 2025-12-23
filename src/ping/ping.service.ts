import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Ping } from './ping.entity';

@Injectable()
export class PingService {
  constructor(
    @InjectRepository(Ping)
    private readonly repo: Repository<Ping>,
  ) {}

  async createHello() {
    return this.repo.save(this.repo.create({ message: 'Hello, world' }));
  }

  async list() {
    return this.repo.find();
  }
}
