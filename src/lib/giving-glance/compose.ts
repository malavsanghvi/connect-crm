// "Giving at a glance": from rows and settings to what the panel draws. Pure (the page reads the rows and passes them in), so the
// household page, the person page, the dev preview and the tests all go through the same code.
//
// Children (decision D2): only the adults the caller lists can be chosen or named. Anything recorded under someone else is part of
// "Not tied to a person". No child's name or id reaches this model.

import { chooserParts, partOf, parseGlanceScope, personAndRest, scopeParam, scopeRows, type GivingShowBy } from "./levels";
import { glanceHref, glanceWindow, parseGlanceYear, yearChoices, glanceYearOf, type GlanceWindow } from "./period";
import { LIMITED_VIEW_NOTE, summarize, type GlanceRows, type GlanceSummary } from "./summary";

/** A chip: the person chooser also shows what that part paid in the period (cents). */
export type GlanceLink = { key: string; label: string; cents?: number; href: string; selected: boolean };

export type GlanceNote = { tone: "info" | "warning"; text: string };

export type GlanceModel = {
  /** "Giving at a glance" or "Household giving". */
  heading: string;
  /** Whose giving this is, in words: "The whole household", "Amara Okafor", "Not tied to a person". */
  whose: string;
  /** The household card in one line (number, adults, city), shown when the heading is "Household giving". */
  cardLine: string | null;
  summary: GlanceSummary;
  yearLinks: GlanceLink[];
  /** Other years that have something in them, for an empty year. */
  yearsWithData: GlanceLink[];
  /** The household page, when the community shows giving by person: everyone, each adult and "Not tied to a person". */
  chooser: { label: string; links: GlanceLink[]; explain: string } | null;
  /** The person page: what is left of the household's giving once this person's is taken out. */
  personRest: { firstName: string; paidCents: number; pledgedCents: number; /** "in 2026" or "over all time". */ period: string; seeHouseholdHref: string } | null;
  /** Things to say next to the figures: a limited view, a year that could not be read, too many records. */
  notes: GlanceNote[];
};

export type GlanceCommon = {
  today: string;
  /** The month the community's year starts in (1 for January). */
  startMonth: number;
  yearParam: string | string[] | undefined;
  /** The page's own address and the parts of it to keep (the tab). */
  path: string;
  keep: Record<string, string | null | undefined>;
  /** The two kinds of seeing: the whole history, or only the payments this person recorded. */
  limitedView: boolean;
  /** Said when the start of the year could not be read and the calendar year was used. */
  fiscalNote: string | null;
  truncated: boolean;
};

function commonNotes(c: GlanceCommon): GlanceNote[] {
  const notes: GlanceNote[] = [];
  if (c.limitedView) notes.push({ tone: "info", text: LIMITED_VIEW_NOTE });
  if (c.fiscalNote) notes.push({ tone: "warning", text: c.fiscalNote });
  if (c.truncated) notes.push({ tone: "warning", text: "There are more records than can be added up here, so these totals may be lower than the real giving." });
  return notes;
}

/** Every day on which something was pledged or paid (for the years offered). */
function datesOf(rows: GlanceRows): string[] {
  return [...rows.pledges.map((p) => p.pledged_on), ...rows.payments.filter((p) => !p.is_opening_balance).map((p) => p.received_on)];
}

function windowFor(c: GlanceCommon): GlanceWindow {
  const current = glanceYearOf(c.today, c.startMonth);
  return glanceWindow(parseGlanceYear(c.yearParam, current), c.today, c.startMonth);
}

function yearLinks(c: GlanceCommon, rows: GlanceRows, w: GlanceWindow, extra: Record<string, string | null | undefined>): { all: GlanceLink[]; withData: GlanceLink[] } {
  const choices = yearChoices(datesOf(rows), c.today, c.startMonth, w.selection);
  const dataDays = new Set<string>();
  for (const d of datesOf(rows)) dataDays.add(String(glanceYearOf(d, c.startMonth)));
  const all = choices.map((y) => ({ key: y.key, label: y.label, href: glanceHref(c.path, { ...c.keep, ...extra, year: y.param }), selected: y.selected }));
  const withData = choices.filter((y) => !y.selected && (y.param === "all" ? dataDays.size > 0 : dataDays.has(y.param))).map((y) => all.find((a) => a.key === y.key)!);
  return { all, withData };
}

export type HouseholdGlanceInput = GlanceCommon & {
  rows: GlanceRows;
  /** The household's adults, in the order to list them. Never a child. */
  adults: { id: string; name: string }[];
  showBy: GivingShowBy;
  scopeParam: string | string[] | undefined;
  /** "Giving at a glance" on the household page, "Household giving" on a person's page. */
  heading?: string;
  cardLine?: string | null;
};

export function composeHousehold(i: HouseholdGlanceInput): GlanceModel {
  const w = windowFor(i);
  const adultIds = new Set(i.adults.map((a) => a.id));
  // The community shows giving by household: the person picker is not offered and an address asking for one person is ignored.
  const scope = i.showBy === "person" ? parseGlanceScope(i.scopeParam, adultIds) : ({ kind: "household" } as const);
  const scoped = scopeRows(i.rows, scope, adultIds);
  const summary = summarize(scoped, w, i.today);
  const sp = scopeParam(scope);
  const years = yearLinks(i, i.rows, w, { giving_for: sp });

  let chooser: GlanceModel["chooser"] = null;
  if (i.showBy === "person" && i.adults.length > 0) {
    const parts = chooserParts(i.rows, i.adults, w);
    chooser = {
      label: "Show giving for",
      links: [
        { key: "everyone", label: "Everyone", cents: parts.everyone.paidCents, href: glanceHref(i.path, { ...i.keep, year: w.param }), selected: scope.kind === "household" },
        ...parts.people.map((p) => ({
          key: p.id,
          label: p.name,
          cents: p.paidCents,
          href: glanceHref(i.path, { ...i.keep, year: w.param, giving_for: p.id }),
          selected: scope.kind === "person" && scope.personId === p.id,
        })),
        { key: "none", label: "Not tied to a person", cents: parts.rest.paidCents, href: glanceHref(i.path, { ...i.keep, year: w.param, giving_for: "none" }), selected: scope.kind === "rest" },
      ],
      explain:
        "Each amount is what was paid in the period shown. \"Not tied to a person\" holds gifts and pledges with no named giver, so the parts add up to everyone.",
    };
  }

  const whose =
    scope.kind === "household" ? "The whole household" : scope.kind === "rest" ? "Not tied to a person" : (i.adults.find((a) => a.id === scope.personId)?.name ?? "One person");
  return {
    heading: i.heading ?? "Giving at a glance",
    whose,
    cardLine: i.cardLine ?? null,
    summary,
    yearLinks: years.all,
    yearsWithData: years.withData,
    chooser,
    personRest: null,
    notes: commonNotes(i),
  };
}

export type PersonGlanceInput = GlanceCommon & {
  /** Everything recorded under this person (pledged by or paid by), wherever the household. */
  personRows: GlanceRows;
  /** Everything of the household(s) the person is in now. */
  householdRows: GlanceRows;
  person: { id: string; name: string; firstName: string };
  /** The first household's page, for "See the household's total". */
  householdHref: string | null;
};

/** The person page when the community shows giving by person. */
export function composePerson(i: PersonGlanceInput): GlanceModel {
  const w = windowFor(i);
  const summary = summarize(i.personRows, w, i.today);
  const years = yearLinks(i, i.personRows, w, {});
  const { rest } = personAndRest(i.householdRows, i.person.id);
  const restPart = partOf(rest, w);
  return {
    heading: "Giving at a glance",
    whose: i.person.name,
    cardLine: null,
    summary,
    yearLinks: years.all,
    yearsWithData: years.withData,
    chooser: null,
    personRest: i.householdHref
      ? { firstName: i.person.firstName, paidCents: restPart.paidCents, pledgedCents: restPart.pledgedCents, period: w.selection.kind === "all" ? "over all time" : `in ${w.label}`, seeHouseholdHref: glanceHref(i.householdHref, { year: w.param }) }
      : null,
    notes: commonNotes(i),
  };
}
