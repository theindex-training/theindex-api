import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { CreateManualCashRegisterTransactionDto } from './dto/create-manual-cash-register-transaction.dto';
import { CashRegisterKvEntity } from './cash-register-kv.entity';
import { CashRegisterTransactionEntity } from './cash-register-transaction.entity';
import { CashRegisterTransactionSourceType } from './enums/cash-register-transaction-source-type.enum';
import { CashRegisterTransactionType } from './enums/cash-register-transaction-type.enum';

const CASH_REGISTER_BALANCE_KEY = 'cash_register_balance_cents';

@Injectable()
export class CashRegisterService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CashRegisterKvEntity)
    private readonly kvRepo: Repository<CashRegisterKvEntity>,
    @InjectRepository(CashRegisterTransactionEntity)
    private readonly txRepo: Repository<CashRegisterTransactionEntity>,
  ) {}

  async getCurrentState() {
    const balance = await this.getCurrentBalanceCents();
    const transactions = await this.txRepo.find({
      order: { createdAt: 'DESC' },
    });

    return {
      balanceCents: balance,
      transactions,
    };
  }

  async createManualTransaction(dto: CreateManualCashRegisterTransactionDto) {
    const amountCents =
      dto.direction === 'IN' ? dto.amountCents : -dto.amountCents;

    return this.dataSource.transaction(async (manager) =>
      this.applyTransaction(manager, {
        amountCents,
        type:
          dto.direction === 'IN'
            ? CashRegisterTransactionType.MANUAL_IN
            : CashRegisterTransactionType.MANUAL_OUT,
        sourceType: CashRegisterTransactionSourceType.MANUAL,
        sourceId: null,
        notes: dto.notes ?? null,
      }),
    );
  }

  async registerSubscriptionPayment(
    manager: EntityManager,
    sourceId: string,
    amountCents: number,
  ) {
    if (amountCents === 0) return null;

    return this.applyTransaction(manager, {
      amountCents,
      type: CashRegisterTransactionType.SUBSCRIPTION_IN,
      sourceType: CashRegisterTransactionSourceType.SUBSCRIPTION,
      sourceId,
      notes: null,
    });
  }

  async registerSettlementFinalization(
    manager: EntityManager,
    sourceId: string,
    amountCents: number,
  ) {
    if (amountCents === 0) return null;

    return this.applyTransaction(manager, {
      amountCents: -amountCents,
      type: CashRegisterTransactionType.SETTLEMENT_OUT,
      sourceType: CashRegisterTransactionSourceType.SETTLEMENT,
      sourceId,
      notes: null,
    });
  }

  private async getCurrentBalanceCents(): Promise<number> {
    const row = await this.kvRepo.findOne({
      where: { key: CASH_REGISTER_BALANCE_KEY },
    });

    if (!row) return 0;
    return Number(row.value);
  }

  private async applyTransaction(
    manager: EntityManager,
    params: {
      amountCents: number;
      type: CashRegisterTransactionType;
      sourceType: CashRegisterTransactionSourceType;
      sourceId: string | null;
      notes: string | null;
    },
  ) {
    if (params.amountCents === 0) {
      throw new BadRequestException(
        'Cash register transaction amount cannot be zero',
      );
    }

    const txRepo = manager.getRepository(CashRegisterTransactionEntity);
    if (params.sourceId) {
      const existing = await txRepo.findOne({
        where: { sourceType: params.sourceType, sourceId: params.sourceId },
      });
      if (existing) return existing;
    }

    const kvRepo = manager.getRepository(CashRegisterKvEntity);

    let balanceRow = await kvRepo
      .createQueryBuilder('kv')
      .setLock('pessimistic_write')
      .where('kv.key = :key', { key: CASH_REGISTER_BALANCE_KEY })
      .getOne();

    if (!balanceRow) {
      balanceRow = kvRepo.create({
        key: CASH_REGISTER_BALANCE_KEY,
        value: '0',
      });
      await kvRepo.save(balanceRow);

      balanceRow = await kvRepo
        .createQueryBuilder('kv')
        .setLock('pessimistic_write')
        .where('kv.key = :key', { key: CASH_REGISTER_BALANCE_KEY })
        .getOneOrFail();
    }

    const currentBalance = Number(balanceRow.value);
    const nextBalance = currentBalance + params.amountCents;

    if (nextBalance < 0) {
      throw new BadRequestException('Cash register balance cannot be negative');
    }

    balanceRow.value = String(nextBalance);
    await kvRepo.save(balanceRow);

    const tx = txRepo.create({
      type: params.type,
      amountCents: params.amountCents,
      balanceAfterCents: nextBalance,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      notes: params.notes,
    });

    return txRepo.save(tx);
  }
}
