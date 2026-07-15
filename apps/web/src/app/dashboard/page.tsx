'use client';

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import { apiFetch } from '@/lib/api';
import { usePreferences } from '@/contexts/PreferencesContext';

interface StatCardProps {
  title: string;
  value: number | string;
  icon: React.ReactNode;
  delay: number;
  intlLocale: 'ar-SA' | 'en-US';
}

function StatCard({ title, value, icon, delay, intlLocale }: StatCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay }}
      className="glass rounded-2xl p-6 relative overflow-hidden"
    >
      {/* Background accent */}
      <div
        className="absolute top-0 right-0 w-32 h-32 rounded-full opacity-10 blur-3xl"
        style={{ background: 'var(--accent)' }}
      />

      <div className="relative">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
              {title}
            </p>
            <p className="text-3xl font-display font-bold" style={{ color: 'var(--text)' }}>
              {typeof value === 'number' ? value.toLocaleString(intlLocale) : value}
            </p>
          </div>
          <div
            className="w-12 h-12 rounded-xl flex items-center justify-center"
            style={{ background: 'var(--surface-hi)' }}
          >
            {icon}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

interface Booking {
  id: string;
  customerName: string;
  serviceTitle: string;
  date: string;
  time: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED';
  price: number;
}

interface VendorDashboard {
  summary: { todayBookings: number; confirmedRevenue: number; cancellations: number };
  upcomingBookings: Array<{
    id: string;
    startTime: string;
    service: { title: string };
    customer: { name: string };
  }>;
}

const container = {
  hidden: { opacity: 0 },
  show: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const item = {
  hidden: { opacity: 0, x: -20 },
  show: { opacity: 1, x: 0 },
};

export default function DashboardPage() {
  const { t, locale } = usePreferences();
  const [stats, setStats] = useState({
    todayBookings: 0,
    confirmedRevenue: 0,
    cancellations: 0,
  });
  const [recentBookings, setRecentBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intlLocale = locale === 'ar' ? 'ar-SA' : 'en-US';

  const fmtTime = (iso: string): string =>
    new Date(iso).toLocaleTimeString(intlLocale, { hour: '2-digit', minute: '2-digit' });
  const fmtDate = (iso: string): string =>
    new Date(iso).toLocaleDateString(intlLocale, { day: 'numeric', month: 'short' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<VendorDashboard>(
          '/api/v1/bookings/vendor/dashboard',
        );
        if (cancelled) return;
        setStats({
          todayBookings: data.summary?.todayBookings ?? 0,
          confirmedRevenue: data.summary?.confirmedRevenue ?? 0,
          cancellations: data.summary?.cancellations ?? 0,
        });
        setRecentBookings(
          (data.upcomingBookings ?? []).map((b) => ({
            id: b.id,
            customerName: b.customer?.name ?? t('dashboard.customerFallback'),
            serviceTitle: b.service?.title ?? t('dashboard.serviceFallback'),
            date: fmtDate(b.startTime),
            time: fmtTime(b.startTime),
            status: 'CONFIRMED' as const,
            price: 0,
          })),
        );
      } catch (e: any) {
        if (!cancelled) setError(e?.message || t('dashboard.errorLoadFallback'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t, intlLocale]);

  const getStatusColor = (status: Booking['status']) => {
    switch (status) {
      case 'CONFIRMED':
        return { bg: 'rgba(34, 197, 94, 0.2)', text: '#22c55e' };
      default:
        return { bg: 'rgba(156, 163, 175, 0.2)', text: '#9ca3af' };
    }
  };

  const getStatusLabel = (status: Booking['status']) => {
    switch (status) {
      case 'CONFIRMED': return t('dashboard.status.confirmed');
      default: return status;
    }
  };

  if (loading) {
    return (
      <div
        className="flex flex-col items-center justify-center h-64 gap-3"
        role="status"
        aria-live="polite"
      >
        <div className="w-8 h-8 border-4 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          {t('dashboard.loadingDashboard')}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass rounded-2xl p-8 text-center" role="alert">
        <p className="text-base font-semibold mb-1" style={{ color: 'var(--text)' }}>
          {t('dashboard.errorLoadTitle')}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-display font-bold" style={{ color: 'var(--text)' }}>
          {t('dashboard.title')}
        </h1>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          {t('dashboard.subtitle')}
        </p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard
          title={t('dashboard.stat.todayBookings')}
          value={stats.todayBookings}
          delay={0}
          intlLocale={intlLocale}
          icon={
            <svg className="w-6 h-6" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          }
        />
        <StatCard
          title={t('dashboard.stat.confirmedRevenue')}
          value={`${t('dashboard.layout.currencySar').trim()} ${stats.confirmedRevenue}`}
          delay={0.1}
          intlLocale={intlLocale}
          icon={
            <svg className="w-6 h-6" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
        <StatCard
          title={t('dashboard.stat.cancellations')}
          value={stats.cancellations}
          delay={0.2}
          intlLocale={intlLocale}
          icon={
            <svg className="w-6 h-6" style={{ color: 'var(--accent)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          }
        />
      </div>

      {/* Recent Bookings */}
      <div className="glass rounded-2xl overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h2 className="text-lg font-display font-semibold" style={{ color: 'var(--text)' }}>
            {t('dashboard.upcomingBookings')}
          </h2>
        </div>

        {recentBookings.length === 0 ? (
          <div className="p-8 text-center">
            <svg className="w-12 h-12 mx-auto mb-4" style={{ color: 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
              {t('dashboard.emptyBookings')}
            </p>
          </div>
        ) : (
          <motion.div
            className="divide-y divide-[var(--border)]"
            variants={container}
            initial="hidden"
            animate="show"
          >
            {recentBookings.map((booking) => {
              const statusColors = getStatusColor(booking.status);
              return (
                <motion.div
                  key={booking.id}
                  variants={item}
                  className="px-6 py-4 flex items-center gap-4 hover:bg-[var(--surface-hi)] transition-colors"
                >
                  <div
                    className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold"
                    style={{ background: 'var(--surface-hi)', color: 'var(--accent)' }}
                  >
                    {booking.customerName.charAt(0)}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-medium truncate" style={{ color: 'var(--text)' }}>
                      {booking.customerName}
                    </p>
                    <p className="text-sm truncate" style={{ color: 'var(--text-muted)' }}>
                      {booking.serviceTitle}
                    </p>
                  </div>

                  <div className="text-start">
                    <p className="font-mono text-sm" style={{ color: 'var(--text)' }}>
                      {booking.time}
                    </p>
                    <p className="text-xs" style={{ color: 'var(--text-dim)' }}>
                      {booking.date}
                    </p>
                  </div>

                  <div
                    className="px-3 py-1 rounded-full text-xs font-medium"
                    style={{ background: statusColors.bg, color: statusColors.text }}
                  >
                    {getStatusLabel(booking.status)}
                  </div>

                  {booking.price > 0 && (
                    <div className="font-mono font-medium" style={{ color: 'var(--accent)' }}>
                      {t('dashboard.layout.currencySar')}{booking.price}
                    </div>
                  )}
                </motion.div>
              );
            })}
          </motion.div>
        )}
      </div>
    </div>
  );
}
