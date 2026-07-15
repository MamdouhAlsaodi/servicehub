/**
 * /book/[serviceId] — Public booking flow.
 *
 * Phase 3 frontend (3.8).
 *
 * Customer picks a date, sees available slots for the selected service,
 * and clicks one to create a booking. The booking goes into
 * PENDING_PAYMENT with a 5-min hold; payment happens in Phase 4.
 *
 * Layout: single full-page, no tabs. The signature top bar carries
 * the date; the slot grid is the main canvas.
 */

"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";
interface SlotResponse {
  date: string;
  slots: string[];
}

interface Service {
  id: string;
  title: string;
  price: string | number;
  durationMinutes: number;
  vendor: { id: string; businessName: string };
}

function formatTime(iso: string, intlLocale: string): string {
  return new Date(iso).toLocaleTimeString(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLongDate(iso: string, intlLocale: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/** Map the short Preferences locale ("ar" | "en") to a standard Intl tag. */
function intlLocaleFor(locale: "ar" | "en"): string {
  return locale === "ar" ? "ar-SA" : "en-US";
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function nextDays(count: number): string[] {
  const out: string[] = [];
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  for (let i = 0; i < count; i++) {
    const d = new Date(start.getTime() + i * 24 * 60 * 60_000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

export default function BookServicePage({
  params,
}: {
  params: { serviceId: string };
}) {
  const { serviceId } = params;
  const router = useRouter();
  const { t, locale } = usePreferences();
  const fmtLocale = intlLocaleFor(locale);

  const [service, setService] = useState<Service | null>(null);
  const [selectedDate, setSelectedDate] = useState<string>(todayIso());
  const [slots, setSlots] = useState<SlotResponse | null>(null);
  const [loadingService, setLoadingService] = useState(true);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [paymentId, setPaymentId] = useState<string | null>(null);
  const [success, setSuccess] = useState<{ bookingId: string } | null>(null);

  const days = useMemo(() => nextDays(14), []);

  /* Fetch the service details once. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await apiRequest(`/api/v1/services/${serviceId}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: Service = await res.json();
        if (!cancelled) setService(data);
      } catch (e: any) {
        if (!cancelled) setError(e.message || t("book.errorLoadService"));
      } finally {
        if (!cancelled) setLoadingService(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId]);

  /* Refetch slots whenever the date changes. */
  useEffect(() => {
    let cancelled = false;
    setLoadingSlots(true);
    setError(null);
    (async () => {
      try {
        const res = await apiRequest(
          `/api/v1/bookings/available-slots?serviceId=${serviceId}&date=${selectedDate}`,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data: SlotResponse = await res.json();
        if (!cancelled) setSlots(data);
      } catch (e: any) {
        if (!cancelled) {
          setError(e.message || t("book.errorLoadSlots"));
          setSlots(null);
        }
      } finally {
        if (!cancelled) setLoadingSlots(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [serviceId, selectedDate]);

  async function bookSlot(slotIso: string) {
    if (!service) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiRequest("/api/v1/bookings", {
        method: "POST",
        body: JSON.stringify({ serviceId, startTime: slotIso }),
      });
      if (res.status === 401) {
        router.push(`/login?redirect=/book/${serviceId}`);
        return;
      }
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || t("book.errorBook"));
      }
      const data = await res.json();
      setSuccess({ bookingId: data.booking.id });

      /* Best-effort: kick off a payment intent so /checkout has something
       * to display immediately. If this fails (network blip, etc.) the
       * user can still hit "ادفع الآن" later from /bookings. */
      try {
        const intentRes = await apiRequest("/api/v1/payments/intent", {
          method: "POST",
          body: JSON.stringify({ bookingId: data.booking.id }),
        });
        if (intentRes.ok) {
          const intent = await intentRes.json();
          setPaymentId(intent.paymentId);
        }
      } catch {
        /* non-fatal */
      }
    } catch (e: any) {
      setError(e.message || t("book.errorBook"));
    } finally {
      setSubmitting(false);
    }
  }

  if (loadingService) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg)" }}
      >
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin opacity-50 animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      </main>
    );
  }

  if (!service) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg)" }}
      >
        <div className="text-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-sm opacity-80">{t("book.serviceNotFound")}</p>
        </div>
      </main>
    );
  }

  if (success) {
    return (
      <main
        className="min-h-screen flex items-center justify-center px-6"
        style={{ background: "var(--bg)" }}
      >
        <div
          className="rounded-2xl p-8 text-center max-w-md"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <svg style={{ color: "#34D399" }} className="mx-auto mb-4" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>
          <h1 className="text-xl font-bold mb-2">{t("book.successTitle")}</h1>
          <p className="text-sm opacity-70 mb-6">
            {t("book.successMessage", { title: service.title })}
          </p>
          <div className="flex flex-wrap gap-2 justify-center">
            {paymentId && (
              <Link
                href={`/checkout/${paymentId}`}
                className="px-4 py-2 rounded-full text-sm font-bold inline-flex items-center gap-1"
                style={{ background: "var(--accent)", color: "var(--bg)" }}
              >
                {t("book.payNow")}
              </Link>
            )}
            <Link
              href="/bookings"
              className="px-4 py-2 rounded-full text-sm font-bold inline-flex items-center gap-1"
              style={{
                background: paymentId ? "transparent" : "var(--accent)",
                border: paymentId ? "1px solid var(--border)" : "none",
                color: paymentId ? "var(--text)" : "var(--bg)",
              }}
            >
              {t("book.viewBookings")}
            </Link>
            <Link
              href="/"
              className="px-4 py-2 rounded-full text-xs"
              style={{
                background: "transparent",
                border: "1px solid var(--border)",
              }}
            >
              {t("nav.home")}
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Top bar — date + earnings counter (signature element) */}
      <header
        className="sticky top-0 z-30 backdrop-blur-2xl"
        style={{
          background: "rgba(15,14,19,0.85)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="max-w-5xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/"
            className="text-xs opacity-60 hover:opacity-100 inline-flex items-center gap-1"
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg> {t("nav.back")}
          </Link>

          <div
            className="text-xs px-3 py-1 rounded-full inline-flex items-center gap-2"
            style={{
              background: "var(--surface-hi)",
              fontFamily: "JetBrains Mono, monospace",
              color: "var(--text)",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
            {formatLongDate(selectedDate, fmtLocale)}
          </div>

          <div
            className="text-xs px-3 py-1 rounded-full inline-flex items-center gap-1"
            style={{
              background: "var(--surface-hi)",
              fontFamily: "JetBrains Mono, monospace",
              color: "var(--accent)",
            }}
          >
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="6" x2="12" y2="22"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>
            {Number(service.price).toFixed(2)} {t("book.currencySar")}
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-6 py-8 space-y-6">
        {/* Service header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight">
            {service.title}
          </h1>
          <p className="text-xs opacity-60 mt-1">
            {service.vendor.businessName} · {service.durationMinutes} دقيقة
          </p>
        </div>

        {/* Date picker — horizontal scroll of next 14 days */}
        <div>
          <h2 className="text-xs uppercase tracking-wider opacity-50 font-bold mb-3">
            {t("book.chooseDay")}
          </h2>
          <div className="flex gap-2 overflow-x-auto pb-2">
            {days.map((d) => {
              const active = d === selectedDate;
              const dayLabel = new Date(d + "T12:00:00Z").toLocaleDateString(
                fmtLocale,
                { weekday: "short" },
              );
              const dayNum = new Date(d + "T12:00:00Z").getDate();
              return (
                <button
                  key={d}
                  onClick={() => setSelectedDate(d)}
                  className="shrink-0 w-16 py-2.5 rounded-2xl text-center transition-all"
                  style={{
                    background: active ? "var(--accent)" : "var(--surface)",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    color: active ? "var(--bg)" : "var(--text)",
                  }}
                >
                  <div className="text-[10px] opacity-70 uppercase">
                    {dayLabel}
                  </div>
                  <div
                    className="text-xl font-bold mt-1"
                    style={{
                      fontFamily: "JetBrains Mono, monospace",
                    }}
                  >
                    {dayNum}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Slots grid */}
        <div>
          <h2 className="text-xs uppercase tracking-wider opacity-50 font-bold mb-3">
            {t("book.availableSlots")}
          </h2>
          {loadingSlots ? (
            <div className="flex items-center justify-center py-16 opacity-50">
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
          ) : !slots || slots.slots.length === 0 ? (
            <div
              className="rounded-2xl p-12 text-center"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              <p className="text-sm opacity-70">
                {t("book.noSlotsToday")}
              </p>
              <p className="text-xs opacity-50 mt-1">{t("book.tryAnotherDay")}</p>
            </div>
          ) : (
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
              {slots.slots.map((iso) => (
                <button
                  key={iso}
                  onClick={() => bookSlot(iso)}
                  disabled={submitting}
                  className="py-3 rounded-2xl text-center transition-all hover:scale-105 disabled:opacity-40"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  <div className="text-base font-bold">{formatTime(iso, fmtLocale)}</div>
                  <div className="text-[10px] opacity-50 mt-0.5">
                    {service.durationMinutes} {t("book.slotMinutesShort")}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}