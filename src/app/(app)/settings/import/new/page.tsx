import type { Metadata } from "next";

import { Alert, NoAccess, PageHeader } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { ENTITIES, canImportEntity } from "@/lib/import/registry";
import { canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { ImportWizard, type SavedMapping } from "./wizard";

export const metadata: Metadata = { title: "New import · Data import · Settings" };

export default async function NewImportPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Data import · upload, map, check, preview, import and reconcile one file" />;
  if (!canAccess(session, "dataImport")) {
    return (
      <>
        {header}
        <NoAccess area="Data import" access="dataImport" />
      </>
    );
  }
  const sp = await searchParams;
  const allowed = ENTITIES.filter((e) => canImportEntity(session, e) && !session.modulesOff.includes(e.module ?? "")).map((e) => e.key);
  const saved = await session.db.from("import_mappings").select("source, entity, mapping").eq("center_id", session.center.id).order("updated_at", { ascending: false });
  if (saved.error) console.error("[import/new] could not load saved mappings:", saved.error);
  const ids = identifierRules(session.center.rules);
  return (
    <>
      {header}
      {saved.error ? (
        <div className="mb-3">
          <Alert tone="warning">Saved mappings could not be loaded ({explainError(saved.error)}); columns are matched by name only.</Alert>
        </div>
      ) : null}
      <ImportWizard
        allowed={allowed}
        initialEntity={param(sp, "entity") ?? null}
        saved={(saved.data ?? []) as unknown as SavedMapping[]}
        today={todayInTz(session.center.time_zone)}
        legacySystems={ids.legacySystems.map((s) => ({ system: s.system, label: s.label }))}
      />
    </>
  );
}
