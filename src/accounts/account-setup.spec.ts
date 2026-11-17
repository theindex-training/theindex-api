import { AccountRole } from '../common/enums/account-role.enum';
import { needsAccountSetup, needsPasswordChange } from './account-setup';

const CONSENT = new Date('2026-11-01T10:00:00Z');

function account(
  role: AccountRole,
  hasUpdatedInitialPassword: boolean,
  consentAt: Date | null,
) {
  return { role, hasUpdatedInitialPassword, consentAt };
}

describe('account setup (first login)', () => {
  it.each([AccountRole.TRAINEE, AccountRole.TRAINER])(
    '%s with the admin password and no consent needs setup and a new password',
    (role) => {
      const acc = account(role, false, null);
      expect(needsAccountSetup(acc)).toBe(true);
      expect(needsPasswordChange(acc)).toBe(true);
    },
  );

  it('an account that changed its password but never consented needs setup, not a new password', () => {
    const acc = account(AccountRole.TRAINEE, true, null);
    expect(needsAccountSetup(acc)).toBe(true);
    expect(needsPasswordChange(acc)).toBe(false);
  });

  it('an account that consented but still has the admin password needs setup and a new password', () => {
    const acc = account(AccountRole.TRAINER, false, CONSENT);
    expect(needsAccountSetup(acc)).toBe(true);
    expect(needsPasswordChange(acc)).toBe(true);
  });

  it('a self-registered account (own password, consent) needs nothing', () => {
    const acc = account(AccountRole.TRAINEE, true, CONSENT);
    expect(needsAccountSetup(acc)).toBe(false);
    expect(needsPasswordChange(acc)).toBe(false);
  });

  it('admins never need setup, whatever their flags', () => {
    const acc = account(AccountRole.ADMIN, false, null);
    expect(needsAccountSetup(acc)).toBe(false);
    expect(needsPasswordChange(acc)).toBe(false);
  });
});
