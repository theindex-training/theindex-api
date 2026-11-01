/**
 * `fromGymLocalToUtc` reads the gym-local wall clock through
 * `Intl.DateTimeFormat(..., { hour12: false })`. The hour cycle that option
 * resolves to depends on the Node/ICU build: Node 20 (`.nvmrc`, CI and the
 * `node:20-alpine` production image) resolves `h24`, so midnight is rendered
 * as hour 24 of the same day; Node 22 resolves `h23` (hour 00). That changes
 * the converted instant for every gym-local time in the 00:xx hour.
 *
 * Tests that pin 00:xx results call this first, so running them on another
 * runtime fails with an explanation instead of a confusing date mismatch.
 */
export function gymClockHourCycle(): string | undefined {
  // Same options as getDatePartsInTimeZone in attendance-timezone.util.ts.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Sofia',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).resolvedOptions().hourCycle;
}

export function requireProductionHourCycle(): void {
  const hourCycle = gymClockHourCycle();
  if (hourCycle !== 'h24') {
    throw new Error(
      `This test pins production behavior on Node 20 (.nvmrc, node:20-alpine), where ` +
        `Intl resolves hour12:false to hourCycle "h24". This runtime (Node ${process.versions.node}, ` +
        `ICU ${process.versions.icu}) resolves "${hourCycle}". Run Jest with Node 20.`,
    );
  }
}
