import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SettlementEntity } from '../settlements/settlement.entity';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { CashRegisterController } from './cash-register.controller';
import { CashRegisterKvEntity } from './cash-register-kv.entity';
import { CashRegisterService } from './cash-register.service';
import { CashRegisterTransactionEntity } from './cash-register-transaction.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      CashRegisterKvEntity,
      CashRegisterTransactionEntity,
      SubscriptionEntity,
      SettlementEntity,
    ]),
  ],
  controllers: [CashRegisterController],
  providers: [CashRegisterService],
  exports: [CashRegisterService],
})
export class CashRegisterModule {}
