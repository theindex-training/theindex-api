import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import { CreateManualCashRegisterTransactionDto } from './dto/create-manual-cash-register-transaction.dto';
import { CashRegisterKvEntity } from './cash-register-kv.entity';
import {
  CashRegisterTransactionEntity,
  SubscriptionSaleSnapshot,
} from './cash-register-transaction.entity';
import { CashRegisterTransactionSourceType } from './enums/cash-register-transaction-source-type.enum';
import { CashRegisterTransactionType } from './enums/cash-register-transaction-type.enum';
import { SubscriptionEntity } from '../subscriptions/subscription.entity';
import { SettlementEntity } from '../settlements/settlement.entity';
import { TraineeProfileEntity } from '../trainee-profiles/trainee-profile.entity';

const CASH_REGISTER_BALANCE_KEY = 'cash_register_balance_cents';
const DEFAULT_TRANSACTIONS_LIMIT = 50;

const SUBSCRIPTION_TYPES: CashRegisterTransactionType[] = [
  CashRegisterTransactionType.SUBSCRIPTION_IN,
  CashRegisterTransactionType.SUBSCRIPTION_REVERSAL,
];

/** Cents as the API's messages show money: "70.00 EUR". */
function euros(cents: number): string {
  return `${(cents / 100).toFixed(2)} EUR`;
}

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
    @InjectRepository(TraineeProfileEntity)
    private readonly traineeRepo: Repository<TraineeProfileEntity>,
  ) {}

  /**
   * The balance and one page of the transactions, newest first (50 by default). `total` counts
   * every transaction; only the page's ones get their source details. Transactions made at the
   * same moment (one database transaction) come by id, so the pages never overlap.
   */
  async getCurrentState(query: { offset?: number; limit?: number } = {}) {
    const limit = query.limit ?? DEFAULT_TRANSACTIONS_LIMIT;
    const offset = query.offset ?? 0;
    const balance = await this.getCurrentBalanceCents();
    const [transactions, total] = await this.txRepo.findAndCount({
      order: { createdAt: 'DESC', id: 'DESC' },
      skip: offset,
      take: limit,
    });
    const enrichedTransactions = await this.enrichTransactions(transactions);

    return {
      balanceCents: balance,
      total,
      limit,
      offset,
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

  /**
   * Takes a deleted subscription's sale back out (`SUBSCRIPTION_REVERSAL`, the amount its
   * `SUBSCRIPTION_IN` put in), in the deleting transaction. Nothing when the sale put nothing in.
   * 409 when the cash register holds less than that, since the balance never goes below 0.
   */
  async reverseSubscriptionPayment(
    manager: EntityManager,
    subscriptionId: string,
    sale: SubscriptionSaleSnapshot,
  ) {
    const paid = await manager
      .getRepository(CashRegisterTransactionEntity)
      .findOne({
        where: {
          type: CashRegisterTransactionType.SUBSCRIPTION_IN,
          sourceType: CashRegisterTransactionSourceType.SUBSCRIPTION,
          sourceId: subscriptionId,
        },
      });
    if (!paid || paid.amountCents === 0) return null;

    return this.applyTransaction(manager, {
      amountCents: -paid.amountCents,
      type: CashRegisterTransactionType.SUBSCRIPTION_REVERSAL,
      sourceType: CashRegisterTransactionSourceType.SUBSCRIPTION,
      sourceId: subscriptionId,
      notes: null,
      sourceSnapshot: sale,
      whenShort: (balanceCents) =>
        new ConflictException(
          `The cash register holds ${euros(balanceCents)}, less than the ${euros(paid.amountCents)} this subscription was sold for, so its sale cannot be taken back out. Put the missing amount in first.`,
        ),
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
      sourceSnapshot?: SubscriptionSaleSnapshot | null;
      /** The error to answer when the balance would go below 0 (a 400 by default). */
      whenShort?: (balanceCents: number) => Error;
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
        where: {
          type: params.type,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
        },
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
      if (params.whenShort) throw params.whenShort(currentBalance);
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
      sourceSnapshot: params.sourceSnapshot ?? null,
    });

    return txRepo.save(tx);
  }

  /**
   * Adds `sourceDetails`: a subscription's sale (who bought which plan, and `deletedAt` once it was
   * deleted and its sale taken back out) on both of its rows, or a settlement's period.
   */
  private async enrichTransactions(
    transactions: CashRegisterTransactionEntity[],
  ) {
    const isSubscriptionTx = (tx: CashRegisterTransactionEntity) =>
      SUBSCRIPTION_TYPES.includes(tx.type) &&
      tx.sourceType === CashRegisterTransactionSourceType.SUBSCRIPTION &&
      !!tx.sourceId;

    const subscriptionIds = Array.from(
      new Set(transactions.filter(isSubscriptionTx).map((tx) => tx.sourceId!)),
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

    const [subscriptions, reversals, settlements] = await Promise.all([
      subscriptionIds.length
        ? this.subscriptionRepo.find({
            where: { id: In(subscriptionIds) },
            relations: { trainee: true, plan: true },
          })
        : ([] as SubscriptionEntity[]),
      subscriptionIds.length
        ? this.txRepo.find({
            where: {
              type: CashRegisterTransactionType.SUBSCRIPTION_REVERSAL,
              sourceType: CashRegisterTransactionSourceType.SUBSCRIPTION,
              sourceId: In(subscriptionIds),
            },
          })
        : ([] as CashRegisterTransactionEntity[]),
      settlementIds.length
        ? this.settlementRepo.find({
            where: { id: In(settlementIds) },
          })
        : ([] as SettlementEntity[]),
    ]);

    const reversalsBySubscription = new Map(
      reversals.map((tx) => [tx.sourceId!, tx]),
    );
    const deletedTraineeIds = Array.from(
      new Set(
        reversals
          .map((tx) => tx.sourceSnapshot?.traineeId)
          .filter((id): id is string => !!id),
      ),
    );
    const trainees = deletedTraineeIds.length
      ? await this.traineeRepo.find({ where: { id: In(deletedTraineeIds) } })
      : [];

    const subscriptionsById = new Map(subscriptions.map((s) => [s.id, s]));
    const traineesById = new Map(trainees.map((t) => [t.id, t]));
    const settlementsById = new Map(settlements.map((s) => [s.id, s]));

    const buyer = (trainee: TraineeProfileEntity | undefined) =>
      trainee
        ? {
            traineeId: trainee.id,
            name: trainee.name,
            nickname: trainee.nickname,
          }
        : null;

    const saleDetails = (subscriptionId: string) => {
      const subscription = subscriptionsById.get(subscriptionId);
      if (subscription) {
        return {
          boughtBy: buyer(subscription.trainee),
          purchasedAt: subscription.createdAt,
          subscriptionType: subscription.type,
          planTitle: subscription.plan.title,
          deletedAt: null,
        };
      }
      const reversal = reversalsBySubscription.get(subscriptionId);
      const sale = reversal?.sourceSnapshot;
      if (!reversal || !sale) return null;
      return {
        boughtBy: buyer(traineesById.get(sale.traineeId)),
        purchasedAt: new Date(sale.purchasedAt),
        subscriptionType: sale.subscriptionType,
        planTitle: sale.planTitle,
        deletedAt: reversal.createdAt,
      };
    };

    return transactions.map((tx) => {
      if (isSubscriptionTx(tx)) {
        return { ...tx, sourceDetails: saleDetails(tx.sourceId!) };
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
