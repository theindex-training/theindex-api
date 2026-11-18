import { AccountRole } from '../common/enums/account-role.enum';
import { ownerKey, requesterOf } from './benchmark-owner';

describe('requesterOf', () => {
  it("uses a trainee's trainee profile and a trainer's trainer profile", () => {
    expect(
      requesterOf({
        role: AccountRole.TRAINEE,
        traineeProfileId: 't1',
        trainerProfileId: 'x',
      }),
    ).toEqual({
      role: AccountRole.TRAINEE,
      owner: { traineeProfileId: 't1', trainerProfileId: null },
    });
    expect(
      requesterOf({ role: AccountRole.TRAINER, trainerProfileId: 'c1' }),
    ).toEqual({
      role: AccountRole.TRAINER,
      owner: { traineeProfileId: null, trainerProfileId: 'c1' },
    });
  });

  it('gives an account without its profile no owner', () => {
    expect(
      requesterOf({ role: AccountRole.TRAINEE, traineeProfileId: null }).owner,
    ).toBeNull();
    expect(
      requesterOf({ role: AccountRole.TRAINER, traineeProfileId: 't1' }).owner,
    ).toBeNull();
    expect(requesterOf({ role: AccountRole.ADMIN }).owner).toBeNull();
  });

  it("uses an admin's linked profile, the trainer one first", () => {
    expect(
      requesterOf({
        role: AccountRole.ADMIN,
        traineeProfileId: 't1',
        trainerProfileId: 'c1',
      }).owner,
    ).toEqual({ traineeProfileId: null, trainerProfileId: 'c1' });
    expect(
      requesterOf({ role: AccountRole.ADMIN, traineeProfileId: 't1' }).owner,
    ).toEqual({ traineeProfileId: 't1', trainerProfileId: null });
  });
});

describe('ownerKey', () => {
  it('tells a trainee and a trainer with the same id apart', () => {
    expect(ownerKey({ traineeProfileId: 'a', trainerProfileId: null })).toBe(
      'trainee:a',
    );
    expect(ownerKey({ traineeProfileId: null, trainerProfileId: 'a' })).toBe(
      'trainer:a',
    );
  });
});
