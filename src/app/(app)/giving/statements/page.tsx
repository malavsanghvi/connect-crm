import type { Metadata } from "next";
import Link from "next/link";

import { BlockGrid, Card, EmptyState, KpiGrid, NoAccess, PageHeader, Pagination, QueryError, Stat, TableWrap, buttonClass } from "@/components/ui";
import { isPlainObject } from "@/lib/center-rules";
import { chunk, fetchAll } from "@/lib/data/fetch-all";
import { householdsById, userNames } from "@/lib/data/lookups";
import { formatDateTime, todayInTz } from "@/lib/dates";
import { RECEIPT_KINDS } from "@/lib/giving";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { ReceiptTemplateEditor, type TemplateValues } from "./template-editor";

export const metadata: Metadata = { title: "Receipts & statements" };

const PAGE_SIZE = 50;
const KIND_LABEL: Record<string, string> = { tax_year: "Tax-year statement", pledge: "Pledge statement", donation: "Donation receipt", event: "Event statement" };

export default async function StatementsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = <PageHeader title="Giving" description="Tax, pledge and donation receipts use the standard format with light personalization" />;
  if (!canAccess(session, "statements")) {
    return (
      <>
        {header}
        <NoAccess area="Statements" access="statements" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const tz = center.time_zone;
  const currentYear = Number(todayInTz(tz).slice(0, 4));
  const yearParam = Number(param(sp, "year"));
  const year = Number.isInteger(yearParam) && yearParam > 1990 ? yearParam : null;
  const kind = param(sp, "kind");
  const page = pageParam(sp);

  let q = db
    .from("statements")
    .select("id, household_id, kind, tax_year, storage_path, generated_at, generated_by", { count: "exact" })
    .eq("center_id", center.id);
  if (year) q = q.eq("tax_year", year);
  if (kind && kind in KIND_LABEL) q = q.eq("kind", kind);
  const from = (page - 1) * PAGE_SIZE;
  const res = await q.order("generated_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];
  const [households, generators] = await Promise.all([
    householdsById(db, rows.map((r) => r.household_id)),
    userNames(db, center.id, rows.map((r) => r.generated_by)),
  ]);

  // Year-end KPIs for the last full year.
  const lastYear = currentYear - 1;
  const [gifts, issued, templates] = await Promise.all([
    fetchAll((f, t) =>
      db
        .from("payments")
        .select("id, household_id")
        .eq("center_id", center.id)
        .gte("received_on", `${lastYear}-01-01`)
        .lte("received_on", `${lastYear}-12-31`)
        .not("status", "in", "(failed,voided,authorized)")
        .order("id")
        .range(f, t),
    ),
    fetchAll((f, t) =>
      db.from("statements").select("id, household_id").eq("center_id", center.id).eq("kind", "tax_year").eq("tax_year", lastYear).order("id").range(f, t),
    ),
    db.from("receipt_templates").select("kind, signed_by, personal_note, updated_at").eq("center_id", center.id),
  ]);
  const giftIds = [...new Set(gifts.data.map((g) => g.household_id))];
  const giftHouseholds = giftIds.length;
  // Households that asked for paper (households.physical_mail_opt_in); needs people.view.
  let paper: number | null = 0;
  for (const part of chunk(giftIds)) {
    const r = await db.from("households").select("id").in("id", part).eq("physical_mail_opt_in", true);
    if (r.error) {
      console.error("[statements] paper-mail count failed:", r.error);
      paper = null;
      break;
    }
    paper += (r.data ?? []).length;
  }
  const issuedHouseholds = new Set(issued.data.map((g) => g.household_id)).size;
  const reissued = issued.data.length - issuedHouseholds;
  const values = Object.fromEntries(
    RECEIPT_KINDS.map((k) => {
      const t = (templates.data ?? []).find((x) => x.kind === k.kind);
      return [k.kind, { signedBy: t?.signed_by ?? "", note: t?.personal_note ?? "", updated: t ? formatDateTime(t.updated_at, tz) : null }];
    }),
  ) as TemplateValues;
  const branding = isPlainObject(center.branding) ? center.branding : {};
  const address = typeof branding.address === "string" ? branding.address : null;

  return (
    <>
      {header}
      <BlockGrid className="mb-4">
        <Card
          span={12}
          title={`Year-end statements · ${lastYear}`}
          actions={
            canAccess(session, "receiptTemplates") ? (
              <button
                type="button"
                disabled
                title="Statement generation runs in the statements service (a backend job) that the console cannot start yet"
                className={buttonClass("off", "sm")}
              >
                Generate and send {currentYear} statements
              </button>
            ) : null
          }
        >
          {gifts.error || issued.error ? (
            <QueryError what="the year-end figures" error={gifts.error ?? issued.error} retryHref="/giving/statements" />
          ) : (
            <KpiGrid cols={4}>
              <Stat label="Households with gifts" value={giftHouseholds.toLocaleString()} hint={String(lastYear)} tone="navy" />
              <Stat label="Statements issued" value={issuedHouseholds.toLocaleString()} hint="email and in app" tone="success" />
              <Stat
                label="Mailed on paper"
                value={paper === null ? "—" : paper.toLocaleString()}
                hint={paper === null ? "needs people.view" : "opted in to physical mail"}
                tone="brown"
              />
              <Stat label="Reissued on request" value={Math.max(0, reissued).toLocaleString()} hint="more than one statement for a household" tone="purple" />
            </KpiGrid>
          )}
          <p className="mt-2 text-xs text-muted">
            Generating and sending statements runs in the statements service (a backend job), which is not connected to the console yet — the
            button stays off until it is.
          </p>
        </Card>
        {templates.error ? (
          <div className="col-span-12">
            <QueryError what="receipt templates" error={templates.error} retryHref="/giving/statements" />
          </div>
        ) : (
          <ReceiptTemplateEditor
            values={values}
            canEdit={canAccess(session, "receiptTemplates")}
            centerName={center.name}
            centerAddress={address}
            year={currentYear}
            currency={center.currency}
          />
        )}
      </BlockGrid>
      <h2 className="cc-card-title mb-2">Issued statements</h2>
      <form method="get" action="/giving/statements" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="year" className="crm-label">
            Tax year
          </label>
          <select id="year" name="year" defaultValue={year ? String(year) : ""} className="crm-input min-w-32">
            <option value="">All years</option>
            {Array.from({ length: 8 }, (_, i) => currentYear - i).map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="kind" className="crm-label">
            Kind
          </label>
          <select id="kind" name="kind" defaultValue={kind ?? ""} className="crm-input min-w-52">
            <option value="">All kinds</option>
            {Object.entries(KIND_LABEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Apply
        </button>
      </form>
      {res.error ? (
        <QueryError what="statements" error={res.error} retryHref={hrefWith("/giving/statements", sp, {})} />
      ) : (
        <Card padded={false}>
          {rows.length === 0 ? (
            <EmptyState title="No statements issued yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Household</th>
                    <th>Kind</th>
                    <th>Tax year</th>
                    <th>Generated</th>
                    <th>File</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((s) => {
                    const h = households.map.get(s.household_id);
                    return (
                      <tr key={s.id}>
                        <td>
                          <Link href={`/households/${s.household_id}`} className="crm-link">
                            {h?.display_name ?? "Household"}
                          </Link>
                          <div className="font-mono text-xs text-muted">{h?.household_number ?? ""}</div>
                        </td>
                        <td>{KIND_LABEL[s.kind] ?? s.kind}</td>
                        <td>{s.tax_year ?? "—"}</td>
                        <td>
                          {formatDateTime(s.generated_at, tz)}
                          <div className="text-xs text-muted">{s.generated_by ? (generators.get(s.generated_by)?.name ?? "staff") : "automatic"}</div>
                        </td>
                        <td className="font-mono text-xs">{s.storage_path ?? <span className="font-sans text-muted">Not stored</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/giving/statements", sp, { page: n })} />
        </Card>
      )}
    </>
  );
}
