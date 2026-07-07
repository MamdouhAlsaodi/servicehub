/**
 * /checkout/[paymentId] — Payment confirmation screen.
 *
 * Phase 4 frontend (4.4).
 *
 * In production, this page would mount the Stripe Elements SDK and
 * collect card details, then call stripe.confirmCardPayment with the
 * clientSecret. For the MOCK provider, we just show the payment info
 * and two big buttons (Succeed / Fail) that call /payments/mock-confirm.
 *
 * The MOCK confirmation flow goes:
 *   - user clicks "ادفع" (Pay)
 *   - frontend POSTs /payments/mock-confirm with the outcome
 *   - the API verifies a signed webhook event, applies it, returns
 *     the booking + payment in their final state
 *   - we redirect to /bookings with a success toast
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
interface Payment {
  id: string;
  externalId: string;
  amount: string | number;
  currency: string;
  status: "PENDING" | "SUCCEEDED" | "FAILED" | "REFUNDED" | "PARTIALLY_REFUNDED";
  provider: "STRIPE" | "MOCK";
  booking: { id: string; startTime: string; status: string };
}

export default function CheckoutPage({
  params,
}: {
  params: { paymentId: string };
}) {
  const { paymentId } = params;
  const router = useRouter();

  const [payment, setPayment] = useState<Payment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<"succeed" | "fail" | null>(null);

  const fetchPayment = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/payments/${paymentId}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        if (res.status === 401) {
          router.push(`/login?redirect=/checkout/${paymentId}`);
          return;
        }
        throw new Error(`HTTP ${res.status}`);
      }
      const data: Payment = await res.json();
      setPayment(data);
    } catch (e: any) {
      setError(e.message || "تعذر التحميل");
    } finally {
      setLoading(false);
    }
  }, [paymentId, router]);

  useEffect(() => {
    fetchPayment();
  }, [fetchPayment]);

  async function confirm(outcome: "succeeded" | "failed") {
    if (!payment) return;
    setSubmitting(outcome === "succeeded" ? "succeed" : "fail");
    setError(null);
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/payments/mock-confirm`,
        {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            externalId: payment.externalId,
            outcome,
          }),
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.message || `HTTP ${res.status}`);
      }
      // Reload to show the new state, then redirect.
      await fetchPayment();
      setTimeout(() => router.push("/bookings"), 1200);
    } catch (e: any) {
      setError(e.message || "تعذر التأكيد");
    } finally {
      setSubmitting(null);
    }
  }

  if (loading) {
    return (
      <main
        className="min-h-screen flex items-center justify-center"
        style={{ background: "var(--bg)" }}
      >
        <svg width="24" height="24" style={{ opacity: 0.5 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      </main>
    );
  }

  if (error || !payment) {
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
          <svg className="mx-auto mb-3 text-red-400" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-sm opacity-80">
            {error || "الدفع غير موجود"}
          </p>
          <Link
            href="/bookings"
            className="inline-block mt-4 text-xs opacity-60 hover:opacity-100"
          >
            العودة للحجوزات
          </Link>
        </div>
      </main>
    );
  }

  if (payment.status === "SUCCEEDED") {
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
          <h1 className="text-xl font-bold mb-2">تم الدفع بنجاح</h1>
          <p className="text-sm opacity-70">
            حجزك مؤكد. ستتلقى تفاصيل قبل الموعد.
          </p>
          <Link
            href="/bookings"
            className="inline-block mt-6 px-4 py-2 rounded-full text-sm font-bold"
            style={{ background: "var(--accent)", color: "var(--bg)" }}
          >
            عرض حجوزاتي
          </Link>
        </div>
      </main>
    );
  }

  if (payment.status === "FAILED") {
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
          <svg style={{ color: "#EF4444" }} className="mx-auto mb-4" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          <h1 className="text-xl font-bold mb-2">فشل الدفع</h1>
          <p className="text-sm opacity-70 mb-4">
            تم إلغاء الحجز. يمكنك المحاولة مجددًا بوقت آخر.
          </p>
          <Link
            href="/"
            className="inline-block mt-2 px-4 py-2 rounded-full text-sm font-bold"
            style={{
              background: "var(--accent)",
              color: "var(--bg)",
            }}
          >
            ابحث عن خدمة أخرى
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* Top bar — signature element */}
      <header
        className="sticky top-0 z-30 backdrop-blur-2xl"
        style={{
          background: "rgba(15,14,19,0.85)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between gap-4">
          <Link
            href="/bookings"
            className="text-xs opacity-60 hover:opacity-100"
          >
            إلغاء
          </Link>
          <div
            className="text-xs px-3 py-1 rounded-full inline-flex items-center gap-2"
            style={{
              background: "var(--surface-hi)",
              fontFamily: "JetBrains Mono, monospace",
            }}
          >
            <svg className="opacity-50" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>
            دفع آمن — بيئة اختبار
          </div>
          <div
            className="text-xs px-3 py-1 rounded-full inline-flex items-center gap-1"
            style={{
              background: "var(--surface-hi)",
              fontFamily: "JetBrains Mono, monospace",
              color: "var(--accent)",
            }}
          >
            {Number(payment.amount).toFixed(2)} {payment.currency.toUpperCase()}
          </div>
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-10">
        <div
          className="rounded-2xl p-6"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <h1 className="text-xl font-bold mb-1">تأكيد الدفع</h1>
          <p className="text-xs opacity-60 mb-6">
            هذه بيئة اختبار — اضغط أحد الزرين لمحاكاة نتيجة الدفع
          </p>

          <div
            className="rounded-xl p-4 mb-6 text-sm"
            style={{
              background: "var(--surface-hi)",
              border: "1px solid var(--border)",
            }}
          >
            <div className="flex items-center justify-between">
              <span className="opacity-60">المبلغ</span>
              <span
                className="font-bold"
                style={{ fontFamily: "JetBrains Mono, monospace" }}
              >
                {Number(payment.amount).toFixed(2)} {payment.currency.toUpperCase()}
              </span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="opacity-60">المزود</span>
              <span className="text-xs px-2 py-0.5 rounded-full bg-amber-400/15 text-amber-400">
                {payment.provider}
              </span>
            </div>
            <div className="flex items-center justify-between mt-2">
              <span className="opacity-60">رقم العملية</span>
              <code
                className="text-[10px] opacity-50"
                style={{ fontFamily: "JetBrains Mono, monospace" }}
              >
                {payment.externalId.slice(0, 20)}…
              </code>
            </div>
          </div>

          {error && (
            <div
              className="rounded-xl p-3 mb-4 text-xs flex items-center gap-2"
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

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              onClick={() => confirm("succeeded")}
              disabled={submitting !== null}
              className="rounded-2xl p-5 transition-all hover:scale-[1.02] disabled:opacity-40"
              style={{
                background: "var(--accent)",
                color: "var(--bg)",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                {submitting === "succeed" ? (
                  <svg className="animate-spin animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/></svg>
                )}
                <span className="font-bold text-base">ادفع (نجح)</span>
              </div>
              <div className="text-[10px] opacity-70">
                Stripe.test_mode → succeeded
              </div>
            </button>

            <button
              onClick={() => confirm("failed")}
              disabled={submitting !== null}
              className="rounded-2xl p-5 transition-all hover:scale-[1.02] disabled:opacity-40"
              style={{
                background: "var(--surface-hi)",
                border: "1px solid var(--border)",
                color: "#EF4444",
                fontFamily: "JetBrains Mono, monospace",
              }}
            >
              <div className="flex items-center justify-center gap-2 mb-1">
                {submitting === "fail" ? (
                  <svg className="animate-spin animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                )}
                <span className="font-bold text-base">ادفع (فشل)</span>
              </div>
              <div className="text-[10px] opacity-70">
                Stripe.test_mode → payment_failed
              </div>
            </button>
          </div>

          <p className="text-[10px] opacity-40 text-center mt-6">
            البطاقة لن يتم خصمها — بيئة تطوير محلية
          </p>
        </div>
      </div>
    </main>
  );
}