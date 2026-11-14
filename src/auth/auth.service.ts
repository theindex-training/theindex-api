import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { AccountEntity } from '../accounts/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { isLinked } from '../accounts/account-view';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';

/** The 403 a login gets while the account waits for an admin to connect it to a profile. */
export const NOT_LINKED_MESSAGE =
  'Your account is not connected to a profile yet. An admin will connect it, and then you can log in.';

@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly jwt: JwtService,
  ) {}

  async validateUser(email: string, password: string) {
    const acc = await this.accounts.findForLogin(email);
    if (!acc) throw new UnauthorizedException('Invalid credentials');

    if (acc.status !== AccountStatus.ACTIVE) {
      throw new UnauthorizedException(`Account is not active (${acc.status})`);
    }

    if (!acc.passwordHash)
      throw new UnauthorizedException('Account has no password set');

    const ok = await bcrypt.compare(password, acc.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // Only after the password: a wrong one never reveals that the account waits.
    if (acc.role !== AccountRole.ADMIN && !isLinked(acc)) {
      throw new ForbiddenException(NOT_LINKED_MESSAGE);
    }

    return acc;
  }

  async login(
    acc: Pick<AccountEntity, 'id' | 'email' | 'role'> & Partial<AccountEntity>,
  ) {
    const payload = {
      sub: acc.id,
      email: acc.email,
      role: acc.role,
      trainerProfileId: acc.trainerProfileId ?? null,
      traineeProfileId: acc.traineeProfileId ?? null,
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      account: this.accounts.sanitize(acc as AccountEntity),
    };
  }
}
