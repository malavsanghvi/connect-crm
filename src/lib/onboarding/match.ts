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

import { addressKey, emailKey, givenMatches, parseName, phoneKey, surnameMatches, type ParsedName } from "./normalize";

export type PayerInput = {
  /** Row number in the file, 1-based; used to point the owner at the row. */
  rowNo: number;
  name: string;
  email?: string | null;
  phone?: string | null;
  address1?: string | null;
  address2?: string | null;
  zip?: string | null;
};

type Prepared = {
  rowNo: number;
  name: string;
  parsed: ParsedName;
  phone: string | null;
  email: string | null;
  addr: { key: string; unit: string | null } | null;
};

export type Evidence = "phone" | "email" | "address" | "name";

export type PairVerdict = { verdict: "auto" | "ask" | "separate"; evidence: Evidence[]; note: string };

function prepare(p: PayerInput): Prepared {
  const a = addressKey(p.address1, p.address2, p.zip);
  return { rowNo: p.rowNo, name: p.name, parsed: parseName(p.name), phone: phoneKey(p.phone), email: emailKey(p.email), addr: a ? { key: a.key, unit: a.unit } : null };
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
  /** Row numbers in this group, ascending. */
  rows: number[];
  /** Suggested household name, from the rows' own names. */
  displayName: string;
  /** Every distinct name the rows were recorded under (kept as aliases). */
  names: string[];
};

export type Question = {
  id: number;
  /** The two groups asked about (ids of `groups`). */
  a: number;
  b: number;
  evidence: Evidence[];
  note: string;
};

export type MatchResult = {
  groups: Group[];
  questions: Question[];
  /** How many row pairs were linked without asking. */
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

/** Group rows into households. Big files stay fast: only rows sharing a phone, email, address or surname are compared. */
export function matchPayers(input: readonly PayerInput[]): MatchResult {
  const rows = input.map(prepare);
  const n = rows.length;
  const dsu = new Dsu(n);

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
    add(r.parsed.surname && `s:${r.parsed.surname}`, i);
  });

  const seen = new Set<string>();
  const asks: { i: number; j: number; v: PairVerdict }[] = [];
  let autoLinks = 0;
  for (const list of blocks.values()) {
    if (list.length < 2) continue;
    // A very common surname in a big file would compare everyone with everyone; cap the block and rely on the
    // other blocks (phone, email, address) for those rows.
    if (list.length > 400 && list === blocks.get(`s:${rows[list[0]!]!.parsed.surname}`)) continue;
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        const i = list[x]!;
        const j = list[y]!;
        const key = `${i}:${j}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const v = comparePair(rows[i]!, rows[j]!);
        if (v.verdict === "auto") {
          autoLinks++;
          dsu.union(i, j);
        } else if (v.verdict === "ask") asks.push({ i, j, v });
      }
    }
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
  const groups: Group[] = roots.map((root, gi) => {
    groupIdOfRoot.set(root, gi);
    const members = byRoot.get(root)!.map((i) => rows[i]!);
    const names = [...new Set(members.map((m) => m.name.trim()).filter(Boolean))];
    return { id: gi, rows: members.map((m) => m.rowNo).sort((a, b) => a - b), displayName: suggestName(members), names };
  });

  // One question per pair of groups, carrying the strongest evidence seen between them.
  const qmap = new Map<string, Question>();
  for (const { i, j, v } of asks) {
    const ga = groupIdOfRoot.get(dsu.find(i))!;
    const gb = groupIdOfRoot.get(dsu.find(j))!;
    if (ga === gb) continue;
    const a = Math.min(ga, gb);
    const b = Math.max(ga, gb);
    const key = `${a}:${b}`;
    const prev = qmap.get(key);
    if (!prev || v.evidence.length > prev.evidence.length) qmap.set(key, { id: 0, a, b, evidence: v.evidence, note: v.note });
  }
  const questions = [...qmap.values()].sort((x, y) => y.evidence.length - x.evidence.length || x.a - y.a || x.b - y.b).map((q, id) => ({ ...q, id }));
  return { groups, questions, autoLinks };
}

/** Apply the owner's answers (question id -> merge) and return the final groups, re-numbered. */
export function applyDecisions(result: MatchResult, merge: ReadonlySet<number>): Group[] {
  const dsu = new Dsu(result.groups.length);
  for (const q of result.questions) if (merge.has(q.id)) dsu.union(q.a, q.b);
  const byRoot = new Map<number, Group[]>();
  for (const g of result.groups) {
    const r = dsu.find(g.id);
    const l = byRoot.get(r);
    if (l) l.push(g);
    else byRoot.set(r, [g]);
  }
  return [...byRoot.values()]
    .map((gs) => {
      const biggest = [...gs].sort((x, y) => y.rows.length - x.rows.length)[0]!;
      return { id: 0, rows: gs.flatMap((g) => g.rows).sort((a, b) => a - b), displayName: biggest.displayName, names: [...new Set(gs.flatMap((g) => g.names))] };
    })
    .sort((a, b) => a.rows[0]! - b.rows[0]!)
    .map((g, id) => ({ ...g, id }));
}
