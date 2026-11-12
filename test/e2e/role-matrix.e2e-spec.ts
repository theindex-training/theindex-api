import { E2E_ADMIN, jwtPayload, messageOf, setupE2eSuite } from './e2e-app';

/**
 * AUTH-11: route x role matrix (TEST_PLAN.md Appendix A), driven by data.
 *
 * Every route the app registers must have exactly one row here (the first
 * test enforces it), so adding a route without deciding its access fails CI.
 *
 * Access values:
 * - `PUBLIC`: no JWT needed; never 401/403.
 * - `ALLOW`: the guard lets the role through; the result is anything but
 *   401/403 (usually 400/404 because the ids are random and bodies minimal).
 * - `GUARD`: RolesGuard denies -> 403 `Forbidden resource`.
 * - `{ handler }`: the guard allows, the handler denies -> 403 with that
 *   message.
 * - `{ own }` (TRAINEE only): allowed for the trainee's own id (account id
 *   or trainee profile id, see `ownKind`), 403 with that message for any
 *   other id.
 */
type Access =
  | 'PUBLIC'
  | 'ALLOW'
  | 'GUARD'
  | { handler: string }
  | { own: string; ownKind: 'account' | 'trainee' };

type Row = {
  /** `METHOD /path` without the `/api` prefix, as declared in Nest. */
  route: string;
  ADMIN: Access;
  TRAINER: Access;
  TRAINEE: Access;
  body?: object;
};

const PUBLIC = 'PUBLIC';
const ALLOW = 'ALLOW';
const GUARD = 'GUARD';

const OWN_ACCOUNT = {
  own: 'TRAINEE can only access their own account password endpoints',
  ownKind: 'account',
} as const;
const OWN_SUBSCRIPTIONS = {
  own: 'TRAINEE can only access subscriptions for their own trainee profile',
  ownKind: 'trainee',
} as const;
const OWN_TRAININGS = {
  own: 'TRAINEE can only access trainings for their own trainee profile',
  ownKind: 'trainee',
} as const;

const PERIOD = { periodStart: '2025-12-01', periodEnd: '2025-12-31' };
// Valid ChangePasswordDto, so a TRAINEE on someone else's id reaches the
// handler check (pipes run before the handler) instead of failing with 400.
const CHANGE_PASSWORD = {
  newPassword: 'new-password-1',
  confirmPassword: 'new-password-1',
};

const r = (
  route: string,
  ADMIN: Access,
  TRAINER: Access,
  TRAINEE: Access,
  body?: object,
): Row => ({ route, ADMIN, TRAINER, TRAINEE, body });

/** Mirrors Appendix A. Keep one row per registered route. */
const MATRIX: Row[] = [
  r('GET /', PUBLIC, PUBLIC, PUBLIC),
  r('GET /health', PUBLIC, PUBLIC, PUBLIC),
  r('POST /auth/login', PUBLIC, PUBLIC, PUBLIC, E2E_ADMIN),
  r('GET /auth/me', ALLOW, ALLOW, ALLOW),

  // ⚠ ACC-15: TRAINER can manage every account, incl. ADMIN ones.
  r('PATCH /accounts/:id', ALLOW, ALLOW, GUARD),
  r('DELETE /accounts/:id', ALLOW, ALLOW, GUARD),
  r('GET /accounts/:id', ALLOW, ALLOW, GUARD),
  r('GET /accounts/:id/password-status', ALLOW, ALLOW, OWN_ACCOUNT),
  r(
    'POST /accounts/:id/change-password',
    ALLOW,
    ALLOW,
    OWN_ACCOUNT,
    CHANGE_PASSWORD,
  ),
  r('POST /accounts/:profileType/:profileId', ALLOW, ALLOW, GUARD),

  r('GET /plans', ALLOW, ALLOW, ALLOW),
  r('GET /plans/:id', ALLOW, ALLOW, ALLOW),
  r('POST /plans', ALLOW, ALLOW, GUARD),
  r('PATCH /plans/:id', ALLOW, ALLOW, GUARD),
  r('DELETE /plans/:id', ALLOW, ALLOW, GUARD),

  // No class-level @Roles on the trainers controller (TRP-04).
  r('GET /trainers', ALLOW, ALLOW, ALLOW),
  r('GET /trainers/:id', ALLOW, ALLOW, ALLOW),
  r('POST /trainers', ALLOW, GUARD, GUARD),
  r('PATCH /trainers/:id', ALLOW, GUARD, GUARD),
  r('DELETE /trainers/:id', ALLOW, GUARD, GUARD),

  r('GET /trainees', ALLOW, ALLOW, GUARD),
  r('POST /trainees', ALLOW, ALLOW, GUARD),
  r('GET /trainees/:id', ALLOW, ALLOW, GUARD),
  r('PATCH /trainees/:id', ALLOW, ALLOW, GUARD),
  r('DELETE /trainees/:id', ALLOW, ALLOW, GUARD),
  r('GET /trainees/:id/overview', ALLOW, ALLOW, GUARD),
  // Handler roles override the class roles: TRAINEE only (TRN-09).
  r('GET /trainees/me/training-insights', GUARD, GUARD, ALLOW),

  r('POST /trainees/:traineeId/subscriptions', ALLOW, ALLOW, GUARD),
  r('GET /trainees/:traineeId/subscriptions', ALLOW, ALLOW, OWN_SUBSCRIPTIONS),
  r('DELETE /subscriptions/:id', ALLOW, ALLOW, GUARD),
  r('GET /subscription-renewals', ALLOW, ALLOW, GUARD),

  r('POST /attendance', ALLOW, ALLOW, GUARD),
  r('POST /attendance/batch', ALLOW, ALLOW, GUARD),
  r('POST /attendance/batch/preview', ALLOW, ALLOW, GUARD),
  r('GET /attendance/dates', ALLOW, ALLOW, GUARD),
  r('GET /attendance/sessions', ALLOW, ALLOW, GUARD),
  r('GET /attendance/reports/inactive-trainees', ALLOW, ALLOW, GUARD),
  r('GET /attendance/reports/without-active-subscription', ALLOW, ALLOW, GUARD),
  r('GET /attendance/trainees/:traineeId', ALLOW, ALLOW, OWN_TRAININGS),
  r('GET /attendance/trainees/:traineeId/paid', ALLOW, ALLOW, OWN_TRAININGS),
  r('GET /attendance/trainees/:traineeId/unpaid', ALLOW, ALLOW, OWN_TRAININGS),
  r('DELETE /attendance/:id', ALLOW, ALLOW, GUARD),

  r('GET /cash-register', ALLOW, GUARD, GUARD),
  r('POST /cash-register/transactions/manual', ALLOW, GUARD, GUARD),

  r(
    'POST /settlements',
    ALLOW,
    { handler: 'TRAINER cannot generate settlement reports' },
    GUARD,
    PERIOD,
  ),
  r('GET /settlements', ALLOW, ALLOW, GUARD),
  r('GET /settlements/:id', ALLOW, ALLOW, GUARD),
  r(
    'DELETE /settlements/:id',
    ALLOW,
    { handler: 'TRAINER cannot delete settlement reports' },
    GUARD,
  ),
  r(
    'POST /settlements/:id/finalize',
    ALLOW,
    { handler: 'TRAINER cannot finalize settlement reports' },
    GUARD,
  ),
  r('GET /settlements/:id/allocations', ALLOW, ALLOW, GUARD),

  ...['gym-locations', 'gym-subscriptions', 'training-times'].flatMap((res) => [
    r(`GET /${res}`, ALLOW, ALLOW, GUARD),
    r(`POST /${res}`, ALLOW, ALLOW, GUARD),
    r(`GET /${res}/:id`, ALLOW, ALLOW, GUARD),
    r(`PATCH /${res}/:id`, ALLOW, ALLOW, GUARD),
    r(`DELETE /${res}/:id`, ALLOW, ALLOW, GUARD),
  ]),

  // Media library (article images): ADMIN only in the MVP.
  r('POST /media', ALLOW, GUARD, GUARD),
  r('GET /media', ALLOW, GUARD, GUARD),
  r('GET /media/:id', ALLOW, GUARD, GUARD),
  r('PATCH /media/:id', ALLOW, GUARD, GUARD),

  // Article categories (back office): ADMIN only in the MVP.
  r('GET /article-categories', ALLOW, GUARD, GUARD),
  r('POST /article-categories', ALLOW, GUARD, GUARD),
  r('GET /article-categories/:id', ALLOW, GUARD, GUARD),
  r('PATCH /article-categories/:id', ALLOW, GUARD, GUARD),
  r('DELETE /article-categories/:id', ALLOW, GUARD, GUARD),

  // Articles (back office): ADMIN only in the MVP.
  r('GET /articles', ALLOW, GUARD, GUARD),
  r('POST /articles', ALLOW, GUARD, GUARD),
  r('GET /articles/:id', ALLOW, GUARD, GUARD),
  r('PATCH /articles/:id/draft', ALLOW, GUARD, GUARD),
  r('POST /articles/:id/publish', ALLOW, GUARD, GUARD),
  r('POST /articles/:id/unpublish', ALLOW, GUARD, GUARD),
  r('POST /articles/:id/discard-draft', ALLOW, GUARD, GUARD),
  r('POST /articles/:id/preview-token', ALLOW, GUARD, GUARD),
  r('DELETE /articles/:id', ALLOW, GUARD, GUARD),

  // Exercises and workouts: staff only; trainees don't see workouts yet.
  r('GET /exercises', ALLOW, ALLOW, GUARD),
  r('POST /exercises', ALLOW, ALLOW, GUARD),
  r('GET /exercises/:id', ALLOW, ALLOW, GUARD),
  r('PATCH /exercises/:id', ALLOW, ALLOW, GUARD),
  r('DELETE /exercises/:id', ALLOW, ALLOW, GUARD),
  r('POST /exercises/:id/aliases', ALLOW, ALLOW, GUARD),
  r('GET /workouts', ALLOW, ALLOW, GUARD),
  r('POST /workouts', ALLOW, ALLOW, GUARD),
  r('POST /workouts/import-pdf', ALLOW, ALLOW, GUARD),
  r('GET /workouts/source-pdfs/:id', ALLOW, ALLOW, GUARD),
  r('GET /workouts/:id', ALLOW, ALLOW, GUARD),
  r('PATCH /workouts/:id', ALLOW, ALLOW, GUARD),
  r('DELETE /workouts/:id', ALLOW, ALLOW, GUARD),

  // The public site (theindex-web): published content, and the draft preview behind its token.
  r('GET /public/articles', PUBLIC, PUBLIC, PUBLIC),
  r('GET /public/articles/:slug', PUBLIC, PUBLIC, PUBLIC),
  r('GET /public/article-categories', PUBLIC, PUBLIC, PUBLIC),
  r('GET /public/article-categories/:slug', PUBLIC, PUBLIC, PUBLIC),
  r('GET /public/sitemap', PUBLIC, PUBLIC, PUBLIC),
  r('GET /public/preview', PUBLIC, PUBLIC, PUBLIC),
];

/** A well-formed UUID that matches no row, so allowed calls can't mutate. */
const RANDOM_ID = '7d1d0b8e-3c5a-4f7e-9a8b-0c1d2e3f4a5b';

function apiPath(route: string): string {
  const path = route.split(' ')[1];
  return path === '/' ? '/api' : `/api${path}`;
}

/** Fills route params: `:profileType` -> 'trainer', every id -> `id`. */
function concretePath(route: string, id: string): string {
  return apiPath(route)
    .replace(':profileType', 'trainer')
    .replace(/:[A-Za-z]+/g, id);
}

describe('AUTH-11 role matrix (e2e)', () => {
  const ctx = setupE2eSuite();

  async function call(row: Row, path: string, token?: string) {
    const c = ctx();
    const method = row.route.split(' ')[0].toLowerCase() as
      'get' | 'post' | 'patch' | 'delete';
    let req = c.http()[method](path);
    if (token) req = req.set('Authorization', `Bearer ${token}`);
    if (row.body) req = req.send(row.body);
    return req;
  }

  it('AUTH-11 the matrix has exactly one row per registered route', () => {
    const registered = ctx().registeredRoutes().sort();
    const rows = MATRIX.map(
      (row) => `${row.route.split(' ')[0]} ${apiPath(row.route)}`,
    ).sort();

    expect(rows).toEqual(registered);
    expect(new Set(rows).size).toBe(rows.length);
  });

  it('AUTH-11 anonymous -> 401 on every non-public route, never 401/403 on public ones', async () => {
    const mismatches: string[] = [];
    for (const row of MATRIX) {
      const res = await call(row, concretePath(row.route, RANDOM_ID));
      if (row.ADMIN === PUBLIC) {
        if ([401, 403].includes(res.status)) {
          mismatches.push(`${row.route}: public but got ${res.status}`);
        }
      } else if (res.status !== 401) {
        mismatches.push(`${row.route}: expected 401, got ${res.status}`);
      }
    }
    expect(mismatches).toEqual([]);
  });

  it.each(['ADMIN', 'TRAINER', 'TRAINEE'] as const)(
    'AUTH-11 %s gets exactly the access in Appendix A',
    async (role) => {
      const c = ctx();
      const trainee = await c.trainee('Matrix Trainee');
      const token =
        role === 'ADMIN'
          ? await c.loginAsAdmin()
          : role === 'TRAINER'
            ? await c.provisionAndLogin('trainer', (await c.trainer()).id)
            : await c.provisionAndLogin('trainee', trainee.id);
      const ownIds = {
        account: String(jwtPayload(token).sub),
        trainee: trainee.id,
      };

      const mismatches: string[] = [];
      const check = async (
        row: Row,
        id: string,
        expected: 'NOT_DENIED' | 'GUARD' | { message: string },
        label = '',
      ) => {
        const res = await call(row, concretePath(row.route, id), token);
        const where = `${row.route}${label}`;
        if (expected === 'NOT_DENIED') {
          if ([401, 403].includes(res.status)) {
            mismatches.push(
              `${where}: expected access, got ${res.status} ${JSON.stringify(messageOf(res.body))}`,
            );
          }
          return;
        }
        const message =
          expected === 'GUARD' ? 'Forbidden resource' : expected.message;
        if (res.status !== 403 || messageOf(res.body) !== message) {
          mismatches.push(
            `${where}: expected 403 "${message}", got ${res.status} ${JSON.stringify(messageOf(res.body))}`,
          );
        }
      };

      for (const row of MATRIX) {
        const access = row[role];
        if (access === PUBLIC || access === ALLOW) {
          await check(row, RANDOM_ID, 'NOT_DENIED');
        } else if (access === GUARD) {
          await check(row, RANDOM_ID, 'GUARD');
        } else if ('handler' in access) {
          await check(row, RANDOM_ID, { message: access.handler });
        } else {
          await check(row, ownIds[access.ownKind], 'NOT_DENIED', ' (own id)');
          await check(row, RANDOM_ID, { message: access.own }, ' (other id)');
        }
      }

      expect(mismatches).toEqual([]);
    },
    30_000,
  );
});
