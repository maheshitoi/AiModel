import { Injectable, NotFoundException } from '@nestjs/common';
import { WhatsAppAccount } from '@prisma/client';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { CredentialCipher } from '../common/credential-cipher';
import { AuditService } from '../logs/audit.service';
import { SystemLogService } from '../logs/system-log.service';
import { PrismaService } from '../prisma/prisma.service';
import { GraphApiClient, GraphApiError } from './graph-api.client';
import { CreateWhatsAppAccountDto, UpdateWhatsAppAccountDto } from './whatsapp.dto';

/** What the API returns: credentials are never included, only the token's last 4 characters. */
export type PublicWhatsAppAccount = Omit<WhatsAppAccount, 'accessTokenEncrypted' | 'appSecretEncrypted' | 'verifyTokenEncrypted'>;

export interface AccountCredentials {
  accessToken: string;
  appSecret: string;
  verifyToken: string;
}

export function toPublic(account: WhatsAppAccount): PublicWhatsAppAccount {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { accessTokenEncrypted, appSecretEncrypted, verifyTokenEncrypted, ...rest } = account;
  return rest;
}

@Injectable()
export class WhatsAppAccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cipher: CredentialCipher,
    private readonly graph: GraphApiClient,
    private readonly audit: AuditService,
    private readonly logs: SystemLogService,
  ) {}

  async list(): Promise<PublicWhatsAppAccount[]> {
    const accounts = await this.prisma.whatsAppAccount.findMany({ orderBy: { createdAt: 'asc' } });
    return accounts.map(toPublic);
  }

  async create(dto: CreateWhatsAppAccountDto, actor: AuthUser, meta: RequestMeta): Promise<PublicWhatsAppAccount> {
    const account = await this.prisma.$transaction(async (tx) => {
      const created = await tx.whatsAppAccount.create({
        data: {
          displayName: dto.displayName,
          phoneNumber: dto.phoneNumber,
          phoneNumberId: dto.phoneNumberId,
          businessAccountId: dto.businessAccountId,
          autoReplyEnabled: dto.autoReplyEnabled ?? false,
          accessTokenEncrypted: this.cipher.encrypt(dto.accessToken),
          accessTokenLast4: dto.accessToken.slice(-4),
          appSecretEncrypted: this.cipher.encrypt(dto.appSecret),
          verifyTokenEncrypted: this.cipher.encrypt(dto.verifyToken),
        },
      });
      await this.audit.record({ actorId: actor.id, action: 'whatsapp.account.create', entityType: 'WhatsAppAccount', entityId: created.id, after: toPublic(created), meta }, tx);
      return created;
    });
    return toPublic(account);
  }

  async update(id: string, dto: UpdateWhatsAppAccountDto, actor: AuthUser, meta: RequestMeta): Promise<PublicWhatsAppAccount> {
    const before = await this.find(id);
    const credentialsChanged = dto.accessToken !== undefined || dto.phoneNumberId !== undefined;
    const status = dto.enabled === false ? 'DISABLED' : dto.enabled === true && before.status === 'DISABLED' ? 'PENDING' : credentialsChanged ? 'PENDING' : undefined;
    const account = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.whatsAppAccount.update({
        where: { id },
        data: {
          displayName: dto.displayName,
          phoneNumber: dto.phoneNumber,
          phoneNumberId: dto.phoneNumberId,
          businessAccountId: dto.businessAccountId,
          autoReplyEnabled: dto.autoReplyEnabled,
          status,
          ...this.encryptCredentials(dto),
        },
      });
      await this.audit.record(
        {
          actorId: actor.id,
          action: 'whatsapp.account.update',
          entityType: 'WhatsAppAccount',
          entityId: id,
          before: toPublic(before),
          // Which credentials changed, never their values.
          after: { ...toPublic(updated), credentialsChanged: ['accessToken', 'appSecret', 'verifyToken'].filter((k) => dto[k as keyof typeof dto] !== undefined) },
          meta,
        },
        tx,
      );
      return updated;
    });
    return toPublic(account);
  }

  /** Calls the Graph API with the stored token; marks the account CONNECTED or ERROR. */
  async verify(id: string, actor: AuthUser): Promise<PublicWhatsAppAccount & { verification: { ok: boolean; message: string } }> {
    const account = await this.find(id);
    const { accessToken } = this.credentials(account);
    let ok = false;
    let message: string;
    try {
      const info = await this.graph.phoneNumber(account.phoneNumberId, accessToken);
      ok = true;
      message = `Connected to ${info.verified_name} (${info.display_phone_number})`;
    } catch (error) {
      message = error instanceof GraphApiError ? error.message : 'Verification failed';
    }
    const updated = await this.prisma.whatsAppAccount.update({
      where: { id },
      data: { status: ok ? 'CONNECTED' : 'ERROR', ...(ok ? { lastVerifiedAt: new Date() } : {}) },
    });
    await this.logs.write(ok ? 'INFO' : 'WARN', 'WHATSAPP', ok ? 'whatsapp.account.verified' : 'whatsapp.account.verify_failed', message, { accountId: id, actorId: actor.id });
    return { ...toPublic(updated), verification: { ok, message } };
  }

  credentials(account: WhatsAppAccount): AccountCredentials {
    return {
      accessToken: this.cipher.decrypt(account.accessTokenEncrypted),
      appSecret: this.cipher.decrypt(account.appSecretEncrypted),
      verifyToken: this.cipher.decrypt(account.verifyTokenEncrypted),
    };
  }

  private async find(id: string): Promise<WhatsAppAccount> {
    const account = await this.prisma.whatsAppAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('WhatsApp account not found');
    return account;
  }

  private encryptCredentials(dto: Partial<CreateWhatsAppAccountDto>) {
    return {
      ...(dto.accessToken !== undefined && { accessTokenEncrypted: this.cipher.encrypt(dto.accessToken), accessTokenLast4: dto.accessToken.slice(-4) }),
      ...(dto.appSecret !== undefined && { appSecretEncrypted: this.cipher.encrypt(dto.appSecret) }),
      ...(dto.verifyToken !== undefined && { verifyTokenEncrypted: this.cipher.encrypt(dto.verifyToken) }),
    };
  }
}
