// Giving > Payment proofs: the treasury team's queue (migration 0866 payment_proof_queue). Pure: this file reads the database's
// JSON into typed cards, words the checks the system ran, and decides what each card's buttons may do. The screen only draws it.
// Money is integer cents everywhere; a household is always shown with its household card, never by name alone.

import type { HouseholdCardData } from "@/components/household-card";
import { PAYMENT_METHOD_LABEL } from "@/lib/labels";

export type ProofStatus = "submitted" | "needs_info";
export type FileKind = "image" | "pdf" | "other";

export type ProofFile = {
  id: string;
  path: string;
  contentType: string;
  bytes: number;
  /** The bytes were purged by retention; only the record stays. */
  removed: boolean;
  kind: FileKind;
  /** A signed link made by the server for 10 minutes; null until it is made (or when it could not be). */
  url: string | null;
};

export type CoveredPledge = { pledgeId: string; number: string | null; title: string; coverCents: number; pledgeCents: number };

/** What `proof_lookalikes` (0866) returns: money of the same family that this proof may duplicate. */
export type Lookalike = { kind: "payment" | "proof" | "zelle_report"; id: string; label: string; certain: boolean };
export type BankLineHint = { id: string; postedOn: string; description: string };
export type ProofEvent = { kind: string; body: string; createdAt: string };

export type ProofCard = {
  id: string;
  householdId: string;
  household: HouseholdCardData | null;
  status: ProofStatus;
  entry: string;
  method: string;
  amountCents: number;
  paidOn: string;
  reference: string | null;
  note: string | null;
  createdAt: string;
  /** The first and last name of the person who sent it (0873); null when the database did not say (staff entry, an older answer). */
  sentBy: string | null;
  ageDays: number;
  question: string | null;
  excessCents: number;
  files: ProofFile[];
  covered: CoveredPledge[];
  events: ProofEvent[];
  lookalikes: Lookalike[];
  sameFile: boolean;
  bankLines: BankLineHint[];
  needsSecond: boolean;
  firstApproved: boolean;
  firstApprovedByMe: boolean;
  ownHousehold: boolean;
  stale: boolean;
  isTest: boolean;
};

// ---------------------------------------------------------------------------------------------------- reading the answer

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const int = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : 0;
};

export function fileKind(contentType: string): FileKind {
  const t = contentType.toLowerCase();
  if (t === "application/pdf") return "pdf";
  if (t.startsWith("image/")) return "image";
  return "other";
}

/** Browsers other than Safari cannot draw HEIC, so such a file opens in its own tab instead of the viewer. */
export function canShowInline(contentType: string): boolean {
  const t = contentType.toLowerCase();
  return t === "application/pdf" || t === "image/jpeg" || t === "image/png" || t === "image/webp";
}

function parseFile(v: unknown): ProofFile | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const path = str(v.storage_path);
  if (!id || !path) return null;
  const contentType = str(v.content_type) ?? "application/octet-stream";
  return { id, path, contentType, bytes: int(v.bytes), removed: v.removed === true, kind: fileKind(contentType), url: null };
}

function parseCovered(v: unknown): CoveredPledge | null {
  if (!isObj(v)) return null;
  const pledgeId = str(v.pledge_id);
  if (!pledgeId) return null;
  // A soft credit that was released or converted no longer reserves the pledge.
  if (typeof v.state === "string" && v.state !== "active") return null;
  return { pledgeId, number: str(v.pledge_number), title: str(v.title) ?? "Pledge", coverCents: int(v.amount_cents), pledgeCents: int(v.pledge_amount_cents) };
}

export function parseLookalikes(v: unknown): Lookalike[] {
  if (!Array.isArray(v)) return [];
  const out: Lookalike[] = [];
  for (const x of v) {
    if (!isObj(x)) continue;
    const id = str(x.id);
    const kind = x.kind === "payment" || x.kind === "proof" || x.kind === "zelle_report" ? x.kind : null;
    if (!id || !kind) continue;
    out.push({ kind, id, label: str(x.label) ?? "A similar payment", certain: x.certain === true });
  }
  return out;
}

function parseHousehold(v: unknown): HouseholdCardData | null {
  if (!isObj(v) || !str(v.household_id)) return null;
  const text = (k: string) => str(v[k]);
  return {
    household_id: String(v.household_id),
    household_name: text("household_name"),
    household_number: text("household_number"),
    org_household_id: text("org_household_id"),
    members: text("members"),
    primary_member: text("primary_member"),
    primary_org_member_id: text("primary_org_member_id"),
    zone: text("zone"),
    city: text("city"),
    last_gift_on: text("last_gift_on"),
    open_pledge_cents: v.open_pledge_cents === null || v.open_pledge_cents === undefined ? null : int(v.open_pledge_cents),
  };
}

function parseCard(v: unknown): ProofCard | null {
  if (!isObj(v)) return null;
  const id = str(v.id);
  const householdId = str(v.household_id);
  const method = str(v.method);
  if (!id || !householdId || !method) return null;
  const status: ProofStatus = v.status === "needs_info" ? "needs_info" : "submitted";
  return {
    id,
    householdId,
    household: parseHousehold(v.household),
    status,
    entry: str(v.entry) ?? "open_pledges",
    method,
    amountCents: int(v.amount_cents),
    paidOn: str(v.paid_on) ?? "",
    reference: str(v.reference),
    note: str(v.note),
    createdAt: str(v.created_at) ?? "",
    sentBy: str(v.sent_by)?.trim() ?? null,
    ageDays: Math.max(0, int(v.age_days)),
    question: str(v.question),
    excessCents: Math.max(0, int(v.excess_cents)),
    files: Array.isArray(v.files) ? v.files.flatMap((f) => parseFile(f) ?? []) : [],
    covered: Array.isArray(v.covered) ? v.covered.flatMap((c) => parseCovered(c) ?? []) : [],
    events: Array.isArray(v.events)
      ? v.events.flatMap((e) => (isObj(e) && str(e.body) ? [{ kind: str(e.kind) ?? "", body: String(e.body), createdAt: str(e.created_at) ?? "" }] : []))
      : [],
    lookalikes: parseLookalikes(v.lookalikes),
    sameFile: v.same_file === true,
    bankLines: Array.isArray(v.bank_lines)
      ? v.bank_lines.flatMap((b) => (isObj(b) && str(b.id) ? [{ id: String(b.id), postedOn: str(b.posted_on) ?? "", description: str(b.description) ?? "" }] : []))
      : [],
    needsSecond: v.needs_second === true,
    firstApproved: v.first_approved === true,
    firstApprovedByMe: v.first_approved_by_me === true,
    ownHousehold: v.own_household === true,
    stale: v.stale === true,
    isTest: v.is_test === true,
  };
}

/** The queue the database returned, oldest first (the database orders it; this keeps that order). Null when it is not a list. */
export function parseProofQueue(data: unknown): ProofCard[] | null {
  if (data === null || data === undefined) return [];
  if (!Array.isArray(data)) return null;
  return data.flatMap((c) => parseCard(c) ?? []);
}

// ---------------------------------------------------------------------------------------------------- wording

export const METHOD_LABEL: Record<string, string> = { ...PAYMENT_METHOD_LABEL, ach: "Bank transfer (ACH)", daf: "Donor-advised fund", matching_gift: "Matching gift" };

export function methodLabel(method: string): string {
  return METHOD_LABEL[method] ?? method.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

const ENTRY_LABEL: Record<string, string> = {
  open_pledges: "Open pledges",
  rsvp: "An event RSVP",
  store: "Store checkout",
  opportunity: "An opportunity",
  labh: "Labh",
  pathshala_fee: "A school fee",
  membership: "Membership",
};

export function entryLabel(entry: string): string {
  return ENTRY_LABEL[entry] ?? entry.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
}

export type AgeChip = { label: string; tone: "plain" | "soft" | "warn" | "bad" };

/** "Today", "3 days" and so on, lit at 3 / 7 / 14 days (the plan's aged chips). */
export function ageChip(days: number): AgeChip {
  if (days <= 0) return { label: "Today", tone: "plain" };
  const label = `${days} ${days === 1 ? "day" : "days"}`;
  if (days >= 14) return { label, tone: "bad" };
  if (days >= 7) return { label, tone: "warn" };
  if (days >= 3) return { label, tone: "soft" };
  return { label, tone: "plain" };
}

/** "Sent by Mina Rao", or null when nobody is named (never a made-up name). */
export function sentByLine(c: Pick<ProofCard, "sentBy">): string | null {
  return c.sentBy ? `Sent by ${c.sentBy}` : null;
}

/** "1 file" / "3 files" (files the retention job removed do not count as files you can open). */
export function filesLabel(files: readonly ProofFile[]): string {
  const open = files.filter((f) => !f.removed).length;
  return `${open} ${open === 1 ? "file" : "files"}`;
}

// ---------------------------------------------------------------------------------------------------- what the system checked

export type FlagTone = "bad" | "warn" | "ok" | "info";
export type ProofFlag = { key: string; tone: FlagTone; tag: string; text: string };

export type FlagContext = {
  /** Writes a number of cents the way this community writes money. */
  money: (cents: number) => string;
  /** Writes a date-only value (YYYY-MM-DD) the way the portal shows dates. */
  date: (value: string) => string;
};

/** The checks the system ran, in the order a treasurer reads them: what blocks first, then what to know, then what is clear. */
export function proofFlags(c: ProofCard, f: FlagContext): ProofFlag[] {
  const out: ProofFlag[] = [];
  if (c.ownHousehold) {
    out.push({ key: "own", tone: "bad", tag: "Your household:", text: "this proof is from your own household, so another member of the treasury team must verify it." });
  }
  for (const l of c.lookalikes) {
    if (l.kind === "payment") {
      out.push({
        key: `look:${l.id}`,
        tone: "bad",
        tag: "Possible duplicate:",
        text: l.certain ? `${l.label} has the same check number or reference as this proof.` : `${l.label} is already recorded for this family with the same amount.`,
      });
    } else {
      out.push({ key: `look:${l.id}`, tone: "bad", tag: "Possible duplicate:", text: `${l.label} is for the same amount from this family.` });
    }
  }
  if (c.sameFile) out.push({ key: "same_file", tone: "bad", tag: "Same file:", text: "a file in this proof was already used in another proof." });
  if (c.stale) out.push({ key: "stale", tone: "warn", tag: "Stale:", text: "the member has not answered the question, so the proof is back in your queue. It is never rejected on its own." });
  if (c.needsSecond) {
    const text = c.firstApproved
      ? c.firstApprovedByMe
        ? "you gave the first approval. A different person with approval rights must give the second."
        : "the first approval is in. You can give the second if you hold approval rights."
      : "above the amount your organization set, so a second person with approval rights must also approve.";
    out.push({ key: "needs_second", tone: "warn", tag: "Needs two people:", text });
  }
  for (const b of c.bankLines) {
    out.push({
      key: `bank:${b.id}`,
      tone: "ok",
      tag: "Fits:",
      text: `a bank line is waiting${b.postedOn ? `: ${f.date(b.postedOn)}` : ""}${b.description ? `, ${b.description}` : ""}. Approving can also bank it.`,
    });
  }
  if (c.covered.length === 0) {
    out.push({ key: "no_pledge", tone: "info", tag: "Note:", text: "no pledge is reserved by this proof now. Approving records the payment and applies it to the oldest open pledges." });
  }
  if (c.excessCents > 0) {
    out.push({ key: "excess", tone: "info", tag: "Note:", text: `the member sent ${f.money(c.excessCents)} more than their open pledges. The extra is not credited to a pledge; change the amount if it should not be recorded.` });
  }
  if (c.method === "cash") {
    out.push({ key: "cash", tone: "info", tag: "Note:", text: "cash has no bank line of its own. It will be matched inside a deposit or an offering count." });
  }
  if (c.lookalikes.length === 0 && !c.sameFile) {
    out.push({ key: "clear", tone: "ok", tag: "Clear:", text: "no similar payment is recorded for this family, and the files are new." });
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- buttons

export type CardCan = {
  /** giving.record_offline or giving.manage: may verify. */
  decide: boolean;
  /** giving.approve: may give the second of two approvals. */
  approve: boolean;
  /** Bank reconciliation is on and the person may confirm a bank match. */
  bank: boolean;
};

export type Primary = { label: string; disabled: boolean; reason: string | null; reconcile: boolean };

/** What the main Approve button says, and why it is off when it is. */
export function approvePrimary(c: ProofCard, can: CardCan): Primary {
  const reconcile = can.bank && c.bankLines.length > 0;
  if (!can.decide) return { label: "Approve", disabled: true, reason: "Verifying a proof needs the permission to record payments.", reconcile };
  if (c.ownHousehold) return { label: "Approve", disabled: true, reason: "This is your own household's proof. Another member of the treasury team must verify it.", reconcile };
  if (c.needsSecond) {
    if (!c.firstApproved) return { label: "Approve (first of two)", disabled: false, reason: "Above your organization's limit: the payment is recorded when a second person approves.", reconcile: false };
    if (c.firstApprovedByMe) return { label: "Approve (first of two)", disabled: true, reason: "You gave the first approval. A different person must give the second.", reconcile };
    if (!can.approve) return { label: "Approve (second of two)", disabled: true, reason: "The second approval needs the permission to approve (giving.approve).", reconcile };
    return { label: reconcile ? "Approve and reconcile (second of two)" : "Approve (second of two)", disabled: false, reason: null, reconcile };
  }
  return { label: reconcile ? "Approve and reconcile" : "Approve", disabled: false, reason: null, reconcile };
}

/** Why the other decisions are off (own household, no permission), or null. */
export function decisionBlock(c: ProofCard, can: CardCan): string | null {
  if (!can.decide) return "Verifying a proof needs the permission to record payments.";
  if (c.ownHousehold) return "This is your own household's proof. Another member of the treasury team must verify it.";
  return null;
}

// ---------------------------------------------------------------------------------------------------- chips on the list

export type Chip = { label: string; tone: FlagTone };

/** The short chips on a card in the list: only what changes what the treasurer does with it. */
export function cardChips(c: ProofCard): Chip[] {
  const out: Chip[] = [];
  if (c.ownHousehold) out.push({ label: "Your household", tone: "bad" });
  if (c.lookalikes.length > 0) out.push({ label: "Possible duplicate", tone: "bad" });
  if (c.sameFile) out.push({ label: "Same file as before", tone: "bad" });
  if (c.status === "needs_info") out.push({ label: c.stale ? "No reply, back in queue" : "Waiting for the family", tone: "warn" });
  if (c.needsSecond) out.push({ label: c.firstApproved ? "Second approval needed" : "Second person needed", tone: "warn" });
  if (c.bankLines.length > 0) out.push({ label: "Bank line waiting", tone: "ok" });
  return out;
}

/** "Okafor household" is never enough: the list line is the name plus the household number and the organization's own id. */
export function householdLine(h: HouseholdCardData | null, orgHouseholdLabel: string): string {
  if (!h) return "Household not found";
  const parts = [h.household_number ?? "no household number", `${orgHouseholdLabel} ${h.org_household_id ?? "—"}`];
  return parts.join(" · ");
}
