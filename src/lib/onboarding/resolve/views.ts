// What the database hands back for the matching questions (resolve_inbox, resolve_item_detail, resolve_run_metrics, resolve_answer),
// read into plain typed objects. Pure: the screens and the server module share these. Anything missing is read as empty or zero,
// never invented: a number that is not there is 0, a sentence that is not there is "".

import type { AnswerCode, Question } from "./exceptions";
import { SIGNATURES } from "./exceptions";
import type { RunMetrics } from "./metrics";
import type { PatternSignature } from "./types";

export type GroupStatus = "open" | "answered" | "postponed" | "skipped" | "sent";
export type ResultStatus = "none" | "staged" | "storing" | "ready";

const GROUP_STATUSES: readonly GroupStatus[] = ["open", "answered", "postponed", "skipped", "sent"];
const RESULT_STATUSES: readonly ResultStatus[] = ["none", "staged", "storing", "ready"];

export type InboxGroup = {
  id: string;
  signature: PatternSignature;
  tier: "C" | "D";
  status: GroupStatus;
  question: Question;
  recommended: AnswerCode;
  routeSuggested: "treasurer" | "membership" | null;
  routedTo: string | null;
  /** Rows the question is about, and items (pairs or held records) in it, when the result was saved. */
  subjectCount: number;
  itemCount: number;
  /** Items still waiting for an answer, and answered. */
  openItems: number;
  answeredItems: number;
  moneyCents: number;
  members: number;
  contacts: number;
  rank: number;
  answer: AnswerCode | null;
  applyToRest: boolean;
  /** The item to show next (the first one still open, money first). */
  nextItemId: string | null;
  money: boolean;
  sameForRest: boolean;
  rememberable: boolean;
};

export type Progress = {
  groupsTotal: number;
  groupsOpen: number;
  groupsAnswered: number;
  groupsPostponed: number;
  groupsSkipped: number;
  groupsSent: number;
  /** Questions still to do: open or put off, with something unanswered. */
  questionsLeft: number;
  itemsTotal: number;
  itemsOpen: number;
  itemsAnswered: number;
  answeredByPeople: number;
  answeredByRules: number;
  /** Answers by a person that took the recommended answer. */
  suggestionsAccepted: number;
  firstAnsweredAt: string | null;
  lastAnsweredAt: string | null;
  minutesLeft: number;
};

export type InboxView = {
  status: ResultStatus;
  /** A result has been "being saved" for a long time: the last check did not finish. */
  stalled: boolean;
  engineVersion: string | null;
  storedAt: string | null;
  recordCount: number;
  metrics: RunMetrics | null;
  progress: Progress | null;
  groups: InboxGroup[];
};

function rec(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : 0);
const text = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

export function parseProgress(json: unknown): Progress | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const p = rec(json);
  return {
    groupsTotal: num(p.groups_total),
    groupsOpen: num(p.groups_open),
    groupsAnswered: num(p.groups_answered),
    groupsPostponed: num(p.groups_postponed),
    groupsSkipped: num(p.groups_skipped),
    groupsSent: num(p.groups_sent),
    questionsLeft: num(p.questions_left),
    itemsTotal: num(p.items_total),
    itemsOpen: num(p.items_open),
    itemsAnswered: num(p.items_answered),
    answeredByPeople: num(p.answered_by_people),
    answeredByRules: num(p.answered_by_rules),
    suggestionsAccepted: num(p.suggestions_accepted),
    firstAnsweredAt: text(p.first_answered_at),
    lastAnsweredAt: text(p.last_answered_at),
    minutesLeft: num(p.minutes_left),
  };
}

function parseGroup(json: unknown): InboxGroup | null {
  const g = rec(json);
  const signature = text(g.signature) as PatternSignature | null;
  const status = text(g.status) as GroupStatus | null;
  const q = rec(g.question);
  if (!text(g.id) || !signature || !(signature in SIGNATURES) || !status || !GROUP_STATUSES.includes(status) || typeof q.title !== "string") return null;
  const route = text(g.route_suggested);
  return {
    id: g.id as string,
    signature,
    tier: g.tier === "D" ? "D" : "C",
    status,
    question: q as unknown as Question,
    recommended: (text(g.recommended) ?? SIGNATURES[signature].answers[0]) as AnswerCode,
    routeSuggested: route === "treasurer" || route === "membership" ? route : null,
    routedTo: text(g.routed_to),
    subjectCount: num(g.subject_count),
    itemCount: num(g.item_count),
    openItems: num(g.open_items),
    answeredItems: num(g.answered_items),
    moneyCents: num(g.money_cents),
    members: num(g.members),
    contacts: num(g.contacts),
    rank: num(g.rank),
    answer: text(g.answer) as AnswerCode | null,
    applyToRest: g.apply_to_rest === true,
    nextItemId: text(g.next_item_id),
    money: g.money === true,
    sameForRest: g.same_for_rest === true,
    rememberable: g.rememberable === true,
  };
}

export function parseInbox(json: unknown): InboxView | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const v = rec(json);
  const status = text(v.status) as ResultStatus | null;
  if (!status || !RESULT_STATUSES.includes(status)) return null;
  const metrics = rec(v.metrics);
  return {
    status,
    stalled: v.stalled === true,
    engineVersion: text(v.engine_version),
    storedAt: text(v.stored_at),
    recordCount: num(v.record_count),
    metrics: Object.keys(metrics).length > 0 ? (metrics as unknown as RunMetrics) : null,
    progress: parseProgress(v.progress),
    groups: (Array.isArray(v.groups) ? v.groups : []).map(parseGroup).filter((g): g is InboxGroup => g !== null),
  };
}

// ---------------------------------------------------------------------------
// One item, for its card
// ---------------------------------------------------------------------------

/** What a card shows about a record. Never what a row says about children. */
export type CardRecord = {
  id: string;
  /** A child's record is held and never opened: it has no card. */
  minor: boolean;
  rowNo: number;
  source: string;
  sourceKind: string | null;
  kind: string;
  card: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    mobile: string | null;
    phone: string | null;
    phone2: string | null;
    email: string | null;
    email2: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    state: string | null;
    zip: string | null;
    ids: Record<string, string>;
    existingNumber: string | null;
    gift: { amount: string | null; date: string | null; ref: string | null } | null;
  } | null;
};

export type EvidenceLine = { kind: string; label: string; independent: boolean };
export type ConflictLine = { kind: string; label: string; severity: "block" | "lower" };

export type ItemDetail = {
  id: string;
  key: string;
  signature: PatternSignature;
  kind: "pair" | "record";
  tier: "C" | "D";
  subject: string;
  recordIds: string[];
  moneyCents: number;
  answer: AnswerCode | null;
  answerSource: string | null;
  evidence: EvidenceLine[];
  conflicts: ConflictLine[];
  tierReasons: string[];
  records: CardRecord[];
};

function parseCard(c: unknown): CardRecord["card"] {
  const o = rec(c);
  if (Object.keys(o).length === 0) return null;
  const ids: Record<string, string> = {};
  for (const [k, v] of Object.entries(rec(o.ids))) if (typeof v === "string" && v) ids[k] = v;
  const gift = rec(o.gift);
  return {
    name: text(o.name),
    firstName: text(o.firstName),
    lastName: text(o.lastName),
    mobile: text(o.mobile),
    phone: text(o.phone),
    phone2: text(o.phone2),
    email: text(o.email),
    email2: text(o.email2),
    address1: text(o.address1),
    address2: text(o.address2),
    city: text(o.city),
    state: text(o.state),
    zip: text(o.zip),
    ids,
    existingNumber: text(rec(o.existing).number),
    gift: Object.keys(gift).length > 0 ? { amount: text(gift.amount) ?? (typeof gift.amount === "number" ? String(gift.amount) : null), date: text(gift.date), ref: text(gift.ref) } : null,
  };
}

export function parseItemDetail(json: unknown): ItemDetail | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const root = rec(json);
  const it = rec(root.item);
  const signature = text(it.signature) as PatternSignature | null;
  if (!text(it.id) || !signature || !(signature in SIGNATURES)) return null;
  const link = rec(root.link);
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    id: it.id as string,
    key: text(it.key) ?? "",
    signature,
    kind: it.kind === "record" ? "record" : "pair",
    tier: it.tier === "D" ? "D" : "C",
    subject: text(it.subject) ?? "",
    recordIds: strings(it.record_ids),
    moneyCents: num(it.money_cents),
    answer: text(it.answer) as AnswerCode | null,
    answerSource: text(it.answer_source),
    evidence: (Array.isArray(link.evidence) ? link.evidence : []).map((e) => {
      const x = rec(e);
      return { kind: text(x.kind) ?? "", label: text(x.label) ?? "", independent: x.independent === true };
    }),
    conflicts: (Array.isArray(link.conflicts) ? link.conflicts : []).map((e) => {
      const x = rec(e);
      return { kind: text(x.kind) ?? "", label: text(x.label) ?? "", severity: x.severity === "block" ? ("block" as const) : ("lower" as const) };
    }),
    tierReasons: strings(link.tier_reasons),
    records: (Array.isArray(root.records) ? root.records : []).map((r) => {
      const x = rec(r);
      const minor = x.minor === true;
      return {
        id: text(x.id) ?? "",
        minor,
        rowNo: num(x.row_no),
        source: text(x.source) ?? "",
        sourceKind: text(x.source_kind),
        kind: text(x.kind) ?? "unknown",
        card: minor ? null : parseCard(x.card),
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// The imports that can be checked
// ---------------------------------------------------------------------------

export type RunRow = {
  id: string;
  runNumber: number;
  entity: string;
  entityLabel: string;
  fileName: string | null;
  /** The import's own status: pending, staged, previewed, committed... */
  status: string;
  rowsTotal: number;
  createdAt: string | null;
  /** Where the check stands: none (never checked), staged, storing, ready. */
  result: ResultStatus;
  storedAt: string | null;
  groupsTotal: number;
  questionsLeft: number;
};

export function parseRuns(json: unknown): RunRow[] | null {
  if (!Array.isArray(json)) return null;
  const out: RunRow[] = [];
  for (const raw of json) {
    const r = rec(raw);
    const id = text(r.id);
    const result = text(r.result) as ResultStatus | null;
    if (!id || !result || !RESULT_STATUSES.includes(result)) continue;
    out.push({
      id,
      runNumber: num(r.run_number),
      entity: text(r.entity) ?? "",
      entityLabel: text(r.entity_label) ?? "",
      fileName: text(r.file_name),
      status: text(r.status) ?? "",
      rowsTotal: num(r.rows_total),
      createdAt: text(r.created_at),
      result,
      storedAt: text(r.stored_at),
      groupsTotal: num(r.groups_total),
      questionsLeft: num(r.questions_left),
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The numbers of a run, and the result of an answer
// ---------------------------------------------------------------------------

export type RunMetricsView = {
  status: ResultStatus;
  engineVersion: string | null;
  storedAt: string | null;
  recordCount: number;
  metrics: RunMetrics | null;
  live: Progress | null;
};

export function parseRunMetrics(json: unknown): RunMetricsView | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const v = rec(json);
  const status = text(v.status) as ResultStatus | null;
  if (!status || !RESULT_STATUSES.includes(status)) return null;
  const metrics = rec(v.metrics);
  return {
    status,
    engineVersion: text(v.engine_version),
    storedAt: text(v.stored_at),
    recordCount: num(v.record_count),
    metrics: Object.keys(metrics).length > 0 ? (metrics as unknown as RunMetrics) : null,
    live: parseProgress(v.live),
  };
}

export type AnswerOutcome = {
  /** Items answered by this call (one, or one plus the others of the question). */
  answered: number;
  openItems: number;
  status: GroupStatus;
  /** The id of the remembered answer made from it, when one was. */
  rememberedAs: string | null;
};

export function parseAnswerOutcome(json: unknown): AnswerOutcome | null {
  if (json === null || typeof json !== "object" || Array.isArray(json)) return null;
  const v = rec(json);
  const status = text(v.status) as GroupStatus | null;
  if (!status || !GROUP_STATUSES.includes(status)) return null;
  return { answered: num(v.answered), openItems: num(v.open_items), status, rememberedAs: text(v.remembered_as) };
}
