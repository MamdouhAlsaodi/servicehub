/**
 * /  — ServiceHub Discovery Page.
 *
 * Phase 8 — Discovery flow.
 *
 * Three sections stacked, each using the design tokens:
 *   1. Hero search bar (full-width input + category chips)
 *   2. Approved vendor grid (cards)
 *   3. Category quick-pick row
 *
 * Filters hit /api/v1/vendors?search=&categoryId=&minPrice=&maxPrice=&minRating=
 * — all server-side. We refresh on filter changes with a small
 * debounce to keep the URL of in-flight requests fresh.
 *
 * Static UI copy flows through the in-repo i18n catalog via the
 * PreferencesContext `t()` helper. Vendor/service content is fetched from the
 * API in its original language and intentionally not translated.
 */

"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiFetch } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";
interface Vendor {
  id: string;
  businessName: string;
  description: string | null;
  avgRating: number | null;
  address: string | null;
  category: { id: string; nameAr: string; nameEn: string; icon: string | null };
  user: { id: string; name: string };
}

interface Category {
  id: string;
  nameAr: string;
  nameEn: string;
  icon: string | null;
}

type PriceRangeKey = "home.priceAll" | "home.priceUnder100" | "home.price100to300" | "home.priceOver300";
type RatingFilterKey = "home.ratingAll" | "home.rating4plus" | "home.rating4_5plus";

const PRICE_RANGES: Array<{ key: PriceRangeKey; min?: number; max?: number }> = [
  { key: "home.priceAll" },
  { key: "home.priceUnder100", max: 100 },
  { key: "home.price100to300", min: 100, max: 300 },
  { key: "home.priceOver300", min: 300 },
];

const RATING_FILTERS: Array<{ key: RatingFilterKey; minRating?: number }> = [
  { key: "home.ratingAll" },
  { key: "home.rating4plus", minRating: 4 },
  { key: "home.rating4_5plus", minRating: 4.5 },
];

export default function HomePage() {
  const router = useRouter();
  const { t } = usePreferences();

  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [priceRange, setPriceRange] = useState(0);
  const [ratingFilter, setRatingFilter] = useState(0);

  const [vendors, setVendors] = useState<Vendor[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState<{ total: number }>({ total: 0 });

  /* Fetch categories once. */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<Category[]>("/api/v1/categories");
        if (!cancelled) setCategories(data);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  /* Fetch vendors whenever filters change. */
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const params = new URLSearchParams();
    if (search.trim()) params.set("search", search.trim());
    if (categoryId) params.set("categoryId", categoryId);
    const pr = PRICE_RANGES[priceRange];
    if (pr?.min !== undefined) params.set("minPrice", String(pr.min));
    if (pr?.max !== undefined) params.set("maxPrice", String(pr.max));
    const rf = RATING_FILTERS[ratingFilter];
    if (rf?.minRating !== undefined) params.set("minRating", String(rf.minRating));

    /* 300ms debounce so typing doesn't fire every keystroke. */
    const id = setTimeout(async () => {
      try {
        const data = await apiFetch<{
          data: Vendor[];
          meta: { total: number };
        }>(`/api/v1/vendors?${params.toString()}`);
        if (cancelled) return;
        setVendors(data.data ?? []);
        setMeta(data.meta ?? { total: 0 });
      } catch (e: any) {
        if (!cancelled) setError(e.message || t("home.loadError"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(id);
    };
  }, [search, categoryId, priceRange, ratingFilter, t]);

  const goVendor = (id: string) => router.push(`/vendors/${id}`);

  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }}>
      {/* HERO */}
      <header
        className="relative overflow-hidden"
        style={{
          background:
            "linear-gradient(180deg, rgba(201,168,76,0.06) 0%, transparent 100%)",
          borderBottom: "1px solid var(--border)",
        }}
      >
        {/* Login CTA — explicit high-contrast pill, no theme vars. */}
        <Link
          href="/login"
          aria-label={t("home.loginAria")}
          className="absolute top-4 start-4 inline-flex items-center justify-center rounded-full text-sm font-bold transition-opacity hover:opacity-90 focus:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2"
          style={{
            background: "#111827",
            color: "#ffffff",
            border: "1px solid #111827",
            minHeight: "44px",
            minWidth: "44px",
            padding: "10px 22px",
            zIndex: 30,
            pointerEvents: "auto",
            cursor: "pointer",
            boxShadow: "0 4px 12px rgba(0,0,0,0.25)",
          }}
        >
          {t("home.loginCta")}
        </Link>

        <div className="max-w-5xl mx-auto px-6 py-14 text-center">
          <p
            className="text-[10px] uppercase tracking-[0.3em] mb-3"
            style={{ color: "var(--accent)" }}
          >
            {t("brand")}
          </p>
          <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">
            {t("home.heroTitle")}
          </h1>
          <p className="text-sm opacity-60 max-w-xl mx-auto mb-8">
            {t("home.heroSubtitle")}
          </p>

          {/* Search input */}
          <div
            className="flex items-center gap-2 px-4 py-3 rounded-2xl max-w-2xl mx-auto"
            style={{
              background: "var(--surface-hi)",
              border: "1px solid var(--border)",
            }}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-60">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("home.searchPlaceholder")}
              className="flex-1 bg-transparent outline-none text-sm text-start"
            />
          </div>

          {/* Category quick-pick */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-5">
            <button
              onClick={() => setCategoryId(null)}
              className="px-3 py-1 rounded-full text-xs font-bold transition-all"
              style={{
                background: !categoryId ? "var(--accent)" : "var(--surface-hi)",
                border: `1px solid ${!categoryId ? "var(--accent)" : "var(--border)"}`,
                color: !categoryId ? "var(--bg)" : "var(--text-muted)",
              }}
            >
              {t("home.allCategories")}
            </button>
            {categories.slice(0, 8).map((c) => {
              const active = c.id === categoryId;
              return (
                <button
                  key={c.id}
                  onClick={() => setCategoryId(active ? null : c.id)}
                  className="px-3 py-1 rounded-full text-xs font-bold transition-all"
                  style={{
                    background: active ? "var(--accent)" : "var(--surface-hi)",
                    border: `1px solid ${active ? "var(--accent)" : "var(--border)"}`,
                    color: active ? "var(--bg)" : "var(--text-muted)",
                  }}
                >
                  {c.nameAr}
                </button>
              );
            })}
          </div>

          {/* Price + rating filter pills */}
          <div className="flex flex-wrap items-center justify-center gap-2 mt-3">
            {PRICE_RANGES.map((p, i) => (
              <button
                key={`p-${i}`}
                onClick={() => setPriceRange(i)}
                className="px-2 py-0.5 rounded-full text-[10px] transition-all"
                style={{
                  background: priceRange === i ? "var(--surface-hi)" : "transparent",
                  border: `1px solid ${priceRange === i ? "var(--accent)" : "var(--border)"}`,
                  color: priceRange === i ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                {t(p.key)}
              </button>
            ))}
            <span className="text-xs opacity-30 mx-1">·</span>
            {RATING_FILTERS.map((r, i) => (
              <button
                key={`r-${i}`}
                onClick={() => setRatingFilter(i)}
                className="px-2 py-0.5 rounded-full text-[10px] inline-flex items-center gap-1 transition-all"
                style={{
                  background: ratingFilter === i ? "var(--surface-hi)" : "transparent",
                  border: `1px solid ${ratingFilter === i ? "var(--accent)" : "var(--border)"}`,
                  color: ratingFilter === i ? "var(--accent)" : "var(--text-muted)",
                }}
              >
                <svg width="9" height="9" viewBox="0 0 24 24" fill="currentColor">
                  <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                </svg>
                {t(r.key)}
              </button>
            ))}
          </div>
        </div>
      </header>

      {/* RESULTS */}
      <div className="max-w-5xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold">
            {loading ? t("home.loading") : t("home.resultsCount", { count: meta.total })}
          </h2>
          {(search || categoryId || priceRange > 0 || ratingFilter > 0) && (
            <button
              onClick={() => {
                setSearch("");
                setCategoryId(null);
                setPriceRange(0);
                setRatingFilter(0);
              }}
              className="text-[10px] opacity-60 hover:opacity-100"
            >
              {t("home.clearFilters")}
            </button>
          )}
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-20 opacity-50">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
          </div>
        ) : error ? (
          <div
            className="rounded-2xl p-6 text-center"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" style={{ color: "#FB7185" }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p className="text-sm opacity-80">{error}</p>
          </div>
        ) : vendors.length === 0 ? (
          <div
            className="rounded-2xl p-12 text-center"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <h3 className="text-base font-bold mb-1">{t("home.emptyTitle")}</h3>
            <p className="text-xs opacity-60">{t("home.emptySubtitle")}</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {vendors.map((v) => (
              <button
                key={v.id}
                onClick={() => goVendor(v.id)}
                className="text-start rounded-2xl p-5 transition-all hover:scale-[1.02]"
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                }}
              >
                <div className="flex items-start justify-between mb-3">
                  <span
                    className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                    style={{
                      background: "var(--surface-hi)",
                      color: "var(--accent)",
                    }}
                  >
                    {v.category.nameAr}
                  </span>
                  {v.avgRating != null && v.avgRating > 0 && (
                    <span
                      className="text-[10px] inline-flex items-center gap-0.5"
                      style={{
                        color: "var(--accent)",
                        fontFamily: "JetBrains Mono, monospace",
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
                      </svg>
                      {v.avgRating.toFixed(1)}
                    </span>
                  )}
                </div>

                <h3 className="text-base font-bold mb-1 leading-tight">
                  {v.businessName}
                </h3>
                {v.description && (
                  <p className="text-xs opacity-60 line-clamp-2 mb-3 leading-relaxed">
                    {v.description}
                  </p>
                )}
                {v.address && (
                  <p className="text-[10px] opacity-50 inline-flex items-center gap-1">
                    <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                    {v.address}
                  </p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}