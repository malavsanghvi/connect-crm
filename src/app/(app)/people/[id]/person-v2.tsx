import { notFound, redirect } from "next/navigation";

import { AuditTab } from "@/app/(app)/households/[id]/audit-tab";
import { PersonGlance } from "@/components/giving-glance/glance-panels";
import { CustomFieldsSection } from "@/components/people-v2/custom/custom-group";
import { ChooseFamilyList } from "@/components/people-v2/slideover/choose-family";
import { PersonSlideOver } from "@/components/people-v2/slideover/person-slideover";
import { PageHeader, QueryError } from "@/components/ui";
import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import { personName } from "@/lib/data/lookups";
import { loadCustomFields } from "@/lib/people-v2/custom-load";
import { todayInTz } from "@/lib/dates";
import { givingShowBy } from "@/lib/giving-glance/levels";
import { prepareGlance } from "@/lib/giving-glance/page";
import { isModuleEnabled } from "@/lib/modules";
import { relationshipLabel } from "@/lib/people";
import { familyHrefFor, homeChoice, householdLine, sectionPlan } from "@/lib/people-v2/slideover";
import { loadPersonDetail } from "@/lib/people-v2/slideover-load";
import type { RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

/**
 * A person's own address (/people/[id]) in the New look. The person lives on the Family page, so this sends you there with their
 * slide-over open (the rest of the address kept). A person in several families is asked which one, with each family's card, never a
 * name alone. A person in none has the slide-over's content here, on the page itself.
 */
export async function PersonPageV2({ session, id, sp }: { session: CrmSession; id: string; sp: RawSearchParams }) {
  const { db, center } = session;
  const retry = `/people/${id}`;
  const links = await db.from("household_members").select("household_id, role, is_primary, left_at").eq("person_id", id).is("left_at", null);
  if (links.error) {
    return (
      <>
        <PageHeader title="Person" />
        <QueryError what="this person's families" error={links.error} retryHref={retry} />
      </>
    );
  }
  const choice = homeChoice(links.data ?? []);
  if (choice.kind === "one") redirect(familyHrefFor(choice.householdId, id, sp));

  if (choice.kind === "many") return <ChooseFamily session={session} personId={id} householdIds={choice.householdIds} links={links.data ?? []} sp={sp} />;

  // In no family: the slide-over's content on the page itself.
  const loaded = await loadPersonDetail(session, { personId: id, family: null });
  if (loaded.status === "error") {
    return (
      <>
        <PageHeader title="Person" />
        <QueryError what="this person" error={loaded.error} retryHref={retry} />
      </>
    );
  }
  if (loaded.status !== "ok") notFound();
  const { detail } = loaded;
  const p = detail.person;
  const givingOn = isModuleEnabled(session, "giving");
  const plan = sectionPlan({ isChild: p.isChild, givingByPerson: givingShowBy(center.rules) === "person", givingOn, hasHistory: true });
  const glance = plan.some((s) => s.key === "giving") ? (
    <PersonGlance session={session} person={{ id: p.id, name: p.name, firstName: p.firstName, adult: !p.isChild }} householdIds={[]} sp={sp} prep={await prepareGlance(session, sp)} />
  ) : null;
  const custom = await loadCustomFields(session, { personIds: [p.id], householdId: null, canEdit: detail.canEdit });
  return (
    <PersonSlideOver
      mode="page"
      detail={detail}
      plan={plan}
      slots={{
        glance,
        history: <AuditTab session={session} householdId={null} personId={p.id} bare />,
        customFields: <CustomFieldsSection payload={custom} personId={p.id} firstName={p.firstName} isChild={p.isChild} path={retry} />,
      }}
      closeHref="/people"
      closeLabel="People"
      hrefs={{ details: retry, move: retry, merge: `/people/merge?person=${p.id}` }}
    />
  );
}

async function ChooseFamily({
  session,
  personId,
  householdIds,
  links,
  sp,
}: {
  session: CrmSession;
  personId: string;
  householdIds: string[];
  links: { household_id: string; role: string; is_primary: boolean }[];
  sp: RawSearchParams;
}) {
  const { db, center } = session;
  const person = await db.from("people").select("id, first_name, last_name, preferred_name").eq("id", personId).eq("center_id", center.id).maybeSingle();
  if (person.error) return <QueryError what="this person" error={person.error} retryHref={`/people/${personId}`} />;
  if (!person.data) notFound();
  const name = personName(person.data);
  const today = todayInTz(center.time_zone);
  let cards: Awaited<ReturnType<typeof adultHouseholdCards>>["cards"] = [];
  let problem: unknown = null;
  try {
    cards = (await adultHouseholdCards(db, householdIds, { today, currency: center.currency, majority: communityMajority(center) })).cards;
  } catch (error) {
    console.error("[people] the household cards for the chooser could not be read:", error);
    problem = error;
  }
  const byId = new Map(cards.map((c) => [c.household_id, c]));
  return (
    <>
      <PageHeader title={name} description={`${name} is in more than one family. Choose the family to open.`} />
      {problem ? <QueryError what="the family details" error={problem} retryHref={`/people/${personId}`} /> : null}
      <ChooseFamilyList
        name={name}
        choices={householdIds.map((hid) => {
          const c = byId.get(hid);
          const link = links.find((l) => l.household_id === hid);
          return {
            id: hid,
            href: familyHrefFor(hid, personId, sp),
            lines: householdLine({
              id: hid,
              name: c?.household_name ?? "Family",
              number: c?.household_number ?? null,
              orgLabel: "",
              orgIds: c?.org_household_id ? [c.org_household_id] : [],
              adults: c?.adults ?? [],
              place: [c?.city, c?.zone].filter(Boolean).join(", ") || null,
            }),
            part: link ? (link.is_primary ? "Primary member" : relationshipLabel(link.role)) : null,
          };
        })}
      />
    </>
  );
}
