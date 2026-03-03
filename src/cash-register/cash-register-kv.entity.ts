import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

@Entity('cash_register_kv')
export class CashRegisterKvEntity {
  @PrimaryColumn({ type: 'varchar', length: 120 })
  key!: string;

  @Column({ type: 'bigint' })
  value!: string;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt!: Date;
}
