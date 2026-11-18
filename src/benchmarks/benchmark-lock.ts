import { EntityManager } from 'typeorm';
import { BenchmarkEntity } from './benchmark.entity';

/**
 * A benchmark's row, locked for the rest of the transaction. Results are written under a shared
 * lock (`FOR SHARE`), and the benchmark is changed or deleted under an exclusive one
 * (`FOR UPDATE`), so a score-type change and the first result can't both go through: whichever
 * comes second sees the other (409 for the change, 400 for a result in the old format).
 */
export function lockBenchmark(
  m: EntityManager,
  id: string,
  mode: 'share' | 'update',
): Promise<BenchmarkEntity | null> {
  return m
    .getRepository(BenchmarkEntity)
    .createQueryBuilder('b')
    .where('b.id = :id', { id })
    .setLock(mode === 'share' ? 'pessimistic_read' : 'pessimistic_write')
    .getOne();
}
