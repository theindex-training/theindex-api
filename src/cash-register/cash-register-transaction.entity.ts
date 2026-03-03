import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { CashRegisterTransactionSourceType } from './enums/cash-register-transaction-source-type.enum';
import { CashRegisterTransactionType } from './enums/cash-register-transaction-type.enum';

@Entity('cash_register_transactions')
@Index(['createdAt'])
@Index(['sourceType', 'sourceId'], { unique: true })
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

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt!: Date;
}
