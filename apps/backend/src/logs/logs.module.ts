import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { LogRetentionService } from './log-retention.service';
import { LogsController } from './logs.controller';
import { SystemLogService } from './system-log.service';

@Global()
@Module({
  controllers: [LogsController],
  providers: [SystemLogService, AuditService, LogRetentionService],
  exports: [SystemLogService, AuditService],
})
export class LogsModule {}
