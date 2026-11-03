import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';

export type DependencyStatus = { status: 'up' | 'down'; latencyMs: number; error?: string };

export interface HealthReport {
  status: 'ok' | 'degraded';
  timestamp: string;
  uptimeSeconds: number;
  dependencies: { database: DependencyStatus; aiService: DependencyStatus };
}

@Injectable()
export class HealthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async check(): Promise<HealthReport> {
    const [database, aiService] = await Promise.all([this.checkDatabase(), this.checkAiService()]);
    return {
      status: database.status === 'up' && aiService.status === 'up' ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { database, aiService },
    };
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    return this.measure(() => this.prisma.$queryRaw`SELECT 1`);
  }

  private async checkAiService(): Promise<DependencyStatus> {
    const url = `${this.config.getOrThrow<string>('AI_SERVICE_URL')}/health`;
    return this.measure(async () => {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    });
  }

  private async measure(probe: () => Promise<unknown>): Promise<DependencyStatus> {
    const start = performance.now();
    try {
      await probe();
      return { status: 'up', latencyMs: Math.round(performance.now() - start) };
    } catch (error) {
      // Only the last line: Prisma errors are multi-line (generic header, query echo, then the cause).
      const message = (error as Error).message.split('\n').filter((l) => l.trim()).at(-1) ?? 'unknown error';
      return { status: 'down', latencyMs: Math.round(performance.now() - start), error: message };
    }
  }
}
