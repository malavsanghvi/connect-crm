// DonorDelight, Today groups (connect-crm 0890; docs/DONORDELIGHT.md section 12): the households that read Cooling or At risk, for the Care group
// on Giving > Today. Pure: no React and no server imports. The database hands over a SHORTLIST (app.care_signs_watch: households the caller may
// see whose giving may be falling) and the facts for them (app.care_health_facts); classifyHealth (health.ts) is the one place that decides a
// level and its reasons, so Today never says what the Care card does not. No amount, nothing about anyone under 18 (the cards list adults only).

import { classifyHealth, type Health, type HealthFacts } from "@/lib/care/health";
import { parseHousehold, type CareHousehold } from "@/lib/care/model";
import type { ThanksCounts3 } from "@/lib/care/thanks";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export type WatchRow = { household: CareHousehold; owner: string | null; lastTouchAt: string | null };
export type SignsWatch = { state: "ok" | "giving_off"; total: number; rows: WatchRow[] };

export function parseSignsWatch(v: unknown): SignsWatch {
  const o = obj(v);
  return {
    state: o.state === "giving_off" ? "giving_off" : "ok",
    total: num(o.total),
    rows: arr(o.rows)
      .map((r) => {
        const x = obj(r);
        return { household: parseHousehold(x.household), owner: str(x.owner), lastTouchAt: str(x.last_touch_at) };
      })
      .filter((r) => r.household.id !== ""),
  };
}

/** A household whose sign is Cooling or At risk, with every reason in words. */
export type WeakSign = { household: CareHousehold; owner: string | null; lastTouchAt: string | null; level: "cooling" | "at_risk"; label: string; reasons: string[] };

const RANK = { at_risk: 0, cooling: 1 } as const;

/**
 * The shortlist classified by the sign rules: only Cooling and At risk stay (a household the shortlist let in that reads Steady or Lapsed
 * is left out), At risk first, then the order the database gave (the longest quiet first). A household with no facts is left out, never guessed.
 */
export function weakSigns(
  watch: SignsWatch,
  facts: readonly HealthFacts[],
  ctx: { today: string; historyMonths: number; giving: boolean },
): WeakSign[] {
  const byId = new Map(facts.map((f) => [f.householdId, f]));
  const out: (WeakSign & { at: number })[] = [];
  watch.rows.forEach((r, at) => {
    const f = byId.get(r.household.id);
    if (!f) return;
    const h: Health = classifyHealth(f, ctx);
    if (h.level !== "cooling" && h.level !== "at_risk") return;
    out.push({ household: r.household, owner: r.owner, lastTouchAt: r.lastTouchAt, level: h.level, label: h.label, reasons: h.reasons, at });
  });
  out.sort((a, b) => RANK[a.level] - RANK[b.level] || a.at - b.at);
  return out.map((w) => ({ household: w.household, owner: w.owner, lastTouchAt: w.lastTouchAt, level: w.level, label: w.label, reasons: w.reasons }));
}

/** The headline of the Care group's signs row ("3 households are cooling or at risk"). */
export function weakSignsLine(n: number): string {
  return n === 1 ? "1 household is cooling or at risk" : `${n} households are cooling or at risk`;
}

/**
 * DonorDelight on Giving > Today (care holders only; the database decides who): the gifts waiting for a thank-you (three numbers, no names) and
 * the households whose sign is Cooling or At risk, each with its reasons. No amount. `more`: shortlisted households beyond those classified.
 */
export type CareTodayIn = { thanks: ThanksCounts3 | null; signs: WeakSign[]; more: boolean };
