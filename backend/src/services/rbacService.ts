import { prisma } from './prisma.js';
import { BadRequestError, NotFoundError, ForbiddenError } from '../errors/AppError.js';
import { logger } from '../middleware/logger.js';

export interface FormattedPermission {
  id: string;
  key: string;          // e.g. "contacts.view"
  legacyKey: string;    // e.g. "view:contacts"
  label: string;        // e.g. "View Contacts"
  action: string;       // e.g. "view"
  subject: string;      // e.g. "contacts"
  description: string | null;
  module: string;       // e.g. "Contacts & CRM"
}

export interface RoleWithPermissions {
  id: string;
  name: string;
  description: string | null;
  isSystemProtected: boolean;
  userCount: number;
  permissions: FormattedPermission[];
  permissionKeys: string[];
}

// Module mapping for UI display grouping
const SUBJECT_TO_MODULE_MAP: Record<string, string> = {
  contacts: 'Contacts & CRM',
  groups: 'Contact Groups',
  dnc: 'Do-Not-Call (DNC) Registry',
  campaigns: 'Campaigns & Calling',
  questionnaires: 'Questionnaires & IVR Flow',
  calls: 'Call Records & Execution',
  reports: 'Reports & Analytics',
  audit: 'Compliance Audit Trail',
  emergency: 'Emergency Safety Controls',
  users: 'User Management',
  roles: 'Roles & Permissions',
  system: 'System Settings',
  all: 'System Core'
};

// Subjects reserved strictly for SUPER_ADMIN root authority (not configurable for ADMIN / OPERATOR)
const SYSTEM_PROTECTED_SUBJECTS = new Set(['all', 'roles', 'system', 'users']);

const formatPermissionLabel = (action: string, subject: string): string => {
  const actionMap: Record<string, string> = {
    view: 'View',
    create: 'Create',
    edit: 'Edit & Update',
    delete: 'Delete',
    import: 'Import CSV',
    export: 'Export CSV',
    manage: 'Manage',
    start: 'Start / Launch',
    pause: 'Pause',
    resume: 'Resume',
    cancel: 'Cancel',
    execute: 'Execute & Test Simulator',
    stop: 'Trigger Emergency Stop',
    settings: 'Configure Settings',
    deactivate: 'Deactivate Accounts'
  };

  const subjectMap: Record<string, string> = {
    contacts: 'Contacts',
    groups: 'Contact Groups',
    dnc: 'DNC Registry & Consent',
    campaigns: 'Campaigns',
    questionnaires: 'Questionnaire Flows',
    calls: 'Call Logs & Simulator',
    reports: 'Reports & Analytics',
    audit: 'Compliance Audit Logs',
    emergency: 'Emergency Calling Halt',
    users: 'User Accounts',
    roles: 'System Roles',
    system: 'Telephony & System Settings',
    all: 'Full Administration'
  };

  const actStr = actionMap[action] || action.charAt(0).toUpperCase() + action.slice(1);
  const subStr = subjectMap[subject] || subject.charAt(0).toUpperCase() + subject.slice(1);
  return `${actStr} (${subStr})`;
};

class RbacService {
  // In-memory cache for ultra-low-latency permission lookups
  private permissionCache = new Map<string, Set<string>>();
  private cacheInitialized = false;

  /**
   * Clears the in-memory permission cache (optionally for a specific role).
   */
  public invalidatePermissionCache(roleName?: string): void {
    if (roleName) {
      this.permissionCache.delete(roleName);
    } else {
      this.permissionCache.clear();
      this.cacheInitialized = false;
    }
  }

  /**
   * Retrieves all permissions defined in the database formatted with module grouping.
   */
  public async getAllPermissions(includeProtected = false): Promise<FormattedPermission[]> {
    const permissions = await prisma.permission.findMany({
      orderBy: [{ subject: 'asc' }, { action: 'asc' }]
    });

    return permissions
      .filter((p) => includeProtected || !SYSTEM_PROTECTED_SUBJECTS.has(p.subject))
      .map((p) => ({
        id: p.id,
        key: `${p.subject}.${p.action}`,
        legacyKey: `${p.action}:${p.subject}`,
        label: formatPermissionLabel(p.action, p.subject),
        action: p.action,
        subject: p.subject,
        description: p.description,
        module: SUBJECT_TO_MODULE_MAP[p.subject] || p.subject
      }));
  }

  /**
   * Retrieves all configurable operational permissions grouped by module name.
   */
  public async getPermissionsGrouped(): Promise<Record<string, FormattedPermission[]>> {
    const all = await this.getAllPermissions(false);
    const grouped: Record<string, FormattedPermission[]> = {};

    for (const p of all) {
      const moduleName = p.module;
      if (!grouped[moduleName]) {
        grouped[moduleName] = [];
      }
      grouped[moduleName].push(p);
    }

    return grouped;
  }

  /**
   * Retrieves all roles with their assigned permissions and user counts.
   */
  public async getAllRoles(): Promise<RoleWithPermissions[]> {
    const roles = await prisma.role.findMany({
      include: {
        _count: { select: { userRoles: true } },
        permissions: {
          include: { permission: true }
        }
      },
      orderBy: { name: 'asc' }
    });

    return roles.map((r) => {
      const formattedPerms: FormattedPermission[] = r.permissions.map((rp) => ({
        id: rp.permission.id,
        key: `${rp.permission.subject}.${rp.permission.action}`,
        legacyKey: `${rp.permission.action}:${rp.permission.subject}`,
        label: formatPermissionLabel(rp.permission.action, rp.permission.subject),
        action: rp.permission.action,
        subject: rp.permission.subject,
        description: rp.permission.description,
        module: SUBJECT_TO_MODULE_MAP[rp.permission.subject] || rp.permission.subject
      }));

      const permissionKeys = formattedPerms.map((p) => p.key);

      return {
        id: r.id,
        name: r.name,
        description: r.description,
        isSystemProtected: r.name === 'SUPER_ADMIN',
        userCount: r._count.userRoles,
        permissions: formattedPerms,
        permissionKeys
      };
    });
  }

  /**
   * Retrieves a single role by ID with its permissions.
   */
  public async getRoleById(roleId: string): Promise<RoleWithPermissions> {
    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        _count: { select: { userRoles: true } },
        permissions: {
          include: { permission: true }
        }
      }
    });

    if (!role) {
      throw new NotFoundError(`Role with ID "${roleId}" not found`);
    }

    const formattedPerms: FormattedPermission[] = role.permissions.map((rp) => ({
      id: rp.permission.id,
      key: `${rp.permission.subject}.${rp.permission.action}`,
      legacyKey: `${rp.permission.action}:${rp.permission.subject}`,
      label: formatPermissionLabel(rp.permission.action, rp.permission.subject),
      action: rp.permission.action,
      subject: rp.permission.subject,
      description: rp.permission.description,
      module: SUBJECT_TO_MODULE_MAP[rp.permission.subject] || rp.permission.subject
    }));

    return {
      id: role.id,
      name: role.name,
      description: role.description,
      isSystemProtected: role.name === 'SUPER_ADMIN',
      userCount: role._count.userRoles,
      permissions: formattedPerms,
      permissionKeys: formattedPerms.map((p) => p.key)
    };
  }

  /**
   * Retrieves the cached or fresh set of permission identifiers for a given role.
   */
  public async getRolePermissionKeys(roleName: string): Promise<Set<string>> {
    // Check cache
    const cached = this.permissionCache.get(roleName);
    if (cached) {
      return cached;
    }

    // SUPER_ADMIN has full wildcards
    if (roleName === 'SUPER_ADMIN') {
      const allPerms = await this.getAllPermissions();
      const set = new Set<string>();
      set.add('*');
      set.add('all.manage');
      set.add('manage:all');
      for (const p of allPerms) {
        set.add(p.key);
        set.add(p.legacyKey);
      }
      this.permissionCache.set(roleName, set);
      return set;
    }

    // Load from DB
    const role = await prisma.role.findUnique({
      where: { name: roleName },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });

    const set = new Set<string>();
    if (role) {
      for (const rp of role.permissions) {
        const dotKey = `${rp.permission.subject}.${rp.permission.action}`;
        const colonKey = `${rp.permission.action}:${rp.permission.subject}`;
        set.add(dotKey);
        set.add(colonKey);

        // Also add wildcard mappings
        if (rp.permission.action === 'manage') {
          set.add(`${rp.permission.subject}.*`);
          set.add(`manage:${rp.permission.subject}`);
        }
        if (rp.permission.action === 'manage' && rp.permission.subject === 'all') {
          set.add('*');
          set.add('all.manage');
          set.add('manage:all');
        }
      }
    }

    this.permissionCache.set(roleName, set);
    return set;
  }

  /**
   * Checks whether a role possesses a specific permission.
   */
  public async hasPermission(roleName: string, requiredPermission: string): Promise<boolean> {
    if (roleName === 'SUPER_ADMIN') {
      return true;
    }

    const perms = await this.getRolePermissionKeys(roleName);

    // Normalize requirement: support both "contacts.view" and "view:contacts"
    let dotKey = requiredPermission;
    let colonKey = requiredPermission;

    if (requiredPermission.includes('.')) {
      const [subj, act] = requiredPermission.split('.');
      colonKey = `${act}:${subj}`;
    } else if (requiredPermission.includes(':')) {
      const [act, subj] = requiredPermission.split(':');
      dotKey = `${subj}.${act}`;
    }

    const [subject] = dotKey.split('.');

    return (
      perms.has('*') ||
      perms.has('manage:all') ||
      perms.has('all.manage') ||
      perms.has(dotKey) ||
      perms.has(colonKey) ||
      perms.has(`${subject}.*`) ||
      perms.has(`manage:${subject}`)
    );
  }

  /**
   * Atomically updates permissions for a role (SUPER_ADMIN only).
   */
  public async updateRolePermissions(
    roleId: string,
    permissionIdentifiers: string[],
    actorId: string,
    actorRole: string
  ): Promise<RoleWithPermissions> {
    if (actorRole !== 'SUPER_ADMIN') {
      throw new ForbiddenError('Only SUPER_ADMIN can modify role permissions');
    }

    const role = await prisma.role.findUnique({
      where: { id: roleId },
      include: {
        permissions: {
          include: { permission: true }
        }
      }
    });

    if (!role) {
      throw new NotFoundError(`Role with ID "${roleId}" not found`);
    }

    if (role.name === 'SUPER_ADMIN') {
      throw new BadRequestError('SUPER_ADMIN permissions are system-protected and cannot be modified');
    }

    // Resolve provided identifiers (can be permission IDs or keys like "contacts.view")
    const allDbPermissions = await prisma.permission.findMany();
    const resolvedPermissionIds = new Set<string>();

    for (const ident of permissionIdentifiers) {
      const match = allDbPermissions.find(
        (p) =>
          p.id === ident ||
          `${p.subject}.${p.action}` === ident ||
          `${p.action}:${p.subject}` === ident
      );

      if (match) {
        resolvedPermissionIds.add(match.id);
      } else {
        logger.warn({ identifier: ident }, 'Unrecognized permission identifier ignored');
      }
    }

    // Existing permission keys for audit diff
    const existingPermKeys = role.permissions.map(
      (rp) => `${rp.permission.subject}.${rp.permission.action}`
    );
    const newPermKeys: string[] = [];
    for (const id of resolvedPermissionIds) {
      const p = allDbPermissions.find((perm) => perm.id === id);
      if (p) newPermKeys.push(`${p.subject}.${p.action}`);
    }

    const added = newPermKeys.filter((k) => !existingPermKeys.includes(k));
    const removed = existingPermKeys.filter((k) => !newPermKeys.includes(k));

    // Execute atomic transactional replacement
    await prisma.$transaction(async (tx) => {
      // 1. Delete current role permissions
      await tx.rolePermission.deleteMany({
        where: { roleId }
      });

      // 2. Insert new role permissions
      if (resolvedPermissionIds.size > 0) {
        await tx.rolePermission.createMany({
          data: Array.from(resolvedPermissionIds).map((permissionId) => ({
            roleId,
            permissionId
          }))
        });
      }

      // 3. Create audit log entry
      let validUserId: string | null = null;
      if (actorId) {
        const userExists = await tx.user.findUnique({
          where: { id: actorId },
          select: { id: true }
        });
        if (userExists) {
          validUserId = userExists.id;
        }
      }

      await tx.auditLog.create({
        data: {
          userId: validUserId,
          action: 'ROLE_PERMISSIONS_UPDATED',
          entityType: 'ROLE',
          entityId: roleId,
          details: `SUPER_ADMIN updated permissions for role "${role.name}". Added (${added.length}): [${added.join(', ')}]. Removed (${removed.length}): [${removed.join(', ')}].`
        }
      });
    });

    // 4. Invalidate in-memory cache immediately
    this.invalidatePermissionCache(role.name);

    logger.info(
      { roleId, roleName: role.name, addedCount: added.length, removedCount: removed.length, actorId },
      'Role permissions updated successfully'
    );

    return this.getRoleById(roleId);
  }
}

export const rbacService = new RbacService();
