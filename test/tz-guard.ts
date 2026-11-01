// INF-03: several date helpers use server-local time, so every Jest run must
// be pinned to UTC (the npm scripts prefix `TZ=UTC`). Fail loudly otherwise
// instead of silently producing timezone-dependent expectations.
if (new Date(2025, 0, 1).getTimezoneOffset() !== 0) {
  throw new Error(
    `Tests must run with TZ=UTC (got TZ=${process.env.TZ ?? '<unset>'}). Use the npm test scripts.`,
  );
}
