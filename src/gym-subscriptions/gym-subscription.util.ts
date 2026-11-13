import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { GymSubscriptionEntity } from './gym-subscription.entity';

/**
 * A gym subscription someone picks for a trainee (self-registration, connecting an account,
 * "My details"): null clears it, an id must be an active gym subscription. Returns the value to
 * store, or undefined when none was sent.
 */
export async function activeGymSubscriptionId(
  m: EntityManager,
  value: string | null | undefined,
): Promise<string | null | undefined> {
  if (value === undefined || value === null) return value;
  const found = await m.findOne(GymSubscriptionEntity, {
    where: { id: value, isActive: true },
  });
  if (!found) {
    throw new BadRequestException('Gym subscription not found or inactive');
  }
  return found.id;
}
