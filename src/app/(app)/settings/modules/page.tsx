import type { Metadata } from "next";

import { Alert, Card, NoAccess, PageHeader } from "@/components/ui";
import { userNames } from "@/lib/data/lookups";
import { formatDateTime } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { buildModuleRows, type CatalogLike, type SwitchLike } from "@/lib/modules";
import { isMissingObject, modulesDb, warnMissingOnce } from "@/lib/modules-db";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { ModulesForm, type ModuleRowView } from "./modules-form";

export const metadata: Metadata = { title: "Modules · Settings" };

export default async function ModulesPage() {
  const session = await getSession();
  const center = session.center.short_name || session.center.name;
  const header = (
    <PageHeader
      title="Settings"
      description={`Switch whole areas on or off for ${center} · switched-off modules disappear from the portal and the member app, and the database refuses their data`}
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Modules" access="centerSettings" />
      </>
    );
  }

  const db = modulesDb(session.db);
  const [catalogRes, switchesRes] = await Promise.all([
    db.from("modules").select("key, label, description, core, depends_on, sort"),
    db.from("center_modules").select("module_key, enabled, changed_by, changed_at, reason").eq("center_id", session.center.id),
  ]);

  let notice: { tone: "warning" | "danger"; text: string } | null = null;
  let catalog: CatalogLike[] | null = null;
  let switches: SwitchLike[] = [];
  let canSwitch = true;
  const firstError = catalogRes.error ?? switchesRes.error;
  if (firstError && isMissingObject(firstError)) {
    warnMissingOnce("app.modules / app.center_modules", firstError);
    canSwitch = false;
    notice = {
      tone: "warning",
      text: "Module switches arrive with the next database update, which has not been applied yet. Until then every module is on and cannot be switched off here.",
    };
  } else if (firstError) {
    console.error("[settings/modules] could not load the modules:", firstError);
    canSwitch = false;
    notice = { tone: "danger", text: `Could not load the module switches — ${explainError(firstError)}. Reload to try again; nothing was changed.` };
  } else {
    catalog = catalogRes.data ?? [];
    switches = switchesRes.data ?? [];
  }

  const rows = buildModuleRows(catalog && catalog.length > 0 ? catalog : null, switches);
  const names = await userNames(session.db, session.center.id, rows.map((r) => r.changedBy));
  const view: ModuleRowView[] = rows.map((r) => ({
    ...r,
    changedLine: r.changedAt
      ? `${r.enabled ? "Switched on" : "Switched off"} ${formatDateTime(r.changedAt, session.center.time_zone)}${
          r.changedBy ? ` by ${names.get(r.changedBy)?.name ?? "a former user"}` : ""
        }`
      : null,
  }));

  return (
    <>
      {header}
      {notice ? (
        <div className="mb-4">
          <Alert tone={notice.tone}>{notice.text}</Alert>
        </div>
      ) : null}
      <Card
        title="Modules"
        description="Each switch needs a reason; it is kept in the audit log. Core modules are always on. A module another one depends on can only be switched off after that one."
        padded={false}
      >
        <ModulesForm rows={view} canSwitch={canSwitch} />
      </Card>
    </>
  );
}
