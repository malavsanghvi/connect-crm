// The Marketplace (docs/MARKETPLACE_PACKS.md; connect-crm 0750 to 0753): what Settings › Marketplace and Platform ›
// Communities › Products show, worked out from one read, app.marketplace_states(center). Pure: no server imports, so it is
// unit-tested and usable from client components. The database is the enforcement (module grants, 0740); this is the screen.

import { MARKETPLACE_HREF } from "@/lib/ai-gate";
import { formatDate } from "@/lib/dates";

export type ProductState = "included" | "on" | "paused" | "requested" | "available" | "not_built" | "notified";
export type GrantSource = "kind_default" | "weaver" | "grandfathered" | "trial" | "trial_ended" | "none";
export type ProductNeed = { module: string; label: string; on: boolean; required: boolean };

export type Product = {
  key: string;
  moduleKey: string | null;
  name: string;
  /** The kind's own name for the module (WeCare is "Member care" for a faith kind). */
  moduleLabel: string | null;
  mark: string;
  line: string;
  gets: string[];
  needs: ProductNeed[];
  membersLine: string | null;
  dataLine: string | null;
  price: string;
  priceShort: string;
  included: boolean;
  built: boolean;
  targetQuarter: string | null;
  onNote: string | null;
  offNote: string | null;
  state: ProductState;
  enabled: boolean;
  granted: boolean;
  paused: boolean;
  waitingFor: string[];
  source: GrantSource;
  grantedAt: string | null;
  grantedByName: string | null;
  grantReason: string | null;
  pausedAt: string | null;
  pausedByName: string | null;
  requestId: string | null;
  requestNote: string | null;
  requestedAt: string | null;
  requestedByName: string | null;
  notifiedAt: string | null;
};

const STATES: readonly ProductState[] = ["included", "on", "paused", "requested", "available", "not_built", "notified"];
const SOURCES: readonly GrantSource[] = ["kind_default", "weaver", "grandfathered", "trial", "trial_ended", "none"];

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

function parseNeeds(v: unknown): ProductNeed[] {
  if (!Array.isArray(v)) return [];
  const out: ProductNeed[] = [];
  for (const n of v) {
    if (!n || typeof n !== "object") continue;
    const o = n as Record<string, unknown>;
    const key = str(o.module);
    const label = str(o.label);
    if (!key || !label) continue;
    out.push({ module: key, label, on: o.on === true, required: o.required === true });
  }
  return out;
}

/** One row of app.marketplace_states, field by field; null when it is not the expected shape. */
export function parseProduct(row: unknown): Product | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const key = str(r.key);
  const name = str(r.name);
  const state = STATES.find((s) => s === r.state);
  if (!key || !name || !state) return null;
  return {
    key,
    moduleKey: str(r.module_key),
    name,
    moduleLabel: str(r.module_label),
    mark: str(r.mark) ?? name.slice(0, 2),
    line: str(r.line) ?? "",
    gets: strs(r.gets),
    needs: parseNeeds(r.needs),
    membersLine: str(r.members_line),
    dataLine: str(r.data_line),
    price: str(r.price_text) ?? "Price not set yet",
    priceShort: str(r.price_short) ?? str(r.price_text) ?? "Price not set yet",
    included: r.included === true,
    built: r.catalog_status !== "not_built",
    targetQuarter: str(r.target_quarter),
    onNote: str(r.on_note),
    offNote: str(r.off_note),
    state,
    enabled: r.enabled === true,
    granted: r.granted === true,
    paused: r.paused === true,
    waitingFor: strs(r.waiting_for),
    source: SOURCES.find((s) => s === r.source) ?? "none",
    grantedAt: str(r.granted_at),
    grantedByName: str(r.granted_by_name),
    grantReason: str(r.grant_reason),
    pausedAt: str(r.paused_at),
    pausedByName: str(r.paused_by_name),
    requestId: str(r.request_id),
    requestNote: str(r.request_note),
    requestedAt: str(r.requested_at),
    requestedByName: str(r.requested_by_name),
    notifiedAt: str(r.notified_at),
  };
}

/** Every row, or null when any row is not the expected shape (the screen then says so instead of guessing). */
export function parseProducts(rows: readonly unknown[] | null | undefined): Product[] | null {
  const out: Product[] = [];
  for (const row of rows ?? []) {
    const p = parseProduct(row);
    if (!p) return null;
    out.push(p);
  }
  return out;
}

// ── Settings › Marketplace ───────────────────────────────────────────────────

/** Settings › Marketplace, opened on one product when given (the one route every "ask for it" link uses). */
export function marketplaceHref(product?: string | null): string {
  return product ? `${MARKETPLACE_HREF}?product=${encodeURIComponent(product)}` : MARKETPLACE_HREF;
}

export type MarketTab = "all" | "inuse" | "available" | "coming";
export const MARKET_TABS: readonly { key: MarketTab; label: string; states: readonly ProductState[] | null }[] = [
  { key: "all", label: "All", states: null },
  { key: "inuse", label: "In use", states: ["included", "on", "paused"] },
  { key: "available", label: "Available", states: ["available", "requested"] },
  { key: "coming", label: "Not built yet", states: ["not_built", "notified"] },
];

export function isMarketTab(v: unknown): v is MarketTab {
  return MARKET_TABS.some((t) => t.key === v);
}

export function productsInTab(products: readonly Product[], tab: MarketTab): Product[] {
  const states = MARKET_TABS.find((t) => t.key === tab)?.states ?? null;
  return states ? products.filter((p) => states.includes(p.state)) : [...products];
}

export type ChipTone = "included" | "on" | "paused" | "requested" | "available" | "coming";
export function chipFor(state: ProductState): { label: string; tone: ChipTone } {
  switch (state) {
    case "included":
      return { label: "Included", tone: "included" };
    case "on":
      return { label: "On", tone: "on" };
    case "paused":
      return { label: "Paused", tone: "paused" };
    case "requested":
      return { label: "Requested", tone: "requested" };
    case "not_built":
      return { label: "Not built yet", tone: "coming" };
    case "notified":
      return { label: "We will tell you", tone: "coming" };
    default:
      return { label: "Available", tone: "available" };
  }
}

/** "On" or "Off: turn it on first", as the prototype marks what a product needs. */
export function needMark(n: ProductNeed): string {
  return n.on ? "On" : "Off: turn it on first";
}

/** The line under the state in the detail panel (community view): when, by whom, and why it is on. */
export function sinceLine(p: Product, timeZone: string): string | null {
  const day = (v: string | null) => (v ? formatDate(v, timeZone) : null);
  if (p.state === "paused") {
    const when = day(p.pausedAt);
    return `Paused${p.pausedByName ? ` by ${p.pausedByName}` : ""}${when ? ` on ${when}` : ""}`;
  }
  if (p.state === "requested") {
    const when = day(p.requestedAt);
    return `Requested${p.requestedByName ? ` by ${p.requestedByName}` : ""}${when ? ` on ${when}` : ""}`;
  }
  if (p.state === "on" || p.state === "included") {
    const when = day(p.grantedAt);
    switch (p.source) {
      case "weaver":
        return when ? `On since ${when}, turned on by Weaver` : "On, turned on by Weaver";
      case "grandfathered":
        return `On${when ? ` since ${when}` : ""}. Included because your community used it before packs began`;
      case "trial":
        return "On as a trial while your community is a sandbox";
      default:
        return null;
    }
  }
  if (p.state === "available" && p.source === "trial_ended") return p.grantReason;
  if (p.state === "available" && p.source === "weaver" && p.grantedAt) {
    return `Turned off by Weaver on ${formatDate(p.grantedAt, timeZone)}. You can request it again.`;
  }
  return null;
}

export const MARKETPLACE_FOOTER =
  "Only Weaver turns a product on or off, after a check and a fresh sign-in code. Every change is recorded with who made it and why.";

/** The request form's error: what failed and that the note is kept, so "Try again" sends the same note. */
export function requestFailed(error: string): string {
  return `${error.replace(/\.$/, "")}. Your note is kept.`;
}

// ── Platform › Communities › Products ────────────────────────────────────────

export type PlatformChip = { label: string; tone: "core" | "on" | "off" | "coming" };
export type PlatformRow = {
  chip: PlatformChip;
  /** Where its state came from, in a line ("Turned on by … on …", "Grandfathered …", "Not turned on. Requested on …"). */
  source: string;
  /** The action the Weaver team can take here, or null (included by the kind, or no module yet). */
  action: "on" | "off" | null;
};

/**
 * What the Weaver team sees for one product of one community. A product included by the kind (Giving for a Jain Center) is
 * core here and has no switch (the Modules card on the community's page stays for an exception); a product not built yet can
 * still be turned on for a pilot when it has a module.
 */
export function platformRow(p: Product, timeZone: string): PlatformRow {
  const day = (v: string | null) => (v ? formatDate(v, timeZone) : null);
  const sentence = (t: string) => (/[.!?]$/.test(t) ? t : `${t}.`);
  const paused = p.paused ? ` Paused by the community${p.pausedAt ? ` on ${day(p.pausedAt)}` : ""}.` : "";
  if (!p.moduleKey) return { chip: { label: "Not built yet", tone: "coming" }, source: "Shown to communities as not built yet", action: null };
  if (p.granted && p.included && p.source === "kind_default") {
    return { chip: { label: "Core: always on", tone: "core" }, source: `Included for every community of this kind.${paused}`, action: null };
  }
  if (p.granted) {
    const when = day(p.grantedAt);
    const by =
      p.source === "weaver"
        ? `Turned on by ${p.grantedByName ?? "Weaver"}${when ? ` on ${when}` : ""}`
        : p.source === "grandfathered"
          ? `Grandfathered${when ? ` on ${when}` : ""}: ${(p.grantReason ?? "it was in use").replace(/^(Grandfathered|Enabled when)[^:]*:\s*/, "")}`
          : p.source === "trial"
            ? "On as a sandbox trial; it does not carry over when the community goes live"
            : `On for every community of this kind`;
    return { chip: { label: p.built ? "On" : "On (not built yet)", tone: "on" }, source: `${sentence(by)}${paused}`, action: "off" };
  }
  const requested = p.requestedAt ? ` Requested on ${day(p.requestedAt)}.` : "";
  const before =
    p.source === "weaver" && p.grantedAt
      ? `Turned off by ${p.grantedByName ?? "Weaver"} on ${day(p.grantedAt)}.`
      : p.source === "trial_ended"
        ? "The sandbox trial ended when the community went live."
        : "Not turned on.";
  return {
    chip: p.built ? { label: "Off", tone: "off" } : { label: "Not built yet", tone: "coming" },
    source: `${before}${requested}${p.built ? "" : " Shown to the community as not built yet."}`,
    action: "on",
  };
}

/** What the turn-on or turn-off dialog says will happen (the product's own note, else the plain default). */
export function dialogNote(p: Product, turningOn: boolean): string {
  return turningOn
    ? (p.onNote ?? "The community’s admins and members see it at once. Its admins get a message.")
    : (p.offNote ?? "Members and staff lose access at once. Nothing is deleted. Turning it on again brings everything back.");
}

/** The client-side checks before anything is sent, in the prototype's words (null when both are fine). */
export function switchFormProblem(reason: string, code: string): string | null {
  if (!reason.trim()) return "Add a reason first. It is saved in the audit log.";
  if (!/^[0-9]{6}$/.test(code.trim())) return "Enter all 6 digits of the code from your authenticator app.";
  return null;
}

/** The step-up check's answer for a wrong or expired code, in the prototype's words; any other failure as it came. */
export function codeFailed(error: string): string {
  return /code is wrong or has expired/i.test(error) ? "That code did not match. Codes change every 30 seconds, so enter the current one." : error;
}

/** The success line on the Products page: what changed, and whether the community's admins were emailed. */
export function switchDoneMessage(name: string, communityName: string, turnedOn: boolean, emailed: boolean, emailStatus: string | null): string {
  const what = `${name} is ${turnedOn ? "on" : "off"} for ${communityName}.`;
  if (emailed) return `${what} Its admins got a message.`;
  if (emailStatus === "no_recipient") return `${what} The community has no owner or requester to email, so no message was sent.`;
  return `${what} The message to its admins could not be sent${emailStatus ? ` (${emailStatus})` : ""}: tell them yourself.`;
}

/** One line of the Products page's requests list ("Requested by Sam K. (community admin) on Oct 10"). */
export function requestedLine(p: Product, timeZone: string, who = ""): string {
  const when = p.requestedAt ? formatDate(p.requestedAt, timeZone) : null;
  return `Requested${p.requestedByName ? ` by ${p.requestedByName}${who}` : ""}${when ? ` on ${when}` : ""}`;
}
