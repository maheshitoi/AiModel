import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  // rawBody: the WhatsApp webhook signature is computed over the exact bytes Meta sent.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  const config = app.get(ConfigService);
  const production = config.get('NODE_ENV') === 'production';
  // Behind Caddy: take the client IP from X-Forwarded-For (audit logs, sessions, rate limits).
  const proxies = Number(config.get('TRUST_PROXY') ?? 0);
  if (proxies > 0) app.set('trust proxy', proxies);

  app.use(helmet());
  app.use(cookieParser());
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.getOrThrow<string>('CORS_ORIGINS').split(',').map((o) => o.trim()),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.enableShutdownHooks();

  const swagger = config.get<string>('SWAGGER_ENABLED') || (production ? 'false' : 'true');
  const swaggerConfig = new DocumentBuilder()
    .setTitle('My Own AI API')
    .setDescription('Backend API for the self-trained AI + WhatsApp automation platform')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  if (swagger === 'true') SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, swaggerConfig));

  const port = config.getOrThrow<number>('BACKEND_PORT');
  await app.listen(port);
  Logger.log(`Backend listening on port ${port} (/api/v1${swagger === 'true' ? ', docs: /api/docs' : ''})`, 'Bootstrap');
}

void bootstrap();
