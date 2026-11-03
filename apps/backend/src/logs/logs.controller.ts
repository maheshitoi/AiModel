import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuditLog, Prisma, SystemLog } from '@prisma/client';
import { RequirePermissions } from '../common/decorators';
import { Paginated } from '../common/pagination';
import { Permission } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { AuditLogQueryDto, dateRange, SystemLogQueryDto } from './dto/log-query.dto';

@ApiTags('logs')
@ApiBearerAuth()
@Controller('logs')
export class LogsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermissions(Permission.LogsRead)
  async systemLogs(@Query() q: SystemLogQueryDto): Promise<Paginated<SystemLog>> {
    const where: Prisma.SystemLogWhereInput = {
      level: q.level,
      category: q.category,
      createdAt: dateRange(q),
      OR: q.search
        ? [
            { event: { contains: q.search, mode: 'insensitive' } },
            { message: { contains: q.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.systemLog.findMany({ where, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.systemLog.count({ where }),
    ]);
    return new Paginated(items, total, q);
  }

  @Get('audit')
  @RequirePermissions(Permission.AuditRead)
  async auditLogs(@Query() q: AuditLogQueryDto): Promise<Paginated<AuditLog & { actor: { email: string } | null }>> {
    const where: Prisma.AuditLogWhereInput = {
      actorId: q.actorId,
      action: q.action,
      entityType: q.entityType,
      createdAt: dateRange(q),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        where,
        include: { actor: { select: { email: true } } },
        orderBy: { createdAt: 'desc' },
        skip: q.skip,
        take: q.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return new Paginated(items, total, q);
  }
}
