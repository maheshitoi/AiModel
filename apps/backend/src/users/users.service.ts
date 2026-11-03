import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { hashPassword } from '../auth/password';
import type { AuthUser, RequestMeta } from '../common/auth.types';
import { Paginated } from '../common/pagination';
import { Permission } from '../common/permissions';
import { AuditService } from '../logs/audit.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateUserDto, UpdateUserDto, UserQueryDto } from './users.dto';

// Never select passwordHash or lockout internals into API responses.
const PUBLIC_USER = {
  id: true,
  email: true,
  name: true,
  isActive: true,
  lastLoginAt: true,
  lockedUntil: true,
  createdAt: true,
  updatedAt: true,
  role: { select: { id: true, name: true } },
} satisfies Prisma.UserSelect;

export type PublicUser = Prisma.UserGetPayload<{ select: typeof PUBLIC_USER }>;

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(q: UserQueryDto): Promise<Paginated<PublicUser>> {
    const where: Prisma.UserWhereInput = {
      roleId: q.roleId,
      isActive: q.isActive,
      OR: q.search
        ? [
            { name: { contains: q.search, mode: 'insensitive' } },
            { email: { contains: q.search, mode: 'insensitive' } },
          ]
        : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({ where, select: PUBLIC_USER, orderBy: { createdAt: 'desc' }, skip: q.skip, take: q.pageSize }),
      this.prisma.user.count({ where }),
    ]);
    return new Paginated(items, total, q);
  }

  roles() {
    return this.prisma.role.findMany({ orderBy: { name: 'asc' } });
  }

  async create(dto: CreateUserDto, actor: AuthUser, meta: RequestMeta): Promise<PublicUser> {
    const passwordHash = await hashPassword(dto.password);
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: { email: dto.email.trim().toLowerCase(), name: dto.name.trim(), passwordHash, roleId: dto.roleId },
        select: PUBLIC_USER,
      });
      await this.audit.record({ actorId: actor.id, action: 'user.create', entityType: 'User', entityId: user.id, after: user, meta }, tx);
      return user;
    });
  }

  async update(id: string, dto: UpdateUserDto, actor: AuthUser, meta: RequestMeta): Promise<PublicUser> {
    const before = await this.prisma.user.findUniqueOrThrow({ where: { id }, select: PUBLIC_USER });
    if (id === actor.id) await this.assertNotLockingSelfOut(dto);

    const { password, ...changes } = dto;
    const passwordHash = password ? await hashPassword(password) : undefined;

    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id },
        data: { ...changes, name: changes.name?.trim(), passwordHash, ...(password && { failedLoginCount: 0, lockedUntil: null }) },
        select: PUBLIC_USER,
      });
      if (dto.isActive === false || password) {
        await tx.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await this.audit.record(
        {
          actorId: actor.id,
          action: password ? 'user.update_with_password_reset' : 'user.update',
          entityType: 'User',
          entityId: id,
          before,
          after: user,
          meta,
        },
        tx,
      );
      return user;
    });
  }

  /** An admin must not deactivate themselves or drop their own admin rights. */
  private async assertNotLockingSelfOut(dto: UpdateUserDto): Promise<void> {
    if (dto.isActive === false) throw new BadRequestException('You cannot deactivate your own account');
    if (dto.roleId) {
      const role = await this.prisma.role.findUniqueOrThrow({ where: { id: dto.roleId } });
      if (!role.permissions.includes(Permission.All) && !role.permissions.includes(Permission.UsersManage)) {
        throw new BadRequestException('You cannot remove your own user-management access');
      }
    }
  }
}
