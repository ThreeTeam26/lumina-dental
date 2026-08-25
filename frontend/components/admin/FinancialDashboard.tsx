"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Wallet,
  CalendarDays,
  AlertCircle,
  Loader2,
  Banknote,
  CircleDollarSign,
  Coins,
  RefreshCw,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import {
  ApiError,
  FinanceSummary,
  fetchFinanceSummary,
} from "@/lib/api";
import { useLanguage } from "@/lib/i18n/LanguageContext";

type Preset = "today" | "week" | "month" | "m3" | "m6" | "custom";

const GOLD = "#b99a6b";

const localIso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function rangeFor(preset: Preset, customStart: string, customEnd: string): { start: string; end: string } {
  const today = new Date();
  const end = localIso(today);
  if (preset === "today") return { start: end, end };
  if (preset === "week") {
    const mon = new Date(today);
    mon.setDate(mon.getDate() - ((mon.getDay() + 6) % 7)); // back to Monday
    const sun = new Date(mon);
    sun.setDate(mon.getDate() + 6); // full week → Sunday
    return { start: localIso(mon), end: localIso(sun) };
  }
  if (preset === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0); // last day of month
    return { start: localIso(first), end: localIso(last) };
  }
  if (preset === "m3") {
    const d = new Date(today);
    d.setDate(d.getDate() - 89);
    return { start: localIso(d), end };
  }
  if (preset === "m6") {
    const d = new Date(today);
    d.setDate(d.getDate() - 179);
    return { start: localIso(d), end };
  }
  return { start: customStart || end, end: customEnd || end };
}

function money(n: number, currency: string): string {
  const rounded = Math.round(n * 100) / 100;
  const str = Number.isInteger(rounded) ? rounded.toLocaleString("en-US") : rounded.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${str} ${currency}`;
}

function shortLabel(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y) return iso;
  return new Date(y, m - 1, d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function FinancialDashboard({ token, onAuthError }: { token: string; onAuthError?: () => void }) {
  const { t, dir } = useLanguage();

  const [preset, setPreset] = useState<Preset>("month");
  const [customStart, setCustomStart] = useState(localIso(new Date(new Date().getFullYear(), new Date().getMonth(), 1)));
  const [customEnd, setCustomEnd] = useState(localIso(new Date()));

  const { start, end } = useMemo(() => rangeFor(preset, customStart, customEnd), [preset, customStart, customEnd]);

  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const sum = await fetchFinanceSummary(token, start, end);
      setSummary(sum);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
        onAuthError?.();
        return;
      }
      setError(err instanceof ApiError ? err.message : t("admin.financial.loadError"));
    } finally {
      setLoading(false);
    }
  }, [token, start, end, onAuthError, t]);

  useEffect(() => {
    load();
  }, [load]);

  // The figures are a snapshot from when the view was opened. If the admin
  // deletes a booking or removes a payment in another tab/window and comes
  // back here, re-pull so finance never lingers on money that's already gone.
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === "visible") load();
    };
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [load]);

  const currency = summary?.currency ?? "EGP";
  const k = summary?.kpis;

  const presets: { id: Preset; label: string }[] = [
    { id: "today", label: t("admin.financial.filters.today") },
    { id: "week", label: t("admin.financial.filters.week") },
    { id: "month", label: t("admin.financial.filters.month") },
    { id: "m3", label: t("admin.financial.filters.m3") },
    { id: "m6", label: t("admin.financial.filters.m6") },
    { id: "custom", label: t("admin.financial.filters.custom") },
  ];

  return (
    <div className="space-y-6">
      {/* ── Header + date filters ─────────────────────────────────────────── */}
      <div className="bg-white border border-[#101820]/10 rounded-2xl p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-11 w-11 rounded-xl bg-[#101820] text-[#b99a6b] flex items-center justify-center">
              <CircleDollarSign className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-serif text-2xl font-medium text-[#101820]">{t("admin.financial.title")}</h2>
              <p className="text-xs text-[#101820]/50 mt-0.5">{t("admin.financial.subtitle")}</p>
            </div>
          </div>
          <button
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#f4f1eb] border border-[#101820]/10 text-xs font-medium text-[#101820]/70 hover:text-[#101820] transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
            {t("admin.financial.refresh")}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {presets.map((p) => (
            <button
              key={p.id}
              onClick={() => setPreset(p.id)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-medium uppercase tracking-[0.1em] transition-all ${
                preset === p.id ? "bg-[#101820] text-[#f4f1eb] shadow" : "bg-[#f4f1eb] text-[#101820]/60 hover:text-[#101820]"
              }`}
            >
              {p.label}
            </button>
          ))}
          {preset === "custom" && (
            <div className="flex items-center gap-2 flex-wrap">
              <input
                type="date"
                value={customStart}
                max={customEnd}
                onChange={(e) => setCustomStart(e.target.value)}
                className="bg-[#f4f1eb] border border-[#101820]/15 rounded-xl px-3 py-1.5 text-xs text-[#101820] outline-none focus:border-[#b99a6b]"
              />
              <span className="text-[#101820]/40 text-xs">→</span>
              <input
                type="date"
                value={customEnd}
                min={customStart}
                max={localIso(new Date())}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="bg-[#f4f1eb] border border-[#101820]/15 rounded-xl px-3 py-1.5 text-xs text-[#101820] outline-none focus:border-[#b99a6b]"
              />
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2.5 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-700 text-sm">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading && !summary ? (
        <div className="flex items-center justify-center py-24 text-[#101820]/50">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : k ? (
        <>
          {/* ── Revenue KPIs — total split into its two sources ────────────── */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Kpi accent="gold" icon={<Banknote className="w-5 h-5" />} label={t("admin.financial.kpi.totalRevenue")} value={money(k.total_revenue, currency)} />
            <Kpi accent="gold" icon={<CircleDollarSign className="w-5 h-5" />} label={t("admin.financial.kpi.feeRevenue")} value={money(k.fee_revenue, currency)} />
            <Kpi accent="gold" icon={<Coins className="w-5 h-5" />} label={t("admin.financial.kpi.extraRevenue")} value={money(k.extra_revenue, currency)} />
            <Kpi accent="amber" icon={<Wallet className="w-5 h-5" />} label={t("admin.financial.kpi.pendingPayments")} value={money(k.pending_payments, currency)} />
          </div>

          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <Kpi small icon={<CircleDollarSign className="w-4 h-4" />} label={t("admin.financial.kpi.todayRevenue")} value={money(k.today_revenue, currency)} />
            <Kpi small icon={<CalendarDays className="w-4 h-4" />} label={t("admin.financial.kpi.weekRevenue")} value={money(k.week_revenue, currency)} />
            <Kpi small icon={<CalendarDays className="w-4 h-4" />} label={t("admin.financial.kpi.monthRevenue")} value={money(k.month_revenue, currency)} />
          </div>

          {/* ── Revenue by day ─────────────────────────────────────────────── */}
          <div className="bg-white border border-[#101820]/10 rounded-2xl p-5 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <h3 className="font-serif text-lg font-medium text-[#101820]">{t("admin.financial.charts.revenueByDay")}</h3>
              <div className="flex items-center gap-4 text-[0.7rem] text-[#101820]/60">
                <Legend color={GOLD} label={t("admin.financial.charts.revenueLegend")} />
              </div>
            </div>
            <RevenueByDayChart data={summary!.revenue_series} currency={currency} emptyLabel={t("admin.financial.charts.noData")} />
          </div>

          {/* ── Recent transactions ────────────────────────────────────────── */}
          <div className="bg-white border border-[#101820]/10 rounded-2xl shadow-sm overflow-hidden">
            <h3 className="font-serif text-lg font-medium text-[#101820] p-5 pb-3">{t("admin.financial.transactions.title")}</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse" dir={dir}>
                <thead>
                  <tr className="border-y border-[#101820]/10 bg-[#f4f1eb]/50 text-[0.62rem] font-medium uppercase tracking-[0.15em] text-[#101820]/50">
                    <th className="py-3 px-5">{t("admin.financial.transactions.date")}</th>
                    <th className="py-3 px-5">{t("admin.financial.transactions.description")}</th>
                    <th className="py-3 px-5">{t("admin.financial.transactions.type")}</th>
                    <th className="py-3 px-5 text-end">{t("admin.financial.transactions.amount")}</th>
                    <th className="py-3 px-5">{t("admin.financial.transactions.status")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#101820]/5 text-sm">
                  {summary!.recent_transactions.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-xs text-[#101820]/50">{t("admin.financial.transactions.empty")}</td>
                    </tr>
                  ) : (
                    summary!.recent_transactions.map((tx) => (
                      <tr key={tx.id} className="hover:bg-[#f4f1eb]/40 transition-colors">
                        <td className="py-3 px-5 text-xs text-[#101820]/70 whitespace-nowrap">{tx.date}</td>
                        <td className="py-3 px-5">
                          <div className="font-medium text-[#101820]">{tx.title}</div>
                          {tx.subtitle && <div className="text-[0.7rem] text-[#101820]/50">{tx.subtitle}</div>}
                        </td>
                        <td className="py-3 px-5">
                          <span
                            className={`inline-flex items-center gap-1 text-[0.68rem] font-medium px-2.5 py-1 rounded-lg border ${
                              tx.kind === "revenue"
                                ? "bg-[#b99a6b]/15 border-[#b99a6b]/40 text-[#8a6d3f]"
                                : "bg-[#b3452f]/10 border-[#b3452f]/30 text-[#b3452f]"
                            }`}
                          >
                            {tx.kind === "revenue" ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
                            {tx.kind === "revenue" ? t("admin.financial.transactions.revenueType") : t("admin.financial.transactions.expenseType")}
                          </span>
                        </td>
                        <td className={`py-3 px-5 text-end font-mono font-medium whitespace-nowrap ${tx.amount >= 0 ? "text-emerald-700" : "text-[#b3452f]"}`}>
                          {tx.amount >= 0 ? "+" : "−"} {money(Math.abs(tx.amount), currency)}
                        </td>
                        <td className="py-3 px-5">
                          <span
                            className={`text-[0.68rem] font-medium px-2.5 py-1 rounded-full ${
                              tx.status === "paid" ? "bg-emerald-500/15 text-emerald-800" : "bg-amber-500/15 text-amber-800"
                            }`}
                          >
                            {tx.status === "paid" ? t("admin.financial.transactions.paid") : t("admin.financial.transactions.pending")}
                          </span>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-[0.7rem] text-[#101820]/40 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("admin.financial.note")}
          </p>
        </>
      ) : null}
    </div>
  );
}

// ── Small building blocks ───────────────────────────────────────────────────
function Kpi({
  label,
  value,
  icon,
  accent = "ink",
  small = false,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: "gold" | "emerald" | "amber" | "red" | "ink";
  small?: boolean;
}) {
  const accents: Record<string, string> = {
    gold: "text-[#b99a6b]",
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    red: "text-[#b3452f]",
    ink: "text-[#101820]/50",
  };
  const valueAccents: Record<string, string> = {
    gold: "text-[#101820]",
    emerald: "text-emerald-700",
    amber: "text-amber-700",
    red: "text-[#b3452f]",
    ink: "text-[#101820]",
  };
  return (
    <div className="bg-white border border-[#101820]/10 rounded-2xl p-4 shadow-sm">
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[0.62rem] font-medium uppercase tracking-[0.14em] text-[#101820]/50">{label}</span>
        <span className={accents[accent]}>{icon}</span>
      </div>
      <div className={`font-serif ${small ? "text-xl" : "text-2xl"} font-medium ${valueAccents[accent]} tabular-nums`}>{value}</div>
    </div>
  );
}

function Legend({ color, label, line = false }: { color: string; label: string; line?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block rounded" style={line ? { width: 14, height: 2, background: color } : { width: 10, height: 10, background: color }} />
      {label}
    </span>
  );
}

// ── Revenue by day: one gold bar per day/bucket ─────────────────────────────
function RevenueByDayChart({ data, currency, emptyLabel }: { data: { label: string; revenue: number }[]; currency: string; emptyLabel: string }) {
  const W = 720;
  const H = 240;
  const padL = 56;
  const padR = 12;
  const padT = 12;
  const padB = 28;
  const chartW = W - padL - padR;
  const chartH = H - padT - padB;

  const max = Math.max(1, ...data.map((d) => d.revenue));
  const niceMax = niceCeil(max);
  const n = data.length || 1;
  const step = chartW / n;
  const barW = Math.max(2, Math.min(36, step * 0.6));
  const y = (v: number) => padT + chartH - (v / niceMax) * chartH;
  const cx = (i: number) => padL + step * i + step / 2;

  const total = data.reduce((s, d) => s + d.revenue, 0);
  const gridVals = [0, 0.25, 0.5, 0.75, 1].map((f) => f * niceMax);
  const labelEvery = Math.ceil(n / 8);

  if (total === 0) return <EmptyChart label={emptyLabel} />;

  return (
    <div dir="ltr" className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }} role="img">
        {gridVals.map((v, i) => (
          <g key={i}>
            <line x1={padL} y1={y(v)} x2={W - padR} y2={y(v)} stroke="#101820" strokeOpacity={0.07} />
            <text x={padL - 8} y={y(v) + 3} textAnchor="end" fontSize="9" fill="#101820" fillOpacity={0.45}>
              {compact(v)}
            </text>
          </g>
        ))}
        {data.map((d, i) => (
          <rect key={i} x={cx(i) - barW / 2} y={y(d.revenue)} width={barW} height={Math.max(0, padT + chartH - y(d.revenue))} rx={2} fill={GOLD}>
            <title>{`${shortLabel(d.label)} · ${money(d.revenue, currency)}`}</title>
          </rect>
        ))}
        {data.map((d, i) =>
          i % labelEvery === 0 ? (
            <text key={i} x={cx(i)} y={H - 10} textAnchor="middle" fontSize="9" fill="#101820" fillOpacity={0.45}>
              {shortLabel(d.label)}
            </text>
          ) : null
        )}
      </svg>
    </div>
  );
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center h-[200px] text-xs text-[#101820]/40">
      {label}
    </div>
  );
}

// ── helpers ─────────────────────────────────────────────────────────────────
function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const norm = v / mag;
  const nice = norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 5 ? 5 : 10;
  return nice * mag;
}

function compact(v: number): string {
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(v % 1_000_000 === 0 ? 0 : 1)}M`;
  if (v >= 1000) return `${(v / 1000).toFixed(v % 1000 === 0 ? 0 : 1)}k`;
  return String(Math.round(v));
}
