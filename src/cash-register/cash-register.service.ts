import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { CreateManualCashRegisterTransactionDto } from './dto/create-manual-cash-register-transaction.dto';
import { CashRegisterKvEntity } from './cash-register-kv.entity';
import { CashRegisterTransactionEntity } from './cash-register-transaction.entity';
import { CashRegisterTransactionSourceType } from './enums/cash-register-transaction-source-type.enum';
import { CashRegisterTransactionType } from './enums/cash-register-transaction-type.enum';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { SettlementEntity } from '../settlements/settlement.entity';

const CASH_REGISTER_BALANCE_KEY = 'cash_register_balance_cents';

@Injectable()
export class CashRegisterService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(CashRegisterKvEntity)
    private readonly kvRepo: Repository<CashRegisterKvEntity>,
    @InjectRepository(CashRegisterTransactionEntity)
    private readonly txRepo: Repository<CashRegisterTransactionEntity>,
    @InjectRepository(SubscriptionEntity)
    private readonly subscriptionRepo: Repository<SubscriptionEntity>,
    @InjectRepository(SettlementEntity)
    private readonly settlementRepo: Repository<SettlementEntity>,
  ) {}

  async getCurrentState() {
    const balance = await this.getCurrentBalanceCents();
    const transactions = await this.txRepo.find({
      order: { createdAt: 'DESC' },
    });
    const enrichedTransactions = await this.enrichTransactions(transactions);

    return {
      balanceCents: balance,
      transactions: enrichedTransactions,
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

  private async enrichTransactions(transactions: CashRegisterTransactionEntity[]) {
    const subscriptionIds = Array.from(
      new Set(
        transactions
          .filter(
            (tx) =>
              tx.type === CashRegisterTransactionType.SUBSCRIPTION_IN &&
              tx.sourceType === CashRegisterTransactionSourceType.SUBSCRIPTION &&
              !!tx.sourceId,
          )
          .map((tx) => tx.sourceId as string),
      ),
    );

    const settlementIds = Array.from(
      new Set(
        transactions
          .filter(
            (tx) =>
              tx.type === CashRegisterTransactionType.SETTLEMENT_OUT &&
              tx.sourceType === CashRegisterTransactionSourceType.SETTLEMENT &&
              !!tx.sourceId,
          )
          .map((tx) => tx.sourceId as string),
      ),
    );

    const subscriptions = subscriptionIds.length
      ? await this.subscriptionRepo.find({
          where: { id: In(subscriptionIds) },
          relations: { trainee: true, plan: true },
        })
      : [];

    const settlements = settlementIds.length
      ? await this.settlementRepo.find({
          where: { id: In(settlementIds) },
        })
      : [];

    const subscriptionsById = new Map(subscriptions.map((s) => [s.id, s]));
    const settlementsById = new Map(settlements.map((s) => [s.id, s]));

    return transactions.map((tx) => {
      if (
        tx.type === CashRegisterTransactionType.SUBSCRIPTION_IN &&
        tx.sourceType === CashRegisterTransactionSourceType.SUBSCRIPTION &&
        tx.sourceId
      ) {
        const subscription = subscriptionsById.get(tx.sourceId);
        return {
          ...tx,
          sourceDetails: subscription
            ? {
                boughtBy: {
                  traineeId: subscription.traineeId,
                  name: subscription.trainee.name,
                  nickname: subscription.trainee.nickname,
                },
                purchasedAt: subscription.createdAt,
                subscriptionType: subscription.type,
                planTitle: subscription.plan.title,
              }
            : null,
        };
      }

      if (
        tx.type === CashRegisterTransactionType.SETTLEMENT_OUT &&
        tx.sourceType === CashRegisterTransactionSourceType.SETTLEMENT &&
        tx.sourceId
      ) {
        const settlement = settlementsById.get(tx.sourceId);
        return {
          ...tx,
          sourceDetails: settlement
            ? {
                periodStart: settlement.periodStart,
                periodEnd: settlement.periodEnd,
              }
            : null,
        };
      }

      return {
        ...tx,
        sourceDetails: null,
      };
    });
  }
}
