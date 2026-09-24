import type { Metadata } from "next";
import Link from "next/link";

import { AuditLogTable } from "@/components/audit-log-table";
import {
  Card,
  ChipLinks,
  NoAccess,
  PageHeader,
  Pagination,
  QueryError,
  buttonClass,
} from "@/components/ui";
import {
  AUDIT_MODULES,
  isAuditModule,
  MODULE_TABLES,
} from "@/lib/audit-labels";
import { userNames } from "@/lib/data/lookups";
import { startOfDayInTz, addDays } from "@/lib/dates";
import { can, canAccess, isGrantActive } from "@/lib/permissions";
import {
  hrefWith,
  pageParam,
  param,
  safeFilterText,
  type RawSearchParams,
} from "@/lib/search-params";
import { getSession } from "@/lib/session";

export const metadata: Metadata = { title: "Audit log · Settings" };

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

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Settings"
      description="Append-only, tamper-evident log · every change to sensitive records appears here · dates of birth, card references and secrets are masked"
      actions={
        <button
          type="button"
          disabled
          className={buttonClass("off")}
          title="Exporting needs a data.export entitlement, a fresh sign-in code and a watermarked file. None of these exist yet, so export is switched off."
        >
          Export log
        </button>
      }
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
  const moduleParam = param(sp, "module");
  const mod = isAuditModule(moduleParam) ? moduleParam : null;
  const validDate = (d?: string) =>
    d && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : undefined;

  let query = db
    .from("audit_log")
    .select(
      "id, occurred_at, actor_user_id, action, record_table, record_id, before, after, reason, hash",
      { count: "exact" },
    )
    .eq("center_id", center.id);
  if (action) query = query.ilike("action", `%${safeFilterText(action)}%`);
  if (table && TABLES.includes(table)) query = query.eq("record_table", table);
  if (mod)
    query =
      MODULE_TABLES[mod].length > 0
        ? query.in("record_table", MODULE_TABLES[mod])
        : query.eq("record_table", "__none__");
  if (record) query = query.eq("record_id", record.trim());
  if (validDate(fromDate))
    query = query.gte("occurred_at", startOfDayInTz(fromDate!, tz));
  if (validDate(toDate))
    query = query.lt("occurred_at", startOfDayInTz(addDays(toDate!, 1), tz));
  const from = (page - 1) * PAGE_SIZE;
  const res = await query
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];
  const actors = await userNames(
    db,
    center.id,
    rows.map((r) => r.actor_user_id),
  );

  // ROLE column: the actor's current center-wide roles. Reading other people's
  // grants needs roles.manage (RLS), so without it the column says so.
  let roles: Map<string, string> | null = null;
  let rolesNote: string | null = null;
  const actorIds = [
    ...new Set(
      rows.map((r) => r.actor_user_id).filter((x): x is string => Boolean(x)),
    ),
  ];
  if (!can(session, "roles.manage")) {
    rolesNote = "Roles show only to people who can manage roles.";
  } else if (actorIds.length > 0) {
    const [grants, roleRows] = await Promise.all([
      db
        .from("role_grants")
        .select("user_id, role_key, scope_kind, starts_at, ends_at")
        .eq("center_id", center.id)
        .in("user_id", actorIds),
      db.from("roles").select("key, name"),
    ]);
    if (grants.error || roleRows.error) {
      console.error(
        "[settings/audit] could not load actor roles:",
        grants.error ?? roleRows.error,
      );
      rolesNote = "Roles could not be loaded — reload to try again.";
    } else {
      const names = new Map((roleRows.data ?? []).map((r) => [r.key, r.name]));
      roles = new Map();
      for (const g of grants.data ?? []) {
        if (
          !isGrantActive(g) ||
          (g.scope_kind !== "center" && g.scope_kind !== "platform")
        )
          continue;
        const name = names.get(g.role_key) ?? g.role_key;
        roles.set(
          g.user_id,
          roles.has(g.user_id) ? `${roles.get(g.user_id)}, ${name}` : name,
        );
      }
    }
  }

  return (
    <>
      {header}
      <ChipLinks
        label="Module"
        active={mod ?? "all"}
        items={AUDIT_MODULES.map((m) => ({
          key: m.key,
          label: m.label,
          href: hrefWith("/settings/audit", sp, {
            module: m.key === "all" ? undefined : m.key,
            page: undefined,
          }),
        }))}
      />
      <details
        className="mb-3"
        open={Boolean(action || table || record || fromDate || toDate)}
      >
        <summary className="cursor-pointer text-[13px] font-bold text-navy">
          More filters
        </summary>
        <form
          method="get"
          action="/settings/audit"
          className="mb-4 mt-3 flex flex-wrap items-end gap-3"
        >
          {mod ? <input type="hidden" name="module" value={mod} /> : null}
          <div>
            <label htmlFor="action" className="crm-label">
              Action contains
            </label>
            <input
              id="action"
              name="action"
              defaultValue={action ?? ""}
              placeholder="e.g. payments.insert, role"
              className="crm-input min-w-56"
            />
          </div>
          <div>
            <label htmlFor="table" className="crm-label">
              Table
            </label>
            <select
              id="table"
              name="table"
              defaultValue={table ?? ""}
              className="crm-input min-w-52"
            >
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
            <input
              id="record"
              name="record"
              defaultValue={record ?? ""}
              placeholder="full id"
              className="crm-input min-w-72 font-mono"
            />
          </div>
          <div>
            <label htmlFor="from" className="crm-label">
              From
            </label>
            <input
              id="from"
              name="from"
              type="date"
              defaultValue={fromDate ?? ""}
              className="crm-input"
            />
          </div>
          <div>
            <label htmlFor="to" className="crm-label">
              To
            </label>
            <input
              id="to"
              name="to"
              type="date"
              defaultValue={toDate ?? ""}
              className="crm-input"
            />
          </div>
          <button type="submit" className={buttonClass("primary")}>
            Filter
          </button>
          {action || table || record || fromDate || toDate ? (
            <Link href="/settings/audit" className={buttonClass("ghost")}>
              Clear
            </Link>
          ) : null}
        </form>
      </details>
      {res.error ? (
        <QueryError
          what="the audit log"
          error={res.error}
          retryHref={hrefWith("/settings/audit", sp, {})}
        />
      ) : (
        <Card padded={false}>
          <AuditLogTable
            rows={rows}
            timeZone={tz}
            actors={actors}
            roles={roles}
          />
          {rolesNote ? (
            <p className="px-2.5 pt-2 text-[12px] text-muted">{rolesNote}</p>
          ) : null}
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={res.count ?? null}
            hrefFor={(n) => hrefWith("/settings/audit", sp, { page: n })}
          />
        </Card>
      )}
    </>
  );
}
