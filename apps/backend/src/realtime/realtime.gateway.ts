import { Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { OnGatewayConnection, OnGatewayInit, WebSocketGateway } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { hasPermissions, Permission } from '../common/permissions';
import { INBOX_ROOM, RealtimeService } from './realtime.service';

const allowedOrigins = () => (process.env.CORS_ORIGINS ?? 'http://localhost:3000').split(',').map((o) => o.trim());

/**
 * Socket.IO endpoint for the live inbox (path /socket.io). Clients authenticate with their access
 * token in the handshake (`auth: { token }`). The socket is closed when that token expires, so the
 * client reconnects with a refreshed one and a revoked session cannot keep listening.
 */
@WebSocketGateway({
  cors: { origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => cb(null, !origin || allowedOrigins().includes(origin)), credentials: true },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.attach(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    const token = (client.handshake.auth as { token?: unknown } | undefined)?.token;
    try {
      if (typeof token !== 'string' || !token) throw new Error('missing token');
      const user = await this.auth.authenticate(token);
      if (!hasPermissions(user.permissions, [Permission.ConversationsRead])) throw new Error('forbidden');
      const { exp } = this.jwt.decode<{ exp: number }>(token);
      const timer = setTimeout(() => client.disconnect(true), Math.max(0, exp * 1000 - Date.now()));
      client.once('disconnect', () => clearTimeout(timer));
      await client.join(INBOX_ROOM);
    } catch (error) {
      this.logger.debug(`Rejected socket: ${(error as Error).message}`);
      client.emit('auth_error', 'unauthorized');
      client.disconnect(true);
    }
  }
}
