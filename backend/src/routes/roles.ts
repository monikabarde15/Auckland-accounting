import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { rbacService } from '../services/rbacService.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { validateBody, validateParams } from '../middleware/validate.js';
import { ForbiddenError } from '../errors/AppError.js';

export const rolesRouter = Router();

// Only SUPER_ADMIN can view or manage role configurations
rolesRouter.use(requireAuth);

/**
 * GET /api/roles/permissions
 * Retrieves all available permissions in the system, along with module groupings.
 */
rolesRouter.get(
  '/permissions',
  requireRole('SUPER_ADMIN'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const permissions = await rbacService.getAllPermissions();
      const grouped = await rbacService.getPermissionsGrouped();

      return res.status(200).json({
        success: true,
        data: {
          permissions,
          grouped
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/roles
 * Retrieves all roles with their assigned permissions and user counts.
 */
rolesRouter.get(
  '/',
  requireRole('SUPER_ADMIN'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const roles = await rbacService.getAllRoles();

      return res.status(200).json({
        success: true,
        data: {
          roles
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * GET /api/roles/:roleId
 * Retrieves a specific role with its assigned permissions.
 */
const roleParamsSchema = z.object({
  roleId: z.string().min(1, 'Role ID is required')
});

rolesRouter.get(
  '/:roleId',
  requireRole('SUPER_ADMIN'),
  validateParams(roleParamsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { roleId } = req.params;
      const role = await rbacService.getRoleById(roleId);

      return res.status(200).json({
        success: true,
        data: {
          role
        }
      });
    } catch (err) {
      next(err);
    }
  }
);

/**
 * PUT /api/roles/:roleId/permissions
 * Atomically updates permissions for a role (SUPER_ADMIN only).
 */
const updateRolePermissionsSchema = z.object({
  permissions: z.array(z.string()).describe('List of permission IDs or keys (e.g. ["contacts.view", "campaigns.start"])')
});

rolesRouter.put(
  '/:roleId/permissions',
  requireRole('SUPER_ADMIN'),
  validateParams(roleParamsSchema),
  validateBody(updateRolePermissionsSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const { roleId } = req.params;
      const { permissions } = req.body;
      const actorId = req.user!.id;
      const actorRole = req.user!.role;

      const updatedRole = await rbacService.updateRolePermissions(
        roleId,
        permissions,
        actorId,
        actorRole
      );

      return res.status(200).json({
        success: true,
        data: {
          role: updatedRole,
          message: `Permissions for role "${updatedRole.name}" have been updated successfully.`
        }
      });
    } catch (err) {
      next(err);
    }
  }
);
