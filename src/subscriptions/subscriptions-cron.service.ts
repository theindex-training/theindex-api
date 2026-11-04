import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service';

@Injectable()
export class SubscriptionsCronService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubscriptionsCronService.name);
  private timeout: NodeJS.Timeout | null = null;

  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  onModuleInit(): void {
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
    const nextRun = new Date(now);

    nextRun.setUTCHours(2, 0, 0, 0);
    if (nextRun <= now) {
      nextRun.setUTCDate(nextRun.getUTCDate() + 1);
    }

    const delayMs = nextRun.getTime() - now.getTime();

    this.timeout = setTimeout(() => {
      void this.runAndScheduleNext();
    }, delayMs);

    this.logger.log(
      `Scheduled TIME subscription exhaustion job at ${nextRun.toISOString()}.`,
    );
  }

  // Never rejects: a failed run (e.g. the DB is unreachable at 02:00 UTC) is
  // logged, and the next run is scheduled whether or not this one succeeded.
  // An unhandled rejection here would crash the process (CRON-03).
  private async runAndScheduleNext(): Promise<void> {
    try {
      await this.exhaustPastEndTimeSubscriptions();
    } catch (error) {
      this.logger.error(
        'Daily TIME subscription exhaustion job failed; it will run again at the next scheduled time.',
        error instanceof Error ? error.stack : String(error),
      );
    } finally {
      this.scheduleNextRun();
    }
  }

  private async exhaustPastEndTimeSubscriptions(): Promise<void> {
    const updatedCount =
      await this.subscriptionsService.exhaustPastEndTimeSubscriptions();

    this.logger.log(
      `Daily TIME subscription exhaustion job completed; updated ${updatedCount} subscriptions.`,
    );
  }
}
