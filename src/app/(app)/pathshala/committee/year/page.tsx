import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState } from "@/components/ui";
import { pathshalaYearFor } from "@/lib/logic/eams";
import { formatDate, todayIso } from "@/lib/pathshala/format";
import { load, rows, viewerOf } from "@/lib/pathshala/server";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { Details, LoadProblem, Notice, PField, PNoAccess, SectionHeading } from "../../ui";
import { createYear } from "../actions";

export const metadata: Metadata = { title: "Create Pathshala year" };

function nextYear(label: string) {
  const start = Number(label.slice(0, 4)) + 1;
  return `${start}-${start + 1}`;
}

export default async function YearPage() {
  const v = viewerOf(await getSession());
  if (!can(v, ["events.view", "events.manage"])) return <PNoAccess area="Pathshala year planning" />;
  const supabase = v.db;
  const tz = v.center.time_zone;
  const res = await load(async () => {
    const [templates, events] = await Promise.all([
      supabase.from("event_templates").select("id, name, description").eq("center_id", v.center.id).order("name"),
      supabase.from("events").select("id, name, starts_at, program_year, template_id").eq("center_id", v.center.id).not("program_year", "is", null).order("starts_at", { nullsFirst: true }),
    ]);
    return { templates: rows(templates, "templates"), events: rows(events, "Pathshala year events") };
  });
  if (!res.ok) return <LoadProblem message={res.error} />;
  const { templates, events } = res.data;
  const years = [...new Set(events.map((e) => e.program_year!))].sort().reverse();
  const current = pathshalaYearFor(todayIso(tz));
  const suggested = years.includes(current) ? nextYear(current) : current;
  const manage = can(v, "events.manage");

  return (
    <>
      <SectionHeading
        title="Create a Pathshala year"
        description="Makes one event per template, with the template's before, during and after checklist as actions. Dates are optional — set them now or later on each event."
      />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {!manage ? (
            <Notice>Only committee members who manage events can create a year.</Notice>
          ) : templates.length === 0 ? (
            <EmptyState title="No templates yet">
              <Link className="crm-link font-semibold" href="/pathshala/committee/templates">Create templates</Link> first.
            </EmptyState>
          ) : (
            <Card>
              <ActionForm buttonsClassName="mt-3"
                action={createYear}
                submitLabel="Create the year"
                pendingLabel="Creating events…"
                variant="primary"
                confirmMessage="Create one event for each ticked template?"
              >
                <PField label="Pathshala year" hint={years.length ? `Existing: ${years.join(", ")}` : "No years yet"}>
                  <input name="program_year" required defaultValue={suggested} pattern="\d{4}-\d{4}" className="crm-input" />
                </PField>
                <ul className="mt-4 divide-y divide-line">
                  {templates.map((t) => (
                    <li key={t.id} className="py-3">
                      <label className="flex min-h-11 items-start gap-3">
                        <input type="checkbox" name="template_id" value={t.id} defaultChecked className="mt-1 h-5 w-5 accent-purple" />
                        <span className="min-w-0 flex-1">
                          <span className="font-semibold">{t.name}</span>
                          {t.description && <span className="block text-xs text-muted">{t.description}</span>}
                        </span>
                      </label>
                      <input type="hidden" name={`default_name_${t.id}`} value={t.name} />
                      <div className="ml-8 mt-2 grid gap-2 sm:grid-cols-2">
                        <PField label="Event name">
                          <input name={`name_${t.id}`} defaultValue={t.name} className="crm-input" />
                        </PField>
                        <PField label="Date (optional)">
                          <input type="date" name={`date_${t.id}`} className="crm-input" />
                        </PField>
                      </div>
                    </li>
                  ))}
                </ul>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-4 lg:col-span-2">
          <h2 className="font-display text-lg font-semibold">Existing years</h2>
          {years.length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            years.map((y) => {
              const evs = events.filter((e) => e.program_year === y);
              return (
                <Details key={y} summary={`${y} · ${evs.length} events`} open={y === current}>
                  <ul className="space-y-1 text-sm">
                    {evs.map((e) => (
                      <li key={e.id} className="flex justify-between gap-2">
                        <Link className="crm-link font-semibold" href={`/events/${e.id}?tab=checklist`}>
                          {e.name}
                        </Link>
                        <span className="text-muted">{e.starts_at ? formatDate(e.starts_at, tz) : "No date"}</span>
                      </li>
                    ))}
                  </ul>
                </Details>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
