import "server-only";

import { identifierRules } from "@/lib/center-rules";
import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import type { HouseholdCard } from "@/lib/commands/types";
import { communityFormat } from "@/lib/community-format";
import { chunk } from "@/lib/data/fetch-all";
import { todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { householdIdsNeeded, toFindRows } from "@/lib/find/assemble";
import { isChildRecord } from "@/lib/find/child";
import { classifyInput, readsAsFilter } from "@/lib/find/classify";
import { familyOfAdult, scoreFamily, scorePerson } from "@/lib/find/match";
import { hitKindVisible, nameColumnFilter, personNameFilter, typedWords } from "@/lib/find/pattern";
import { rankMatches } from "@/lib/find/rank";
import type { Classified, FamilyCandidate, FindFilter, FindResponse, IdentifierHit, PersonCandidate } from "@/lib/find/types";
import { GLOBAL_SEARCH_MIN_CHARS } from "@/lib/global-search";
import { can, canViewIdentifierKind } from "@/lib/permissions";
import { tierLabel } from "@/lib/people";
import { chipsFor, paramsFromFilters, type AskVocab } from "@/lib/people-v2/ask";
import { loadZones } from "@/lib/people-v2/load";
import { hrefWith, safeFilterText } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

// The find box's lookup for the signed-in person. READ ONLY. Everything is read with the person's own database access (row level
// security decides what exists for them); the two functions that read around it (app.resolve_identifier and the household card)
// check the person's permissions themselves, and finance identifiers (QuickBooks, bank payer names, payment-provider IDs) are
// dropped here unless the person may read finance. Children appear only as "Child · staff only" rows for people who may open
// People, and their names are never put in anything sent to Niva: the box hands Niva only the words the person typed.

const PEOPLE_COLUMNS = "id, first_name, last_name, preferred_name, email, phone_e164, member_number, date_of_birth, is_deceased";
const PEOPLE_LIMIT = 60;

type PersonRow = {
  id: string;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  email: string | null;
  phone_e164: string | null;
  member_number: string | null;
  date_of_birth: string | null;
  is_deceased: boolean;
};
type HouseholdRow = { id: string; display_name: string | null; household_number: string | null };
type Link = { household_id: string; person_id: string; role: string; is_primary: boolean; joined_at: string | null };
type RawHit = { kind: string; system: string | null; value: string; person_id: string | null; household_id: string | null };

export type FindVocab = AskVocab;

/** The address of "show these as a list" and the chips that say what was understood; null when the rule-based reader found no filter. */
export function filterFor(session: CrmSession, text: string, vocab: AskVocab): FindFilter | null {
  const reading = readsAsFilter(text, vocab);
  if (!reading) return null;
  const ctx = { zones: vocab.zones, fmt: communityFormat(session.center), tierLabel };
  const chips = chipsFor(reading.filters, ctx).map((c) => c.label);
  return { href: hrefWith("/people", {}, { ...paramsFromFilters(reading.filters), said: text.slice(0, 300) }), chips, understood: chips.join(" · ") };
}

const empty = (q: Classified, extra: Partial<FindResponse> = {}): FindResponse => ({ query: q.text, kind: q.kind, rows: [], more: 0, filter: null, problem: null, ...extra });

/** Look up what was typed. Never throws: a part that fails is reported in `problem` and the rest is still shown. */
export async function findRecords(session: CrmSession, raw: string): Promise<FindResponse> {
  const typed = raw.replace(/\s+/g, " ").trim().slice(0, 120);
  if (typed.length < GLOBAL_SEARCH_MIN_CHARS) return empty(classifyInput(typed));

  // The organization's areas let a sentence like "life members in North" be read as a list. Needed for two words or more only.
  const problems: string[] = [];
  let vocab: AskVocab = { zones: [], year: Number(todayInTz(session.center.time_zone).slice(0, 4)) };
  if (typed.includes(" ")) {
    const zones = await loadZones(session);
    if (zones.error) console.error("[find] could not read the areas; a sentence naming an area is read without it:", zones.error);
    else vocab = { zones: zones.zones, year: vocab.year };
  }
  const q = classifyInput(typed, vocab);

  if (q.kind === "question") return empty(q, { filter: filterFor(session, typed, vocab) });
  let search = q;
  let filter: FindFilter | null = null;
  if (q.kind === "filter") {
    filter = filterFor(session, typed, vocab);
    // What is left of the sentence after the filters are read (a name, an ID) is still looked up.
    const leftover = readsAsFilter(typed, vocab)?.filters.q ?? null;
    if (!leftover) return empty(q, { filter });
    search = classifyInput(leftover, vocab);
  }

  try {
    const found = await lookup(session, search, problems);
    return { ...found, query: q.text, kind: q.kind, filter, problem: problems.length ? problems[0] : null };
  } catch (error) {
    console.error("[find] lookup failed:", error);
    return empty(q, { filter, problem: `Could not look up families and people just now — ${explainError(error)} Try again.` });
  }
}

async function lookup(session: CrmSession, q: Classified, problems: string[]): Promise<Pick<FindResponse, "rows" | "more">> {
  const { db, center } = session;
  const rules = identifierRules(center.rules);
  const today = todayInTz(center.time_zone);
  const majority = communityMajority(center);
  const finance = canViewIdentifierKind(session, "accounting");
  const canSeeChildren = can(session, ["people.view", "people.manage"]);
  const safe = safeFilterText(q.search);
  const words = typedWords(q.search);
  const hasLetter = /\p{L}/u.test(q.search);
  const hasDigit = /\d/.test(q.search);
  const note = (what: string, error: unknown) => {
    console.error(`[find] ${what} failed:`, error);
    if (!problems.length) problems.push("Some matches could not be looked up just now, so this list may be missing a few. Try again.");
  };

  // 1. Wide nets, in parallel. Each one fails alone.
  const peopleBase = () => db.from("people").select(PEOPLE_COLUMNS).eq("center_id", center.id).is("merged_into_id", null);
  const nameFilter = hasLetter && (q.kind === "name" || (q.kind === "identifier" && q.shape === "payer")) ? personNameFilter(q.search) : null;
  const familyNameFilter = hasLetter && (q.kind === "name" || (q.kind === "identifier" && q.shape === "payer")) ? nameColumnFilter(q.search, "display_name") : null;
  const numberFilter = hasDigit && safe ? `household_number.ilike.${safe}%` : null;
  const familyFilter = [familyNameFilter, numberFilter].filter(Boolean).join(",");
  const phoneDigits = q.kind === "phone" || (q.kind === "identifier" && q.shape === "number") ? q.digits : "";
  const bareDigits = /^\d+$/.test(q.search);
  const wantsHits = ((q.kind === "name" || q.kind === "identifier") && q.search.length >= 2) || (q.kind === "phone" && bareDigits);

  const [byName, byEmail, byPhone, byMember, hitsRes, familyRes] = await Promise.all([
    nameFilter ? peopleBase().or(nameFilter).limit(PEOPLE_LIMIT) : null,
    q.kind === "email" && safe ? peopleBase().ilike("email", `%${safe}%`).limit(25) : q.kind === "name" && words.length === 1 && words[0].length >= 3 ? peopleBase().ilike("email", `${safeFilterText(words[0])}%`).limit(10) : null,
    phoneDigits.length >= 4 ? peopleBase().like("phone_e164", `%${phoneDigits}%`).limit(25) : null,
    hasDigit && safe && q.kind !== "email" && /^[^\s()+]+$/.test(q.search) ? peopleBase().ilike("member_number", `${safe}%`).limit(25) : null,
    wantsHits ? db.rpc("resolve_identifier", { p_center: center.id, p_value: q.search }) : null,
    familyFilter ? db.from("households").select("id, display_name, household_number").eq("center_id", center.id).is("merged_into_id", null).or(familyFilter).limit(40) : null,
  ]);

  const people = new Map<string, PersonRow>();
  for (const [what, res] of [["the name search", byName], ["the email search", byEmail], ["the phone search", byPhone], ["the member number search", byMember]] as const) {
    if (!res) continue;
    if (res.error) note(what, res.error);
    for (const p of (res.data ?? []) as PersonRow[]) people.set(p.id, p);
  }
  const families = new Map<string, HouseholdRow>();
  if (familyRes?.error) note("the family search", familyRes.error);
  for (const h of (familyRes?.data ?? []) as HouseholdRow[]) families.set(h.id, h);

  // 2. Identifiers the person may see; their records come in too.
  const hits: RawHit[] = [];
  if (hitsRes?.error) note("the identifier search", hitsRes.error);
  for (const h of (hitsRes?.data ?? []) as RawHit[]) if (hitKindVisible(h.kind, finance)) hits.push(h);
  const extraPeople = [...new Set(hits.map((h) => h.person_id).filter((id): id is string => !!id && !people.has(id)))].slice(0, 100);
  for (const part of chunk(extraPeople)) {
    const res = await db.from("people").select(PEOPLE_COLUMNS).in("id", part).eq("center_id", center.id).is("merged_into_id", null);
    if (res.error) note("reading the people the identifiers point to", res.error);
    for (const p of (res.data ?? []) as PersonRow[]) people.set(p.id, p);
  }

  // 3. Each person's family (the primary one, else the one they joined first), and the families themselves.
  const links = new Map<string, Link>();
  for (const part of chunk([...people.keys()])) {
    const res = await db.from("household_members").select("household_id, person_id, role, is_primary, joined_at").in("person_id", part).is("left_at", null);
    if (res.error) note("reading the families of the people found", res.error);
    for (const l of (res.data ?? []) as Link[]) {
      const cur = links.get(l.person_id);
      if (!cur || (l.is_primary && !cur.is_primary) || (!cur.is_primary && (l.joined_at ?? "") < (cur.joined_at ?? ""))) links.set(l.person_id, l);
    }
  }
  const hitHouseholds = hits.map((h) => h.household_id).filter((id): id is string => !!id);
  const needHouseholds = [...new Set([...[...links.values()].map((l) => l.household_id), ...hitHouseholds])].filter((id) => !families.has(id));
  for (const part of chunk(needHouseholds)) {
    const res = await db.from("households").select("id, display_name, household_number").in("id", part).eq("center_id", center.id).is("merged_into_id", null);
    if (res.error) note("reading the families", res.error);
    for (const h of (res.data ?? []) as HouseholdRow[]) families.set(h.id, h);
  }

  // 4. Score and rank (pure), then read the cards of the rows that made the list.
  const hitOf = (h: RawHit): IdentifierHit => ({ kind: h.kind, system: h.system, value: h.value });
  const personHits = new Map<string, IdentifierHit[]>();
  const familyHits = new Map<string, IdentifierHit[]>();
  for (const h of hits) {
    const target = h.person_id ? personHits : familyHits;
    const id = h.person_id ?? h.household_id;
    if (id) target.set(id, [...(target.get(id) ?? []), hitOf(h)]);
  }
  const candidates: PersonCandidate[] = [...people.values()].map((p) => {
    const link = links.get(p.id);
    return {
      id: p.id,
      firstName: p.first_name,
      lastName: p.last_name,
      preferredName: p.preferred_name,
      email: p.email,
      phoneE164: p.phone_e164,
      memberNumber: p.member_number,
      isChild: isChildRecord(p.date_of_birth, link?.role ?? null, today, majority),
      isDeceased: p.is_deceased,
      householdId: link?.household_id ?? null,
      relationship: link ? (link.is_primary ? "primary" : link.role) : null,
      hits: personHits.get(p.id) ?? [],
    };
  });
  const familyCandidate = (id: string): FamilyCandidate | null => {
    const h = families.get(id);
    return h ? { id, displayName: h.display_name, householdNumber: h.household_number, hits: familyHits.get(id) ?? [] } : null;
  };

  const scoredPeople = candidates.filter((c) => canSeeChildren || !c.isChild).flatMap((c) => scorePerson(q, c, rules) ?? []);
  const scoredFamilies = [...families.keys()].flatMap((id) => {
    const f = familyCandidate(id);
    return f ? (scoreFamily(q, f, rules) ?? []) : [];
  });
  for (const p of scoredPeople) {
    const family = p.item.householdId ? familyCandidate(p.item.householdId) : null;
    const derived = family ? familyOfAdult(p, family) : null;
    if (derived) scoredFamilies.push(derived);
  }
  const { items, more } = rankMatches(scoredPeople, scoredFamilies);

  let cards = new Map<string, HouseholdCard>();
  const ids = householdIdsNeeded(items);
  if (ids.length > 0) {
    try {
      const res = await adultHouseholdCards(db, ids, { today, currency: center.currency, majority });
      cards = new Map(res.cards.map((c) => [c.household_id, c]));
    } catch (error) {
      note("reading the household cards", error);
    }
  }
  return { rows: toFindRows(items, cards), more };
}

