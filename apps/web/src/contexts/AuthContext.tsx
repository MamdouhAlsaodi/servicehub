'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiFetch, User, AuthResponse, VendorStatusResponse } from '@/lib/api';

interface AuthContextType {
  user: User | null;
  // Returns the user so the login page can pick a redirect without
  // re-fetching /me (React state isn't visible to the current closure).
  login: (email: string, password: string) => Promise<User>;
  // Portfolio-only simulated Google sign-in. Same lifecycle as login();
  // calls /api/v1/auth/demo-google-login with the fixed demo identity.
  demoLogin: () => Promise<User>;
  register: (data: RegisterData) => Promise<void>;
  logout: () => void;
  loading: boolean;
  vendorStatus: VendorStatusResponse | null;
  refreshVendorStatus: () => Promise<void>;
}

interface RegisterData {
  name: string;
  email: string;
  password: string;
  role: 'CUSTOMER' | 'VENDOR';
  businessName?: string;
  categoryId?: string;
  address?: string;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [vendorStatus, setVendorStatus] = useState<VendorStatusResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Non-sensitive presence hint set by the server on successful
    // login/refresh. Pure marker "1" — no token, no user data. When
    // absent we skip the protected /me call entirely so anonymous
    // page loads don't log a 401 to the browser console. /me remains
    // the source of truth for identity; this only gates the request.
    const hasSessionHint = (): boolean => {
      if (typeof document === 'undefined') return false;
      return document.cookie
        .split(';')
        .some((c) => c.trim().startsWith('sh_session='));
    };
    // Best-effort local clear when /me rejects; the server already
    // clears the hint on /logout success. Prevents a stale hint from
    // repeating failed /me calls on the next page load.
    const clearSessionHint = (): void => {
      if (typeof document === 'undefined') return;
      document.cookie = 'sh_session=; Max-Age=0; path=/; SameSite=Lax';
    };

    const initAuth = async () => {
      // Session lives in HttpOnly cookies; apiFetch sends them via
      // credentials: 'include'. No client-side token read possible.
      if (!hasSessionHint()) {
        // Anonymous visitor: skip /me so we don't trigger an
        // expected 401. Middleware still gates protected routes
        // server-side.
        setLoading(false);
        return;
      }
      try {
        const userData = await apiFetch<User>('/api/v1/auth/me');
        setUser(userData);
        if (userData.role === 'VENDOR') await refreshVendorStatus();
      } catch {
        // Hint was present but /me was rejected (e.g. expired JWT);
        // drop the hint so we don't loop on the next mount.
        clearSessionHint();
      }
      setLoading(false);
    };
    initAuth();
  }, []);

  const refreshVendorStatus = async () => {
    try {
      const status = await apiFetch<VendorStatusResponse>('/api/v1/auth/vendor-status');
      setVendorStatus(status);
    } catch (error) {
      console.error('Failed to fetch vendor status:', error);
    }
  };

  // Shared session entry for login() and demoLogin() so the demo flow
  // can't drift from the regular lifecycle. Tokens stay in HttpOnly
  // cookies set by the server; we only mirror the public user shape.
  const persistSession = async (response: AuthResponse) => {
    setUser(response.user);
    if (response.user.role === 'VENDOR') await refreshVendorStatus();
  };

  const login = async (email: string, password: string): Promise<User> => {
    const response = await apiFetch<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    await persistSession(response);
    return response.user;
  };

  const demoLogin = async (): Promise<User> => {
    const response = await apiFetch<AuthResponse>('/api/v1/auth/demo-google-login', {
      method: 'POST',
      body: JSON.stringify({ email: 'demo.customer@servicehub.local' }),
    });
    await persistSession(response);
    return response.user;
  };

  const register = async (data: RegisterData) => {
    await apiFetch('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  };

  // Fire-and-forget revocation: server clears HttpOnly cookies and
  // revokes refresh records; we drop local state immediately. Kept
  // `() => void` because the dashboard logout button doesn't await.
  const logout = () => {
    apiFetch('/api/v1/auth/logout', { method: 'POST' }).catch((error) => {
      console.error('Logout request failed:', error);
    });
    setUser(null);
    setVendorStatus(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, login, demoLogin, register, logout, loading, vendorStatus, refreshVendorStatus }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
