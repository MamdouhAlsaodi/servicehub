'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

const CATEGORIES = [
  { id: '1', name: 'صيانة كهربائية' },
  { id: '2', name: 'صيانة سباكة' },
  { id: '3', name: 'صيانة أجهزة' },
  { id: '4', name: 'تنظيف' },
  { id: '5', name: 'بناء وترميم' },
  { id: '6', name: 'تصوير فوتوغرافي' },
  { id: '7', name: 'تصميم جرافيك' },
  { id: '8', name: 'برمجة وتطوير' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const [accountType, setAccountType] = useState<'CUSTOMER' | 'VENDOR'>('CUSTOMER');
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    confirmPassword: '',
    businessName: '',
    categoryId: '',
    address: '',
  });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (formData.password !== formData.confirmPassword) {
      setError('كلمتا المرور غير متطابقتين');
      return;
    }

    if (formData.password.length < 6) {
      setError('يجب أن تكون كلمة المرور 6 أحرف على الأقل');
      return;
    }

    setLoading(true);

    try {
      await register({
        name: formData.name,
        email: formData.email,
        password: formData.password,
        role: accountType,
        ...(accountType === 'VENDOR' && {
          businessName: formData.businessName,
          categoryId: formData.categoryId,
          address: formData.address,
        }),
      });
      
      setSuccess(true);
      setTimeout(() => {
        router.push('/login');
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'فشل التسجيل. يرجى المحاولة مرة أخرى.');
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="text-center">
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg text-green-700">
          <svg className="w-12 h-12 mx-auto mb-2 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="font-medium">تم التسجيل بنجاح!</p>
          <p className="text-sm mt-1">جاري التحويل إلى صفحة تسجيل الدخول...</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">
        إنشاء حساب جديد
      </h2>
      
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
      
      {/* Account Type Toggle */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          نوع الحساب
        </label>
        <div className="flex gap-4">
          <label className="flex-1 cursor-pointer">
            <input
              type="radio"
              name="accountType"
              value="CUSTOMER"
              checked={accountType === 'CUSTOMER'}
              onChange={() => setAccountType('CUSTOMER')}
              className="peer hidden"
            />
            <div className="p-3 text-center border-2 border-gray-200 rounded-lg peer-checked:border-primary-500 peer-checked:bg-primary-50 transition">
              <span className="text-sm font-medium">عميل</span>
            </div>
          </label>
          <label className="flex-1 cursor-pointer">
            <input
              type="radio"
              name="accountType"
              value="VENDOR"
              checked={accountType === 'VENDOR'}
              onChange={() => setAccountType('VENDOR')}
              className="peer hidden"
            />
            <div className="p-3 text-center border-2 border-gray-200 rounded-lg peer-checked:border-primary-500 peer-checked:bg-primary-50 transition">
              <span className="text-sm font-medium">مزود خدمة</span>
            </div>
          </label>
        </div>
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            الاسم الكامل
          </label>
          <input
            id="name"
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
            placeholder="محمد أحمد"
          />
        </div>
        
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
            placeholder="6 أحرف على الأقل"
          />
        </div>
        
        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
            تأكيد كلمة المرور
          </label>
          <input
            id="confirmPassword"
            type="password"
            required
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
            placeholder="••••••••"
          />
        </div>
        
        {/* Vendor-specific fields */}
        {accountType === 'VENDOR' && (
          <>
            <div>
              <label htmlFor="businessName" className="block text-sm font-medium text-gray-700 mb-1">
                اسم النشاط التجاري
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={formData.businessName}
                onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
                placeholder="مثال: ورشة الإصلاح السريع"
              />
            </div>
            
            <div>
              <label htmlFor="categoryId" className="block text-sm font-medium text-gray-700 mb-1">
                التخصص
              </label>
              <select
                id="categoryId"
                required
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
              >
                <option value="">اختر التخصص</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {cat.name}
                  </option>
                ))}
              </select>
            </div>
            
            <div>
              <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1">
                العنوان
              </label>
              <textarea
                id="address"
                required
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition resize-none"
                placeholder="شارع الملك فهد، حي العليا، الرياض"
                rows={2}
              />
            </div>
          </>
        )}
        
        <button
          type="submit"
          disabled={loading}
          className="w-full py-3 bg-primary-600 text-white font-medium rounded-lg hover:bg-primary-700 focus:ring-4 focus:ring-primary-200 transition disabled:opacity-50 disabled:cursor-not-allowed mt-6"
        >
          {loading ? 'جاري التسجيل...' : 'إنشاء الحساب'}
        </button>
      </form>
      
      <div className="mt-6 text-center text-sm">
        <span className="text-gray-600">لديك حساب بالفعل؟ </span>
        <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
          تسجيل الدخول
        </Link>
      </div>
    </div>
  );
}
