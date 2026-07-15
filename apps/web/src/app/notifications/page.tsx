/**
 * /notifications — User notification inbox.
 *
 * Phase 6 frontend.
 *
 * Polls every 30s (no WebSocket — see notifications.service.ts for
 * rationale). Shows the latest 30 notifications with unread badge,
 * type-specific icons, mark-as-read buttons, and "mark all".
 */

"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { usePreferences, type Translator } from "@/contexts/PreferencesContext";
import type { MessageKey } from "@/i18n/messages";
interface Notification {
  id: string;
  type: string;
  payload: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
}

interface ListResponse {
  items: Notification[];
  unread: number;
}

const TYPE_META: Record<
  string,
  { labelKey: MessageKey; color: string; icon: any }
> = {
  BOOKING_CONFIRMED: { labelKey: "notifications.typeBookingConfirmed", color: "#34D399", icon: 'check' },
  BOOKING_CANCELLED: { labelKey: "notifications.typeBookingCancelled", color: "#EF4444", icon: 'x' },
  BOOKING_CREATED: { labelKey: "notifications.typeBookingCreated", color: "#38BDF8", icon: 'bell' },
  PAYMENT_RECEIVED: { labelKey: "notifications.typePaymentReceived", color: "#34D399", icon: 'check' },
  PAYMENT_FAILED: { labelKey: "notifications.typePaymentFailed", color: "#EF4444", icon: 'alert' },
  REVIEW_RECEIVED: { labelKey: "notifications.typeReviewReceived", color: "#C9A84C", icon: 'check' },
};

const POLL_MS = 30_000;

function buildRelativeTime(t: Translator) {
  return function relativeTime(iso: string): string {
    const d = new Date(iso);
    const ms = Date.now() - d.getTime();
    if (ms < 60_000) return t("notifications.relativeNow");
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return t("notifications.relativeMinutes", { n: mins });
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return t("notifications.relativeHours", { n: hrs });
    const days = Math.floor(hrs / 24);
    return t("notifications.relativeDays", { n: days });
  };
}

export default function NotificationsPage() {
  const router = useRouter();
  const { t } = usePreferences();
  const relativeTime = buildRelativeTime(t);
  const [data, setData] = useState<ListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_API_URL}/notifications`,
        { credentials: "include" },
      );
      if (res.status === 401) {
        router.push("/login?redirect=/notifications");
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json: ListResponse = await res.json();
      setData(json);
    } catch (e: any) {
      setError(e.message || t("home.loadError"));
    } finally {
      setLoading(false);
    }
  }, [router, t]);

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, POLL_MS);
    return () => clearInterval(id);
  }, [fetchData]);

  async function markRead(id: string) {
    try {
      const res = await apiRequest(`/api/v1/notifications/${id}/read`, {
        method: "POST",
      });
      if (res.ok) {
        setData((prev) =>
          prev
            ? {
                ...prev,
                unread: prev.unread - 1,
                items: prev.items.map((n) =>
                  n.id === id ? { ...n, readAt: new Date().toISOString() } : n,
                ),
              }
            : prev,
        );
      }
    } catch {}
  }

  async function markAll() {
    try {
      const res = await apiRequest("/api/v1/notifications/read-all", {
        method: "POST",
      });
      if (res.ok) {
        const now = new Date().toISOString();
        setData((prev) =>
          prev
            ? {
                unread: 0,
                items: prev.items.map((n) => ({ ...n, readAt: n.readAt ?? now })),
              }
            : prev,
        );
      }
    } catch {}
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
        <div className="max-w-3xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            <h1 className="text-base font-bold">{t("notifications.title")}</h1>
            {data && data.unread > 0 && (
              <span
                className="px-2 py-0.5 rounded-full text-[10px] font-bold"
                style={{
                  background: "var(--accent)",
                  color: "var(--bg)",
                }}
              >
                {t("notifications.newBadge", { n: data.unread })}
              </span>
            )}
          </div>
          {data && data.unread > 0 && (
            <button
              onClick={markAll}
              className="text-xs opacity-60 hover:opacity-100 inline-flex items-center gap-1"
            >
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> {t("notifications.markAll")}
            </button>
          )}
        </div>
      </header>

      <div className="max-w-3xl mx-auto px-6 py-6">
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
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
            <p className="text-sm opacity-80">{error}</p>
          </div>
        ) : !data || data.items.length === 0 ? (
          <div
            className="rounded-2xl p-12 text-center"
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
            }}
          >
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/></svg>
            <h3 className="text-base font-bold mb-1">{t("notifications.emptyTitle")}</h3>
            <p className="text-xs opacity-60">
              {t("notifications.emptySubtitle")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {data.items.map((n) => {
              const meta = TYPE_META[n.type];
              const color = meta?.color ?? "#9B98A5";
              const unread = !n.readAt;
              return (
                <div
                  key={n.id}
                  className="rounded-2xl p-4 flex items-start gap-3 transition-all"
                  style={{
                    background: unread ? "var(--surface)" : "var(--surface)",
                    border: `1px solid ${unread ? color + "55" : "var(--border)"}`,
                    opacity: unread ? 1 : 0.65,
                  }}
                >
                  <div
                    className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center"
                    style={{
                      background: `${color}22`,
                      border: `1px solid ${color}55`,
                    }}
                  >
                    <svg
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke={color}
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      {n.type.includes("CONFIRMED") || n.type.includes("RECEIVED") ? (
                        <polyline points="20 6 9 17 4 12" />
                      ) : n.type.includes("FAILED") || n.type.includes("CANCELLED") ? (
                        <>
                          <circle cx="12" cy="12" r="10" />
                          <line x1="15" y1="9" x2="9" y2="15" />
                          <line x1="9" y1="9" x2="15" y2="15" />
                        </>
                      ) : (
                        <>
                          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
                          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
                        </>
                      )}
                    </svg>
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <span
                        className="text-sm font-bold"
                        style={{ color }}
                      >
                        {meta ? t(meta.labelKey) : n.type}
                      </span>
                      <span className="text-[10px] opacity-50 shrink-0">
                        {relativeTime(n.createdAt)}
                      </span>
                    </div>

                    {/* Payload rendering: tiny preview */}
                    <div className="text-xs opacity-60 space-y-0.5">
                      {typeof n.payload.bookingId === "string" && (
                        <p>
                          {t("notifications.payloadBooking")}{" "}
                          <code className="text-[10px] opacity-70 font-mono">
                            {(n.payload.bookingId as string).slice(0, 12)}…
                          </code>
                        </p>
                      )}
                      {typeof n.payload.amount === "number" && (
                        <p>
                          {t("notifications.payloadAmount")}{" "}
                          <span
                            className="font-bold"
                            style={{ fontFamily: "JetBrains Mono, monospace" }}
                          >
                            {n.payload.amount as number}{" "}
                            {(n.payload.currency as string)?.toUpperCase()}
                          </span>
                        </p>
                      )}
                    </div>

                    {unread && (
                      <button
                        onClick={() => markRead(n.id)}
                        className="text-[10px] opacity-60 hover:opacity-100 mt-2 inline-flex items-center gap-1"
                      >
                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg> {t("notifications.markRead")}
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </main>
  );
}