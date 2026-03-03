import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AttendanceEntity } from '../attendance/attendance.entity';
import { CashRegisterModule } from '../cash-register/cash-register.module';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { SettlementAllocationEntity } from './settlement-allocation.entity';
import { SettlementLineEntity } from './settlement-line.entity';
import { SettlementEntity } from './settlement.entity';
import { SettlementsController } from './settlements.controller';
import { SettlementsService } from './settlements.service';

@Module({
  imports: [
    CashRegisterModule,
    TypeOrmModule.forFeature([
      SettlementEntity,
      SettlementLineEntity,
      SettlementAllocationEntity,
      AttendanceEntity,
      SubscriptionEntity,
    ]),
  ],
  controllers: [SettlementsController],
  providers: [SettlementsService],
  exports: [SettlementsService],
})
export class SettlementsModule {}
