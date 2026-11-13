import { BadRequestException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { GymLocationEntity } from './gym-location.entity';

/**
 * A profile's home gym (a trainee's preferred gym, a trainer's primary gym): null clears it,
 * an id must be an active gym. Returns the value to store, or undefined when none was sent.
 */
export async function homeGymId(
  m: EntityManager,
  value: string | null | undefined,
): Promise<string | null | undefined> {
  if (value === undefined || value === null) return value;
  const gym = await m.findOne(GymLocationEntity, { where: { id: value } });
  if (!gym) throw new BadRequestException('Unknown gym');
  if (!gym.isActive) throw new BadRequestException('Gym is inactive');
  return gym.id;
}
