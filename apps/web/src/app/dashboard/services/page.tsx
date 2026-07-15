'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch, apiRequest } from '@/lib/api';
import { usePreferences } from '@/contexts/PreferencesContext';

interface Service {
  id: string;
  title: string;
  description?: string | null;
  price: number | string;
  durationMinutes: number;
  categoryId: string;
  category?: { id: string; nameAr: string; nameEn: string; icon?: string | null };
  isActive: boolean;
  createdAt: string;
}

interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
  icon?: string | null;
}

interface ServicesListResponse {
  data: Service[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

interface ServiceFormData {
  title: string;
  description: string;
  price: string;
  durationMinutes: string;
  categoryId: string;
}

const initialFormData: ServiceFormData = {
  title: '',
  description: '',
  price: '',
  durationMinutes: '',
  categoryId: '',
};

export default function ServicesPage() {
  const { t, locale } = usePreferences();
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formData, setFormData] = useState<ServiceFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [vendorId, setVendorId] = useState<string | null>(null);

  const fetchServices = async (vid: string) => {
    const list = await apiFetch<ServicesListResponse>(
      `/api/v1/services?vendorId=${encodeURIComponent(vid)}&limit=100`,
    );
    setServices(Array.isArray(list?.data) ? list.data : []);
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const me = await apiFetch<{ vendorProfile?: { id?: string } | null }>(
          '/api/v1/auth/me',
        );
        const vid = me?.vendorProfile?.id ?? null;
        if (!vid) {
          if (!cancelled) {
            setLoadError(t('dashboard.services.errorLoadFallback'));
            setLoading(false);
          }
          return;
        }
        const cats = await apiFetch<Category[]>('/api/v1/categories');
        if (cancelled) return;
        setVendorId(vid);
        setCategories(Array.isArray(cats) ? cats : []);
        await fetchServices(vid);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || t('dashboard.services.errorLoadServices'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

  const reload = async () => {
    if (!vendorId) return;
    try {
      await fetchServices(vendorId);
    } catch (e) {
      console.error('Failed to reload services:', e);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const payload = {
        title: formData.title,
        description: formData.description || undefined,
        price: parseFloat(formData.price),
        durationMinutes: parseInt(formData.durationMinutes),
        categoryId: formData.categoryId,
      };

      if (editingService) {
        await apiFetch(`/api/v1/services/${editingService.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        });
      } else {
        await apiFetch('/api/v1/services', {
          method: 'POST',
          body: JSON.stringify(payload),
        });
      }

      await reload();
      setShowModal(false);
      setEditingService(null);
      setFormData(initialFormData);
    } catch (err: any) {
      setError(err?.message || t('dashboard.services.errorSave'));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (service: Service) => {
    setEditingService(service);
    setFormData({
      title: service.title,
      description: service.description || '',
      price: service.price.toString(),
      durationMinutes: service.durationMinutes.toString(),
      categoryId: service.categoryId,
    });
    setShowModal(true);
  };

  const handleDelete = async (serviceId: string) => {
    if (!confirm(t('dashboard.services.deleteConfirm'))) return;

    try {
      await apiRequest(`/api/v1/services/${serviceId}`, {
        method: 'DELETE',
      });
      await reload();
    } catch (e: any) {
      alert(e?.message || t('dashboard.services.deleteErrorFallback'));
    }
  };

  const openAddModal = () => {
    setEditingService(null);
    setFormData(initialFormData);
    setError('');
    setShowModal(true);
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
          {t('dashboard.services.loadingServices')}
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="glass rounded-2xl p-8 text-center" role="alert">
        <p className="text-base font-semibold mb-1" style={{ color: 'var(--text)' }}>
          {t('dashboard.services.errorLoadServices')}
        </p>
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>{loadError}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold" style={{ color: 'var(--text)' }}>
            {t('dashboard.services.title')}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('dashboard.services.subtitle')}
          </p>
        </div>
        <button
          onClick={openAddModal}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all hover:shadow-lg"
          style={{ background: 'var(--accent)', color: 'white' }}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          {t('dashboard.services.addCta')}
        </button>
      </div>

      {/* Services Table */}
      {services.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <svg className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>
            {t('dashboard.services.emptyTitle')}
          </h3>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            {t('dashboard.services.emptySubtitle')}
          </p>
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            {t('dashboard.services.addFirstCta')}
          </button>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]" style={{ background: 'var(--surface-hi)' }}>
                <th className="text-start text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  {t('dashboard.services.table.service')}
                </th>
                <th className="text-start text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  {t('dashboard.services.table.category')}
                </th>
                <th className="text-start text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  {t('dashboard.services.table.duration')}
                </th>
                <th className="text-start text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  {t('dashboard.services.table.price')}
                </th>
                <th className="text-start text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  {t('dashboard.services.table.status')}
                </th>
                <th className="text-start text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  {t('dashboard.services.table.actions')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {services.map((service, index) => (
                <motion.tr
                  key={service.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.05 }}
                  className="hover:bg-[var(--surface-hi)] transition-colors"
                >
                  <td className="px-6 py-4">
                    <div>
                      <p className="font-medium" style={{ color: 'var(--text)' }}>
                        {service.title}
                      </p>
                      {service.description && (
                        <p className="text-sm truncate max-w-xs" style={{ color: 'var(--text-dim)' }}>
                          {service.description}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium"
                      style={{ background: 'var(--surface-hi)', color: 'var(--text-muted)' }}
                    >
                      {service.category?.icon && <span>{service.category.icon}</span>}
                      {service.category
                        ? (locale === 'ar' ? service.category.nameAr : service.category.nameEn)
                        : t('dashboard.services.categoryFallback')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>
                      {t('dashboard.services.durationMinutes', { n: service.durationMinutes })}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono font-medium" style={{ color: 'var(--accent)' }}>
                      {t('dashboard.layout.currencySar')}{service.price}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span
                      className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium"
                      style={{
                        background: service.isActive ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
                        color: service.isActive ? '#22c55e' : '#ef4444'
                      }}
                    >
                      {service.isActive ? t('dashboard.services.status.active') : t('dashboard.services.status.inactive')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleEdit(service)}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-hi)]"
                        style={{ color: 'var(--text-muted)' }}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                        </svg>
                      </button>
                      <button
                        onClick={() => handleDelete(service.id)}
                        className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-hi)]"
                        style={{ color: '#ef4444' }}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add/Edit Modal */}
      <AnimatePresence>
        {showModal && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={() => setShowModal(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div
                className="w-full max-w-lg rounded-2xl p-6 pointer-events-auto"
                style={{ background: 'var(--surface)' }}
              >
                <div className="flex items-center justify-between mb-6">
                  <h2 className="text-xl font-display font-bold" style={{ color: 'var(--text)' }}>
                    {editingService ? t('dashboard.services.modal.editTitle') : t('dashboard.services.modal.addTitle')}
                  </h2>
                  <button
                    onClick={() => setShowModal(false)}
                    className="p-2 rounded-lg transition-colors hover:bg-[var(--surface-hi)]"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {error && (
                  <div className="mb-4 p-3 rounded-lg text-sm" style={{ background: 'rgba(239, 68, 68, 0.15)', color: '#ef4444' }}>
                    {error}
                  </div>
                )}

                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      {t('dashboard.services.field.title')}
                    </label>
                    <input
                      type="text"
                      required
                      value={formData.title}
                      onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl outline-none transition-colors"
                      style={{
                        background: 'var(--surface-hi)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)'
                      }}
                      placeholder={t('dashboard.services.field.titlePlaceholder')}
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      {t('dashboard.services.field.description')}
                    </label>
                    <textarea
                      value={formData.description}
                      onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                      rows={3}
                      className="w-full px-4 py-2.5 rounded-xl outline-none transition-colors resize-none"
                      style={{
                        background: 'var(--surface-hi)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)'
                      }}
                      placeholder={t('dashboard.services.field.descriptionPlaceholder')}
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        {t('dashboard.services.field.price')}
                      </label>
                      <input
                        type="number"
                        required
                        min="0"
                        step="0.01"
                        value={formData.price}
                        onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl outline-none transition-colors font-mono"
                        style={{
                          background: 'var(--surface-hi)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)'
                        }}
                        placeholder="0.00"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        {t('dashboard.services.field.duration')}
                      </label>
                      <input
                        type="number"
                        required
                        min="1"
                        value={formData.durationMinutes}
                        onChange={(e) => setFormData({ ...formData, durationMinutes: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl outline-none transition-colors font-mono"
                        style={{
                          background: 'var(--surface-hi)',
                          border: '1px solid var(--border)',
                          color: 'var(--text)'
                        }}
                        placeholder="30"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      {t('dashboard.services.field.category')}
                    </label>
                    <select
                      required
                      value={formData.categoryId}
                      onChange={(e) => setFormData({ ...formData, categoryId: e.target.value })}
                      className="w-full px-4 py-2.5 rounded-xl outline-none transition-colors"
                      style={{
                        background: 'var(--surface-hi)',
                        border: '1px solid var(--border)',
                        color: 'var(--text)'
                      }}
                    >
                      <option value="">{t('dashboard.services.field.categoryPlaceholder')}</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.icon && `${cat.icon} `}{locale === 'ar' ? cat.nameAr : cat.nameEn}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center gap-3 pt-4">
                    <button
                      type="button"
                      onClick={() => setShowModal(false)}
                      className="flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors"
                      style={{
                        background: 'var(--surface-hi)',
                        color: 'var(--text-muted)'
                      }}
                    >
                      {t('dashboard.services.cancel')}
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'white' }}
                    >
                      {saving ? t('dashboard.services.saving') : (editingService ? t('dashboard.services.editSubmit') : t('dashboard.services.addSubmit'))}
                    </button>
                  </div>
                </form>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
