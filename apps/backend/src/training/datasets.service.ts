import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DatasetFormat, DatasetStatus, Prisma, TrainingDataset } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { AiClientService, AiDatasetReport, AiServiceError } from '../ai/ai-client.service';
import { callAi } from '../ai/call-ai';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { Paginated } from '../common/pagination';
import { AuditService } from '../logs/audit.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { ApproveDatasetDto, DatasetQueryDto, ExportConversationsDto, UploadDatasetDto } from './training.dto';

export interface UploadedFile {
  originalname: string;
  buffer: Buffer;
  size: number;
}

const FORMATS: Record<string, DatasetFormat> = { json: 'JSON', jsonl: 'JSONL', txt: 'TXT' };
// The dataset schema rejects longer turns; cleaning then cuts them to max_turn_chars anyway.
const MAX_TURN_CHARS = 4000;
const SENT = ['SENT', 'DELIVERED', 'READ'] as const;

const datasetSelect = {
  id: true,
  name: true,
  version: true,
  description: true,
  fileName: true,
  format: true,
  sizeBytes: true,
  checksumSha256: true,
  recordCount: true,
  duplicateCount: true,
  validationErrors: true,
  stats: true,
  status: true,
  isActive: true,
  containsCustomerData: true,
  approvedAt: true,
  createdAt: true,
  updatedAt: true,
  uploadedBy: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  _count: { select: { trainingJobs: true } },
} satisfies Prisma.TrainingDatasetSelect;

/** VALID only if every record is usable and something is left to train on. */
function fromReport(report: AiDatasetReport) {
  const { issues, issue_count, size_bytes, sha256, ...stats } = report;
  return {
    status: (issue_count === 0 && report.unique > 0 ? 'VALID' : 'INVALID') as DatasetStatus,
    recordCount: report.records,
    duplicateCount: report.duplicates,
    validationErrors: { issueCount: issue_count, issues, ...(report.unique === 0 ? { empty: true } : {}) },
    stats,
  };
}

/**
 * Training datasets. The files themselves live in the AI service; this service keeps their metadata
 * and enforces the review rules: a dataset is used for training only after it validated cleanly, a
 * person approved it, and it was activated. Customer data is never exported automatically.
 */
@Injectable()
export class DatasetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiClientService,
    private readonly audit: AuditService,
    private readonly logs: SystemLogService,
  ) {}

  async list(q: DatasetQueryDto) {
    const where: Prisma.TrainingDatasetWhereInput = {
      status: q.status,
      ...(q.search ? { OR: [{ name: { contains: q.search, mode: 'insensitive' } }, { fileName: { contains: q.search, mode: 'insensitive' } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.trainingDataset.findMany({ where, select: datasetSelect, orderBy: [{ createdAt: 'desc' }], skip: q.skip, take: q.pageSize }),
      this.prisma.trainingDataset.count({ where }),
    ]);
    return new Paginated(items, total, q);
  }

  async get(id: string) {
    const dataset = await this.prisma.trainingDataset.findUnique({ where: { id }, select: datasetSelect });
    if (!dataset) throw new NotFoundException('Dataset not found');
    return dataset;
  }

  async upload(file: UploadedFile | undefined, dto: UploadDatasetDto, actor: AuthUser, meta: RequestMeta) {
    if (!file) throw new BadRequestException('Attach a file');
    const format = FORMATS[file.originalname.split('.').pop()?.toLowerCase() ?? ''];
    if (!format) throw new BadRequestException('Use a .json, .jsonl or .txt file');
    return this.create(file.buffer, format, file.originalname.slice(-200), dto.name, dto.description, dto.containsCustomerData, actor, meta);
  }

  /** Builds a JSONL dataset from stored conversations. It still has to be reviewed and approved like any upload. */
  async exportConversations(dto: ExportConversationsDto, actor: AuthUser, meta: RequestMeta) {
    const conversations = await this.prisma.conversation.findMany({
      where: {
        ...(dto.closedOnly ? { status: 'CLOSED' } : {}),
        lastMessageAt: { gte: new Date(dto.since), ...(dto.until ? { lte: new Date(dto.until) } : {}) },
      },
      orderBy: { lastMessageAt: 'desc' },
      take: dto.limit,
      select: {
        id: true,
        messages: {
          where: { type: 'TEXT', body: { not: null }, OR: [{ direction: 'INBOUND' }, { direction: 'OUTBOUND', status: { in: [...SENT] } }] },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { direction: true, body: true },
        },
      },
    });
    const lines: string[] = [];
    for (const c of conversations) {
      const turns: { role: 'customer' | 'assistant'; text: string }[] = [];
      for (const m of c.messages) {
        const role = m.direction === 'INBOUND' ? 'customer' : 'assistant';
        const text = (m.body ?? '').trim();
        if (!text) continue;
        const last = turns[turns.length - 1];
        if (last?.role === role) last.text = `${last.text}\n${text}`.slice(0, MAX_TURN_CHARS);
        else if (turns.length > 0 || role === 'customer') turns.push({ role, text: text.slice(0, MAX_TURN_CHARS) });
      }
      if (turns[turns.length - 1]?.role === 'customer') turns.pop(); // nothing to learn from an unanswered message
      if (turns.length >= 2) lines.push(JSON.stringify({ messages: turns, source: 'conversations' }));
    }
    if (lines.length === 0) throw new BadRequestException('No conversations in that range have both a customer message and a sent reply');
    const content = Buffer.from(`${lines.join('\n')}\n`, 'utf8');
    const fileName = `conversations-${dto.since.slice(0, 10)}${dto.until ? `-to-${dto.until.slice(0, 10)}` : ''}.jsonl`;
    return this.create(content, 'JSONL', fileName, dto.name, dto.description, true, actor, meta, { conversations: lines.length });
  }

  private async create(
    content: Buffer,
    format: DatasetFormat,
    fileName: string,
    name: string,
    description: string | undefined,
    containsCustomerData: boolean,
    actor: AuthUser,
    meta: RequestMeta,
    extra: Record<string, unknown> = {},
  ) {
    const checksum = createHash('sha256').update(content).digest('hex');
    const duplicate = await this.prisma.trainingDataset.findFirst({
      where: { checksumSha256: checksum, status: { not: 'ARCHIVED' } },
      select: { name: true, version: true },
    });
    if (duplicate) throw new ConflictException(`This file was already uploaded as ${duplicate.name} v${duplicate.version}`);

    const id = randomUUID();
    const report = await callAi(() => this.ai.uploadDataset(id, format.toLowerCase() as 'json' | 'jsonl' | 'txt', content));
    try {
      const dataset = await this.createRow(id, { name, description, fileName, format, containsCustomerData, checksum, size: content.length, report, actor });
      await this.audit.record({
        actorId: actor.id,
        action: 'dataset.upload',
        entityType: 'TrainingDataset',
        entityId: id,
        after: { name, version: dataset.version, fileName, records: report.records, status: dataset.status, containsCustomerData, ...extra },
        meta,
      });
      await this.logs.info('TRAINING', 'dataset.uploaded', `Dataset ${name} v${dataset.version} uploaded (${dataset.status.toLowerCase()})`, {
        records: report.records,
        issues: report.issue_count,
      });
      return this.get(id);
    } catch (error) {
      await this.ai.deleteDataset(id).catch(() => undefined); // don't leave an orphaned file behind
      throw error;
    }
  }

  private async createRow(
    id: string,
    f: { name: string; description?: string; fileName: string; format: DatasetFormat; containsCustomerData: boolean; checksum: string; size: number; report: AiDatasetReport; actor: AuthUser },
  ): Promise<TrainingDataset> {
    for (let attempt = 0; ; attempt++) {
      const last = await this.prisma.trainingDataset.findFirst({ where: { name: f.name }, orderBy: { version: 'desc' }, select: { version: true } });
      try {
        return await this.prisma.trainingDataset.create({
          data: {
            id,
            name: f.name,
            version: (last?.version ?? 0) + 1,
            description: f.description,
            fileName: f.fileName,
            storagePath: `${id}.${f.format.toLowerCase()}`,
            format: f.format,
            sizeBytes: f.size,
            checksumSha256: f.checksum,
            containsCustomerData: f.containsCustomerData,
            uploadedById: f.actor.id,
            ...fromReport(f.report),
          },
        });
      } catch (error) {
        // Someone uploaded the same name at the same moment and took the version number.
        if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') || attempt >= 2) throw error;
      }
    }
  }

  async preview(id: string, offset: number, limit: number, actor: AuthUser, meta: RequestMeta) {
    const dataset = await this.get(id);
    const page = await callAi(() => this.ai.previewDataset(id, offset, limit));
    if (dataset.containsCustomerData) {
      // Reading customer conversations is recorded, like any other access to customer data.
      await this.audit.record({ actorId: actor.id, action: 'dataset.preview', entityType: 'TrainingDataset', entityId: id, after: { offset, limit }, meta });
    }
    return page;
  }

  async validate(id: string, actor: AuthUser, meta: RequestMeta) {
    const dataset = await this.get(id);
    if (dataset.status === 'ARCHIVED') throw new ConflictException('Archived datasets are kept as they were');
    const report = await callAi(() => this.ai.validateDataset(id));
    const result = fromReport(report);
    // Still clean: keep an approval. Problems now: the approval no longer stands.
    const keepApproval = dataset.status === 'APPROVED' && result.status === 'VALID';
    await this.prisma.trainingDataset.update({
      where: { id },
      data: { ...result, ...(keepApproval ? { status: 'APPROVED' } : { approvedById: null, approvedAt: null, isActive: result.status === 'VALID' && dataset.isActive }) },
    });
    await this.audit.record({
      actorId: actor.id,
      action: 'dataset.validate',
      entityType: 'TrainingDataset',
      entityId: id,
      before: { status: dataset.status },
      after: { status: keepApproval ? 'APPROVED' : result.status, issues: report.issue_count },
      meta,
    });
    return this.get(id);
  }

  async approve(id: string, dto: ApproveDatasetDto, actor: AuthUser, meta: RequestMeta) {
    const dataset = await this.get(id);
    if (dataset.status !== 'VALID') throw new ConflictException(`Only valid datasets can be approved (this one is ${dataset.status.toLowerCase()})`);
    if (dataset.containsCustomerData && dto.reviewedCustomerData !== true) {
      throw new BadRequestException('This dataset contains customer conversations: confirm you reviewed the preview first');
    }
    await this.prisma.trainingDataset.update({ where: { id }, data: { status: 'APPROVED', approvedById: actor.id, approvedAt: new Date() } });
    await this.audit.record({
      actorId: actor.id,
      action: 'dataset.approve',
      entityType: 'TrainingDataset',
      entityId: id,
      after: { name: dataset.name, version: dataset.version, containsCustomerData: dataset.containsCustomerData },
      meta,
    });
    return this.get(id);
  }

  async setActive(id: string, isActive: boolean, actor: AuthUser, meta: RequestMeta) {
    const dataset = await this.get(id);
    if (isActive && dataset.status !== 'APPROVED') throw new ConflictException('Approve the dataset before activating it');
    if (dataset.isActive === isActive) return dataset;
    await this.prisma.trainingDataset.update({ where: { id }, data: { isActive } });
    await this.audit.record({
      actorId: actor.id,
      action: isActive ? 'dataset.activate' : 'dataset.deactivate',
      entityType: 'TrainingDataset',
      entityId: id,
      before: { isActive: dataset.isActive },
      after: { isActive },
      meta,
    });
    return this.get(id);
  }

  /** Deletes the dataset and its file. Datasets a training job used are archived instead, so that job stays reproducible. */
  async remove(id: string, actor: AuthUser, meta: RequestMeta): Promise<{ deleted: boolean; archived: boolean }> {
    const dataset = await this.get(id);
    const before = { name: dataset.name, version: dataset.version, status: dataset.status };
    if (dataset._count.trainingJobs > 0) {
      await this.prisma.trainingDataset.update({ where: { id }, data: { status: 'ARCHIVED', isActive: false } });
      await this.audit.record({ actorId: actor.id, action: 'dataset.archive', entityType: 'TrainingDataset', entityId: id, before, after: { status: 'ARCHIVED' }, meta });
      return { deleted: false, archived: true };
    }
    await callAi(() =>
      this.ai.deleteDataset(id).catch((error: unknown) => {
        if (!(error instanceof AiServiceError && error.kind === 'not_found')) throw error;
      }),
    );
    await this.prisma.trainingDataset.delete({ where: { id } });
    await this.audit.record({ actorId: actor.id, action: 'dataset.delete', entityType: 'TrainingDataset', entityId: id, before, meta });
    return { deleted: true, archived: false };
  }
}
