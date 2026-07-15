const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// Unsafe HTTP methods that the backend's double-submit CSRF guard
// (CsrfGuard) protects — it requires both the `csrf_token` cookie
// and the `x-csrf-token` request header to match.
const UNSAFE_METHODS = new Set<string>(['POST', 'PUT', 'PATCH', 'DELETE']);

// Tiny `document.cookie` parser scoped to this module. We only ever
// read the JS-readable `csrf_token` cookie here — the HttpOnly JWTs
// are never visible to this code path, and we never try to touch
// them.
function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const target = `${name}=`;
  const jar = document.cookie;
  if (!jar) return undefined;
  for (const part of jar.split(';')) {
    const trimmed = part.trim();
    if (trimmed.startsWith(target)) {
      return decodeURIComponent(trimmed.slice(target.length));
    }
  }
  return undefined;
}

function csrfHeaderFor(method: string): string | undefined {
  if (!UNSAFE_METHODS.has(method.toUpperCase())) return undefined;
  const token = readCookie('csrf_token');
  return token ?? undefined;
}

function buildRequestInit(options: RequestInit): RequestInit {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  new Headers(options.headers).forEach((value, key) => {
    headers.set(key, value);
  });

  // Auth now rides in HttpOnly cookies; credentials: 'include' sends
  // them. We deliberately do NOT build an Authorization header from
  // localStorage — tokens are never readable from JS on the client.
  // For unsafe methods we echo the readable `csrf_token` cookie into
  // the `x-csrf-token` header so the backend's CsrfGuard accepts the
  // request; safe methods are never blocked.
  const csrf = csrfHeaderFor(options.method ?? 'GET');
  if (csrf) {
    headers.set('x-csrf-token', csrf);
  }

  return {
    ...options,
    headers,
    credentials: 'include',
  };
}

export function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  return fetch(`${API_BASE}${path}`, buildRequestInit(options));
}

export async function apiFetch<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await apiRequest(path, options);
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
  // Marks the response as coming from the portfolio-only demo Google
  // sign-in simulation. Absent for the regular email/password flow.
  // Raw JWTs are no longer included — the backend sets HttpOnly cookies.
  authProvider?: 'demo-google';
}

export interface VendorStatusResponse {
  status: string;
  businessName: string;
  category: string;
}