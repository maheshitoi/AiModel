import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { HealthService } from './health.service';

describe('HealthService', () => {
  const config = { getOrThrow: () => 'http://ai.local' } as unknown as ConfigService;
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('reports ok when database and AI service are up', async () => {
    const prisma = { $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]) };
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    const report = await new HealthService(prisma as unknown as PrismaService, config).check();

    expect(report.status).toBe('ok');
    expect(report.dependencies.database.status).toBe('up');
    expect(report.dependencies.aiService.status).toBe('up');
    expect(fetchMock).toHaveBeenCalledWith('http://ai.local/health', expect.any(Object));
  });

  it('reports degraded with a single-line error when a dependency is down', async () => {
    const prisma = {
      $queryRaw: jest.fn().mockRejectedValue(new Error("\nInvalid `prisma.$queryRaw()` invocation:\n\n\nCan't reach database")),
    };
    fetchMock.mockResolvedValue({ ok: false, status: 503 });

    const report = await new HealthService(prisma as unknown as PrismaService, config).check();

    expect(report.status).toBe('degraded');
    expect(report.dependencies.database).toMatchObject({ status: 'down', error: "Can't reach database" });
    expect(report.dependencies.aiService).toMatchObject({ status: 'down', error: 'HTTP 503' });
  });
});
