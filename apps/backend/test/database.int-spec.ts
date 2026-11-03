import { Prisma, PrismaClient } from '@prisma/client';
import { ROLE_PERMISSIONS } from '../src/common/permissions';
import { seedDatabase } from '../src/database/seed';
import { SETTING_DEFAULTS } from '../src/settings/settings.defaults';
import { getTestDatabaseUrl } from './test-database';

const prisma = new PrismaClient({ datasources: { db: { url: getTestDatabaseUrl() } } });

const uniqueViolation = expect.objectContaining({ code: 'P2002' });

async function createConversation(customerWaId = '15550001111') {
  const account = await prisma.whatsAppAccount.create({
    data: {
      displayName: 'Test business',
      phoneNumber: '+15550000000',
      phoneNumberId: `pnid-${customerWaId}-${Date.now()}`,
      businessAccountId: 'waba-1',
      accessTokenEncrypted: 'cipher',
      accessTokenLast4: 'abcd',
      appSecretEncrypted: 'cipher',
      verifyTokenEncrypted: 'cipher',
    },
  });
  return prisma.conversation.create({ data: { whatsAppAccountId: account.id, customerWaId } });
}

function inbound(conversationId: string, waMessageId: string): Prisma.MessageUncheckedCreateInput {
  return { conversationId, direction: 'INBOUND', source: 'CUSTOMER', status: 'RECEIVED', body: 'Hi', waMessageId };
}

afterAll(() => prisma.$disconnect());

describe('seed', () => {
  it('creates roles, settings and the base model, and is idempotent', async () => {
    await seedDatabase(prisma);
    await prisma.systemSetting.update({ where: { key: 'system' }, data: { value: { timezone: 'Asia/Kolkata' } } });
    await seedDatabase(prisma);

    expect(await prisma.role.count()).toBe(Object.keys(ROLE_PERMISSIONS).length);
    expect(await prisma.systemSetting.count()).toBe(Object.keys(SETTING_DEFAULTS).length);
    expect(await prisma.aIModel.count()).toBe(1);
    // A user-changed setting must survive re-seeding.
    const system = await prisma.systemSetting.findUniqueOrThrow({ where: { key: 'system' } });
    expect(system.value).toEqual({ timezone: 'Asia/Kolkata' });
  });
});

describe('WhatsApp idempotency constraints', () => {
  it('rejects a second message with the same WhatsApp message ID (webhook redelivery)', async () => {
    const convo = await createConversation('15550000001');
    await prisma.message.create({ data: inbound(convo.id, 'wamid.DUP') });

    await expect(prisma.message.create({ data: inbound(convo.id, 'wamid.DUP') })).rejects.toEqual(uniqueViolation);
  });

  it('allows at most one AI reply per inbound message', async () => {
    const convo = await createConversation('15550000002');
    const msg = await prisma.message.create({ data: inbound(convo.id, 'wamid.Q1') });
    const reply: Prisma.MessageUncheckedCreateInput = {
      conversationId: convo.id,
      direction: 'OUTBOUND',
      source: 'AI',
      status: 'QUEUED',
      body: 'Hello!',
      aiReplyToId: msg.id,
    };
    await prisma.message.create({ data: reply });

    await expect(prisma.message.create({ data: reply })).rejects.toEqual(uniqueViolation);
  });

  it('ignores duplicate status updates for the same message', async () => {
    const convo = await createConversation('15550000003');
    const msg = await prisma.message.create({ data: inbound(convo.id, 'wamid.S1') });
    const status = { messageId: msg.id, status: 'DELIVERED' as const, occurredAt: new Date() };
    await prisma.messageStatusHistory.create({ data: status });

    await expect(prisma.messageStatusHistory.create({ data: status })).rejects.toEqual(uniqueViolation);
  });

  it('keeps one conversation per customer per WhatsApp account', async () => {
    const convo = await createConversation('15550000004');

    await expect(
      prisma.conversation.create({ data: { whatsAppAccountId: convo.whatsAppAccountId, customerWaId: '15550000004' } }),
    ).rejects.toEqual(uniqueViolation);
  });
});

describe('transactions and cascades', () => {
  it('rolls back the conversation update when the message insert fails', async () => {
    const convo = await createConversation('15550000005');
    await prisma.message.create({ data: inbound(convo.id, 'wamid.TX') });

    await expect(
      prisma.$transaction([
        prisma.conversation.update({ where: { id: convo.id }, data: { unreadCount: { increment: 1 } } }),
        prisma.message.create({ data: inbound(convo.id, 'wamid.TX') }),
      ]),
    ).rejects.toEqual(uniqueViolation);

    const after = await prisma.conversation.findUniqueOrThrow({ where: { id: convo.id } });
    expect(after.unreadCount).toBe(0);
  });

  it('deletes messages and status history with their conversation', async () => {
    const convo = await createConversation('15550000006');
    const msg = await prisma.message.create({ data: inbound(convo.id, 'wamid.C1') });
    await prisma.messageStatusHistory.create({ data: { messageId: msg.id, status: 'READ', occurredAt: new Date() } });

    await prisma.conversation.delete({ where: { id: convo.id } });

    expect(await prisma.message.count({ where: { conversationId: convo.id } })).toBe(0);
    expect(await prisma.messageStatusHistory.count({ where: { messageId: msg.id } })).toBe(0);
  });
});

describe('model versions', () => {
  it('allows only one active model version platform-wide', async () => {
    const model = await prisma.aIModel.create({ data: { name: 'constraint-test' } });
    const base = { modelId: model.id, config: {}, parameterCount: 1, vocabSize: 256, contextLength: 128 };
    await prisma.modelVersion.create({ data: { ...base, version: 1, isActive: true } });
    await prisma.modelVersion.create({ data: { ...base, version: 2 } });
    await prisma.modelVersion.create({ data: { ...base, version: 3 } });

    await expect(prisma.modelVersion.create({ data: { ...base, version: 4, isActive: true } })).rejects.toEqual(
      uniqueViolation,
    );
  });
});
