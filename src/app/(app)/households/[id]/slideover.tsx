import Link from "next/link";

import { PersonGlance } from "@/components/giving-glance/glance-panels";
import { PersonSlideOver } from "@/components/people-v2/slideover/person-slideover";
import { SlideOverMessage } from "@/components/people-v2/slideover/message";
import { explainError } from "@/lib/errors";
import { givingShowBy } from "@/lib/giving-glance/levels";
import type { GlancePrep } from "@/lib/giving-glance/page";
import { isModuleEnabled } from "@/lib/modules";
import type { FamilyModel } from "@/lib/people-v2/family-model";
import { sectionPlan, slideOverHref, closeHref as closeUrl } from "@/lib/people-v2/slideover";
import { loadPersonDetail } from "@/lib/people-v2/slideover-load";
import type { RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import { AuditTab } from "./audit-tab";

/**
 * The person slide-over on the Family page (the New look): opened from a person's card or from the address (?person=<id>), so it can
 * be shared. The household and the person come from the page's own model; this reads the deep sections (account, roles, IDs,
 * memberships, what the member gave in the app) and hands the client component the parts that are drawn on the server (Giving at a
 * glance, the history).
 */
export async function PersonSlideOverServer({
  session,
  model,
  sp,
  base,
  personId,
  prep,
}: {
  session: CrmSession;
  model: FamilyModel;
  sp: RawSearchParams;
  base: string;
  personId: string;
  /** The page's own "Giving at a glance" settings (the year), or null when Giving is off. */
  prep: GlancePrep | null;
}) {
  const closeHref = closeUrl(base, sp);
  const loaded = await loadPersonDetail(session, { personId, family: model });
  if (loaded.status === "error") {
    console.error("[slideover] the person could not be read:", loaded.error);
    return (
      <SlideOverMessage title="Could not load this person" closeHref={closeHref}>
        <p role="alert" className="m-0 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13.5px] text-danger">
          Could not load the details: {explainError(loaded.error)}.{" "}
          <Link href={slideOverHref(base, sp, personId)} className="font-bold underline">
            Try again
          </Link>
        </p>
      </SlideOverMessage>
    );
  }
  if (loaded.status !== "ok") {
    return (
      <SlideOverMessage title="Not in this family" closeHref={closeHref}>
        <p className="m-0">
          This person is not in this family any more, or your role cannot see them.{" "}
          <Link href={`/people/${personId}`} className="font-bold text-[var(--v2-blue)] underline">
            Open their own page
          </Link>
          .
        </p>
      </SlideOverMessage>
    );
  }
  const { detail } = loaded;
  const p = detail.person;
  const givingOn = isModuleEnabled(session, "giving");
  const plan = sectionPlan({ isChild: p.isChild, givingByPerson: givingShowBy(session.center.rules) === "person", givingOn, hasHistory: true });
  const glance =
    prep && plan.some((s) => s.key === "giving") ? (
      <PersonGlance session={session} person={{ id: p.id, name: p.name, firstName: p.firstName, adult: !p.isChild }} householdIds={[model.id]} sp={sp} prep={prep} />
    ) : null;

  return (
    <PersonSlideOver
      key={p.id}
      mode="panel"
      detail={detail}
      plan={plan}
      slots={{ glance, history: <AuditTab session={session} householdId={model.id} personId={p.id} bare /> }}
      closeHref={closeHref}
      closeLabel={model.name}
      hrefs={{ details: slideOverHref(base, sp, p.id), move: slideOverHref(base, sp, p.id, "move"), merge: `/people/merge?person=${p.id}` }}
    />
  );
}
