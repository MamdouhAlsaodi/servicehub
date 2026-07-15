'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';
import { usePreferences } from '@/contexts/PreferencesContext';

type CategoryItem = { id: string; key:
  | 'register.categories.electrical'
  | 'register.categories.plumbing'
  | 'register.categories.appliances'
  | 'register.categories.cleaning'
  | 'register.categories.construction'
  | 'register.categories.photography'
  | 'register.categories.graphicDesign'
  | 'register.categories.programming';
};

const CATEGORIES: CategoryItem[] = [
  { id: '1', key: 'register.categories.electrical' },
  { id: '2', key: 'register.categories.plumbing' },
  { id: '3', key: 'register.categories.appliances' },
  { id: '4', key: 'register.categories.cleaning' },
  { id: '5', key: 'register.categories.construction' },
  { id: '6', key: 'register.categories.photography' },
  { id: '7', key: 'register.categories.graphicDesign' },
  { id: '8', key: 'register.categories.programming' },
];

export default function RegisterPage() {
  const router = useRouter();
  const { register } = useAuth();
  const { t } = usePreferences();
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
      setError(t('register.errorPasswordMismatch'));
      return;
    }

    if (formData.password.length < 6) {
      setError(t('register.errorPasswordTooShort'));
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
      setError(err.message || t('register.errorDefault'));
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
          <p className="font-medium">{t('register.successTitle')}</p>
          <p className="text-sm mt-1">{t('register.successSubtitle')}</p>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-center text-gray-900 mb-6">
        {t('register.title')}
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Account Type Toggle */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          {t('register.accountTypeLabel')}
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
              <span className="text-sm font-medium">{t('register.accountTypeCustomer')}</span>
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
              <span className="text-sm font-medium">{t('register.accountTypeVendor')}</span>
            </div>
          </label>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="name" className="block text-sm font-medium text-gray-700 mb-1">
            {t('register.nameLabel')}
          </label>
          <input
            id="name"
            type="text"
            required
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
            placeholder={t('register.namePlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            {t('register.emailLabel')}
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
            {t('register.passwordLabel')}
          </label>
          <input
            id="password"
            type="password"
            required
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
            placeholder={t('register.passwordPlaceholder')}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-700 mb-1">
            {t('register.confirmPasswordLabel')}
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
                {t('register.businessNameLabel')}
              </label>
              <input
                id="businessName"
                type="text"
                required
                value={formData.businessName}
                onChange={(e) => setFormData({ ...formData, businessName: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
                placeholder={t('register.businessNamePlaceholder')}
              />
            </div>

            <div>
              <label htmlFor="categoryId" className="block text-sm font-medium text-gray-700 mb-1">
                {t('register.categoryLabel')}
              </label>
              <select
                id="categoryId"
                required
                value={formData.categoryId}
                onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition"
              >
                <option value="">{t('register.categoryPlaceholder')}</option>
                {CATEGORIES.map((cat) => (
                  <option key={cat.id} value={cat.id}>
                    {t(cat.key)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="address" className="block text-sm font-medium text-gray-700 mb-1">
                {t('register.addressLabel')}
              </label>
              <textarea
                id="address"
                required
                value={formData.address}
                onChange={(e) => setFormData({ ...formData, address: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-transparent outline-none transition resize-none"
                placeholder={t('register.addressPlaceholder')}
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
          {loading ? t('register.submitting') : t('register.submit')}
        </button>
      </form>

      <div className="mt-6 text-center text-sm">
        <span className="text-gray-600">{t('register.haveAccount')} </span>
        <Link href="/login" className="text-primary-600 hover:text-primary-700 font-medium">
          {t('register.signIn')}
        </Link>
      </div>
    </div>
  );
}