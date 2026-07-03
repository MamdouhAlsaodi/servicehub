'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

export default function LoginPage() {
  const router = useRouter();
  const { login } = useAuth();
  const [formData, setFormData] = useState({
    email: '',
    password: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      await login(formData.email, formData.password);
      
      // Get user from localStorage to determine redirect
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || ''}/api/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
        },
      });
      const user = await response.json();
      
      // Set cookie for middleware
      const token = localStorage.getItem('access_token');
      if (token) {
        document.cookie = `access_token=${token}; path=/; max-age=900`;
      }
      
      // Redirect based on role
      switch (user.role) {
        case 'ADMIN':
          router.push('/admin');
          break;
        case 'VENDOR':
          router.push('/dashboard');
          break;
        case 'CUSTOMER':
        default:
          router.push('/');
          break;
      }
    } catch (err: any) {
      setError(err.message || 'فشل تسجيل الدخول. يرجى التحقق من بيانات الاعتماد.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">
        تسجيل الدخول
      </h2>
      
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
            value={formData.email}
            onChange={(e) => setFormData({ ...formData, email: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
            placeholder="example@email.com"
          />
        </div>
        
        <div>
          <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
            كلمة المرور
          </label>
          <input
            id="password"
            type="password"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
            placeholder="••••••••"
          />
        </div>
        
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'جاري التحميل...' : 'تسجيل الدخول'}
        </button>
      </form>
      
      <div className="mt-6 flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-primary-600 hover:text-primary-700">
          نسيت كلمة المرور؟
        </Link>
        <Link href="/register" className="text-primary-600 hover:text-primary-700">
          إنشاء حساب جديد
        </Link>
      </div>
    </div>
  );
}
