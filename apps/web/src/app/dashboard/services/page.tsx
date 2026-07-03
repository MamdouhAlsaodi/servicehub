'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '@/lib/api';

interface Service {
  id: string;
  title: string;
  description?: string;
  price: number;
  durationMinutes: number;
  categoryId: string;
  category?: { id: string; nameAr: string; nameEn: string; icon?: string };
  isActive: boolean;
  createdAt: string;
}

interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
  icon?: string;
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
  const [services, setServices] = useState<Service[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingService, setEditingService] = useState<Service | null>(null);
  const [formData, setFormData] = useState<ServiceFormData>(initialFormData);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetchServices();
    fetchCategories();
  }, []);

  const fetchServices = async () => {
    try {
      // For now, using localStorage as mock API
      // In production: const data = await apiFetch('/api/v1/services/my');
      const stored = localStorage.getItem('vendor_services');
      setServices(stored ? JSON.parse(stored) : []);
    } catch (err: any) {
      console.error('Failed to fetch services:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const data = await apiFetch<Category[]>('/api/v1/categories');
      setCategories(data);
    } catch (err: any) {
      console.error('Failed to fetch categories:', err);
      // Fallback categories
      setCategories([
        { id: 'cat-salon', nameAr: 'صالون', nameEn: 'Salon' },
        { id: 'cat-fitness', nameAr: 'لياقة', nameEn: 'Fitness' },
        { id: 'cat-spa', nameAr: 'سبا', nameEn: 'Spa' },
      ]);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const serviceData = {
        ...formData,
        price: parseFloat(formData.price),
        durationMinutes: parseInt(formData.durationMinutes),
      };

      if (editingService) {
        // Update existing
        const updated = services.map(s => 
          s.id === editingService.id 
            ? { ...s, ...serviceData, category: categories.find(c => c.id === serviceData.categoryId) }
            : s
        );
        setServices(updated);
        localStorage.setItem('vendor_services', JSON.stringify(updated));
      } else {
        // Create new
        const newService: Service = {
          id: `svc-${Date.now()}`,
          ...serviceData,
          isActive: true,
          createdAt: new Date().toISOString(),
          category: categories.find(c => c.id === serviceData.categoryId),
        };
        const updated = [newService, ...services];
        setServices(updated);
        localStorage.setItem('vendor_services', JSON.stringify(updated));
      }

      setShowModal(false);
      setEditingService(null);
      setFormData(initialFormData);
    } catch (err: any) {
      setError(err.message || 'حدث خطأ أثناء الحفظ');
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
    if (!confirm('هل أنت متأكد من حذف هذه الخدمة؟')) return;
    
    const updated = services.map(s => 
      s.id === serviceId ? { ...s, isActive: false } : s
    ).filter(s => s.isActive);
    setServices(updated);
    localStorage.setItem('vendor_services', JSON.stringify(updated));
  };

  const openAddModal = () => {
    setEditingService(null);
    setFormData(initialFormData);
    setError('');
    setShowModal(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-[var(--border)] border-t-[var(--accent)] rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold" style={{ color: 'var(--text)' }}>
            خدماتي
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            إدارة وعرض الخدمات التي تقدمها
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
          إضافة خدمة
        </button>
      </div>

      {/* Services Table */}
      {services.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <svg className="w-16 h-16 mx-auto mb-4" style={{ color: 'var(--text-dim)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
          </svg>
          <h3 className="text-lg font-semibold mb-2" style={{ color: 'var(--text)' }}>
            لا توجد خدمات
          </h3>
          <p className="text-sm mb-6" style={{ color: 'var(--text-muted)' }}>
            ابدأ بإضافة خدماتك الأولى لجذب العملاء
          </p>
          <button
            onClick={openAddModal}
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl font-medium transition-all"
            style={{ background: 'var(--accent)', color: 'white' }}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
            </svg>
            إضافة الخدمة الأولى
          </button>
        </div>
      ) : (
        <div className="glass rounded-2xl overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="border-b border-[var(--border)]" style={{ background: 'var(--surface-hi)' }}>
                <th className="text-right text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  الخدمة
                </th>
                <th className="text-right text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  الفئة
                </th>
                <th className="text-right text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  المدة
                </th>
                <th className="text-right text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  السعر
                </th>
                <th className="text-right text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  الحالة
                </th>
                <th className="text-right text-sm font-medium px-6 py-4" style={{ color: 'var(--text-muted)' }}>
                  إجراءات
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
                      {service.category?.nameAr || 'غير محدد'}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono text-sm" style={{ color: 'var(--text-muted)' }}>
                      {service.durationMinutes} دقيقة
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <span className="font-mono font-medium" style={{ color: 'var(--accent)' }}>
                      ر.س {service.price}
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
                      {service.isActive ? 'نشط' : 'غير نشط'}
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
                    {editingService ? 'تعديل الخدمة' : 'إضافة خدمة جديدة'}
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
                      اسم الخدمة *
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
                      placeholder="مثال: قص شعر رجالي"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                      الوصف
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
                      placeholder="وصف مختصر للخدمة..."
                    />
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        السعر (ر.س) *
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
                        المدة (دقيقة) *
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
                      الفئة *
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
                      <option value="">اختر الفئة</option>
                      {categories.map((cat) => (
                        <option key={cat.id} value={cat.id}>
                          {cat.icon && `${cat.icon} `}{cat.nameAr}
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
                      إلغاء
                    </button>
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex-1 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'white' }}
                    >
                      {saving ? 'جاري الحفظ...' : (editingService ? 'حفظ التغييرات' : 'إضافة الخدمة')}
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
