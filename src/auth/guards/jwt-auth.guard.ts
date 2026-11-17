import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isUUID } from 'class-validator';
import { DataSource } from 'typeorm';
import { AccountEntity } from '../../accounts/account.entity';
import { needsAccountSetup } from '../../accounts/account-setup';
import { AccountRole } from '../../common/enums/account-role.enum';
import { ALLOW_DURING_SETUP } from '../allow-during-setup.decorator';

/** The `error` of the 403 an account gets until it finishes its first-login setup. */
export const ACCOUNT_SETUP_REQUIRED = 'ACCOUNT_SETUP_REQUIRED';
export const ACCOUNT_SETUP_MESSAGE =
  'Finish setting up your account first: choose your password and confirm your details.';

/**
 * A valid bearer token, and then, for trainee and trainer accounts, a finished first-login setup
 * (`accounts/account-setup.ts`), except on `@AllowDuringSetup()` routes. The setup state is read
 * from the database, not the token, so a token issued before the setup existed can't skip it.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private readonly reflector: Reflector,
    private readonly dataSource: DataSource,
  ) {
    super();
  }

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (!(await (super.canActivate(ctx) as Promise<boolean>))) return false;

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOW_DURING_SETUP,
      [ctx.getHandler(), ctx.getClass()],
    );
    if (allowed) return true;

    const user = ctx
      .switchToHttp()
      .getRequest<{ user?: { sub?: unknown; role?: unknown } }>().user;
    if (user?.role === AccountRole.ADMIN) return true;
    if (typeof user?.sub !== 'string' || !isUUID(user.sub)) return true;

    const account = await this.dataSource.getRepository(AccountEntity).findOne({
      where: { id: user.sub },
      select: {
        id: true,
        role: true,
        hasUpdatedInitialPassword: true,
        consentAt: true,
      },
    });
    if (account && needsAccountSetup(account)) {
      throw new ForbiddenException({
        statusCode: 403,
        error: ACCOUNT_SETUP_REQUIRED,
        message: ACCOUNT_SETUP_MESSAGE,
      });
    }
    return true;
  }
}
