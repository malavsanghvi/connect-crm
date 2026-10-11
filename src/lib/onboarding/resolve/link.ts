// Linking: blocking keys, pair scoring and the EVIDENCE behind every score. Pure and deterministic.
//
// The rule that shapes everything here: A NAME ALONE NEVER JOINS. Names (and a ZIP code) are supporting evidence. Only
// identifiers that are not names count as independent: a phone, an e-mail, a street address, an ID from a system, a birth
// date, a check number. A pair whose only agreement is a name is at most "weak", and a weak pair can only become a question.
// Explicit conflicts (different birth years, different IDs, Jr versus Sr, another unit) lower or block a link.

import { daysBetween } from "@/lib/dates";

import type { ResolveConfig } from "./config";
import type {
  CandidatePair,
  Conflict,
  Evidence,
  GiftMoney,
  Hub,
  NamePart,
  NameLevel,
  NormalizedName,
  NormalizedRecord,
  ParsedAddress,
  ParsedDate,
  Relation,
  Strength,
} from "./types";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** True when two keys differ by at most one insertion, deletion or substitution. */
export function editDistanceAtMost1(a: string, b: string): boolean {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i++;
      j++;
      continue;
    }
    if (++edits > 1) return false;
    if (a.length > b.length) i++;
    else if (b.length > a.length) j++;
    else {
      i++;
      j++;
    }
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function close(a: string, b: string, minLen: number): boolean {
  return a.length >= minLen && b.length >= minLen && editDistanceAtMost1(a, b);
}

export function pairKey(a: string, b: string): string {
  return a < b ? `${a}~${b}` : `${b}~${a}`;
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

export type SurnameAgreement = "exact" | "variant" | "close" | "maiden" | "differ" | "unknown";
export type GivenAgreement = "exact" | "variant" | "close" | "initial" | "differ" | "unknown";

export type NameComparison = {
  level: NameLevel;
  surname: SurnameAgreement;
  given: GivenAgreement;
  middle: "agree" | "differ" | "unknown";
  generation: "same" | "differs" | "one_sided" | "none";
  /** Evidence this name comparison adds (never independent). */
  points: number;
  label: string | null;
};

function surnameAgreement(a: NamePart, b: NamePart, minLen: number): SurnameAgreement {
  if (!a.surnameKey || !b.surnameKey) return "unknown";
  if (a.surname === b.surname) return "exact";
  if (a.surnameKey === b.surnameKey) return "variant";
  if (close(a.surnameKey, b.surnameKey, minLen)) return "close";
  // A maiden name explains the difference: "Patel nee Shah" and "Shah", or "Shah-Patel" and "Patel".
  const aSet = new Set(a.surnameParts);
  if (b.surnameParts.some((p) => aSet.has(p))) return "maiden";
  if (a.maidenKey && b.surnameParts.includes(a.maidenKey)) return "maiden";
  if (b.maidenKey && a.surnameParts.includes(b.maidenKey)) return "maiden";
  return "differ";
}

function givenAgreement(a: NamePart, b: NamePart, minLen: number): GivenAgreement {
  if (a.givenKey && b.givenKey) {
    if (a.given === b.given) return "exact";
    if (a.givenKey === b.givenKey) return "variant";
    if (close(a.givenKey, b.givenKey, minLen)) return "close";
    return "differ";
  }
  if (a.initial && b.initial) return a.initial === b.initial ? "initial" : "differ";
  return "unknown";
}

function middleAgreement(a: NamePart, b: NamePart): "agree" | "differ" | "unknown" {
  if (a.middleKeys.length === 0 || b.middleKeys.length === 0) return "unknown";
  const agree = a.middleKeys.some((x) => b.middleKeys.some((y) => x === y || (x.length === 1 && y[0] === x) || (y.length === 1 && x[0] === y)));
  return agree ? "agree" : "differ";
}

function generationAgreement(a: NamePart, b: NamePart): NameComparison["generation"] {
  if (a.generation && b.generation) return a.generation === b.generation ? "same" : "differs";
  if (a.generation || b.generation) return "one_sided";
  return "none";
}

const LEVEL_RANK: Record<NameLevel, number> = { match: 5, maiden: 4, surname_only: 3, given_only: 2, different: 1, unknown: 0 };

function comparePart(a: NamePart, b: NamePart, cfg: ResolveConfig): NameComparison {
  const minLen = cfg.names.closeMinLength;
  const surname = surnameAgreement(a, b, minLen);
  const given = givenAgreement(a, b, minLen);
  const givenOk = given === "exact" || given === "variant" || given === "close" || given === "initial";
  const surnameOk = surname === "exact" || surname === "variant" || surname === "close";
  const w = cfg.weights;
  let level: NameLevel = "unknown";
  let points = 0;
  let label: string | null = null;
  if (surnameOk && givenOk) {
    level = "match";
    if (surname === "exact" && given === "exact") {
      points = w.nameMatch;
      label = "same name";
    } else if (given === "initial") {
      points = w.nameInitial;
      label = "same initial and family name";
    } else {
      points = w.nameVariant;
      label = "similar name (spelling differs)";
    }
  } else if (surname === "maiden" && givenOk) {
    level = "maiden";
    points = w.nameMaiden;
    label = "same first name; the family name is explained by a maiden name";
  } else if (surnameOk && given === "differ") {
    level = "surname_only";
    points = w.nameSurnameOnly;
    label = "same family name";
  } else if (surname === "differ" && (given === "exact" || given === "variant" || given === "close")) {
    level = "given_only";
  } else if ((surname === "differ" || surname === "maiden") && (given === "differ" || given === "initial")) {
    level = "different";
  } else if (surname === "differ" && given === "unknown") {
    level = "different";
  } else if (given === "differ" && surname === "unknown") {
    level = "different";
  }
  return { level, surname, given, middle: middleAgreement(a, b), generation: generationAgreement(a, b), points, label };
}

const NO_NAME: NameComparison = { level: "unknown", surname: "unknown", given: "unknown", middle: "unknown", generation: "none", points: 0, label: null };

/**
 * Compares two names. A household-style name ("Rahul & Mira Shah") matches when any of its people matches. The best
 * comparison across the people wins.
 */
export function compareNames(a: NormalizedName, b: NormalizedName, cfg: ResolveConfig): NameComparison {
  if (a.missing || b.missing || a.people.length === 0 || b.people.length === 0) return NO_NAME;
  let best: NameComparison | null = null;
  for (const pa of a.people) {
    for (const pb of b.people) {
      const c = comparePart(pa, pb, cfg);
      if (!best || LEVEL_RANK[c.level] > LEVEL_RANK[best.level] || (c.level === best.level && c.points > best.points)) best = c;
    }
  }
  return best ?? NO_NAME;
}

// ---------------------------------------------------------------------------
// Addresses, birth dates, IDs
// ---------------------------------------------------------------------------

export type AddressAgreement = "same" | "same_partial_unit" | "other_unit" | "different" | "unknown";

const unitKey = (u: string | null) => (u ? u.replace(/-/g, "") : null);

export function compareAddresses(a: ParsedAddress | null, b: ParsedAddress | null): AddressAgreement {
  if (!a || !b || !a.streetKey || !b.streetKey) return "unknown";
  if (a.poBox !== b.poBox) return "different";
  let sameStreet = a.streetKey === b.streetKey;
  if (!sameStreet && a.number === b.number && a.street && b.street && a.street.length >= 6 && b.street.length >= 6) {
    sameStreet = editDistanceAtMost1(a.street, b.street);
  }
  if (!sameStreet) return "different";
  if (a.zip5 && b.zip5 && a.zip5 !== b.zip5) return "different";
  if ((!a.zip5 || !b.zip5) && a.city && b.city && a.city !== b.city) return "different";
  if (a.suffix && b.suffix && a.suffix !== b.suffix) return "different";
  if (a.predir && b.predir && a.predir !== b.predir) return "different";
  if (a.postdir && b.postdir && a.postdir !== b.postdir) return "different";
  const ua = unitKey(a.unit);
  const ub = unitKey(b.unit);
  if (ua && ub && ua !== ub) return "other_unit";
  // One address names the apartment and the other does not: probably the same, but a building has many households.
  if (!!ua !== !!ub) return "same_partial_unit";
  return "same";
}

/** The key an address is blocked (and counted for hubs) on: street AND unit, so one apartment complex is not one hub. */
export function addressBlockKey(a: ParsedAddress): string {
  return `ad:${a.streetKey}|${unitKey(a.unit) ?? ""}`;
}

export type DobAgreement = "equal" | "compatible" | "same_year" | "different_year" | "unknown";

export function compareDob(a: ParsedDate | null, b: ParsedDate | null): DobAgreement {
  if (!a || !b || a.alternatives.length === 0 || b.alternatives.length === 0) return "unknown";
  if (a.iso && b.iso) {
    if (a.iso === b.iso) return "equal";
  } else if (a.alternatives.some((x) => b.alternatives.includes(x))) return "compatible";
  if (a.years.some((y) => b.years.includes(y))) return "same_year";
  return "different_year";
}

/** Whether an ID system names a household, a person, or either (a customer account that may be a payer). */
export function idScope(system: string): "household" | "person" | "either" {
  const s = system.toLowerCase();
  if (/household|family|^hh|_hh|home/.test(s)) return "household";
  if (/person|member|individual/.test(s)) return "person";
  return "either";
}

// ---------------------------------------------------------------------------
// Blocking
// ---------------------------------------------------------------------------

/**
 * The keys two records must share to be worth comparing: phone, e-mail, normalised street address, an ID, last name + ZIP,
 * the amount + date (or check number) of a gift, and the full name (which can only ever produce a question).
 */
export function blockingKeys(r: NormalizedRecord, cfg: ResolveConfig): string[] {
  const keys: string[] = [];
  for (const p of r.phones) keys.push(`ph:${p.value}`);
  for (const e of r.emails) keys.push(`em:${e}`);
  if (r.address?.streetKey) keys.push(addressBlockKey(r.address));
  for (const [system, value] of Object.entries(r.ids)) keys.push(`id:${system}:${value}`);
  const zip = r.address?.zip5 ?? null;
  const parts = r.name.people;
  if (zip) {
    for (const p of parts) if (p.surnameKey) keys.push(`ln:${p.surnameKey}|${zip}`);
  }
  if (r.gift) {
    if (r.gift.ref) keys.push(`gr:${r.gift.ref}`);
    if (r.gift.cents !== null) {
      for (const d of r.gift.date.alternatives) {
        for (let k = -cfg.gifts.dateWindowDays; k <= cfg.gifts.dateWindowDays; k++) keys.push(`ga:${r.gift.cents}|${shiftDay(d, k)}`);
      }
    }
  }
  // The full name is a key too, so that a row with nothing but a name can still be put in front of a person as a QUESTION.
  // It can never join: scoring caps a name-only pair at weak.
  for (const p of parts) if (p.surnameKey && p.givenKey) keys.push(`nm:${p.surnameKey}|${p.givenKey}`);
  return [...new Set(keys)];
}

function shiftDay(day: string, delta: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10);
}

export type BlockingResult = {
  pairs: Array<{ i: number; j: number; keys: string[] }>;
  /** Phone, e-mail, address and ID keys shared by too many records to be evidence. */
  hubs: Hub[];
  hubKeys: Set<string>;
  /** Keys with so many records that their pairs were not enumerated. */
  skipped: Hub[];
};

const EVIDENCE_KEY = /^(ph|em|ad|id):/;

/** Candidate pairs by shared blocking key. Two existing records are never paired (merging them is a different job). */
export function candidatePairs(records: readonly NormalizedRecord[], cfg: ResolveConfig): BlockingResult {
  const index = new Map<string, number[]>();
  records.forEach((r, i) => {
    for (const k of blockingKeys(r, cfg)) {
      const list = index.get(k);
      if (list) list.push(i);
      else index.set(k, [i]);
    }
  });
  const hubs: Hub[] = [];
  const hubKeys = new Set<string>();
  const skipped: Hub[] = [];
  const pairs = new Map<string, { i: number; j: number; keys: string[] }>();
  const sortedKeys = [...index.keys()].sort();
  for (const key of sortedKeys) {
    const members = index.get(key)!;
    if (members.length < 2) continue;
    if (EVIDENCE_KEY.test(key) && members.length > cfg.blocking.hubSize) {
      hubs.push({ key, size: members.length });
      hubKeys.add(key);
    }
    if (members.length > cfg.blocking.maxBlockSize) {
      skipped.push({ key, size: members.length });
      continue;
    }
    for (let x = 0; x < members.length; x++) {
      for (let y = x + 1; y < members.length; y++) {
        const i = members[x];
        const j = members[y];
        const ri = records[i];
        const rj = records[j];
        if (ri.sourceKind === "existing" && rj.sourceKind === "existing") continue;
        if (ri.kind === "gift" && rj.kind === "gift" && ri.source === rj.source) continue;
        const id = `${i}:${j}`;
        const cur = pairs.get(id);
        if (cur) cur.keys.push(key);
        else pairs.set(id, { i, j, keys: [key] });
      }
    }
  }
  return { pairs: [...pairs.values()], hubs, hubKeys, skipped };
}

// ---------------------------------------------------------------------------
// Scoring one pair of records
// ---------------------------------------------------------------------------

export type LinkContext = {
  hubKeys: ReadonlySet<string>;
  /**
   * Records whose name appears more than once in the SAME source at the same address or phone: a father and son who share a
   * name, or a duplicate row. Such a name says nothing about who is who, so it can never make a link automatic.
   */
  twins: ReadonlySet<string>;
  /** Street addresses with several apartments or several family names: an address alone says little about a household there. */
  sharedAddresses: ReadonlySet<string>;
};

/** Finds the twin records (see LinkContext) and bundles them with the hub keys. */
export function makeLinkContext(records: readonly NormalizedRecord[], hubKeys: ReadonlySet<string>): LinkContext {
  type Entry = { id: string; given: string | null; initial: string | null };
  const groups = new Map<string, Entry[]>();
  for (const r of records) {
    if (r.kind === "gift" || r.sourceKind === "existing") continue;
    // Anything that puts two rows of one file in one place: an address, a phone, an e-mail, a household ID.
    const where = [
      r.address?.streetKey ? addressBlockKey(r.address) : null,
      ...r.phones.map((p) => `ph:${p.value}`),
      ...r.emails.map((e) => `em:${e}`),
      ...Object.entries(r.ids)
        .filter(([system]) => idScope(system) === "household")
        .map(([system, value]) => `id:${system}:${value}`),
    ].filter((x): x is string => x !== null);
    for (const p of r.name.people) {
      if (!p.surnameKey || !(p.givenKey || p.initial)) continue;
      for (const w of where) {
        const key = `${r.source}|${p.surnameKey}|${w}`;
        const entry: Entry = { id: r.id, given: p.givenKey, initial: p.initial };
        const list = groups.get(key);
        if (list) list.push(entry);
        else groups.set(key, [entry]);
      }
    }
  }
  // The same name twice (or a name and its initial) in one file at one place.
  const twins = new Set<string>();
  for (const list of groups.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        if (a.id === b.id) continue;
        const sameName = a.given && b.given ? a.given === b.given : a.initial !== null && a.initial === b.initial;
        if (sameName) {
          twins.add(a.id);
          twins.add(b.id);
        }
      }
    }
  }
  const byStreet = new Map<string, { units: Set<string>; surnames: Set<string> }>();
  for (const r of records) {
    if (r.kind === "gift" || !r.address?.streetKey) continue;
    const e = byStreet.get(r.address.streetKey) ?? { units: new Set<string>(), surnames: new Set<string>() };
    if (r.address.unit) e.units.add(unitKey(r.address.unit)!);
    for (const p of r.name.people) if (p.surnameKey) e.surnames.add(p.surnameKey);
    byStreet.set(r.address.streetKey, e);
  }
  const sharedAddresses = new Set<string>();
  for (const [street, e] of byStreet) if (e.units.size >= 2 || e.surnames.size >= 3) sharedAddresses.add(street);
  return { hubKeys, twins, sharedAddresses };
}

type Facts = {
  evidence: Evidence[];
  conflicts: Conflict[];
  nm: NameComparison;
  independent: number;
  score: number;
  relation: Relation;
  comparable: number;
  unitOnly: boolean;
  personLevel: boolean;
};

/** Everything known about how two records relate, before it is turned into a strength. */
function identityFacts(a: NormalizedRecord, b: NormalizedRecord, cfg: ResolveConfig, ctx: LinkContext): Facts {
  const w = cfg.weights;
  const evidence: Evidence[] = [];
  const conflicts: Conflict[] = [];
  const nm = compareNames(a.name, b.name, cfg);
  const nameSameish = nm.level === "match" || nm.level === "maiden";
  let comparable = 0;
  // Something that belongs to ONE person (a mobile, an e-mail, a birth date, a person's ID) agrees, as opposed to something the
  // whole household shares (an address, a landline, a family number).
  let personLevel = false;

  // Phone
  // A hub (an office line) says nothing either way, so it is not a thing both records "have to compare".
  const livePhone = (r: NormalizedRecord) => r.phones.some((p) => !ctx.hubKeys.has(`ph:${p.value}`));
  const liveEmail = (r: NormalizedRecord) => r.emails.some((e) => !ctx.hubKeys.has(`em:${e}`));
  if (livePhone(a) && livePhone(b)) comparable++;
  const phoneHit = a.phones.find((p) => b.phones.some((q) => q.value === p.value) && !ctx.hubKeys.has(`ph:${p.value}`));
  if (phoneHit) {
    const other = b.phones.find((q) => q.value === phoneHit.value);
    const mobile = phoneHit.mobile && !!other?.mobile;
    if (mobile) personLevel = true;
    evidence.push({ kind: "phone", independent: true, points: w.phone, label: mobile ? "same mobile" : "same phone number", personal: mobile });
  }

  // E-mail
  if (liveEmail(a) && liveEmail(b)) comparable++;
  const emailHit = a.emails.find((e) => b.emails.includes(e) && !ctx.hubKeys.has(`em:${e}`));
  if (emailHit) personLevel = true;
  if (emailHit) evidence.push({ kind: "email", independent: true, points: w.email, label: "e-mail matches", personal: true });

  // Address
  const ac = compareAddresses(a.address, b.address);
  const sameStreet = ac === "same" || ac === "same_partial_unit";
  const addressHub = sameStreet && (ctx.hubKeys.has(addressBlockKey(a.address!)) || ctx.hubKeys.has(addressBlockKey(b.address!)));
  if (ac !== "unknown" && !addressHub) comparable++;
  let unitOnly = false;
  if (sameStreet && !addressHub) {
    evidence.push({ kind: "address", independent: true, points: w.address, label: "same address" });
    if (
      cfg.tier.familyNameAtAddress &&
      (nm.surname === "exact" || nm.surname === "variant") &&
      nm.level === "surname_only" &&
      !ctx.sharedAddresses.has(a.address!.streetKey)
    ) {
      evidence.push({ kind: "household_name", independent: true, points: w.familyAtAddress, label: "same family name at the same address" });
    }
    if (ac === "same_partial_unit") {
      conflicts.push({ kind: "unit_missing", severity: "lower", label: "one address names the apartment and the other does not" });
    }
  } else if (ac === "other_unit") {
    unitOnly = true;
    evidence.push({ kind: "address", independent: false, points: 0, label: "same address, different unit" });
    conflicts.push({ kind: "unit", severity: "lower", label: "a different unit at the same address" });
  }

  // IDs
  let idMatched = false;
  let idPersonal = false;
  // An ID counts twice when it is the system's own key (both records come from systems that assigned it) or when it names a
  // household ("the file says so": a family ID puts the rows in one household).
  let idTrusted = false;
  for (const [system, value] of Object.entries(a.ids)) {
    const other = b.ids[system];
    if (other === undefined) continue;
    comparable++;
    if (other === value) {
      if (!ctx.hubKeys.has(`id:${system}:${value}`)) {
        idMatched = true;
        if (idScope(system) !== "household") {
          personLevel = true;
          idPersonal = true;
        }
        const systemKey = (a.sourceKind === "connector" || a.sourceKind === "existing") && (b.sourceKind === "connector" || b.sourceKind === "existing");
        if (systemKey || idScope(system) === "household") idTrusted = true;
      }
    } else {
      const scope = idScope(system);
      const applies = scope === "household" || nameSameish;
      if (applies) conflicts.push({ kind: "id", severity: "block", label: `different ${system} IDs` });
    }
  }
  if (idMatched) evidence.push({ kind: "id", independent: true, points: w.id, label: "ID matches", personal: idPersonal });

  // Birth date
  const dobAgree = compareDob(a.dob, b.dob);
  if (dobAgree !== "unknown") comparable++;
  if (dobAgree === "equal") personLevel = true;
  if (dobAgree === "equal") evidence.push({ kind: "dob", independent: true, points: w.dob, label: "same birth date", personal: true });
  else if (dobAgree === "same_year") conflicts.push({ kind: "birth_date", severity: "lower", label: "birth dates differ within the same year" });
  else if (dobAgree === "different_year") conflicts.push({ kind: "birth_year", severity: "block", label: "different birth years" });

  // Jr / Sr
  if (nameSameish) {
    if (nm.generation === "differs") conflicts.push({ kind: "generation", severity: "block", label: "one is Jr and the other Sr" });
    else if (nm.generation === "one_sided") conflicts.push({ kind: "one_sided_generation", severity: "lower", label: "only one of them is marked Jr or Sr" });
    if (ctx.twins.has(a.id) || ctx.twins.has(b.id)) {
      conflicts.push({ kind: "ambiguous_name", severity: "lower", label: "the same name appears twice at this address in one file (a father and son, or a repeated row)" });
    }
    if (nm.middle === "differ" && nm.level === "match") conflicts.push({ kind: "middle_name", severity: "lower", label: "different middle names" });
  }

  // Name and ZIP: supporting evidence only
  if (nm.points > 0 && nm.label) evidence.push({ kind: "name", independent: false, points: nm.points, label: nm.label });
  const surnameAgrees = nm.surname === "exact" || nm.surname === "variant" || nm.surname === "close";
  if (surnameAgrees && a.address?.zip5 && a.address.zip5 === b.address?.zip5) {
    evidence.push({ kind: "surname_zip", independent: false, points: w.surnameZip, label: "same family name and ZIP code" });
  }

  let independent = evidence.filter((e) => e.independent).length;
  if (idMatched && idTrusted) independent += 1;
  const lowers = conflicts.filter((c) => c.severity === "lower").length;
  const raw = evidence.reduce((n, e) => n + e.points, 0) + (idMatched && idTrusted ? w.id : 0) - lowers * w.lowerConflict;
  const score = Math.max(0, Math.min(100, raw));

  const bothPeople = a.kind !== "household" && b.kind !== "household";
  // Two members of one household share its address, landline and family number, so with only an initial to go on those say
  // "same household", not "same person".
  const initialOnly = nm.given === "initial";
  const relation: Relation = bothPeople && nameSameish && (!initialOnly || personLevel) ? "same_person" : "same_household";
  return { evidence, conflicts, nm, independent, score, relation, comparable, unitOnly, personLevel };
}

/** Whether anything contradicts calling two records the same (used to keep a chain of links honest). */
export function hasBlockConflict(a: NormalizedRecord, b: NormalizedRecord, cfg: ResolveConfig, ctx: LinkContext): boolean {
  return identityFacts(a, b, cfg, ctx).conflicts.some((c) => c.severity === "block");
}

/**
 * What two records agree on, for pooling evidence across the rows of one person: the independent kinds that agree, whether
 * anything contradicts them, and any lower conflict (a Jr, a repeated name) that should stop pooling.
 */
export function evidenceBetween(
  a: NormalizedRecord,
  b: NormalizedRecord,
  cfg: ResolveConfig,
  ctx: LinkContext,
): { evidence: Evidence[]; blocked: boolean; lowerConflicts: number } {
  const f = identityFacts(a, b, cfg, ctx);
  return {
    // A family name at an address is about a household, never about one person.
    evidence: f.evidence.filter((e) => e.independent && e.kind !== "household_name"),
    blocked: f.conflicts.some((c) => c.severity === "block"),
    lowerConflicts: f.conflicts.filter((c) => c.severity === "lower").length,
  };
}

function demote(s: Strength, steps: number): Strength {
  const order: Strength[] = ["strong", "medium", "weak"];
  return order[Math.min(order.length - 1, order.indexOf(s) + steps)];
}

/**
 * Scores a pair of non-gift records (or a gift against a person: the gift's donor fields are compared). Returns null when
 * the pair is not worth a person's time. A pair whose only agreement is a name is at most weak.
 */
export function scoreIdentity(a: NormalizedRecord, b: NormalizedRecord, viaKeys: string[], cfg: ResolveConfig, ctx: LinkContext): CandidatePair | null {
  const f = identityFacts(a, b, cfg, ctx);
  const { nm, independent } = f;
  const blocked = f.conflicts.some((c) => c.severity === "block");
  const lowers = f.conflicts.filter((c) => c.severity === "lower").length;
  const nameSupport = nm.level === "match" || nm.level === "maiden" || nm.level === "surname_only";
  const nameSameish = nm.level === "match" || nm.level === "maiden";

  let strength: Strength | null;
  if (blocked) {
    strength = independent >= 2 ? "weak" : null;
  } else if (independent >= cfg.tier.autoMinIdentifiers && f.score >= cfg.tier.autoMinScore) {
    strength = "strong";
  } else if (independent >= cfg.tier.bulkMinIdentifiers && nameSupport) {
    strength = "medium";
  } else if (independent >= 1) {
    strength = "weak";
  } else if (f.unitOnly && (nameSameish || nm.level === "surname_only")) {
    strength = "weak";
  } else if (nameSameish) {
    // Name alone. If both records have identifiers to compare and none agrees, they are different people with the same name.
    strength = f.comparable > 0 ? null : "weak";
  } else {
    strength = null;
  }
  if (strength === null) return null;
  if (!blocked) strength = demote(strength, lowers);
  // "The same person" needs something that belongs to one person. An address, a landline and a family number are shared by
  // relatives, and a father and son can have one name.
  if (strength === "strong" && f.relation === "same_person" && !f.personLevel) strength = "medium";
  if (strength === "weak" && f.score < cfg.tier.askMinScore && !f.unitOnly) return null;

  return {
    a: a.id,
    b: b.id,
    relation: f.relation,
    strength,
    score: f.score,
    independent,
    evidence: f.evidence,
    conflicts: f.conflicts,
    nameLevel: nm.level,
    nameOnly: independent === 0,
    viaKeys,
    money: null,
  };
}

// ---------------------------------------------------------------------------
// Gifts: the same gift seen by two sources
// ---------------------------------------------------------------------------

function dayGap(a: ParsedDate, b: ParsedDate): { min: number; max: number } | null {
  if (a.alternatives.length === 0 || b.alternatives.length === 0) return null;
  let min = Infinity;
  let max = 0;
  for (const x of a.alternatives) {
    for (const y of b.alternatives) {
      const g = Math.abs(daysBetween(x, y));
      if (g < min) min = g;
      if (g > max) max = g;
    }
  }
  return { min, max };
}

/**
 * Scores two gift records from DIFFERENT sources. The same amount within a few days from the same donor is one gift seen
 * twice (load once). Different amounts for what looks like one gift are a money conflict (held by tier D); a different check
 * number means a different gift. Returns null for gifts that are simply different.
 */
export function scoreGiftPair(a: NormalizedRecord, b: NormalizedRecord, viaKeys: string[], cfg: ResolveConfig, ctx: LinkContext): CandidatePair | null {
  const ga = a.gift;
  const gb = b.gift;
  if (!ga || !gb || a.source === b.source) return null;
  if (ga.cents === null || gb.cents === null) return null;
  const refBoth = !!ga.ref && !!gb.ref;
  const refEq = refBoth && ga.ref === gb.ref;
  if (refBoth && !refEq) return null;
  const gap = dayGap(ga.date, gb.date);
  if (!gap) return null;
  const inWindow = gap.min <= cfg.gifts.dateWindowDays;
  const dateUncertain = inWindow && gap.max > cfg.gifts.dateWindowDays;
  if (!inWindow && !refEq) return null;

  const f = identityFacts(a, b, cfg, ctx);
  if (f.conflicts.some((c) => c.severity === "block")) return null;
  const nameNotDifferent = f.nm.level === "match" || f.nm.level === "maiden" || f.nm.level === "unknown" || f.nm.level === "surname_only";
  const nameSupport = f.nm.level === "match" || f.nm.level === "maiden";
  const d = f.independent;
  const evidence: Evidence[] = [...f.evidence];
  const diff = Math.abs(ga.cents - gb.cents);
  const equal = diff === 0;

  if (!equal) {
    // A different amount for what is plainly the same gift: a money conflict.
    // The same donor, within days, off by a few cents: one gift written down two ways, not two gifts.
    const offByCents = (d >= 2 || (d >= 1 && nameSupport)) && diff <= cfg.gifts.centsTolerance;
    if (!(refEq && nameNotDifferent) && !offByCents) return null;
    const money: GiftMoney = { kind: diff <= cfg.gifts.centsTolerance ? "amount_differs_cents" : "amount_differs", aCents: ga.cents, bCents: gb.cents };
    if (refEq) evidence.push({ kind: "gift_ref", independent: true, points: cfg.weights.giftRef, label: "same check or transaction number" });
    evidence.push({ kind: "gift_date", independent: false, points: 0, label: gap.min === 0 ? "same date" : "dates a few days apart" });
    return {
      a: a.id,
      b: b.id,
      relation: "same_gift",
      strength: "medium",
      score: Math.min(100, f.score + (refEq ? cfg.weights.giftRef : 0)),
      independent: d + (refEq ? 1 : 0),
      evidence,
      conflicts: f.conflicts,
      nameLevel: f.nm.level,
      nameOnly: false,
      viaKeys,
      money,
    };
  }

  // The same amount on (nearly) the same date is one identifier of its own, independent of who the donor is.
  evidence.push({ kind: "gift_amount", independent: true, points: cfg.weights.giftAmount, label: "same amount" });
  evidence.push({ kind: "gift_date", independent: false, points: 0, label: gap.min === 0 ? "same date" : "dates a few days apart" });
  if (refEq) evidence.push({ kind: "gift_ref", independent: true, points: cfg.weights.giftRef, label: "same check or transaction number" });
  const independent = d + 1 + (refEq ? 1 : 0);
  const score = Math.min(100, f.score + (refEq ? cfg.weights.giftRef : 0) + cfg.weights.giftAmount);

  // Automatic: the donor agrees by an identifier (or a check number) as well as the amount and date, and the donor's name
  // supports it (or, with a check number or two donor identifiers, does not contradict it).
  let strength: Strength | null;
  if (dateUncertain) strength = nameSupport || d > 0 ? "weak" : null;
  else if (!nameNotDifferent) strength = null;
  // A gift is one person's act: an address shared by relatives (or by a father and son with one name) cannot confirm it.
  else if (refEq || (f.personLevel && (d >= cfg.tier.autoMinIdentifiers || (d >= 1 && nameSupport)))) strength = "strong";
  else if (d >= 1) strength = "medium";
  else if (nameSupport) strength = "weak";
  else strength = null;
  if (strength === null) return null;
  strength = demote(strength, f.conflicts.filter((c) => c.severity === "lower").length);

  return {
    a: a.id,
    b: b.id,
    relation: "same_gift",
    strength,
    score,
    independent,
    evidence,
    conflicts: f.conflicts,
    nameLevel: f.nm.level,
    nameOnly: d === 0 && !refEq,
    viaKeys,
    money: null,
  };
}

/** Scores every candidate pair: identity for people and households, the gift path for two gifts. */
export function scoreCandidates(records: readonly NormalizedRecord[], blocking: BlockingResult, cfg: ResolveConfig): CandidatePair[] {
  const ctx = makeLinkContext(records, blocking.hubKeys);
  const out: CandidatePair[] = [];
  for (const { i, j, keys } of blocking.pairs) {
    const a = records[i];
    const b = records[j];
    const scored = a.kind === "gift" && b.kind === "gift" ? scoreGiftPair(a, b, keys, cfg, ctx) : scoreIdentity(a, b, keys, cfg, ctx);
    if (scored) out.push(scored);
  }
  // Fixed order: strongest first, then by ids, so the same input gives the same output.
  return out.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a) || x.b.localeCompare(y.b));
}
