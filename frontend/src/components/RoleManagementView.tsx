import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { api } from '../services/api';
import { FormattedPermission, RoleDefinition, GroupedPermissions } from '../types';
import {
  Shield,
  ShieldCheck,
  Save,
  RotateCcw,
  Users,
  Lock,
  AlertCircle,
  CheckCircle2,
  Layers,
  PhoneCall,
  FileSpreadsheet,
  Settings,
  HelpCircle,
  FolderTree,
  UserCheck,
  Check,
  X
} from 'lucide-react';

export const RoleManagementView: React.FC = () => {
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [groupedPermissions, setGroupedPermissions] = useState<GroupedPermissions>({});
  const [allPermissions, setAllPermissions] = useState<FormattedPermission[]>([]);
  const [selectedRoleName, setSelectedRoleName] = useState<'ADMIN' | 'OPERATOR'>('ADMIN');
  const [selectedPermissions, setSelectedPermissions] = useState<Set<string>>(new Set());
  const [savedPermissions, setSavedPermissions] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  // Fetch roles and permissions from backend
  const loadData = useCallback(async () => {
    setIsLoading(true);
    setFeedback(null);
    try {
      const [rolesRes, permsRes] = await Promise.all([
        api.getRoles(),
        api.getPermissions()
      ]);

      if (rolesRes.success && rolesRes.data?.roles) {
        setRoles(rolesRes.data.roles);
        const targetRole = rolesRes.data.roles.find((r) => r.name === selectedRoleName);
        if (targetRole) {
          const permKeys = new Set(targetRole.permissionKeys);
          setSelectedPermissions(permKeys);
          setSavedPermissions(permKeys);
        }
      }

      if (permsRes.success && permsRes.data) {
        setGroupedPermissions(permsRes.data.grouped);
        setAllPermissions(permsRes.data.permissions);
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'Failed to load roles and permissions'
      });
    } finally {
      setIsLoading(false);
    }
  }, [selectedRoleName]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // When switching selected role tab
  const handleRoleSelect = (roleName: 'ADMIN' | 'OPERATOR') => {
    setSelectedRoleName(roleName);
    const targetRole = roles.find((r) => r.name === roleName);
    if (targetRole) {
      const permKeys = new Set(targetRole.permissionKeys);
      setSelectedPermissions(permKeys);
      setSavedPermissions(permKeys);
    }
    setFeedback(null);
  };

  // Toggle single permission
  const handleTogglePermission = (key: string) => {
    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  // Toggle entire category
  const handleToggleCategory = (category: string) => {
    const categoryPerms = groupedPermissions[category] || [];
    const allKeys = categoryPerms.map((p) => p.key);
    const allSelected = allKeys.every((k) => selectedPermissions.has(k));

    setSelectedPermissions((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        allKeys.forEach((k) => next.delete(k));
      } else {
        allKeys.forEach((k) => next.add(k));
      }
      return next;
    });
  };

  // Grant all permissions
  const handleSelectAll = () => {
    setSelectedPermissions(new Set(allPermissions.map((p) => p.key)));
  };

  // Clear all permissions
  const handleClearAll = () => {
    setSelectedPermissions(new Set());
  };

  // Check if dirty
  const isDirty = useMemo(() => {
    if (selectedPermissions.size !== savedPermissions.size) return true;
    for (const key of selectedPermissions) {
      if (!savedPermissions.has(key)) return true;
    }
    return false;
  }, [selectedPermissions, savedPermissions]);

  // Discard changes
  const handleDiscard = () => {
    setSelectedPermissions(new Set(savedPermissions));
    setFeedback(null);
  };

  // Save changes to backend
  const handleSave = async () => {
    const activeRole = roles.find((r) => r.name === selectedRoleName);
    if (!activeRole) return;

    setIsSaving(true);
    setFeedback(null);
    try {
      const res = await api.updateRolePermissions(activeRole.id, Array.from(selectedPermissions));
      if (res.success && res.data?.role) {
        setRoles((prev) =>
          prev.map((r) => (r.id === activeRole.id ? res.data!.role : r))
        );
        const newKeys = new Set(res.data.role.permissionKeys);
        setSelectedPermissions(newKeys);
        setSavedPermissions(newKeys);
        setFeedback({
          type: 'success',
          message: `Permissions for ${selectedRoleName} saved and active immediately.`
        });
      } else {
        setFeedback({
          type: 'error',
          message: res.error?.message || 'Failed to update permissions'
        });
      }
    } catch (err: any) {
      setFeedback({
        type: 'error',
        message: err.message || 'An unexpected error occurred while saving'
      });
    } finally {
      setIsSaving(false);
    }
  };

  const activeRole = roles.find((r) => r.name === selectedRoleName);
  const totalCount = allPermissions.length;
  const activeCount = selectedPermissions.size;

  const getCategoryIcon = (category: string) => {
    const cat = category.toLowerCase();
    if (cat.includes('contact') && cat.includes('group')) {
      return <FolderTree className="w-4 h-4 text-blue-600" />;
    }
    if (cat.includes('contact')) {
      return <UserCheck className="w-4 h-4 text-indigo-600" />;
    }
    if (cat.includes('dnc') || cat.includes('do-not-call')) {
      return <AlertCircle className="w-4 h-4 text-rose-600" />;
    }
    if (cat.includes('campaign')) {
      return <Layers className="w-4 h-4 text-amber-600" />;
    }
    if (cat.includes('questionnaire') || cat.includes('ivr')) {
      return <HelpCircle className="w-4 h-4 text-purple-600" />;
    }
    if (cat.includes('call') || cat.includes('telephony')) {
      return <PhoneCall className="w-4 h-4 text-emerald-600" />;
    }
    if (cat.includes('report') || cat.includes('analytic')) {
      return <FileSpreadsheet className="w-4 h-4 text-cyan-600" />;
    }
    if (cat.includes('audit')) {
      return <ShieldCheck className="w-4 h-4 text-emerald-600" />;
    }
    if (cat.includes('emergency')) {
      return <AlertCircle className="w-4 h-4 text-red-600" />;
    }
    if (cat.includes('user')) {
      return <Users className="w-4 h-4 text-orange-600" />;
    }
    return <Shield className="w-4 h-4 text-slate-600" />;
  };

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[380px] space-y-3">
        <div className="w-8 h-8 border-3 border-indigo-600 border-t-transparent rounded-full animate-spin" />
        <p className="text-xs font-medium text-slate-500">Loading roles & permissions...</p>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6 pb-24">
      {/* 1. Header & Context */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-200/80 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100">
              Access Control
            </span>
            <span className="text-xs text-slate-400">&bull;</span>
            <span className="text-xs text-slate-500 font-medium">Database-Backed RBAC</span>
          </div>
          <h1 className="text-xl font-bold text-slate-900 mt-1">Role & Permission Management</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Configure granular permissions for practice staff roles with immediate live effect.
          </p>
        </div>

        {/* Global Save Controls */}
        <div className="flex items-center gap-2.5">
          {isDirty && (
            <button
              type="button"
              onClick={handleDiscard}
              disabled={isSaving}
              className="inline-flex items-center px-3 py-1.5 border border-slate-300 text-xs font-medium rounded-lg text-slate-700 bg-white hover:bg-slate-50 transition shadow-2xs cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1 text-slate-400" />
              Discard
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={!isDirty || isSaving}
            className="inline-flex items-center px-3.5 py-1.5 border border-transparent text-xs font-medium rounded-lg text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition shadow-2xs cursor-pointer"
          >
            {isSaving ? (
              <>
                <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin mr-1.5" />
                Saving...
              </>
            ) : (
              <>
                <Save className="w-3.5 h-3.5 mr-1.5" />
                Save Changes {isDirty && `(${activeCount})`}
              </>
            )}
          </button>
        </div>
      </div>

      {/* 2. Feedback Notification */}
      {feedback && (
        <div
          className={`px-4 py-3 rounded-lg border flex items-center justify-between text-xs font-medium transition ${
            feedback.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-rose-50 border-rose-200 text-rose-900'
          }`}
        >
          <div className="flex items-center gap-2">
            {feedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
            )}
            <span>{feedback.message}</span>
          </div>
          <button
            onClick={() => setFeedback(null)}
            className="text-slate-400 hover:text-slate-600 p-1 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 3. Role Selector (Segmented Cards) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* ADMIN Role */}
        <div
          onClick={() => handleRoleSelect('ADMIN')}
          className={`p-4 rounded-xl border transition-all cursor-pointer select-none ${
            selectedRoleName === 'ADMIN'
              ? 'bg-indigo-50/40 border-indigo-600 shadow-xs ring-1 ring-indigo-600/30'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedRoleName === 'ADMIN' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Shield className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">ADMIN</h2>
                  <span className="text-[10px] font-semibold bg-indigo-100 text-indigo-700 px-1.5 py-0.2 rounded">
                    {roles.find((r) => r.name === 'ADMIN')?.userCount ?? 0} users
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Practice Managers & Operational Supervisors</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-slate-900">
                {selectedRoleName === 'ADMIN' ? activeCount : (roles.find((r) => r.name === 'ADMIN')?.permissionKeys.length ?? 0)}
              </span>
              <span className="text-[11px] text-slate-400"> / {totalCount} active</span>
            </div>
          </div>
        </div>

        {/* OPERATOR Role */}
        <div
          onClick={() => handleRoleSelect('OPERATOR')}
          className={`p-4 rounded-xl border transition-all cursor-pointer select-none ${
            selectedRoleName === 'OPERATOR'
              ? 'bg-indigo-50/40 border-indigo-600 shadow-xs ring-1 ring-indigo-600/30'
              : 'bg-white border-slate-200 hover:border-slate-300 hover:bg-slate-50/50'
          }`}
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <div
                className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  selectedRoleName === 'OPERATOR' ? 'bg-indigo-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <Users className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-bold text-slate-900">OPERATOR</h2>
                  <span className="text-[10px] font-semibold bg-blue-100 text-blue-700 px-1.5 py-0.2 rounded">
                    {roles.find((r) => r.name === 'OPERATOR')?.userCount ?? 0} users
                  </span>
                </div>
                <p className="text-xs text-slate-500 mt-0.5">Telephony & Campaign Execution Staff</p>
              </div>
            </div>
            <div className="text-right">
              <span className="text-xs font-semibold text-slate-900">
                {selectedRoleName === 'OPERATOR' ? activeCount : (roles.find((r) => r.name === 'OPERATOR')?.permissionKeys.length ?? 0)}
              </span>
              <span className="text-[11px] text-slate-400"> / {totalCount} active</span>
            </div>
          </div>
        </div>
      </div>

      {/* 4. Root Authority Notice (Subtle & Clean) */}
      <div className="bg-slate-50/80 border border-slate-200 rounded-lg p-3 flex items-center justify-between text-xs text-slate-600">
        <div className="flex items-center gap-2.5">
          <Lock className="w-3.5 h-3.5 text-slate-500 shrink-0" />
          <span>
            <strong className="text-slate-800">SUPER_ADMIN</strong> retains permanent unrestricted access and cannot be modified. DNC, consent, and NZ calling hours are enforced permanently for all roles.
          </span>
        </div>
      </div>

      {/* 5. Permission Modules Grid */}
      <div className="space-y-4">
        <div className="flex items-center justify-between pb-1">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
            Available Modules ({Object.keys(groupedPermissions).length})
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleSelectAll}
              className="text-xs font-medium text-slate-600 hover:text-indigo-600 px-2 py-1 rounded hover:bg-slate-100 transition cursor-pointer"
            >
              Select All
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={handleClearAll}
              className="text-xs font-medium text-slate-600 hover:text-rose-600 px-2 py-1 rounded hover:bg-slate-100 transition cursor-pointer"
            >
              Clear All
            </button>
          </div>
        </div>

        {Object.entries(groupedPermissions).map(([category, perms]) => {
          const allCategoryKeys = perms.map((p) => p.key);
          const categorySelectedCount = allCategoryKeys.filter((k) => selectedPermissions.has(k)).length;
          const isAllCategorySelected = categorySelectedCount === perms.length;

            return (
              <div
                key={category}
                className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-2xs"
              >
                {/* Module Header */}
                <div className="bg-slate-50/70 px-4 py-2.5 border-b border-slate-200/80 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <div className="p-1 bg-white border border-slate-200 rounded-md shadow-2xs">
                      {getCategoryIcon(category)}
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-slate-900">{category}</h3>
                    </div>
                    <span className="text-[11px] text-slate-400">
                      ({categorySelectedCount}/{perms.length} enabled)
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() => handleToggleCategory(category)}
                    className="text-xs font-medium text-slate-500 hover:text-indigo-600 transition cursor-pointer"
                  >
                    {isAllCategorySelected ? 'Deselect all' : 'Select all'}
                  </button>
                </div>

                {/* Capability Rows (Clean Modern Toggles) */}
                <div className="divide-y divide-slate-100">
                  {perms.map((perm) => {
                    const isChecked = selectedPermissions.has(perm.key);
                    return (
                      <div
                        key={perm.id}
                        onClick={() => handleTogglePermission(perm.key)}
                        className={`flex items-center justify-between px-4 py-2.5 transition cursor-pointer select-none ${
                          isChecked ? 'bg-indigo-50/25 hover:bg-indigo-50/40' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <div className="flex items-center gap-3 min-w-0 pr-4">
                          {/* Toggle Switch */}
                          <button
                            type="button"
                            role="switch"
                            aria-checked={isChecked}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-hidden ${
                              isChecked ? 'bg-indigo-600' : 'bg-slate-200'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                isChecked ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>

                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-semibold text-slate-900 truncate">
                                {perm.label}
                              </span>
                              <span className="font-mono text-[10px] text-slate-400 bg-slate-100 px-1.5 py-0.2 rounded border border-slate-200/60 hidden sm:inline-block">
                                {perm.key}
                              </span>
                            </div>
                            <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.2">
                              {perm.description}
                            </p>
                          </div>
                        </div>

                        <div className="shrink-0">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${
                              isChecked
                                ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                                : 'bg-slate-100 text-slate-400'
                            }`}
                          >
                            {isChecked ? 'Allowed' : 'Restricted'}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

      {/* 7. Floating Save Bar (When Dirty) */}
      {isDirty && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40 bg-slate-900 text-white px-5 py-3 rounded-xl shadow-xl flex items-center gap-4 border border-slate-800 animate-in fade-in slide-in-from-bottom-3 duration-200">
          <div className="flex items-center gap-2 text-xs">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping" />
            <span className="font-medium">
              Unsaved changes for <span className="font-mono text-indigo-300 font-bold">{selectedRoleName}</span> ({activeCount} selected)
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleDiscard}
              disabled={isSaving}
              className="px-3 py-1 text-xs text-slate-300 hover:text-white transition cursor-pointer"
            >
              Discard
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="inline-flex items-center px-3.5 py-1 text-xs font-semibold rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white transition shadow-sm cursor-pointer"
            >
              {isSaving ? 'Saving...' : 'Save Changes'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default RoleManagementView;
