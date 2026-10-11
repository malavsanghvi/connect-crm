// The whole pipeline in one pure call: normalise, link, tier, group, apply remembered answers, measure.
// No database, no network, no model. The same rows and rules always give the same result, and the result is plain JSON.

import type { ResolveConfig } from "./config";
import {
  buildItems,
  groupItems,
  pairItemKey,
  questionBudget,
  type ExceptionGroup,
  type ExceptionItem,
  type QuestionBudget,
} from "./exceptions";
import { candidatePairs, evidenceBetween, hasBlockConflict, makeLinkContext, scoreCandidates, type LinkContext } from "./link";
import { computeMetrics, type RunMetrics } from "./metrics";
import { applyRules, type AppliedRule, type DecisionRule } from "./memory";
import { normalizeRecords } from "./normalize";
import type { Locale } from "./strings";
import { classifyPair, holdForRecord, isLowConfidence } from "./tier";
import type { ClassifiedPair, Cluster, Evidence, EvidenceKind, Hub, NormalizedRecord, RawRecord, RecordDisposition, Tier } from "./types";

export type ResolveInput = {
  records: readonly RawRecord[];
  config: ResolveConfig;
  /** Remembered answers from earlier runs. Applied to tier C items only. */
  rules?: readonly DecisionRule[];
  locale?: Locale;
};

export type GiftDuplicate = { keep: string; skip: string };

export type ResolveResult = {
  records: NormalizedRecord[];
  /** Every scored pair, with its tier, evidence and (for C and D) its pattern signature. */
  pairs: ClassifiedPair[];
  /** Households: records joined automatically (tier A). Only clusters of two or more. */
  clusters: Cluster[];
  /** The same, but only where the records are the same PERSON. */
  personClusters: Cluster[];
  /** Gifts found in two sources: the second is skipped, the first is loaded. */
  giftDuplicates: GiftDuplicate[];
  hubs: Hub[];
  /** Blocking keys too big to compare pair by pair. */
  skippedBlocks: Hub[];
  /** Every item that needed a person, before remembered answers. */
  items: ExceptionItem[];
  answeredByRules: AppliedRule[];
  /** The questions that are left, ranked by value. */
  groups: ExceptionGroup[];
  dispositions: RecordDisposition[];
  budget: QuestionBudget;
  metrics: RunMetrics;
};

// ---------------------------------------------------------------------------
// Clusters: transitive links, kept honest
// ---------------------------------------------------------------------------

type Merge = { clusters: Cluster[]; refused: ClassifiedPair[]; clusterOf: Map<string, string> };

/**
 * Joins records along tier A links, strongest first. A link is refused (and later asked about) when it would put two
 * records in one cluster that contradict each other (different birth years, different IDs) or two different households
 * already in the records. Each link can look right on its own and the chain still be wrong.
 */
function mergeLinks(norm: readonly NormalizedRecord[], links: readonly ClassifiedPair[], cfg: ResolveConfig, ctx: LinkContext): Merge {
  const index = new Map(norm.map((r, i) => [r.id, i]));
  const parent = norm.map((_, i) => i);
  const members: number[][] = norm.map((_, i) => [i]);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  const existingOf = (ms: number[]): Set<string> => new Set(ms.map((m) => norm[m].existing?.householdId).filter((h): h is string => !!h));
  const refused: ClassifiedPair[] = [];
  for (const p of links) {
    const ra = find(index.get(p.a)!);
    const rb = find(index.get(p.b)!);
    if (ra === rb) continue;
    const exA = existingOf(members[ra]);
    const exB = existingOf(members[rb]);
    let ok = true;
    if (exA.size > 0 && exB.size > 0 && ![...exA].every((h) => exB.has(h))) ok = false;
    if (ok) {
      outer: for (const x of members[ra]) {
        for (const y of members[rb]) {
          if (hasBlockConflict(norm[x], norm[y], cfg, ctx)) {
            ok = false;
            break outer;
          }
        }
      }
    }
    if (!ok) {
      refused.push(p);
      continue;
    }
    parent[rb] = ra;
    members[ra] = members[ra].concat(members[rb]);
    members[rb] = [];
  }
  const clusters: Cluster[] = [];
  const clusterOf = new Map<string, string>();
  for (let i = 0; i < norm.length; i++) {
    if (members[i].length < 2 || find(i) !== i) continue;
    const ids = members[i].map((m) => norm[m].id).sort();
    const id = `c:${ids[0]}`;
    clusters.push({ id, recordIds: ids, existing: [...existingOf(members[i])].sort() });
    for (const rid of ids) clusterOf.set(rid, id);
  }
  clusters.sort((x, y) => x.id.localeCompare(y.id));
  return { clusters, refused, clusterOf };
}

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

const TIER_RANK: Record<Tier, number> = { A: 0, B: 1, C: 2, D: 3 };

/**
 * A pair of rows that agree on one identifier may be certain once the OTHER rows of the same person are counted: a donation
 * with an e-mail and an address, and a person whose e-mail is on one row and whose address is on another. For every tier B pair
 * about one person, the rows already joined to each side are compared with each other, and when the identifiers that agree
 * across them add up to the tier A rule (and nothing contradicts, and no name is repeated) the pair is promoted. Repeated until
 * nothing changes. Only people already joined at tier A are pooled, so a wrong pool needs a wrong tier A first.
 */
function promotePooled(norm: readonly NormalizedRecord[], start: readonly ClassifiedPair[], cfg: ResolveConfig, ctx: LinkContext): ClassifiedPair[] {
  const byId = new Map(norm.map((r) => [r.id, r]));
  const weight: Partial<Record<EvidenceKind, number>> = { phone: cfg.weights.phone, email: cfg.weights.email, address: cfg.weights.address, id: cfg.weights.id, dob: cfg.weights.dob };
  let pairs = [...start];
  for (let round = 0; round < 3; round++) {
    const people = mergeLinks(norm, pairs.filter((p) => p.tier === "A" && p.relation !== "same_household"), cfg, ctx);
    const clusterRecords = new Map(people.clusters.map((c) => [c.id, c.recordIds]));
    const membersOf = (id: string): string[] => {
      const c = people.clusterOf.get(id);
      return c ? clusterRecords.get(c)! : [id];
    };
    let changed = false;
    pairs = pairs.map((p) => {
      if (p.tier !== "B" || p.relation !== "same_person" || p.hold !== null || p.conflicts.length > 0) return p;
      const have = new Set<EvidenceKind>(p.evidence.filter((e) => e.independent).map((e) => e.kind));
      let personal = p.evidence.some((e) => e.independent && e.personal);
      const added = new Map<EvidenceKind, Evidence>();
      let stop = false;
      for (const x of membersOf(p.a)) {
        for (const y of membersOf(p.b)) {
          if (stop || x === y) continue;
          const f = evidenceBetween(byId.get(x)!, byId.get(y)!, cfg, ctx);
          // Anything that contradicts, or any doubt about the name (a Jr, a repeated name), stops the pooling.
          if (f.blocked || f.lowerConflicts > 0) stop = true;
          for (const e of f.evidence) {
            if (e.personal) personal = true;
            if (have.has(e.kind) || added.has(e.kind)) continue;
            added.set(e.kind, { kind: e.kind, independent: true, points: weight[e.kind] ?? e.points, label: `${e.label} (on another row of the same person)`, personal: e.personal });
          }
        }
      }
      const total = have.size + added.size;
      // Something that belongs to one person must be among them: relatives share an address and a family number.
      if (stop || !personal || total < cfg.tier.autoMinIdentifiers) return p;
      changed = true;
      const extra = [...added.values()];
      return {
        ...p,
        tier: "A" as const,
        strength: "strong" as const,
        evidence: [...p.evidence, ...extra],
        independent: total,
        score: Math.min(100, p.score + extra.reduce((n, e) => n + e.points, 0)),
        tierReasons: [...p.tierReasons, `${total} independent identifiers agree once the other rows of the same person are counted`],
        signature: null,
        affected: [],
      };
    });
    if (!changed) break;
  }
  return pairs;
}

export function resolveRecords(input: ResolveInput): ResolveResult {
  const cfg = input.config;
  const locale = input.locale ?? "en";
  const norm = normalizeRecords(input.records, cfg);
  const byId = new Map(norm.map((r) => [r.id, r]));

  const blocking = candidatePairs(norm, cfg);
  const ctx = makeLinkContext(norm, blocking.hubKeys);
  const scored = scoreCandidates(norm, blocking, cfg);
  let pairs: ClassifiedPair[] = scored.map((p) => classifyPair(p, byId.get(p.a)!, byId.get(p.b)!, cfg));
  pairs = promotePooled(norm, pairs, cfg, ctx);

  // Households and people: join along tier A, refusing contradictory chains. The same gift seen twice has one donor.
  const linksA = pairs.filter((p) => p.tier === "A");
  const house = mergeLinks(norm, linksA, cfg, ctx);
  const person = mergeLinks(norm, linksA.filter((p) => p.relation !== "same_household"), cfg, ctx);
  if (house.refused.length > 0) {
    const refused = new Set(house.refused);
    pairs = pairs.map((p) => {
      if (!refused.has(p)) return p;
      const a = byId.get(p.a)!;
      const b = byId.get(p.b)!;
      const subject = a.sourceKind === "existing" && b.sourceKind !== "existing" ? b : b.sourceKind === "existing" && a.sourceKind !== "existing" ? a : a.order >= b.order ? a : b;
      return {
        ...p,
        tier: "C" as const,
        signature: "linked_through_another_record" as const,
        tierReasons: [...p.tierReasons, "joining them would contradict another record already in the group"],
        affected: [subject.id],
      };
    });
  }

  // A weaker pair whose two records already share a cluster adds nothing to ask.
  pairs = pairs.map((p) => {
    if ((p.tier !== "B" && p.tier !== "C") || p.relation === "same_gift" || p.conflicts.some((c) => c.severity === "block")) return p;
    const clusterOf = p.relation === "same_person" ? person.clusterOf : house.clusterOf;
    const ca = clusterOf.get(p.a);
    if (!ca || ca !== clusterOf.get(p.b)) return p;
    return { ...p, implied: true, affected: [], tierReasons: [...p.tierReasons, "already joined through other, stronger links"] };
  });

  // One decision per pair of groups: of the B and C pairs between the same two clusters, only the strongest is put to a person.
  // Approving it joins the clusters, and the others are then implied.
  const reviewable = (p: ClassifiedPair) =>
    !p.implied && (p.tier === "B" || p.tier === "C") && p.hold === null && p.relation !== "same_gift" && p.signature !== "low_confidence_read";
  const groupKey = (p: ClassifiedPair): string => {
    const clusterOf = p.relation === "same_person" ? person.clusterOf : house.clusterOf;
    return `${p.relation}|${[clusterOf.get(p.a) ?? p.a, clusterOf.get(p.b) ?? p.b].sort().join("|")}`;
  };
  const strongestFirst = pairs
    .filter(reviewable)
    .sort((x, y) => TIER_RANK[x.tier] - TIER_RANK[y.tier] || y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
  const chosen = new Map<string, ClassifiedPair>();
  for (const p of strongestFirst) if (!chosen.has(groupKey(p))) chosen.set(groupKey(p), p);
  pairs = pairs.map((p) =>
    reviewable(p) && chosen.get(groupKey(p)) !== p
      ? { ...p, implied: true, affected: [], tierReasons: [...p.tierReasons, "decided together with a stronger pair between the same two groups of rows"] }
      : p,
  );

  // The same gift in two sources: load the first, skip the second.
  const giftDuplicates: GiftDuplicate[] = [];
  const skipped = new Set<string>();
  for (const p of pairs) {
    if (p.tier !== "A" || p.relation !== "same_gift" || skipped.has(p.b)) continue;
    skipped.add(p.b);
    giftDuplicates.push({ keep: p.a, skip: p.b });
  }

  // Everything that needs a person, minus what a remembered rule answers.
  const items = buildItems(pairs, norm, cfg);
  const { applied, remaining } = applyRules(items, input.rules ?? []);
  const answeredKeys = new Set(applied.map((a) => a.itemKey));
  const groups = groupItems(remaining, norm, pairs, locale);
  const budget = questionBudget(groups, norm.length, cfg, locale);

  // One disposition per record: the worst thing that is still open about it.
  const open = new Map<string, Tier>();
  const raise = (id: string, tier: Tier) => {
    const cur = open.get(id);
    if (!cur || TIER_RANK[tier] > TIER_RANK[cur]) open.set(id, tier);
  };
  const ruled = new Set<string>();
  for (const p of pairs) {
    if (p.tier === "A" || p.implied) continue;
    if (p.hold === "minor" || p.hold === "uncertain_type" || p.hold === "unreadable_money") continue; // record-level, below
    if (p.signature === "low_confidence_read") continue;
    const key = pairItemKey(p, byId.get(p.a)!, byId.get(p.b)!);
    if (key !== null && answeredKeys.has(key)) {
      for (const id of p.affected) ruled.add(id);
      continue;
    }
    for (const id of p.affected) raise(id, p.tier);
  }
  for (const r of norm) {
    if (holdForRecord(r) !== null) raise(r.id, "D");
    else if (isLowConfidence(r, cfg)) raise(r.id, "C");
  }
  const linkedIds = new Set<string>();
  for (const p of pairs) if (p.tier === "A") {
    linkedIds.add(p.a);
    linkedIds.add(p.b);
  }
  const dispositions: RecordDisposition[] = norm.map((r) => {
    const tier = open.get(r.id) ?? null;
    const clusterId = house.clusterOf.get(r.id) ?? null;
    if (tier === "D") return { id: r.id, status: "held", how: "hold", tier, clusterId };
    if (tier === "C") return { id: r.id, status: "asked", how: "question", tier, clusterId };
    if (tier === "B") return { id: r.id, status: "bulk", how: "review", tier, clusterId };
    if (ruled.has(r.id)) return { id: r.id, status: "learned", how: "rule", tier: "C", clusterId };
    if (skipped.has(r.id)) return { id: r.id, status: "auto", how: "duplicate_gift", tier: "A", clusterId };
    if (linkedIds.has(r.id)) return { id: r.id, status: "auto", how: "linked", tier: "A", clusterId };
    return { id: r.id, status: "auto", how: "new", tier: null, clusterId };
  });

  const metrics = computeMetrics({ dispositions, pairs, groups, budget, hubs: blocking.hubs, cfg });
  return {
    records: norm,
    pairs,
    clusters: house.clusters,
    personClusters: person.clusters,
    giftDuplicates,
    hubs: blocking.hubs,
    skippedBlocks: blocking.skipped,
    items,
    answeredByRules: applied,
    groups,
    dispositions,
    budget,
    metrics,
  };
}
