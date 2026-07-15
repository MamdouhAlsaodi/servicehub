'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences } from '@/contexts/PreferencesContext';
import { apiFetch, VendorStatusResponse } from '@/lib/api';

export default function LoginPage() {
  const router = useRouter();
  const { login, demoLogin } = useAuth();
  const { t } = usePreferences();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleDemoLogin = async () => {
    // Belt-and-suspenders: the button is also `disabled={loading}` so
    // the DOM already blocks a second click.
    if (loading) return;
    setError('');
    setLoading(true);
    try {
      await demoLogin();
      // The demo endpoint always mints a CUSTOMER session, so we
      // route straight to the customer landing page.
      router.push('/');
    } catch (err: any) {
      setError(err.message || t('login.errorDemoLogin'));
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      // login() returns the authenticated user; AuthContext already
      // updated internal state but React state isn't visible to the
      // current closure, so we use the returned value to pick a route.
      const user = await login(formData.email, formData.password);

      // Fetch vendor status if VENDOR role (cookie auth — no JWT handling).
      let currentVendorStatus: string | null = null;
      if (user.role === 'VENDOR') {
        try {
          const statusData = await apiFetch<VendorStatusResponse>(
            '/api/v1/auth/vendor-status',
          );
          currentVendorStatus = statusData.status;
        } catch (err) {
          console.error('Failed to fetch vendor status:', err);
        }
      }

      // Redirect based on role and status
      switch (user.role) {
        case 'ADMIN':
          router.push('/admin');
          break;
        case 'VENDOR':
          // Check vendor approval status
          if (currentVendorStatus === 'APPROVED') {
            router.push('/dashboard');
          } else if (currentVendorStatus === 'PENDING') {
            router.push('/vendor-pending');
          } else {
            router.push('/vendor-suspended');
          }
          break;
        case 'CUSTOMER':
        default:
          router.push('/');
          break;
      }
    } catch (err: any) {
      setError(err.message || t('login.errorLoginDefault'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">
        {t('login.title')}
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            {t('login.emailLabel')}
          </label>
          <input
            id="email"
            type="email"
            required
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition text-gray-900 placeholder:text-gray-500"
            placeholder="example@email.com"
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            {t('login.passwordLabel')}
          </label>
          <input
            id="password"
            type="password"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition text-gray-900 placeholder:text-gray-500"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t('login.submitting') : t('login.submit')}
        </button>
      </form>

      {/* DEMO ONLY: Google OAuth is simulated for this portfolio project. */}
      {/* No Google credentials, external authorization, or real user identity is used. */}
      <div className="mt-6">
        <div className="relative flex items-center" aria-hidden="true">
          <div className="w-full border-t border-gray-200" />
          <span className="bg-white px-3 text-xs uppercase tracking-wider text-gray-400">
            {t('login.dividerOr')}
          </span>
          <div className="w-full border-t border-gray-200" />
        </div>
        <button
          type="button"
          onClick={handleDemoLogin}
          disabled={loading}
          aria-label={t('login.demoAriaLabel')}
          className="mt-4 w-full py-3 bg-white border-2 border-dashed border-gray-300 text-gray-700 font-medium rounded-lg hover:bg-gray-50 hover:border-gray-400 focus:ring-4 focus:ring-gray-200 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
        >
          <span className="px-2 py-0.5 bg-amber-100 text-amber-800 text-[10px] font-bold uppercase tracking-wider rounded">
            {t('login.demoBadge')}
          </span>
          <span>{t('login.demoButton')}</span>
        </button>
        <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
          <p className="text-xs text-amber-900 leading-relaxed text-center">
            <span className="font-semibold">{t('login.demoTitle')}</span>
            {t('login.demoDesc')}
          </p>
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-primary-600 hover:text-primary-700">
          {t('login.forgotPassword')}
        </Link>
        <Link href="/register" className="text-primary-600 hover:text-primary-700">
          {t('login.createAccount')}
        </Link>
      </div>
    </div>
  );
}