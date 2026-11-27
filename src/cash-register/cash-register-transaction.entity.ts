import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CashRegisterTransactionSourceType } from './enums/cash-register-transaction-source-type.enum';
import { CashRegisterTransactionType } from './enums/cash-register-transaction-type.enum';
import { PlanType } from '../common/enums/plan-type.enum';

/** A deleted subscription's sale: the trainee by id (their name is read when shown), never a copy of personal data. */
export interface SubscriptionSaleSnapshot {
  traineeId: string;
  planTitle: string;
  subscriptionType: PlanType;
  purchasedAt: string;
}

@Entity('cash_register_transactions')
@Index(['createdAt'])
// One transaction of each type per source: a subscription has its sale and, once deleted, the sale
// taken back out.
@Index(['type', 'sourceType', 'sourceId'], { unique: true })
export class CashRegisterTransactionEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({
    type: 'enum',
    enum: CashRegisterTransactionType,
  })
  type!: CashRegisterTransactionType;

  @Column({ type: 'int' })
  amountCents!: number;

  @Column({ type: 'int' })
  balanceAfterCents!: number;

  @Column({
    type: 'enum',
    enum: CashRegisterTransactionSourceType,
  })
  sourceType!: CashRegisterTransactionSourceType;

  @Column({ type: 'uuid', nullable: true })
  sourceId!: string | null;

  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /**
   * What the source was, kept for when it is gone: a `SUBSCRIPTION_REVERSAL` keeps the deleted
   * subscription's sale (`SubscriptionSaleSnapshot`), so both of its rows can still say what was
   * sold to whom. Null for every other transaction.
   */
  @Column({ type: 'jsonb', nullable: true })
  sourceSnapshot!: SubscriptionSaleSnapshot | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
