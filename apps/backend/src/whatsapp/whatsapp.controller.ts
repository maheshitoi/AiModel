import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthUser, requestMeta } from '../common/auth.types';
import { CurrentUser, Public, RequirePermissions } from '../common/decorators';
import { Permission } from '../common/permissions';
import { SystemLogService } from '../logs/system-log.service';
import type { WebhookPayload } from './webhook.types';
import { WhatsAppWebhookService } from './webhook.service';
import { CreateWhatsAppAccountDto, UpdateWhatsAppAccountDto } from './whatsapp.dto';
import { WhatsAppAccountsService } from './whatsapp-accounts.service';

@ApiTags('whatsapp')
@ApiBearerAuth()
@Controller('whatsapp/accounts')
export class WhatsAppAccountsController {
  constructor(private readonly accounts: WhatsAppAccountsService) {}

  @Get()
  @RequirePermissions(Permission.SettingsRead)
  list() {
    return this.accounts.list();
  }

  @Post()
  @RequirePermissions(Permission.WhatsAppManage)
  create(@Body() dto: CreateWhatsAppAccountDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.accounts.create(dto, actor, requestMeta(req));
  }

  @Patch(':id')
  @RequirePermissions(Permission.WhatsAppManage)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWhatsAppAccountDto, @CurrentUser() actor: AuthUser, @Req() req: Request) {
    return this.accounts.update(id, dto, actor, requestMeta(req));
  }

  @Post(':id/verify')
  @HttpCode(200)
  @RequirePermissions(Permission.WhatsAppManage)
  verify(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: AuthUser) {
    return this.accounts.verify(id, actor);
  }
}

/** Meta calls these. They are public but every POST must carry a valid X-Hub-Signature-256. */
@ApiTags('webhooks')
@Public()
@SkipThrottle() // Meta delivers in bursts; a 429 would only make it retry
@Controller('webhooks/whatsapp')
export class WhatsAppWebhookController {
  constructor(
    private readonly webhooks: WhatsAppWebhookService,
    private readonly logs: SystemLogService,
  ) {}

  @Get()
  @ApiExcludeEndpoint()
  @SkipThrottle({ default: false }) // Meta calls this once per setup; rate-limit guessing
  async verify(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string, @Res() res: Response) {
    if (mode === 'subscribe' && token && challenge && challenge.length <= 200 && (await this.webhooks.verifyToken(token))) {
      // Plain text, exactly as received: that is what Meta expects back.
      res.status(200).type('text/plain').send(challenge);
      return;
    }
    await this.logs.warn('SECURITY', 'webhook.verify_rejected', 'WhatsApp webhook verification failed (wrong verify token)');
    res.status(403).type('text/plain').send('Forbidden');
  }

  @Post()
  @HttpCode(200)
  @ApiExcludeEndpoint()
  async receive(@Req() req: RawBodyRequest<Request>, @Headers('x-hub-signature-256') signature?: string) {
    const payload = req.body as WebhookPayload;
    if (!req.rawBody || typeof payload !== 'object' || payload === null) throw new BadRequestException('Expected a JSON body');
    const accounts = await this.webhooks.authenticate(payload, req.rawBody, signature);
    if (accounts === null) {
      await this.logs.warn('SECURITY', 'webhook.signature_invalid', 'Rejected a WhatsApp webhook with an invalid signature', { ip: req.ip });
      throw new UnauthorizedException('Invalid signature');
    }
    if (accounts.length === 0) {
      // Not for any number configured here. Acknowledge, so Meta does not keep retrying.
      await this.logs.warn('WEBHOOK', 'webhook.unknown_phone_number', 'Received a WhatsApp webhook for an unknown phone number');
      return { received: true };
    }
    const result = await this.webhooks.process(payload, accounts);
    return { received: true, ...result };
  }
}
