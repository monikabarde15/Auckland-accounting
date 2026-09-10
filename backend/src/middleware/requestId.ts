import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      id: string;
    }
  }
}

export function requestIdMiddleware(req: Request, res: Response, next: NextFunction) {
  const existingId = req.headers['x-request-id'];
  const id = typeof existingId === 'string' && existingId.trim() ? existingId : crypto.randomUUID();
  
  req.id = id;
  res.setHeader('x-request-id', id);
  next();
}
