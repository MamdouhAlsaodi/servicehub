/**
 * /vendors/[id] — Vendor public profile.
 *
 * Phase 8 — Vendor detail + service list.
 *
 * Shows: vendor header (name, category, rating, address), list of
 * active services (click → /book/[serviceId]), and the recent reviews.
 * Pure read flow; no booking action here — that's /book/[serviceId].
 */

"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
interface VendorDetail {
  id: string;
  businessName: string;
  description: string | null;
  address: string | null;
  avgRating: number | null;
  category: { id: string; nameAr: string; nameEn: string };
  user: { id: string; name: string };
  services: Array<{
    id: string;
    title: string;
    description: string | null;
    price: string;
    durationMinutes: number;
    category: { nameAr: string };
  }>;
}

interface Review {
  id: string;
  rating: number;
  comment: string | null;
  createdAt: string;
  customer: { name: string };
  serviceTitle?: string;
}

function fmtBRL(n: string | number): string {
  return `R$ ${Number(n).toFixed(2)}`;
}

export default function VendorDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const { id } = params;
  const router = useRouter();

  const [vendor, setVendor] = useState<VendorDetail | null>(null);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchVendor = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/vendors/${id}`,
      );
      if (res.status === 404) {
        setError("البائع غير موجود");
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: VendorDetail = await res.json();
      setVendor(data);
      /* Reviews come from a separate endpoint. */
      const rev = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/reviews/vendor/${id}?limit=5`,
      );
      if (rev.ok) {
        const j = await rev.json();
        setReviews(j.reviews ?? []);
      }
    } catch (e: any) {
      setError(e.message || "تعذر التحميل");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    fetchVendor();
  }, [fetchVendor]);

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      </main>
    );
  }

  if (error || !vendor) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg)" }}>
        <div className="text-center">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ color: "#FB7185" }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-sm opacity-80">{error || "غير موجود"}</p>
          <Link href="/" className="text-xs opacity-60 hover:opacity-100 mt-4 inline-block">
            العودة للرئيسية
          </Link>
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
        <div className="max-w-4xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/" className="text-xs opacity-60 hover:opacity-100 inline-flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rotate-180">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
            الرئيسية
          </Link>
          <span className="text-xs opacity-60">تفاصيل البائع</span>
          <div className="w-12" />
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
        {/* Vendor header */}
        <section
          className="rounded-2xl p-6"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
          }}
        >
          <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
            <div>
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{
                  background: "var(--surface-hi)",
                  color: "var(--accent)",
                }}
              >
                {vendor.category.nameAr}
              </span>
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight mt-2">
                {vendor.businessName}
              </h1>
              {vendor.address && (
                <p className="text-xs opacity-60 mt-1 inline-flex items-center gap-1">
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                    <circle cx="12" cy="10" r="3" />
                  </svg>
                  {vendor.address}
                </p>
              )}
            </div>
            {vendor.avgRating != null && vendor.avgRating > 0 && (
              <div
                className="px-4 py-2 rounded-2xl flex items-center gap-2"
                style={{
                  background: "var(--surface-hi)",
                  border: "1px solid var(--border)",
                }}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="var(--accent)">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                <span
                  className="text-2xl font-bold"
                  style={{
                    color: "var(--accent)",
                    fontFamily: "JetBrains Mono, monospace",
                  }}
                >
                  {vendor.avgRating.toFixed(1)}
                </span>
                <span className="text-[10px] opacity-50">
                  / 5
                </span>
              </div>
            )}
          </div>
          {vendor.description && (
            <p className="text-sm opacity-70 leading-relaxed mt-3">
              {vendor.description}
            </p>
          )}
        </section>

        {/* Services */}
        <section>
          <h2 className="text-xs uppercase tracking-widest opacity-50 font-bold mb-3">
            الخدمات ({vendor.services.length})
          </h2>
          {vendor.services.length === 0 ? (
            <div
              className="rounded-2xl p-8 text-center"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <p className="text-sm opacity-60">لا توجد خدمات نشطة حاليًا</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {vendor.services.map((s) => (
                <Link
                  key={s.id}
                  href={`/book/${s.id}`}
                  className="rounded-2xl p-4 transition-all hover:scale-[1.01]"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="text-sm font-bold leading-tight flex-1 pr-2">
                      {s.title}
                    </h3>
                    <span
                      className="shrink-0 text-base font-bold"
                      style={{
                        color: "var(--accent)",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      {fmtBRL(s.price)}
                    </span>
                  </div>
                  {s.description && (
                    <p className="text-xs opacity-60 leading-relaxed mb-3 line-clamp-2">
                      {s.description}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-[10px] opacity-60">
                    <span className="inline-flex items-center gap-1">
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      {s.durationMinutes} دقيقة
                    </span>
                    <span className="inline-flex items-center gap-1" style={{ color: "var(--accent)" }}>
                      احجز
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="rotate-180">
                        <line x1="5" y1="12" x2="19" y2="12" />
                        <polyline points="12 5 19 12 12 19" />
                      </svg>
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Reviews */}
        <section>
          <h2 className="text-xs uppercase tracking-widest opacity-50 font-bold mb-3">
            آخر التقييمات ({reviews.length})
          </h2>
          {reviews.length === 0 ? (
            <div
              className="rounded-2xl p-8 text-center"
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
              }}
            >
              <p className="text-sm opacity-60">لا توجد تقييمات بعد</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reviews.map((r) => (
                <div
                  key={r.id}
                  className="rounded-2xl p-4"
                  style={{
                    background: "var(--surface)",
                    border: "1px solid var(--border)",
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold">
                        {r.customer.name}
                      </span>
                      {r.serviceTitle && (
                        <span className="text-[10px] opacity-50">
                          · {r.serviceTitle}
                        </span>
                      )}
                    </div>
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px]"
                      style={{
                        color: "var(--accent)",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      {r.rating}.0
                    </span>
                  </div>
                  {r.comment && (
                    <p className="text-xs opacity-70 leading-relaxed" dir="rtl">
                      {r.comment}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}