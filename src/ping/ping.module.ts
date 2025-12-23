import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PingController } from './ping.controller';
import { Ping } from './ping.entity';
import { PingService } from './ping.service';

@Module({
  imports: [TypeOrmModule.forFeature([Ping])],
  controllers: [PingController],
  providers: [PingService],
})
export class PingModule {}
