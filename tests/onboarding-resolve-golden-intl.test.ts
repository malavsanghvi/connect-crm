import { describe, expect, it } from "vitest";

import { makeConfig } from "@/lib/onboarding/resolve/config";
import { detectDateOrder } from "@/lib/onboarding/resolve/normalize";
import { resolveRecords, type ResolveResult } from "@/lib/onboarding/resolve/run";

import { buildGoldenIntl } from "./fixtures/onboarding-resolve/golden-intl";
import type { Golden } from "./fixtures/onboarding-resolve/golden";
import { TODAY } from "./fixtures/onboarding-resolve/helpers";

// The multicultural list: Hispanic, Arabic, Chinese, Korean, Japanese, Slavic, Vietnamese, Western and South Asian households in
// one community that is not tied to any tradition. It is the second yardstick next to the Indian-heavy list (golden.ts), with the
// same promises: no wrong automatic join (tier A precision of 99.5% or better), names alone never join, children are held, and
// most rows are resolved without a question. The Indian-heavy list's floor for automatic rows is 80%; this one may be 5 points
// lower (75%) because its households keep more than one family name and its sources share fewer identifiers.

function configFor(g: Golden, country: "US" | "GB") {
  const bySource = new Map<string, unknown[]>();
  for (const r of g.records) {
    const list = bySource.get(r.source) ?? [];
    if (r.dob) list.push(r.dob);
    bySource.set(r.source, list);
  }
  const dateOrderBySource: Record<string, "mdy" | "dmy"> = {};
  for (const [source, values] of bySource) {
    const d = detectDateOrder(values);
    if (d.order !== "unknown") dateOrderBySource[source] = d.order;
  }
  return makeConfig(TODAY, { country, dateOrderBySource });
}

/** Whether a pair the engine called "the same" really is, according to the generator that made the rows. */
function correct(g: Golden, p: ResolveResult["pairs"][number]): boolean {
  const a = g.truth[p.a]!;
  const b = g.truth[p.b]!;
  if (p.relation === "same_person") return a.person === b.person;
  if (p.relation === "same_household") return a.household === b.household;
  return a.gift !== null && a.gift === b.gift;
}

const golden = buildGoldenIntl({ rows: 300, seed: 1 });
const res = resolveRecords({ records: golden.records, config: configFor(golden, "US") });

describe("the multicultural 300-row list", () => {
  it("is 300 rows from three sources, with the mess of every culture in it", () => {
    expect(golden.records).toHaveLength(300);
    expect(Object.keys(golden.counts).sort()).toEqual(["crm-export.csv", "directory.xlsx", "giving-export.csv"]);
    const names = golden.records.map((r) => [r.name, r.firstName, r.lastName].filter(Boolean).join(" ")).join("\n");
    expect(names).toMatch(/[áéíóúñ]/); // Spanish accents
    expect(names).toMatch(/\b\w+ \w+ de la Cruz|de la Cruz Reyes/); // particles and a double surname
    expect(names).toMatch(/Al-Farsi|Al Farsi|Alfarsi/); // Arabic article
    expect(names).toMatch(/Mohammed|Muhammad|Mohamed|Mohammad/);
    expect(names).toMatch(/Nguy[eễ]n/);
    expect(names).toMatch(/\bVan\b|\bThi\b/); // Vietnamese middle names
    expect(names).toMatch(/Zhang|Cheung|Chang|Wang|Wong/);
    expect(names).toMatch(/\bKim\b|\bPark\b/);
    expect(names).toMatch(/Tanaka|Suzuki|Sato/);
    expect(names).toMatch(/Ivanov|Petrov|Smirnov|Ivanoff/);
    expect(names).toMatch(/[ÄÖÜäöüßøłđ]/); // other Latin letters
    expect(names).toMatch(/\bMr\.|\bMs\.|\bDr\.|\bSr\.|\bSra\./); // honorifics
    expect(names).toMatch(/[Ѐ-ӿ]/); // Cyrillic
    expect(names).toMatch(/[一-鿿]/); // Han
    expect(names).toMatch(/[぀-ヿ가-힯]|[؀-ۿ]/); // Hangul or Arabic script
    expect(names).toMatch(/, /); // Last, First
    expect(names).toMatch(/^[A-Z]+ [A-Z]+/m); // capitals
    expect(golden.records.filter((r) => golden.truth[r.id]!.isChild).length).toBeGreaterThanOrEqual(8);
    expect(golden.records.some((r) => !r.email && !r.mobile && !r.phone)).toBe(true); // missing fields
    // Two people with one name, and a phone shared by two households.
    const byName = new Map<string, Set<string>>();
    for (const r of golden.records) byName.set(r.name ?? "", (byName.get(r.name ?? "") ?? new Set()).add(golden.truth[r.id]!.person));
    expect([...byName.entries()].some(([name, people]) => name && people.size > 1)).toBe(true);
    const phones = new Map<string, Set<string>>();
    for (const r of golden.records) for (const v of [r.mobile, r.phone]) if (v) (phones.get(v.replace(/\D/g, "").slice(-10)) ?? phones.set(v.replace(/\D/g, "").slice(-10), new Set()).get(v.replace(/\D/g, "").slice(-10))!).add(golden.truth[r.id]!.household);
    expect([...phones.values()].some((s) => s.size > 1)).toBe(true);
  });

  it("is the same file every time for one seed, and the committed truth file says who is who", async () => {
    const again = buildGoldenIntl({ rows: 300, seed: 1 });
    expect(again.records).toEqual(golden.records);
    expect(again.truth).toEqual(golden.truth);
    // One line per row: the row as the reader hands it over, and who the generator says it is about.
    const lines = golden.records.map((r) => JSON.stringify({ ...r, truth: golden.truth[r.id] }));
    await expect(lines.join("\n") + "\n").toMatchFileSnapshot("./fixtures/onboarding-resolve/golden-intl.seed1.jsonl");
  });

  it("tier A precision is at least 99.5% against the truth", () => {
    const aPairs = res.pairs.filter((p) => p.tier === "A");
    expect(aPairs.length).toBeGreaterThanOrEqual(100);
    const wrong = aPairs.filter((p) => !correct(golden, p));
    const precision = 1 - wrong.length / aPairs.length;
    expect(precision, `wrongly automatic: ${wrong.map((p) => `${p.a} ~ ${p.b} (${p.relation})`).join("; ")}`).toBeGreaterThanOrEqual(0.995);
  });

  it("every automatic cluster is one household (and one person) in the truth", () => {
    for (const c of res.clusters) {
      const households = new Set(c.recordIds.map((id) => golden.truth[id]!.household));
      expect([c.id, households.size]).toEqual([c.id, 1]);
    }
    for (const c of res.personClusters) {
      const persons = new Set(c.recordIds.map((id) => golden.truth[id]!.person));
      expect([c.id, persons.size]).toEqual([c.id, 1]);
    }
  });

  it("resolves at least 75% of the rows automatically (the Indian-heavy floor of 80% less 5 points)", () => {
    expect(res.metrics.autoShare).toBeGreaterThanOrEqual(0.75);
    expect(res.metrics.auto + res.metrics.bulk + res.metrics.asked + res.metrics.held + res.metrics.learned).toBe(300);
    expect(res.groups.length).toBeGreaterThan(0);
    expect(res.groups.length).toBeLessThanOrEqual(10);
  });

  it("never joins on a name alone, whatever the culture", () => {
    for (const p of res.pairs) {
      if (p.nameOnly && p.relation !== "same_gift") {
        expect(["C", "D"], `${p.a} ~ ${p.b}`).toContain(p.tier);
        expect(p.strength).toBe("weak");
      }
      if (p.tier === "A") {
        expect(p.independent, `${p.a} ~ ${p.b}`).toBeGreaterThanOrEqual(2);
        expect(p.evidence.filter((e) => e.independent && e.kind !== "household_name").length, `${p.a} ~ ${p.b}`).toBeGreaterThanOrEqual(1);
        expect(p.conflicts.filter((c) => c.severity === "block")).toEqual([]);
        // The name part of an automatic link is a plain match at most: a weak reading (another word order, another language) never helps it.
        expect(p.nameLevel === "weak" && p.independent < 2).toBe(false);
      }
    }
    // Two people with one common name stay two people.
    for (const c of res.personClusters) expect(new Set(c.recordIds.map((id) => golden.truth[id]!.person)).size).toBe(1);
  });

  it("holds every child, and never decides one", () => {
    const children = golden.records.filter((r) => golden.truth[r.id]!.isChild);
    for (const r of children) expect(res.dispositions.find((x) => x.id === r.id)!.status, `${r.id} ${r.name}`).toBe("held");
    expect(res.pairs.filter((p) => p.tier === "A" && (golden.truth[p.a]!.isChild || golden.truth[p.b]!.isChild))).toEqual([]);
    const linked = new Set(res.clusters.flatMap((c) => c.recordIds));
    for (const r of children) expect(linked.has(r.id)).toBe(false);
  });

  it("a native-script row (Cyrillic, Han, Hangul, Arabic) joins its Latin-script row only through a phone or e-mail it shares", () => {
    const native = golden.records.filter((r) => r.name && /[Ѐ-ӿ一-鿿가-힯؀-ۿ]/.test(r.name));
    expect(native.length).toBeGreaterThanOrEqual(2);
    for (const r of native) {
      const id = r.id;
      for (const p of res.pairs.filter((q) => (q.a === id || q.b === id) && q.tier === "A")) {
        expect(p.evidence.some((e) => e.independent && (e.kind === "phone" || e.kind === "email")), `${p.a} ~ ${p.b}`).toBe(true);
      }
    }
  });
});

describe("other files from the same generator", () => {
  it("are accurate and mostly automatic across seeds, in the United States and in the United Kingdom", () => {
    let share = 0;
    let n = 0;
    for (const country of ["US", "GB"] as const) {
      for (const seed of [2, 3, 4, 5]) {
        const g = buildGoldenIntl({ rows: 300, seed, country });
        const r = resolveRecords({ records: g.records, config: configFor(g, country) });
        const a = r.pairs.filter((p) => p.tier === "A");
        const wrong = a.filter((p) => !correct(g, p));
        expect(1 - wrong.length / a.length, `${country} seed ${seed}: ${wrong.map((p) => `${p.a} ~ ${p.b}`).join("; ")}`).toBeGreaterThanOrEqual(0.995);
        expect(r.metrics.autoShare, `${country} seed ${seed}`).toBeGreaterThanOrEqual(0.7);
        share += r.metrics.autoShare;
        n += 1;
      }
    }
    expect(share / n).toBeGreaterThanOrEqual(0.74);
  });

  it("hold at 1,000 rows: still accurate, still mostly automatic", () => {
    const g = buildGoldenIntl({ rows: 1000, seed: 7 });
    const r = resolveRecords({ records: g.records, config: configFor(g, "US") });
    const a = r.pairs.filter((p) => p.tier === "A");
    expect(a.filter((p) => !correct(g, p))).toEqual([]);
    expect(r.metrics.autoShare).toBeGreaterThanOrEqual(0.72);
    expect(r.groups.length).toBeLessThanOrEqual(12);
  });

  it("a community without a country set is not read as American: its bare numbers are flagged, and nothing is joined on them", () => {
    const noCountry = resolveRecords({ records: golden.records, config: makeConfig(TODAY, { dateOrderBySource: configFor(golden, "US").dateOrderBySource }) });
    const flagged = noCountry.records.filter((r) => r.problems.includes("phone")).length;
    expect(flagged).toBeGreaterThan(20);
    const a = noCountry.pairs.filter((p) => p.tier === "A");
    expect(a.filter((p) => !correct(golden, p))).toEqual([]);
  });
});
