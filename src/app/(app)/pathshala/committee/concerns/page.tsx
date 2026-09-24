import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { PersonPicker } from "@/components/person-picker";
import { Card, EmptyState } from "@/components/ui";
import type { StatusUpdate } from "@/lib/logic/eams";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDateTime, humanize } from "@/lib/pathshala/format";
import { load, resolveUserNames, rows, viewerOf } from "@/lib/pathshala/server";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { searchPeopleAction } from "../../actions";
import { Checkbox, Details, FormGrid, LoadProblem, PBadge, PField, PNoAccess, SectionHeading, Select, ViewChips } from "../../ui";
import { createActionFromConcern, createConcern, updateConcern } from "../actions";

export const metadata: Metadata = { title: "Concerns" };

export default async function ConcernsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.admin(v)) return <PNoAccess area="Pathshala concerns" />;
  const sp = await searchParams;
  const view = sp.view === "closed" ? "closed" : sp.view === "all" ? "all" : "open";
  const source = sp.source === "teacher" || sp.source === "parent" ? sp.source : null;
  const openId = typeof sp.open === "string" ? sp.open : null;
  const supabase = v.db;
  const tz = v.center.time_zone;
  const manage = can(v, "pathshala.manage");
  const canAct = can(v, "events.manage");

  const res = await load(async () => {
    let q = supabase.from("concerns").select("*").eq("center_id", v.center.id).order("created_at", { ascending: false }).limit(200);
    if (view === "open") q = q.neq("status", "closed");
    if (view === "closed") q = q.eq("status", "closed");
    if (source) q = q.eq("source", source);
    const concerns = rows(await q, "concerns");
    const actionIds = concerns.map((c) => c.linked_action_id).filter((x): x is string => Boolean(x));
    const [classes, actions, owners] = await Promise.all([
      supabase.from("pathshala_classes").select("id, name, term_id").eq("center_id", v.center.id).order("name"),
      actionIds.length ? supabase.from("actions").select("id, name, state").in("id", actionIds) : Promise.resolve({ data: [], error: null }),
      resolveUserNames(supabase, v.center.id, concerns.map((c) => c.owner_user_id)),
    ]);
    if (actions.error) console.error("[concerns] linked actions unavailable", actions.error);
    return { concerns, classes: rows(classes, "classes"), actions: actions.data ?? [], owners };
  });
  if (!res.ok) return <LoadProblem message={res.error} />;
  const { concerns, classes, actions, owners } = res.data;
  const href = (k: string) => `/pathshala/committee/concerns?view=${k}${source ? `&source=${source}` : ""}`;

  return (
    <>
      <SectionHeading title="Concerns" description="Raised by teachers and parents, tracked until resolved. Turn one into an action to put it on the committee dashboard." />
      <ViewChips
        active={view}
        tabs={[
          { key: "open", label: "Open", href: href("open") },
          { key: "closed", label: "Closed", href: href("closed") },
          { key: "all", label: "All", href: href("all") },
        ]}
      />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {[null, "teacher", "parent"].map((s) => (
          <Link
            key={s ?? "any"}
            href={`/pathshala/committee/concerns?view=${view}${s ? `&source=${s}` : ""}`}
            aria-current={source === s ? "page" : undefined}
            className="cc-chip"
          >
            {s ? `From ${s}s` : "Everyone"}
          </Link>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {concerns.length === 0 ? (
            <EmptyState title="No concerns here" />
          ) : (
            <ul className="space-y-3">
              {concerns.map((c) => {
                const updates = Array.isArray(c.status_updates) ? (c.status_updates as StatusUpdate[]) : [];
                const action = actions.find((a) => a.id === c.linked_action_id);
                const canEdit = manage || c.owner_user_id === v.userId;
                return (
                  <li key={c.id}>
                    <Card>
                      <div className="flex flex-wrap items-center gap-2">
                        <PBadge tone={c.status === "closed" ? "success" : c.status === "in_progress" ? "navy" : "warning"}>{humanize(c.status)}</PBadge>
                        <PBadge tone="purple">{humanize(c.source)}</PBadge>
                        {c.class_id && <PBadge tone="muted">{classes.find((x) => x.id === c.class_id)?.name ?? "Class"}</PBadge>}
                      </div>
                      <h3 className="mt-2 font-display text-lg font-semibold">{c.title}</h3>
                      <p className="mt-1 whitespace-pre-line text-sm">{c.description}</p>
                      {c.suggestions && <p className="mt-1 text-sm text-muted">Suggestion: {c.suggestions}</p>}
                      <p className="mt-2 text-xs text-muted">
                        {c.submitter_name ?? "Anonymous"}
                        {c.submitter_email ? ` · ${c.submitter_email}` : ""}
                        {c.submitter_phone ? ` · ${c.submitter_phone}` : ""} · {formatDateTime(c.created_at, tz)} · owner:{" "}
                        {c.owner_user_id ? (c.owner_user_id === v.userId ? "you" : (owners.get(c.owner_user_id) ?? "assigned")) : "none"}
                      </p>
                      {action && (
                        <p className="mt-2 text-sm">
                          Action:{" "}
                          <Link className="crm-link font-semibold" href={`/pathshala/committee/actions/${action.id}`}>
                            {action.name}
                          </Link>{" "}
                          <PBadge tone="muted">{humanize(action.state)}</PBadge>
                        </p>
                      )}
                      {c.resolution && <p className="mt-2 rounded-lg bg-success-50 p-2 text-sm text-success">Resolution: {c.resolution}</p>}
                      {updates.length > 0 && (
                        <ol className="mt-2 space-y-1 border-l-2 border-line pl-3 text-xs text-muted">
                          {updates.map((u, i) => (
                            <li key={i}>
                              {formatDateTime(u.date, tz)} · {u.author}: {u.text}
                            </li>
                          ))}
                        </ol>
                      )}
                      {canEdit && (
                        <div className="mt-3 space-y-2">
                          <Details summary="Update" open={openId === c.id}>
                            <ActionForm buttonsClassName="mt-3" action={updateConcern.bind(null, c.id)} submitLabel="Save">
                              <FormGrid>
                                <PField label="Status">
                                  <Select
                                    name="status"
                                    defaultValue={c.status}
                                    options={[
                                      { value: "reported", label: "Reported" },
                                      { value: "in_progress", label: "In progress" },
                                      { value: "closed", label: "Closed" },
                                    ]}
                                  />
                                </PField>
                                <PField label="Owner">
                                  <Select
                                    name="owner"
                                    defaultValue=""
                                    placeholder="Keep as is"
                                    options={[
                                      { value: "me", label: "Assign to me" },
                                      { value: "none", label: "Unassign" },
                                    ]}
                                  />
                                </PField>
                                <PField label="Progress note" className="sm:col-span-2">
                                  <input name="note" className="crm-input" />
                                </PField>
                                <PField label="Resolution (required to close)" className="sm:col-span-2">
                                  <textarea name="resolution" rows={2} defaultValue={c.resolution ?? ""} className="crm-input" />
                                </PField>
                              </FormGrid>
                            </ActionForm>
                          </Details>
                          {canAct && !c.linked_action_id && (
                            <Details summary="⚡ Create action">
                              <ActionForm buttonsClassName="mt-3" action={createActionFromConcern.bind(null, c.id)} submitLabel="Create action" variant="primary">
                                <FormGrid>
                                  <PField label="Action" className="sm:col-span-2">
                                    <input name="name" defaultValue={`Concern: ${c.title}`} className="crm-input" />
                                  </PField>
                                  <PersonPicker search={searchPeopleAction} name="owner_person_id" label="Owner" />
                                  <PField label="Due date">
                                    <input type="date" name="due_on" className="crm-input" />
                                  </PField>
                                  <PField label="Priority">
                                    <Select
                                      name="priority"
                                      defaultValue="high"
                                      options={["low", "medium", "high", "critical"].map((p) => ({ value: p, label: humanize(p) }))}
                                    />
                                  </PField>
                                </FormGrid>
                              </ActionForm>
                            </Details>
                          )}
                        </div>
                      )}
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="lg:col-span-2">
          {manage ? (
            <Card title="Log a concern" description="For concerns received by phone, email or in person.">
              <ActionForm buttonsClassName="mt-3" action={createConcern} submitLabel="Log concern" resetOnSuccess variant="primary">
                <div className="space-y-3">
                  <PField label="From">
                    <Select
                      name="source"
                      defaultValue="parent"
                      options={[
                        { value: "parent", label: "Parent" },
                        { value: "teacher", label: "Teacher" },
                        { value: "member", label: "Member" },
                        { value: "other", label: "Other" },
                      ]}
                    />
                  </PField>
                  <PField label="Name">
                    <input name="submitter_name" className="crm-input" />
                  </PField>
                  <FormGrid>
                    <PField label="Email">
                      <input type="email" name="submitter_email" className="crm-input" />
                    </PField>
                    <PField label="Phone">
                      <input type="tel" name="submitter_phone" className="crm-input" />
                    </PField>
                  </FormGrid>
                  <PField label="Class (optional)">
                    <Select name="class_id" placeholder="Not about one class" options={classes.map((c) => ({ value: c.id, label: c.name }))} />
                  </PField>
                  <PField label="Title">
                    <input name="title" required className="crm-input" />
                  </PField>
                  <PField label="What happened">
                    <textarea name="description" required rows={4} className="crm-input" />
                  </PField>
                  <PField label="Their suggestion">
                    <textarea name="suggestions" rows={2} className="crm-input" />
                  </PField>
                  <Checkbox name="assign_me" label="Assign to me" defaultChecked />
                </div>
              </ActionForm>
            </Card>
          ) : (
            <p className="text-sm text-muted">Only the Pathshala principal can log or update concerns.</p>
          )}
        </div>
      </div>
    </>
  );
}
