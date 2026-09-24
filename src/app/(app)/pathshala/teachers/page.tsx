import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { HistoryButton } from "@/components/record-history";
import { Card, EmptyState, TableWrap } from "@/components/ui";
import { loadLevels, loadTerms } from "@/lib/data/pathshala";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDateTime } from "@/lib/pathshala/format";
import { load, rows, viewerOf } from "@/lib/pathshala/server";
import { getSession } from "@/lib/session";

import { decideApplication, savePosition, setPositionStatus } from "../actions";
import { DrawerButton } from "../drawer-button";
import { ActionButton, Details, LoadProblemPage, PathshalaHeader, PBadge, PField, PNoAccessPage, Select } from "../ui";

export const metadata: Metadata = { title: "Teacher positions" };

const OUTCOME = { pending: "Pending", selected: "Selected", not_selected: "Not selected" } as const;
const OUTCOME_TONE = { pending: "warning", selected: "success", not_selected: "muted" } as const;

/**
 * Teacher positions (teacher_positions) and the applications members send from
 * the app (teacher_applications). Open positions show in the member app under
 * Jain Way › Learn › Teach at Pathshala.
 */
export default async function TeacherPositionsPage() {
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.admin(v)) return <PNoAccessPage area="Pathshala teacher positions" />;
  const canManage = pathshalaAreas.manage(v);
  const supabase = v.db;
  const tz = v.center.time_zone;
  const res = await load(async () => {
    const [positions, terms, levels] = await Promise.all([
      supabase.from("teacher_positions").select("*").eq("center_id", v.center.id).order("created_at", { ascending: false }),
      loadTerms(supabase, v.center.id),
      loadLevels(supabase, v.center.id),
    ]);
    // Applications need pathshala.manage (RLS); a viewer without it sees the positions only.
    const apps = canManage ? rows(await supabase.from("teacher_applications").select("*").eq("center_id", v.center.id).order("submitted_at", { ascending: false }), "applications") : [];
    return { positions: rows(positions, "teacher positions"), terms, levels, apps };
  });
  if (!res.ok) return <LoadProblemPage message={res.error} />;
  const { positions, terms, levels, apps } = res.data;
  const termName = (id: string | null) => terms.find((t) => t.id === id)?.name ?? "Any term";
  const levelName = (id: string | null) => {
    const l = levels.find((x) => x.id === id);
    return l ? `${l.track_name ? `${l.track_name} · ` : ""}${l.name}` : "Any level";
  };

  const positionFields = (
    <div className="space-y-3">
      <PField label="Position">
        <input name="title" required className="crm-input" placeholder="Jainism 2 teacher (Sunday)" />
      </PField>
      <PField label="Term">
        <Select name="term_id" defaultValue="" options={[{ value: "", label: "Any term" }, ...terms.map((t) => ({ value: t.id, label: t.name }))]} />
      </PField>
      <PField label="Level">
        <Select name="level_id" defaultValue="" options={[{ value: "", label: "Any level" }, ...levels.map((l) => ({ value: l.id, label: levelName(l.id) }))]} />
      </PField>
      <PField label="What the role involves">
        <textarea name="description" rows={3} className="crm-input" />
      </PField>
      <PField label="Minimum qualifications">
        <textarea name="min_qualifications" rows={2} className="crm-input" />
      </PField>
      <PField label="Status">
        <Select name="status" defaultValue="open" options={[{ value: "open", label: "Open — members can apply" }, { value: "closed", label: "Closed" }]} />
      </PField>
    </div>
  );

  return (
    <>
      <PathshalaHeader
        description="Teacher positions · post openings, members apply from the app, the principal decides"
        actions={
          canManage ? (
            <DrawerButton label="New position" title="New teacher position" kicker="Pathshala" size="sm">
              <ActionForm action={savePosition.bind(null, null)} submitLabel="Post position" variant="primary" resetOnSuccess buttonsClassName="mt-3">
                {positionFields}
              </ActionForm>
            </DrawerButton>
          ) : null
        }
      />
      <Card title="Positions" padded={false} className="mb-4">
        {positions.length === 0 ? (
          <EmptyState title="No teacher positions yet">{canManage ? "Post one with New position; it shows in the member app while open." : ""}</EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table crm-table-first-bold min-w-[720px]">
              <thead>
                <tr>
                  <th>Position</th>
                  <th>Term</th>
                  <th>Level</th>
                  <th className="num">Applications</th>
                  <th>Status</th>
                  {canManage ? <th aria-label="Actions" /> : null}
                </tr>
              </thead>
              <tbody>
                {positions.map((p) => (
                  <tr key={p.id}>
                    <td>
                      {p.title}
                      {p.description ? <div className="text-xs font-normal text-muted">{p.description}</div> : null}
                    </td>
                    <td>{termName(p.term_id)}</td>
                    <td>{levelName(p.level_id)}</td>
                    <td className="num">{canManage ? apps.filter((a) => a.position_id === p.id).length : "—"}</td>
                    <td>
                      <PBadge tone={p.status === "open" ? "success" : "muted"}>{p.status === "open" ? "Open" : "Closed"}</PBadge>
                    </td>
                    {canManage ? (
                      <td className="text-right">
                        <ActionButton
                          action={setPositionStatus.bind(null, p.id)}
                          fields={{ status: p.status === "open" ? "closed" : "open" }}
                          label={p.status === "open" ? "Close" : "Reopen"}
                          variant={p.status === "open" ? "bad" : undefined}
                        />
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      {canManage ? (
        <Card title={`Applications (${apps.length})`} padded={false}>
          {apps.length === 0 ? (
            <EmptyState title="No applications yet">Members apply from the app while a position is open.</EmptyState>
          ) : (
            <ul className="divide-y divide-line">
              {apps.map((a) => {
                const pos = positions.find((p) => p.id === a.position_id);
                return (
                  <li key={a.id} className="grid gap-3 p-4 lg:grid-cols-5">
                    <div className="lg:col-span-3">
                      <p className="flex flex-wrap items-center gap-2 font-semibold">
                        {a.name}
                        <PBadge tone={OUTCOME_TONE[a.outcome as keyof typeof OUTCOME_TONE] ?? "neutral"}>{OUTCOME[a.outcome as keyof typeof OUTCOME] ?? a.outcome}</PBadge>
                        <HistoryButton table="teacher_applications" recordId={a.id} title={`Application · ${a.name}`} size="xs" />
                      </p>
                      <p className="text-xs text-muted">
                        {pos?.title ?? "Position removed"} · sent {formatDateTime(a.submitted_at, tz)}
                        {a.email ? ` · ${a.email}` : ""}
                        {a.phone_e164 ? ` · ${a.phone_e164}` : ""}
                      </p>
                      <Details summary="Read the application">
                        <dl className="mt-2 space-y-2 text-sm">
                          {(
                            [
                              ["Education", a.education],
                              ["Qualifications", a.qualifications],
                              ["Relevant activities", a.relevant_activities],
                              ["Why they want to teach", a.motivation],
                            ] as const
                          ).map(([k, val]) => (
                            <div key={k}>
                              <dt className="font-semibold">{k}</dt>
                              <dd className="whitespace-pre-wrap text-muted">{val || "—"}</dd>
                            </div>
                          ))}
                        </dl>
                      </Details>
                    </div>
                    <div className="lg:col-span-2">
                      <ActionForm action={decideApplication.bind(null, a.id)} submitLabel="Save decision" size="xs" buttonsClassName="mt-2">
                        <PField label="Decision">
                          <Select name="outcome" defaultValue={a.outcome} options={Object.entries(OUTCOME).map(([value, label]) => ({ value, label }))} />
                        </PField>
                        <PField label="Note to keep with the decision">
                          <textarea name="outcome_note" rows={2} defaultValue={a.outcome_note ?? ""} className="crm-input" />
                        </PField>
                      </ActionForm>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      ) : null}
    </>
  );
}
