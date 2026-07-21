import type { NextFunction, Request, RequestHandler, Response } from 'express';
import jwt, { type JwtPayload } from 'jsonwebtoken';
import { AppError } from '../utils/errors';

export type Permission = 'artscape:read' | 'artscape:write' | 'artscape:export' | 'artscape:admin';

export interface AuthPrincipal {
  userId: string;
  roles: string[];
  permissions: Permission[];
  source: 'jwt' | 'trusted-development-header';
}

export interface AuthenticatedRequest extends Request {
  principal?: AuthPrincipal;
}

const rolePermissions: Record<string, Permission[]> = {
  viewer: ['artscape:read'],
  'portfolio-owner': ['artscape:read', 'artscape:write', 'artscape:export'],
  admin: ['artscape:read', 'artscape:write', 'artscape:export', 'artscape:admin'],
};

const textArray = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];

export const authenticate: RequestHandler = (req: AuthenticatedRequest, _res, next) => {
  try {
    const authorization = req.get('authorization');
    if (authorization?.startsWith('Bearer ')) {
      const secret = process.env.JWT_SECRET;
      if (!secret) throw new AppError('JWT authentication is not configured.', 503, 'AUTH_NOT_CONFIGURED');
      const decoded = jwt.verify(authorization.slice(7), secret, {
        algorithms: ['HS256'],
        issuer: process.env.JWT_ISSUER || undefined,
        audience: process.env.JWT_AUDIENCE || undefined,
      }) as JwtPayload;
      const userId = String(decoded.sub ?? '').trim();
      if (!userId) throw new AppError('JWT subject is required.', 401, 'INVALID_TOKEN');
      const roles = textArray(decoded.roles);
      const claimedPermissions = textArray(decoded.permissions) as Permission[];
      req.principal = {
        userId,
        roles,
        permissions: [...new Set([...roles.flatMap((role) => rolePermissions[role] ?? []), ...claimedPermissions])],
        source: 'jwt',
      };
      next();
      return;
    }

    if (process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEV_AUTH_HEADERS !== 'false') {
      const userId = String(req.get('x-user-id') ?? '').trim();
      if (userId) {
        const roles = String(req.get('x-user-roles') ?? 'portfolio-owner')
          .split(',')
          .map((role) => role.trim())
          .filter(Boolean);
        req.principal = {
          userId,
          roles,
          permissions: [...new Set(roles.flatMap((role) => rolePermissions[role] ?? []))],
          source: 'trusted-development-header',
        };
        next();
        return;
      }
    }
    throw new AppError('Authentication is required.', 401, 'AUTH_REQUIRED');
  } catch (error) {
    if (error instanceof AppError) return next(error);
    return next(new AppError('Invalid or expired token.', 401, 'INVALID_TOKEN'));
  }
};

export const requirePermission = (permission: Permission): RequestHandler =>
  (req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
    if (!req.principal?.permissions.includes(permission)) {
      next(new AppError('Permission denied.', 403, 'FORBIDDEN'));
      return;
    }
    next();
  };

export function principalUserId(req: Request): string {
  const userId = (req as AuthenticatedRequest).principal?.userId;
  if (!userId) throw new AppError('Authentication is required.', 401, 'AUTH_REQUIRED');
  return userId;
}
