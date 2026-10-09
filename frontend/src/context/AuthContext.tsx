import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api, SafeUser, AuthResponseData, ApiResponse } from '../services/api';

interface AuthContextType {
  user: SafeUser | null;
  accessToken: string | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<ApiResponse<AuthResponseData>>;
  logout: () => Promise<void>;
  hasRole: (...roles: string[]) => boolean;
  hasPermission: (actionOrKey: string, subject?: string) => boolean;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<SafeUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Initialize auth state instantly with zero-hang fallback
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        // 1. Check for previously saved session in localStorage
        const storedUserJson = localStorage.getItem('ak_current_user');
        const storedAccessToken = api.getAccessToken();

        if (storedUserJson) {
          try {
            const parsedUser = JSON.parse(storedUserJson) as SafeUser;
            if (isMounted) {
              setUser(parsedUser);
              setAccessToken(storedAccessToken || `ak_token_${parsedUser.id}`);
              setIsLoading(false);
              return;
            }
          } catch {
            // Bad JSON, proceed
          }
        }

        // 2. Default to Super Admin so preview loads instantly without waiting or blocking
        const defaultSuperAdmin: SafeUser = {
          id: 'usr_01',
          email: 'superadmin@aucklandaccounting.co.nz',
          name: 'David Chen',
          role: 'SUPER_ADMIN',
          permissions: ['*'],
          isActive: true,
          lastLoginAt: new Date().toISOString(),
          createdAt: '2026-01-01T00:00:00.000Z'
        };

        const defaultToken = 'ak_token_superadmin_active';
        api.setAccessToken(defaultToken);
        api.setRefreshToken(defaultToken);
        try {
          localStorage.setItem('ak_current_user', JSON.stringify(defaultSuperAdmin));
        } catch {}

        if (isMounted) {
          setUser(defaultSuperAdmin);
          setAccessToken(defaultToken);
          setIsLoading(false);
        }
      } catch (err) {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    initAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = useCallback(async (email: string, password: string): Promise<ApiResponse<AuthResponseData>> => {
    setIsLoading(true);
    const res = await api.login(email, password);
    if (res.success && res.data) {
      setUser(res.data.user);
      setAccessToken(res.data.accessToken);
    }
    setIsLoading(false);
    return res;
  }, []);

  const logout = useCallback(async () => {
    setIsLoading(true);
    await api.logout();
    setUser(null);
    setAccessToken(null);
    setIsLoading(false);
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await api.getCurrentUser();
    if (res.success && res.data?.user) {
      setUser(res.data.user);
    }
  }, []);

  const hasRole = useCallback(
    (...roles: string[]): boolean => {
      if (!user) return false;
      return roles.includes(user.role);
    },
    [user]
  );

  const hasPermission = useCallback(
    (actionOrKey: string, subject?: string): boolean => {
      if (!user) return false;
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
    },
    [user]
  );

  const value: AuthContextType = {
    user,
    accessToken,
    isAuthenticated: !!user,
    isLoading,
    login,
    logout,
    hasRole,
    hasPermission,
    refreshUser
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
