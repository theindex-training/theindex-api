import { randomUUID } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import { rejectionOf } from '../../test/int/fixtures';
import { setupIntegrationSuite } from '../../test/int/test-app';
import { CashRegisterKvEntity } from './cash-register-kv.entity';
import { CashRegisterTransactionType } from './enums/cash-register-transaction-type.enum';

describe('CashRegisterService (integration)', () => {
  const fixtures = setupIntegrationSuite();

  it('CR-01 manual IN stores a positive MANUAL_IN tx with notes and running balance', async () => {
    const fx = fixtures();

    const tx = await fx.cashRegister.createManualTransaction({
      direction: 'IN',
      amountCents: 5000,
      notes: 'Opening float',
    });
    const noNotes = await fx.cashIn(250);

    expect(tx).toMatchObject({
      type: 'MANUAL_IN',
      amountCents: 5000,
      balanceAfterCents: 5000,
      sourceType: 'MANUAL',
      sourceId: null,
      notes: 'Opening float',
    });
    expect(noNotes.notes).toBeNull();
    expect(noNotes.balanceAfterCents).toBe(5250);
    expect(await fx.balance()).toBe(5250);
    expect(await fx.cashTxs()).toHaveLength(2);
  });

  it('CR-02 manual OUT stores a negative amount; overdraw is rejected and rolled back', async () => {
    const fx = fixtures();
    await fx.cashIn(5000);

    const out = await fx.cashOut(2000);
    expect(out).toMatchObject({
      type: 'MANUAL_OUT',
      amountCents: -2000,
      balanceAfterCents: 3000,
      sourceType: 'MANUAL',
    });

    const err = await rejectionOf(fx.cashOut(3001));
    expect(err).toBeInstanceOf(BadRequestException);
    expect(err.message).toBe('Cash register balance cannot be negative');
    expect(await fx.cashTxs()).toHaveLength(2);
    expect(await fx.balance()).toBe(3000);
  });

  it('CR-03 OUT that brings the balance to exactly 0 is allowed', async () => {
    const fx = fixtures();
    await fx.cashIn(1200);

    const out = await fx.cashOut(1200);

    expect(out.balanceAfterCents).toBe(0);
    expect(await fx.balance()).toBe(0);
  });

  it('CR-04 empty register reports 0 and the first tx creates the balance row from 0', async () => {
    const fx = fixtures();
    const kvRepo = fx.ds.getRepository(CashRegisterKvEntity);

    expect(await fx.cashRegister.getCurrentState()).toEqual({
      balanceCents: 0,
      total: 0,
      limit: 50,
      offset: 0,
      transactions: [],
    });
    expect(await kvRepo.count()).toBe(0);

    await fx.cashIn(700);

    const rows = await kvRepo.find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      key: 'cash_register_balance_cents',
      value: '700',
    });
  });

  it('CR-05 every balanceAfterCents is the cumulative sum and balanceCents is the last one', async () => {
    const fx = fixtures();
    const trainee = await fx.trainee();
    const plan = await fx.punchPlan(10, 2500);

    await fx.cashIn(1000);
    await fx.cashOut(300);
    await fx.buy(trainee.id, plan.id); // SUBSCRIPTION_IN +2500
    await fx.cashOut(200);

    const txs = await fx.cashTxs();
    expect(txs.map((t) => t.amountCents)).toEqual([1000, -300, 2500, -200]);
    expect(txs.map((t) => t.balanceAfterCents)).toEqual([
      1000, 700, 3200, 3000,
    ]);

    const state = await fx.cashRegister.getCurrentState();
    const sum = txs.reduce((acc, t) => acc + t.amountCents, 0);
    expect(state.balanceCents).toBe(3000);
    expect(state.balanceCents).toBe(sum);
    expect(state.transactions[0].balanceAfterCents).toBe(state.balanceCents);
  });

  it('CR-06 automatic txs are idempotent per (sourceType, sourceId)', async () => {
    const fx = fixtures();
    const sourceId = randomUUID();

    const first = await fx.ds.transaction((m) =>
      fx.cashRegister.registerSubscriptionPayment(m, sourceId, 4000),
    );
    const second = await fx.ds.transaction((m) =>
      fx.cashRegister.registerSubscriptionPayment(m, sourceId, 4000),
    );

    expect(second!.id).toBe(first!.id);
    expect(await fx.cashTxs()).toHaveLength(1);
    expect(await fx.balance()).toBe(4000);

    // Same id for a different source type is a different source.
    const out = await fx.ds.transaction((m) =>
      fx.cashRegister.registerSettlementFinalization(m, sourceId, 1000),
    );
    expect(out).toMatchObject({
      type: 'SETTLEMENT_OUT',
      sourceType: 'SETTLEMENT',
      amountCents: -1000,
      balanceAfterCents: 3000,
    });
    expect(await fx.cashTxs()).toHaveLength(2);
  });

  it('CR-07 zero-amount automatic txs return null and change nothing', async () => {
    const fx = fixtures();
    await fx.cashIn(900);

    const sub = await fx.ds.transaction((m) =>
      fx.cashRegister.registerSubscriptionPayment(m, randomUUID(), 0),
    );
    const settle = await fx.ds.transaction((m) =>
      fx.cashRegister.registerSettlementFinalization(m, randomUUID(), 0),
    );

    expect(sub).toBeNull();
    expect(settle).toBeNull();
    expect(await fx.cashTxs()).toHaveLength(1);
    expect(await fx.balance()).toBe(900);
  });

  it('CR-08 getCurrentState orders by createdAt DESC and enriches source details', async () => {
    const fx = fixtures();
    const trainee = await fx.trainee('Ivan Petrov', { nickname: 'Vanko' });
    const trainer = await fx.trainer();
    const loc = await fx.location();
    const plan = await fx.punchPlan(2, 3000, { title: 'Two pack' });

    const manual = await fx.cashIn(10000);
    const sub = await fx.boughtAt(
      (await fx.buy(trainee.id, plan.id)).id,
      '2025-11-01T10:00:00Z',
    );
    await fx.attend(trainee.id, trainer.id, loc.id, '2025-12-05T10:00:00Z');
    const settlement = await fx.report('2025-12-01', '2025-12-15');
    await fx.settlements.finalize(settlement.id);

    const state = await fx.cashRegister.getCurrentState();

    expect(state.transactions.map((t) => t.type)).toEqual([
      'SETTLEMENT_OUT',
      'SUBSCRIPTION_IN',
      'MANUAL_IN',
    ]);
    const [settleTx, subTx, manualTx] = state.transactions;
    expect(settleTx.sourceDetails).toEqual({
      periodStart: '2025-12-01',
      periodEnd: '2025-12-15',
    });
    expect(subTx.sourceDetails).toEqual({
      boughtBy: {
        traineeId: trainee.id,
        name: 'Ivan Petrov',
        nickname: 'Vanko',
      },
      purchasedAt: sub.createdAt,
      subscriptionType: 'PUNCH',
      planTitle: 'Two pack',
    });
    expect(manualTx.id).toBe(manual.id);
    expect(manualTx.sourceDetails).toBeNull();
    expect(state.balanceCents).toBe(10000 + 3000 - 1500);
  });

  it('CR-09 parallel OUTs never overdraw and the balance equals the committed txs', async () => {
    const fx = fixtures();
    await fx.cashIn(1000);

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => fx.cashOut(300)),
    );

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    expect(fulfilled).toHaveLength(3);
    const txs = await fx.cashTxs();
    const sum = txs.reduce((acc, t) => acc + t.amountCents, 0);
    expect(await fx.balance()).toBe(100);
    expect(sum).toBe(100);
    expect(txs.map((t) => t.balanceAfterCents).sort((a, b) => b - a)).toEqual([
      1000, 700, 400, 100,
    ]);
  });
  describe('CR-12 transactions are paged', () => {
    it('CR-12 gives the newest 50 by default, with the total; offset/limit give the next page', async () => {
      const fx = fixtures();
      for (let i = 1; i <= 53; i++) {
        await fx.cashIn(i * 100);
      }
      const balance = (53 * 54 * 100) / 2;

      const first = await fx.cashRegister.getCurrentState();
      expect(first).toMatchObject({
        balanceCents: balance,
        total: 53,
        limit: 50,
        offset: 0,
      });
      expect(first.transactions).toHaveLength(50);
      expect(first.transactions[0].amountCents).toBe(5300);
      expect(first.transactions[49].amountCents).toBe(400);

      const rest = await fx.cashRegister.getCurrentState({
        offset: 50,
        limit: 50,
      });
      expect(rest).toMatchObject({ total: 53, limit: 50, offset: 50 });
      expect(rest.transactions.map((t) => t.amountCents)).toEqual([
        300, 200, 100,
      ]);
      // The balance is the register's, whatever the page.
      expect(rest.balanceCents).toBe(balance);

      const past = await fx.cashRegister.getCurrentState({ offset: 60 });
      expect(past).toMatchObject({ total: 53, offset: 60 });
      expect(past.transactions).toEqual([]);
    });

    it('CR-12 transactions of the same moment come by id, so pages neither overlap nor skip', async () => {
      const fx = fixtures();
      await fx.cashIn(100);
      // One database transaction: the rows share createdAt.
      await fx.ds.transaction(async (m) => {
        for (let i = 1; i <= 5; i++) {
          await fx.cashRegister.registerSubscriptionPayment(
            m,
            randomUUID(),
            i * 1000,
          );
        }
      });

      const all = await fx.cashRegister.getCurrentState();
      const sameMoment = all.transactions.filter(
        (t) => t.type === CashRegisterTransactionType.SUBSCRIPTION_IN,
      );
      expect(new Set(sameMoment.map((t) => t.createdAt.getTime())).size).toBe(
        1,
      );
      expect(sameMoment.map((t) => t.id)).toEqual(
        sameMoment
          .map((t) => t.id)
          .sort()
          .reverse(),
      );

      const paged: string[] = [];
      for (let offset = 0; offset < 6; offset += 2) {
        const page = await fx.cashRegister.getCurrentState({
          offset,
          limit: 2,
        });
        expect(page.total).toBe(6);
        paged.push(...page.transactions.map((t) => t.id));
      }
      expect(paged).toEqual(all.transactions.map((t) => t.id));
      expect(all.transactions[5].type).toBe('MANUAL_IN');
    });

    it('CR-12 the rows of a later page get their source details', async () => {
      const fx = fixtures();
      const trainee = await fx.trainee('Maria Ivanova');
      const plan = await fx.punchPlan(4, 6000, { title: 'Four pack' });
      const sub = await fx.buy(trainee.id, plan.id);
      await fx.cashIn(100);
      await fx.cashIn(200);

      const page = await fx.cashRegister.getCurrentState({
        offset: 2,
        limit: 2,
      });

      expect(page.total).toBe(3);
      expect(page.transactions).toHaveLength(1);
      expect(page.transactions[0]).toMatchObject({
        type: 'SUBSCRIPTION_IN',
        sourceId: sub.id,
        sourceDetails: {
          boughtBy: { traineeId: trainee.id, name: 'Maria Ivanova' },
          planTitle: 'Four pack',
          subscriptionType: 'PUNCH',
        },
      });
    });
  });
});
