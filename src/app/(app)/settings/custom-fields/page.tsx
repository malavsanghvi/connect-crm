import type { Metadata } from "next";
import Link from "next/link";

import { BlockGrid, Card, EmptyState, NoAccess, PageHeader, QueryError, StatusText } from "@/components/ui";
import { SENSITIVITY_LABELS, entityLabel, type CustomFieldDef } from "@/lib/custom-fields";
import { loadCustomFieldDefs } from "@/lib/data/custom-fields";
import { CUSTOM_TYPES } from "@/lib/import/mapping";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { AddCustomFieldForm, EditCustomFieldForm } from "./custom-fields-form";

export const metadata: Metadata = { title: "Custom fields · Settings" };

const ENTITIES_FOR_NEW = ["people", "households", "memberships", "pledges", "payments", "store_items", "events", "pathshala_classes"];

export default async function CustomFieldsPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Settings"
      description="Custom fields · the details your organization keeps that have no field of their own. Columns an import could not match are kept here, staff-only until someone reviews them."
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Custom fields" access="centerSettings" />
      </>
    );
  }
  const loaded = await loadCustomFieldDefs(session.db, session.center.id, undefined, true);
  const runs = await session.db.from("import_runs").select("id, run_number").eq("center_id", session.center.id);
  if (runs.error) console.error("[custom fields] could not load import run numbers:", runs.error);
  const runNo = new Map((runs.data ?? []).map((r) => [r.id, r.run_number]));
  const byEntity = new Map<string, CustomFieldDef[]>();
  for (const d of loaded.defs) byEntity.set(d.entity, [...(byEntity.get(d.entity) ?? []), d]);
  const typeLabel = new Map(CUSTOM_TYPES.map((t) => [t.value, t.label]));

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={12} title="Add a custom field">
          <AddCustomFieldForm entities={ENTITIES_FOR_NEW} />
        </Card>
        {loaded.error ? (
          <Card span={12}>
            <QueryError what="the custom fields" error={loaded.error} retryHref="/settings/custom-fields" />
          </Card>
        ) : loaded.missing ? (
          <Card span={12}>
            <EmptyState title="Custom fields arrive with the next database update, which has not been applied yet." />
          </Card>
        ) : byEntity.size === 0 ? (
          <Card span={12}>
            <EmptyState title="No custom fields yet">Add one above, or import a file: columns with no matching field are kept as custom fields.</EmptyState>
          </Card>
        ) : (
          [...byEntity].map(([entity, defs]) => (
            <Card
              key={entity}
              span={12}
              title={entityLabel(entity)}
              description={`Shown under “More details” on each record${entity === "people" || entity === "households" ? ", and as a column you can add to the list" : ""}.`}
              padded={false}
            >
              <div className="overflow-x-auto">
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">Key</th>
                      <th scope="col">Type</th>
                      <th scope="col">Who sees it</th>
                      <th scope="col">Search</th>
                      <th scope="col">Came from</th>
                      <th scope="col">Status</th>
                      <th scope="col">
                        <span className="sr-only">Edit</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {defs.map((d) => (
                      <tr key={d.id}>
                        <td className="font-semibold">{d.label}</td>
                        <td className="font-mono text-[12px]">{d.key}</td>
                        <td>
                          {typeLabel.get(d.type) ?? d.type}
                          {d.type === "choice" && d.choices.length ? <span className="block text-[12px] text-muted">{d.choices.join(", ")}</span> : null}
                        </td>
                        <td>{SENSITIVITY_LABELS[d.sensitivity]}</td>
                        <td>{d.searchable ? "Yes" : "No"}</td>
                        <td>
                          {d.source === "import" && d.source_import_run ? (
                            <Link className="crm-link" href={`/settings/import/${d.source_import_run}`}>
                              Import #{runNo.get(d.source_import_run) ?? "?"}
                            </Link>
                          ) : d.source === "import" ? (
                            "An import"
                          ) : (
                            "Added by hand"
                          )}
                        </td>
                        <td>{d.status === "active" ? <StatusText tone="ok">Active</StatusText> : <StatusText tone="warn">Archived</StatusText>}</td>
                        <td>
                          <EditCustomFieldForm def={d} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          ))
        )}
      </BlockGrid>
    </>
  );
}
