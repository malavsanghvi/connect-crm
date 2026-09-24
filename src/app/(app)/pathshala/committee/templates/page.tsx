import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState } from "@/components/ui";
import { load, rows, viewerOf } from "@/lib/pathshala/server";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { Checkbox, LoadProblem, PBadge, PField, PNoAccess, SectionHeading } from "../../ui";
import { saveTemplate } from "../actions";

export const metadata: Metadata = { title: "Event templates" };

export default async function TemplatesPage() {
  const v = viewerOf(await getSession());
  if (!can(v, ["events.view", "events.manage"])) return <PNoAccess area="event templates" />;
  const supabase = v.db;
  const res = await load(async () => {
    const [templates, items, events] = await Promise.all([
      supabase.from("event_templates").select("*").eq("center_id", v.center.id).order("name"),
      supabase.from("event_template_items").select("template_id, phase").eq("center_id", v.center.id),
      supabase.from("events").select("template_id").eq("center_id", v.center.id).not("template_id", "is", null),
    ]);
    return { templates: rows(templates, "templates"), items: rows(items, "template items"), events: rows(events, "events") };
  });
  if (!res.ok) return <LoadProblem message={res.error} />;
  const { templates, items, events } = res.data;

  return (
    <>
      <SectionHeading title="Event templates" description="Reusable checklists with before, during and after items. Creating a Pathshala year makes one event from each template." />
      {templates.length === 0 ? (
        <EmptyState title="No templates yet" />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {templates.map((t) => {
            const its = items.filter((i) => i.template_id === t.id);
            const count = (p: string) => its.filter((i) => i.phase === p).length;
            const lessons = Array.isArray(t.lessons_learned) ? t.lessons_learned.length : 0;
            return (
              <Card key={t.id}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/pathshala/committee/templates/${t.id}`} className="crm-link font-display text-lg font-semibold">
                    {t.name}
                  </Link>
                  {t.confidential && <PBadge tone="warning">Confidential</PBadge>}
                </div>
                {t.description && <p className="mt-1 line-clamp-2 text-sm text-muted">{t.description}</p>}
                <p className="mt-2 text-sm">
                  {count("pre")} before · {count("during")} during · {count("after")} after · {lessons} lesson{lessons === 1 ? "" : "s"} ·{" "}
                  {events.filter((e) => e.template_id === t.id).length} events made
                </p>
              </Card>
            );
          })}
        </div>
      )}
      {can(v, "events.manage") && (
        <Card title="New template" className="mt-4">
          <ActionForm buttonsClassName="mt-3" action={saveTemplate.bind(null, null)} submitLabel="Create template" variant="primary">
            <div className="space-y-3">
              <PField label="Name" hint="e.g. Pathshala annual day">
                <input name="name" required className="crm-input" />
              </PField>
              <PField label="Description">
                <textarea name="description" rows={3} className="crm-input" />
              </PField>
              <Checkbox name="confidential" label="Confidential" />
            </div>
          </ActionForm>
        </Card>
      )}
    </>
  );
}
