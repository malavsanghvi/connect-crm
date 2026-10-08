// Accounting › Account mapping (migration 0606, docs/FUND_ACCOUNT_MAPPING_GAPS.md): which QuickBooks account each fund
// and role posts to, each fund's class, each bank account's register; the changes waiting for a second person; the
// history. The answers of app.account_mapping_overview and app.account_mapping_waiting are jsonb, so every field is
// checked here: a shape this code does not understand is a plain error, never a guess. The rules themselves are in the
// database (who may ask, who may confirm, the fresh 2FA check, the reason); these helpers only say them before asking.
// Pure; tested in tests/qbo-mapping.test.ts.

import { UNEXPECTED_SHAPE, type Parsed } from "@/lib/payments/plugins/view";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const strOrNull = (v: unknown): v is string | null => v === null || typeof v === "string";
const intOrNull = (v: unknown): v is number | null => v === null || isInt(v);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): v is T => isStr(v) && (list as readonly string[]).includes(v);
/** A key the database may leave out reads as null. */
const opt = (o: Obj, k: string): unknown => (k in o ? o[k] : null);

/** A request lapses after this many days (app.request_account_mapping_change). */
export const MAPPING_REQUEST_DAYS = 14;

export const MAPPING_SUBJECTS = ["role", "fund_class", "bank_account"] as const;
export type MappingSubject = (typeof MAPPING_SUBJECTS)[number];
export const MAPPING_STATUSES = ["pending", "applied", "rejected", "cancelled", "superseded", "expired"] as const;
export type MappingStatus = (typeof MAPPING_STATUSES)[number];
export type MappingTone = "neutral" | "warning" | "navy" | "success" | "danger";

export type MappingRole = {
  key: string;
  label: string;
  kind: "fund" | "role";
  hint: string | null;
  account_types: string[];
  needs_item: boolean;
  required: boolean;
  /** Funds only: open pledges and published campaigns whose money belongs to it. */
  used: number | null;
  /** Postings waiting in the exception queue for this account. */
  waiting_postings: number;
  /** The account posting uses now (null when it cannot be used: see problem). */
  account_id: string | null;
  mapped_account_id: string | null;
  account_name: string | null;
  account_type: string | null;
  approved: boolean;
  problem: string | null;
};
export type MappingFund = {
  id: string;
  key: string;
  name: string;
  restricted: boolean;
  class_id: string | null;
  mapped_class_id: string | null;
  class_name: string | null;
  problem: string | null;
  waiting_postings: number;
};
export type MappingBank = {
  id: string;
  name: string;
  last4: string | null;
  account_id: string | null;
  mapped_account_id: string | null;
  account_name: string | null;
  /** No account of its own and the only bank account: its money lands in the main "Bank account". */
  uses_main_bank: boolean;
  problem: string | null;
  waiting_postings: number;
};
export type MappingRequest = {
  id: string;
  subject: MappingSubject;
  target_key: string;
  target_label: string;
  from_ref: string | null;
  from_name: string | null;
  to_ref: string | null;
  to_name: string | null;
  to_type: string | null;
  /** setup: chosen by one person before the mapping was ever approved; request: a two-person change. */
  mode: "setup" | "request";
  status: MappingStatus;
  /** Still "pending" in the table, but past its 14 days: it can no longer be confirmed. */
  expired: boolean;
  requested_by: string;
  requested_by_name: string;
  requested_at: string;
  request_reason: string;
  expires_at: string | null;
  decided_by_name: string | null;
  cancelled_by_name: string | null;
  decided_at: string | null;
  decision_reason: string | null;
  applied_at: string | null;
  queued_postings: number | null;
  requeued_postings: number | null;
  /** The signed-in person asked for it (so they cannot also be the second person). */
  mine: boolean;
};
export type MappingConnection = {
  id: string;
  provider: string;
  status: string;
  realm_id: string | null;
  display_name: string | null;
  read_only: boolean;
  basis: string | null;
};
export type MappingOverview = {
  /** The mapping has been approved at least once: every change needs a second person. */
  in_use: boolean;
  can_request: boolean;
  can_approve: boolean;
  connection: MappingConnection | null;
  mapping_approved_at: string | null;
  mapping_approved_by_name: string | null;
  roles: MappingRole[];
  funds: MappingFund[];
  bank_accounts: MappingBank[];
  requests: MappingRequest[];
};
export type MappingWaiting = { can_approve: boolean; requests: MappingRequest[] };

function parseRole(v: unknown): MappingRole | null {
  if (!isObj(v)) return null;
  const types = v.account_types;
  if (
    !isStr(v.key) || !isStr(v.label) || !oneOf(v.kind, ["fund", "role"] as const) || !strOrNull(opt(v, "hint"))
    || !Array.isArray(types) || !types.every(isStr) || !isBool(v.needs_item) || !isBool(v.required)
    || !intOrNull(opt(v, "used")) || !isInt(v.waiting_postings) || !strOrNull(opt(v, "account_id")) || !strOrNull(opt(v, "mapped_account_id"))
    || !strOrNull(opt(v, "account_name")) || !strOrNull(opt(v, "account_type")) || !isBool(v.approved) || !strOrNull(opt(v, "problem"))
  ) {
    return null;
  }
  return {
    key: v.key, label: v.label, kind: v.kind, hint: opt(v, "hint") as string | null, account_types: types as string[], needs_item: v.needs_item,
    required: v.required, used: opt(v, "used") as number | null, waiting_postings: v.waiting_postings,
    account_id: opt(v, "account_id") as string | null, mapped_account_id: opt(v, "mapped_account_id") as string | null,
    account_name: opt(v, "account_name") as string | null, account_type: opt(v, "account_type") as string | null,
    approved: v.approved, problem: opt(v, "problem") as string | null,
  };
}

function parseFund(v: unknown): MappingFund | null {
  if (
    !isObj(v) || !isStr(v.id) || !isStr(v.key) || !isStr(v.name) || !isBool(v.restricted) || !strOrNull(opt(v, "class_id"))
    || !strOrNull(opt(v, "mapped_class_id")) || !strOrNull(opt(v, "class_name")) || !strOrNull(opt(v, "problem")) || !isInt(v.waiting_postings)
  ) {
    return null;
  }
  return {
    id: v.id, key: v.key, name: v.name, restricted: v.restricted, class_id: opt(v, "class_id") as string | null,
    mapped_class_id: opt(v, "mapped_class_id") as string | null, class_name: opt(v, "class_name") as string | null,
    problem: opt(v, "problem") as string | null, waiting_postings: v.waiting_postings,
  };
}

function parseBank(v: unknown): MappingBank | null {
  if (
    !isObj(v) || !isStr(v.id) || !isStr(v.name) || !strOrNull(opt(v, "last4")) || !strOrNull(opt(v, "account_id"))
    || !strOrNull(opt(v, "mapped_account_id")) || !strOrNull(opt(v, "account_name")) || !isBool(v.uses_main_bank)
    || !strOrNull(opt(v, "problem")) || !isInt(v.waiting_postings)
  ) {
    return null;
  }
  return {
    id: v.id, name: v.name, last4: opt(v, "last4") as string | null, account_id: opt(v, "account_id") as string | null,
    mapped_account_id: opt(v, "mapped_account_id") as string | null, account_name: opt(v, "account_name") as string | null,
    uses_main_bank: v.uses_main_bank, problem: opt(v, "problem") as string | null, waiting_postings: v.waiting_postings,
  };
}

export function parseMappingRequest(v: unknown): MappingRequest | null {
  if (!isObj(v)) return null;
  const keysStrOrNull = ["from_ref", "from_name", "to_ref", "to_name", "to_type", "expires_at", "decided_by_name", "cancelled_by_name",
    "decided_at", "decision_reason", "applied_at"];
  if (
    !isStr(v.id) || !oneOf(v.subject, MAPPING_SUBJECTS) || !isStr(v.target_key) || !isStr(v.target_label)
    || !oneOf(v.mode, ["setup", "request"] as const) || !oneOf(v.status, MAPPING_STATUSES) || !isBool(v.expired)
    || !isStr(v.requested_by) || !isStr(v.requested_by_name) || !isStr(v.requested_at) || !isStr(v.request_reason)
    || !intOrNull(opt(v, "queued_postings")) || !intOrNull(opt(v, "requeued_postings")) || !isBool(v.mine)
    || keysStrOrNull.some((k) => !strOrNull(opt(v, k)))
  ) {
    return null;
  }
  const s = (k: string) => opt(v, k) as string | null;
  return {
    id: v.id, subject: v.subject, target_key: v.target_key, target_label: v.target_label, from_ref: s("from_ref"), from_name: s("from_name"),
    to_ref: s("to_ref"), to_name: s("to_name"), to_type: s("to_type"), mode: v.mode, status: v.status, expired: v.expired,
    requested_by: v.requested_by, requested_by_name: v.requested_by_name, requested_at: v.requested_at, request_reason: v.request_reason,
    expires_at: s("expires_at"), decided_by_name: s("decided_by_name"), cancelled_by_name: s("cancelled_by_name"), decided_at: s("decided_at"),
    decision_reason: s("decision_reason"), applied_at: s("applied_at"), queued_postings: opt(v, "queued_postings") as number | null,
    requeued_postings: opt(v, "requeued_postings") as number | null, mine: v.mine,
  };
}

function parseList<T>(v: unknown, one: (x: unknown) => T | null): T[] | null {
  if (!Array.isArray(v)) return null;
  const out: T[] = [];
  for (const x of v) {
    const parsed = one(x);
    if (!parsed) return null;
    out.push(parsed);
  }
  return out;
}

function parseConnection(v: unknown): MappingConnection | null | undefined {
  if (v === null || v === undefined) return null;
  if (!isObj(v) || !isStr(v.id) || !isStr(v.provider) || !isStr(v.status) || !strOrNull(opt(v, "realm_id")) || !strOrNull(opt(v, "display_name"))
      || !isBool(v.read_only) || !strOrNull(opt(v, "basis"))) {
    return undefined;
  }
  return {
    id: v.id, provider: v.provider, status: v.status, realm_id: opt(v, "realm_id") as string | null,
    display_name: opt(v, "display_name") as string | null, read_only: v.read_only, basis: opt(v, "basis") as string | null,
  };
}

export function parseMappingOverview(json: unknown): Parsed<MappingOverview> {
  if (!isObj(json) || !isBool(json.in_use) || !isBool(json.can_request) || !isBool(json.can_approve)
      || !strOrNull(opt(json, "mapping_approved_at")) || !strOrNull(opt(json, "mapping_approved_by_name"))) {
    return { ok: false, error: UNEXPECTED_SHAPE };
  }
  const connection = parseConnection(opt(json, "connection"));
  const roles = parseList(json.roles, parseRole);
  const funds = parseList(json.funds, parseFund);
  const bank_accounts = parseList(json.bank_accounts, parseBank);
  const requests = parseList(json.requests, parseMappingRequest);
  if (connection === undefined || !roles || !funds || !bank_accounts || !requests) return { ok: false, error: UNEXPECTED_SHAPE };
  return {
    ok: true,
    value: {
      in_use: json.in_use, can_request: json.can_request, can_approve: json.can_approve, connection,
      mapping_approved_at: opt(json, "mapping_approved_at") as string | null,
      mapping_approved_by_name: opt(json, "mapping_approved_by_name") as string | null,
      roles, funds, bank_accounts, requests,
    },
  };
}

export function parseMappingWaiting(json: unknown): Parsed<MappingWaiting> {
  if (!isObj(json) || !isBool(json.can_approve)) return { ok: false, error: UNEXPECTED_SHAPE };
  const requests = parseList(json.requests, parseMappingRequest);
  if (!requests) return { ok: false, error: UNEXPECTED_SHAPE };
  return { ok: true, value: { can_approve: json.can_approve, requests } };
}

// ── What the screens say ─────────────────────────────────────────────────────
/** Requests that can still be confirmed (oldest first in the Home list, as the database lists them). */
export function waitingRequests(requests: MappingRequest[]): MappingRequest[] {
  return requests.filter((r) => r.status === "pending" && !r.expired);
}

/** The waiting request for one thing (a role key, a fund id, a bank account id), if any. */
export function waitingFor(requests: MappingRequest[], subject: MappingSubject, key: string): MappingRequest | null {
  return waitingRequests(requests).find((r) => r.subject === subject && r.target_key === key) ?? null;
}

export function mappingStatusView(r: Pick<MappingRequest, "status" | "expired" | "mode">): { label: string; tone: MappingTone } {
  if (r.status === "pending" && r.expired) return { label: "Lapsed", tone: "neutral" };
  switch (r.status) {
    case "pending":
      return { label: "Waiting for a second person", tone: "warning" };
    case "applied":
      return r.mode === "setup" ? { label: "Chosen during setup", tone: "navy" } : { label: "Confirmed", tone: "success" };
    case "rejected":
      return { label: "Turned down", tone: "danger" };
    case "cancelled":
      return { label: "Withdrawn", tone: "neutral" };
    case "superseded":
      return { label: "Replaced by a newer request", tone: "neutral" };
    default:
      return { label: "Lapsed", tone: "neutral" };
  }
}

/** The sentence that says who must act next on a waiting request. */
export function waitingNote(r: MappingRequest, canApprove: boolean): string {
  if (r.expired) return `This request lapsed on ${(r.expires_at ?? "").slice(0, 10)}. Ask for the change again.`;
  if (r.mine) return "You asked for this change, so a different person with giving.approve has to confirm it.";
  return canApprove
    ? `${r.requested_by_name} asked for this change. You can confirm it (a fresh 2FA check and a reason) or turn it down.`
    : `${r.requested_by_name} asked for this change. A person with giving.approve confirms it.`;
}

/** "Donations → Donations 2027", with "nothing" for an empty side. */
export function changeLine(r: Pick<MappingRequest, "from_name" | "from_ref" | "to_name" | "to_ref" | "subject">): string {
  const empty = r.subject === "fund_class" ? "no class" : r.subject === "bank_account" ? "the main bank account" : "nothing";
  const from = r.from_name ?? (r.from_ref ? `id ${r.from_ref}` : empty);
  const to = r.to_name ?? (r.to_ref ? `id ${r.to_ref}` : empty);
  return `${from} → ${to}`;
}

/** The state of one fund or role on the screen. */
export function roleStateView(role: Pick<MappingRole, "account_id" | "mapped_account_id" | "approved" | "problem" | "required" | "kind" | "used">):
  { label: string; tone: "ok" | "warn" | "bad" | "muted" } {
  if (role.account_id) return { label: "In use", tone: "ok" };
  if (role.mapped_account_id && !role.approved && !role.problem?.includes("another QuickBooks company")) return { label: "Not approved yet", tone: "warn" };
  if (role.mapped_account_id) return { label: "Needs a new account", tone: "bad" };
  if (role.required) return { label: "Not mapped (required)", tone: "bad" };
  if (role.kind === "fund" && (role.used ?? 0) > 0) return { label: "Not mapped: its money waits", tone: "bad" };
  return { label: "Not mapped", tone: "muted" };
}

export type PulledChoice = { qbo_id: string; name: string; fully_qualified_name?: string | null; account_type?: string | null; active: boolean };

/** The accounts a role may use: active, of an accepted type, sorted by full name (the database checks it again). */
export function choicesFor<T extends PulledChoice>(types: readonly string[], accounts: T[]): T[] {
  return accounts
    .filter((a) => a.active && (!a.account_type || types.includes(a.account_type)))
    .sort((a, b) => (a.fully_qualified_name ?? a.name).localeCompare(b.fully_qualified_name ?? b.name));
}

/** What the person typed before asking, checked the way the database will check it. */
export function changeInputProblem(input: { subject: string; target: string; to: string; reason: string; inUse: boolean }, doing: string): string | null {
  if (!oneOf(input.subject, MAPPING_SUBJECTS)) return `Could not ${doing} — say what to change.`;
  if (!input.target.trim()) return `Could not ${doing} — say what to change.`;
  if (input.subject === "role" && !input.to.trim()) return `Could not ${doing} — choose an account from the list.`;
  const r = input.reason.trim();
  if (input.inUse && !r) return `Could not ${doing} — say why. The reason is kept in the audit log and the second person sees it.`;
  if (r.length > 500) return `Could not ${doing} — keep the reason under 500 characters.`;
  return null;
}

/** The reason every decision asks for (kept in the audit log). */
export function decisionReasonProblem(reason: string, doing: string): string | null {
  const r = String(reason ?? "").trim();
  if (!r) return `Could not ${doing} — say why. The reason is kept in the audit log.`;
  if (r.length > 500) return `Could not ${doing} — keep the reason under 500 characters.`;
  return null;
}

/** What a posting waits for, from ledger_postings.needs_mapping ('role:income.boli', 'fund_class:<id>', 'bank_account:<id>'). */
export function needsMappingView(needs: string | null | undefined, labels: Record<string, string> = {}): string | null {
  if (!needs) return null;
  const i = needs.indexOf(":");
  if (i < 0) return null;
  const subject = needs.slice(0, i);
  const key = needs.slice(i + 1);
  if (subject === "role") return `Waits for the ${labels[key] ?? key} account. It goes back in the queue by itself once the account is confirmed.`;
  if (subject === "fund_class") return "Waits for a fund's QuickBooks class. It goes back in the queue by itself once the class is confirmed.";
  if (subject === "bank_account") return "Waits for a bank account's QuickBooks account. It goes back in the queue by itself once it is confirmed.";
  return null;
}
