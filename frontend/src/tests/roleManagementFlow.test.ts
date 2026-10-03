import { describe, it, expect, beforeEach, vi } from 'vitest';
import { api } from '../services/api';
import { RoleDefinition, FormattedPermission, GroupedPermissions } from '../types';

describe('Frontend Role & Dynamic Permission Management Client Tests (Spec §4, §62)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  const mockPermissions: FormattedPermission[] = [
    {
      id: 'p_1',
      key: 'contacts.view',
      legacyKey: 'view:contacts',
      action: 'view',
      subject: 'contacts',
      category: 'Contacts & CRM',
      label: 'View Contacts',
      description: 'View directory contacts and taxpayer records'
    },
    {
      id: 'p_2',
      key: 'campaigns.start',
      legacyKey: 'start:campaigns',
      action: 'start',
      subject: 'campaigns',
      category: 'Campaigns',
      label: 'Start Campaigns',
      description: 'Launch scheduled outbound calling campaigns'
    },
    {
      id: 'p_3',
      key: 'reports.export',
      legacyKey: 'export:reports',
      action: 'export',
      subject: 'reports',
      category: 'Reports & Analytics',
      label: 'Export Reports',
      description: 'Export call records, analytics, and responses to CSV'
    }
  ];

  const mockRoles: RoleDefinition[] = [
    {
      id: 'role_sa',
      name: 'SUPER_ADMIN',
      description: 'System Principal Partner',
      isSystemProtected: true,
      userCount: 1,
      permissions: mockPermissions,
      permissionKeys: ['*']
    },
    {
      id: 'role_admin',
      name: 'ADMIN',
      description: 'Practice Administrator',
      isSystemProtected: false,
      userCount: 2,
      permissions: [mockPermissions[0], mockPermissions[1]],
      permissionKeys: ['contacts.view', 'campaigns.start']
    },
    {
      id: 'role_op',
      name: 'OPERATOR',
      description: 'Telephony Operator',
      isSystemProtected: false,
      userCount: 4,
      permissions: [mockPermissions[0]],
      permissionKeys: ['contacts.view']
    }
  ];

  describe('1. API Service Integration', () => {
    it('api.getRoles() should fetch all roles successfully', async () => {
      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          success: true,
          data: { roles: mockRoles }
        })
      } as Response);

      const res = await api.getRoles();
      expect(res.success).toBe(true);
      expect(res.data?.roles.length).toBe(3);
      expect(res.data?.roles[0].name).toBe('SUPER_ADMIN');
      expect(res.data?.roles[0].isSystemProtected).toBe(true);
      expect(res.data?.roles[1].name).toBe('ADMIN');
      expect(res.data?.roles[2].name).toBe('OPERATOR');
    });

    it('api.getPermissions() should fetch grouped system permissions', async () => {
      const mockGrouped: GroupedPermissions = {
        'Contacts & CRM': [mockPermissions[0]],
        'Campaigns': [mockPermissions[1]],
        'Reports & Analytics': [mockPermissions[2]]
      };

      vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          success: true,
          data: {
            permissions: mockPermissions,
            grouped: mockGrouped
          }
        })
      } as Response);

      const res = await api.getPermissions();
      expect(res.success).toBe(true);
      expect(res.data?.permissions.length).toBe(3);
      expect(res.data?.grouped['Campaigns']).toBeDefined();
      expect(res.data?.grouped['Campaigns'][0].key).toBe('campaigns.start');
    });

    it('api.updateRolePermissions() should transmit updated permission array to backend', async () => {
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValueOnce({
        status: 200,
        json: async () => ({
          success: true,
          data: {
            role: {
              ...mockRoles[1],
              permissionKeys: ['contacts.view', 'campaigns.start', 'reports.export']
            },
            message: 'Permissions updated'
          }
        })
      } as Response);

      const res = await api.updateRolePermissions('role_admin', [
        'contacts.view',
        'campaigns.start',
        'reports.export'
      ]);

      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('/api/roles/role_admin/permissions'),
        expect.objectContaining({
          method: 'PUT',
          body: JSON.stringify({
            permissions: ['contacts.view', 'campaigns.start', 'reports.export']
          })
        })
      );
      expect(res.success).toBe(true);
      expect(res.data?.role.permissionKeys).toContain('reports.export');
    });
  });

  describe('2. Client-Side Dynamic Permission Evaluator', () => {
    const evaluatePermission = (
      user: { role: string; permissions: string[] },
      actionOrKey: string,
      subject?: string
    ): boolean => {
      if (user.role === 'SUPER_ADMIN') return true;

      let exactColon: string;
      let exactDot: string;
      let wildcardColon: string;
      let wildcardDot: string;

      if (subject) {
        exactColon = `${actionOrKey}:${subject}`;
        exactDot = `${subject}.${actionOrKey}`;
        wildcardColon = `manage:${subject}`;
        wildcardDot = `${subject}.*`;
      } else if (actionOrKey.includes('.')) {
        const [s, a] = actionOrKey.split('.');
        exactDot = actionOrKey;
        exactColon = `${a}:${s}`;
        wildcardColon = `manage:${s}`;
        wildcardDot = `${s}.*`;
      } else if (actionOrKey.includes(':')) {
        const [a, s] = actionOrKey.split(':');
        exactColon = actionOrKey;
        exactDot = `${s}.${a}`;
        wildcardColon = `manage:${s}`;
        wildcardDot = `${s}.*`;
      } else {
        exactDot = actionOrKey;
        exactColon = actionOrKey;
        wildcardColon = `manage:${actionOrKey}`;
        wildcardDot = `${actionOrKey}.*`;
      }

      const permissions = user.permissions || [];
      return (
        permissions.includes(exactColon) ||
        permissions.includes(exactDot) ||
        permissions.includes(wildcardColon) ||
        permissions.includes(wildcardDot) ||
        permissions.includes('manage:all') ||
        permissions.includes('all.manage') ||
        permissions.includes('*')
      );
    };

    it('SUPER_ADMIN passes all permission checks regardless of explicit keys', () => {
      const saUser = { role: 'SUPER_ADMIN', permissions: [] };
      expect(evaluatePermission(saUser, 'campaigns.start')).toBe(true);
      expect(evaluatePermission(saUser, 'reports.export')).toBe(true);
      expect(evaluatePermission(saUser, 'delete', 'contacts')).toBe(true);
    });

    it('ADMIN matches both dot notation ("campaigns.start") and colon notation ("start:campaigns")', () => {
      const adminUser = {
        role: 'ADMIN',
        permissions: ['contacts.view', 'campaigns.start', 'view:reports']
      };

      // Dot notation check
      expect(evaluatePermission(adminUser, 'campaigns.start')).toBe(true);
      expect(evaluatePermission(adminUser, 'contacts.view')).toBe(true);

      // Colon notation check
      expect(evaluatePermission(adminUser, 'start:campaigns')).toBe(true);
      expect(evaluatePermission(adminUser, 'view:contacts')).toBe(true);

      // Separate action/subject arguments
      expect(evaluatePermission(adminUser, 'start', 'campaigns')).toBe(true);
      expect(evaluatePermission(adminUser, 'view', 'reports')).toBe(true);

      // Denied actions
      expect(evaluatePermission(adminUser, 'campaigns.delete')).toBe(false);
      expect(evaluatePermission(adminUser, 'reports.export')).toBe(false);
    });

    it('Module wildcards ("campaigns.*" or "manage:campaigns") grant all submodule actions', () => {
      const managerUser = {
        role: 'ADMIN',
        permissions: ['campaigns.*']
      };

      expect(evaluatePermission(managerUser, 'campaigns.start')).toBe(true);
      expect(evaluatePermission(managerUser, 'campaigns.pause')).toBe(true);
      expect(evaluatePermission(managerUser, 'campaigns.delete')).toBe(true);
      expect(evaluatePermission(managerUser, 'reports.export')).toBe(false);
    });

    it('OPERATOR granted "reports.export" dynamically allows report exports', () => {
      const opBefore = { role: 'OPERATOR', permissions: ['contacts.view'] };
      expect(evaluatePermission(opBefore, 'reports.export')).toBe(false);

      const opAfter = { role: 'OPERATOR', permissions: ['contacts.view', 'reports.export'] };
      expect(evaluatePermission(opAfter, 'reports.export')).toBe(true);
    });
  });
});
