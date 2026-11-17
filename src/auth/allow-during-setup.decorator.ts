import { SetMetadata } from '@nestjs/common';

export const ALLOW_DURING_SETUP = 'allowDuringSetup';

/**
 * Lets an account that hasn't finished its first-login setup reach the route (`JwtAuthGuard`
 * refuses every other one): the setup itself and `GET /api/auth/me`.
 */
export const AllowDuringSetup = () => SetMetadata(ALLOW_DURING_SETUP, true);
