import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { RequestMeta } from '../common/auth.types';
import { PrismaService } from '../prisma/prisma.service';
import { redact } from './system-log.service';

export interface AuditEntry {
  actorId?: string;
  action: string;
  entityType: string;
  entityId?: string;
  before?: unknown;
  after?: unknown;
  meta?: RequestMeta;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Pass `tx` to write the audit row in the same transaction as the change it describes. */
  async record(entry: AuditEntry, tx: Prisma.TransactionClient = this.prisma): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        before: entry.before === undefined ? undefined : (redact(entry.before) as Prisma.InputJsonValue),
        after: entry.after === undefined ? undefined : (redact(entry.after) as Prisma.InputJsonValue),
        ipAddress: entry.meta?.ipAddress,
        userAgent: entry.meta?.userAgent,
      },
    });
  }
}
