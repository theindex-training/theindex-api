import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { AccountEntity } from '../accounts/account.entity';
import { AccountsService } from '../accounts/accounts.service';
import { needsAccountSetup } from '../accounts/account-setup';
import { isLinked } from '../accounts/account-view';
import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import { GoogleIdTokenVerifier } from './google/google-id-token.verifier';
import { googleSignInEmail } from './google/google-sign-in';

/** The 403 a login gets while the account waits for an admin to connect it to a profile. */
export const NOT_LINKED_MESSAGE =
  'Your account is not connected to a profile yet. An admin will connect it, and then you can log in.';

/** The `error` of a 401 for a Google account Google isn't in charge of (see `googleSignInEmail`). */
export const GOOGLE_EMAIL_NOT_ACCEPTED = 'GOOGLE_EMAIL_NOT_ACCEPTED';
/** The `error` of a 401 for a Google sign-in whose email no account has. */
export const GOOGLE_NO_ACCOUNT = 'GOOGLE_NO_ACCOUNT';

@Injectable()
export class AuthService {
  constructor(
    private readonly accounts: AccountsService,
    private readonly jwt: JwtService,
    private readonly google: GoogleIdTokenVerifier,
  ) {}

  async validateUser(email: string, password: string) {
    const acc = await this.accounts.findForLogin(email);
    if (!acc) throw new UnauthorizedException('Invalid credentials');

    assertActive(acc);

    if (!acc.passwordHash)
      throw new UnauthorizedException('Account has no password set');

    const ok = await bcrypt.compare(password, acc.passwordHash);
    if (!ok) throw new UnauthorizedException('Invalid credentials');

    // Only after the password: a wrong one never reveals that the account waits.
    assertConnected(acc);

    return acc;
  }

  /**
   * "Sign in with Google": a shortcut to an existing account, never a way to create one. The
   * account is the one with the email Google vouches for (the password login's lookup), and it
   * must pass the password login's checks; the answer is the same as a login's. Nothing about
   * the Google account is stored, so the password keeps working and the two never drift apart.
   */
  async loginWithGoogle(idToken: string) {
    const claims = await this.google.verify(idToken);

    const checked = googleSignInEmail(claims);
    if ('problem' in checked) {
      throw new UnauthorizedException({
        statusCode: 401,
        message:
          'Only Gmail addresses and Google Workspace accounts can sign in with Google',
        error: GOOGLE_EMAIL_NOT_ACCEPTED,
      });
    }

    const acc = await this.accounts.findForLogin(checked.email);
    if (!acc) {
      throw new UnauthorizedException({
        statusCode: 401,
        message: 'No account uses this Google address',
        error: GOOGLE_NO_ACCOUNT,
      });
    }

    assertActive(acc);
    assertConnected(acc);

    return this.login(acc);
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
      // The front sends the person to the first-login setup while this is true; the API
      // enforces it from the database (`JwtAuthGuard`).
      setupRequired: needsAccountSetup({
        role: acc.role,
        hasUpdatedInitialPassword: acc.hasUpdatedInitialPassword ?? false,
        consentAt: acc.consentAt ?? null,
      }),
    };

    return {
      accessToken: await this.jwt.signAsync(payload),
      account: this.accounts.sanitize(acc as AccountEntity),
    };
  }
}

function assertActive(acc: AccountEntity) {
  if (acc.status !== AccountStatus.ACTIVE) {
    throw new UnauthorizedException(`Account is not active (${acc.status})`);
  }
}

/** Everyone but admins signs in only once an admin has connected the account to a profile. */
function assertConnected(acc: AccountEntity) {
  if (acc.role !== AccountRole.ADMIN && !isLinked(acc)) {
    throw new ForbiddenException(NOT_LINKED_MESSAGE);
  }
}
