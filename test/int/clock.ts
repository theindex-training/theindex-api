/**
 * INF-04: freeze business "now" by faking only `Date`. Faking setTimeout,
 * nextTick etc. breaks the pg driver and Nest. Values written by the DB
 * (`@CreateDateColumn`) still come from the Postgres clock.
 */
export function freezeTime(at: string | Date): void {
  jest.useFakeTimers({
    now: new Date(at),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
      'setTimeout',
      'clearTimeout',
    ],
  });
}

export function restoreTime(): void {
  jest.useRealTimers();
}

/**
 * CRON-02 exception to INF-04: fakes `Date` **and** `setTimeout`/`clearTimeout`
 * so a test can drive a `setTimeout`-based scheduler with
 * `jest.advanceTimersByTimeAsync`. Everything else stays real (`nextTick`,
 * `setImmediate`, microtasks), which is what the `pg` driver needs to keep
 * working while timeouts are fake. pg-pool's idle-client timers become fake
 * too; when they fire, idle clients are closed and the pool reconnects.
 */
export function freezeTimeAndTimeouts(at: string | Date): void {
  jest.useFakeTimers({
    now: new Date(at),
    doNotFake: [
      'hrtime',
      'nextTick',
      'performance',
      'queueMicrotask',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'requestIdleCallback',
      'cancelIdleCallback',
      'setImmediate',
      'clearImmediate',
      'setInterval',
      'clearInterval',
    ],
  });
}
