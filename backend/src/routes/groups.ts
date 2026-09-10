import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { validateBody, validateQuery } from '../middleware/validate.js';
import * as groupService from '../services/groupService.js';

export const groupsRouter = Router();

// Require authentication for all group routes
groupsRouter.use(requireAuth);

const createGroupSchema = z.object({
  name: z.string().min(1, 'Group name is required').max(100),
  description: z.string().optional()
});

const updateGroupSchema = createGroupSchema.partial();

const addMembersSchema = z.object({
  contactIds: z.array(z.string()).min(1, 'At least one contact ID is required')
});

/**
 * GET /api/contacts/groups — List all groups with member counts
 */
groupsRouter.get('/', requirePermission('groups.view'), async (_req, res, next) => {
  try {
    const groups = await groupService.listGroups();
    res.json({ success: true, data: groups });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/contacts/groups/:id — Get group details and members
 */
groupsRouter.get('/:id', requirePermission('groups.view'), async (req, res, next) => {
  try {
    const result = await groupService.getGroupById(req.params.id, {
      page: Number(req.query.page) || 1,
      limit: Number(req.query.limit) || 25
    });
    res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/contacts/groups — Create a new contact group
 */
groupsRouter.post(
  '/',
  requirePermission('groups.create'),
  validateBody(createGroupSchema),
  async (req, res, next) => {
    try {
      const group = await groupService.createGroup({
        name: req.body.name,
        description: req.body.description,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      res.status(201).json({ success: true, data: group });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/contacts/groups/:id — Update group
 */
groupsRouter.put(
  '/:id',
  requirePermission('groups.edit'),
  validateBody(updateGroupSchema),
  async (req, res, next) => {
    try {
      const group = await groupService.updateGroup(req.params.id, {
        name: req.body.name,
        description: req.body.description,
        userId: req.user?.id,
        ipAddress: req.ip,
        userAgent: req.get('user-agent')
      });
      res.json({ success: true, data: group });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/contacts/groups/:id — Delete group
 */
groupsRouter.delete(
  '/:id',
  requirePermission('groups.delete'),
  async (req, res, next) => {
    try {
      const result = await groupService.deleteGroup(
        req.params.id,
        req.user?.id,
        req.ip,
        req.get('user-agent')
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * POST /api/contacts/groups/:id/members — Add contacts to group
 */
groupsRouter.post(
  '/:id/members',
  requirePermission('groups.edit'),
  validateBody(addMembersSchema),
  async (req, res, next) => {
    try {
      const result = await groupService.addGroupMembers(
        req.params.id,
        req.body.contactIds,
        req.user?.id,
        req.ip,
        req.get('user-agent')
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * DELETE /api/contacts/groups/:id/members/:contactId — Remove contact from group
 */
groupsRouter.delete(
  '/:id/members/:contactId',
  requirePermission('groups.edit'),
  async (req, res, next) => {
    try {
      const result = await groupService.removeGroupMember(
        req.params.id,
        req.params.contactId,
        req.user?.id,
        req.ip,
        req.get('user-agent')
      );
      res.json({ success: true, data: result });
    } catch (err) {
      next(err);
    }
  }
);
