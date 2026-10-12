import Link from "next/link";

import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import { formatDate } from "@/lib/dates";
import { composeHousehold, composePerson, type GlanceModel } from "@/lib/giving-glance/compose";
import { givingShowBy } from "@/lib/giving-glance/levels";
import { loadGlanceRows } from "@/lib/giving-glance/load";
import type { GlancePrep } from "@/lib/giving-glance/page";
import { glanceHref } from "@/lib/giving-glance/period";
import { isModuleEnabled } from "@/lib/modules";
import { can, canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import { GivingGlanceView, type GlanceView } from "./giving-glance";

// The two places the panel appears. Each decides whether to show it at all (the Giving module is off: nothing), reads the rows as
// the signed-in person (security in the database decides what comes back), and hands a view to the drawing component.

const ERROR_WHAT = "the giving figures";

function gate(session: CrmSession): "off" | "none" | "ok" {
  if (!isModuleEnabled(session, "giving")) return "off";
  return canAccess(session, "payments") ? "ok" : "none";
}

const limitedView = (session: CrmSession) => !can(session, ["giving.view", "giving.manage"]);

function readyView(session: CrmSession, model: GlanceModel): GlanceView {
  return { state: "ready", model, currency: session.center.currency, timeZone: session.center.time_zone };
}

export async function HouseholdGlance({
  session,
  householdId,
  sp,
  prep,
  path,
  heading,
  idPrefix,
}: {
  session: CrmSession;
  householdId: string;
  sp: RawSearchParams;
  prep: GlancePrep;
  /** The page's own address, without a query. */
  path: string;
  /** "Household giving" on a person's page. */
  heading?: string;
  idPrefix?: string;
}) {
  const g = gate(session);
  if (g === "off") return null;
  if (g === "none") return <GivingGlanceView view={{ state: "no-access" }} />;
  return <GivingGlanceView view={await householdView(session, householdId, sp, prep, path, heading)} idPrefix={idPrefix} />;
}

/** Reads the household's rows and works the panel out. A failed read is a view of its own (said plainly, with a retry), never an empty panel. */
async function householdView(session: CrmSession, householdId: string, sp: RawSearchParams, prep: GlancePrep, path: string, heading?: string): Promise<GlanceView> {
  const { db, center } = session;
  const keep = { tab: param(sp, "tab") ?? null };
  const retryHref = glanceHref(path, { ...keep, year: prep.yearParam, giving_for: param(sp, "giving_for") });
  const showBy = givingShowBy(center.rules);
  try {
    const loaded = await loadGlanceRows(db, center.id, center.time_zone, { households: [householdId] });
    if (!loaded.ok) return { state: "error", what: ERROR_WHAT, error: loaded.error, retryHref };
    const majority = communityMajority(center);
    // The household's adults: the only people who can be listed or chosen. A child is never named here.
    const { cards, adults } = await adultHouseholdCards(db, [householdId], { today: prep.today, currency: center.currency, majority });
    const list = adults.byHousehold.get(householdId) ?? [];
    const card = cards[0];
    const cardLine = heading
      ? [card?.household_number ? `Household ${card.household_number}` : null, card?.adults.length ? card.adults.join(", ") : null, card?.city, card?.last_gift_on ? `Last gift ${formatDate(card.last_gift_on, center.time_zone)}` : null, card?.open_pledge ? `Open pledges ${card.open_pledge}` : null]
          .filter(Boolean)
          .join(" · ")
      : null;
    const model = composeHousehold({
      rows: loaded.rows,
      adults: list.map((a) => ({ id: a.id, name: a.name })),
      showBy,
      scopeParam: param(sp, "giving_for"),
      yearParam: prep.yearParam,
      today: prep.today,
      startMonth: prep.startMonth,
      path,
      keep,
      limitedView: limitedView(session),
      fiscalNote: prep.fiscalNote,
      truncated: loaded.truncated,
      heading,
      cardLine,
    });
    return readyView(session, model);
  } catch (error) {
    console.error("[giving-glance] could not build the household panel:", error);
    return { state: "error", what: ERROR_WHAT, error, retryHref };
  }
}

export async function PersonGlance({
  session,
  person,
  householdIds,
  sp,
  prep,
}: {
  session: CrmSession;
  person: { id: string; name: string; firstName: string; adult: boolean };
  /** The households the person is in now, the first being the one to link to. */
  householdIds: string[];
  sp: RawSearchParams;
  prep: GlancePrep;
}) {
  const g = gate(session);
  if (g === "off") return null;
  if (g === "none") return <GivingGlanceView view={{ state: "no-access" }} />;
  const path = `/people/${person.id}`;
  if (!person.adult) {
    // Decision D2: nothing about anyone under 18 is shown. Giving is kept with the household.
    return (
      <section aria-labelledby="gg-title" className="cc-card mb-5 px-[18px] py-4" data-testid="giving-glance">
        <h2 id="gg-title" className="cc-card-title">
          Giving at a glance
        </h2>
        <p className="mt-1 text-[13px] text-muted">
          Giving is kept with the household, not with children.{" "}
          {householdIds[0] ? (
            <Link href={`/households/${householdIds[0]}`} className="crm-link font-semibold">
              See the household&apos;s giving
            </Link>
          ) : null}
        </p>
      </section>
    );
  }
  if (givingShowBy(session.center.rules) === "household") {
    if (householdIds.length === 0) {
      return (
        <section aria-labelledby="gg-title" className="cc-card mb-5 px-[18px] py-4" data-testid="giving-glance">
          <h2 id="gg-title" className="cc-card-title">
            Household giving
          </h2>
          <p className="mt-1 text-[13px] text-muted">{person.firstName} is not in a household, and giving is kept by household.</p>
        </section>
      );
    }
    return (
      <>
        {householdIds.slice(0, 3).map((id, i) => (
          <HouseholdGlance key={id} session={session} householdId={id} sp={sp} prep={prep} path={path} heading="Household giving" idPrefix={`gg-${i}`} />
        ))}
      </>
    );
  }
  return <GivingGlanceView view={await personView(session, person, householdIds, prep, path)} />;
}

async function personView(
  session: CrmSession,
  person: { id: string; name: string; firstName: string },
  householdIds: string[],
  prep: GlancePrep,
  path: string,
): Promise<GlanceView> {
  const { db, center } = session;
  const retryHref = glanceHref(path, { year: prep.yearParam });
  try {
    const [mine, household] = await Promise.all([
      loadGlanceRows(db, center.id, center.time_zone, { person: person.id }),
      loadGlanceRows(db, center.id, center.time_zone, { households: householdIds }),
    ]);
    if (!mine.ok) return { state: "error", what: ERROR_WHAT, error: mine.error, retryHref };
    if (!household.ok) return { state: "error", what: ERROR_WHAT, error: household.error, retryHref };
    const model = composePerson({
      personRows: mine.rows,
      householdRows: household.rows,
      person: { id: person.id, name: person.name, firstName: person.firstName },
      householdHref: householdIds[0] ? `/households/${householdIds[0]}` : null,
      yearParam: prep.yearParam,
      today: prep.today,
      startMonth: prep.startMonth,
      path,
      keep: {},
      limitedView: limitedView(session),
      fiscalNote: prep.fiscalNote,
      truncated: mine.truncated || household.truncated,
    });
    return readyView(session, model);
  } catch (error) {
    console.error("[giving-glance] could not build the person panel:", error);
    return { state: "error", what: ERROR_WHAT, error, retryHref };
  }
}
