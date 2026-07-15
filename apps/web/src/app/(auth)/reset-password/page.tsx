'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { usePreferences } from '@/contexts/PreferencesContext';

function ResetPasswordLoadingFallback() {
  const { t } = usePreferences();
  return <div className="text-center py-8">{t('reset.loadingFallback')}</div>;
}

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';
  const { t } = usePreferences();

  const [formData, setFormData] = useState({
    newPassword: '',
    confirmPassword: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!token) {
      setError(t('reset.errorInvalidToken'));
      return;
    }

    if (formData.newPassword.length < 6) {
      setError(t('reset.errorPasswordTooShort'));
      return;
    }

    if (formData.newPassword !== formData.confirmPassword) {
      setError(t('reset.errorPasswordMismatch'));
      return;
    }

    setLoading(true);

    try {
      await apiFetch('/api/v1/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({
          token,
          newPassword: formData.newPassword,
        }),
      });

      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err: any) {
      setError(err.message || t('reset.errorDefault'));
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div>
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          <svg className="w-10 h-10 mx-auto mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="font-medium text-center">{t('reset.successMessage')}</p>
          <p className="text-sm text-center mt-1">{t('reset.successSubtitle')}</p>
        </div>

        <div className="mt-6 text-center">
          <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
            {t('reset.signIn')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
        {t('reset.title')}
      </h2>
      <p className="text-center text-gray-600 mb-6">
        {t('reset.subtitle')}
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {!token && (
        <div className="mb-4 p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-700 text-sm">
          {t('reset.missingToken')}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="newPassword" className="block text-sm font-medium text-gray-700 mb-1">
            {t('reset.newPasswordLabel')}
          </label>
          <input
            id="newPassword"
            type="password"
            required
            disabled={!token}
            value={formData.newPassword}
            onChange={(e) => setFormData({ ...formData, newPassword: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition disabled:bg-gray-100"
            placeholder={t('reset.newPasswordPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
            {t('reset.confirmPasswordLabel')}
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            disabled={!token}
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition disabled:bg-gray-100"
            placeholder="••••••••"
          />
        </div>

        <button
          type="submit"
          disabled={loading || !token}
          className="w-full py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t('reset.submitting') : t('reset.submit')}
        </button>
      </form>

      <div className="mt-6 text-center text-sm">
        <span className="text-gray-600">{t('reset.rememberPrompt')} </span>
        <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
          {t('reset.signIn')}
        </Link>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<ResetPasswordLoadingFallback />}>
      <ResetPasswordForm />
    </Suspense>
  );
}