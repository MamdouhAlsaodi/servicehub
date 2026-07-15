/**
 * /bookings — Customer's booking list.
 *
 * Phase 3 frontend (3.6).
 *
 * Shows the customer's bookings sorted by start time, with status
 * badges and a cancel action for upcoming bookings (>24h away).
 *
 * Why a single page (not a tabs/drawer):
 *   - Listings read top-to-bottom in Arabic RTL; chronological order
 *     is intuitive.
 *   - Cancel is contextual: only show the button when the booking is
 *     actually cancellable per the server-side rules.
 */

"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";
import type { MessageKey } from "@/i18n/messages";
interface Booking {
  id: string;
  startTime: string;
  endTime: string;
  status: "PENDING_PAYMENT" | "CONFIRMED" | "COMPLETED" | "CANCELLED" | "NO_SHOW";
  priceAtBooking: string | number;
  holdExpiresAt?: string | null;
  service?: { id: string; title: string; durationMinutes: number };
  vendor?: { id: string; businessName: string };
}

const STATUS_META: Record<
  Booking["status"],
  { labelKey: MessageKey; color: string; icon: any }
> = {
  PENDING_PAYMENT: { labelKey: "bookings.statusPendingPayment", color: "#FBBF24", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',},
  CONFIRMED: { labelKey: "bookings.statusConfirmed", color: "#34D399", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>',},
  COMPLETED: { labelKey: "bookings.statusCompleted", color: "#9B98A5", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>',},
  CANCELLED: { labelKey: "bookings.statusCancelled", color: "#EF4444", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>',},
  NO_SHOW: { labelKey: "bookings.statusNoShow", color: "#F87171", icon: '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>',},
};

function formatDateTime(iso: string, intlLocale: string): string {
  const d = new Date(iso);
  return d.toLocaleString(intlLocale, {
    weekday: "short",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Map the short Preferences locale ("ar" | "en") to a standard Intl tag. */
function intlLocaleFor(locale: "ar" | "en"): string {
  return locale === "ar" ? "ar-SA" : "en-US";
}

function hoursUntil(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 3_600_000;
}

export default function BookingsPage() {
  const router = useRouter();
  const { t, locale } = usePreferences();
  const fmtLocale = intlLocaleFor(locale);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "upcoming" | "past">("all");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${process.env.NEXT_PUBLIC_API_URL}/bookings/me`,
          { credentials: "include" },
        );
        if (res.status === 401) {
          router.push("/login?redirect=/bookings");
          return;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
        const data: Booking[] = await res.json();
        if (!cancelled) setBookings(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message || t("home.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const filtered = useMemo(() => {
    const now = Date.now();
    return bookings.filter((b) => {
      if (filter === "upcoming") {
        return new Date(b.startTime).getTime() > now && b.status !== "CANCELLED";
      }
      if (filter === "past") {
        return new Date(b.startTime).getTime() <= now || b.status === "CANCELLED";
      }
      return true;
    });
  }, [bookings, filter]);

  async function cancel(b: Booking) {
    const reason = window.prompt(
      t("bookings.cancelConfirm", {
        title: b.service?.title ?? t("bookings.bookingFallback"),
      }),
    );
    if (!reason || !reason.trim()) return;

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
      const updated: Booking = await res.json();
      setBookings((prev) => prev.map((x) => (x.id === b.id ? updated : x)));
    } catch (e: any) {
      window.alert(`${t("bookings.cancelErrorPrefix")} ${e.message}`);
    } finally {
      setCancellingId(null);
    }
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      <header
        className="sticky top-0 z-30 backdrop-blur-2xl"
        style={{
          background: "rgba(15,14,19,0.85)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <h1 className="text-lg font-bold tracking-tight">{t("bookings.title")}</h1>
          </div>
          <Link
            href="/"
            className="text-xs opacity-60 hover:opacity-100 inline-flex items-center gap-1"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg> {t("nav.home")}
          </Link>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8">
        {/* Filters */}
        <div className="flex gap-2 mb-6">
          {(["all", "upcoming", "past"] as const).map((k) => {
            const labelKeys: Record<typeof filter, MessageKey> = {
              all: "bookings.filterAll",
              upcoming: "bookings.filterUpcoming",
              past: "bookings.filterPast",
            };
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
                {t(labelKeys[k])}
              </button>
            );
          })}
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
        ) : filtered.length === 0 ? (
          <div
            className="rounded-2xl p-12 text-center"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            <h3 className="text-base font-bold mb-1">{t("bookings.emptyTitle")}</h3>
            <p className="text-xs opacity-60 mb-4">
              {t("bookings.emptySubtitle")}
            </p>
            <Link
              href="/"
              className="inline-block px-5 py-2 rounded-full text-sm font-bold"
              style={{ background: "var(--accent)", color: "var(--bg)" }}
            >
              {t("bookings.findService")}
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {filtered.map((b) => {
              const meta = STATUS_META[b.status];
              const StatusIcon = meta.icon;
              const cancellable =
                b.status === "PENDING_PAYMENT" || b.status === "CONFIRMED";
              const within24h = hoursUntil(b.startTime) < 24;
              return (
                <div
                  key={b.id}
                  className="rounded-2xl p-5 flex items-start justify-between gap-4 transition-all"
                  style={{
                    background: "var(--surface)",
                    border: `1px solid var(--border)`,
                  }}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      <span
                        className="px-2 py-0.5 rounded-full text-[10px] font-bold inline-flex items-center gap-1"
                        style={{
                          background: `${meta.color}22`,
                          color: meta.color,
                          border: `1px solid ${meta.color}55`,
                        }}
                      >
                        <span dangerouslySetInnerHTML={{ __html: meta.icon }} />
                        {t(meta.labelKey)}
                      </span>
                      {b.status === "PENDING_PAYMENT" && b.holdExpiresAt && (
                        <span className="text-[10px] opacity-50">
                          {t("bookings.holdExpires", {
                            time: new Date(b.holdExpiresAt).toLocaleTimeString(fmtLocale, {
                              hour: "2-digit",
                              minute: "2-digit",
                            }),
                          })}
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold truncate">
                      {b.service?.title ?? t("bookings.bookingFallback")}
                    </h3>
                    <p className="text-xs opacity-60 mt-1">
                      {b.vendor?.businessName ?? ""}
                    </p>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-xs opacity-70">
                      <span className="inline-flex items-center gap-1">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
                        {formatDateTime(b.startTime, fmtLocale)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                        {b.service?.durationMinutes ?? "?"} {t("vendor.minutes")}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
                        {Number(b.priceAtBooking).toFixed(2)} ر.س
                      </span>
                    </div>
                  </div>

                  {cancellable && (
                    <div className="shrink-0">
                      <button
                        onClick={() => cancel(b)}
                        disabled={within24h || cancellingId === b.id}
                        className="px-3 py-1.5 rounded-full text-xs inline-flex items-center gap-1 disabled:opacity-40"
                        style={{
                          background: "transparent",
                          border: "1px solid var(--border)",
                          color: within24h ? "var(--text-dim)" : "#EF4444",
                        }}
                        title={
                          within24h
                            ? t("bookings.cancelDisabledTitle")
                            : t("bookings.cancelActionTitle")
                        }
                      >
                        {cancellingId === b.id ? (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                        ) : (
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                        )}
                        {t("bookings.cancel")}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}