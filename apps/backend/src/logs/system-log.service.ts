import { Injectable, Logger } from '@nestjs/common';
import { LogCategory, LogLevel, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

const SENSITIVE_KEY = /pass(word)?|token|secret|authorization|cookie|api[-_]?key/i;

/** Recursively replaces values under sensitive-looking keys so they never reach the log table. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEY.test(k) ? '[REDACTED]' : redact(v)]),
    );
  }
  return value;
}

export interface LogRefs {
  conversationId?: string;
  messageId?: string;
}

@Injectable()
export class SystemLogService {
  private readonly logger = new Logger(SystemLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Never throws: a logging failure must not break the request that triggered it. */
  async write(
    level: LogLevel,
    category: LogCategory,
    event: string,
    message: string,
    context?: Record<string, unknown>,
    refs: LogRefs = {},
  ): Promise<void> {
    try {
      await this.prisma.systemLog.create({
        data: {
          level,
          category,
          event,
          message: message.slice(0, 2000),
          context: context ? (redact(context) as Prisma.InputJsonValue) : undefined,
          ...refs,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write system log "${event}": ${(error as Error).message}`);
    }
  }

  info(category: LogCategory, event: string, message: string, context?: Record<string, unknown>, refs?: LogRefs) {
    return this.write('INFO', category, event, message, context, refs);
  }

  warn(category: LogCategory, event: string, message: string, context?: Record<string, unknown>, refs?: LogRefs) {
    return this.write('WARN', category, event, message, context, refs);
  }

  error(category: LogCategory, event: string, message: string, context?: Record<string, unknown>, refs?: LogRefs) {
    return this.write('ERROR', category, event, message, context, refs);
  }
}
