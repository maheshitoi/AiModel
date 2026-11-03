import type { Request } from 'express';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  sessionId: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthUser;
}

export interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export function requestMeta(req: Request): RequestMeta {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent']?.slice(0, 500) };
}
