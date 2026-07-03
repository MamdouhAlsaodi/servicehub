'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { apiFetch } from '@/lib/api';

interface ForgotPasswordResponse {
  message: string;
  token?: string;
}

function ForgotPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
      setError(err.message || 'فشل إرسال طلب استعادة كلمة المرور.');
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
          تم إرسال الطلب
        </h2>
        
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          <svg className="w-10 h-10 mx-auto mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="font-medium text-center">تم إرسال رابط استعادة كلمة المرور إلى بريدك الإلكتروني</p>
          <p className="text-sm text-center mt-1">يرجى التحقق من صندوق البريد الوارد</p>
        </div>
        
        {isDev && resetToken && (
          <div className="mt-4 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
            <p className="text-sm text-yellow-700 font-medium mb-2">🔧 وضع التطوير - الرمز المميز:</p>
            <code className="block bg-white p-2 rounded text-xs break-all border border-yellow-200">
              {resetToken}
            </code>
            <button
              onClick={handleContinueToReset}
              className="mt-3 w-full py-2 bg-yellow-500 text-white font-medium rounded-lg hover:bg-yellow-600 transition"
            >
              متابعة لإعادة تعيين كلمة المرور
            </button>
          </div>
        )}
        
        <div className="mt-6 text-center">
          <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
            العودة لتسجيل الدخول
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-2">
        استعادة كلمة المرور
      </h2>
      <p className="text-center text-gray-600 mb-6">
        أدخل بريدك الإلكتروني لاستعادة كلمة المرور
      </p>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            البريد الإلكتروني
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
          {loading ? 'جاري الإرسال...' : 'إرسال رابط الاستعادة'}
        </button>
      </form>
      
      <div className="mt-6 text-center text-sm">
        <span className="text-gray-600">تذكرت كلمة المرور؟ </span>
        <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
          تسجيل الدخول
        </Link>
      </div>
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={<div className="text-center py-8">جاري التحميل...</div>}>
      <ForgotPasswordForm />
    </Suspense>
  );
}
