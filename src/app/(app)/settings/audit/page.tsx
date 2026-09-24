import type { Metadata } from "next";
import Link from "next/link";

import { AuditTable } from "@/components/audit-table";
import { Card, NoAccess, PageHeader, Pagination, QueryError, buttonClass } from "@/components/ui";
import { userNames } from "@/lib/data/lookups";
import { startOfDayInTz, addDays } from "@/lib/dates";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, safeFilterText, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Audit log" };

const PAGE_SIZE = 50;
const TABLES = [
  "households",
  "people",
  "household_members",
  "external_ids",
  "memberships",
  "membership_applications",
  "eligibility_snapshots",
  "role_grants",
  "pledges",
  "payments",
  "payment_allocations",
  "recurring_gifts",
  "ledger_postings",
  "qbo_account_mappings",
  "integration_connections",
  "accounting_periods",
  "data_requests",
  "centers",
  "bolis",
  "boli_entries",
  "counting_sessions",
  "store_orders",
  "content_items",
  "comms_campaigns",
];

export default async function AuditPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Audit log"
      description="Every change to sensitive records, append-only and hash-chained. Dates of birth, card references and secrets are masked."
    />
  );
  if (!canAccess(session, "audit")) {
    return (
      <>
        {header}
        <NoAccess area="The audit log" access="audit" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const tz = center.time_zone;
  const action = param(sp, "action");
  const table = param(sp, "table");
  const record = param(sp, "record");
  const fromDate = param(sp, "from");
  const toDate = param(sp, "to");
  const page = pageParam(sp);
  const validDate = (d?: string) => (d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined);

  let query = db
    .from("audit_log")
    .select("id, occurred_at, actor_user_id, action, record_table, record_id, before, after, reason, hash", { count: "exact" })
    .eq("center_id", center.id);
  if (action) query = query.ilike("action", `%${safeFilterText(action)}%`);
  if (table && TABLES.includes(table)) query = query.eq("record_table", table);
  if (record) query = query.eq("record_id", record.trim());
  if (validDate(fromDate)) query = query.gte("occurred_at", startOfDayInTz(fromDate!, tz));
  if (validDate(toDate)) query = query.lt("occurred_at", startOfDayInTz(addDays(toDate!, 1), tz));
  const from = (page - 1) * PAGE_SIZE;
  const res = await query.order("occurred_at", { ascending: false }).order("id", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];
  const actors = await userNames(db, center.id, rows.map((r) => r.actor_user_id));

  return (
    <>
      {header}
      <form method="get" action="/audit" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="action" className="crm-label">
            Action contains
          </label>
          <input id="action" name="action" defaultValue={action ?? ""} placeholder="e.g. payments.insert, role" className="crm-input min-w-56" />
        </div>
        <div>
          <label htmlFor="table" className="crm-label">
            Table
          </label>
          <select id="table" name="table" defaultValue={table ?? ""} className="crm-input min-w-52">
            <option value="">Any table</option>
            {TABLES.map((t) => (
              <option key={t} value={t}>
                {t.replace(/_/g, " ")}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="record" className="crm-label">
            Record id
          </label>
          <input id="record" name="record" defaultValue={record ?? ""} placeholder="full id" className="crm-input min-w-72 font-mono" />
        </div>
        <div>
          <label htmlFor="from" className="crm-label">
            From
          </label>
          <input id="from" name="from" type="date" defaultValue={fromDate ?? ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor="to" className="crm-label">
            To
          </label>
          <input id="to" name="to" type="date" defaultValue={toDate ?? ""} className="crm-input" />
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Filter
        </button>
        {action || table || record || fromDate || toDate ? (
          <Link href="/audit" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>
      {res.error ? (
        <QueryError what="the audit log" error={res.error} retryHref={hrefWith("/audit", sp, {})} />
      ) : (
        <Card padded={false}>
          <AuditTable rows={rows} timeZone={tz} actors={actors} />
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/audit", sp, { page: n })} />
        </Card>
      )}
    </>
  );
}
