import { Request, Response, NextFunction } from 'express';
import { verifyAccessToken } from '../utils/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError.js';
import { prisma } from '../services/prisma.js';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: string;
  permissions: string[];
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    let token: string | undefined;

    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7).trim();
    }

    if (!token) {
      return next(new UnauthorizedError('Authentication required. Session or Bearer token missing.'));
    }

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      return next(new UnauthorizedError('Access token is invalid or expired.'));
    }

    // Verify session has not been revoked
    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      include: { user: true }
    });

    if (!session || session.revokedAt) {
      return next(new UnauthorizedError('Session has been revoked. Please sign in again.'));
    }

    if (!session.user.isActive) {
      return next(new ForbiddenError('Account has been deactivated.'));
    }

    req.user = {
      id: payload.sub,
      email: payload.email,
      role: payload.role,
      permissions: payload.permissions || [],
      sessionId: payload.sessionId
    };

    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(...allowedRoles: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new UnauthorizedError('Authentication required'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(new ForbiddenError(`Access denied. Role ${req.user.role} does not have access to this resource.`));
    }

    next();
  };
}

import { rbacService } from '../services/rbacService.js';

export function requirePermission(actionOrKey: string, subject?: string) {
  // Support both requirePermission('contacts.view') and requirePermission('view', 'contacts')
  const permKey = subject ? `${subject}.${actionOrKey}` : actionOrKey;

  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!req.user) {
        return next(new UnauthorizedError('Authentication required'));
      }

      // SUPER_ADMIN has full operational privileges
      if (req.user.role === 'SUPER_ADMIN') {
        return next();
      }

      const hasPermission = await rbacService.hasPermission(req.user.role, permKey);

      if (!hasPermission) {
        return next(
          new ForbiddenError(
            `Permission denied. Missing required permission: ${permKey}`
          )
        );
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}
