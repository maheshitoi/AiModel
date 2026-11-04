import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { SystemLogService } from './system-log.service';

const DAY_MS = 24 * 60 * 60_000;
const FIRST_RUN_DELAY_MS = 60_000;

/**
 * Deletes system logs older than the "system.logRetentionDays" setting, once a day.
 * Audit logs are kept: they are the record of who changed what.
 */
@Injectable()
export class LogRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(LogRetentionService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly logs: SystemLogService,
  ) {}

  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    this.timers.push(setTimeout(() => void this.purge(), FIRST_RUN_DELAY_MS).unref(), setInterval(() => void this.purge(), DAY_MS).unref());
  }

  onModuleDestroy(): void {
    this.timers.forEach(clearTimeout);
  }

  async purge(now = new Date()): Promise<number> {
    try {
      const { logRetentionDays } = await this.settings.get('system');
      const { count } = await this.prisma.systemLog.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - logRetentionDays * DAY_MS) } } });
      if (count > 0) await this.logs.info('BACKEND', 'logs.purged', `Deleted ${count} system log entries older than ${logRetentionDays} days`, { count, logRetentionDays });
      return count;
    } catch (error) {
      this.logger.error(`Log retention failed: ${(error as Error).message}`);
      return 0;
    }
  }
}
