import type { Metadata } from "next";
import Link from "next/link";

import { Card, EmptyState, TableWrap } from "@/components/ui";
import { loadTerms } from "@/lib/data/pathshala";
import { explainError } from "@/lib/errors";
import { pathshalaAreas } from "@/lib/pathshala/access";
import { formatDate, formatDateTime, humanize } from "@/lib/pathshala/format";
import { load, rows, viewerOf } from "@/lib/pathshala/server";
import { loadLevelFees, loadLevelRows, loadTermRules, NEEDS_UPDATE } from "@/lib/pathshala-registration/db";
import { PAYMENT_MODE_LABEL } from "@/lib/pathshala-registration/rules";
import { getSession } from "@/lib/session";

import { DrawerButton } from "../drawer-button";
import { LoadProblemPage, Notice, PathshalaHeader, PBadge, PNoAccessPage } from "../ui";
import { TermForm } from "./term-form";

export const metadata: Metadata = { title: "Pathshala terms" };

const statusTone = { draft: "muted", registration: "navy", active: "success", closed: "neutral" } as const;

export default async function TermsPage() {
  const v = viewerOf(await getSession());
  if (!pathshalaAreas.fees(v)) return <PNoAccessPage area="Pathshala terms (pathshala.view, pathshala.manage or giving.manage)" />;
  const supabase = v.db;
  const res = await load(async () => {
    const terms = await loadTerms(supabase, v.center.id);
    const [classes, rules, fees, levels] = await Promise.all([
      supabase.from("pathshala_classes").select("term_id, level_id").eq("center_id", v.center.id).then((r) => rows(r, "the classes")),
      loadTermRules(supabase, terms.map((t) => t.id)),
      loadLevelFees(supabase, v.center.id),
      loadLevelRows(supabase, v.center.id),
    ]);
    return { terms, classes, rules, fees, levels };
  });
  if (!res.ok) return <LoadProblemPage message={res.error} />;
  const { terms, classes, rules, fees, levels } = res.data;
  const canEdit = pathshalaAreas.manage(v);
  const tz = v.center.time_zone;

  // Fees per level and the payment mode come with 0590: before it, or when they cannot be read, say so above the table.
  const reads = [rules, fees, levels];
  const firstError = reads.find((r) => r.status === "error");
  const feesNote = reads.some((r) => r.status === "missing")
    ? NEEDS_UPDATE
    : firstError && firstError.status === "error"
      ? `The terms' fees and rules could not be loaded — ${explainError(firstError.error)}.`
      : reads.some((r) => r.status === "shape")
        ? "The terms' fees and rules could not be read. Has the latest migration been applied?"
        : null;
  // Offered, as 0590 counts it: an active level with a class in the term.
  const active = new Set(levels.status === "ok" ? levels.value.filter((l) => l.active).map((l) => l.id) : []);
  const feeSummary = (termId: string) => {
    if (rules.status !== "ok" || fees.status !== "ok" || levels.status !== "ok") return <span className="text-muted">—</span>;
    const offered = new Set(classes.filter((c) => c.term_id === termId && active.has(c.level_id)).map((c) => c.level_id));
    const priced = new Set(fees.value.filter((f) => f.term_id === termId).map((f) => f.level_id));
    const pricedOffered = [...offered].filter((l) => priced.has(l)).length;
    const r = rules.value.get(termId);
    return (
      <>
        {r ? PAYMENT_MODE_LABEL[r.payment_mode] : "—"}
        <div className={`text-xs ${offered.size && pricedOffered < offered.size ? "font-bold text-danger" : "text-muted"}`}>
          {offered.size ? `${pricedOffered} of ${offered.size} offered level${offered.size === 1 ? "" : "s"} priced` : "No classes yet"}
          {r && !r.fees_locked_at ? " · not locked yet" : ""}
        </div>
      </>
    );
  };

  return (
    <>
      <PathshalaHeader
        description="Terms · dates, registration window and no-class days for each Pathshala year; each term's fees and registration rules on its Fees and rules page"
        actions={
          canEdit ? (
            <DrawerButton label="New term" title="New term" kicker="Pathshala" size="sm">
              <TermForm term={null} tz={tz} cols={1} />
            </DrawerButton>
          ) : null
        }
      />
      {feesNote ? (
        <div className="mb-4">
          <Notice tone={reads.some((r) => r.status === "missing") ? "warning" : "danger"}>{feesNote}</Notice>
        </div>
      ) : null}
      {pathshalaAreas.admin(v) ? null : (
        // The treasurer's view (giving.manage only): RLS shows the terms that have opened, not the principal's drafts.
        <p className="mb-3 text-[13px] text-muted">
          You see the terms that have left Draft: once registration opens their fees and rules are yours to change, with a reason. Draft terms are seen
          by Pathshala staff only.
        </p>
      )}
      <Card title={pathshalaAreas.admin(v) ? "All terms" : "Terms open for registration or running"} padded={false}>
        {terms.length === 0 ? (
          <EmptyState title={pathshalaAreas.admin(v) ? "No terms yet" : "No term has opened registration yet"}>
            {canEdit ? "Create one with New term." : pathshalaAreas.admin(v) ? "The principal hasn't set one up yet." : ""}
          </EmptyState>
        ) : (
          <TableWrap>
            <table className="crm-table crm-table-first-bold min-w-[820px]">
              <thead>
                <tr>
                  <th>Term</th>
                  <th>Dates</th>
                  <th>Registration</th>
                  <th>Fees</th>
                  <th>No class</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {terms.map((t) => (
                  <tr key={t.id}>
                    <td>
                      <Link className="crm-link font-semibold" href={`/pathshala/terms/${t.id}`}>
                        {t.name}
                      </Link>
                    </td>
                    <td>
                      {formatDate(t.starts_on, tz)} – {formatDate(t.ends_on, tz)}
                    </td>
                    <td>
                      {t.registration_opens_at ? formatDateTime(t.registration_opens_at, tz) : "—"}
                      <br />
                      <span className="text-muted">to {t.registration_closes_at ? formatDateTime(t.registration_closes_at, tz) : "—"}</span>
                    </td>
                    <td>
                      {feeSummary(t.id)}
                      <Link className="crm-link text-xs font-semibold" href={`/pathshala/terms/${t.id}/fees`}>
                        Fees and rules
                      </Link>
                    </td>
                    <td>{t.no_class_dates.length}</td>
                    <td>
                      <PBadge tone={statusTone[t.status as keyof typeof statusTone] ?? "neutral"}>{humanize(t.status)}</PBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </>
  );
}
