import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { CampaignStatus } from '@prisma/client';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateBody } from '../middleware/validate.js';
import {
  listCampaigns,
  getCampaignById,
  createCampaign,
  updateCampaign,
  deleteCampaign,
  transitionCampaignStatus,
  attachContactsToCampaign,
  removeContactFromCampaign,
  emergencyStopAllCampaigns
} from '../services/campaignService.js';
import { validateCampaignForLaunch } from '../services/campaignValidationService.js';

const router = Router();

const createCampaignSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Campaign name is required').max(150),
  description: z.string().max(1000).optional(),
  callerId: z.string().optional(),
  callerName: z.string().optional(),
  questionnaireId: z.string().optional().nullable(),
  callingStartTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format must be HH:MM').optional(),
  callingEndTime: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Format must be HH:MM').optional(),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).optional(),
  timezone: z.string().optional(),
  maxConcurrentCalls: z.number().int().min(1).max(50).optional(),
  dailyCallLimit: z.number().int().min(1).optional().nullable(),
  maxCalls: z.number().int().min(1).optional().nullable(),
  maxCost: z.number().min(0).optional().nullable(),
  retryEnabled: z.boolean().optional(),
  maxRetries: z.number().int().min(0).max(10).optional(),
  retryIntervalMinutes: z.number().int().min(1).max(1440).optional(),
  retryOnBusy: z.boolean().optional(),
  retryOnNoAnswer: z.boolean().optional(),
  retryOnFailed: z.boolean().optional(),
  startDate: z.string().datetime().optional().nullable(),
  endDate: z.string().datetime().optional().nullable(),
  targetContactIds: z.array(z.string()).optional(),
  targetGroupIds: z.array(z.string()).optional()
});

const updateCampaignSchema = createCampaignSchema.partial();

const statusTransitionSchema = z.object({
  status: z.enum(['DRAFT', 'SCHEDULED', 'RUNNING', 'PAUSED', 'COMPLETED', 'CANCELLED', 'FAILED'])
});

const attachContactsSchema = z.object({
  contactIds: z.array(z.string()).optional(),
  groupIds: z.array(z.string()).optional()
});

// All campaign routes require authentication
router.use(requireAuth);

/**
 * GET /api/campaigns
 * List campaigns with pagination and filtering.
 */
router.get('/', requirePermission('campaigns.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const list = await listCampaigns({
      search: req.query.search as string,
      status: req.query.status as CampaignStatus,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 25
    });
    res.json({ success: true, data: list });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/campaigns/:id
 * Retrieve campaign details, contacts summary, and validation status.
 */
router.get('/:id', requirePermission('campaigns.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const campaign = await getCampaignById(req.params.id);
    res.json({ success: true, data: campaign });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/campaigns
 * Create a new campaign in DRAFT state.
 */
router.post(
  '/',
  requirePermission('campaigns.create'),
  validateBody(createCampaignSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const created = await createCampaign({
        ...req.body,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.status(201).json({ success: true, data: created });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/campaigns/:id
 * Update campaign parameters.
 */
router.put(
  '/:id',
  requirePermission('campaigns.edit'),
  validateBody(updateCampaignSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await updateCampaign(req.params.id, {
        ...req.body,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/campaigns/:id
 * Delete a campaign.
 */
router.delete(
  '/:id',
  requirePermission('campaigns.delete'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await deleteCampaign(
        req.params.id,
        req.user?.id,
        req.ip,
        req.headers['user-agent']
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/validate
 * Run complete pre-launch validation checks on the campaign.
 */
router.post('/:id/validate', requirePermission('campaigns.view'), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const result = await validateCampaignForLaunch(req.params.id);
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/campaigns/:id/status
 * Explicit status transition.
 */
router.post(
  '/:id/status',
  requirePermission('campaigns.edit'),
  validateBody(statusTransitionSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await transitionCampaignStatus(
        req.params.id,
        req.body.status as CampaignStatus,
        {
          userId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/start
 * Convenience route to start campaign (transitions to RUNNING).
 */
router.post(
  '/:id/start',
  requirePermission('campaigns.start'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await transitionCampaignStatus(
        req.params.id,
        CampaignStatus.RUNNING,
        {
          userId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/pause
 * Convenience route to pause running campaign.
 */
router.post(
  '/:id/pause',
  requirePermission('campaigns.pause'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await transitionCampaignStatus(
        req.params.id,
        CampaignStatus.PAUSED,
        {
          userId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/resume
 * Convenience route to resume paused campaign.
 */
router.post(
  '/:id/resume',
  requirePermission('campaigns.resume'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await transitionCampaignStatus(
        req.params.id,
        CampaignStatus.RUNNING,
        {
          userId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/cancel
 * Convenience route to cancel a campaign.
 */
router.post(
  '/:id/cancel',
  requirePermission('campaigns.cancel'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const updated = await transitionCampaignStatus(
        req.params.id,
        CampaignStatus.CANCELLED,
        {
          userId: req.user?.id,
          ipAddress: req.ip,
          userAgent: req.headers['user-agent']
        }
      );
      res.json({ success: true, data: updated });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/:id/contacts
 * Attach contacts to campaign by list or groups.
 */
router.post(
  '/:id/contacts',
  requirePermission('campaigns.edit'),
  validateBody(attachContactsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await attachContactsToCampaign(req.params.id, {
        ...req.body,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent']
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/campaigns/:id/contacts/:contactId
 * Remove contact from campaign audience.
 */
router.delete(
  '/:id/contacts/:contactId',
  requirePermission('campaigns.edit'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await removeContactFromCampaign(req.params.id, req.params.contactId);
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/campaigns/emergency-stop
 * Server-side emergency stop that pauses all currently running campaigns.
 */
router.post(
  '/emergency-stop',
  requirePermission('emergency.stop'),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = await emergencyStopAllCampaigns({
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        reason: req.body.reason
      });
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
