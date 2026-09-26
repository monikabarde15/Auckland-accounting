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

  // Initialize auth state by attempting to exchange HttpOnly refresh cookie
  useEffect(() => {
    let isMounted = true;

    const initAuth = async () => {
      try {
        const storedRefreshToken = api.getRefreshToken();
        const storedAccessToken = api.getAccessToken();

        if (storedAccessToken) {
          api.setAccessToken(storedAccessToken);
          const meRes = await api.getCurrentUser();
          if (isMounted && meRes.success && meRes.data?.user) {
            setUser(meRes.data.user);
            setAccessToken(storedAccessToken);
            return;
          }
        }

        const res = await api.refresh(storedRefreshToken || undefined);
        if (isMounted && res.success && res.data) {
          setUser(res.data.user);
          setAccessToken(res.data.accessToken);
        }
      } catch {
        // Unauthenticated session
      } finally {
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
