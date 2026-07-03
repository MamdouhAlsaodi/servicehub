const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('access_token') : null;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await res.json().catch(() => null);
  
  if (!res.ok) {
    throw new Error(data?.message || res.statusText);
  }
  
  return data;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'VENDOR' | 'CUSTOMER';
  businessName?: string;
  categoryId?: string;
  address?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface AuthResponse {
  user: User;
  accessToken: string;
  refreshToken: string;
}

export interface VendorStatusResponse {
  status: string;
  businessName: string;
  category: string;
}
