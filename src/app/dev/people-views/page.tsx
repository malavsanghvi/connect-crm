import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewShell } from "@/app/dev/people-shell";
import { PreviewFamily } from "@/app/dev/people-family/preview-client";
import { familyFixture } from "@/app/dev/people-family/fixtures";
import { PeopleHome } from "@/components/people-v2/people-home";
import { PeopleWorkspace } from "@/components/people-v2/people-workspace";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { NoAccess } from "@/components/ui";
import { devPreviewAllowed } from "@/lib/dev-preview";
import { filtersFromParams, hasFilters, NO_FILTERS, type HouseholdFilters } from "@/lib/people-v2/ask";
import { familyChips } from "@/lib/people-v2/family-model";

import { COMMUNITY, gapWorkspace, GAP_FILTERS, isStep, sampleHomeViews } from "./fixtures";
import { AutoDo, PreviewSaved } from "./preview-client";

export const metadata: Metadata = { title: "Saved views · Dev preview" };

type Search = Promise<Record<string, string | string[] | undefined>>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const STATES = ["home", "empty", "error", "gaplist", "gaplist-empty", "family", "noaccess"] as const;
type State = (typeof STATES)[number];

/**
 * DEV ONLY. Saved views, pinned families, contact-gap lists and export (People redesign, slice 8) inside the New look's frame, with invented
 * data for a neutral community and fake writes, drawn without a database or a session. Returns notFound() in production.
 *   ?state=home|empty|error|gaplist|gaplist-empty|family|noaccess
 *       home           the People home: pinned families above recent ones, saved views, the Lists menu
 *       empty          no pins, no views, no recent families          error   the saved views and pins could not be read
 *       gaplist        a list of adults with a contact gap, from the address (default: adults with no email); Save this view and Export
 *       gaplist-empty  a gap list nobody matches                       family  the Family page with the pin star (?pinned=1 starts pinned)
 *       noaccess       a role that cannot open People
 *   ?fail=1            every write fails the way a lost connection does (the error is shown next to what the person did)
 *   ?do=save|save-go|save-dup|rename|rename-go|delete|delete-go|unpin-home|pin   opens a control (and types, and presses) so a screenshot catches that state
 */
export default async function PeopleViewsPreview({ searchParams }: { searchParams?: Search }) {
  if (!devPreviewAllowed()) notFound();
  const sp = (await searchParams) ?? {};
  const state: State = (STATES as readonly string[]).includes(one(sp.state) ?? "") ? (one(sp.state) as State) : "home";
  const fail = one(sp.fail) === "1";
  const doParam = one(sp.do);
  const step = isStep(doParam) ? doParam : "none";

  let body;
  if (state === "noaccess") {
    body = (
      <>
        <h1 className="mb-4 font-display text-[30px] font-semibold text-ink">People</h1>
        <NoAccess area="People" access="households" />
      </>
    );
  } else if (state === "family") {
    const model = familyFixture("hassan", { canEdit: true });
    const links: FamilyLinks = {
      people: "/dev/people-views",
      payment: "/dev/people-views",
      addPerson: "/dev/people-views",
      manageIds: "/dev/people-views",
      more: [{ key: "merge", label: "Merge with another family", href: "/dev/people-views", hint: "Compare two households and keep one" }],
      pin: { householdId: "f-hassan", pinned: one(sp.pinned) === "1", loadError: one(sp.pinerror) === "1" ? "the database could not be reached — check the connection and try again." : null },
    };
    body = (
      <PreviewFamily
        model={model}
        chips={familyChips(model, "America/Chicago")}
        links={links}
        scenario="ok"
        step="none"
        who={model.adults[0].name}
        slots={{ glance: null, tabs: <p className="m-0 rounded-xl border border-line bg-white px-4 py-4 text-[13.5px] text-muted">(The Giving, Memberships, Events and History tabs sit here, unchanged.)</p> }}
      />
    );
  } else if (state === "gaplist" || state === "gaplist-empty") {
    const flat = Object.fromEntries(Object.entries(sp).flatMap(([k, v]) => (typeof one(v) === "string" ? [[k, one(v) as string]] : [])));
    const asked = filtersFromParams(flat);
    const nobody: HouseholdFilters = { ...NO_FILTERS, noEmail: true, noMobile: true, noAddress: true, notOnApp: true, band: "seniors" };
    const filters = state === "gaplist-empty" ? nobody : hasFilters(asked) ? asked : GAP_FILTERS;
    body = <PeopleWorkspace model={gapWorkspace(filters)} />;
  } else {
    body = <PeopleHome model={sampleHomeViews({ empty: state === "empty", error: state === "error" })} />;
  }

  return (
    <PreviewShell community={COMMUNITY} extraPath="/dev/people-views">
      <PreviewSaved fail={fail}>
        {body}
        <AutoDo step={step} />
      </PreviewSaved>
    </PreviewShell>
  );
}
