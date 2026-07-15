'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';
import { usePreferences } from '@/contexts/PreferencesContext';

interface ForgotPasswordResponse {
  message: string;
  token?: string;
}

function ForgotPasswordLoadingFallback() {
  const { t } = usePreferences();
  return <div className="text-center py-8">{t('forgot.loadingFallback')}</div>;
}

function ForgotPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { t } = usePreferences();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);
  const isDev = process.env.NODE_ENV === 'development';

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const response = await apiFetch<ForgotPasswordResponse>('/api/v1/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });

      setSuccess(true);

      // In dev mode, show the token since we don't have email sending
      if (isDev && response.token) {
        setResetToken(response.token);
      }
    } catch (err: any) {
      setError(err.message || t('forgot.errorDefault'));
    } finally {
      setLoading(false);
    }
  };

  const handleContinueToReset = () => {
    if (resetToken) {
      router.push(`/reset-password?token=${resetToken}`);
    }
  };

  if (success) {
    return (
      <div>
        <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">
          {t('forgot.successTitle')}
        </h2>

        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          <svg className="w-10 h-10 mx-auto mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="font-medium text-center">{t('forgot.successMessage')}</p>
          <p className="text-sm text-center mt-1">{t('forgot.successHint')}</p>
        </div>

        {isDev && resetToken && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-700 font-medium mb-2">{t('forgot.devTokenTitle')}</p>
            <code className="block bg-white p-2 rounded text-xs break-all border border-yellow-200">
              {resetToken}
            </code>
            <button
              onClick={handleContinueToReset}
              className="mt-3 w-full py-2 bg-yellow-500 text-white font-medium rounded-lg hover:bg-yellow-600 transition"
            >
              {t('forgot.devTokenCta')}
            </button>
          </div>
        )}

        <div className="mt-6 text-center">
          <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
            {t('forgot.backToLogin')}
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
        {t('forgot.title')}
      </h2>
      <p className="text-center text-gray-600 mb-6">
        {t('forgot.subtitle')}
      </p>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            {t('forgot.emailLabel')}
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
            placeholder="example@email.com"
          />
        </div>

        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? t('forgot.submitting') : t('forgot.submit')}
        </button>
      </form>

      <div className="mt-6 text-center text-sm">
        <span className="text-gray-600">{t('forgot.rememberPrompt')} </span>
        <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
          {t('forgot.signIn')}
        </Link>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<ForgotPasswordLoadingFallback />}>
      <ForgotPasswordForm />
    </Suspense>
  );
}