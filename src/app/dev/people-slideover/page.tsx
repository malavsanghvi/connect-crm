import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/people-shell";
import { PersonEventsBody } from "@/components/people-v2/events/person-events";
import { AuditTable } from "@/components/audit-table";
import { GivingGlanceView } from "@/components/giving-glance/giving-glance";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { ChooseFamilyList } from "@/components/people-v2/slideover/choose-family";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { composePerson } from "@/lib/giving-glance/compose";
import { familyChips } from "@/lib/people-v2/family-model";
import { NO_ACCESS_TEXT, sectionPlan } from "@/lib/people-v2/slideover";

import { AMARA, FIXTURE_ROWS, PREVIEW_CURRENCY } from "../giving-glance/fixtures";
import { EVENT_STATES, addSetup, personLines, readError, type EventState } from "../people-event-add/fixtures";
import { EVENT_STEPS } from "../people-event-add/script";
import { PREVIEW_COMMUNITY, familyFixture, type FamilyKey } from "../people-family/fixtures";

import { detailFixture, findPerson, historyRows, PREVIEW_TZ, type Access } from "./fixtures";
import { PreviewSlideOver, type Scenario, type Step } from "./preview-client";

export const metadata: Metadata = { title: "Person slide-over · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(v: string | undefined, all: readonly T[], fallback: T): T => ((all as readonly string[]).includes(v ?? "") ? (v as T) : fallback);

const DEFAULT_PERSON: Record<FamilyKey, string> = { hassan: "p-samira", adeyemi: "p-tunde", tanaka: "p-misaki", empty: "p-ines" };

const STEPS = [
  "none",
  "phone-edit",
  "phone-save",
  "name",
  "dob",
  "gender",
  "goes-by",
  "interests-edit",
  "interests-save",
  "interests-remove-old",
  "areas-edit",
  "call-time",
  "daily-goal",
  "switch",
  "ids-add",
  "ids-add-save",
  "ids-retire",
  "ids-retire-save",
  "menu",
  "card-menu",
  "deceased",
  "deceased-save",
  "add-person",
  "add-person-save",
  "add-person-child",
  "add-person-bad",
  "pd-anniversary",
  "pd-anniversary-save",
  "pd-dietary",
  "pd-dietary-save",
  "pd-emergency",
  "pd-emergency-save",
  "pd-emergency-bad",
  "pd-view",
  ...EVENT_STEPS,
] as const satisfies readonly Step[];

/**
 * DEV ONLY. The person slide-over (New look) on the Family page, with invented data for a neutral community and fake writes, drawn
 * without a database or a session so every state can be checked and screenshotted.
 *   ?family=hassan|adeyemi|tanaka|empty   which family (tanaka has names in Japanese and Arabic; empty has one adult and nothing else)
 *   ?person=<id>|none                     whose slide-over is open (p-samira, p-karim, p-layla, p-omar2, p-misaki, p-ines …); none: closed
 *   ?scenario=ok|conflict|error|access    what a write answers
 *   ?access=full|view|limited             full; without people.manage; and a role that cannot read roles, history or finance IDs
 *   ?mode=page                            the person in no family: the same content on the page itself
 *   ?view=choose                          a person in two families: the chooser
 *   ?open=all                             every section open; ?open=events: only the Events section
 *   ?events=ok|slow|already|full|error|noaccess|loaderror|empty|view-only|nofamily|off|noread|readerror   what the Events section and its Add to an event panel answer
 *   ?do=<step>                            opens an editor, a menu or the Add person card (and types) so a screenshot shows that state
 * Returns notFound() in production.
 */
export default async function PeopleSlideOverPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const family = pick<FamilyKey>(one(sp.family), ["hassan", "adeyemi", "tanaka", "empty"], "hassan");
  const scenario = pick<Scenario>(one(sp.scenario), ["ok", "conflict", "error", "access"], "ok");
  const access = pick<Access>(one(sp.access), ["full", "view", "limited"], "full");
  const step = pick<Step>(one(sp.do), STEPS, "none");
  const eventsState = pick<EventState>(one(sp.events), EVENT_STATES, "ok");
  const standalone = one(sp.mode) === "page";
  const asked = one(sp.person);
  const personId = asked === "none" ? null : (asked ?? DEFAULT_PERSON[family]);
  const base = `?family=${family}${access !== "full" ? `&access=${access}` : ""}${scenario !== "ok" ? `&scenario=${scenario}` : ""}${eventsState !== "ok" ? `&events=${eventsState}` : ""}`;
  const model = familyFixture(family, { canEdit: access === "full" });

  if (one(sp.view) === "choose") {
    return (
      <PreviewShell community={PREVIEW_COMMUNITY} extraPath="/dev/people-slideover">
        <h1 className="m-0 font-display text-[34px] font-semibold text-ink">Samira Hassan</h1>
        <p className="m-0 mt-1 text-[14.5px] text-ink-2">Samira Hassan is in more than one family. Choose the family to open.</p>
        <ChooseFamilyList
          name="Samira Hassan"
          choices={[
            { id: "a", href: "/dev/people-slideover?person=p-samira", lines: ["Hassan household", "No. 0301", "RCC-H-1102", "Samira & Karim Hassan", "Riverside, North Riverside"], part: "Primary member" },
            { id: "b", href: "/dev/people-slideover?family=adeyemi", lines: ["Khalil household", "No. 0344", "Nadia Khalil", "Riverside, South Riverside"], part: "Sibling" },
          ]}
        />
      </PreviewShell>
    );
  }

  const links: FamilyLinks = {
    people: "/dev/admin-people",
    payment: model.can.recordPayment ? "/dev/people-slideover" : null,
    addPerson: model.canEdit ? "/dev/people-slideover#add-person" : null,
    manageIds: null,
    more: model.canEdit ? [{ key: "merge", label: "Merge with another family", href: "/dev/people-slideover", hint: "Compare two households and keep one" }] : [],
  };

  const detail = personId ? detailFixture(family, personId, { access, standalone }) : null;
  const person = personId ? findPerson(model, personId) : null;
  const plan = sectionPlan({ isChild: Boolean(person?.isChild), givingByPerson: one(sp.giving) !== "household", givingOn: true, hasHistory: true, hasEvents: eventsState !== "off" }).map((s) => ({
    ...s,
    open: one(sp.open) === "all" ? true : one(sp.open) === "events" ? s.key === "events" : s.open,
  }));

  const glance = person ? (
    <GivingGlanceView
      view={{
        state: "ready",
        model: composePerson({
          today: "2026-10-12",
          startMonth: 1,
          yearParam: undefined,
          path: "/dev/people-slideover",
          keep: {},
          limitedView: false,
          fiscalNote: null,
          truncated: false,
          personRows: {
            pledges: FIXTURE_ROWS.pledges.filter((p) => p.person_id === AMARA),
            payments: FIXTURE_ROWS.payments.filter((p) => p.person_id === AMARA),
            recurring: FIXTURE_ROWS.recurring.filter((r) => r.person_id === AMARA),
          },
          householdRows: FIXTURE_ROWS,
          person: { id: AMARA, name: person.name, firstName: person.firstName },
          householdHref: "/dev/people-slideover",
        }),
        currency: PREVIEW_CURRENCY,
        timeZone: PREVIEW_TZ,
      }}
    />
  ) : null;

  const history =
    access === "limited" ? (
      <p className="m-0 py-1 text-[14px] text-muted">{NO_ACCESS_TEXT}</p>
    ) : (
      <AuditTable rows={historyRows(personId ?? "p", person?.name ?? "")} timeZone={PREVIEW_TZ} actors={new Map([["dev-user", { name: "Grace Mwangi" }]])} />
    );

  const events =
    eventsState === "off" || !person ? undefined : eventsState === "noread" ? (
      <p className="m-0 py-1 text-[14px] text-muted">{NO_ACCESS_TEXT}</p>
    ) : (
      <PersonEventsBody
        firstName={person.firstName}
        list={eventsState === "readerror" ? readError() : personLines(family, person.id)}
        timeZone={PREVIEW_TZ}
        add={addSetup(eventsState, model, person.id, standalone)}
      />
    );

  return (
    <PreviewShell community={PREVIEW_COMMUNITY} extraPath="/dev/people-slideover">
      <PreviewSlideOver
        model={model}
        chips={familyChips(model, PREVIEW_TZ)}
        links={links}
        tabs={
          <section aria-label="Giving, memberships and history">
            <p className="m-0 text-[13.5px] text-muted">(The Family page&apos;s tabs sit here, as on the Family page preview.)</p>
          </section>
        }
        detail={detail}
        plan={plan}
        slots={{ glance, history, events }}
        family={family}
        eventsState={eventsState}
        hrefs={{ details: `/dev/people-slideover${base}&person=${personId ?? ""}`, move: `/dev/people-slideover${base}&person=${personId ?? ""}&mode=move`, merge: "/dev/people-slideover" }}
        closeHref={`/dev/people-slideover${base}&person=none`}
        base={base}
        standalone={standalone}
        scenario={scenario}
        step={step}
      />
    </PreviewShell>
  );
}
