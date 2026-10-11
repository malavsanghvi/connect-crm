// The engine's result as the pages the database functions take (0631), and the remembered answers as the engine reads them.
// Pure: plain objects in snake_case that match the columns of 0630, no database, no network. Everything is JSON, so a page
// can be sent as it is.

import type { ResolveConfig } from "./config";
import { questionBudget, SIGNATURES, type ExceptionGroup, type ExceptionItem } from "./exceptions";
import { computeMetrics, type RunMetrics } from "./metrics";
import type { AppliedRule, DecisionRule } from "./memory";
import type { ResolveResult } from "./run";
import type { ClassifiedPair, PatternSignature, RawRecord } from "./types";

/** The most each function takes in one call (kept in step with resolve_list in 0631). */
export const PAGE_SIZE = { records: 500, pairs: 500, clusters: 500, groups: 200, items: 500 } as const;

export function pagesOf<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

export type StagePayload = {
  id: string;
  source: string;
  source_kind: RawRecord["sourceKind"];
  row_no: number;
  order_no: number;
  kind: RawRecord["kind"];
  read_confidence: number | null;
  raw: RawRecord;
};

/** One entry per record, in the order given (the engine reads them back in this order). */
export function stagePayloads(records: readonly RawRecord[]): StagePayload[] {
  return records.map((r, i) => ({
    id: r.id,
    source: r.source,
    source_kind: r.sourceKind,
    row_no: r.row,
    order_no: i,
    kind: r.kind,
    read_confidence: r.readConfidence ?? null,
    raw: r,
  }));
}

// ---------------------------------------------------------------------------
// The result
// ---------------------------------------------------------------------------

export type RecordPayload = {
  id: string;
  normalized: unknown;
  fingerprint: string;
  minor: boolean;
  minor_reasons: string[];
  type_uncertain: boolean;
  problems: string[];
  status: string;
  how: string;
  tier: string | null;
  cluster_id: string | null;
  duplicate_of: string | null;
};

/** What was found about each record, with what happens to it. */
export function recordPayloads(result: Pick<ResolveResult, "records" | "dispositions" | "giftDuplicates">): RecordPayload[] {
  const disposition = new Map(result.dispositions.map((d) => [d.id, d]));
  const duplicateOf = new Map(result.giftDuplicates.map((g) => [g.skip, g.keep]));
  return result.records.map((r) => {
    const d = disposition.get(r.id);
    if (!d) throw new Error(`The result has no outcome for the row ${r.id}.`);
    return {
      id: r.id,
      normalized: r,
      fingerprint: r.fingerprint,
      minor: r.minor.isMinor,
      minor_reasons: [...r.minor.reasons],
      type_uncertain: r.typeUncertain,
      problems: [...r.problems],
      status: d.status,
      how: d.how,
      tier: d.tier,
      cluster_id: d.clusterId,
      duplicate_of: duplicateOf.get(r.id) ?? null,
    };
  });
}

export type PairPayload = {
  a: string;
  b: string;
  relation: string;
  strength: string;
  score: number;
  independent: number;
  evidence: unknown;
  conflicts: unknown;
  name_level: string;
  name_only: boolean;
  via_keys: string[];
  money: unknown;
  tier: string;
  tier_reasons: string[];
  hold: string | null;
  signature: string | null;
  affected: string[];
  implied: boolean;
};

/** Every scored pair once (a pair that surfaced through several blocking keys is one pair). */
export function pairPayloads(pairs: readonly ClassifiedPair[]): PairPayload[] {
  const seen = new Set<string>();
  const out: PairPayload[] = [];
  for (const p of pairs) {
    const key = `${p.a}\u0000${p.b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      a: p.a,
      b: p.b,
      relation: p.relation,
      strength: p.strength,
      score: p.score,
      independent: p.independent,
      evidence: p.evidence,
      conflicts: p.conflicts,
      name_level: p.nameLevel,
      name_only: p.nameOnly,
      via_keys: [...p.viaKeys],
      money: p.money,
      tier: p.tier,
      tier_reasons: [...p.tierReasons],
      hold: p.hold,
      signature: p.signature,
      affected: [...p.affected],
      implied: p.implied,
    });
  }
  return out;
}

export type ClusterPayload = { kind: "household" | "person"; id: string; record_ids: string[]; existing: string[] };

export function clusterPayloads(result: Pick<ResolveResult, "clusters" | "personClusters">): ClusterPayload[] {
  const one = (kind: ClusterPayload["kind"]) => (c: { id: string; recordIds: string[]; existing: string[] }): ClusterPayload => ({
    kind,
    id: c.id,
    record_ids: [...c.recordIds],
    existing: [...c.existing],
  });
  return [...result.clusters.map(one("household")), ...result.personClusters.map(one("person"))];
}

export type GroupPayload = {
  signature: PatternSignature;
  tier: "C" | "D";
  question: unknown;
  recommended: string;
  subject_count: number;
  item_count: number;
  money_cents: number;
  members: number;
  contacts: number;
  rank_no: number;
  route_suggested: "treasurer" | "membership" | null;
};

/** The questions, in the order the engine ranked them (money, then members, then contacts). */
export function groupPayloads(groups: readonly ExceptionGroup[]): GroupPayload[] {
  return groups.map((g, i) => ({
    signature: g.signature,
    tier: g.tier,
    question: g.question,
    recommended: g.question.recommended,
    subject_count: g.subjects.length,
    item_count: g.items.length,
    money_cents: g.value.moneyCents,
    members: g.value.members,
    contacts: g.value.contacts,
    rank_no: i,
    route_suggested: g.question.routeTo,
  }));
}

export type ItemPayload = {
  key: string;
  signature: PatternSignature;
  kind: "pair" | "record";
  tier: "C" | "D";
  subject: string;
  record_ids: string[];
  fingerprints: string[];
  evidence_kinds: string[];
  conflict_kinds: string[];
  shared: ExceptionItem["shared"];
  money_cents: number;
  members: number;
  contacts: number;
  rule_id: string | null;
  rule_answer: string | null;
};

/**
 * Every item that needed a person, with the remembered answer that already answers it (if one does). A remembered answer on a
 * held item (a child, a money conflict) or on a record is refused here before it is sent, as the database refuses it again.
 */
export function itemPayloads(items: readonly ExceptionItem[], applied: readonly AppliedRule[], rules: readonly DecisionRule[] = []): ItemPayload[] {
  const byItem = new Map(applied.map((a) => [a.itemKey, a]));
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  return items.map((it) => {
    const hit = byItem.get(it.key);
    if (hit) {
      if (it.tier === "D" || it.kind === "record" || SIGNATURES[it.signature].tier === "D") {
        throw new Error("A remembered answer was about something a person has to decide each time.");
      }
      const rule = ruleById.get(hit.ruleId);
      if (rules.length > 0 && (!rule || rule.signature !== it.signature || rule.answer !== hit.answer)) {
        throw new Error("A remembered answer does not fit the item it was applied to.");
      }
    }
    return {
      key: it.key,
      signature: it.signature,
      kind: it.kind,
      tier: it.tier,
      subject: it.subject,
      record_ids: [...it.recordIds],
      fingerprints: [...it.fingerprints],
      evidence_kinds: [...it.evidenceKinds],
      conflict_kinds: [...it.conflictKinds],
      shared: it.shared,
      money_cents: it.moneyCents,
      members: it.members,
      contacts: it.contacts,
      rule_id: hit?.ruleId ?? null,
      rule_answer: hit?.answer ?? null,
    };
  });
}

/**
 * The run's numbers. When some records are only link targets (households already in the records), they are not rows of the file:
 * the share resolved automatically and the questions per 1,000 rows are counted over the file's own rows.
 */
export function metricsForRun(result: ResolveResult, cfg: ResolveConfig, isTarget: (recordId: string) => boolean): RunMetrics {
  const dispositions = result.dispositions.filter((d) => !isTarget(d.id));
  if (dispositions.length === result.dispositions.length) return result.metrics;
  const budget = questionBudget(result.groups, dispositions.length, cfg);
  return computeMetrics({ dispositions, pairs: result.pairs, groups: result.groups, budget, hubs: result.hubs, cfg });
}

// ---------------------------------------------------------------------------
// Remembered answers
// ---------------------------------------------------------------------------

const SCOPES = new Set(["exact_pair", "identifier", "pattern"]);

/**
 * The community's remembered answers as the database returns them (resolve_rules, already in the shape of DecisionRule).
 * A row that cannot be read is left out and counted: the worst that happens is that the question is asked again.
 */
export function rulesFromRows(rows: unknown): { rules: DecisionRule[]; skipped: number } {
  if (!Array.isArray(rows)) return { rules: [], skipped: 0 };
  const rules: DecisionRule[] = [];
  let skipped = 0;
  for (const raw of rows) {
    const r = (raw ?? {}) as Record<string, unknown>;
    const ok =
      typeof r.id === "string" &&
      typeof r.signature === "string" &&
      r.signature in SIGNATURES &&
      typeof r.scope === "string" &&
      SCOPES.has(r.scope) &&
      Array.isArray(r.conditions) &&
      r.conditions.length > 0 &&
      typeof r.answer === "string" &&
      typeof r.decidedAt === "string";
    if (!ok) {
      skipped += 1;
      continue;
    }
    rules.push({
      id: r.id as string,
      signature: r.signature as PatternSignature,
      scope: r.scope as DecisionRule["scope"],
      conditions: r.conditions as DecisionRule["conditions"],
      answer: r.answer as DecisionRule["answer"],
      decidedBy: typeof r.decidedBy === "string" ? r.decidedBy : "",
      decidedAt: r.decidedAt as string,
      fromGroup: typeof r.fromGroup === "string" ? r.fromGroup : null,
      revokedAt: typeof r.revokedAt === "string" ? r.revokedAt : null,
    });
  }
  return { rules, skipped };
}
