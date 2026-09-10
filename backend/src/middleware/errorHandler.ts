import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError } from '../errors/AppError.js';
import { logger } from './logger.js';
import { env } from '../config/env.js';

export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
) {
  // 1. Handled AppError
  if (err instanceof AppError) {
    logger.warn({
      reqId: req.id,
      code: err.code,
      statusCode: err.statusCode,
      message: err.message,
      details: err.details
    }, 'Operational AppError handled');

    return res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details
      }
    });
  }

  // 2. Zod Validation Error
  if (err instanceof ZodError) {
    const formattedErrors = err.errors.map((e) => ({
      field: e.path.join('.'),
      message: e.message,
      code: e.code
    }));

    logger.warn({
      reqId: req.id,
      errors: formattedErrors
    }, 'Validation error');

    return res.status(422).json({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Request validation failed',
        details: formattedErrors
      }
    });
  }

  // 3. Prisma Known Request Error
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    logger.error({
      reqId: req.id,
      prismaCode: err.code,
      meta: err.meta
    }, 'Prisma database error');

    if (err.code === 'P2002') {
      return res.status(409).json({
        success: false,
        error: {
          code: 'CONFLICT',
          message: 'A record with this identifier already exists',
          details: err.meta
        }
      });
    }

    if (err.code === 'P2025') {
      return res.status(404).json({
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: 'Record not found'
        }
      });
    }

    return res.status(400).json({
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'A database constraint error occurred'
      }
    });
  }

  // 4. Unexpected / Unhandled Error (500)
  logger.error({
    reqId: req.id,
    err: {
      message: err.message,
      stack: env.NODE_ENV === 'development' ? err.stack : undefined
    }
  }, 'Unhandled internal server error');

  return res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: env.NODE_ENV === 'production' ? 'An internal server error occurred' : err.message
    }
  });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.path}`
    }
  });
}
