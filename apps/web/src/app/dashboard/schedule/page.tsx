'use client';

import { useState, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { apiFetch } from '@/lib/api';
import { usePreferences } from '@/contexts/PreferencesContext';

interface TimeSlot {
  id: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

interface ScheduleResponse {
  schedule: TimeSlot[];
}

const DAY_KEYS = [
  'dashboard.schedule.day.sun',
  'dashboard.schedule.day.mon',
  'dashboard.schedule.day.tue',
  'dashboard.schedule.day.wed',
  'dashboard.schedule.day.thu',
  'dashboard.schedule.day.fri',
  'dashboard.schedule.day.sat',
] as const;

const DAY_SHORT_KEYS = [
  'dashboard.schedule.dayShort.sun',
  'dashboard.schedule.dayShort.mon',
  'dashboard.schedule.dayShort.tue',
  'dashboard.schedule.dayShort.wed',
  'dashboard.schedule.dayShort.thu',
  'dashboard.schedule.dayShort.fri',
  'dashboard.schedule.dayShort.sat',
] as const;

export default function SchedulePage() {
  const { t, locale } = usePreferences();
  const [schedule, setSchedule] = useState<TimeSlot[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<{ dayOfWeek: number; hour: number } | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [slotForm, setSlotForm] = useState({ startTime: '09:00', endTime: '17:00' });
  const [saving, setSaving] = useState(false);

  const ampmSuffix = locale === 'ar' ? ' ' : ' ';
  const amLabel = t('dashboard.schedule.am');
  const pmLabel = t('dashboard.schedule.pm');

  const days = useMemo(() => DAY_KEYS.map((k) => t(k)), [t]);
  const daysShort = useMemo(() => DAY_SHORT_KEYS.map((k) => t(k)), [t]);

  const hours = useMemo(() => {
    const labels: string[] = [];
    for (let i = 0; i < 18; i++) {
      const hour = i + 6;
      const isAm = hour < 12;
      const display = hour > 12 ? hour - 12 : (hour === 12 ? 12 : hour);
      labels.push(`${display}${ampmSuffix}${isAm ? amLabel : pmLabel}`);
    }
    return labels;
  }, [ampmSuffix, amLabel, pmLabel]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<ScheduleResponse>(
          '/api/v1/availability/me/schedule',
        );
        if (cancelled) return;
        setSchedule(Array.isArray(data?.schedule) ? data.schedule : []);
      } catch (e: any) {
        if (!cancelled) setLoadError(e?.message || t('dashboard.schedule.errorLoad'));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [t]);

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
    if (!selectedSlot) return;
    setSaving(true);

    try {
      const existing = schedule.find((s) => s.dayOfWeek === selectedSlot.dayOfWeek);
      const next: TimeSlot[] = existing
        ? schedule.map((s) =>
            s.dayOfWeek === selectedSlot.dayOfWeek
              ? { ...s, startTime: slotForm.startTime, endTime: slotForm.endTime }
              : s,
          )
        : [
            ...schedule,
            {
              id: `slot-${Date.now()}`,
              dayOfWeek: selectedSlot.dayOfWeek,
              startTime: slotForm.startTime,
              endTime: slotForm.endTime,
            },
          ];

      const data = await apiFetch<ScheduleResponse>(
        '/api/v1/availability/me/schedule',
        {
          method: 'POST',
          body: JSON.stringify({
            schedule: next.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
            })),
          }),
        },
      );
      setSchedule(Array.isArray(data?.schedule) ? data.schedule : []);
    } catch (err) {
      console.error('Failed to save slot:', err);
    } finally {
      setSaving(false);
      setShowModal(false);
      setSelectedSlot(null);
    }
  };

  const handleRemoveSlot = async (dayOfWeek: number) => {
    const next = schedule.filter((s) => s.dayOfWeek !== dayOfWeek);
    try {
      const data = await apiFetch<ScheduleResponse>(
        '/api/v1/availability/me/schedule',
        {
          method: 'POST',
          body: JSON.stringify({
            schedule: next.map((s) => ({
              dayOfWeek: s.dayOfWeek,
              startTime: s.startTime,
              endTime: s.endTime,
            })),
          }),
        },
      );
      setSchedule(Array.isArray(data?.schedule) ? data.schedule : []);
    } catch (err) {
      console.error('Failed to remove slot:', err);
    } finally {
      setShowModal(false);
      setSelectedSlot(null);
    }
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
    const isAm = hour < 12;
    const displayHour = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
    return `${displayHour}:${minutes}${ampmSuffix}${isAm ? amLabel : pmLabel}`;
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
          {t('dashboard.schedule.loading')}
        </p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="glass rounded-2xl p-8 text-center" role="alert">
        <p className="text-base font-semibold mb-1" style={{ color: 'var(--text)' }}>
          {t('dashboard.schedule.errorLoad')}
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
            {t('dashboard.schedule.title')}
          </h1>
          <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
            {t('dashboard.schedule.subtitle')}
          </p>
        </div>
      </div>

      {/* Instructions */}
      <div className="glass rounded-xl p-4 flex items-center gap-6">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ background: 'var(--accent)' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dashboard.schedule.legendWorking')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 rounded" style={{ background: 'var(--surface-hi)' }} />
          <span className="text-sm" style={{ color: 'var(--text-muted)' }}>{t('dashboard.schedule.legendClosed')}</span>
        </div>
        <span className="text-sm" style={{ color: 'var(--text-dim)' }}>
          {t('dashboard.schedule.legendHint')}
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
            {t('dashboard.schedule.timeColumn')}
          </div>
          {daysShort.map((day, index) => {
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
                    {t('dashboard.schedule.closed')}
                  </p>
                )}
              </div>
            );
          })}
        </div>

        {/* Time Grid */}
        <div className="divide-y divide-[var(--border)]">
          {hours.map((hourLabel, hourIndex) => {
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
                {days.map((_, dayIndex) => {
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
            {t('dashboard.schedule.summaryTitle')}
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
            {days.map((day, index) => {
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
                    <p className="text-sm" style={{ color: 'var(--text-dim)' }}>{t('dashboard.schedule.closed')}</p>
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
                    {days[selectedSlot.dayOfWeek]}
                  </h3>
                  <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
                    {getSlotForDay(selectedSlot.dayOfWeek) ? t('dashboard.schedule.editHours') : t('dashboard.schedule.setHours')}
                  </p>
                </div>

                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1.5" style={{ color: 'var(--text-muted)' }}>
                        {t('dashboard.schedule.startLabel')}
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
                        {t('dashboard.schedule.endLabel')}
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
                        {t('dashboard.schedule.delete')}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleSaveSlot}
                      disabled={saving}
                      className="flex-1 px-4 py-2.5 rounded-xl font-medium transition-all disabled:opacity-50"
                      style={{ background: 'var(--accent)', color: 'white' }}
                    >
                      {saving ? t('dashboard.schedule.saving') : t('dashboard.schedule.save')}
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
