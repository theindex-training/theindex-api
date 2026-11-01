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
