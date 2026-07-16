/**
 * /bookings/[id]/messages — Booking-thread messaging UI.
 *
 * B6 Task 14 (frontend slice).
 *
 * Polling, not WebSocket: we poll REST every 4s while the tab is
 * visible and re-poll on `visibilitychange` so coming back catches up.
 *
 * Render contract: plain text only — React escapes `{content}` by
 * default; newlines preserved with `white-space: pre-wrap`.
 *
 * Pagination: walked on demand via "load older" — stable scroll for
 * live conversations; long threads paginate.
 */

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { apiRequest } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { usePreferences, type Translator } from "@/contexts/PreferencesContext";

type SenderRole = "ADMIN" | "VENDOR" | "CUSTOMER";

interface MessageRow {
  id: string;
  bookingId: string;
  senderId: string;
  content: string;
  readAt: string | null;
  createdAt: string;
  sender?: { id: string; name: string; role: SenderRole };
}

interface ThreadPage {
  items: MessageRow[];
  nextCursor: string | null;
}

const POLL_MS = 4000;
const SEND_LOCKOUT_MS = 250;

function intlLocaleFor(locale: "ar" | "en"): string {
  return locale === "ar" ? "ar-SA" : "en-US";
}

function buildRelative(t: Translator) {
  return function relative(iso: string): string {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return t("messages.justNow");
    const mins = Math.floor(ms / 60_000);
    if (mins < 60) return `${mins}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h`;
    return new Date(iso).toLocaleDateString(intlLocaleFor("en"));
  };
}

export default function BookingMessagesPage({
  params,
}: {
  params: { id: string };
}) {
  const { id: bookingId } = params;
  const router = useRouter();
  const { user, loading: authLoading } = useAuth();
  const { t, locale } = usePreferences();
  const fmtLocale = intlLocaleFor(locale);
  const relative = useMemo(() => buildRelative(t), [t]);

  const [items, setItems] = useState<MessageRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const sendLockoutUntil = useRef<number>(0);
  const listAnchor = useRef<HTMLDivElement | null>(null);
  /* New reply → stick bottom. Older-page load → keep scroll. */
  const stickToBottom = useRef(true);

  const senderLabel = useCallback(
    (m: MessageRow): string => {
      if (user && m.senderId === user.id) return t("messages.you");
      if (m.sender?.name) return m.sender.name;
      return `…${m.senderId.slice(-6)}`;
    },
    [user, t],
  );

  const refreshLatest = useCallback(async (): Promise<void> => {
    try {
      const res = await apiRequest(`/api/v1/messages/bookings/${bookingId}`, {
        credentials: "include",
      });
      if (res.status === 401) {
        router.push(`/login?redirect=/bookings/${bookingId}/messages`);
        return;
      }
      if (res.status === 403) {
        setError(t("messages.errorForbidden"));
        setLoading(false);
        return;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page: ThreadPage = await res.json();
      setItems(page.items);
      setHasMore(Boolean(page.nextCursor));
      setCursor(page.nextCursor);
      setError(null);
    } catch (e: any) {
      setError(e.message || t("messages.errorLoad"));
    } finally {
      setLoading(false);
    }
  }, [bookingId, router, t]);

  const loadOlder = useCallback(async (): Promise<void> => {
    if (!cursor || loadingOlder) return;
    setLoadingOlder(true);
    stickToBottom.current = false;
    try {
      const res = await apiRequest(
        `/api/v1/messages/bookings/${bookingId}?cursor=${encodeURIComponent(cursor)}`,
        { credentials: "include" },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const page: ThreadPage = await res.json();
      setItems((prev) => [...page.items, ...prev]);
      setHasMore(Boolean(page.nextCursor));
      setCursor(page.nextCursor);
    } catch (e: any) {
      setError(e.message || t("messages.errorLoad"));
    } finally {
      setLoadingOlder(false);
    }
  }, [bookingId, cursor, loadingOlder, t]);

  const send = useCallback(async (): Promise<void> => {
    const trimmed = draft.trim();
    if (!trimmed || Date.now() < sendLockoutUntil.current) return;
    sendLockoutUntil.current = Date.now() + SEND_LOCKOUT_MS;
    setSending(true);
    stickToBottom.current = true;
    try {
      const res = await apiRequest(`/api/v1/messages/bookings/${bookingId}`, {
        method: "POST",
        body: JSON.stringify({ content: trimmed }),
      });
      if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        if (res.status === 403) msg = t("messages.errorForbidden");
        else {
          try {
            const j = await res.json();
            if (j?.message) msg = j.message;
          } catch { /* swallow body parse errors */ }
        }
        throw new Error(msg);
      }
      const json: { message: MessageRow } = await res.json();
      setItems((prev) => [...prev, json.message]);
      setDraft("");
    } catch (e: any) {
      setError(e.message || t("messages.errorLoad"));
    } finally {
      setSending(false);
    }
  }, [bookingId, draft, t]);

  /* Initial load once auth has settled. */
  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      router.push(`/login?redirect=/bookings/${bookingId}/messages`);
      return;
    }
    refreshLatest();
  }, [authLoading, user, bookingId, router, refreshLatest]);

  /* Polling — visible tab only. */
  useEffect(() => {
    if (authLoading || !user) return;
    const start = (): void => {
      if (pollTimer.current) return;
      pollTimer.current = setInterval(() => {
        if (document.visibilityState === "visible") refreshLatest();
      }, POLL_MS);
    };
    const stop = (): void => {
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };
    const onVisibility = (): void => {
      if (document.visibilityState === "visible") {
        refreshLatest();
        start();
      } else stop();
    };
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [authLoading, user, refreshLatest]);

  /* Stick to bottom on new tail. */
  useEffect(() => {
    if (!stickToBottom.current) return;
    const el = listAnchor.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [items]);

  if (authLoading) {
    return (
      <main className="min-h-screen flex items-center justify-center" style={{ background: "var(--bg)" }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
      </main>
    );
  }

  return (
    <main className="min-h-screen flex flex-col" style={{ background: "var(--bg)" }}>
      <header className="sticky top-0 z-30 backdrop-blur-2xl" style={{ background: "rgba(15,14,19,0.85)", borderBottom: "1px solid var(--border)" }}>
        <div className="max-w-3xl mx-auto px-6 py-3 flex items-center justify-between">
          <Link href="/bookings" className="text-xs opacity-60 hover:opacity-100 inline-flex items-center gap-1">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/></svg>
            {t("messages.back")}
          </Link>
          <h1 className="text-base font-bold inline-flex items-center gap-2">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
            {t("messages.title")}
          </h1>
          <div className="w-10" />
        </div>
      </header>

      <div ref={listAnchor} className="flex-1 overflow-y-auto" style={{ background: "var(--bg)" }}>
        <div className="max-w-3xl mx-auto px-4 py-4 space-y-3">
          {loading ? (
            <div className="flex items-center justify-center py-20 opacity-50">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
            </div>
          ) : error ? (
            <div className="rounded-2xl p-6 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="#F87171" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mx-auto mb-2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
              <p className="text-sm opacity-80">{error}</p>
            </div>
          ) : items.length === 0 ? (
            <div className="rounded-2xl p-12 text-center" style={{ background: "var(--surface)", border: "1px solid var(--border)" }}>
              <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-30 mx-auto mb-3"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>
              <h3 className="text-base font-bold mb-1">{t("messages.empty")}</h3>
            </div>
          ) : (
            <>
              {hasMore && (
                <div className="flex justify-center">
                  <button onClick={loadOlder} disabled={loadingOlder}
                    className="px-4 py-1.5 rounded-full text-xs font-semibold disabled:opacity-40"
                    style={{ background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border)" }}>
                    {loadingOlder ? "..." : "↑ older"}
                  </button>
                </div>
              )}
              {items.map((m) => {
                const mine = user && m.senderId === user.id;
                return (
                  <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className="max-w-[78%] rounded-2xl px-3.5 py-2.5"
                      style={{
                        background: mine ? "var(--accent)" : "var(--surface)",
                        color: mine ? "var(--bg)" : "var(--text)",
                        border: mine ? "1px solid var(--accent)" : "1px solid var(--border)",
                      }}>
                      <div className="flex items-center gap-2 mb-1 text-[10px] opacity-75">
                        <span className="font-semibold">{senderLabel(m)}</span>
                        <span title={new Date(m.createdAt).toLocaleString(fmtLocale)}>
                          {relative(m.createdAt)}
                        </span>
                      </div>
                      <div className="text-sm leading-snug whitespace-pre-wrap break-words" dir="auto">{m.content}</div>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 backdrop-blur-2xl" style={{ background: "rgba(15,14,19,0.92)", borderTop: "1px solid var(--border)" }}>
        <form
          onSubmit={(e) => { e.preventDefault(); void send(); }}
          className="max-w-3xl mx-auto px-4 py-3 flex items-end gap-2"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            rows={1} maxLength={1000}
            placeholder={t("messages.placeholder")}
            disabled={Boolean(error) || sending}
            className="flex-1 px-3 py-2 rounded-2xl text-sm outline-none resize-none disabled:opacity-40"
            style={{ background: "var(--surface-hi)", border: "1px solid var(--border)", maxHeight: "8rem", minHeight: "2.25rem" }}
          />
          <button type="submit" disabled={sending || draft.trim().length === 0}
            className="shrink-0 px-4 py-2 rounded-full text-xs font-bold disabled:opacity-40 inline-flex items-center gap-1"
            style={{ background: "var(--accent)", color: "var(--bg)" }}>
            {sending ? (
              <>
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="animate-spin"><path d="M21 12a9 9 0 11-6.219-8.56"/></svg>
                {t("messages.sending")}
              </>
            ) : t("messages.send")}
          </button>
        </form>
      </div>
    </main>
  );
}
