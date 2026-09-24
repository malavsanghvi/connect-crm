"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { TenantMark } from "@/components/shell/tenant-mark";
import { buildDashboard, periods, type DashboardView, type PeriodKey } from "@/lib/community-dashboard";
import type { Database } from "@/lib/database.types";
import { explainError } from "@/lib/errors";
import type { TenantBranding } from "@/lib/shell";
import { tracingFetch } from "@/lib/supabase/trace";

const TINTS = [
  ["#EEF1F8", "#1B2C5C"],
  ["#FBEBD7", "#8A4608"],
  ["#E4F2EA", "#1F7A4D"],
  ["#EFEBF6", "#5B4B8A"],
  ["#FBEBD7", "#8A4608"],
  ["#E4F2EA", "#1F7A4D"],
] as const;

type Result = { key: PeriodKey; seq: number } & ({ status: "error"; message: string } | { status: "ok"; view: DashboardView });

/** CommunityDashboard.dc.html, rendered from app.public_kpis() with an anonymous client. */
export function CommunityDashboard({
  env,
  slug,
  name,
  shortName,
  branding,
  today,
  joinUrl,
}: {
  env: { supabaseUrl: string; supabaseAnonKey: string };
  slug: string;
  name: string;
  shortName: string;
  branding: TenantBranding;
  today: string;
  joinUrl: string | null;
}) {
  const all = useMemo(() => periods(today), [today]);
  const [key, setKey] = useState<PeriodKey>("ytd");
  const [result, setResult] = useState<Result | null>(null);
  const [retrying, setRetrying] = useState(false);
  const client = useRef<SupabaseClient<Database, "app"> | null>(null);
  const seq = useRef(0);
  const period = all.find((p) => p.key === key) ?? all[0];

  // Fetch one period; state is only set in the response callbacks.
  const fetchPeriod = useCallback(
    (k: PeriodKey) => {
      const p = all.find((x) => x.key === k) ?? all[0];
      client.current ??= createClient<Database, "app">(env.supabaseUrl, env.supabaseAnonKey, {
        db: { schema: "app" },
        auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
        global: { fetch: tracingFetch(() => window.location.pathname) },
      });
      const my = ++seq.current;
      client.current
        .rpc("public_kpis", { p_slug: slug, p_from: p.from, p_to: p.to })
        .then(({ data, error }) => {
          if (my !== seq.current) return;
          setRetrying(false);
          if (error) {
            console.error("[public-dashboard] public_kpis failed:", error);
            setResult({ key: k, seq: my, status: "error", message: `We could not load the numbers — ${explainError(error)}.` });
          } else if (data === null) {
            setResult({ key: k, seq: my, status: "error", message: "This community's dashboard is not available right now." });
          } else {
            setResult({ key: k, seq: my, status: "ok", view: buildDashboard(data, p) });
          }
        })
        .then(undefined, (err: unknown) => {
          if (my !== seq.current) return;
          console.error("[public-dashboard] request failed:", err);
          setRetrying(false);
          setResult({ key: k, seq: my, status: "error", message: "We could not reach the server. Check your connection and try again." });
        });
    },
    [all, env.supabaseUrl, env.supabaseAnonKey, slug],
  );

  useEffect(() => {
    fetchPeriod(key);
  }, [key, fetchPeriod]);

  function retry() {
    setRetrying(true);
    fetchPeriod(key);
  }

  const state = !result || result.key !== key || retrying ? { status: "loading" as const } : result;
  const loading = state.status === "loading";
  const v = state.status === "ok" ? state.view : null;

  return (
    <div className="min-h-screen bg-ground font-sans text-ink">
      <header className="flex flex-wrap items-center gap-4 border-b border-[#E8E0D2] bg-white px-4 py-[18px] sm:px-10">
        <TenantMark branding={branding} name={name} size={44} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display text-[22px] font-semibold text-navy">{shortName} Community Dashboard</h1>
          <p className="text-[13px] text-muted">{name} · open to everyone, no sign-in needed</p>
        </div>
        <div role="radiogroup" aria-label="Period" className="flex flex-wrap gap-1 rounded-[14px] bg-[#F6EFE3] p-1">
          {all.map((p) => (
            <button
              key={p.key}
              type="button"
              role="radio"
              aria-checked={p.key === key}
              onClick={() => setKey(p.key)}
              className={`min-h-10 rounded-[10px] px-3.5 text-[13px] font-bold ${p.key === key ? "bg-navy text-white" : "bg-transparent text-muted"}`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </header>

      <main className="mx-auto flex max-w-[1280px] flex-col gap-[22px] px-4 pb-10 pt-6 sm:px-10">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-[28px] font-semibold">Our community · {period.headline}</h2>
          <p className="text-[13px] text-muted" aria-live="polite">
            {loading ? "Fetching latest numbers…" : v?.asOf ? `Updated ${v.asOf} · refreshed nightly` : ""}
          </p>
        </div>

        {state.status === "error" ? (
          <div role="alert" className="rounded-[20px] border border-danger/30 bg-danger-50 p-5 text-[14px] text-danger">
            <p className="font-bold">The dashboard could not load</p>
            <p className="mt-1">{state.message}</p>
            <button type="button" onClick={retry} className="cc-btn cc-btn-bad mt-3">
              Try again
            </button>
          </div>
        ) : null}

        {v?.empty ? (
          <div className="rounded-[20px] border border-line bg-white p-6 text-center text-[14px] text-muted">
            {shortName} has not published any numbers yet.
          </div>
        ) : null}

        {loading || (v && v.summary.length > 0) ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            {(loading ? Array.from({ length: 6 }, () => null) : v!.summary).map((k, i) => (
              <div key={k?.key ?? i} className="flex min-h-[104px] flex-col gap-1 rounded-[18px] border border-[#E8E0D2] bg-white p-4">
                <p className={`text-xs font-semibold ${k ? "text-muted" : "text-[#B9AE99]"}`}>{k?.label ?? "Loading…"}</p>
                <p className={`text-[28px] font-extrabold ${k ? "text-navy" : "cd-shimmer text-[#B9AE99]"}`}>{k?.value ?? "—"}</p>
                <p className={`text-xs font-semibold ${k?.suppressed ? "text-muted" : "text-success"}`}>{k?.delta ?? " "}</p>
              </div>
            ))}
          </div>
        ) : null}

        {loading || (v && (v.practice.length > 0 || v.campaign)) ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
            {loading || (v && v.practice.length > 0) ? (
              <section className="flex flex-col gap-3.5 rounded-[20px] border border-[#E8E0D2] bg-white p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[17px] font-bold">Practicing together</h3>
                  <p className="text-xs text-muted">From My Jain Way and Gyan Path · totals only</p>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
                  {(loading ? Array.from({ length: 6 }, () => null) : v!.practice).map((k, i) => (
                    <div
                      key={k?.key ?? i}
                      className={`flex flex-col gap-0.5 rounded-[14px] p-3.5 ${k ? "" : "cd-shimmer"}`}
                      style={{ background: k ? TINTS[i % 6][0] : "#F6EFE3" }}
                    >
                      <p className="text-[24px] font-extrabold" style={{ color: k ? TINTS[i % 6][1] : "#B9AE99" }}>
                        {k?.value ?? "—"}
                      </p>
                      <p className="text-[13px] font-semibold">{k?.label ?? "Loading…"}</p>
                      <p className="text-[11px] text-muted">{k ? (k.suppressed ? "Fewer than 10 · not shown" : k.sub) : " "}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
            {loading || v?.campaign ? (
              <section className="flex flex-col gap-3.5 rounded-[20px] border border-[#E8E0D2] bg-white p-5">
                <h3 className="text-[17px] font-bold">{v?.campaign?.name ?? "Campaign"}</h3>
                <p className={`font-display text-[34px] font-semibold text-brown ${loading ? "cd-shimmer" : ""}`}>
                  {v?.campaign?.raised ?? "—"}{" "}
                  {v?.campaign?.goal ? <span className="font-sans text-base text-muted">of {v.campaign.goal} goal</span> : null}
                </p>
                <div className="h-4 rounded-lg bg-track" role="img" aria-label={`${v?.campaign?.percent ?? 0}% of goal`}>
                  <div className="h-4 rounded-lg bg-saffron" style={{ width: `${v?.campaign?.percent ?? 0}%` }} />
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {(v?.campaign?.stats ?? [{ value: "—", label: "Loading…" }, { value: "—", label: "" }, { value: "—", label: "" }]).map((s, i) => (
                    <div key={i}>
                      <p className="text-[20px] font-extrabold">{s.value}</p>
                      <p className="text-xs text-muted">{s.label}</p>
                    </div>
                  ))}
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {loading || (v && (v.months || v.zones)) ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.3fr_1fr]">
            {loading || v?.months ? (
              <section className="flex flex-col gap-3 rounded-[20px] border border-[#E8E0D2] bg-white p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[17px] font-bold">Attendance by month</h3>
                  <p className="text-xs text-muted">Check-ins at all events and Pathshala</p>
                </div>
                <div className="flex h-[200px] items-end gap-1.5 border-b border-[#E8E0D2] pt-4 sm:gap-2">
                  {(v?.months ?? Array.from({ length: 12 }, () => null)).map((m, i) => (
                    <div key={i} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[10px] font-semibold text-muted">{m?.text ?? ""}</span>
                      <span
                        className={`block w-full max-w-10 rounded-t-md ${m ? "" : "cd-shimmer"}`}
                        style={{
                          height: m ? `${m.heightPct}%` : "30%",
                          background: !m || m.value === null ? "#E3DCCF" : m.peak ? "#C9731C" : "#1B2C5C",
                        }}
                      />
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5 sm:gap-2">
                  {(v?.months ?? Array.from({ length: 12 }, () => null)).map((m, i) => (
                    <span key={i} className="flex-1 text-center text-[11px] text-muted">
                      {m?.label ?? "JFMAMJJASOND"[i]}
                    </span>
                  ))}
                </div>
                <p className="text-xs text-muted">Months still to come, and months with fewer than 10 visits, show as empty bars.</p>
              </section>
            ) : null}
            {loading || v?.zones ? (
              <section className="flex flex-col gap-2.5 rounded-[20px] border border-[#E8E0D2] bg-white p-5">
                <h3 className="text-[17px] font-bold">Families by zone</h3>
                {(v?.zones ?? Array.from({ length: 7 }, () => null)).map((z, i) => (
                  <div key={i} className="flex items-center gap-2.5 text-[13px]">
                    <span className="w-[86px] flex-none truncate font-semibold">{z?.zone ?? "…"}</span>
                    <span className="h-3.5 flex-1 rounded-[7px] bg-track">
                      <span className={`block h-3.5 rounded-[7px] bg-navy ${z ? "" : "cd-shimmer"}`} style={{ width: `${z ? z.pct : 50}%` }} />
                    </span>
                    <span className="w-10 flex-none text-right font-bold">{z ? (z.families === null ? "<10" : z.families.toLocaleString("en-US")) : ""}</span>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        ) : null}

        {loading || (v && (v.learning.length > 0 || v.seva.length > 0)) ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {[
              { title: "Pathshala and learning", rows: v?.learning },
              { title: "Seva and community care", rows: v?.seva },
            ]
              .filter((c) => loading || (c.rows && c.rows.length > 0))
              .map((c) => (
                <section key={c.title} className="flex flex-col gap-2.5 rounded-[20px] border border-[#E8E0D2] bg-white p-5">
                  <h3 className="text-[17px] font-bold">{c.title}</h3>
                  {(c.rows ?? Array.from({ length: 3 }, () => null)).map((r, i) => (
                    <div key={i} className="flex justify-between border-b border-track pb-2 text-[14px]">
                      <span className="text-ink-2">{r?.label ?? "Loading…"}</span>
                      <span className={`font-extrabold ${r ? "" : "cd-shimmer text-[#B9AE99]"}`}>{r?.value ?? "—"}</span>
                    </div>
                  ))}
                </section>
              ))}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-4 rounded-[20px] bg-navy px-[22px] py-[18px] text-white">
          <div className="min-w-0 flex-1">
            <p className="text-base font-bold">Be part of these numbers</p>
            <p className="text-[13px] text-navy-200">Everything here is aggregated. Groups smaller than 10 are hidden, and no individual is ever shown.</p>
          </div>
          {joinUrl ? (
            <a href={joinUrl} className="flex min-h-11 items-center rounded-[22px] bg-[#E8892A] px-5 text-[14px] font-bold text-white no-underline">
              New to {shortName}? Start here
            </a>
          ) : null}
        </div>
      </main>
      <style>{`@keyframes kShim{0%{opacity:.45}50%{opacity:.9}100%{opacity:.45}}.cd-shimmer{animation:kShim 1.1s infinite}@media (prefers-reduced-motion: reduce){.cd-shimmer{animation:none}}`}</style>
    </div>
  );
}
