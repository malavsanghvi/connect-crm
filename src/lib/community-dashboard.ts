// The public community dashboard (/c/[slug]; CommunityDashboard.dc.html,
// docs/PROTOTYPE_COMMUNITY_DASHBOARD.md). Pure shaping of app.public_kpis()
// output — the RPC already hides counts under 10 and non-public KPIs.

export type PeriodKey = "ytd" | "l12m" | "last_year" | "all";

export type Period = { key: PeriodKey; label: string; from: string; to: string; headline: string; comparison: string | null };

function shift(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * 86_400_000);
  return t.toISOString().slice(0, 10);
}

/** The four periods of the switcher, relative to `today` (YYYY-MM-DD in the center's zone). */
export function periods(today: string): Period[] {
  const year = Number(today.slice(0, 4));
  return [
    { key: "ytd", label: "This year", from: `${year}-01-01`, to: today, headline: "this year", comparison: "vs last year" },
    { key: "l12m", label: "Last 12 months", from: shift(today, -364), to: today, headline: "last 12 months", comparison: "vs the 12 months before" },
    { key: "last_year", label: String(year - 1), from: `${year - 1}-01-01`, to: `${year - 1}-12-31`, headline: String(year - 1), comparison: `vs ${year - 2}` },
    // Deltas over "all time" compare against an empty past, so none are shown.
    { key: "all", label: "All time", from: "2000-01-01", to: today, headline: "all time", comparison: null },
  ];
}

/** 28450 → "28,450"; null (suppressed or not shared) → "—". */
export function formatCount(v: number | null | undefined): string {
  return typeof v === "number" && Number.isFinite(v) ? Math.round(v).toLocaleString("en-US") : "—";
}

/** Bar labels: 4980 → "5.0k", 312 → "312". */
export function compactCount(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v)) return "";
  return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
}

/** $4,120,000.00 in cents → "$4.12M"; smaller amounts in whole dollars. */
export function compactDollars(cents: number | null | undefined): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  const d = cents / 100;
  if (d >= 1e6) return `$${(d / 1e6).toFixed(d >= 1e7 ? 0 : 2)}M`;
  if (d >= 1e4) return `$${Math.round(d / 1e3)}K`;
  return `$${Math.round(d).toLocaleString("en-US")}`;
}

type Json = unknown;
type Obj = Record<string, Json>;
const obj = (v: Json): Obj => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Obj) : {});
const num = (v: Json): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export type Tile = { key: string; label: string; value: string; delta: string | null; sub?: string; suppressed: boolean };

const SUMMARY: { key: string; label: string; percent?: boolean }[] = [
  { key: "member_families", label: "Member families" },
  { key: "community_people", label: "People in our community" },
  { key: "events_held", label: "Events held" },
  { key: "attendance", label: "Event and class visits" },
  { key: "volunteer_hours", label: "Volunteer seva hours" },
  { key: "app_adoption", label: "Families on the app", percent: true },
];

const PRACTICE: { key: string; label: string; sub: string }[] = [
  { key: "samayik", label: "Samayiks completed", sub: "48 minutes of equanimity each" },
  { key: "pratikraman", label: "Pratikraman attendances", sub: "At the derasar and on Zoom" },
  { key: "gyan_steps", label: "Gyan Path steps completed", sub: "Small steps, every day" },
  { key: "navkar_malas", label: "Navkar malas counted", sub: "108 recitations each" },
  { key: "gyan_levels", label: "Gyan Path levels completed", sub: "Across the learning goals" },
  { key: "anumodana", label: "Anumodanas sent", sub: "Families cheering each other on" },
];

/**
 * The label a KPI carries on the public dashboard, so the portal's publish list
 * names each KPI exactly as visitors will see it (prototype: "People in our
 * community", not the catalog's "Community members"). Null for KPIs whose public
 * tile has no fixed label (charts, campaign).
 */
export function publicKpiLabel(key: string): string | null {
  return SUMMARY.find((k) => k.key === key)?.label ?? PRACTICE.find((k) => k.key === key)?.label ?? null;
}

function deltaText(key: string, deltas: Obj, period: Period): string | null {
  const d = obj(deltas[key]);
  if (key === "member_families" || key === "community_people") {
    const n = num(d.new_in_period);
    if (n === null) return null;
    return `+${formatCount(n)} ${key === "member_families" ? "new " : ""}${period.key === "ytd" ? "this year" : period.key === "all" ? "in all" : "in the period"}`;
  }
  if (key === "volunteer_hours") {
    const v = num(obj(deltas.volunteer_hours_volunteers).volunteers);
    return v === null ? null : `${formatCount(v)} volunteers`;
  }
  if (key === "app_adoption") return "of member families";
  if (!period.comparison) return null;
  const pct = num(d.change_pct);
  if (pct === null) return null;
  return `${pct >= 0 ? "+" : ""}${pct}% ${period.comparison}`;
}

/** Tiles for the keys the RPC returned (a key absent from `metrics` is not shared publicly and is not shown). */
function tiles(list: { key: string; label: string; sub?: string; percent?: boolean }[], metrics: Obj, deltas: Obj, period: Period): Tile[] {
  return list
    .filter((k) => k.key in metrics)
    .map((k) => {
      const v = num(metrics[k.key]);
      return {
        key: k.key,
        label: k.label,
        value: v === null ? "—" : k.percent ? `${Math.round(v)}%` : formatCount(v),
        delta: v === null ? "Fewer than 10 · not shown" : deltaText(k.key, deltas, period),
        sub: k.sub,
        suppressed: v === null,
      };
    });
}

export type MonthBar = { label: string; value: number | null; partial: boolean; text: string; heightPct: number; peak: boolean };
export type ZoneBar = { zone: string; families: number | null; pct: number };
export type Row = { label: string; value: string };
export type CampaignView = {
  name: string;
  raised: string;
  goal: string | null;
  percent: number | null;
  stats: { value: string; label: string }[];
};

export type DashboardView = {
  asOf: string | null;
  summary: Tile[];
  practice: Tile[];
  campaign: CampaignView | null;
  months: MonthBar[] | null;
  zones: ZoneBar[] | null;
  learning: Row[];
  seva: Row[];
  empty: boolean;
};

/** Shape app.public_kpis() JSON for the page. Unknown or missing parts become empty sections, never zeros. */
export function buildDashboard(raw: Json, period: Period): DashboardView {
  const r = obj(raw);
  const metrics = obj(r.metrics);
  const deltas = obj(r.deltas);
  const summary = tiles(SUMMARY, metrics, deltas, period);
  const practice = tiles(PRACTICE, metrics, deltas, period);

  let months: MonthBar[] | null = null;
  if (Array.isArray(r.attendance_by_month)) {
    const pts = r.attendance_by_month.map(obj);
    const max = Math.max(1, ...pts.map((p) => num(p.value) ?? 0));
    const peakValue = Math.max(...pts.map((p) => num(p.value) ?? -1));
    months = pts.map((p) => {
      const v = num(p.value);
      const partial = p.partial === true && v === null;
      return {
        label: typeof p.label === "string" ? p.label : "",
        value: v,
        partial,
        text: v === null ? "" : compactCount(v),
        heightPct: v === null ? 2 : Math.max(4, Math.round((v * 100) / max)),
        peak: v !== null && v === peakValue && peakValue > 0,
      };
    });
  }

  let zones: ZoneBar[] | null = null;
  if (Array.isArray(r.families_by_zone)) {
    const zs = r.families_by_zone.map(obj);
    const max = Math.max(1, ...zs.map((z) => num(z.families) ?? 0));
    zones = zs.map((z) => {
      const f = num(z.families);
      return { zone: typeof z.zone === "string" ? z.zone : "Zone", families: f, pct: f === null ? 0 : Math.round((f * 100) / max) };
    });
  }

  let campaign: CampaignView | null = null;
  if (r.campaign && typeof r.campaign === "object") {
    const c = obj(r.campaign);
    const pct = num(c.percent);
    const donors = num(c.donor_families);
    const part = num(c.participation_percent);
    campaign = {
      name: typeof c.name === "string" ? c.name : "Campaign",
      raised: compactDollars(num(c.pledged_cents)),
      goal: num(c.goal_cents) ? compactDollars(num(c.goal_cents)) : null,
      percent: pct,
      stats: [
        { value: pct === null ? "—" : `${pct}%`, label: "of goal" },
        { value: donors === null ? "—" : formatCount(donors), label: "donor families" },
        { value: part === null ? "—" : `${part}%`, label: "member participation" },
      ],
    };
  }

  const learning: Row[] = [];
  if ("pathshala_students" in metrics) learning.push({ label: "Pathshala students", value: formatCount(num(metrics.pathshala_students)) });
  if ("volunteer_teachers" in metrics) learning.push({ label: "Volunteer teachers", value: formatCount(num(metrics.volunteer_teachers)) });
  if ("class_attendance_rate" in metrics) {
    const v = num(metrics.class_attendance_rate);
    learning.push({ label: "Class attendance rate", value: v === null ? "—" : `${Math.round(v)}%` });
  }
  const seva: Row[] = [];
  if ("store_orders" in metrics) seva.push({ label: "Satvik Store orders", value: formatCount(num(metrics.store_orders)) });

  const asOf = typeof r.as_of === "string" ? r.as_of.slice(0, 10) : null;
  const empty = summary.length === 0 && practice.length === 0 && !campaign && !months && !zones && learning.length === 0 && seva.length === 0;
  return { asOf, summary, practice, campaign, months, zones, learning, seva, empty };
}
