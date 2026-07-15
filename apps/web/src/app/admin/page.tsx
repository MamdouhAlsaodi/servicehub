/**
 * /admin — Admin Dashboard.
 *
 * Phase 7 frontend.
 *
 * Five sections:
 *   1. KPI hero row (users, vendors, GMV, commission)
 *   2. Revenue last 30 days (mini chart)
 *   3. Top vendors leaderboard
 *   4. Pending vendor approvals (action: approve)
 *   5. Recent disputes / cancellations
 *
 * All admin-only. The middleware lets /admin through only when the
 * role cookie/session is ADMIN; on the client we also check that the
 * /admin/kpis call returns 200 before showing the body.
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { usePreferences } from "@/contexts/PreferencesContext";
interface KPIs {
  users: number;
  vendors: number;
  approvedVendors: number;
  bookings: number;
  succeededPayments: number;
  gmv: number;
  refunds: number;
  netRevenue: number;
  commission: number;
}

interface RevenuePoint {
  date: string;
  amount: number;
  count: number;
}

interface TopVendor {
  vendorId: string;
  businessName: string;
  category: string | null;
  avgRating: number;
  gmv: number;
  commission: number;
  bookings: number;
}

interface PendingVendor {
  id: string;
  businessName: string;
  status: string;
  createdAt: string;
  user: { id: string; name: string; email: string };
  category: { nameEn: string; nameAr: string };
}

interface Dispute {
  id: string;
  cancellationReason: string;
  startTime: string;
  customer: { name: string; email: string };
  vendor: { businessName: string };
  service: { title: string };
}

function fmtBRL(n: number): string {
  return `R$ ${n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

function MiniChart({ data }: { data: RevenuePoint[] }) {
  const W = 600, H = 80, PAD = 4;
  const max = Math.max(...data.map((d) => d.amount), 1);
  const stepX = (W - PAD * 2) / Math.max(data.length - 1, 1);
  const points = data
    .map((d, i) => {
      const x = PAD + i * stepX;
      const y = H - PAD - (d.amount / max) * (H - PAD * 2);
      return `${x},${y}`;
    })
    .join(" ");
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height={H}
      preserveAspectRatio="none"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function AdminPage() {
  const router = useRouter();
  const { t, locale } = usePreferences();
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [revenue, setRevenue] = useState<RevenuePoint[]>([]);
  const [topVendors, setTopVendors] = useState<TopVendor[]>([]);
  const [pending, setPending] = useState<PendingVendor[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const intlLocale = locale === "ar" ? "ar-SA" : "en-US";

  const fetchAll = useCallback(async () => {
    // Same-origin paths go through the Next.js rewrite to the API.
    // `credentials: 'include'` carries the HttpOnly auth cookie; we
    // deliberately do not read localStorage or build an Authorization
    // header — the backend never issued a client-readable token.
    const init: RequestInit = {
      credentials: "include",
    };

    try {
      const [k, r, tv, p, d] = await Promise.all([
        fetch(`/api/v1/admin/kpis`, init),
        fetch(`/api/v1/admin/reports/revenue?days=30`, init),
        fetch(`/api/v1/admin/reports/top-vendors?limit=5`, init),
        fetch(`/api/v1/admin/vendors/pending`, init),
        fetch(`/api/v1/admin/disputes`, init),
      ]);
      if (k.status === 401) {
        router.push("/login?redirect=/admin");
        return;
      }
      if (k.status === 403) {
        setError(t("admin.error403"));
        setLoading(false);
        return;
      }
      if (k.ok) setKpis(await k.json());
      if (r.ok) setRevenue(await r.json());
      if (tv.ok) setTopVendors(await tv.json());
      if (p.ok) setPending(await p.json());
      if (d.ok) setDisputes(await d.json());
    } catch (e: any) {
      setError(e.message || t("admin.errorLoadFallback"));
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function approve(id: string) {
    const res = await apiRequest(`/api/v1/admin/vendors/${id}/approve`, {
      method: "PATCH",
    });
    if (res.ok) {
      setPending((prev) => prev.filter((v) => v.id !== id));
    }
  }

  if (loading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin opacity-50"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      </main>
    );
  }

  if (error) {
    return (
      <main className="min-h-screen flex items-center justify-center px-6" style={{ background: "var(--bg)" }}>
        <div className="text-center">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" style={{ color: "#FB7185" }} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          <p className="text-sm opacity-80">{error}</p>
          <Link href="/" className="text-xs opacity-60 hover:opacity-100 mt-4 inline-block">
            {t("admin.back")}
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
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2L2 7l10 5 10-5-10-5z" />
              <path d="M2 17l10 5 10-5" />
              <path d="M2 12l10 5 10-5" />
            </svg>
            <h1 className="text-lg font-bold">{t("admin.title")}</h1>
          </div>
          <span
            className="text-[10px] uppercase tracking-widest px-2 py-1 rounded-full"
            style={{ background: "var(--surface-hi)", color: "var(--accent)" }}
          >
            {t("admin.badge")}
          </span>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {/* KPI hero */}
        {kpis && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <KpiCard
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>}
              label={t("admin.kpi.users")}
              value={kpis.users.toString()}
              tone="sky"
            />
            <KpiCard
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l1-5h16l1 5"/><path d="M5 9v11a1 1 0 001 1h12a1 1 0 001-1V9"/><path d="M9 21V13h6v8"/></svg>}
              label={t("admin.kpi.approvedVendors")}
              value={`${kpis.approvedVendors}/${kpis.vendors}`}
              tone="emerald"
            />
            <KpiCard
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>}
              label={t("admin.kpi.confirmedBookings")}
              value={kpis.bookings.toString()}
              tone="gold"
            />
            <KpiCard
              icon={<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>}
              label={t("admin.kpi.gmv")}
              value={fmtBRL(kpis.gmv)}
              tone="emerald"
              sub={`${t("admin.kpi.commissionPrefix")} ${fmtBRL(kpis.commission)}`}
            />
          </div>
        )}

        {/* Revenue chart */}
        <section
          className="rounded-2xl p-6"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-bold">{t("admin.revenue.title")}</h2>
            <span
              className="text-[10px] opacity-60 font-mono"
              style={{ fontFamily: "JetBrains Mono, monospace" }}
            >
              {t("admin.revenue.daysCount", { n: revenue.length })}
            </span>
          </div>
          <MiniChart data={revenue} />
          <div className="flex items-center justify-between mt-3 text-[10px] opacity-50">
            <span>
              {revenue[0]?.date} → {revenue[revenue.length - 1]?.date}
            </span>
            <span>
              {t("admin.revenue.totalPrefix")} {fmtBRL(revenue.reduce((s, r) => s + r.amount, 0))}
            </span>
          </div>
        </section>

        {/* Top vendors + Pending approvals */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* Top vendors */}
          <section
            className="rounded-2xl p-6"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold">{t("admin.topVendors.title")}</h2>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50"><path d="M12 2l1.5 4.5L18 8l-4.5 1.5L12 14l-1.5-4.5L6 8l4.5-1.5L12 2z"/><path d="M19 14l1 3 3 1-3 1-1 3-1-3-3-1 3-1 1-3z"/></svg>
            </div>
            {topVendors.length === 0 ? (
              <p className="text-xs opacity-50 text-center py-6">{t("admin.topVendors.empty")}</p>
            ) : (
              <div className="space-y-2">
                {topVendors.map((v, i) => (
                  <div
                    key={v.vendorId}
                    className="flex items-center gap-3 px-3 py-2 rounded-xl"
                    style={{ background: "var(--surface-hi)" }}
                  >
                    <span
                      className="text-xs opacity-50 w-5"
                      style={{ fontFamily: "JetBrains Mono, monospace" }}
                    >
                      #{i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">
                        {v.businessName}
                      </p>
                      <p className="text-[10px] opacity-50">
                        {v.category ?? "—"} · {t("admin.topVendors.bookingsCount", { n: v.bookings })} · ★{" "}
                        {v.avgRating?.toFixed(1) ?? "0.0"}
                      </p>
                    </div>
                    <div className="text-end shrink-0">
                      <p
                        className="text-sm font-bold"
                        style={{
                          color: "var(--accent)",
                          fontFamily: "JetBrains Mono, monospace",
                        }}
                      >
                        {fmtBRL(v.gmv)}
                      </p>
                      <p className="text-[10px] opacity-50">
                        {t("admin.topVendors.commissionPrefix")}{fmtBRL(v.commission)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* Pending approvals */}
          <section
            className="rounded-2xl p-6"
            style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
          >
            <h2 className="text-sm font-bold mb-4">{t("admin.pending.title")}</h2>
            {pending.length === 0 ? (
              <p className="text-xs opacity-50 text-center py-6">
                {t("admin.pending.empty")}
              </p>
            ) : (
              <div className="space-y-2">
                {pending.map((v) => (
                  <div
                    key={v.id}
                    className="flex items-center gap-3 px-3 py-3 rounded-xl"
                    style={{ background: "var(--surface-hi)" }}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">
                        {v.businessName}
                      </p>
                      <p className="text-[10px] opacity-60 truncate">
                        {v.user.email} · {v.category?.nameAr ?? v.category?.nameEn}
                      </p>
                    </div>
                    <button
                      onClick={() => approve(v.id)}
                      className="shrink-0 px-3 py-1.5 rounded-full text-xs font-bold inline-flex items-center gap-1"
                      style={{
                        background: "var(--accent)",
                        color: "var(--bg)",
                      }}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> {t("admin.pending.approve")}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* Disputes */}
        <section
          className="rounded-2xl p-6"
          style={{ background: "var(--surface)", border: "1px solid var(--border)" }}
        >
          <h2 className="text-sm font-bold mb-4">{t("admin.disputes.title")}</h2>
          {disputes.length === 0 ? (
            <p className="text-xs opacity-50 text-center py-6">{t("admin.disputes.empty")}</p>
          ) : (
            <div className="space-y-2">
              {disputes.map((d) => (
                <div
                  key={d.id}
                  className="px-3 py-3 rounded-xl flex items-center gap-3"
                  style={{ background: "var(--surface-hi)" }}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">
                      {d.service.title}
                    </p>
                    <p className="text-[10px] opacity-60 truncate">
                      {d.customer.name} @ {d.vendor.businessName} · {new Date(d.startTime).toLocaleDateString(intlLocale)}
                    </p>
                    <p className="text-[11px] mt-1 opacity-70" dir="rtl">
                      {t("admin.disputes.reasonPrefix")} {d.cancellationReason}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function KpiCard({
  icon,
  label,
  value,
  tone,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  tone: "sky" | "emerald" | "gold";
  sub?: string;
}) {
  const colors = {
    sky: "#38BDF8",
    emerald: "#34D399",
    gold: "#C9A84C",
  };
  return (
    <div
      className="rounded-2xl p-4"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span style={{ color: colors[tone] }}>{icon}</span>
        <span className="text-[10px] uppercase tracking-widest opacity-60 font-bold">
          {label}
        </span>
      </div>
      <p
        className="text-2xl font-bold"
        style={{
          color: colors[tone],
          fontFamily: "JetBrains Mono, monospace",
        }}
      >
        {value}
      </p>
      {sub && <p className="text-[10px] opacity-50 mt-1">{sub}</p>}
    </div>
  );
}