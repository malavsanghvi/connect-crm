import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/people-shell";
import { CustomFieldsSection } from "@/components/people-v2/custom/custom-group";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { PersonSlideOver } from "@/components/people-v2/slideover/person-slideover";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { familyChips } from "@/lib/people-v2/family-model";
import { sectionPlan } from "@/lib/people-v2/slideover";

import { PREVIEW_COMMUNITY, familyFixture, type FamilyKey } from "../people-family/fixtures";
import { PREVIEW_TZ, detailFixture, findPerson } from "../people-slideover/fixtures";

import { fieldsFixture, type FieldsState } from "./fixtures";
import { PreviewFields, type Scenario, type Step } from "./preview-client";

export const metadata: Metadata = { title: "Custom fields · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(v: string | undefined, all: readonly T[], fallback: T): T => ((all as readonly string[]).includes(v ?? "") ? (v as T) : fallback);

const STEPS = [
  "none",
  "edit",
  "save",
  "date-error",
  "choice",
  "household-edit",
  "household-save",
  "add",
  "add-suggest",
  "add-choice",
  "add-bad",
  "add-save",
  "add-household",
  "ask-copy",
  "manage",
] as const satisfies readonly Step[];

const DEFAULT_PERSON: Record<FamilyKey, string> = { hassan: "p-samira", adeyemi: "p-tunde", tanaka: "p-misaki", empty: "p-ines" };

/**
 * DEV ONLY. Custom fields on the Family page and in the person slide-over (New look), with invented data for a neutral community and
 * fake writes, drawn without a database or a session so every state can be checked and screenshotted.
 *   ?family=hassan|adeyemi|tanaka|empty   which family (tanaka has names and a field in Japanese; empty has one adult)
 *   ?state=default|empty|view|ask|no-access|error
 *        default: someone who may manage fields (Add a field, Manage); empty: no fields yet; view: without people.manage;
 *        ask: may edit people but not manage fields (Ask an admin); no-access: a role that cannot read custom fields; error: the read failed
 *   ?scenario=ok|conflict|error|access     what the next save answers
 *   ?view=slideover&person=<id>            the person's slide-over open (p-samira, p-layla …)
 *   ?do=<step>                             opens an editor, a sheet or a menu (and types) so a screenshot shows that state
 * Returns notFound() in production.
 */
export default async function PeopleFieldsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const family = pick<FamilyKey>(one(sp.family), ["hassan", "adeyemi", "tanaka", "empty"], "hassan");
  const state = pick<FieldsState>(one(sp.state), ["default", "empty", "view", "ask", "no-access", "error"], "default");
  const scenario = pick<Scenario>(one(sp.scenario), ["ok", "conflict", "error", "access"], "ok");
  const step = pick<Step>(one(sp.do), STEPS, "none");
  const model = familyFixture(family, { canEdit: state !== "view" });
  const custom = fieldsFixture(state, model);
  const slideover = one(sp.view) === "slideover";
  const personId = one(sp.person) ?? DEFAULT_PERSON[family];
  const base = `?family=${family}&state=${state}${scenario !== "ok" ? `&scenario=${scenario}` : ""}`;

  const links: FamilyLinks = {
    people: "/dev/admin-people",
    payment: null,
    addPerson: null,
    manageIds: null,
    more: [],
  };

  const detail = slideover ? detailFixture(family, personId, { access: state === "view" ? "view" : "full", standalone: false }) : null;
  const person = slideover ? findPerson(model, personId) : null;
  const panel =
    detail && person ? (
      <PersonSlideOver
        mode="panel"
        detail={detail}
        plan={sectionPlan({ isChild: person.isChild, givingByPerson: false, givingOn: false, hasHistory: false }).map((s) => ({ ...s, open: s.key === "profile" || s.key === "custom_fields" }))}
        slots={{ customFields: <CustomFieldsSection payload={custom} personId={person.id} firstName={person.firstName} isChild={person.isChild} path="/dev/people-fields" /> }}
        closeHref={`/dev/people-fields${base}`}
        closeLabel={model.name}
        hrefs={{ details: `/dev/people-fields${base}`, move: `/dev/people-fields${base}`, merge: "/dev/people-fields" }}
      />
    ) : null;

  return (
    <PreviewShell community={PREVIEW_COMMUNITY} extraPath="/dev/people-fields">
      <PreviewFields
        model={model}
        chips={familyChips(model, PREVIEW_TZ)}
        links={links}
        custom={custom}
        scenario={scenario}
        step={step}
        who={model.adults[0].name}
        detailsTemplate={`/dev/people-fields${base}&view=slideover&person=__ID__`}
        slots={{ glance: null, tabs: null, after: panel }}
      />
    </PreviewShell>
  );
}
