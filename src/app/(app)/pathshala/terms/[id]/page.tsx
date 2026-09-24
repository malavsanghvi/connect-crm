import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { Card } from "@/components/ui";
import { classDaysInTerm } from "@/lib/logic/attendance";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatCents, formatDate, formatDateTime, humanize } from "@/lib/pathshala/format";
import { load, row, viewerOf } from "@/lib/pathshala/server";
import { getSession } from "@/lib/session";

import { LoadProblemPage, PathshalaHeader, PDefinitionList, PNoAccessPage } from "../../ui";
import { TermForm } from "../term-form";

export const metadata: Metadata = { title: "Edit term" };

export default async function TermPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.admin(v)) return <PNoAccessPage area="Pathshala terms" />;
  const supabase = v.db;
  const res = await load(async () => row(await supabase.from("pathshala_terms").select("*").eq("id", id).maybeSingle(), "the term"));
  if (!res.ok) return <LoadProblemPage message={res.error} />;
  const term = res.data;
  if (!term) notFound();
  const tz = v.center.time_zone;
  const days = classDaysInTerm(term.starts_on, term.ends_on, "sunday", term.no_class_dates);

  return (
    <>
      <PathshalaHeader title={term.name} description={`Pathshala term · ${term.status}`} back={{ href: "/pathshala/terms", label: "Terms" }} />
      <Card title="Summary" className="mb-4">
        <PDefinitionList
          items={[
            ["Dates", `${formatDate(term.starts_on)} – ${formatDate(term.ends_on)}`],
            ["Sunday classes", `${days.length} (after ${term.no_class_dates.length} no-class date${term.no_class_dates.length === 1 ? "" : "s"})`],
            ["Registration", `${formatDateTime(term.registration_opens_at, tz)} → ${formatDateTime(term.registration_closes_at, tz)}`],
            ["Fee per child", formatCents(term.fee_per_child_cents, { currency: v.center.currency })],
            ["Sibling discount", `${term.sibling_discount_pct}%`],
            ["Family cap", term.fee_per_family_cap_cents === null ? "None" : formatCents(term.fee_per_family_cap_cents, { currency: v.center.currency })],
            ["Membership required", term.membership_required ? "Yes" : "No"],
            ["Status", humanize(term.status)],
          ]}
        />
      </Card>
      {pathshalaAreas.manage(v) ? (
        <Card title="Edit term">
          <TermForm term={term} tz={tz} />
        </Card>
      ) : (
        <p className="text-sm text-muted">Only the Pathshala principal can edit terms.</p>
      )}
    </>
  );
}
