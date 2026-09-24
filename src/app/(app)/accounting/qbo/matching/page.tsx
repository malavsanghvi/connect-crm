import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { HouseholdCard, type CardLabels } from "@/components/household-card";
import {
  Alert,
  Badge,
  Card,
  EmptyState,
  FilterBar,
  KpiGrid,
  NoAccess,
  PageHeader,
  Pagination,
  QueryError,
  Stat,
  StatusText,
  TableWrap,
  Tabs,
  buttonClass,
} from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { householdCards, householdsById, userNames } from "@/lib/data/lookups";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import {
  LEVEL_LABEL,
  MATCH_TABS,
  TXN_LABEL,
  addressLine,
  confidencePct,
  confidenceTone,
  isMatchTab,
  landingText,
  methodLabel,
  readEvidence,
  type MatchTab,
} from "@/lib/qbo-match";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession, type CrmSession } from "@/lib/session";

import {
  askAiAction,
  bulkApproveAction,
  createHouseholdAction,
  decideMatchAction,
  pullNowAction,
  retryAction,
  saveSettingsAction,
  suggestAgainAction,
  unmapAction,
} from "./actions";
import { MapCustomerButton } from "./map-drawer";

export const metadata: Metadata = { title: "QuickBooks donor matching" };

const PAGE = 50;

type Overview = {
  customers: number;
  approved: number;
  suggested: number;
  not_mapped: number;
  open_mapped_cents: number;
  open_unmapped_cents: number;
  connection: { status: string; display_name: string | null; realm_id: string | null; pulled_at: string | null; level: string | null; history_years: string } | null;
  suggested_level: string | null;
  family_like: number;
  transactions: { brought_in: number; needs_review: number; pending: number; skipped: number };
  ai: { live: boolean; configured: boolean; reason?: string | null };
  jobs: Record<string, { status: string; error: string | null; finished_at: string | null; created_at: string; result: unknown } | null> | null;
  bring_in_waiting: number;
};

type Customer = {
  qbo_id: string;
  display_name: string;
  company_name: string | null;
  emails: string[];
  phones: string[];
  address: unknown;
  open_balance_cents: number;
  is_sub_customer: boolean;
  parent_qbo_id: string | null;
};

const REASON_FIELD = (id: string, placeholder = "Reason (kept in the audit log)") => (
  <input name="reason" aria-label="Reason" required placeholder={placeholder} className="crm-input min-w-[14rem] flex-1" id={id} />
);

export default async function DonorMatchingPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Accounting"
      description="QuickBooks donor matching · link every QuickBooks customer to a household, then bring its history in"
    />
  );
  if (!canAccess(session, "qboMatch")) {
    return (
      <>
        {header}
        <NoAccess area="QuickBooks donor matching" access="qboMatch" />
      </>
    );
  }
  const sp = await searchParams;
  const tabParam = param(sp, "tab");
  const tab: MatchTab = isMatchTab(tabParam) ? tabParam : "suggested";
  const page = pageParam(sp);
  const q = (param(sp, "q") ?? "").trim().slice(0, 80);
  const { db, center } = session;
  const tz = center.time_zone;
  const canManage = canAccess(session, "qboMatchManage");
  const retry = hrefWith("/accounting/qbo/matching", sp, {});
  const rules = identifierRules(center.rules);
  const labels: CardLabels = { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel };

  const ov = await db.rpc("qbo_match_overview", { p_center: center.id });
  if (ov.error) {
    return (
      <>
        {header}
        <QueryError what="the QuickBooks matching overview" error={ov.error} retryHref={retry} />
      </>
    );
  }
  const o = ov.data as unknown as Overview;
  const conn = o.connection;
  const connected = conn !== null && ["connected", "expiring"].includes(conn.status);
  const pullJob = o.jobs?.["qbo.pull_customers_history"] ?? null;
  const aiJob = o.jobs?.["qbo.match_suggest_ai"] ?? null;
  const level = conn?.level ?? null;

  return (
    <>
      {header}

      {!connected ? (
        <Alert tone="warning" title="Connect QuickBooks first">
          Donor matching reads your QuickBooks customers and their history.{" "}
          <Link href="/accounting/qbo" className="crm-link font-semibold">
            Connect QuickBooks
          </Link>{" "}
          on the QuickBooks screen{conn ? ` (the connection is ${conn.status})` : ""}; the customers are pulled right after it connects.
          {o.customers > 0 ? " The customers pulled earlier are still shown below." : ""}
        </Alert>
      ) : null}

      <div className="mb-4 mt-2">
        <KpiGrid cols={5}>
          <Stat label="QuickBooks customers" value={o.customers.toLocaleString()} hint={conn?.pulled_at ? `pulled ${formatDateTime(conn.pulled_at, tz)}` : "not pulled yet"} tone="navy" />
          <Stat label="Approved" value={o.approved.toLocaleString()} hint="mapped to a household" tone="success" href="/accounting/qbo/matching?tab=approved" />
          <Stat label="Suggested" value={o.suggested.toLocaleString()} hint="waiting for the treasury" tone="saffron" href="/accounting/qbo/matching?tab=suggested" />
          <Stat
            label="Not mapped yet"
            value={o.not_mapped.toLocaleString()}
            hint={`${formatCents(o.open_unmapped_cents, center.currency)} open · ${formatCents(o.open_mapped_cents, center.currency)} open mapped`}
            tone={o.not_mapped ? "danger" : "success"}
            href="/accounting/qbo/matching?tab=not_mapped"
          />
          <Stat
            label="History brought in"
            value={o.transactions.brought_in.toLocaleString()}
            hint={`${o.transactions.needs_review} need review · ${o.transactions.pending} waiting`}
            tone={o.transactions.needs_review ? "brown" : "success"}
            href="/accounting/qbo/matching?tab=review"
          />
        </KpiGrid>
      </div>

      <Card title="Pull and match" className="mb-4">
        <div className="flex flex-col gap-2 text-[13px]">
          <p>
            {pullJob ? (
              <>
                Last pull:{" "}
                <StatusText tone={pullJob.status === "failed" ? "bad" : pullJob.status === "done" ? "ok" : "warn"}>{pullJob.status}</StatusText>{" "}
                {formatDateTime(pullJob.finished_at ?? pullJob.created_at, tz)}
                {pullJob.status === "failed" && pullJob.error ? <span className="text-danger"> — {pullJob.error}</span> : null}
                {pullJob.status === "queued" || pullJob.status === "running" ? " — the background service is reading QuickBooks." : null}
              </>
            ) : (
              "QuickBooks customers have not been pulled yet."
            )}
          </p>
          <p>
            {!o.ai.live
              ? "The background service is not running, so pulls, AI suggestions and bringing history in wait until it runs. Matching by the rules still works here."
              : o.ai.configured
                ? "AI suggestions are on: customers the rules cannot settle are sent to the AI (names, city and ZIP and email domains only), and every AI proposal waits for your approval."
                : "AI suggestions are off: the background service has no ANTHROPIC_API_KEY. Matching by email, phone, QuickBooks ID, name and address and household name still works."}
            {aiJob?.status === "failed" && aiJob.error ? <span className="text-danger"> Last AI run failed — {aiJob.error}</span> : null}
          </p>
          {o.bring_in_waiting > 0 ? <p>History for {o.bring_in_waiting} customer(s) is waiting for the background service to bring it in.</p> : null}
          {canManage ? (
            <div className="flex flex-wrap gap-2">
              {connected ? <ActionForm action={pullNowAction} submitLabel="Pull from QuickBooks now" pendingLabel="Queuing…" variant="primary" size="sm" /> : null}
              <ActionForm action={suggestAgainAction} submitLabel="Find matches again" pendingLabel="Matching…" variant="ghost" size="sm" />
              {o.ai.live && o.ai.configured ? <ActionForm action={askAiAction} submitLabel="Ask AI about the rest" pendingLabel="Queuing…" variant="ghost" size="sm" /> : null}
            </div>
          ) : (
            <p className="text-muted">You can see the matches; approving them needs accounting.manage.</p>
          )}
        </div>
      </Card>

      {canManage && conn ? (
        <Card title="How QuickBooks keeps donors" className="mb-4">
          <ActionForm action={saveSettingsAction} submitLabel="Save" size="sm" variant="ghost" className="flex flex-col gap-2 text-[13px]">
            <p className="text-muted">
              {o.suggested_level
                ? `From the data: ${o.family_like} of ${o.customers} customers look like families — we suggest “${LEVEL_LABEL[o.suggested_level]}”.`
                : "Pull customers first to get a suggestion."}{" "}
              It only sets the default for new matches; each match can still be family- or person-level.
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <div>
                <label className="crm-label" htmlFor="qbo-level">
                  QuickBooks customers are
                </label>
                <select id="qbo-level" name="level" defaultValue={level ?? o.suggested_level ?? "mixed"} className="crm-input">
                  {Object.entries(LEVEL_LABEL).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="crm-label" htmlFor="qbo-years">
                  Years of history
                </label>
                <input id="qbo-years" name="history_years" type="number" min={1} max={25} defaultValue={conn.history_years ?? "7"} className="crm-input w-24" />
              </div>
              {REASON_FIELD("qbo-settings-reason")}
            </div>
          </ActionForm>
        </Card>
      ) : null}

      <Tabs active={tab} tabs={MATCH_TABS.map((t) => ({ key: t.key, label: t.label, href: `/accounting/qbo/matching?tab=${t.key}` }))} />

      {tab === "suggested" ? <SuggestedTab session={session} labels={labels} canManage={canManage} page={page} sp={sp} /> : null}
      {tab === "not_mapped" ? <NotMappedTab session={session} labels={labels} canManage={canManage} page={page} q={q} sp={sp} level={level} /> : null}
      {tab === "approved" ? <ApprovedTab session={session} labels={labels} canManage={canManage} page={page} sp={sp} /> : null}
      {tab === "rejected" ? <RejectedTab session={session} /> : null}
      {tab === "review" ? <ReviewTab session={session} canManage={canManage} /> : null}
    </>
  );
}

function QbSide({ c, evidence }: { c: Customer | undefined; evidence: ReturnType<typeof readEvidence> }) {
  const name = c?.display_name ?? evidence.qb.display_name ?? "—";
  const addr = c ? addressLine((c.address ?? {}) as Record<string, string>) : addressLine(evidence.qb.address);
  const emails = c?.emails ?? evidence.qb.emails;
  const phones = c?.phones ?? evidence.qb.phones;
  return (
    <div className="text-[13px]">
      <p className="font-bold">{name}</p>
      {c?.company_name && c.company_name !== name ? <p className="text-muted">{c.company_name}</p> : null}
      {emails.length ? <p>{emails.join(", ")}</p> : null}
      {phones.length ? <p>{phones.join(", ")}</p> : null}
      {addr ? <p className="text-muted">{addr}</p> : null}
      {c?.is_sub_customer ? <p className="text-muted">Sub-customer of {c.parent_qbo_id}</p> : null}
      <p className="font-mono text-[11px] text-faint">QuickBooks #{c?.qbo_id}</p>
    </div>
  );
}

async function loadCustomers(session: CrmSession, ids: string[]): Promise<{ map: Map<string, Customer>; error: unknown }> {
  const map = new Map<string, Customer>();
  if (ids.length === 0) return { map, error: null };
  const { data, error } = await session.db
    .from("qbo_customers")
    .select("qbo_id, display_name, company_name, emails, phones, address, open_balance_cents, is_sub_customer, parent_qbo_id")
    .eq("center_id", session.center.id)
    .in("qbo_id", ids);
  for (const c of data ?? []) map.set(c.qbo_id, c as Customer);
  return { map, error };
}

async function SuggestedTab({ session, labels, canManage, page, sp }: { session: CrmSession; labels: CardLabels; canManage: boolean; page: number; sp: RawSearchParams }) {
  const { db, center } = session;
  const retry = hrefWith("/accounting/qbo/matching", sp, {});
  const res = await db
    .from("qbo_customer_matches")
    .select("id, qbo_customer_id, household_id, person_id, confidence, method, evidence, suggested_at")
    .eq("center_id", center.id)
    .eq("status", "suggested")
    .order("confidence", { ascending: false })
    .limit(3000);
  if (res.error) return <QueryError what="the suggestions" error={res.error} retryHref={retry} />;
  const rows = res.data ?? [];
  const order: string[] = [];
  const byCustomer = new Map<string, typeof rows>();
  for (const r of rows) {
    if (!byCustomer.has(r.qbo_customer_id)) order.push(r.qbo_customer_id);
    byCustomer.set(r.qbo_customer_id, [...(byCustomer.get(r.qbo_customer_id) ?? []), r]);
  }
  const pageIds = order.slice((page - 1) * PAGE, page * PAGE);
  const shown = pageIds.flatMap((id) => byCustomer.get(id) ?? []);
  const [customers, cards] = await Promise.all([loadCustomers(session, pageIds), householdCards(db, shown.map((r) => r.household_id))]);

  return (
    <Card
      padded={false}
      title="Suggested matches"
      description="Each QuickBooks customer next to the household the evidence points to. Approve, pick another, or reject; nothing is ever approved on its own."
    >
      {canManage && order.length > 0 ? (
        <div className="border-b border-line p-3">
          <ActionForm
            action={bulkApproveAction}
            submitLabel="Approve all at or above"
            variant="ok"
            size="sm"
            className="flex flex-col gap-2"
            confirmMessage="Approve every suggestion at or above this confidence? Their QuickBooks history is brought in to the households."
          >
            <div className="flex flex-wrap items-end gap-2 text-[13px]">
              <div>
                <label className="crm-label" htmlFor="qbo-threshold">
                  Confidence (%)
                </label>
                <input id="qbo-threshold" name="threshold" type="number" min={50} max={100} defaultValue={95} className="crm-input w-24" />
              </div>
              {REASON_FIELD("qbo-bulk-reason", "Reason for the bulk approval")}
            </div>
            <p className="text-[12px] text-muted">Only each customer&apos;s best suggestion, and only when it is clearly ahead of the next one.</p>
          </ActionForm>
        </div>
      ) : null}
      {customers.error || cards.error ? (
        <div className="p-3">
          <QueryError what="the customers and households" error={customers.error ?? cards.error} retryHref={retry} />
        </div>
      ) : null}
      {order.length === 0 ? (
        <EmptyState title="No suggestions waiting">Pull QuickBooks customers, or look under Not mapped yet.</EmptyState>
      ) : (
        <TableWrap>
          <table className="crm-table" data-testid="qbo-suggested">
            <thead>
              <tr>
                <th>QuickBooks customer</th>
                <th>Community Connect household</th>
                <th>Evidence</th>
                <th className="num">Confidence</th>
                {canManage ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {pageIds.flatMap((cid) =>
                (byCustomer.get(cid) ?? []).map((m, i) => {
                  const ev = readEvidence(m.evidence);
                  const card = cards.map.get(m.household_id);
                  return (
                    <tr key={m.id} data-qbo={cid} data-match={m.id} className={i > 0 ? "bg-panel2/40" : ""}>
                      <td className="align-top">{i === 0 ? <QbSide c={customers.map.get(cid)} evidence={ev} /> : <span className="text-[12px] text-muted">…or another candidate</span>}</td>
                      <td className="min-w-[16rem] align-top">
                        {card ? (
                          <HouseholdCard card={card} labels={labels} timeZone={session.center.time_zone} currency={session.center.currency} href={`/households/${m.household_id}`} />
                        ) : (
                          <Link href={`/households/${m.household_id}`} className="crm-link">
                            {ev.cc.household ?? "Household"}
                          </Link>
                        )}
                        <p className="mt-1 text-[12px] text-muted">{landingText(m.person_id ? ev.cc.person : null, ev.cc.primary)}</p>
                      </td>
                      <td className="align-top text-[12px]">
                        <Badge tone={m.method === "ai" ? "purple" : "navy"}>{methodLabel(m.method)}</Badge>
                        <ul className="mt-1 flex flex-col gap-1">
                          {ev.signals.map((s, k) => (
                            <li key={k}>
                              <span className="font-semibold">{s.label}</span>
                              {s.qb || s.cc ? (
                                <span className="block">
                                  <mark className="rounded bg-saffron-50 px-1">{s.qb ?? "—"}</mark> ↔ <mark className="rounded bg-success-50 px-1">{s.cc ?? "—"}</mark>
                                </span>
                              ) : null}
                              {s.reason ? <span className="block text-muted">{s.reason}</span> : null}
                            </li>
                          ))}
                        </ul>
                      </td>
                      <td className="num align-top">
                        <StatusText tone={confidenceTone(m.confidence)}>{confidencePct(m.confidence)}</StatusText>
                      </td>
                      {canManage ? (
                        <td className="min-w-[18rem] align-top">
                          <ActionForm
                            action={decideMatchAction}
                            submitLabel="Approve"
                            variant="ok"
                            size="xs"
                            className="flex flex-col gap-1.5"
                            extraButtons={
                              <button type="submit" name="decision" value="reject" data-variant="bad" className={buttonClass("bad", "xs")}>
                                Reject
                              </button>
                            }
                          >
                            <input type="hidden" name="id" value={m.id} />
                            {REASON_FIELD(`qbo-reason-${m.id}`)}
                          </ActionForm>
                          {i === 0 ? (
                            <div className="mt-1.5">
                              <MapCustomerButton
                                qboId={cid}
                                qboName={customers.map.get(cid)?.display_name ?? ev.qb.display_name ?? cid}
                                summary="Pick another household"
                                label="Pick another household"
                                variant="ghost"
                                defaultLevel={ev.qb.family_like ? "family" : "person"}
                                labels={labels}
                                timeZone={session.center.time_zone}
                                currency={session.center.currency}
                              />
                            </div>
                          ) : null}
                        </td>
                      ) : null}
                    </tr>
                  );
                }),
              )}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pagination page={page} pageSize={PAGE} total={order.length} hrefFor={(p: number) => hrefWith("/accounting/qbo/matching", sp, { page: String(p) })} />
    </Card>
  );
}

async function NotMappedTab({
  session,
  labels,
  canManage,
  page,
  q,
  sp,
  level,
}: {
  session: CrmSession;
  labels: CardLabels;
  canManage: boolean;
  page: number;
  q: string;
  sp: RawSearchParams;
  level: string | null;
}) {
  const { db, center } = session;
  const retry = hrefWith("/accounting/qbo/matching", sp, {});
  const approved = await db.from("qbo_customer_matches").select("qbo_customer_id").eq("center_id", center.id).eq("status", "approved").limit(20000);
  if (approved.error) return <QueryError what="the approved matches" error={approved.error} retryHref={retry} />;
  const mapped = new Set((approved.data ?? []).map((r) => r.qbo_customer_id));
  let query = db
    .from("qbo_customers")
    .select("qbo_id, display_name, company_name, emails, phones, address, open_balance_cents, is_sub_customer, parent_qbo_id")
    .eq("center_id", center.id)
    .eq("active", true)
    .order("display_name")
    .limit(20000);
  if (q) query = query.ilike("display_name", `%${q.replace(/[%_]/g, "")}%`);
  const res = await query;
  if (res.error) return <QueryError what="the QuickBooks customers" error={res.error} retryHref={retry} />;
  const all = ((res.data ?? []) as Customer[]).filter((c) => !mapped.has(c.qbo_id));
  const rows = all.slice((page - 1) * PAGE, page * PAGE);
  const ids = rows.map((r) => r.qbo_id);
  const [txns, sugg] = await Promise.all([
    ids.length
      ? db.from("qbo_transactions").select("customer_qbo_id, qbo_type, total_cents").eq("center_id", center.id).in("customer_qbo_id", ids).in("qbo_type", ["SalesReceipt", "Payment"])
      : Promise.resolve({ data: [] as { customer_qbo_id: string | null; qbo_type: string; total_cents: number }[], error: null }),
    ids.length
      ? db.from("qbo_customer_matches").select("qbo_customer_id").eq("center_id", center.id).eq("status", "suggested").in("qbo_customer_id", ids)
      : Promise.resolve({ data: [] as { qbo_customer_id: string }[], error: null }),
  ]);
  const lifetime = new Map<string, number>();
  for (const t of txns.data ?? []) if (t.customer_qbo_id) lifetime.set(t.customer_qbo_id, (lifetime.get(t.customer_qbo_id) ?? 0) + t.total_cents);
  const suggested = new Set((sugg.data ?? []).map((s) => s.qbo_customer_id));
  const canCreate = canManage && can(session, "people.manage");

  return (
    <Card
      padded={false}
      title="Not mapped yet"
      description={`Every active QuickBooks customer without an approved match (${all.length.toLocaleString()}). They stay here until they are mapped, so none is forgotten.`}
    >
      <div className="border-b border-line p-3">
        <FilterBar action="/accounting/qbo/matching">
          <input type="hidden" name="tab" value="not_mapped" />
          <input name="q" defaultValue={q} placeholder="Search QuickBooks names" aria-label="Search QuickBooks names" className="crm-input" />
        </FilterBar>
      </div>
      {txns.error || sugg.error ? (
        <div className="p-3">
          <QueryError what="lifetime giving" error={txns.error ?? sugg.error} retryHref={retry} />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title={q ? "No unmapped customer has that name" : "Every QuickBooks customer is mapped"} />
      ) : (
        <TableWrap>
          <table className="crm-table" data-testid="qbo-not-mapped">
            <thead>
              <tr>
                <th>QuickBooks customer</th>
                <th className="num">Lifetime giving</th>
                <th className="num">Open balance</th>
                <th>Status</th>
                {canManage ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.qbo_id} data-qbo={c.qbo_id}>
                  <td>
                    <QbSide c={c} evidence={readEvidence(null)} />
                  </td>
                  <td className="num">{formatCents(lifetime.get(c.qbo_id) ?? 0, center.currency)}</td>
                  <td className="num">{formatCents(c.open_balance_cents, center.currency)}</td>
                  <td className="text-[12px]">
                    {suggested.has(c.qbo_id) ? (
                      <Link href="/accounting/qbo/matching?tab=suggested" className="crm-link">
                        Has a suggestion
                      </Link>
                    ) : (
                      <span className="text-muted">No likely household found</span>
                    )}
                  </td>
                  {canManage ? (
                    <td className="min-w-[16rem]">
                      <div className="flex flex-col gap-1.5">
                        <MapCustomerButton
                          qboId={c.qbo_id}
                          qboName={c.display_name}
                          summary={[c.emails.join(", "), addressLine((c.address ?? {}) as Record<string, string>)].filter(Boolean).join(" · ")}
                          label="Map to a household"
                          defaultLevel={level === "person" ? "person" : "family"}
                          labels={labels}
                          timeZone={center.time_zone}
                          currency={center.currency}
                        />
                        {canCreate ? (
                          <ActionForm
                            action={createHouseholdAction}
                            submitLabel="Create household"
                            variant="ghost"
                            size="xs"
                            className="flex flex-wrap gap-1.5"
                            confirmMessage={`Create a new household from “${c.display_name}”? Check first that the family is not already in Community Connect under another name.`}
                          >
                            <input type="hidden" name="qbo" value={c.qbo_id} />
                            {REASON_FIELD(`qbo-create-${c.qbo_id}`)}
                          </ActionForm>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pagination page={page} pageSize={PAGE} total={all.length} hrefFor={(p: number) => hrefWith("/accounting/qbo/matching", sp, { page: String(p) })} />
    </Card>
  );
}

async function ApprovedTab({ session, labels, canManage, page, sp }: { session: CrmSession; labels: CardLabels; canManage: boolean; page: number; sp: RawSearchParams }) {
  const { db, center } = session;
  const tz = center.time_zone;
  const retry = hrefWith("/accounting/qbo/matching", sp, {});
  const res = await db
    .from("qbo_customer_matches")
    .select("id, qbo_customer_id, household_id, person_id, confidence, method, evidence, decided_by, decided_at, reason", { count: "exact" })
    .eq("center_id", center.id)
    .eq("status", "approved")
    .order("decided_at", { ascending: false })
    .range((page - 1) * PAGE, page * PAGE - 1);
  if (res.error) return <QueryError what="the approved matches" error={res.error} retryHref={retry} />;
  const rows = res.data ?? [];
  const ids = rows.map((r) => r.qbo_customer_id);
  const [customers, hh, names, txns, people] = await Promise.all([
    loadCustomers(session, ids),
    householdsById(db, rows.map((r) => r.household_id)),
    userNames(db, center.id, rows.map((r) => r.decided_by)),
    ids.length
      ? db.from("qbo_transactions").select("customer_qbo_id, cc_status").eq("center_id", center.id).in("customer_qbo_id", ids)
      : Promise.resolve({ data: [] as { customer_qbo_id: string | null; cc_status: string }[], error: null }),
    rows.some((r) => r.person_id)
      ? db.from("people").select("id, first_name, last_name").in("id", rows.flatMap((r) => (r.person_id ? [r.person_id] : [])))
      : Promise.resolve({ data: [] as { id: string; first_name: string; last_name: string }[], error: null }),
  ]);
  const counts = new Map<string, Record<string, number>>();
  for (const t of txns.data ?? []) {
    if (!t.customer_qbo_id) continue;
    const c = counts.get(t.customer_qbo_id) ?? {};
    c[t.cc_status] = (c[t.cc_status] ?? 0) + 1;
    counts.set(t.customer_qbo_id, c);
  }
  const personName = new Map((people.data ?? []).map((p) => [p.id, `${p.first_name} ${p.last_name}`]));

  return (
    <Card padded={false} title="Approved matches" description="Their QuickBooks history is on the household. After the QuickBooks go-live date, new payments post back to this customer.">
      {txns.error || hh.error || people.error ? (
        <div className="p-3">
          <QueryError what="the history counts" error={txns.error ?? hh.error ?? people.error} retryHref={retry} />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="Nothing approved yet" />
      ) : (
        <TableWrap>
          <table className="crm-table" data-testid="qbo-approved">
            <thead>
              <tr>
                <th>QuickBooks customer</th>
                <th>Household</th>
                <th>Level</th>
                <th>History</th>
                <th>Approved</th>
                {canManage ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => {
                const ev = readEvidence(m.evidence);
                const c = counts.get(m.qbo_customer_id) ?? {};
                const cust = customers.map.get(m.qbo_customer_id);
                return (
                  <tr key={m.id} data-qbo={m.qbo_customer_id}>
                    <td>
                      <p className="font-bold">{cust?.display_name ?? ev.qb.display_name ?? m.qbo_customer_id}</p>
                      <p className="font-mono text-[11px] text-faint">QuickBooks #{m.qbo_customer_id}</p>
                    </td>
                    <td>
                      <Link href={`/households/${m.household_id}`} className="crm-link">
                        {hh.map.get(m.household_id)?.display_name ?? "Household"}
                      </Link>
                      <p className="text-[11px] text-muted">{hh.map.get(m.household_id)?.household_number}</p>
                    </td>
                    <td className="text-[12px]">{m.person_id ? `Person: ${personName.get(m.person_id) ?? "—"}` : "Family (primary member)"}</td>
                    <td className="text-[12px]">
                      {c.brought_in ?? 0} brought in
                      {c.needs_review ? <span className="block text-danger">{c.needs_review} need review</span> : null}
                      {c.pending ? <span className="block text-muted">{c.pending} waiting</span> : null}
                    </td>
                    <td className="text-[12px]">
                      {names.get(m.decided_by ?? "")?.name ?? "—"} · {m.decided_at ? formatDate(m.decided_at, tz) : "—"}
                      <span className="block text-muted">
                        {methodLabel(m.method)} · {confidencePct(m.confidence)}
                        {m.reason ? ` · “${m.reason}”` : ""}
                      </span>
                    </td>
                    {canManage ? (
                      <td className="min-w-[16rem]">
                        <div className="flex flex-col gap-1.5">
                          <MapCustomerButton
                            qboId={m.qbo_customer_id}
                            qboName={cust?.display_name ?? m.qbo_customer_id}
                            summary={`Now: ${hh.map.get(m.household_id)?.display_name ?? "household"}`}
                            remap
                            label="Remap"
                            variant="ghost"
                            defaultLevel={m.person_id ? "person" : "family"}
                            labels={labels}
                            timeZone={tz}
                            currency={center.currency}
                          />
                          <ActionForm
                            action={unmapAction}
                            submitLabel="Undo mapping"
                            variant="bad"
                            size="xs"
                            className="flex flex-wrap gap-1.5"
                            confirmMessage="Undo this mapping? It is only possible while none of its history has been brought in."
                          >
                            <input type="hidden" name="qbo" value={m.qbo_customer_id} />
                            {REASON_FIELD(`qbo-unmap-${m.id}`)}
                          </ActionForm>
                        </div>
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      )}
      <Pagination page={page} pageSize={PAGE} total={res.count ?? rows.length} hrefFor={(p: number) => hrefWith("/accounting/qbo/matching", sp, { page: String(p) })} />
    </Card>
  );
}

async function RejectedTab({ session }: { session: CrmSession }) {
  const { db, center } = session;
  const res = await db
    .from("qbo_customer_matches")
    .select("id, qbo_customer_id, household_id, method, confidence, decided_by, decided_at, reason")
    .eq("center_id", center.id)
    .eq("status", "rejected")
    .order("decided_at", { ascending: false })
    .limit(200);
  if (res.error) return <QueryError what="the rejected matches" error={res.error} retryHref="/accounting/qbo/matching?tab=rejected" />;
  const rows = res.data ?? [];
  const [customers, hh, names] = await Promise.all([
    loadCustomers(session, [...new Set(rows.map((r) => r.qbo_customer_id))]),
    householdsById(db, rows.map((r) => r.household_id)),
    userNames(db, center.id, rows.map((r) => r.decided_by)),
  ]);
  return (
    <Card padded={false} title="Rejected" description="Matches the treasury turned down (or replaced). A rejected pair is never suggested again. The latest 200.">
      {rows.length === 0 ? (
        <EmptyState title="Nothing rejected" />
      ) : (
        <TableWrap>
          <table className="crm-table" data-testid="qbo-rejected">
            <thead>
              <tr>
                <th>QuickBooks customer</th>
                <th>Household</th>
                <th>Why</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>{customers.map.get(m.qbo_customer_id)?.display_name ?? m.qbo_customer_id}</td>
                  <td>{hh.map.get(m.household_id)?.display_name ?? "—"}</td>
                  <td className="text-[12px]">
                    {m.reason ?? "—"}
                    <span className="block text-muted">
                      {methodLabel(m.method)} · {confidencePct(m.confidence)}
                    </span>
                  </td>
                  <td className="text-[12px]">
                    {names.get(m.decided_by ?? "")?.name ?? "—"} · {m.decided_at ? formatDate(m.decided_at, center.time_zone) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}

async function ReviewTab({ session, canManage }: { session: CrmSession; canManage: boolean }) {
  const { db, center } = session;
  const res = await db
    .from("qbo_transactions")
    .select("qbo_type, qbo_id, customer_qbo_id, txn_date, doc_number, total_cents, open_balance_cents, cc_status, cc_detail, cc_at")
    .eq("center_id", center.id)
    .or("cc_status.eq.needs_review,and(cc_status.eq.brought_in,cc_detail.not.is.null)")
    .order("cc_status", { ascending: false })
    .order("txn_date", { ascending: false })
    .limit(500);
  if (res.error) return <QueryError what="the transactions that need review" error={res.error} retryHref="/accounting/qbo/matching?tab=review" />;
  const rows = res.data ?? [];
  const customers = await loadCustomers(session, [...new Set(rows.flatMap((r) => (r.customer_qbo_id ? [r.customer_qbo_id] : [])))]);
  const waiting = rows.filter((r) => r.cc_status === "needs_review");
  return (
    <Card
      padded={false}
      title="Needs review"
      description="QuickBooks transactions that could not be brought in, with the reason — and ones brought in with a note. The latest 500."
    >
      {canManage && waiting.length ? (
        <div className="border-b border-line p-3">
          <ActionForm action={retryAction} submitLabel="Try all again" variant="ghost" size="sm" />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <EmptyState title="Nothing needs review" />
      ) : (
        <TableWrap>
          <table className="crm-table" data-testid="qbo-review">
            <thead>
              <tr>
                <th>Transaction</th>
                <th>QuickBooks customer</th>
                <th className="num">Amount</th>
                <th>Reason</th>
                {canManage ? <th aria-label="Actions" /> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={`${t.qbo_type}:${t.qbo_id}`} data-txn={`${t.qbo_type}:${t.qbo_id}`}>
                  <td>
                    {TXN_LABEL[t.qbo_type] ?? t.qbo_type} {t.doc_number ? `#${t.doc_number}` : ""}
                    <span className="block text-[12px] text-muted">{formatDate(t.txn_date, center.time_zone)}</span>
                  </td>
                  <td>{customers.map.get(t.customer_qbo_id ?? "")?.display_name ?? t.customer_qbo_id ?? "—"}</td>
                  <td className="num">{formatCents(t.total_cents, center.currency)}</td>
                  <td className="max-w-md text-[12px]">
                    <Badge tone={t.cc_status === "needs_review" ? "warning" : "success"}>{t.cc_status === "needs_review" ? "Waiting" : "Brought in, with a note"}</Badge>
                    <span className="mt-1 block">{t.cc_detail ?? "—"}</span>
                  </td>
                  {canManage ? (
                    <td>
                      {t.cc_status === "needs_review" && t.customer_qbo_id ? (
                        <ActionForm action={retryAction} submitLabel="Try again" variant="ghost" size="xs">
                          <input type="hidden" name="qbo" value={t.customer_qbo_id} />
                        </ActionForm>
                      ) : null}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </Card>
  );
}
