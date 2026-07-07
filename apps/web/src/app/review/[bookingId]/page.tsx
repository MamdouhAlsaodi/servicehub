/**
 * /review/[bookingId] — Customer review submission screen.
 *
 * Phase 5 frontend (5.4).
 *
 * Five-star tap rating + comment textarea. Submit calls
 * POST /reviews. After success we route to /bookings with the new
 * review visible inline (the list page refetches on focus).
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
interface Booking {
  id: string;
  status: string;
  service?: { title: string };
  vendor?: { businessName: string };
}

const STAR_VALUES = [1, 2, 3, 4, 5] as const;
const STAR_LABELS: Record<number, string> = {
  1: "سيئ",
  2: "مقبول",
  3: "جيد",
  4: "ممتاز",
  5: "استثنائي",
};

export default function ReviewPage({
  params,
}: {
  params: { bookingId: string };
}) {
  const { bookingId } = params;
  const router = useRouter();

  const [booking, setBooking] = useState<Booking | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rating, setRating] = useState<number>(0);
  const [hover, setHover] = useState<number>(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const fetchBooking = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/bookings/${bookingId}`,
        { credentials: "include" },
      );
      if (res.status === 401) {
        router.push(`/login?redirect=/review/${bookingId}`);
        return;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const data: Booking = await res.json();
      setBooking(data);
      if (data.status !== "CONFIRMED") {
        setError(
          `يمكن التقييم فقط بعد تأكيد الحجز (الحالة الحالية: ${data.status})`,
        );
      }
    } catch (e: any) {
      setError(e.message || "تعذر التحميل");
    } finally {
      setLoading(false);
    }
  }, [bookingId, router]);

  useEffect(() => {
    fetchBooking();
  }, [fetchBooking]);

  async function submit() {
    if (!rating) {
      setError("اختر تقييمًا قبل الإرسال");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/reviews`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bookingId,
            rating,
            comment: comment.trim() || undefined,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `HTTP ${res.status}`);
      }
      setSuccess(true);
      setTimeout(() => router.push("/bookings"), 1200);
    } catch (e: any) {
      setError(e.message || "تعذر الإرسال");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      </main>
    );
  }

  if (success) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg)" }}>
        <div
          className="rounded-2xl p-8 text-center max-w-md"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: "#34D399" }}><circle cx="12" cy="12" r="10"/><polyline points="9 12 12 15 16 10"/></svg>
          <h1 className="text-xl font-bold mb-2">شكرًا لتقييمك!</h1>
          <p className="text-sm opacity-70">تم حفظ تقييمك بنجاح.</p>
        </div>
      </main>
    );
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
        <div className="max-w-2xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/bookings" className="text-xs opacity-60 hover:opacity-100">
            إلغاء
          </Link>
          <h1 className="text-base font-bold">تقييم الخدمة</h1>
          <div className="w-10" />
        </div>
      </header>

      <div className="max-w-2xl mx-auto px-6 py-10">
        <div
          className="rounded-2xl p-6"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          {/* Booking context */}
          <div className="mb-6 pb-6" style={{ borderBottom: "1px solid var(--border)" }}>
            <p className="text-xs opacity-60 mb-1">أنت تُقيّم</p>
            <h2 className="text-lg font-bold">{booking?.service?.title ?? "الخدمة"}</h2>
            <p className="text-sm opacity-60 mt-1">{booking?.vendor?.businessName ?? ""}</p>
          </div>

          {error && (
            <div
              className="rounded-xl p-3 mb-5 text-xs flex items-center gap-2"
              style={{
                background: "rgba(239,68,68,0.1)",
                border: "1px solid rgba(239,68,68,0.3)",
                color: "#F87171",
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              {error}
            </div>
          )}

          {/* Star picker */}
          <div className="text-center mb-6">
            <p className="text-sm opacity-70 mb-3">كيف كانت تجربتك؟</p>
            <div className="flex items-center justify-center gap-2 mb-2">
              {STAR_VALUES.map((v) => {
                const filled = hover ? hover >= v : rating >= v;
                return (
                  <button
                    key={v}
                    type="button"
                    onMouseEnter={() => setHover(v)}
                    onMouseLeave={() => setHover(0)}
                    onClick={() => setRating(v)}
                    className="transition-transform hover:scale-110"
                    aria-label={`${v} star${v > 1 ? "s" : ""}`}
                  >
                    <svg
                      width="42"
                      height="42"
                      viewBox="0 0 24 24"
                      fill={filled ? "var(--accent)" : "none"}
                      stroke={filled ? "var(--accent)" : "var(--text-muted)"}
                      strokeWidth="1.5"
                      strokeLinejoin="round"
                    >
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                    </svg>
                  </button>
                );
              })}
            </div>
            {(hover || rating) > 0 && (
              <p className="text-sm" style={{ color: "var(--accent)" }}>
                {STAR_LABELS[hover || rating]}
              </p>
            )}
          </div>

          {/* Comment */}
          <div className="mb-6">
            <label className="block text-xs opacity-70 mb-2">
              تعليقك (اختياري)
            </label>
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="شارك تجربتك مع الآخرين..."
              className="w-full px-3 py-3 rounded-2xl text-sm outline-none resize-none text-right"
              style={{
                background: "var(--surface-hi)",
                border: "1px solid var(--border)",
              }}
            />
            <p className="text-[10px] opacity-40 mt-1 text-right">
              {comment.length} / 2000
            </p>
          </div>

          {/* Submit */}
          <button
            onClick={submit}
            disabled={submitting || !rating}
            className="w-full py-3 rounded-full text-sm font-bold disabled:opacity-40"
            style={{
              background: "var(--accent)",
              color: "var(--bg)",
            }}
          >
            {submitting ? (
              <span className="inline-flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                جارٍ الإرسال…
              </span>
            ) : (
              "إرسال التقييم"
            )}
          </button>
        </div>
      </div>
    </main>
  );
}