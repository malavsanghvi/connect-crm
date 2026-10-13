import Link from "next/link";

import { StatementsView } from "@/components/giving-statements/statements-view";
import { BlockGrid, NoAccess } from "@/components/ui";
import { isPlainObject } from "@/lib/center-rules";
import { householdsById } from "@/lib/data/lookups";
import { loadStatements } from "@/lib/data/giving-statements";
import { formatDateTime } from "@/lib/dates";
import { failure } from "@/lib/errors";
import { RECEIPT_KINDS } from "@/lib/giving";
import { isModuleEnabled } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import type { RawSearchParams } from "@/lib/search-params";
import { parseApprovalStatus } from "@/lib/setup";
import { getSession, type CrmSession } from "@/lib/session";

import { approveStatementTemplatesAction } from "../../setup/approval-actions";
import { ApprovalCard } from "../../setup/_components/approval-card";
import { ReceiptTemplateEditor, type TemplateValues } from "./template-editor";

const ISSUED_SHOWN = 20;

/** The receipt wording and the treasurer's approval, exactly as the classic page draws them. */
async function TemplatesAndApproval({ session, currentYear }: { session: CrmSession; currentYear: number }) {
  const { db, center } = session;
  const tz = center.time_zone;
  const showApproval = canAccess(session, "receiptTemplates") || canAccess(session, "setup");
  const [templates, approval] = await Promise.all([
    db.from("receipt_templates").select("kind, signed_by, personal_note, updated_at").eq("center_id", center.id),
    showApproval ? db.rpc("golive_approval_status", { p_center: center.id }) : null,
  ]);
  const values = Object.fromEntries(
    RECEIPT_KINDS.map((k) => {
      const t = (templates.data ?? []).find((x) => x.kind === k.kind);
      return [k.kind, { signedBy: t?.signed_by ?? "", note: t?.personal_note ?? "", updated: t ? formatDateTime(t.updated_at, tz) : null }];
    }),
  ) as TemplateValues;
  const approvals = approval && !approval.error ? parseApprovalStatus(approval.data) : null;
  const branding = isPlainObject(center.branding) ? center.branding : {};
  const address = typeof branding.address === "string" ? branding.address : null;
  const problem = (what: string, error: unknown) => (
    <p role="alert" className="col-span-12 m-0 rounded-[14px] border border-[#f0b9b4] bg-danger-50 px-4 py-3 text-[14px] text-[#7a1a14]">
      {failure(what, error).error}{" "}
      <Link href="/giving/statements" className="font-bold underline">
        Try again
      </Link>
    </p>
  );
  return (
    <BlockGrid>
      {templates.error ? (
        problem("Could not read the receipt templates", templates.error)
      ) : (
        <ReceiptTemplateEditor
          values={values}
          canEdit={canAccess(session, "receiptTemplates")}
          centerName={center.name}
          centerAddress={address}
          year={currentYear}
          currency={center.currency}
          orgKind={session.kind}
        />
      )}
      {approval?.error ? (
        problem("Could not read the treasurer's approval of these templates", approval.error)
      ) : approvals ? (
        <ApprovalCard
          testId="approval-statement-templates"
          title="Treasurer's approval of the receipt and statement templates"
          what="The treasurer reviews the donation receipt, the pledge confirmation and the year-end statement as they are set above (signer and personal note, with the standard IRS wording) and approves them. Any later change needs a new approval."
          later="Readiness check 8. Statements and receipts built from an uploaded sample (with the compliance check) come in a later release; this approval covers today's templates."
          state={approvals.statements}
          canApprove={approvals.isTreasurer}
          whoMayApprove="Only the person with the Treasurer role can approve these."
          action={approveStatementTemplatesAction}
          timeZone={tz}
        />
      ) : null}
    </BlockGrid>
  );
}

/** The year's issued tax statements (the statements service writes them; nothing here issues one). */
async function IssuedStatements({ session, year }: { session: CrmSession; year: number }) {
  const { db, center } = session;
  const res = await db
    .from("statements")
    .select("id, household_id, generated_at, storage_path", { count: "exact" })
    .eq("center_id", center.id)
    .eq("kind", "tax_year")
    .eq("tax_year", year)
    .order("generated_at", { ascending: false })
    .range(0, ISSUED_SHOWN - 1);
  const households = res.error ? null : await householdsById(db, (res.data ?? []).map((r) => r.household_id));
  return (
    <section className="rounded-[18px] border border-line bg-white px-3.5 py-3.5 md:px-5" data-testid="statements-issued">
      <h2 className="m-0 font-display text-[22px] font-semibold text-ink">Issued statements for {year}</h2>
      {res.error ? (
        <p role="alert" className="m-0 mt-2 text-[14px] text-[#7a1a14]">
          {failure("Could not read the issued statements", res.error).error}{" "}
          <Link href={`/giving/statements?year=${year}`} className="font-bold underline">
            Try again
          </Link>
        </p>
      ) : (res.data ?? []).length === 0 ? (
        <p className="m-0 mt-2 text-[14px] text-muted">No statement for {year} has been issued yet.</p>
      ) : (
        <>
          <ul className="m-0 mt-2 list-none p-0">
            {(res.data ?? []).map((s) => {
              const h = households?.map.get(s.household_id);
              return (
                <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 border-t border-line py-2 first:border-t-0">
                  <Link href={`/households/${s.household_id}`} className="crm-link">
                    {h?.display_name ?? "Household"}
                    {h?.household_number ? <span className="ml-1.5 font-mono text-xs text-muted">{h.household_number}</span> : null}
                  </Link>
                  <span className="text-[13px] text-muted">
                    {formatDateTime(s.generated_at, center.time_zone)}
                    {s.storage_path ? "" : " · not stored"}
                  </span>
                </li>
              );
            })}
          </ul>
          {(res.count ?? 0) > ISSUED_SHOWN ? (
            <p className="m-0 mt-2 text-[13px] text-muted">
              The {ISSUED_SHOWN} latest of {(res.count ?? 0).toLocaleString("en-US")}. The classic look lists them all.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

/** Giving › Statements in the New look (docs/GIVING_REDESIGN.md section 4, slice 8). */
export async function StatementsV2({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  if (!canAccess(session, "statements")) return <NoAccess area="Statements" access="statements" />;
  const model = await loadStatements(session, await searchParams);
  return (
    <StatementsView model={model}>
      {isModuleEnabled(session, "giving_statements") ? <IssuedStatements session={session} year={model.year} /> : null}
      <TemplatesAndApproval session={session} currentYear={Number(model.today.slice(0, 4))} />
    </StatementsView>
  );
}
