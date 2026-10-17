// CatchTheMatch Phase 1, piece 0 (migration 0920, docs/CATCH_THE_MATCH.md section 13): asking the adults of donor families for their
// employer. Pure: no I/O. The database decides the audience, who may read it and what is sent; this file reads what it was given and
// writes the words. "Queued" is never "sent": the message queue holds the real outcome.

import { formatDay, parseHousehold, type CareHousehold } from "@/lib/care/model";

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);

export type AskPerson = {
  person: { id: string; name: string };
  household: CareHousehold | null;
  /** An email address that can be written to. */
  email: boolean;
  /** A login with the member app on a phone. */
  app: boolean;
  lastAsked: string | null;
};
export type AskCounts = { people: number; toAsk: number; email: number; app: number; nobody: number; onFile: number; withdrew: number; recent: number };
export type AskList = { total: number; rows: AskPerson[]; counts: AskCounts; today: string; sandbox: boolean };

export function parseAskList(v: unknown): AskList {
  const o = obj(v);
  const c = obj(o.counts);
  return {
    total: num(o.total),
    rows: arr(o.rows).map((x) => {
      const r = obj(x);
      return {
        person: { id: str(obj(r.person).id) ?? "", name: str(obj(r.person).name) ?? "A member" },
        household: r.household && typeof r.household === "object" ? parseHousehold(r.household) : null,
        email: r.email === true,
        app: r.app === true,
        lastAsked: str(r.last_asked),
      };
    }),
    counts: {
      people: num(c.people),
      toAsk: num(c.to_ask),
      email: num(c.email),
      app: num(c.app),
      nobody: num(c.nobody),
      onFile: num(c.on_file),
      withdrew: num(c.withdrew),
      recent: num(c.recent),
    },
    today: str(o.today) ?? "",
    sandbox: o.sandbox === true,
  };
}

export type AskResult = {
  asked: number;
  email: number;
  push: number;
  notQueued: { reason: string; count: number }[];
  nobody: number;
  left: number;
  notInAudience: number;
};

export function parseAskResult(v: unknown): AskResult {
  const o = obj(v);
  return {
    asked: num(o.asked),
    email: num(o.email),
    push: num(o.push),
    notQueued: Object.entries(obj(o.not_queued))
      .flatMap(([reason, count]) => (typeof count === "number" && count > 0 ? [{ reason, count }] : []))
      .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason)),
    nobody: num(o.nobody),
    left: num(o.left),
    notInAudience: num(o.not_in_audience),
  };
}

const people = (n: number) => `${n} ${n === 1 ? "person" : "people"}`;

/**
 * What the screen says after an ask. Nothing queued is an error (the screen shows it in red, beside the button), never a success; a success
 * says "queued", not "sent", and where the real outcome of each message is.
 */
export function askOutcome(r: AskResult): { ok: true; message: string } | { ok: false; error: string } {
  const why = r.notQueued.map((n) => `${n.reason}${n.count > 1 ? ` (${n.count})` : ""}`);
  if (r.asked === 0) {
    if (why.length > 0) return { ok: false, error: `Could not ask — nothing was queued. ${why.join(" ")}` };
    if (r.notInAudience > 0) return { ok: false, error: "Could not ask — that person is not in the list any more (they may have been asked already, or added their employer). Reload the page." };
    if (r.nobody > 0) return { ok: false, error: `Could not ask — ${people(r.nobody)} on the list ${r.nobody === 1 ? "has" : "have"} no email address or member app that can be written to.` };
    return { ok: false, error: "Could not ask — nobody is left to ask. Everyone in the list has been asked in the last 90 days, has an employer on file, or withdrew it." };
  }
  const how = [r.email > 0 ? `${r.email} ${r.email === 1 ? "email" : "emails"}` : null, r.push > 0 ? `${r.push} app ${r.push === 1 ? "notification" : "notifications"}` : null].filter(Boolean).join(" and ");
  const parts = [
    `Queued the request for ${people(r.asked)} (${how}). Queued means handed to the sending service; whether each one arrived shows under Settings › Email › Recent emails.`,
    why.length > 0 ? `Not queued: ${why.join(" ")}` : null,
    r.left > 0 ? `${people(r.left)} more ${r.left === 1 ? "is" : "are"} waiting: ask again to continue.` : null,
  ];
  return { ok: true, message: parts.filter(Boolean).join(" ") };
}

/** "Not asked yet" or "Asked before, on 3 July 2026". */
export function askedLine(lastAsked: string | null, timeZone: string): string {
  if (!lastAsked) return "Not asked yet";
  const day = new Date(lastAsked);
  if (Number.isNaN(day.getTime())) return "Asked before";
  const iso = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(day);
  return `Asked before, on ${formatDay(iso)}`;
}

/** The one sentence the message carries (the owner's words, 2026-10-17). */
export const ASK_SENTENCE = "You may be eligible to double the donation from your employer if you provide your employer information.";
