import { AccountRole } from '../common/enums/account-role.enum';
import { AccountStatus } from '../common/enums/account-status.enum';
import type { AccountRegistration } from './account.entity';

/** The Accounts page's filter: accounts connected to a profile, not connected yet, or all. */
export const ACCOUNT_LINK_FILTERS = ['unlinked', 'linked', 'all'] as const;
export type AccountLinkFilter = (typeof ACCOUNT_LINK_FILTERS)[number];

export type Named = { id: string; name: string };

export type ProfileType = 'trainee' | 'trainer';

type ProfileRow = {
  id: string;
  name: string;
  nickname: string | null;
  isActive: boolean;
};

/** The account fields the view reads (an `AccountEntity` with its profiles loaded). */
export type AccountRow = {
  id: string;
  email: string | null;
  role: AccountRole;
  status: AccountStatus;
  createdAt: Date;
  consentAt: Date | null;
  registration: AccountRegistration | null;
  traineeProfileId: string | null;
  trainerProfileId: string | null;
  traineeProfile?: ProfileRow | null;
  trainerProfile?: ProfileRow | null;
};

/** An account as the admin's Accounts page shows it. Never the password hash. */
export type AccountView = {
  id: string;
  email: string | null;
  role: AccountRole;
  status: AccountStatus;
  createdAt: Date;
  consentAt: Date | null;
  /** What the person entered when they registered; null for accounts an admin created. */
  registration: {
    name: string;
    phone: string;
    gymSubscription: Named | null;
    preferredGym: Named | null;
    instagram: string | null;
    facebook: string | null;
    tiktok: string | null;
  } | null;
  /** The profile the account is connected to (what login uses), or null. */
  profile: (ProfileRow & { type: ProfileType }) | null;
};

/** Whether the account is connected to a trainee or trainer profile. */
export function isLinked(
  acc: Pick<AccountRow, 'traineeProfileId' | 'trainerProfileId'>,
): boolean {
  return acc.traineeProfileId !== null || acc.trainerProfileId !== null;
}

/**
 * Builds the view. `lookups` resolve the registration's gym subscription and gym to their names;
 * one that no longer exists shows as null.
 */
export function accountView(
  acc: AccountRow,
  lookups: { gymSubscriptions: Map<string, Named>; gyms: Map<string, Named> },
): AccountView {
  const reg = acc.registration;
  const profileOf = (
    type: ProfileType,
    row: ProfileRow | null | undefined,
  ): AccountView['profile'] =>
    row
      ? {
          type,
          id: row.id,
          name: row.name,
          nickname: row.nickname,
          isActive: row.isActive,
        }
      : null;

  return {
    id: acc.id,
    email: acc.email,
    role: acc.role,
    status: acc.status,
    createdAt: acc.createdAt,
    consentAt: acc.consentAt,
    registration: reg
      ? {
          name: reg.name,
          phone: reg.phone,
          gymSubscription: reg.gymSubscriptionId
            ? (lookups.gymSubscriptions.get(reg.gymSubscriptionId) ?? null)
            : null,
          preferredGym: reg.preferredGymId
            ? (lookups.gyms.get(reg.preferredGymId) ?? null)
            : null,
          instagram: reg.instagram,
          facebook: reg.facebook,
          tiktok: reg.tiktok,
        }
      : null,
    profile: acc.traineeProfileId
      ? profileOf('trainee', acc.traineeProfile)
      : acc.trainerProfileId
        ? profileOf('trainer', acc.trainerProfile)
        : null,
  };
}

/** The gym subscription and gym ids the registrations refer to, to look their names up. */
export function registrationRefs(accounts: AccountRow[]): {
  gymSubscriptionIds: string[];
  gymIds: string[];
} {
  const gymSubscriptionIds = new Set<string>();
  const gymIds = new Set<string>();
  for (const acc of accounts) {
    if (acc.registration?.gymSubscriptionId) {
      gymSubscriptionIds.add(acc.registration.gymSubscriptionId);
    }
    if (acc.registration?.preferredGymId) {
      gymIds.add(acc.registration.preferredGymId);
    }
  }
  return { gymSubscriptionIds: [...gymSubscriptionIds], gymIds: [...gymIds] };
}
