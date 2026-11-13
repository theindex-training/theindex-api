import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import {
  AccountRow,
  accountView,
  isLinked,
  registrationRefs,
} from './account-view';

const CREATED = new Date('2026-11-10T08:00:00Z');
const CONSENT = new Date('2026-11-10T08:00:00Z');

function row(extra: Partial<AccountRow> = {}): AccountRow {
  return {
    id: 'acc-1',
    email: 'ivan@example.com',
    role: AccountRole.TRAINEE,
    status: AccountStatus.ACTIVE,
    createdAt: CREATED,
    consentAt: CONSENT,
    registration: {
      name: 'Ivan Petrov',
      phone: '0888 123 456',
      gymSubscriptionId: 'gs-1',
      preferredGymId: 'gym-1',
      instagram: '@ivan',
      facebook: null,
      tiktok: null,
    },
    traineeProfileId: null,
    trainerProfileId: null,
    ...extra,
  };
}

const lookups = {
  gymSubscriptions: new Map([['gs-1', { id: 'gs-1', name: 'MultiSport' }]]),
  gyms: new Map([['gym-1', { id: 'gym-1', name: 'Center' }]]),
};

describe('account-view', () => {
  it('shows a registration with its gym subscription and gym by name', () => {
    expect(accountView(row(), lookups)).toEqual({
      id: 'acc-1',
      email: 'ivan@example.com',
      role: AccountRole.TRAINEE,
      status: AccountStatus.ACTIVE,
      createdAt: CREATED,
      consentAt: CONSENT,
      registration: {
        name: 'Ivan Petrov',
        phone: '0888 123 456',
        gymSubscription: { id: 'gs-1', name: 'MultiSport' },
        preferredGym: { id: 'gym-1', name: 'Center' },
        instagram: '@ivan',
        facebook: null,
        tiktok: null,
      },
      profile: null,
    });
  });

  it('shows a gym subscription or gym that no longer exists as null', () => {
    const view = accountView(row(), {
      gymSubscriptions: new Map(),
      gyms: new Map(),
    });
    expect(view.registration).toMatchObject({
      gymSubscription: null,
      preferredGym: null,
    });
  });

  it('has no registration for an account an admin created', () => {
    expect(
      accountView(row({ registration: null, consentAt: null }), lookups)
        .registration,
    ).toBeNull();
  });

  it('names the connected profile and its type', () => {
    const trainee = {
      id: 't-1',
      name: 'Ivan',
      nickname: 'Vanko',
      isActive: true,
    };
    expect(
      accountView(
        row({ traineeProfileId: 't-1', traineeProfile: trainee }),
        lookups,
      ).profile,
    ).toEqual({ type: 'trainee', ...trainee });

    const trainer = {
      id: 'tr-1',
      name: 'Petar',
      nickname: null,
      isActive: false,
    };
    expect(
      accountView(
        row({
          role: AccountRole.TRAINER,
          trainerProfileId: 'tr-1',
          trainerProfile: trainer,
        }),
        lookups,
      ).profile,
    ).toEqual({ type: 'trainer', ...trainer });
  });

  it('isLinked: either profile id connects the account', () => {
    expect(isLinked(row())).toBe(false);
    expect(isLinked(row({ traineeProfileId: 't-1' }))).toBe(true);
    expect(isLinked(row({ trainerProfileId: 'tr-1' }))).toBe(true);
  });

  it('registrationRefs collects each referenced id once', () => {
    expect(
      registrationRefs([
        row(),
        row({ id: 'acc-2' }),
        row({ registration: null }),
      ]),
    ).toEqual({ gymSubscriptionIds: ['gs-1'], gymIds: ['gym-1'] });
  });
});
