import { ConflictException } from '@nestjs/common';
import { EntityManager } from 'typeorm';
import { SettlementStatus } from './enums/settlement-status.enum';
import { periodBounds } from './settlement-periods';
import { SettlementEntity } from './settlement.entity';

/**
 * Postgres advisory lock key for settlement changes. Creating reports and finalizing take it
 * exclusively; recording or deleting attendance takes it shared, so a training can't slip into
 * a period while its report is being finalized.
 */
export const SETTLEMENTS_LOCK_KEY = 7_301_001;

export async function lockSettlements(manager: EntityManager): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock($1)', [
    SETTLEMENTS_LOCK_KEY,
  ]);
}

/**
 * The last day of the latest finalized report (`YYYY-MM-DD`), or null. Reports are finalized
 * oldest first, so every training up to that day is settled.
 */
export async function settledThrough(
  manager: EntityManager,
): Promise<string | null> {
  const row = await manager
    .getRepository(SettlementEntity)
    .createQueryBuilder('s')
    .select(`to_char(MAX(s.periodEnd), 'YYYY-MM-DD')`, 'end')
    .where('s.status = :final', { final: SettlementStatus.FINAL })
    .getRawOne<{ end: string | null }>();
  return row?.end ?? null;
}

/**
 * Refuses (409) to record or delete attendance dated in a period whose report is finalized: its
 * payout is done. Call inside the transaction that makes the change.
 */
export async function assertAttendanceOpen(
  manager: EntityManager,
  trainedAt: Date,
): Promise<void> {
  await manager.query('SELECT pg_advisory_xact_lock_shared($1)', [
    SETTLEMENTS_LOCK_KEY,
  ]);
  const through = await settledThrough(manager);
  if (!through) return;
  const { to } = periodBounds({ periodStart: through, periodEnd: through });
  if (trainedAt.getTime() < to.getTime()) {
    throw new ConflictException(
      `Attendance on or before ${through} is in a finalized settlement report and can't be changed`,
    );
  }
}
