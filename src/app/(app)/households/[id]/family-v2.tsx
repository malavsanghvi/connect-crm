import Link from "next/link";
import { notFound } from "next/navigation";

import { PeopleDrawers } from "@/app/(app)/people/_components/drawers";
import { CareCard } from "@/components/care/care-card";
import { HouseholdGlance } from "@/components/giving-glance/glance-panels";
import { FamilyView } from "@/components/people-v2/family/family-view";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { PageHeader, QueryError } from "@/components/ui";
import { loadCareCard, seesCare } from "@/lib/data/care";
import { prepareGlance } from "@/lib/giving-glance/page";
import { isModuleEnabled } from "@/lib/modules";
import { loadCustomFields } from "@/lib/people-v2/custom-load";
import { loadFamily } from "@/lib/people-v2/family-load";
import { familyChips } from "@/lib/people-v2/family-model";
import { loadPinState } from "@/lib/people-v2/saved-load";
import { slideOverHref, slideOverRequest } from "@/lib/people-v2/slideover";
import type { RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import { FamilyTabs } from "./family-tabs";
import { PrimaryPrompt } from "./primary-prompt";
import { PersonSlideOverServer } from "./slideover";

/**
 * The Family page in the New look: the household and all its people on one page, edited in place. The classic body stays in page.tsx.
 * `?person=<id>` opens that person's slide-over (so it can be shared); the classic drawers stay for the household's own old links
 * (?hh=…) and for the move flow (?person=<id>&mode=move), which still uses the classic drawer.
 */
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
  // The Care card (DonorDelight slice 2) only for someone with a care role, and never on a merged household; the database decides
  // what it holds (no platform-admin branch) and logs the read.
  const [glance, custom, care] = await Promise.all([
    givingOn ? prepareGlance(session, sp) : null,
    loadCustomFields(session, { personIds: [...model.adults, ...model.children].map((p) => p.id), householdId: id, canEdit: model.canEdit }),
    seesCare(session) && !model.mergedIntoId ? loadCareCard(session, id) : null,
  ]);
  const canEdit = model.canEdit;
  // The star: whether this person pinned the family (their own pin, read under their own session). A merged family cannot be pinned.
  const pinState = model.mergedIntoId ? null : await loadPinState(session, id);
  const request = slideOverRequest(sp);

  const links: FamilyLinks = {
    people: "/people",
    payment: model.can.recordPayment ? `/giving/payments?household=${id}` : null,
    // "+ Add person" opens the inline card on this page; the address is only what a link without scripts follows.
    addPerson: canEdit ? `${base}#add-person` : null,
    manageIds: model.can.seesIds ? `${base}?tab=identifiers` : null,
    more: canEdit
      ? [{ key: "merge", label: "Merge with another family", href: `/people/merge?household=${id}`, hint: "Compare two households and keep one" }]
      : [],
    pin: pinState ? { householdId: id, pinned: pinState.pinned, loadError: pinState.error } : undefined,
  };

  return (
    <>
      {model.mergedIntoId ? (
        <p className="mb-4 rounded-xl border border-warning-200 bg-warning-50 px-4 py-2.5 text-[14px] text-warning-ink">
          This household was merged into{" "}
          <Link href={`/households/${model.mergedIntoId}`} className="font-bold underline">
            another household
          </Link>
          . Its history is kept here.
        </p>
      ) : null}
      <FamilyView
        model={model}
        chips={familyChips(model, session.center.time_zone)}
        links={links}
        detailsTemplate={slideOverHref(base, sp, "__ID__")}
        moveTemplate={slideOverHref(base, sp, "__ID__", "move")}
        problems={problems}
        custom={custom}
        slots={{
          glance: glance ? <HouseholdGlance session={session} householdId={id} sp={sp} prep={glance} path={base} /> : null,
          tabs: <FamilyTabs session={session} model={model} sp={sp} glance={glance} base={base} />,
          prompt: model.mergedIntoId ? null : <PrimaryPrompt session={session} householdId={id} />,
          care: care ? <CareCard load={care} householdId={id} timeZone={session.center.time_zone} retryHref={base} /> : null,
          after:
            request.kind === "slideover" ? (
              <PersonSlideOverServer session={session} model={model} sp={sp} base={base} personId={request.personId} prep={glance} custom={custom} />
            ) : (
              <PeopleDrawers session={session} sp={sp} base={base} />
            ),
        }}
      />
    </>
  );
}
