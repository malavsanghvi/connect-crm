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
import { customValueFilter, hitKindVisible, nameColumnFilter, personNameFilter, typedWords } from "@/lib/find/pattern";
import { filterFor, rankCandidates } from "@/lib/find/search";
import type { Classified, CustomHit, FamilyCandidate, FindFilter, FindResponse, IdentifierHit, PersonCandidate } from "@/lib/find/types";
import { GLOBAL_SEARCH_MIN_CHARS } from "@/lib/global-search";
import { can, canViewIdentifierKind } from "@/lib/permissions";
import type { AskVocab } from "@/lib/people-v2/ask";
import { loadZones } from "@/lib/people-v2/load";
import { safeFilterText } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

// The find box's lookup for the signed-in person. READ ONLY. Everything is read with the person's own database access (row level
// security decides what exists for them); the two functions that read around it (app.resolve_identifier and the household card)
// check the person's permissions themselves, and finance identifiers (QuickBooks, bank payer names, payment-provider IDs) are
// dropped here unless the person may read finance. Children appear only as "Child · staff only" rows for people who may open
// People, and their names are never put in anything sent to Niva: the box hands Niva only the words the person typed.

const PEOPLE_COLUMNS = "id, first_name, last_name, preferred_name, email, phone_e164, member_number, date_of_birth, is_deceased";
const PEOPLE_LIMIT = 60;
const CUSTOM_LIMIT = 40;
/** The kinds of custom field whose value is text a person types a word of (numbers, dates, money and yes/no are not looked up). */
const CUSTOM_TEXT_TYPES = new Set(["text", "choice", "email", "url"]);

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
type CustomFound = { hits: { entity: "people" | "households"; id: string; hit: CustomHit }[]; people: PersonRow[]; households: HouseholdRow[]; peopleIds: string[]; householdIds: string[] };

const asCustom = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

/**
 * Searchable custom fields (the ones an admin marked "found by the one box"), looked up as the person: the values kept on the record
 * (the ones members may see) are read from the record itself and the staff-only ones from app.custom_staff_values, so row level
 * security decides who can find what, and no policy and no migration is needed. Text-like fields only. A failure is reported once
 * and the rest of the lookup carries on.
 */
async function findCustom(session: CrmSession, search: string, note: (what: string, error: unknown) => void): Promise<CustomFound> {
  const { db, center } = session;
  const out: CustomFound = { hits: [], people: [], households: [], peopleIds: [], householdIds: [] };
  const defs = await db.from("custom_field_definitions").select("entity, key, label, type").eq("center_id", center.id).eq("status", "active").eq("searchable", true).in("entity", ["people", "households"]);
  if (defs.error) {
    note("the custom field list", defs.error);
    return out;
  }
  const usable = (defs.data ?? []).filter((d) => CUSTOM_TEXT_TYPES.has(d.type));
  for (const entity of ["people", "households"] as const) {
    const fields = usable.filter((d) => d.entity === entity);
    const filter = customValueFilter(search, fields.map((d) => d.key));
    if (!filter) continue;
    const labelOf = new Map(fields.map((d) => [d.key, d.label]));
    const own =
      entity === "people"
        ? db.from("people").select(`${PEOPLE_COLUMNS}, custom`).eq("center_id", center.id).is("merged_into_id", null).or(filter).limit(CUSTOM_LIMIT)
        : db.from("households").select("id, display_name, household_number, custom").eq("center_id", center.id).is("merged_into_id", null).or(filter).limit(CUSTOM_LIMIT);
    const staff = db.from("custom_staff_values").select("record_key, custom").eq("center_id", center.id).eq("entity", entity).or(filter).limit(CUSTOM_LIMIT);
    const [a, b] = await Promise.all([own, staff]);
    if (a.error) note(`the ${entity} custom field search`, a.error);
    if (b.error) note("the staff-only custom field search", b.error);
    const collect = (id: string, custom: Record<string, unknown>) => {
      for (const [key, label] of labelOf) {
        const v = custom[key];
        if (typeof v === "string" && v.trim()) out.hits.push({ entity, id, hit: { label, value: v.trim() } });
      }
    };
    for (const r of (a.data ?? []) as unknown as (PersonRow & HouseholdRow & { custom: unknown })[]) {
      (entity === "people" ? out.people : out.households).push(r as never);
      collect(r.id, asCustom(r.custom));
    }
    for (const r of (b.data ?? []) as { record_key: string; custom: unknown }[]) {
      (entity === "people" ? out.peopleIds : out.householdIds).push(r.record_key);
      collect(r.record_key, asCustom(r.custom));
    }
  }
  return out;
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

  const fmt = communityFormat(session.center);
  if (q.kind === "question") return empty(q, { filter: filterFor(typed, vocab, fmt) });
  let search = q;
  let filter: FindFilter | null = null;
  if (q.kind === "filter") {
    filter = filterFor(typed, vocab, fmt);
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
  // Three characters, or two in a script without letters to widen (a Han or Hangul word is already a word at two).
  const wantsCustom = q.kind === "name" && hasLetter && (q.search.length >= 3 || (q.search.length >= 2 && !/[a-z]/i.test(q.search)));

  const [byName, byEmail, byPhone, byMember, hitsRes, familyRes, customFound] = await Promise.all([
    nameFilter ? peopleBase().or(nameFilter).limit(PEOPLE_LIMIT) : null,
    q.kind === "email" && safe ? peopleBase().ilike("email", `%${safe}%`).limit(25) : q.kind === "name" && words.length === 1 && words[0].length >= 3 ? peopleBase().ilike("email", `${safeFilterText(words[0])}%`).limit(10) : null,
    phoneDigits.length >= 4 ? peopleBase().like("phone_e164", `%${phoneDigits}%`).limit(25) : null,
    hasDigit && safe && q.kind !== "email" && /^[^\s()+]+$/.test(q.search) ? peopleBase().ilike("member_number", `${safe}%`).limit(25) : null,
    wantsHits ? db.rpc("resolve_identifier", { p_center: center.id, p_value: q.search }) : null,
    familyFilter ? db.from("households").select("id, display_name, household_number").eq("center_id", center.id).is("merged_into_id", null).or(familyFilter).limit(40) : null,
    wantsCustom ? findCustom(session, q.search, note) : null,
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
  // A custom field's value found a record: the record joins the candidates and carries what matched (never decided here: match.ts scores it).
  const customByPerson = new Map<string, CustomHit[]>();
  const customByFamily = new Map<string, CustomHit[]>();
  for (const p of customFound?.people ?? []) if (!people.has(p.id)) people.set(p.id, p);
  for (const h of customFound?.households ?? []) if (!families.has(h.id)) families.set(h.id, { id: h.id, display_name: h.display_name, household_number: h.household_number });
  for (const c of customFound?.hits ?? []) {
    const into = c.entity === "people" ? customByPerson : customByFamily;
    into.set(c.id, [...(into.get(c.id) ?? []), c.hit]);
  }

  // 2. Identifiers the person may see; their records come in too.
  const hits: RawHit[] = [];
  if (hitsRes?.error) note("the identifier search", hitsRes.error);
  for (const h of (hitsRes?.data ?? []) as RawHit[]) if (hitKindVisible(h.kind, finance)) hits.push(h);
  const extraPeople = [...new Set([...hits.map((h) => h.person_id), ...(customFound?.peopleIds ?? [])].filter((id): id is string => !!id && !people.has(id)))].slice(0, 100);
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
  const hitHouseholds = [...hits.map((h) => h.household_id), ...(customFound?.householdIds ?? [])].filter((id): id is string => !!id);
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
      customHits: customByPerson.get(p.id),
    };
  });
  const familyCandidate = (id: string): FamilyCandidate | null => {
    const h = families.get(id);
    return h ? { id, displayName: h.display_name, householdNumber: h.household_number, hits: familyHits.get(id) ?? [], customHits: customByFamily.get(id) } : null;
  };

  const familyById = new Map<string, FamilyCandidate>();
  for (const id of families.keys()) {
    const f = familyCandidate(id);
    if (f) familyById.set(id, f);
  }
  const { items, more } = rankCandidates(q, rules, candidates, familyById, { canSeeChildren });

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

