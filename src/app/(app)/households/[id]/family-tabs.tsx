import Link from "next/link";

import { glanceHref } from "@/lib/giving-glance/period";
import { tabPeriod, type GlancePrep } from "@/lib/giving-glance/page";
import { familyTabs, pickFamilyTab, type FamilyModel } from "@/lib/people-v2/family-model";
import { isModuleEnabled } from "@/lib/modules";
import { isUuid, param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import { AuditTab } from "./audit-tab";
import { EventsTab } from "./events-tab";
import { IdentifiersTab } from "./identifiers-tab";
import { MembershipsTab } from "./memberships-tab";
import { PaymentsTab } from "./payments-tab";
import { PledgesTab } from "./pledges-tab";

/**
 * The one tab row under the Family page: Giving (pledges and payments, following the year chosen in "Giving at a glance"),
 * Memberships, Events (only with the Events module: RSVPs and who came) and History (the household and every person in it, with a filter by person). The old Members and Identifiers tabs
 * are gone: the people are on the page and the IDs are a section of it. `?tab=pledges|payments|audit` from older links still open
 * Giving and History.
 */
export async function FamilyTabs({
  session,
  model,
  sp,
  glance,
  base,
}: {
  session: CrmSession;
  model: FamilyModel;
  sp: RawSearchParams;
  glance: GlancePrep | null;
  base: string;
}) {
  const id = model.id;
  const givingOn = isModuleEnabled(session, "giving");
  const asked = param(sp, "tab");
  const tabs = familyTabs({ giving: givingOn, events: isModuleEnabled(session, "events"), history: true });
  const legacyIds = asked === "identifiers";
  const active = pickFamilyTab(asked, tabs);
  const keepYear = glance?.explicitYear ? glance.yearParam : undefined;
  const givingFor = param(sp, "giving_for") ?? null;
  const hp = param(sp, "hp");
  const person = isUuid(hp) ? hp : undefined;
  const href = (tab: string, extra: Record<string, string | undefined> = {}) => glanceHref(base, { tab, year: keepYear, giving_for: givingFor, ...extra });
  const period = (tab: string) => (glance ? tabPeriod(glance, glanceHref(base, { tab, year: "all", giving_for: givingFor })) : undefined);
  const everyone = [...model.adults, ...model.children];

  return (
    <section aria-label="Giving, memberships and history">
      <nav aria-label="More about this family" className="mb-3.5 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t) => (
          <Link
            key={t.key}
            href={href(t.key)}
            scroll={false}
            aria-current={!legacyIds && t.key === active ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-[3px] px-4 text-[14.5px] font-bold no-underline ${
              !legacyIds && t.key === active ? "border-[var(--v2-blue)] text-[var(--v2-blue)]" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {legacyIds ? <IdentifiersTab session={session} householdId={id} household={{ display_name: model.name, household_number: model.number }} /> : null}
      {!legacyIds && active === "giving" ? (
        <div className="flex flex-col gap-4">
          <PledgesTab session={session} householdId={id} period={period("giving")} />
          <PaymentsTab session={session} householdId={id} period={period("giving")} />
        </div>
      ) : null}
      {!legacyIds && active === "memberships" ? <MembershipsTab session={session} householdId={id} /> : null}
      {!legacyIds && active === "events" ? <EventsTab session={session} householdId={id} /> : null}
      {!legacyIds && active === "history" ? (
        <div>
          <nav aria-label="History of" className="mb-3 flex flex-wrap items-center gap-1.5">
            <span className="mr-1 text-[13px] font-bold text-muted">Show</span>
            <Link href={href("history")} scroll={false} aria-current={!person ? "page" : undefined} className="cc-chip">
              The household and everyone
            </Link>
            {everyone.map((p) => (
              <Link key={p.id} href={href("history", { hp: p.id })} scroll={false} aria-current={person === p.id ? "page" : undefined} className="cc-chip">
                {p.firstName}
              </Link>
            ))}
          </nav>
          <AuditTab session={session} householdId={id} personId={person} />
        </div>
      ) : null}
    </section>
  );
}
