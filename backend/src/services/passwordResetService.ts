import { prisma } from './prisma.js';
import { hashPassword } from '../utils/password.js';
import { hashToken, generateTokenSecret, revokeAllSessionsForUser } from './authService.js';
import { BadRequestError } from '../errors/AppError.js';
import { logger } from '../middleware/logger.js';
import { env } from '../config/env.js';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

export async function requestPasswordReset(email: string): Promise<{
  message: string;
  developmentToken?: string;
}> {
  const normalizedEmail = email.trim().toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email: normalizedEmail }
  });

  let devToken: string | undefined;

  if (user && user.isActive) {
    const rawToken = generateTokenSecret();
    const tokenHash = hashToken(rawToken);
    const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    // Invalidate existing unused reset tokens for this user
    await prisma.passwordResetToken.updateMany({
      where: {
        userId: user.id,
        usedAt: null
      },
      data: { usedAt: new Date() }
    });

    // Create new reset token
    await prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt
      }
    });

    logger.info({ userId: user.id, email: user.email }, 'Password reset token created');

    // In non-production environments, provide the token for development and testing
    if (env.NODE_ENV !== 'production') {
      devToken = rawToken;
    }
  }

  const response: { message: string; developmentToken?: string } = {
    message: 'If an account exists with this email address, password reset instructions have been generated.'
  };

  if (env.NODE_ENV !== 'production' && devToken) {
    response.developmentToken = devToken;
  }

  return response;
}

export async function resetPasswordWithToken(
  rawToken: string,
  newPlainPassword: string
): Promise<{ message: string }> {
  if (!rawToken || rawToken.trim() === '') {
    throw new BadRequestError('Password reset token is required');
  }

  if (newPlainPassword.length < 8) {
    throw new BadRequestError('Password must be at least 8 characters long');
  }

  const tokenHash = hashToken(rawToken);

  const resetRecord = await prisma.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true }
  });

  if (!resetRecord) {
    throw new BadRequestError('Invalid or expired password reset token');
  }

  if (resetRecord.usedAt) {
    logger.warn({ tokenId: resetRecord.id, userId: resetRecord.userId }, 'Attempted reuse of password reset token');
    throw new BadRequestError('This password reset token has already been used');
  }

  if (resetRecord.expiresAt < new Date()) {
    throw new BadRequestError('This password reset token has expired');
  }

  if (!resetRecord.user.isActive) {
    throw new BadRequestError('Account is deactivated');
  }

  const newPasswordHash = await hashPassword(newPlainPassword);

  // Execute in database transaction: update password, mark token used, and revoke all active sessions
  await prisma.$transaction([
    prisma.user.update({
      where: { id: resetRecord.userId },
      data: { passwordHash: newPasswordHash }
    }),
    prisma.passwordResetToken.update({
      where: { id: resetRecord.id },
      data: { usedAt: new Date() }
    }),
    prisma.session.updateMany({
      where: {
        userId: resetRecord.userId,
        revokedAt: null
      },
      data: { revokedAt: new Date() }
    })
  ]);

  logger.info({ userId: resetRecord.userId }, 'Password successfully reset and sessions revoked');

  return {
    message: 'Your password has been successfully reset. Please sign in with your new password.'
  };
}
