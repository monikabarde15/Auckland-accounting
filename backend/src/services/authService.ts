import crypto from 'crypto';
import { prisma } from './prisma.js';
import { comparePassword } from '../utils/password.js';
import { signAccessToken } from '../utils/jwt.js';
import { UnauthorizedError, ForbiddenError } from '../errors/AppError.js';
import { logger } from '../middleware/logger.js';

const REFRESH_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export function hashToken(rawToken: string): string {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

export function generateTokenSecret(): string {
  return crypto.randomBytes(32).toString('hex');
}

export interface SafeUser {
  id: string;
  email: string;
  name: string;
  role: string;
  permissions: string[];
  isActive: boolean;
  lastLoginAt?: Date | null;
  createdAt: Date;
}

function extractUserRoleAndPermissions(user: {
  userRoles: Array<{
    role: {
      name: string;
      permissions: Array<{
        permission: {
          action: string;
          subject: string;
        };
      }>;
    };
  }>;
}): { role: string; permissions: string[] } {
  const primaryRole = user.userRoles[0]?.role.name || 'OPERATOR';
  const permissionsSet = new Set<string>();

  if (primaryRole === 'SUPER_ADMIN') {
    permissionsSet.add('*');
    permissionsSet.add('manage:all');
    permissionsSet.add('all.manage');
  }

  for (const ur of user.userRoles) {
    for (const rp of ur.role.permissions) {
      permissionsSet.add(`${rp.permission.subject}.${rp.permission.action}`);
      permissionsSet.add(`${rp.permission.action}:${rp.permission.subject}`);
      if (rp.permission.action === 'manage') {
        permissionsSet.add(`${rp.permission.subject}.*`);
        permissionsSet.add(`manage:${rp.permission.subject}`);
      }
    }
  }

  return {
    role: primaryRole,
    permissions: Array.from(permissionsSet)
  };
}

export async function loginUser(
  email: string,
  plainPassword: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{
  user: SafeUser;
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
}> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true }
              }
            }
          }
        }
      }
    }
  });

  if (!user) {
    // Constant time comparison dummy to prevent timing enumeration attacks (verified 12-round bcrypt hash)
    await comparePassword(plainPassword, '$2b$12$eh.5LRM00psoFbLghv4UsOIs29f/eRdLh06GlvkuNg23sf9i/Hqre');
    throw new UnauthorizedError('Invalid email or password');
  }

  if (!user.isActive) {
    throw new ForbiddenError('Account has been deactivated. Please contact your system administrator.');
  }

  const isPasswordValid = await comparePassword(plainPassword, user.passwordHash);
  if (!isPasswordValid) {
    throw new UnauthorizedError('Invalid email or password');
  }

  const { role, permissions } = extractUserRoleAndPermissions(user);

  // Generate cryptographically secure refresh token
  const refreshToken = generateTokenSecret();
  const tokenHash = hashToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  // Create session in PostgreSQL
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash,
      userAgent,
      ipAddress,
      expiresAt
    }
  });

  // Update last login timestamp
  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() }
  });

  const accessToken = signAccessToken({
    sub: user.id,
    email: user.email,
    role,
    permissions,
    sessionId: session.id
  });

  const safeUser: SafeUser = {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    permissions,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  };

  logger.info({ userId: user.id, email: user.email, role }, 'User authenticated successfully');

  return {
    user: safeUser,
    accessToken,
    refreshToken,
    expiresAt
  };
}

export async function refreshUserSession(
  rawRefreshToken: string,
  ipAddress?: string,
  userAgent?: string
): Promise<{
  user: SafeUser;
  accessToken: string;
  newRefreshToken: string;
}> {
  const tokenHash = hashToken(rawRefreshToken);

  const session = await prisma.session.findUnique({
    where: { tokenHash },
    include: {
      user: {
        include: {
          userRoles: {
            include: {
              role: {
                include: {
                  permissions: {
                    include: { permission: true }
                  }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!session) {
    // Check if tokenHash matches a previously rotated token (Token Reuse Attack Detection)
    const replayedSession = await prisma.session.findFirst({
      where: { previousTokenHash: tokenHash }
    });

    if (replayedSession) {
      // Immediate family revocation: A rotated token was presented again!
      await prisma.session.update({
        where: { id: replayedSession.id },
        data: { revokedAt: new Date() }
      });
      logger.warn(
        { sessionId: replayedSession.id, userId: replayedSession.userId },
        'CRITICAL SECURITY ALERT: Refresh token reuse detected. Revoking session family.'
      );
      throw new UnauthorizedError('Security violation: Refresh token reuse detected. Session terminated.');
    }

    throw new UnauthorizedError('Invalid refresh session');
  }

  if (session.revokedAt) {
    logger.warn({ sessionId: session.id, userId: session.userId }, 'Attempt to use revoked refresh session');
    throw new UnauthorizedError('Refresh session has been revoked. Please sign in again.');
  }

  if (session.expiresAt < new Date()) {
    throw new UnauthorizedError('Refresh session has expired. Please sign in again.');
  }

  if (!session.user.isActive) {
    throw new ForbiddenError('Account has been deactivated');
  }

  // Token rotation: Issue new refresh token & record previousTokenHash
  const newRefreshToken = generateTokenSecret();
  const newTokenHash = hashToken(newRefreshToken);
  const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  await prisma.session.update({
    where: { id: session.id },
    data: {
      tokenHash: newTokenHash,
      previousTokenHash: session.tokenHash, // Record rotated token for reuse detection
      expiresAt: newExpiresAt,
      ipAddress: ipAddress || session.ipAddress,
      userAgent: userAgent || session.userAgent
    }
  });

  const { role, permissions } = extractUserRoleAndPermissions(session.user);

  const accessToken = signAccessToken({
    sub: session.user.id,
    email: session.user.email,
    role,
    permissions,
    sessionId: session.id
  });

  const safeUser: SafeUser = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role,
    permissions,
    isActive: session.user.isActive,
    lastLoginAt: session.user.lastLoginAt,
    createdAt: session.user.createdAt
  };

  return {
    user: safeUser,
    accessToken,
    newRefreshToken
  };
}

export async function logoutUserSession(rawRefreshToken: string): Promise<void> {
  const tokenHash = hashToken(rawRefreshToken);
  const session = await prisma.session.findUnique({
    where: { tokenHash }
  });

  if (session && !session.revokedAt) {
    await prisma.session.update({
      where: { id: session.id },
      data: { revokedAt: new Date() }
    });
    logger.info({ sessionId: session.id, userId: session.userId }, 'User session revoked on logout');
  }
}

export async function getCurrentUserProfile(userId: string): Promise<SafeUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      userRoles: {
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true }
              }
            }
          }
        }
      }
    }
  });

  if (!user) {
    throw new UnauthorizedError('User not found');
  }

  if (!user.isActive) {
    throw new ForbiddenError('Account has been deactivated');
  }

  const { role, permissions } = extractUserRoleAndPermissions(user);

  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role,
    permissions,
    isActive: user.isActive,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  };
}

export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: {
      userId,
      revokedAt: null
    },
    data: {
      revokedAt: new Date()
    }
  });
  return result.count;
}
