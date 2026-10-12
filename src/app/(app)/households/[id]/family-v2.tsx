import Link from "next/link";
import { notFound } from "next/navigation";

import { PeopleDrawers, drawerHref } from "@/app/(app)/people/_components/drawers";
import { HouseholdGlance } from "@/components/giving-glance/glance-panels";
import { FamilyView } from "@/components/people-v2/family/family-view";
import type { FamilyLinks, HeaderChip } from "@/components/people-v2/family/family-header";
import { NoAccess, PageHeader, QueryError } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { prepareGlance } from "@/lib/giving-glance/page";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { tierLabel } from "@/lib/people";
import { loadFamily } from "@/lib/people-v2/family-load";
import { onAppSummary, type FamilyModel } from "@/lib/people-v2/family-model";
import type { RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import { FamilyTabs } from "./family-tabs";
import { PrimaryPrompt } from "./primary-prompt";

export function familyChips(model: FamilyModel, timeZone: string): HeaderChip[] {
  const chips: HeaderChip[] = [];
  if (model.membership) {
    const m = model.membership;
    chips.push({ key: "membership", tone: "blue", label: `${tierLabel(m.tier)} membership${m.endsOn ? ` · ${formatDate(m.endsOn, timeZone)}` : ""}` });
  }
  if (model.openPledge && model.openPledge.cents > 0) chips.push({ key: "pledges", tone: "sun", label: `Open pledges ${model.openPledge.text}` });
  if (model.adults.length > 0) chips.push({ key: "app", tone: "grey", label: onAppSummary(model.adults).text });
  return chips;
}

/** The Family page in the New look: the household and all its people on one page, edited in place. The classic body stays in page.tsx. */
export async function FamilyPageV2({ session, id, sp }: { session: CrmSession; id: string; sp: RawSearchParams }) {
  const loaded = await loadFamily(session, id);
  if (loaded.status === "not_found") notFound();
  if (loaded.status === "error") {
    return (
      <>
        <PageHeader title="Household" />
        <QueryError what="this household" error={loaded.error} retryHref={`/households/${id}`} />
      </>
    );
  }
  const { model, problems } = loaded;
  const base = `/households/${id}`;
  const givingOn = isModuleEnabled(session, "giving");
  const glance = givingOn ? await prepareGlance(session, sp) : null;
  const canEdit = model.canEdit;

  const links: FamilyLinks = {
    people: "/people",
    payment: model.can.recordPayment ? `/giving/payments?household=${id}` : null,
    addPerson: canEdit ? drawerHref(base, sp, { hh: id, mode: "add" }) : null,
    manageIds: model.can.seesIds ? `${base}?tab=identifiers` : null,
    more: canEdit ? [{ key: "merge", label: "Merge with another family", href: `/people/merge?household=${id}`, hint: "Compare two households and keep one" }] : [],
  };

  return (
    <>
      {model.mergedIntoId ? (
        <p className="mb-4 rounded-xl border border-[var(--v2-sun-from)]/60 bg-[var(--v2-sun-tint)] px-4 py-2.5 text-[14px] text-[var(--v2-sun-ink)]">
          This household was merged into{" "}
          <Link href={`/households/${model.mergedIntoId}`} className="font-bold underline">
            another household
          </Link>
          . Its history is kept here.
        </p>
      ) : null}
      {!canAccess(session, "households") ? (
        <NoAccess area="Household records" access="households" />
      ) : (
        <FamilyView
          model={model}
          chips={familyChips(model, session.center.time_zone)}
          links={links}
          detailsTemplate={drawerHref(base, sp, { person: "__ID__" })}
          problems={problems}
          slots={{
            glance: glance ? <HouseholdGlance session={session} householdId={id} sp={sp} prep={glance} path={base} /> : null,
            tabs: <FamilyTabs session={session} model={model} sp={sp} glance={glance} base={base} />,
            prompt: model.mergedIntoId ? null : <PrimaryPrompt session={session} householdId={id} />,
            after: <PeopleDrawers session={session} sp={sp} base={base} />,
          }}
        />
      )}
    </>
  );
}
