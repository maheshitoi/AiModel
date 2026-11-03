import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ClassConstructor, plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { AuditService } from '../logs/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { SETTING_DEFAULTS } from './settings.defaults';
import { isSettingKey, SETTING_SCHEMAS, SettingKey, SettingValue } from './settings.dto';

export interface SettingView {
  key: string;
  value: unknown;
  description: string | null;
  updatedAt: Date | null;
}

@Injectable()
export class SettingsService {
  // Settings are read on hot paths (every login, every AI reply). Single-instance cache,
  // invalidated on write; revisit if the backend is scaled horizontally.
  private readonly cache = new Map<SettingKey, unknown>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get<K extends SettingKey>(key: K): Promise<SettingValue<K>> {
    if (!this.cache.has(key)) {
      const row = await this.prisma.systemSetting.findUnique({ where: { key } });
      // Merge over defaults so settings stored before a new field was added stay valid.
      this.cache.set(key, { ...SETTING_DEFAULTS[key].value, ...(row?.value as object | undefined) });
    }
    return this.cache.get(key) as SettingValue<K>;
  }

  async list(): Promise<SettingView[]> {
    const rows = await this.prisma.systemSetting.findMany();
    const byKey = new Map(rows.map((r) => [r.key, r]));
    return Promise.all(
      (Object.keys(SETTING_SCHEMAS) as SettingKey[]).map(async (key) => ({
        key,
        value: await this.get(key),
        description: byKey.get(key)?.description ?? SETTING_DEFAULTS[key].description,
        updatedAt: byKey.get(key)?.updatedAt ?? null,
      })),
    );
  }

  /** Partial update: the patch is merged over the current value and the result is validated as a whole. */
  async update(key: string, patch: Record<string, unknown>, actor: AuthUser, meta: RequestMeta): Promise<SettingView> {
    if (!isSettingKey(key)) throw new NotFoundException(`Unknown setting "${key}"`);

    const before = await this.get(key);
    const schema: ClassConstructor<object> = SETTING_SCHEMAS[key];
    const next = plainToInstance(schema, { ...before, ...patch });
    const errors = await validate(next, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: errors.flatMap((e) => Object.values(e.constraints ?? {})),
      });
    }
    if (key === 'ai.generation') await this.assertFitsActiveModel(next as SettingValue<'ai.generation'>);

    const value = { ...next } as Prisma.InputJsonValue;
    const row = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.systemSetting.upsert({
        where: { key },
        create: { key, value, description: SETTING_DEFAULTS[key].description, updatedById: actor.id },
        update: { value, updatedById: actor.id },
      });
      await this.audit.record(
        { actorId: actor.id, action: 'settings.update', entityType: 'SystemSetting', entityId: key, before, after: value, meta },
        tx,
      );
      return saved;
    });
    this.cache.delete(key);
    return { key, value: row.value, description: row.description, updatedAt: row.updatedAt };
  }

  private async assertFitsActiveModel(value: SettingValue<'ai.generation'>): Promise<void> {
    const active = await this.prisma.modelVersion.findFirst({ where: { isActive: true } });
    if (active && value.maxContextTokens > active.contextLength) {
      throw new BadRequestException({
        message: 'Validation failed',
        details: [`maxContextTokens must not exceed the active model's context length (${active.contextLength})`],
      });
    }
  }
}
