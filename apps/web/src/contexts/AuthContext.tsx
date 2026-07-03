'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { apiFetch, User, AuthResponse, VendorStatusResponse } from '@/lib/api';

interface AuthContextType {
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
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
    const initAuth = async () => {
      const token = localStorage.getItem('access_token');
      if (token) {
        try {
          const userData = await apiFetch<User>('/api/v1/auth/me');
          setUser(userData);
          
          if (userData.role === 'VENDOR') {
            await refreshVendorStatus();
          }
        } catch (error) {
          localStorage.removeItem('access_token');
          localStorage.removeItem('refresh_token');
        }
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

  const login = async (email: string, password: string) => {
    const response = await apiFetch<AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    
    localStorage.setItem('access_token', response.accessToken);
    localStorage.setItem('refresh_token', response.refreshToken);
    
    // Set cookie for middleware (15 minutes)
    if (typeof document !== 'undefined') {
      document.cookie = `access_token=${response.accessToken}; path=/; max-age=900`;
    }
    
    setUser(response.user);
    
    if (response.user.role === 'VENDOR') {
      await refreshVendorStatus();
    }
  };

  const register = async (data: RegisterData) => {
    await apiFetch('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  };

  const logout = () => {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    if (typeof document !== 'undefined') {
      document.cookie = 'access_token=; path=/; max-age=0';
    }
    setUser(null);
    setVendorStatus(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        login,
        register,
        logout,
        loading,
        vendorStatus,
        refreshVendorStatus,
      }}
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
