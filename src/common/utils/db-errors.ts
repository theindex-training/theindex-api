import { QueryFailedError } from 'typeorm';

/** Postgres error code for a unique constraint violation. */
export const UNIQUE_VIOLATION = '23505';

/** The name of the unique index a failed query violated, if that is why it failed. */
export function violatedUniqueIndex(error: unknown): string | undefined {
  if (!(error instanceof QueryFailedError)) return undefined;
  const driverError = error.driverError as {
    code?: string;
    constraint?: string;
  };
  return driverError.code === UNIQUE_VIOLATION
    ? driverError.constraint
    : undefined;
}
