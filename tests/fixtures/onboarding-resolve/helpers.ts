// Small builders for the hand-written resolve tests. All people here are invented.

import { makeConfig, type ConfigOverrides } from "@/lib/onboarding/resolve/config";
import { resolveRecords, type ResolveResult } from "@/lib/onboarding/resolve/run";
import type { ClassifiedPair, RawRecord } from "@/lib/onboarding/resolve/types";
import type { DecisionRule } from "@/lib/onboarding/resolve/memory";

export const TODAY = "2026-10-11";

let seq = 0;

/** A person row with sensible defaults; override anything. Ids are unique per call unless given. */
export function rec(fields: Partial<RawRecord>): RawRecord {
  seq += 1;
  return { id: fields.id ?? `r${seq}`, source: "a.xlsx", sourceKind: "spreadsheet", row: seq, kind: "person", ...fields };
}

export function gift(fields: Partial<RawRecord> & { amount: string; date: string; ref?: string | null }): RawRecord {
  const { amount, date, ref, ...rest } = fields;
  return rec({ kind: "gift", source: "g1.csv", ...rest, gift: { amount, date, ref: ref ?? null } });
}

export function run(records: RawRecord[], overrides: ConfigOverrides = {}, rules: DecisionRule[] = []): ResolveResult {
  return resolveRecords({ records, config: makeConfig(TODAY, { country: "US", ...overrides }), rules });
}

/** The scored pair between two records, whichever way round. */
export function pairOf(res: ResolveResult, a: string, b: string): ClassifiedPair | undefined {
  return res.pairs.find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));
}

export const labels = (p: ClassifiedPair): string[] => p.evidence.map((e) => e.label);
