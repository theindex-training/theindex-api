export enum CashRegisterTransactionType {
  SUBSCRIPTION_IN = 'SUBSCRIPTION_IN',
  /** A deleted subscription's sale taken back out (the opposite of its `SUBSCRIPTION_IN`). */
  SUBSCRIPTION_REVERSAL = 'SUBSCRIPTION_REVERSAL',
  SETTLEMENT_OUT = 'SETTLEMENT_OUT',
  MANUAL_IN = 'MANUAL_IN',
  MANUAL_OUT = 'MANUAL_OUT',
}
