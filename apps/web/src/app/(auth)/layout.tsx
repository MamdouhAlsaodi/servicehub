import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'ServiceHub - المصادقة',
  description: 'تسجيل الدخول والتسجيل في منصة ServiceHub',
};

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-md w-full">
        <div className="bg-white shadow-xl rounded-lg p-8">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold text-gray-900">ServiceHub</h1>
            <p className="mt-2 text-gray-600">منصة الخدمات المتميزة</p>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}
