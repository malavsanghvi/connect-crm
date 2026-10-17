// CatchTheMatch Phase 1 (migrations 0886-0888, docs/CATCH_THE_MATCH.md section 12): the members whose gift may be matched and who have not
// asked, the claims, and the library of how to claim from each employer. Pure: no I/O. The database decides who may read and what comes
// back (counts and dates; an amount only for a role that also sees giving); this file only reads what it was given and writes the words.

import { formatDay, householdLine, parseHousehold, type CareHousehold } from "@/lib/care/model";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const numOrNull = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const bool = (v: unknown): boolean => v === true;

// ── Claims ───────────────────────────────────────────────────────────────────

export const CLAIM_STATES = ["asked", "requested", "verified", "received", "declined", "expired", "withdrawn"] as const;
export type ClaimState = (typeof CLAIM_STATES)[number];
export const OPEN_STATES: readonly ClaimState[] = ["asked", "requested", "verified"];

export const CLAIM_STATE_LABEL: Record<ClaimState, string> = {
  asked: "Asked",
  requested: "Requested by the member",
  verified: "Verified in the portal",
  received: "Match received",
  declined: "Declined by the employer",
  expired: "Deadline passed",
  withdrawn: "Withdrawn",
};

export const CLAIM_MOVE_LABEL: Record<ClaimState, string> = {
  asked: "Open it again",
  requested: "The member asked their employer",
  verified: "Verified in the portal",
  received: "The match was paid to us",
  declined: "The employer declined",
  expired: "The deadline passed",
  withdrawn: "Withdrawn",
};

export function isClaimState(v: unknown): v is ClaimState {
  return typeof v === "string" && (CLAIM_STATES as readonly string[]).includes(v);
}

/** The states a claim can move to from where it stands: an open claim to any other; an ended one only back to "asked" (a mistake). */
export function claimMoves(state: ClaimState): ClaimState[] {
  if (OPEN_STATES.includes(state)) return CLAIM_STATES.filter((s) => s !== state && s !== "asked");
  return ["asked"];
}

export type Household = CareHousehold;
const household = (v: unknown): Household | null => (v && typeof v === "object" ? parseHousehold(v) : null);
export { householdLine };

// ── The list of members to catch ─────────────────────────────────────────────

export type CatchGift = { paymentId: string; receivedOn: string; amountCents: number | null; deadlineOn: string | null; daysLeft: number | null };
export type WhoSubmits = "member" | "organization" | "either";
const whoSubmits = (v: unknown): WhoSubmits => (v === "organization" || v === "either" ? v : "member");

export type CatchRow = {
  person: { id: string; name: string };
  household: Household | null;
  employer: string;
  program: { id: string; companyName: string; portal: string | null; portalUrl: string | null; deadlineNote: string | null };
  provenReceived: number;
  provenLastOn: string | null;
  process: { whoSubmits: WhoSubmits; version: number } | null;
  gifts: CatchGift[];
};
export type OrgIdentity = { name: string; legalName: string | null; ein: string | null };
export type CatchList = {
  filter: "catchable" | "missed";
  total: number;
  rows: CatchRow[];
  counts: { catchable: number; missed: number; open: number; ended: number };
  amounts: boolean;
  today: string;
  org: OrgIdentity;
  canManage: boolean;
};

const parseOrg = (v: unknown): OrgIdentity => {
  const o = obj(v);
  return { name: str(o.name) ?? "our organization", legalName: str(o.legal_name), ein: str(o.ein) };
};

export function parseCatchList(v: unknown): CatchList {
  const o = obj(v);
  const c = obj(o.counts);
  return {
    filter: o.filter === "missed" ? "missed" : "catchable",
    total: num(o.total),
    rows: arr(o.rows).map((x) => {
      const r = obj(x);
      const p = obj(r.program);
      const proven = obj(r.proven);
      const pr = r.process && typeof r.process === "object" ? obj(r.process) : null;
      return {
        person: { id: str(obj(r.person).id) ?? "", name: str(obj(r.person).name) ?? "A member" },
        household: household(r.household),
        employer: str(r.employer) ?? "",
        program: { id: str(p.id) ?? "", companyName: str(p.company_name) ?? "", portal: str(p.portal), portalUrl: str(p.portal_url), deadlineNote: str(p.deadline_note) },
        provenReceived: num(proven.received),
        provenLastOn: str(proven.last_on),
        process: pr ? { whoSubmits: whoSubmits(pr.who_submits), version: num(pr.version) } : null,
        gifts: arr(r.gifts).map((g) => {
          const e = obj(g);
          return { paymentId: str(e.payment_id) ?? "", receivedOn: str(e.received_on) ?? "", amountCents: numOrNull(e.amount_cents), deadlineOn: str(e.deadline_on), daysLeft: numOrNull(e.days_left) };
        }),
      };
    }),
    counts: { catchable: num(c.catchable), missed: num(c.missed), open: num(c.open), ended: num(c.ended) },
    amounts: bool(o.amounts),
    today: str(o.today) ?? "",
    org: parseOrg(o.org),
    canManage: bool(o.can_manage),
  };
}

// ── The claims ───────────────────────────────────────────────────────────────

export type ClaimRow = {
  id: string;
  state: ClaimState;
  stateAt: string;
  /** When the member was asked by a message sent from Weaver (0921); null when staff asked another way. */
  askedByMessageAt: string | null;
  /** When the member said, in the app, that they asked their employer (0922); null when staff moved the claim themselves. */
  requestedByMemberAt: string | null;
  receivedOn: string | null;
  note: string | null;
  person: { id: string; name: string };
  household: Household | null;
  program: { id: string; companyName: string; portal: string | null; portalUrl: string | null };
  gift: { paymentId: string; receivedOn: string; amountCents: number | null };
  /** The employer's match recorded in Giving for this claim (0925); the payment and the amount only for a role that also sees giving. */
  match: { recorded: boolean; paymentId: string | null; amountCents: number | null };
  deadlineOn: string | null;
};
export type ClaimsList = {
  filter: "open" | "ended";
  total: number;
  rows: ClaimRow[];
  amounts: boolean;
  today: string;
  canManage: boolean;
  /** Matching.manage with a giving permission: the match can be recorded in Giving from here (0925). */
  canRecord: boolean;
};

/** One claim as the list and the single read both return it; null when it has no id or an unknown state. */
export function parseClaimRow(x: unknown): ClaimRow | null {
  const r = obj(x);
  const state = r.state;
  const id = str(r.id);
  if (!id || !isClaimState(state)) return null;
  const p = obj(r.program);
  const g = obj(r.gift);
  const m = obj(r.match);
  return {
    id,
    state,
    stateAt: str(r.state_at) ?? "",
    askedByMessageAt: str(r.asked_by_message_at),
    requestedByMemberAt: str(r.requested_by_member_at),
    receivedOn: str(r.received_on),
    note: str(r.note),
    person: { id: str(obj(r.person).id) ?? "", name: str(obj(r.person).name) ?? "A member" },
    household: household(r.household),
    program: { id: str(p.id) ?? "", companyName: str(p.company_name) ?? "", portal: str(p.portal), portalUrl: str(p.portal_url) },
    gift: { paymentId: str(g.payment_id) ?? "", receivedOn: str(g.received_on) ?? "", amountCents: numOrNull(g.amount_cents) },
    match: { recorded: bool(m.recorded), paymentId: str(m.payment_id), amountCents: numOrNull(m.amount_cents) },
    deadlineOn: str(r.deadline_on),
  };
}

export function parseClaimsList(v: unknown): ClaimsList {
  const o = obj(v);
  return {
    filter: o.filter === "ended" ? "ended" : "open",
    total: num(o.total),
    rows: arr(o.rows).flatMap((x) => {
      const row = parseClaimRow(x);
      return row ? [row] : [];
    }),
    amounts: bool(o.amounts),
    today: str(o.today) ?? "",
    canManage: bool(o.can_manage),
    canRecord: bool(o.can_record),
  };
}

export type PersonGifts = {
  person: { id: string; name: string };
  household: Household | null;
  program: { id: string; companyName: string; portal: string | null } | null;
  gifts: { paymentId: string; receivedOn: string; amountCents: number | null; claim: { id: string; state: ClaimState } | null }[];
  amounts: boolean;
  today: string;
  canManage: boolean;
};

export function parsePersonGifts(v: unknown): PersonGifts {
  const o = obj(v);
  const p = o.program && typeof o.program === "object" ? obj(o.program) : null;
  return {
    person: { id: str(obj(o.person).id) ?? "", name: str(obj(o.person).name) ?? "A member" },
    household: household(o.household),
    program: p ? { id: str(p.id) ?? "", companyName: str(p.company_name) ?? "", portal: str(p.portal) } : null,
    gifts: arr(o.gifts).map((g) => {
      const e = obj(g);
      const c = e.claim && typeof e.claim === "object" ? obj(e.claim) : null;
      return {
        paymentId: str(e.payment_id) ?? "",
        receivedOn: str(e.received_on) ?? "",
        amountCents: numOrNull(e.amount_cents),
        claim: c && isClaimState(c.state) && str(c.id) ? { id: str(c.id) as string, state: c.state } : null,
      };
    }),
    amounts: bool(o.amounts),
    today: str(o.today) ?? "",
    canManage: bool(o.can_manage),
  };
}

// ── The library ──────────────────────────────────────────────────────────────

export type ProcessLink = { label: string; url: string };
export type Process = {
  summary: string;
  whoSubmits: WhoSubmits;
  steps: string[];
  documents: string[];
  links: ProcessLink[];
  typicalDays: number | null;
  tips: string | null;
  workedOn: string | null;
  workedNote: string | null;
  version: number;
  updatedAt: string | null;
};
export type ProcessAnswer = {
  program: { id: string; companyName: string; country: string | null; portal: string | null; portalUrl: string | null; status: string };
  process: Process | null;
  workedCommunities: number;
  here: { received: number; lastOn: string | null } | null;
};

const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === "string" && x !== "");

export function parseProcess(v: unknown): Process | null {
  if (!v || typeof v !== "object") return null;
  const o = obj(v);
  const summary = str(o.summary);
  if (!summary) return null;
  return {
    summary,
    whoSubmits: whoSubmits(o.who_submits),
    steps: strings(o.steps),
    documents: strings(o.documents),
    links: arr(o.links).flatMap((l) => {
      const e = obj(l);
      const label = str(e.label);
      const url = str(e.url);
      return label && url ? [{ label, url }] : [];
    }),
    typicalDays: numOrNull(o.typical_days),
    tips: str(o.tips),
    workedOn: str(o.worked_on),
    workedNote: str(o.worked_note),
    version: num(o.version) || 1,
    updatedAt: str(o.updated_at),
  };
}

export function parseProcessAnswer(v: unknown): ProcessAnswer {
  const o = obj(v);
  const p = obj(o.program);
  const h = o.here && typeof o.here === "object" ? obj(o.here) : null;
  return {
    program: { id: str(p.id) ?? "", companyName: str(p.company_name) ?? "", country: str(p.country), portal: str(p.portal), portalUrl: str(p.portal_url), status: str(p.status) ?? "active" },
    process: parseProcess(o.process),
    workedCommunities: num(o.worked_communities),
    here: h ? { received: num(h.received), lastOn: str(h.last_on) } : null,
  };
}

export type ProcessListRow = {
  id: string;
  companyName: string;
  country: string | null;
  portal: string | null;
  whoSubmits: WhoSubmits;
  summary: string;
  version: number;
  updatedAt: string | null;
  workedOn: string | null;
  workedCommunities: number;
};

export function parseProcessList(v: unknown): { total: number; rows: ProcessListRow[] } {
  const o = obj(v);
  return {
    total: num(o.total),
    rows: arr(o.rows).flatMap((x) => {
      const r = obj(x);
      const id = str(r.id);
      if (!id) return [];
      return [
        {
          id,
          companyName: str(r.company_name) ?? "",
          country: str(r.country),
          portal: str(r.portal),
          whoSubmits: whoSubmits(r.who_submits),
          summary: str(r.summary) ?? "",
          version: num(r.version) || 1,
          updatedAt: str(r.updated_at),
          workedOn: str(r.worked_on),
          workedCommunities: num(r.worked_communities),
        },
      ];
    }),
  };
}

// ── Words ────────────────────────────────────────────────────────────────────

export const WHO_SUBMITS_LABEL: Record<WhoSubmits, string> = {
  member: "The member makes the request",
  organization: "The organization makes the request",
  either: "Either the member or the organization can make the request",
};

const times = (n: number) => (n === 1 ? "once" : `${n} times`);

/** "Acme has matched a gift to us 2 times, the last on 12 October 2026" (counts and dates; never who). */
export function provenLine(program: string, received: number, lastOn: string | null): string {
  return `${program} has matched ${received === 1 ? "a gift" : "gifts"} to us ${times(received)}${lastOn ? `, the last on ${formatDay(lastOn)}` : ""}`;
}

/** The time left to ask, in words. */
export function deadlineLine(g: Pick<CatchGift, "deadlineOn" | "daysLeft">): string {
  if (g.deadlineOn === null || g.daysLeft === null) return "No deadline known";
  if (g.daysLeft < 0) {
    const d = -g.daysLeft;
    return `The deadline was ${d === 1 ? "yesterday" : `${d} days ago`} (${formatDay(g.deadlineOn)})`;
  }
  if (g.daysLeft === 0) return `Last day to ask is today (${formatDay(g.deadlineOn)})`;
  return `${g.daysLeft} ${g.daysLeft === 1 ? "day" : "days"} left, until ${formatDay(g.deadlineOn)}`;
}

/** "Your gift of 11 October 2026 (ask by 11 April 2027)", for a message. */
export function giftDayLine(g: Pick<CatchGift, "receivedOn" | "deadlineOn">): string {
  return `Your gift of ${formatDay(g.receivedOn)}${g.deadlineOn ? ` (ask by ${formatDay(g.deadlineOn)})` : ""}`;
}

/** The message a staff member copies and sends in their own way: the steps from the library, the organization's registered name and the dates. No amount. */
export function buildMessage(input: {
  firstName: string;
  employer: string;
  program: string;
  org: OrgIdentity;
  portalUrl: string | null;
  process: Process | null;
  gifts: Pick<CatchGift, "receivedOn" | "deadlineOn">[];
}): string {
  const { firstName, employer, program, org, portalUrl, process, gifts } = input;
  const lines: string[] = [];
  lines.push(`Hello ${firstName},`, "");
  lines.push(`Thank you for your gift to ${org.name}. ${employer || program} may match it: other members who work there have had a match paid to us, and yours can be claimed too.`, "");
  if (gifts.length > 0) lines.push(...gifts.map((g) => `${giftDayLine(g)}`), "");
  if (process) {
    lines.push(`${WHO_SUBMITS_LABEL[process.whoSubmits]}. ${process.summary}`, "", "How:");
    process.steps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
    if (process.documents.length > 0) lines.push("", `Have ready: ${process.documents.join("; ")}.`);
    if (process.typicalDays !== null) lines.push("", `It usually takes about ${process.typicalDays} ${process.typicalDays === 1 ? "day" : "days"}.`);
    if (process.tips) lines.push("", process.tips);
  } else {
    lines.push(`Please ask ${program}'s matching program (usually through human resources or the company's giving portal). We are happy to help you find it.`);
  }
  const url = portalUrl ?? process?.links[0]?.url ?? null;
  if (url) lines.push("", `Where to ask: ${url}`);
  const legal = org.legalName ?? org.name;
  lines.push("", `Please use our registered name${org.ein ? " and tax ID" : ""}: ${legal}${org.ein ? `, tax ID ${org.ein}` : ""}.`);
  lines.push("", "If anything is unclear, reply and we will help.", "", `Thank you,`, org.name);
  return lines.join("\n");
}

// ── The library form ─────────────────────────────────────────────────────────

const splitLines = (v: FormDataEntryValue | null): string[] =>
  String(v ?? "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

/** "Label | https://address" per line. */
export function parseLinksText(text: string): { ok: true; links: ProcessLink[] } | { ok: false; error: string } {
  const out: ProcessLink[] = [];
  for (const line of text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
    const at = line.indexOf("|");
    if (at < 1) return { ok: false, error: `write each link as: label | https://address (not "${line.slice(0, 40)}")` };
    out.push({ label: line.slice(0, at).trim(), url: line.slice(at + 1).trim() });
  }
  return { ok: true, links: out };
}

export function linksToText(links: ProcessLink[]): string {
  return links.map((l) => `${l.label} | ${l.url}`).join("\n");
}

export type ProcessInput = {
  summary: string;
  who_submits: string;
  steps: string[];
  documents: string[];
  links: ProcessLink[];
  typical_days: string | null;
  tips: string | null;
  worked_on: string | null;
  worked_note: string | null;
};

/** Reads the library form of Platform › Gift matching directory; the database cleans and checks every value again. */
export function processFromForm(fd: FormData): { ok: true; process: ProcessInput } | { ok: false; error: string } {
  const links = parseLinksText(String(fd.get("links") ?? ""));
  if (!links.ok) return links;
  const text = (k: string) => String(fd.get(k) ?? "").trim() || null;
  return {
    ok: true,
    process: {
      summary: String(fd.get("summary") ?? "").trim(),
      who_submits: String(fd.get("who_submits") ?? "").trim(),
      steps: splitLines(fd.get("steps")),
      documents: splitLines(fd.get("documents")),
      links: links.links,
      typical_days: text("typical_days"),
      tips: text("tips"),
      worked_on: text("worked_on"),
      worked_note: text("worked_note"),
    },
  };
}
