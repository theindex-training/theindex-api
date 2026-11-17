import { AccountRole } from '../common/enums/account-role.enum';
import type { AccountEntity } from './account.entity';

type SetupFields = Pick<
  AccountEntity,
  'role' | 'hasUpdatedInitialPassword' | 'consentAt'
>;

/**
 * Whether the person still has the password an admin gave them (an account an admin created
 * for a profile). Admins never do: they have no first-login setup.
 */
export function needsPasswordChange(account: SetupFields): boolean {
  return (
    account.role !== AccountRole.ADMIN && !account.hasUpdatedInitialPassword
  );
}

/**
 * Whether the account must go through the first-login setup (`/api/account-setup`) before using
 * anything else: a trainee or trainer account that still has the admin's password, or that never
 * agreed to the use of their personal data and to emails (accounts created before consent was
 * asked). A self-registered account has neither gap, so it never does.
 */
export function needsAccountSetup(account: SetupFields): boolean {
  return (
    account.role !== AccountRole.ADMIN &&
    (!account.hasUpdatedInitialPassword || !account.consentAt)
  );
}
