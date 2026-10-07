import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { Card, buttonClass } from "@/components/ui";
import { explainError } from "@/lib/errors";
import { classDaysInTerm } from "@/lib/logic/attendance";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDate, formatDateTime } from "@/lib/pathshala/format";
import { load, row, viewerOf } from "@/lib/pathshala/server";
import { loadTermRules, NEEDS_UPDATE } from "@/lib/pathshala-registration/db";
import { formatMoney } from "@/lib/pathshala-registration/money";
import { PAYMENT_MODE_LABEL, SEAT_RULE_LABEL, termStatusLabel } from "@/lib/pathshala-registration/rules";
import { getSession } from "@/lib/session";

import { LoadProblemPage, Notice, PathshalaHeader, PDefinitionList, PNoAccessPage } from "../../ui";
import { TermForm } from "../term-form";

export const metadata: Metadata = { title: "Edit term" };

export default async function TermPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.fees(v)) return <PNoAccessPage area="Pathshala terms (pathshala.view, pathshala.manage or giving.manage)" />;
  const supabase = v.db;
  const res = await load(async () => {
    const term = row(await supabase.from("pathshala_terms").select("*").eq("id", id).maybeSingle(), "the term");
    return { term, rules: term ? await loadTermRules(supabase, [term.id]) : null };
  });
  if (!res.ok) return <LoadProblemPage message={res.error} />;
  const { term, rules } = res.data;
  if (!term) {
    // The treasurer reads a term once registration opens; a draft is the principal's (RLS shows them nothing).
    if (!pathshalaAreas.admin(v)) {
      return (
        <PNoAccessPage area="Pathshala terms (pathshala.view, pathshala.manage or giving.manage)">
          This term is not open for registration yet: while it is a draft it is the Pathshala principal&apos;s (pathshala.view or pathshala.manage).
          The treasurer sees it here once registration opens.
        </PNoAccessPage>
      );
    }
    notFound();
  }
  const tz = v.center.time_zone;
  const currency = v.center.currency;
  const days = classDaysInTerm(term.starts_on, term.ends_on, "sunday", term.no_class_dates);
  const r = rules?.status === "ok" ? (rules.value.get(term.id) ?? null) : null;
  // The rules arrive with 0590; until then (or when they cannot be read) the summary says so instead of guessing.
  const rulesNote =
    rules?.status === "missing" ? NEEDS_UPDATE : rules?.status === "error" ? `The term's fee rules could not be loaded — ${explainError(rules.error)}.` : rules?.status === "shape" ? "The term's fee rules could not be read." : null;

  return (
    <>
      <PathshalaHeader
        title={term.name}
        description={`Pathshala term · ${termStatusLabel(term.status)}`}
        back={{ href: "/pathshala/terms", label: "Terms" }}
        actions={
          <Link href={`/pathshala/terms/${term.id}/fees`} className={buttonClass("primary", "sm")}>
            Fees and rules
          </Link>
        }
      />
      {rulesNote ? (
        <div className="mb-4">
          <Notice tone={rules?.status === "missing" ? "warning" : "danger"}>{rulesNote}</Notice>
        </div>
      ) : null}
      <Card title="Summary" className="mb-4">
        <PDefinitionList
          items={[
            ["Dates", `${formatDate(term.starts_on)} – ${formatDate(term.ends_on)}`],
            ["Sunday classes", `${days.length} (after ${term.no_class_dates.length} no-class date${term.no_class_dates.length === 1 ? "" : "s"})`],
            ["Registration", `${formatDateTime(term.registration_opens_at, tz)} → ${formatDateTime(term.registration_closes_at, tz)}`],
            ["Late registration", r ? (r.late_registration_closes_at ? `Until ${formatDateTime(r.late_registration_closes_at, tz)} · ${formatMoney(r.late_fee_cents, currency)} per learner` : "None") : "—"],
            ["How families pay", r ? PAYMENT_MODE_LABEL[r.payment_mode] : "—"],
            ["Seats", r ? SEAT_RULE_LABEL[r.seat_rule] : "—"],
            ["Fees", "A fee per level, on the Fees and rules page"],
            ["Sibling discount", `${term.sibling_discount_pct}%`],
            ["Family cap", term.fee_per_family_cap_cents === null ? "None" : formatMoney(term.fee_per_family_cap_cents, currency)],
            ["Membership required", term.membership_required ? "Yes" : "No"],
            ["Status", termStatusLabel(term.status)],
            ["Fees and rules", r ? (r.fees_locked_at ? `Locked ${formatDate(r.fees_locked_at, tz)}` : term.status === "draft" ? "Open to change (draft)" : "Not locked (opened before fees per level)") : "—"],
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
