import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const protectedPaths = ['/dashboard', '/admin', '/bookings', '/profile', '/vendor'];
const authPages = ['/login', '/register', '/forgot-password', '/reset-password'];

export function middleware(request: NextRequest) {
  const token = request.cookies.get('access_token')?.value;
  const path = request.nextUrl.pathname;

  // Protect routes that require authentication
  if (protectedPaths.some(p => path.startsWith(p))) {
    if (!token) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', path);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Redirect authenticated users away from auth pages
  if (token && authPages.some(p => path.startsWith(p))) {
    return NextResponse.redirect(new URL('/', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/admin/:path*',
    '/bookings/:path*',
    '/profile/:path*',
    '/vendor/:path*',
    '/login',
    '/register',
    '/forgot-password',
    '/reset-password',
  ],
};
