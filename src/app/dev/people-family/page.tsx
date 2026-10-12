import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/people-shell";
import { GivingGlanceView } from "@/components/giving-glance/giving-glance";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { composeHousehold } from "@/lib/giving-glance/compose";
import { familyChips } from "@/lib/people-v2/family-model";

import { ADULTS as GLANCE_ADULTS, FIXTURE_ROWS, PREVIEW_CURRENCY, PREVIEW_TZ } from "../giving-glance/fixtures";

import { PREVIEW_COMMUNITY, PREVIEW_TODAY, familyFixture, type FamilyKey } from "./fixtures";
import { PreviewFamily, type Scenario, type Step } from "./preview-client";

export const metadata: Metadata = { title: "Family page · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const pick = <T extends string>(v: string | undefined, all: readonly T[], fallback: T): T =>
  (all as readonly string[]).includes(v ?? "") ? (v as T) : fallback;

/**
 * DEV ONLY. The Family page (New look) inside the new shell, with invented data for a neutral community and fake writes, drawn without a
 * database or a session so every state can be checked and screenshotted.
 *   ?family=hassan|adeyemi|tanaka|empty   which family (tanaka has names in Japanese and Arabic; empty has one adult and nothing else)
 *   ?scenario=ok|conflict|error|access     what a save answers
 *   ?do=phone-edit|phone-save|name|dob-child|address|child   opens an editor (and types) so a screenshot shows that state
 *   ?access=view                           as someone without people.manage
 * Returns notFound() in production.
 */
export default async function PeopleFamilyPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const family = pick<FamilyKey>(one(sp.family), ["hassan", "adeyemi", "tanaka", "empty"], "hassan");
  const scenario = pick<Scenario>(one(sp.scenario), ["ok", "conflict", "error", "access"], "ok");
  const step = pick<Step>(one(sp.do), ["phone-edit", "phone-save", "name", "dob-child", "address", "child", "none"], "none");
  const model = familyFixture(family, { canEdit: one(sp.access) !== "view" });
  const who = model.adults[0].name;
  const target = step === "phone-edit" || step === "phone-save" ? (family === "adeyemi" ? "Tunde Adeyemi" : who) : who;

  const links: FamilyLinks = {
    people: "/dev/admin-people",
    payment: model.can.recordPayment ? "/dev/people-family" : null,
    addPerson: model.canEdit ? "/dev/people-family" : null,
    manageIds: "/dev/people-family",
    more: model.canEdit ? [{ key: "merge", label: "Merge with another family", href: "/dev/people-family", hint: "Compare two households and keep one" }] : [],
  };

  const glance = model.can.seesGiving ? (
    <GivingGlanceView
      view={{
        state: "ready",
        model: composeHousehold({
          today: PREVIEW_TODAY,
          startMonth: 1,
          yearParam: undefined,
          path: "/dev/people-family",
          keep: {},
          limitedView: false,
          fiscalNote: null,
          truncated: false,
          rows: FIXTURE_ROWS,
          adults: GLANCE_ADULTS,
          showBy: "household",
          scopeParam: undefined,
        }),
        currency: PREVIEW_CURRENCY,
        timeZone: PREVIEW_TZ,
      }}
    />
  ) : null;

  return (
    <PreviewShell community={PREVIEW_COMMUNITY} extraPath="/dev/people-family">
      <PreviewFamily
        model={model}
        chips={familyChips(model, PREVIEW_TZ)}
        links={links}
        scenario={scenario}
        step={step}
        who={target}
        slots={{ glance, tabs: <PreviewTabs showGiving={model.can.seesGiving} /> }}
      />
    </PreviewShell>
  );
}

function PreviewTabs({ showGiving }: { showGiving: boolean }) {
  const tabs = [...(showGiving ? ["Giving"] : []), "Memberships", "History"];
  return (
    <section aria-label="Giving, memberships and history">
      <nav aria-label="More about this family" className="mb-3.5 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map((t, i) => (
          <span
            key={t}
            aria-current={i === 0 ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center border-b-[3px] px-4 text-[14.5px] font-bold ${i === 0 ? "border-[var(--v2-blue)] text-[var(--v2-blue)]" : "border-transparent text-muted"}`}
          >
            {t}
          </span>
        ))}
      </nav>
      <div className="cc-card">
        <p className="m-0 px-[18px] py-4 text-[13.5px] text-muted">
          (The real Pledges and Payments tables, the Memberships table or the History trail sit here. They are the existing tab bodies, unchanged.)
        </p>
      </div>
    </section>
  );
}
