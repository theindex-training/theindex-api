import { CashRegisterService } from './cash-register.service';

describe('CashRegisterService zero-amount automatic transactions', () => {
  it('registerSubscriptionPayment should skip zero-amount transactions', async () => {
    const service = new CashRegisterService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const applySpy = jest.spyOn(service as any, 'applyTransaction');

    const result = await service.registerSubscriptionPayment(
      {} as any,
      'source-id',
      0,
    );

    expect(result).toBeNull();
    expect(applySpy).not.toHaveBeenCalled();
  });

  it('registerSettlementFinalization should skip zero-amount transactions', async () => {
    const service = new CashRegisterService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );

    const applySpy = jest.spyOn(service as any, 'applyTransaction');

    const result = await service.registerSettlementFinalization(
      {} as any,
      'source-id',
      0,
    );

    expect(result).toBeNull();
    expect(applySpy).not.toHaveBeenCalled();
  });
});
