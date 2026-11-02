// DT-06: the Europe/Sofia variant of test/tz-guard.ts. Suites matching
// `*.sofia-spec.ts` / `*.sofia-int-spec.ts` document how the server-local-time
// helpers behave if production runs with TZ=Europe/Sofia (TEST_PLAN Q1), so
// they must actually run in that zone. A Jest setup file can't switch the
// zone (the sandbox gets a copy of process.env), so the npm script sets it.
if (
  new Date(2025, 0, 1).getTimezoneOffset() !== -120 ||
  new Date(2025, 6, 1).getTimezoneOffset() !== -180
) {
  throw new Error(
    `Sofia suites must run with TZ=Europe/Sofia (got TZ=${process.env.TZ ?? '<unset>'}). Use npm run test:tz-sofia.`,
  );
}
