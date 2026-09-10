import React from 'react';
import {
  LayoutDashboard,
  Megaphone,
  HelpCircle,
  PhoneCall,
  Users,
  BarChart3,
  FileText,
  UserCheck,
  ShieldCheck,
  Sliders,
  LogOut,
  X
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

export interface SidebarProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  isMobileOpen?: boolean;
  onCloseMobile?: () => void;
  runningCampaignCount?: number;
}

interface NavItem {
  id: string;
  label: string;
  path: string;
  icon: React.ElementType;
  roles?: string[];
  permission?: string;
  badge?: string | number;
}

interface NavGroup {
  group: string;
  items: NavItem[];
}

export const Sidebar: React.FC<SidebarProps> = ({
  currentPath,
  onNavigate,
  isMobileOpen = false,
  onCloseMobile,
  runningCampaignCount = 0
}) => {
  const { user, logout, hasRole, hasPermission } = useAuth();

  const navGroups: NavGroup[] = [
    {
      group: 'Operations',
      items: [
        { id: 'dashboard', label: 'Dashboard', path: '/dashboard', icon: LayoutDashboard },
        {
          id: 'campaigns',
          label: 'Campaigns',
          path: '/campaigns',
          icon: Megaphone,
          permission: 'campaigns.view',
          badge: runningCampaignCount > 0 ? `${runningCampaignCount} active` : undefined
        },
        { id: 'questions', label: 'Questionnaires', path: '/questions', icon: HelpCircle, permission: 'questionnaires.view' },
        { id: 'calls', label: 'Call Records', path: '/calls', icon: PhoneCall, permission: 'calls.view' },
        { id: 'contacts', label: 'Contacts', path: '/contacts', icon: Users, permission: 'contacts.view' }
      ]
    },
    {
      group: 'Insights & Compliance',
      items: [
        { id: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, permission: 'reports.view' },
        { id: 'audit-logs', label: 'Audit Trail', path: '/audit-logs', icon: FileText, roles: ['SUPER_ADMIN', 'ADMIN'], permission: 'audit.view' }
      ]
    },
    {
      group: 'Administration',
      items: [
        { id: 'settings', label: 'Practice Settings', path: '/settings', icon: Sliders, roles: ['SUPER_ADMIN'], permission: 'system.settings' },
        { id: 'users', label: 'Practice Users', path: '/users', icon: UserCheck, roles: ['SUPER_ADMIN'], permission: 'users.view' },
        { id: 'roles', label: 'Roles & RBAC', path: '/roles', icon: ShieldCheck, roles: ['SUPER_ADMIN'], permission: 'roles.view' }
      ]
    }
  ];

  return (
    <>
      {/* Mobile Backdrop */}
      {isMobileOpen && (
        <div
          className="fixed inset-0 bg-slate-900/40 backdrop-blur-xs z-40 lg:hidden"
          onClick={onCloseMobile}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-0 bottom-0 left-0 z-50 w-60 bg-white border-r border-slate-200 flex flex-col transition-transform duration-200 ease-in-out lg:translate-x-0 ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* Practice Brand Header */}
        <div className="h-14 px-4 border-b border-slate-200 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded bg-[#0f2e4a] text-white flex items-center justify-center font-bold text-xs shrink-0 select-none">
              AK
            </div>
            <div className="min-w-0">
              <h1 className="text-xs font-bold text-slate-900 leading-none truncate">Auckland Accounting</h1>
              <span className="text-[10px] text-slate-500 font-mono leading-none block mt-0.5">ACULA IVR</span>
            </div>
          </div>
          {onCloseMobile && (
            <button
              onClick={onCloseMobile}
              className="lg:hidden p-1 rounded text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              aria-label="Close mobile navigation"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {/* Navigation Groups */}
        <nav className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4">
          {navGroups.map((group) => {
            const visibleItems = group.items.filter(
              (item) =>
                (!item.roles || item.roles.some((r) => hasRole(r))) &&
                (!item.permission || hasPermission(item.permission))
            );

            if (visibleItems.length === 0) return null;

            return (
              <div key={group.group} className="space-y-0.5">
                <div className="px-2.5 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider select-none">
                  {group.group}
                </div>
                {visibleItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = currentPath === item.path || (item.path !== '/dashboard' && currentPath.startsWith(item.path));

                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onNavigate(item.path);
                        if (onCloseMobile) onCloseMobile();
                      }}
                      className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer text-left select-none ${
                        isActive
                          ? 'bg-[#0f2e4a] text-white font-semibold'
                          : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <Icon className={`w-3.5 h-3.5 shrink-0 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                        <span className="truncate">{item.label}</span>
                      </div>
                      {item.badge && (
                        <span
                          className={`text-[10px] px-1.5 py-0.2 rounded font-medium shrink-0 ${
                            isActive
                              ? 'bg-white/20 text-white'
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          }`}
                        >
                          {item.badge}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            );
          })}
        </nav>

        {/* User Info & Sign Out Footer */}
        {user && (
          <div className="p-3 border-t border-slate-200 shrink-0 bg-slate-50/50">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="text-xs font-medium text-slate-900 truncate leading-tight">{user.name}</p>
                <p className="text-[10px] text-slate-500 truncate mt-0.5">{user.role}</p>
              </div>
              <button
                type="button"
                onClick={() => logout()}
                title="Sign out"
                className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                aria-label="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};
