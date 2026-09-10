import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { listCalls, getCallById } from '../services/callService.js';
import { CallStatus } from '@prisma/client';

export const callsRouter = Router();

// All call inspection endpoints require authentication
callsRouter.use(requireAuth);

const listCallsQuerySchema = z.object({
  page: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 1)),
  limit: z.string().optional().transform((val) => (val ? parseInt(val, 10) : 20)),
  campaignId: z.string().optional(),
  contactId: z.string().optional(),
  status: z.nativeEnum(CallStatus).optional(),
  search: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  minDuration: z.string().optional().transform((val) => (val ? parseInt(val, 10) : undefined)),
  maxDuration: z.string().optional().transform((val) => (val ? parseInt(val, 10) : undefined)),
  sortBy: z.enum(['startedAt', 'durationSeconds', 'status']).optional(),
  sortOrder: z.enum(['asc', 'desc']).optional()
});

/**
 * GET /api/calls
 * List call attempts with filters and pagination.
 */
callsRouter.get('/', requirePermission('calls.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const query = listCallsQuerySchema.parse(req.query);
    const result = await listCalls(query);

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/calls/:id
 * Retrieve comprehensive details for a specific call attempt.
 */
callsRouter.get('/:id', requirePermission('calls.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const call = await getCallById(req.params.id);
    res.json({ success: true, data: call });
  } catch (err) {
    next(err);
  }
});
