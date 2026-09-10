import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { ShieldAlert, Loader2 } from 'lucide-react';
import { Button } from '../ui/Button';

interface ProtectedRouteProps {
  children: React.ReactNode;
  allowedRoles?: string[];
  requiredPermission?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles,
  requiredPermission
}) => {
  const { user, isAuthenticated, isLoading, hasRole, hasPermission } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="text-center space-y-3">
          <Loader2 className="w-8 h-8 animate-spin text-[#0f2e4a] mx-auto" />
          <p className="text-xs font-semibold text-slate-600 tracking-tight">
            Verifying authenticated session...
          </p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated || !user) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  const roleForbidden = allowedRoles && allowedRoles.length > 0 && !allowedRoles.some((r) => hasRole(r));
  const permForbidden = requiredPermission && !hasPermission(requiredPermission);

  if (roleForbidden || permForbidden) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center p-4">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-xl p-6 text-center space-y-4 shadow-xs">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-base font-bold text-slate-900">403 — Access Denied</h2>
            <p className="text-xs text-slate-600 mt-1">
              Your account (<span className="font-semibold">{user.role}</span>) does not have the required permission (
              <span className="font-mono text-indigo-700 bg-indigo-50 px-1 py-0.5 rounded text-[11px]">
                {requiredPermission || (allowedRoles || []).join(', ')}
              </span>
              ) to access this operational section.
            </p>
          </div>
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => window.history.back()}
            >
              Return to Previous View
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
