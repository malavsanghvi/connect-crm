import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { buttonClass, Card, EmptyState } from "@/components/ui";
import { loadTerms, pickTerm } from "@/lib/data/pathshala";
import type { Tables } from "@/lib/database.types";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDateTime } from "@/lib/pathshala/format";
import { load, resolveUserNames, rows, viewerOf } from "@/lib/pathshala/server";
import { can, hasCenterRole, hasScopedRole, teacherClassIds } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { deleteAnnouncement, saveAnnouncement, setAnnouncementPublished } from "../actions";
import { ActionButton, Details, LoadProblem, PathshalaHeader, PBadge, PField, PNoAccess, TermSwitcher } from "../ui";

export const metadata: Metadata = { title: "Class announcements" };

export default async function AnnouncementsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.announcements(v)) {
    return (
      <>
        <PathshalaHeader />
        <PNoAccess area="Pathshala announcements (a Teacher role, pathshala.view or pathshala.manage)" />
      </>
    );
  }
  const sp = await searchParams;
  const supabase = v.db;
  const manage = can(v, "pathshala.manage");

  const res = await load(async () => {
    const terms = await loadTerms(supabase, v.center.id);
    const term = pickTerm(terms, typeof sp.term === "string" ? sp.term : null);
    if (!term) return { terms, term: null, classes: [], items: [], authors: new Map<string, string>() };
    let classes = rows(await supabase.from("pathshala_classes").select("id, name").eq("term_id", term.id).order("name"), "classes");
    if (!pathshalaAreas.admin(v) && !hasCenterRole(v, "teacher")) {
      const mine = new Set(teacherClassIds(v));
      classes = classes.filter((c) => mine.has(c.id));
    }
    const ids = classes.map((c) => c.id);
    const filter = ids.length ? `term_id.eq.${term.id},class_id.in.(${ids.join(",")})` : `term_id.eq.${term.id}`;
    const items = rows(
      await supabase.from("class_announcements").select("*").eq("center_id", v.center.id).or(filter).order("created_at", { ascending: false }).limit(100),
      "announcements",
    );
    const authors = await resolveUserNames(supabase, v.center.id, items.map((i) => i.author_user));
    return { terms, term, classes, items, authors };
  });
  if (!res.ok) {
    return (
      <>
        <PathshalaHeader />
        <LoadProblem message={res.error} retryHref="/pathshala/announcements" />
      </>
    );
  }
  const { terms, term, classes, items, authors } = res.data;
  const preselect = typeof sp.class === "string" && classes.some((c) => c.id === sp.class) ? sp.class : manage ? "term" : (classes[0]?.id ?? "");
  const audienceOptions = [...(manage ? [{ value: "term", label: "Whole Pathshala (all families this term)" }] : []), ...classes.map((c) => ({ value: c.id, label: c.name }))];
  const canEditItem = (a: Tables<"class_announcements">) =>
    manage || (a.class_id !== null && hasScopedRole(v, a.class_id, "teacher") && a.author_user === v.userId);

  return (
    <>
      <PathshalaHeader
        description="Class announcements · messages to Pathshala families, by class or for the whole term · families see them in the member app once published"
      />
      <TermSwitcher terms={terms} activeId={term?.id ?? null} basePath="/pathshala/announcements" />
      {!term ? (
        <Card>
          <EmptyState title="No Pathshala term yet" />
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-12">
          <div className="lg:col-span-7">
            {items.length === 0 ? (
              <Card>
                <EmptyState title="No announcements yet" />
              </Card>
            ) : (
              <ul className="space-y-3">
                {items.map((a) => {
                  const audience = a.class_id ? (classes.find((c) => c.id === a.class_id)?.name ?? "A class") : "Whole Pathshala";
                  return (
                    <li key={a.id}>
                      <Card>
                        <div className="flex flex-wrap items-center gap-2">
                          <PBadge tone={a.published_at ? "success" : "muted"}>{a.published_at ? "Published" : "Draft"}</PBadge>
                          <PBadge tone="purple">{audience}</PBadge>
                        </div>
                        <h3 className="mt-2 font-display text-lg font-semibold">{a.title}</h3>
                        <p className="mt-1 whitespace-pre-line text-sm">{a.body_md}</p>
                        <p className="mt-2 text-xs text-muted">
                          {a.published_at ? `Published ${formatDateTime(a.published_at, v.center.time_zone)}` : `Created ${formatDateTime(a.created_at, v.center.time_zone)}`}
                          {a.author_user ? ` · by ${a.author_user === v.userId ? "you" : (authors.get(a.author_user) ?? "staff")}` : ""}
                        </p>
                        {canEditItem(a) && (
                          <div className="mt-3 flex flex-wrap gap-2">
                            <ActionButton
                              action={setAnnouncementPublished.bind(null, a.id)}
                              fields={{ publish: a.published_at ? "0" : "1" }}
                              label={a.published_at ? "Unpublish" : "Publish"}
                              variant={a.published_at ? "ghost" : "primary"}
                              confirm={a.published_at ? undefined : `Publish "${a.title}" to ${audience} families?`}
                            />
                            <ActionButton action={deleteAnnouncement.bind(null, a.id)} label="Delete" variant="bad" confirm="Delete this announcement?" />
                          </div>
                        )}
                        {canEditItem(a) && (
                          <div className="mt-3">
                            <Details summary="Edit">
                              <ActionForm buttonsClassName="mt-3" action={saveAnnouncement.bind(null, a.id)} submitLabel="Save">
                                <input type="hidden" name="term_id" value={a.term_id ?? term.id} />
                                <input type="hidden" name="scope" value={a.class_id ?? "term"} />
                                <PField label="Title">
                                  <input name="title" required defaultValue={a.title} className="crm-input" />
                                </PField>
                                <PField label="Message" className="mt-3">
                                  <textarea name="body_md" required rows={5} defaultValue={a.body_md} className="crm-input" />
                                </PField>
                              </ActionForm>
                            </Details>
                          </div>
                        )}
                      </Card>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          <div className="lg:col-span-5">
            <Card title="New announcement">
              {audienceOptions.length === 0 ? (
                <p className="text-sm text-muted">You don&apos;t teach a class this term.</p>
              ) : (
                <ActionForm buttonsClassName="mt-3"
                  action={saveAnnouncement.bind(null, null)}
                  submitLabel="Save draft"
                  variant="ghost"
                  resetOnSuccess
                  extraButtons={
                    <button type="submit" name="intent" value="publish" className={buttonClass("primary")}>
                      Publish now
                    </button>
                  }
                >
                  <input type="hidden" name="term_id" value={term.id} />
                  <div className="space-y-3">
                    <PField label="Send to">
                      <select name="scope" required defaultValue={preselect} className="crm-input">
                        {audienceOptions.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </PField>
                    <PField label="Title">
                      <input name="title" required className="crm-input" />
                    </PField>
                    <PField label="Message" hint="Plain text; line breaks are kept. Parents only — never one-to-one messages to students.">
                      <textarea name="body_md" required rows={6} className="crm-input" />
                    </PField>
                  </div>
                </ActionForm>
              )}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
