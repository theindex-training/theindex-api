import { AccountRole } from '../common/enums/account-role.enum';

/** Whose results: a trainee's or a trainer's profile (exactly one of the two). */
export type ResultOwner =
  | { traineeProfileId: string; trainerProfileId: null }
  | { traineeProfileId: null; trainerProfileId: string };

/** Who is asking, from their token. */
export type Requester = { role: AccountRole; owner: ResultOwner | null };

export type TokenUser = {
  role: AccountRole;
  traineeProfileId?: string | null;
  trainerProfileId?: string | null;
};

/**
 * The profile whose results a token logs and reads as "mine": a trainee's trainee profile, a
 * trainer's trainer profile; an admin's linked profile if it has one, else none (admins can
 * look and moderate, but have no results of their own).
 */
export function requesterOf(user: TokenUser): Requester {
  const trainee = user.traineeProfileId || null;
  const trainer = user.trainerProfileId || null;
  const asTrainee = (id: string): ResultOwner => ({
    traineeProfileId: id,
    trainerProfileId: null,
  });
  const asTrainer = (id: string): ResultOwner => ({
    traineeProfileId: null,
    trainerProfileId: id,
  });
  switch (user.role) {
    case AccountRole.TRAINEE:
      return { role: user.role, owner: trainee ? asTrainee(trainee) : null };
    case AccountRole.TRAINER:
      return { role: user.role, owner: trainer ? asTrainer(trainer) : null };
    default:
      return {
        role: user.role,
        owner: trainer
          ? asTrainer(trainer)
          : trainee
            ? asTrainee(trainee)
            : null,
      };
  }
}

/** One key per person, for grouping results. */
export function ownerKey(owner: {
  traineeProfileId: string | null;
  trainerProfileId: string | null;
}): string {
  return owner.traineeProfileId
    ? `trainee:${owner.traineeProfileId}`
    : `trainer:${owner.trainerProfileId}`;
}
