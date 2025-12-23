import { Controller, Get, Post } from '@nestjs/common';
import { PingService } from './ping.service';

@Controller('ping')
export class PingController {
  constructor(private readonly pingService: PingService) {}

  @Post()
  create() {
    return this.pingService.createHello();
  }

  @Get()
  list() {
    return this.pingService.list();
  }
}
