/**
 * /dashboard/bookings — Vendor's booking inbox.
 *
 * Phase 3 frontend (3.7).
 *
 * Vendor sees their bookings grouped by day, with the customer name,
 * service, time, and a quick-cancel for emergencies.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
interface Booking {
  id: string;
  startTime: string;
  endTime: string;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  priceAtBooking: string | number;
  service?: { id: string; title: string; durationMinutes: number };
  customer?: { id: string; name: string };
}

const STATUS_META: Record<
  Booking["status"],
  { label: string; color: string; icon: any }
> = {
  PENDING_PAYMENT: { label: "بانتظار الدفع", color: "#FBBF24", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',},
  CONFIRMED: { label: "مؤكدة", color: "#34D399", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>',},
  COMPLETED: { label: "مكتملة", color: "#9B98A5", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>',},
  CANCELLED: { label: "ملغاة", color: "#EF4444", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',},
  NO_SHOW: { label: "لم يحضر", color: "#F87171", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',},
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("ar", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("ar", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
}

function groupByDay(bookings: Booking[]): Record<string, Booking[]> {
  const groups: Record<string, Booking[]> = {};
  for (const b of bookings) {
    const key = new Date(b.startTime).toISOString().slice(0, 10);
    if (!groups[key]) groups[key] = [];
    groups[key].push(b);
  }
  /* Sort each day's bookings by time */
  for (const k of Object.keys(groups)) {
    groups[k].sort(
      (a, b) =>
        new Date(a.startTime).getTime() - new Date(b.startTime).getTime(),
    );
  }
  return groups;
}

export default function VendorBookingsPage() {
  const router = useRouter();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active">("active");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/bookings/me`,
          { credentials: "include" },
        );
        if (res.status === 401) {
          router.push("/login?redirect=/dashboard/bookings");
          return;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Booking[] = await res.json();
        if (!cancelled) setBookings(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message || "تعذر التحميل");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const visible = useMemo(() => {
    if (filter === "active") {
      return bookings.filter(
        (b) =>
          b.status === "PENDING_PAYMENT" || b.status === "CONFIRMED",
      );
    }
    return bookings;
  }, [bookings, filter]);

  const groups = useMemo(() => groupByDay(visible), [visible]);

  async function cancel(b: Booking) {
    const reason = window.prompt(
      `إلغاء حجز "${b.service?.title}" للعميل ${b.customer?.name ?? ""}؟\n\nسبب الإلغاء:`,
    );
    if (!reason?.trim()) return;
    setCancellingId(b.id);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/bookings/${b.id}/cancel`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `HTTP ${res.status}`);
      }
      const updated: Booking = await res.json();
      setBookings((prev) => prev.map((x) => (x.id === b.id ? updated : x)));
    } catch (e: any) {
      window.alert(`تعذر الإلغاء: ${e.message}`);
    } finally {
      setCancellingId(null);
    }
  }

  /* Counts for the filter pills */
  const activeCount = bookings.filter(
    (b) => b.status === "PENDING_PAYMENT" || b.status === "CONFIRMED",
  ).length;
  const cancelledCount = bookings.filter(
    (b) => b.status === "CANCELLED",
  ).length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">الحجوزات</h1>
          <p className="text-xs opacity-60 mt-1">
            {activeCount} نشطة · {cancelledCount} ملغاة
          </p>
        </div>
        <div className="flex gap-2">
          {(["active", "all"] as const).map((k) => {
            const labels = { active: "النشطة", all: "الكل" };
            const active = filter === k;
            return (
              <button
                key={k}
                onClick={() => setFilter(k)}
                className="px-4 py-1.5 rounded-full text-xs font-semibold transition-all"
                style={{
                  background: active ? "var(--accent)" : "var(--surface)",
                  color: active ? "var(--bg)" : "var(--text-muted)",
                  border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                }}
              >
                {labels[k]}
              </button>
            );
          })}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center py-20 opacity-50">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
        </div>
      ) : error ? (
        <div
          className="rounded-2xl p-6 text-center"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-sm opacity-80">{error}</p>
        </div>
      ) : Object.keys(groups).length === 0 ? (
        <div
          className="rounded-2xl p-12 text-center"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
          <h3 className="text-base font-bold mb-1">لا توجد حجوزات</h3>
          <p className="text-xs opacity-60">
            ستظهر هنا حجوزات العملاء عند وصولها
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groups).map(([dayKey, items]) => (
            <div key={dayKey}>
              <div className="flex items-center gap-2 mb-3 px-1">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                <h2 className="text-xs uppercase tracking-wider opacity-50 font-bold">
                  {formatDay(items[0].startTime)}
                </h2>
                <span className="text-xs opacity-40">
                  · {items.length} حجز
                </span>
              </div>

              <div className="space-y-2">
                {items.map((b) => {
                  const meta = STATUS_META[b.status];
                  const StatusIcon = meta.icon;
                  const isCancellable =
                    b.status === "PENDING_PAYMENT" ||
                    b.status === "CONFIRMED";
                  return (
                    <div
                      key={b.id}
                      className="rounded-2xl p-4 flex items-center gap-4"
                      style={{
                        background: "var(--surface)",
                        border: `1px solid var(--border)`,
                      }}
                    >
                      {/* Time block */}
                      <div className="shrink-0 text-center w-16">
                        <div
                          className="text-2xl font-bold leading-none"
                          style={{
                            color: "var(--accent)",
                            fontFamily:
                              "JetBrains Mono, monospace",
                          }}
                        >
                          {formatTime(b.startTime)}
                        </div>
                        <div className="text-[10px] opacity-50 mt-1">
                          {b.service?.durationMinutes ?? "?"} د
                        </div>
                      </div>

                      {/* Body */}
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <span
                            className="px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1"
                            style={{
                              background: `${meta.color}22`,
                              color: meta.color,
                              border: `1px solid ${meta.color}55`,
                            }}
                          >
                            <span dangerouslySetInnerHTML={{ __html: meta.icon }} />
                            {meta.label}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold truncate">
                          {b.service?.title ?? "خدمة"}
                        </h3>
                        <div className="flex items-center gap-3 mt-1.5 text-xs opacity-60">
                          <span className="inline-flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            {b.customer?.name ?? "—"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                            {Number(b.priceAtBooking).toFixed(2)} ر.س
                          </span>
                        </div>
                      </div>

                      {isCancellable && (
                        <button
                          onClick={() => cancel(b)}
                          disabled={cancellingId === b.id}
                          className="shrink-0 px-3 py-1.5 rounded-full text-xs inline-flex items-center gap-1 disabled:opacity-40"
                          style={{
                            background: "transparent",
                            border: "1px solid var(--border)",
                            color: "#EF4444",
                          }}
                        >
                          {cancellingId === b.id ? (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                          ) : (
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                          )}
                          إلغاء
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}