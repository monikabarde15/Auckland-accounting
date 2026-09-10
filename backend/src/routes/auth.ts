import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import {
  loginUser,
  refreshUserSession,
  logoutUserSession,
  getCurrentUserProfile,
  revokeAllSessionsForUser
} from '../services/authService.js';
import {
  requestPasswordReset,
  resetPasswordWithToken
} from '../services/passwordResetService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { loginLimiter, refreshLimiter, passwordResetLimiter } from '../middleware/rateLimit.js';
import { UnauthorizedError, NotFoundError } from '../errors/AppError.js';
import { prisma } from '../services/prisma.js';
import { env } from '../config/env.js';

export const authRouter = Router();

const REFRESH_COOKIE_NAME = '__acula_refresh';

function setRefreshCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth',
    expires: expiresAt
  });
}

function clearRefreshCookie(res: Response) {
  res.clearCookie(REFRESH_COOKIE_NAME, {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/api/auth'
  });
}

// -------------------------------------------------------------
// 1. POST /api/auth/login
// -------------------------------------------------------------
const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address'),
  password: z.string().min(1, 'Password is required')
});

authRouter.post(
  '/login',
  loginLimiter,
  validateBody(loginSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email, password } = req.body;
      const ip = req.ip || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await loginUser(email, password, ip, userAgent);

      setRefreshCookie(res, result.refreshToken, result.expiresAt);

      return res.status(200).json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// -------------------------------------------------------------
// 2. POST /api/auth/refresh
// -------------------------------------------------------------
authRouter.post(
  '/refresh',
  refreshLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;

      if (!refreshToken) {
        throw new UnauthorizedError('Refresh token missing. Please sign in again.');
      }

      const ip = req.ip || req.socket.remoteAddress;
      const userAgent = req.headers['user-agent'];

      const result = await refreshUserSession(refreshToken, ip, userAgent);

      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      setRefreshCookie(res, result.newRefreshToken, expiresAt);

      return res.status(200).json({
        success: true,
        data: {
          user: result.user,
          accessToken: result.accessToken
        }
      });
    } catch (err) {
      clearRefreshCookie(res);
      next(err);
    }
  }
);

// -------------------------------------------------------------
// 3. POST /api/auth/logout
// -------------------------------------------------------------
authRouter.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE_NAME] || req.body?.refreshToken;
    if (refreshToken) {
      await logoutUserSession(refreshToken);
    }

    clearRefreshCookie(res);

    return res.status(200).json({
      success: true,
      data: {
        message: 'Successfully logged out and session revoked.'
      }
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 4. GET /api/auth/me
// -------------------------------------------------------------
authRouter.get('/me', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!req.user) {
      throw new UnauthorizedError('User unauthenticated');
    }

    const profile = await getCurrentUserProfile(req.user.id);

    return res.status(200).json({
      success: true,
      data: {
        user: profile
      }
    });
  } catch (err) {
    next(err);
  }
});

// -------------------------------------------------------------
// 5. POST /api/auth/forgot-password
// -------------------------------------------------------------
const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address')
});

authRouter.post(
  '/forgot-password',
  passwordResetLimiter,
  validateBody(forgotPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { email } = req.body;
      const result = await requestPasswordReset(email);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

// -------------------------------------------------------------
// 6. POST /api/auth/reset-password
// -------------------------------------------------------------
const resetPasswordSchema = z.object({
  token: z.string().min(10, 'Valid reset token is required'),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Password must include at least one uppercase letter')
    .regex(/[0-9]/, 'Password must include at least one number')
});

authRouter.post(
  '/reset-password',
  passwordResetLimiter,
  validateBody(resetPasswordSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { token, password } = req.body;
      const result = await resetPasswordWithToken(token, password);

      clearRefreshCookie(res);

      return res.status(200).json({
        success: true,
        data: result
      });
    } catch (err) {
      next(err);
    }
  }
);

// -------------------------------------------------------------
// 7. PATCH /api/auth/users/:id/status (Super Admin only)
// -------------------------------------------------------------
const userStatusSchema = z.object({
  isActive: z.boolean()
});

const userParamsSchema = z.object({
  id: z.string().cuid('Invalid user ID format')
});

authRouter.patch(
  '/users/:id/status',
  requireAuth,
  requireRole('SUPER_ADMIN'),
  validateParams(userParamsSchema),
  validateBody(userStatusSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { id } = req.params;
      const { isActive } = req.body;

      const user = await prisma.user.findUnique({
        where: { id }
      });

      if (!user) {
        throw new NotFoundError(`User with ID ${id} not found`);
      }

      await prisma.user.update({
        where: { id },
        data: { isActive }
      });

      // If deactivated, revoke all active sessions immediately
      if (!isActive) {
        await revokeAllSessionsForUser(id);
      }

      return res.status(200).json({
        success: true,
        data: {
          userId: id,
          isActive,
          message: isActive
            ? 'User account activated successfully'
            : 'User account deactivated and active sessions revoked'
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

// -------------------------------------------------------------
// 8. POST /api/auth/validate-credentials (Schema validation test)
// -------------------------------------------------------------
const validateCredsSchema = z.object({
  email: z.string().email('Valid email address is required'),
  password: z.string().min(8, 'Password must be at least 8 characters')
});

authRouter.post('/validate-credentials', validateBody(validateCredsSchema), (req: Request, res: Response) => {
  return res.status(200).json({
    success: true,
    data: {
      email: req.body.email,
      validated: true
    }
  });
});

