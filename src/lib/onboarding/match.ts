// Smart matching of payers (and later members) into households, for the onboarding flow.
//
// This is a scored search over every signal in the file, not a name comparison. Names alone never
// merge (ARCHITECTURE: "Names are never enough"), but a compatible name plus an agreeing phone, email
// or address is not a name alone. Outcome per pair of rows:
//   auto      same household without asking: (phone or email) with the same surname; the same address
//             with the same surname; or a phone/email AND an address together, whatever the names.
//   ask       probably the same but the evidence is thin or the names disagree: one shared identifier
//             with different surnames (a parent paying for a child, a shared phone), or a matching
//             name with nothing to compare.
//   separate  everything else, including a matching name whose phone, email and address all differ.
// Pure and deterministic: the same rows always give the same groups.
//
// Households ALREADY IN THE RECORDS take part as extra rows tagged with the household they describe
// (`existing`): its name, its people, the names it has paid under. They are matched by the very same rules, so an
// uploaded row that belongs to one of them lands in its group and is linked to it instead of creating a new
// household. Two rules keep the records safe:
//   * two different existing households are never put in one group, however the evidence reads (joining
//     duplicates is the Merge review's job, not onboarding's);
//   * a question is never asked between two existing households.

import { addressKey, emailKey, givenMatches, parseName, phoneKey, surnameMatches, type ParsedName } from "./normalize";

/** A household that is already in the records, as the matcher and the Create step need to name it. */
export type ExistingRef = {
  householdId: string;
  /** The Connect household number: how the import tool is pointed at this household. */
  number: string;
  /** Its name, as the records have it. */
  label: string;
};

export type PayerInput = {
  /** Row number in the file, 1-based; used to point the owner at the row. */
  rowNo: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
  /** Rows that share a group key are the same household without asking (the file said so: a family ID). */
  groupKey?: string | null;
  /** Set on a row that describes a household already in the records (not a row of an uploaded file). */
  existing?: ExistingRef | null;
};

type Prepared = {
  rowNo: number;
  name: string;
  parsed: ParsedName;
  phone: string | null;
  email: string | null;
  addr: { key: string; unit: string | null } | null;
  groupKey: string | null;
  existing: ExistingRef | null;
};

export type Evidence = "phone" | "email" | "address" | "name";

export type PairVerdict = { verdict: "auto" | "ask" | "separate"; evidence: Evidence[]; note: string };

function prepare(p: PayerInput): Prepared {
  const a = addressKey(p.address1, p.address2, p.zip);
  return {
    rowNo: p.rowNo,
    name: p.name,
    parsed: parseName(p.name),
    phone: phoneKey(p.phone),
    email: emailKey(p.email),
    addr: a ? { key: a.key, unit: a.unit } : null,
    groupKey: p.groupKey ? String(p.groupKey) : null,
    existing: p.existing ?? null,
  };
}

function nameStrong(a: ParsedName, b: ParsedName): boolean {
  if (!surnameMatches(a.surname, b.surname)) return false;
  if (a.givens.length === 0 || b.givens.length === 0) return false;
  return a.givens.some((x) => b.givens.some((y) => givenMatches(x, y)));
}

function sameAddress(a: Prepared, b: Prepared): boolean {
  if (!a.addr || !b.addr || a.addr.key !== b.addr.key) return false;
  // Two different apartments in one building are two households.
  if (a.addr.unit && b.addr.unit && a.addr.unit !== b.addr.unit) return false;
  return true;
}

/** Decide one pair. Exported for tests and for the review screen's "why" text. */
export function comparePair(a: Prepared, b: Prepared): PairVerdict {
  const phone = !!a.phone && a.phone === b.phone;
  const email = !!a.email && a.email === b.email;
  const address = sameAddress(a, b);
  const sameSurname = surnameMatches(a.parsed.surname, b.parsed.surname);
  const strongName = nameStrong(a.parsed, b.parsed);
  const evidence: Evidence[] = [];
  if (phone) evidence.push("phone");
  if (email) evidence.push("email");
  if (address) evidence.push("address");
  if (strongName) evidence.push("name");
  const contact = phone || email;

  if (a.groupKey && a.groupKey === b.groupKey) return { verdict: "auto", evidence, note: "the file puts them in the same household" };
  if (contact && sameSurname) return { verdict: "auto", evidence, note: "same phone or email and the same family name" };
  if (address && sameSurname) return { verdict: "auto", evidence, note: "same address and the same family name" };
  if (contact && address) return { verdict: "auto", evidence, note: "same phone or email and the same address" };
  if (contact) return { verdict: "ask", evidence, note: "same phone or email, but a different family name" };
  if (address) return { verdict: "ask", evidence, note: "same address, but a different family name" };
  if (strongName) {
    // A matching name with every identifier both sides have pointing elsewhere is a different person.
    const conflicts = [a.phone && b.phone && a.phone !== b.phone, a.email && b.email && a.email !== b.email, a.addr && b.addr && !sameAddress(a, b)].filter(Boolean).length;
    const comparable = [a.phone && b.phone, a.email && b.email, a.addr && b.addr].filter(Boolean).length;
    if (comparable > 0 && conflicts === comparable) return { verdict: "separate", evidence, note: "same name but different phone, email and address" };
    return { verdict: "ask", evidence, note: "same name, nothing else to compare" };
  }
  return { verdict: "separate", evidence, note: "" };
}

export type Group = {
  id: number;
  /** Row numbers of the UPLOADED rows in this group, ascending (the rows of existing households are not listed). */
  rows: number[];
  /** Suggested household name, from the rows' own names; an existing household's own name when there is one. */
  displayName: string;
  /** Every distinct name the rows were recorded under (kept as aliases). */
  names: string[];
  /** The household already in the records this group is, or null when it is a new household. */
  existing: ExistingRef | null;
  /** Other households already in the records that also look like this one (and cannot be merged here). */
  alsoMatches: ExistingRef[];
};

export type Question = {
  id: number;
  /**
   * A key that names this question by what it is about (the first uploaded row of each group, or the existing
   * household), so a saved answer still belongs to it after the screen is reloaded.
   */
  key: string;
  /** The two groups asked about (ids of `groups`). */
  a: number;
  b: number;
  evidence: Evidence[];
  note: string;
};

export type MatchResult = {
  groups: Group[];
  questions: Question[];
  /** How many row pairs were linked without asking (pairs inside one existing household do not count). */
  autoLinks: number;
};

class Dsu {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]!]!;
      x = this.parent[x]!;
    }
    return x;
  }
  union(a: number, b: number): boolean {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return false;
    if (ra < rb) this.parent[rb] = ra;
    else this.parent[ra] = rb;
    return true;
  }
}

function suggestName(members: Prepared[]): string {
  // The fullest form written: prefer a row naming two people ("Malav & Palak Sanghvi"), else the commonest name.
  const counts = new Map<string, number>();
  for (const m of members) counts.set(m.name.trim(), (counts.get(m.name.trim()) ?? 0) + 1);
  const pair = members.filter((m) => m.parsed.givens.length >= 2).sort((x, y) => y.name.length - x.name.length)[0];
  if (pair) return pair.name.trim();
  return [...counts.entries()].sort((x, y) => y[1] - x[1] || y[0].length - x[0].length)[0]?.[0] ?? "";
}

/** What a group is called when a question names it: the existing household, or the first uploaded row. */
function anchorOf(g: Group): string {
  return g.existing ? `hh:${g.existing.householdId}` : `r${g.rows[0] ?? 0}`;
}

/** Group rows into households. Big files stay fast: only rows sharing a phone, email, address or surname are compared. */
export function matchPayers(input: readonly PayerInput[]): MatchResult {
  const rows = input.map(prepare);
  const n = rows.length;
  const dsu = new Dsu(n);
  // The existing household each component already is (by root); two different ones never join.
  const compEx: (string | null)[] = rows.map((r) => r.existing?.householdId ?? null);
  const refOf = new Map<string, ExistingRef>();

  // The rows that describe one existing household are that household from the start.
  const firstOf = new Map<string, number>();
  rows.forEach((r, i) => {
    if (!r.existing) return;
    refOf.set(r.existing.householdId, r.existing);
    const f = firstOf.get(r.existing.householdId);
    if (f === undefined) firstOf.set(r.existing.householdId, i);
    else dsu.union(f, i);
  });

  const blocks = new Map<string, number[]>();
  const add = (k: string | null, i: number) => {
    if (!k) return;
    const l = blocks.get(k);
    if (l) l.push(i);
    else blocks.set(k, [i]);
  };
  rows.forEach((r, i) => {
    add(r.phone && `p:${r.phone}`, i);
    add(r.email && `e:${r.email}`, i);
    add(r.addr && `a:${r.addr.key}`, i);
    add(r.groupKey && `g:${r.groupKey}`, i);
    // Two names are a strong match only when they share a family name AND a given name or its initial, so rows are
    // compared by name only within (family name, first letter of a given name): with the records' households in the
    // mix, a common surname would otherwise put hundreds of rows in one block.
    if (r.parsed.surname) for (const initial of new Set(r.parsed.givens.map((g) => g[0]).filter(Boolean))) add(`s:${r.parsed.surname}|${initial}`, i);
  });

  const seen = new Set<string>();
  const autoPairs: { i: number; j: number; ev: number }[] = [];
  const asks: { i: number; j: number; v: PairVerdict }[] = [];
  let autoLinks = 0;
  for (const [blockKey, list] of blocks) {
    if (list.length < 2) continue;
    // A very common name in a big file would compare everyone with everyone; cap the block and rely on the other
    // blocks (phone, email, address) for those rows.
    if (list.length > 400 && blockKey.startsWith("s:")) continue;
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x]!;
        const j = list[y]!;
        // Two rows of the records are never compared: their own households are already decided.
        if (rows[i]!.existing && rows[j]!.existing) continue;
        const key = `${i}:${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const v = comparePair(rows[i]!, rows[j]!);
        if (v.verdict === "auto") {
          autoLinks++;
          autoPairs.push({ i, j, ev: v.evidence.length });
        } else if (v.verdict === "ask") asks.push({ i, j, v });
      }
    }
  }

  // Strongest evidence first, so when one row fits two existing households it joins the better fit.
  autoPairs.sort((p, q) => q.ev - p.ev || p.i - q.i || p.j - q.j);
  const skipped: { i: number; j: number }[] = [];
  for (const p of autoPairs) {
    const ri = dsu.find(p.i);
    const rj = dsu.find(p.j);
    if (ri === rj) continue;
    const ea = compEx[ri] ?? null;
    const eb = compEx[rj] ?? null;
    if (ea && eb && ea !== eb) {
      skipped.push({ i: p.i, j: p.j });
      continue;
    }
    dsu.union(p.i, p.j);
    compEx[dsu.find(p.i)] = ea ?? eb;
  }

  const byRoot = new Map<number, number[]>();
  rows.forEach((_, i) => {
    const r = dsu.find(i);
    const l = byRoot.get(r);
    if (l) l.push(i);
    else byRoot.set(r, [i]);
  });
  const roots = [...byRoot.keys()].sort((a, b) => a - b);
  const groupIdOfRoot = new Map<number, number>();
  const all: Group[] = roots.map((root, gi) => {
    groupIdOfRoot.set(root, gi);
    const members = byRoot.get(root)!.map((i) => rows[i]!);
    const uploaded = members.filter((m) => !m.existing);
    const exId = compEx[root] ?? null;
    const existing = exId ? (refOf.get(exId) ?? null) : null;
    const names = [...new Set(members.map((m) => m.name.trim()).filter(Boolean))];
    return {
      id: gi,
      rows: uploaded.map((m) => m.rowNo).sort((a, b) => a - b),
      displayName: existing ? existing.label : suggestName(uploaded),
      names,
      existing,
      alsoMatches: [],
    };
  });
  const groupOf = (i: number) => all[groupIdOfRoot.get(dsu.find(i))!]!;

  // Another existing household that also fits: said on the group, never acted on.
  const noteAlso = (ga: Group, gb: Group) => {
    if (ga.rows.length > 0 && gb.existing && !ga.alsoMatches.some((e) => e.householdId === gb.existing!.householdId)) ga.alsoMatches.push(gb.existing);
  };
  for (const { i, j } of skipped) {
    const ga = groupOf(i);
    const gb = groupOf(j);
    noteAlso(ga, gb);
    noteAlso(gb, ga);
  }

  // One question per pair of groups, carrying the strongest evidence seen between them.
  const qmap = new Map<string, Omit<Question, "id" | "key">>();
  for (const { i, j, v } of asks) {
    const ga = groupOf(i);
    const gb = groupOf(j);
    if (ga.id === gb.id) continue;
    if (ga.existing && gb.existing && ga.existing.householdId !== gb.existing.householdId) {
      noteAlso(ga, gb);
      noteAlso(gb, ga);
      continue;
    }
    const a = Math.min(ga.id, gb.id);
    const b = Math.max(ga.id, gb.id);
    const key = `${a}:${b}`;
    const prev = qmap.get(key);
    if (!prev || v.evidence.length > prev.evidence.length) qmap.set(key, { a, b, evidence: v.evidence, note: v.note });
  }

  // Households of the records that nothing in the files points at are not part of this review.
  const asked = new Set<number>();
  for (const q of qmap.values()) {
    asked.add(q.a);
    asked.add(q.b);
  }
  const keep = all.filter((g) => g.rows.length > 0 || asked.has(g.id));
  const newId = new Map(keep.map((g, k) => [g.id, k]));
  const groups = keep.map((g, k) => ({ ...g, id: k }));
  const questions = [...qmap.values()]
    .map((q) => ({ a: newId.get(q.a)!, b: newId.get(q.b)!, evidence: q.evidence, note: q.note }))
    .sort((x, y) => y.evidence.length - x.evidence.length || x.a - y.a || x.b - y.b)
    .map((q, id): Question => ({ ...q, id, key: [anchorOf(groups[q.a]!), anchorOf(groups[q.b]!)].sort().join("~") }));
  return { groups, questions, autoLinks };
}

/** Everything a set of "merge" answers decides: the final groups, and the answers that could not be applied. */
function settle(result: MatchResult, merge: ReadonlySet<number>) {
  const dsu = new Dsu(result.groups.length);
  const ex = result.groups.map((g) => g.existing?.householdId ?? null);
  const blocked = new Set<number>();
  for (const q of result.questions) {
    if (!merge.has(q.id)) continue;
    const ra = dsu.find(q.a);
    const rb = dsu.find(q.b);
    if (ra === rb) continue;
    const ea = ex[ra] ?? null;
    const eb = ex[rb] ?? null;
    // Joining two households that are already in the records is the Merge review's job.
    if (ea && eb && ea !== eb) {
      blocked.add(q.id);
      continue;
    }
    dsu.union(q.a, q.b);
    ex[dsu.find(q.a)] = ea ?? eb;
  }
  return { dsu, ex, blocked };
}

/**
 * Apply the owner's answers (question id -> merge): the final groups, re-numbered, and the question ids whose
 * "merge" could not be applied because it would join two households that are already in the records.
 */
export function resolveMerges(result: MatchResult, merge: ReadonlySet<number>): { groups: Group[]; blocked: Set<number> } {
  const { dsu, blocked } = settle(result, merge);
  const byRoot = new Map<number, Group[]>();
  for (const g of result.groups) {
    const r = dsu.find(g.id);
    const l = byRoot.get(r);
    if (l) l.push(g);
    else byRoot.set(r, [g]);
  }
  const groups = [...byRoot.values()]
    .map((gs): Group => {
      const existing = gs.find((g) => g.existing)?.existing ?? null;
      const biggest = [...gs].sort((x, y) => y.rows.length - x.rows.length)[0]!;
      const alsoMatches = new Map<string, ExistingRef>();
      for (const g of gs) for (const e of g.alsoMatches) if (e.householdId !== existing?.householdId) alsoMatches.set(e.householdId, e);
      return {
        id: 0,
        rows: gs.flatMap((g) => g.rows).sort((a, b) => a - b),
        displayName: existing ? existing.label : biggest.displayName,
        names: [...new Set(gs.flatMap((g) => g.names))],
        existing,
        alsoMatches: [...alsoMatches.values()],
      };
    })
    // A household of the records that no uploaded row belongs to is not part of the result.
    .filter((g) => g.rows.length > 0)
    .sort((a, b) => a.rows[0]! - b.rows[0]!)
    .map((g, id) => ({ ...g, id }));
  return { groups, blocked };
}

/** Apply the owner's answers (question id -> merge) and return the final groups, re-numbered. */
export function applyDecisions(result: MatchResult, merge: ReadonlySet<number>): Group[] {
  return resolveMerges(result, merge).groups;
}

/**
 * True when answering "merge" to this question, on top of the merges already chosen, would join two households
 * that are already in the records. The screen disables that answer and says why.
 */
export function mergeWouldJoinExisting(result: MatchResult, merged: ReadonlySet<number>, questionId: number): boolean {
  const q = result.questions.find((x) => x.id === questionId);
  if (!q) return false;
  const { dsu, ex } = settle(result, merged);
  const ra = dsu.find(q.a);
  const rb = dsu.find(q.b);
  if (ra === rb) return false;
  const ea = ex[ra] ?? null;
  const eb = ex[rb] ?? null;
  return Boolean(ea && eb && ea !== eb);
}
