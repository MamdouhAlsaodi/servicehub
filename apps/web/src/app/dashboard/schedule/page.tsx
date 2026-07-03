'use client';

import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '@/lib/api';

interface TimeSlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface Exception {
  id: string;
  date: string;
  isHoliday: boolean;
}

const DAYS_AR = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const DAYS_SHORT_AR = ['أحد', 'إثنين', 'ثلاث', 'أرب', 'خميس', 'جمعة', 'سبت'];

// Generate hour labels (6 AM to 11 PM)
const HOURS = Array.from({ length: 18 }, (_, i) => {
  const hour = i + 6;
  return hour > 12 ? `${hour - 12} م` : (hour === 12 ? '12 م' : `${hour} ص`);
});

export default function SchedulePage() {
  const [schedule, setSchedule] = useState<TimeSlot[]>([]);
  const [exceptions, setExceptions] = useState<Exception[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedSlot, setSelectedSlot] = useState<{ dayOfWeek: number; hour: number } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [slotForm, setSlotForm] = useState({ startTime: '09:00', endTime: '17:00' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Load from localStorage as mock API
    const stored = localStorage.getItem('vendor_schedule');
    if (stored) {
      const data = JSON.parse(stored);
      setSchedule(data.schedule || []);
      setExceptions(data.exceptions || []);
    }
    setLoading(false);
  }, []);

  const handleSlotClick = (dayOfWeek: number, hour: number) => {
    // Check if there's already a slot for this day
    const existingSlot = schedule.find(s => s.dayOfWeek === dayOfWeek);
    
    if (existingSlot) {
      // Toggle selection
      if (selectedSlot?.dayOfWeek === dayOfWeek) {
        setSelectedSlot(null);
      } else {
        setSelectedSlot({ dayOfWeek, hour });
        setSlotForm({ 
          startTime: existingSlot.startTime, 
          endTime: existingSlot.endTime 
        });
        setShowModal(true);
      }
    } else {
      // New slot
      setSelectedSlot({ dayOfWeek, hour });
      setSlotForm({ startTime: '09:00', endTime: '17:00' });
      setShowModal(true);
    }
  };

  const getSlotForDay = (dayOfWeek: number) => {
    return schedule.find(s => s.dayOfWeek === dayOfWeek);
  };

  const handleSaveSlot = async () => {
    setSaving(true);
    
    try {
      let updated: TimeSlot[];
      
      if (selectedSlot) {
        const existing = schedule.find(s => s.dayOfWeek === selectedSlot.dayOfWeek);
        if (existing) {
          updated = schedule.map(s => 
            s.dayOfWeek === selectedSlot.dayOfWeek 
              ? { ...s, startTime: slotForm.startTime, endTime: slotForm.endTime }
              : s
          );
        } else {
          updated = [
            ...schedule,
            {
              id: `slot-${Date.now()}`,
              dayOfWeek: selectedSlot.dayOfWeek,
              startTime: slotForm.startTime,
              endTime: slotForm.endTime,
            }
          ];
        }
        
        setSchedule(updated);
        localStorage.setItem('vendor_schedule', JSON.stringify({ 
          schedule: updated, 
          exceptions 
        }));
      }
    } catch (err) {
      console.error('Failed to save slot:', err);
    } finally {
      setSaving(false);
      setShowModal(false);
      setSelectedSlot(null);
    }
  };

  const handleRemoveSlot = async (dayOfWeek: number) => {
    const updated = schedule.filter(s => s.dayOfWeek !== dayOfWeek);
    setSchedule(updated);
    localStorage.setItem('vendor_schedule', JSON.stringify({ 
      schedule: updated, 
      exceptions 
    }));
    setShowModal(false);
    setSelectedSlot(null);
  };

  const isHourInRange = (dayOfWeek: number, hour: number) => {
    const slot = getSlotForDay(dayOfWeek);
    if (!slot) return false;
    
    const [startHour] = slot.startTime.split(':').map(Number);
    const [endHour] = slot.endTime.split(':').map(Number);
    
    return hour >= startHour && hour < endHour;
  };

  const formatTime = (time: string) => {
    const [hours, minutes] = time.split(':');
    const hour = parseInt(hours);
    const ampm = hour >= 12 ? 'م' : 'ص';
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return `${displayHour}:${minutes} ${ampm}`;
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
            الجدول الأسبوعي
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            حدد ساعات عملك لكل يوم
          </p>
        </div>
      </div>

      {/* Instructions */}
      <div className="glass rounded-xl p-4 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ background: 'var(--accent)' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>ساعات العمل</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ background: 'var(--surface-hi)' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>غير متاح</span>
        </div>
        <span className="text-sm" style={{ color: 'var(--text-dim)' }}>
          | انقر على أي يوم لتعيين أو تعديل ساعات العمل
        </span>
      </div>

      {/* Custom 7-Column Week Grid */}
      <div className="glass rounded-2xl overflow-hidden">
        {/* Day Headers */}
        <div 
          className="grid grid-cols-7 border-b border-[var(--border)]"
          style={{ background: 'var(--surface-hi)' }}
        >
          {/* Time column header */}
          <div className="p-4 text-center text-sm font-medium" style={{ color: 'var(--text-dim)' }}>
            الوقت
          </div>
          {DAYS_SHORT_AR.map((day, index) => {
            const slot = getSlotForDay(index);
            return (
              <div 
                key={index}
                className="p-4 text-center border-r border-[var(--border)] last:border-r-0"
              >
                <p className="text-sm font-medium" style={{ color: 'var(--text)' }}>
                  {day}
                </p>
                {slot ? (
                  <p className="text-xs font-mono mt-1" style={{ color: 'var(--accent)' }}>
                    {formatTime(slot.startTime)} - {formatTime(slot.endTime)}
                  </p>
                ) : (
                  <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                    مغلق
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Time Grid */}
        <div className="divide-y divide-[var(--border)]">
          {HOURS.map((hourLabel, hourIndex) => {
            const actualHour = hourIndex + 6;
            
            return (
              <div 
                key={hourIndex}
                className="grid grid-cols-7 min-h-[48px]"
              >
                {/* Time label */}
                <div className="p-2 text-center text-xs font-mono flex items-center justify-center" style={{ color: 'var(--text-dim)' }}>
                  {hourLabel}
                </div>
                
                {/* Day cells */}
                {DAYS_AR.map((_, dayIndex) => {
                  const slot = getSlotForDay(dayIndex);
                  const isInRange = isHourInRange(dayIndex, actualHour);
                  const isStart = slot && slot.startTime === `${actualHour.toString().padStart(2, '0')}:00`;
                  
                  return (
                    <div
                      key={dayIndex}
                      onClick={() => handleSlotClick(dayIndex, actualHour)}
                      className={`border-r border-[var(--border)] last:border-r-0 relative transition-all cursor-pointer hover:opacity-80 ${
                        isStart ? 'rounded-t-lg' : ''
                      } ${isInRange ? 'rounded-b-lg' : ''}`}
                      style={{
                        background: isInRange ? 'var(--accent)' : 'transparent',
                      }}
                    >
                      {isStart && slot && (
                        <div 
                          className="absolute inset-0 rounded-lg flex items-center justify-center z-10"
                          style={{ background: 'var(--accent)' }}
                        >
                          <span className="text-xs font-medium text-white truncate px-1">
                            {formatTime(slot.startTime)} - {formatTime(slot.endTime)}
                          </span>
                        </div>
                      )}
                      {isStart && (
                        <div className="h-3" /> // Spacer for text
                      )}
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>

      {/* Schedule Summary */}
      {schedule.length > 0 && (
        <div className="glass rounded-2xl p-6">
          <h3 className="text-lg font-display font-semibold mb-4" style={{ color: 'var(--text)' }}>
            ملخص الأسبوع
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {DAYS_AR.map((day, index) => {
              const slot = getSlotForDay(index);
              return (
                <div 
                  key={index}
                  className="p-3 rounded-xl text-center"
                  style={{ background: 'var(--surface-hi)' }}
                >
                  <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>{day}</p>
                  {slot ? (
                    <p className="font-mono text-sm font-medium" style={{ color: 'var(--accent)' }}>
                      {slot.startTime} - {slot.endTime}
                    </p>
                  ) : (
                    <p className="text-sm" style={{ color: 'var(--text-dim)' }}>مغلق</p>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Add/Edit Slot Modal */}
      <AnimatePresence>
        {showModal && selectedSlot && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
              onClick={() => { setShowModal(false); setSelectedSlot(null); }}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            >
              <div 
                className="w-full max-w-sm rounded-2xl p-6 pointer-events-auto"
                style={{ background: 'var(--surface)' }}
              >
                <div className="text-center mb-6">
                  <div 
                    className="w-12 h-12 rounded-xl mx-auto mb-3 flex items-center justify-center"
                    style={{ background: 'var(--accent)' }}
                  >
                    <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                  </div>
                  <h3 className="text-xl font-display font-bold" style={{ color: 'var(--text)' }}>
                    {DAYS_AR[selectedSlot.dayOfWeek]}
                  </h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                    {getSlotForDay(selectedSlot.dayOfWeek) ? 'تعديل ساعات العمل' : 'تعيين ساعات العمل'}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        من
                      </label>
                      <input
                        type="time"
                        value={slotForm.startTime}
                        onChange={(e) => setSlotForm({ ...slotForm, startTime: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl outline-none transition-colors font-mono"
                        style={{ 
                          background: 'var(--surface-hi)', 
                          border: '1px solid var(--border)',
                          color: 'var(--text)'
                        }}
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        إلى
                      </label>
                      <input
                        type="time"
                        value={slotForm.endTime}
                        onChange={(e) => setSlotForm({ ...slotForm, endTime: e.target.value })}
                        className="w-full px-4 py-2.5 rounded-xl outline-none transition-colors font-mono"
                        style={{ 
                          background: 'var(--surface-hi)', 
                          border: '1px solid var(--border)',
                          color: 'var(--text)'
                        }}
                      />
                    </div>
                  </div>

                  <div className="flex items-center gap-3 pt-2">
                    {getSlotForDay(selectedSlot.dayOfWeek) && (
                      <button
                        type="button"
                        onClick={() => handleRemoveSlot(selectedSlot.dayOfWeek)}
                        className="flex-1 px-4 py-2.5 rounded-xl font-medium transition-colors"
                        style={{ 
                          background: 'rgba(239, 68, 68, 0.15)', 
                          color: '#ef4444'
                        }}
                      >
                        حذف
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveSlot}
                      disabled={saving}
                      className="flex-1 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'white' }}
                    >
                      {saving ? 'جاري...' : 'حفظ'}
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
}
