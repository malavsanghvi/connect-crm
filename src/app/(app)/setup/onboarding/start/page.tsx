import type { Metadata } from "next";

import { FrontDoor } from "@/components/onboarding-front/front-door";
import { Card, NoAccess, PageHeader } from "@/components/ui";
import { failure } from "@/lib/errors";
import { canImportEntity, entityDef } from "@/lib/import/registry";
import { kindModuleLabel, kindName, moduleNotOffered } from "@/lib/kind";
import { isModuleEnabled, moduleDef, type ModuleKey } from "@/lib/modules";
import { buildFrontDoor, type FrontInput, type QboState } from "@/lib/onboarding-front/front-door";
import { recogniseContext } from "@/lib/onboarding-front/signatures";
import { loadRuns, resolveDbOf } from "@/lib/onboarding/resolve/store";
import { canAccess } from "@/lib/permissions";
import { getSession, type CrmSession } from "@/lib/session";

export const metadata: Metadata = { title: "Bring your data in · Setup" };

const SELF = "/setup/onboarding/start";
const QBO_PROVIDERS = ["quickbooks_online", "intuit_sandbox"] as const;

/** Optional modules that hold records worth bringing in, with a neutral word when the kind has none of its own. */
const OTHER_MODULES: readonly { key: ModuleKey; fallback: string }[] = [
  { key: "events", fallback: "Events" },
  { key: "store", fallback: "Store" },
  { key: "pathshala", fallback: "Classes" },
];

/** The QuickBooks connection as far as this person may see it (the database decides; this only reads). */
async function qboState(session: CrmSession): Promise<QboState> {
  const label = kindModuleLabel(session.kind, "accounting", moduleDef("accounting").label);
  if (moduleNotOffered(session.kind, "accounting")) return { state: "off", moduleLabel: label, offered: false };
  if (!isModuleEnabled(session, "accounting")) return { state: "off", moduleLabel: label, offered: true };
  if (!canAccess(session, "qboConnection")) return { state: "no_access" };
  const res = await session.db
    .from("integration_connections")
    .select("provider, status, display_name, last_error")
    .eq("center_id", session.center.id)
    .in("provider", [...QBO_PROVIDERS]);
  if (res.error) return { state: "error", message: failure("Could not check the QuickBooks connection", res.error).error };
  const rows = res.data ?? [];
  const row = rows.find((r) => r.status === "connected" || r.status === "expiring") ?? rows[0];
  if (!row || row.status === "disconnected") return { state: "not_connected" };
  if (row.status === "error") return { state: "problem", detail: row.last_error };
  return { state: "connected", name: row.display_name, expiring: row.status === "expiring" };
}

/**
 * Bring your data in: one front door (board 1 of docs/handoff/prototypes/onboarding-data/Main.dc.html). The steps, a plan
 * from what Weaver already knows, a drop zone that says what each file is (in the browser only: nothing is uploaded), the
 * connectors, templates and helpers, and what Niva sees. Gated exactly like Guided onboarding.
 */
export default async function BringYourDataInPage() {
  const session = await getSession();
  const header = <PageHeader title="Bring your data in" description="Drop what you have, connect a system, or start from a template" />;
  if (!canAccess(session, "dataImport")) {
    return (
      <>
        {header}
        <NoAccess area="Bring your data in" access="dataImport" />
      </>
    );
  }
  const people = entityDef("people");
  const payments = entityDef("payments");
  const canPeople = Boolean(people && canImportEntity(session, people));
  const canPayments = Boolean(payments && canImportEntity(session, payments));
  if (!canPeople && !canPayments) {
    return (
      <>
        {header}
        <Card title="You don't have access to this area">
          <p className="text-[13px]">
            Bringing your data in loads households, people and donations, so it needs <strong>{people?.writePerms.join(" or ")}</strong> (households and people) or{" "}
            <strong>{payments?.writePerms.join(" or ")}</strong> (donations). Ask your center admin to grant you a role that includes one of them (Settings → Roles &amp; entitlements).
          </p>
        </Card>
      </>
    );
  }

  const { kind } = session;
  const [runs, qbo] = await Promise.all([loadRuns(resolveDbOf(session.db), session.center.id), qboState(session)]);
  const peopleLabel = kindModuleLabel(kind, "people", moduleDef("people").label);
  const peopleWord = peopleLabel.charAt(0).toLowerCase() + peopleLabel.slice(1);
  const givingOffered = !moduleNotOffered(kind, "giving");
  const givingOn = givingOffered && isModuleEnabled(session, "giving");
  const input: FrontInput = {
    communityName: session.center.short_name || session.center.name,
    kindLabel: kind.label,
    peopleLabel,
    giving: givingOffered ? { label: kindModuleLabel(kind, "giving", moduleDef("giving").label), on: givingOn } : null,
    otherModules: OTHER_MODULES.filter((m) => !moduleNotOffered(kind, m.key)).map((m) => ({ label: kindName(kind, m.key, m.fallback), on: isModuleEnabled(session, m.key) })),
    imports: runs.ok
      ? { ok: true, list: runs.data.map((r) => ({ entity: r.entity, entityLabel: r.entityLabel, rows: r.rowsTotal, loaded: r.status === "committed" })) }
      : { ok: false, error: runs.denied ? "You don't have access to the list of earlier imports." : runs.error },
    qbo,
  };

  return (
    <div className="-mx-4 -mt-[22px] sm:-mx-7 md:-mb-10">
      <FrontDoor
        model={buildFrontDoor(input)}
        recognise={recogniseContext(peopleWord, givingOn)}
        peopleWord={peopleWord}
        links={{
          self: SELF,
          setup: "/setup",
          guided: "/setup/onboarding",
          dataImport: "/settings/import/new",
          bank: givingOn && isModuleEnabled(session, "giving_bank") ? "/giving/payments/bank" : null,
          qboSetup: canAccess(session, "qbo") && isModuleEnabled(session, "accounting") ? "/accounting/qbo/setup" : null,
          peopleTemplate: "/setup/onboarding/template?kind=people&format=xlsx",
          donationsTemplate: givingOn ? "/setup/onboarding/template?kind=donations&format=xlsx" : null,
        }}
      />
    </div>
  );
}
