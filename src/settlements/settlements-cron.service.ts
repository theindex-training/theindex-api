import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  fromGymLocalToUtc,
  toGymLocalDate,
} from '../attendance/attendance-timezone.util';
import { addDays, SETTLEMENT_CREATION_HOUR } from './settlement-periods';
import { SettlementsService } from './settlements.service';

/**
 * The next 04:00 gym-local (Europe/Sofia) strictly after `now`: the job runs then every day.
 * It only creates a report on the 1st and the 16th, but running daily keeps it simple and lets a
 * missed day catch up.
 */
export function nextSettlementRun(now: Date): Date {
  const today = toGymLocalDate(now);
  for (const date of [today, addDays(today, 1)]) {
    const [y, m, d] = date.split('-').map(Number);
    const run = fromGymLocalToUtc(y, m, d, SETTLEMENT_CREATION_HOUR, 0);
    if (run.getTime() > now.getTime()) return run;
  }
  const [y, m, d] = addDays(today, 2).split('-').map(Number);
  return fromGymLocalToUtc(y, m, d, SETTLEMENT_CREATION_HOUR, 0);
}

/**
 * Creates the settlement reports automatically: once when the API starts (catching up on any
 * run missed while it was down), then daily at 04:00 Europe/Sofia.
 */
@Injectable()
export class SettlementsCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SettlementsCronService.name);
  private timeout: NodeJS.Timeout | null = null;

  constructor(private readonly settlementsService: SettlementsService) {}

  async onModuleInit(): Promise<void> {
    await this.run();
    this.scheduleNextRun();
  }

  onModuleDestroy(): void {
    if (this.timeout) {
      clearTimeout(this.timeout);
      this.timeout = null;
    }
  }

  private scheduleNextRun(): void {
    const now = new Date();
    const next = nextSettlementRun(now);
    this.timeout = setTimeout(() => {
      void this.run().finally(() => this.scheduleNextRun());
    }, next.getTime() - now.getTime());
  }

  /** Never rejects: a failed run is logged and the next one tries again. */
  private async run(): Promise<void> {
    try {
      await this.settlementsService.createDueReports();
    } catch (error) {
      this.logger.error(
        'Creating the due settlement reports failed; the next run will try again.',
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}
