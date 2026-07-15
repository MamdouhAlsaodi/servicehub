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
import { apiRequest } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";

interface Booking {
  id: string;
  startTime: string;
  endTime: string;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  priceAtBooking: string | number;
  service?: { id?: string; title: string; durationMinutes: number };
  customer?: { id?: string; name: string };
}

type StatusMeta = { color: string; icon: string };
const STATUS_COLORS: Record<Booking["status"], StatusMeta> = {
  PENDING_PAYMENT: { color: "#FBBF24", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>' },
  CONFIRMED: { color: "#34D399", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>' },
  COMPLETED: { color: "#9B98A5", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>' },
  CANCELLED: { color: "#EF4444", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>' },
  NO_SHOW: { color: "#F87171", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>' },
};

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
  const { t, locale } = usePreferences();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "active">("active");

  const intlLocale = locale === "ar" ? "ar-SA" : "en-US";

  const formatTime = (iso: string): string =>
    new Date(iso).toLocaleTimeString(intlLocale, {
      hour: "2-digit",
      minute: "2-digit",
    });

  const formatDay = (iso: string): string =>
    new Date(iso).toLocaleDateString(intlLocale, {
      weekday: "long",
      day: "numeric",
      month: "long",
    });

  const statusLabel = (status: Booking["status"]): string => {
    switch (status) {
      case "PENDING_PAYMENT": return t("bookings.statusPendingPayment");
      case "CONFIRMED": return t("bookings.statusConfirmed");
      case "COMPLETED": return t("bookings.statusCompleted");
      case "CANCELLED": return t("bookings.statusCancelled");
      case "NO_SHOW": return t("bookings.statusNoShow");
    }
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest("/api/v1/bookings/me");
        if (res.status === 401) {
          router.push("/login?redirect=/dashboard/bookings");
          return;
        }
        if (!res.ok) {
          let msg = `HTTP ${res.status}`;
          try {
            const j = await res.json();
            if (j?.message) msg = j.message;
          } catch {
            /* response body wasn't JSON */
          }
          throw new Error(msg);
        }
        const data: Booking[] = await res.json();
        if (!cancelled) setBookings(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message || t("dashboard.bookings.errorLoad"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, t]);

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
      t("dashboard.bookings.cancelPrompt", {
        title: b.service?.title ?? "",
        customer: b.customer?.name ?? "",
      }),
    );
    if (!reason?.trim()) return;
    setCancellingId(b.id);
    try {
      const res = await apiRequest(`/api/v1/bookings/${b.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `HTTP ${res.status}`);
      }
      const updated = await res.json();
      setBookings((prev) =>
        prev.map((x) =>
          x.id === b.id
            ? {
                ...x,
                status: updated.status ?? "CANCELLED",
                cancellationReason: updated.cancellationReason ?? reason.trim(),
              }
            : x,
        ),
      );
    } catch (e: any) {
      window.alert(`${t("dashboard.bookings.cancelErrorPrefix")} ${e.message}`);
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

  const filterLabels: Record<"active" | "all", string> = {
    active: t("dashboard.bookings.filter.active"),
    all: t("dashboard.bookings.filter.all"),
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{t("dashboard.bookings.title")}</h1>
          <p className="text-xs opacity-60 mt-1">
            {t("dashboard.bookings.countSummary", { active: activeCount, cancelled: cancelledCount })}
          </p>
        </div>
        <div className="flex gap-2">
          {(["active", "all"] as const).map((k) => {
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
                {filterLabels[k]}
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
          <h3 className="text-base font-bold mb-1">{t("dashboard.bookings.emptyTitle")}</h3>
          <p className="text-xs opacity-60">
            {t("dashboard.bookings.emptySubtitle")}
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
                  · {t("dashboard.bookings.dayCount", { n: items.length })}
                </span>
              </div>

              <div className="space-y-2">
                {items.map((b) => {
                  const meta = STATUS_COLORS[b.status];
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
                          {b.service?.durationMinutes ?? "?"} {t("dashboard.bookings.minutesShort")}
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
                            {statusLabel(b.status)}
                          </span>
                        </div>
                        <h3 className="text-sm font-bold truncate">
                          {b.service?.title ?? t("dashboard.bookings.serviceFallback")}
                        </h3>
                        <div className="flex items-center gap-3 mt-1.5 text-xs opacity-60">
                          <span className="inline-flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
                            {b.customer?.name ?? "—"}
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                            {Number(b.priceAtBooking).toFixed(2)} {t("dashboard.layout.currencySar").trim()}
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
                          {t("dashboard.bookings.cancel")}
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