import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import * as dncService from '../services/dncService.js';

export const dncRouter = Router();

// Require authentication for all DNC routes
dncRouter.use(requireAuth);

const dncListQuerySchema = z.object({
  search: z.string().optional(),
  page: z.string().optional(),
  limit: z.string().optional()
});

const addToDncSchema = z.object({
  phoneNumber: z.string().min(5, 'Phone number is required'),
  reason: z.string().optional(),
  source: z.string().optional()
});

/**
 * GET /api/dnc — List DNC suppression records with pagination and search
 */
dncRouter.get('/', requirePermission('dnc.view'), validateQuery(dncListQuerySchema), async (req, res, next) => {
  try {
    const result = await dncService.listDncRecords(req.query as any);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/dnc/check/:phoneNumber — Check if phone number is suppressed
 */
dncRouter.get('/check/:phoneNumber', requirePermission('dnc.view'), async (req, res, next) => {
  try {
    const result = await dncService.checkDncSuppression(req.params.phoneNumber);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/dnc — Add phone number to Do-Not-Call suppression list
 */
dncRouter.post(
  '/',
  requirePermission('dnc.manage'),
  validateBody(addToDncSchema),
  async (req, res, next) => {
    try {
      const record = await dncService.addToDnc({
        phoneNumber: req.body.phoneNumber,
        reason: req.body.reason,
        source: req.body.source || 'MANUAL',
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      res.status(201).json({ success: true, data: record });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/dnc/:id — Remove record from DNC suppression list
 */
dncRouter.delete(
  '/:id',
  requirePermission('dnc.manage'),
  async (req, res, next) => {
    try {
      const result = await dncService.removeFromDnc({
        idOrPhone: req.params.id,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
