import type { Metadata } from "next";
import Link from "next/link";

import { HouseholdDrawerProvider, HouseholdRow } from "@/app/(app)/giving/_components/household-drawer";
import { ActionForm } from "@/components/action-form";
import { RefundControls } from "@/components/two-person-controls";
import {
  Alert,
  Badge,
  BlockGrid,
  Card,
  ChipLinks,
  EmptyState,
  NoAccess,
  PageHeader,
  Pagination,
  QueryError,
  StatusText,
  TableWrap,
  buttonClass,
} from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import type { Enums } from "@/lib/database.types";
import { chunk } from "@/lib/data/fetch-all";
import { householdsById, personName, toCard, userNames } from "@/lib/data/lookups";
import { formatDate, todayInTz } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { countingStatusText, monthDay, refundStatusText } from "@/lib/giving";
import { ORIGINATOR_LABEL, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import type { Suggestion } from "./bank/gift-line-matcher";
import { recordCountingDepositAction } from "./counting-actions";
import { CountingForm, type CounterOption } from "./counting-form";
import { DafMatchButton } from "./daf-match-drawer";
import { RecordPaymentForm } from "./record-payment-form";

export const metadata: Metadata = { title: "Payments & deposits" };

const PAGE_SIZE = 50;
type Method = Enums<"payment_method">;
const METHODS = Object.keys(PAYMENT_METHOD_LABEL) as Method[];

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader title="Giving" description="Offline payments, deposits, bhandar and refunds" />
  );
  if (!canAccess(session, "payments")) {
    return (
      <>
        {header}
        <NoAccess area="Payments" access="payments" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const tz = center.time_zone;
  const today = todayInTz(tz);
  const rules = identifierRules(center.rules);
  const methodParam = param(sp, "method");
  const method = METHODS.find((m) => m === methodParam);
  const provider = param(sp, "provider");
  const fromDate = param(sp, "from");
  const toDate = param(sp, "to");
  const page = pageParam(sp);
  const retry = hrefWith("/giving/payments", sp, {});
  const canRecord = canAccess(session, "recordPayment");
  const canManage = canAccess(session, "givingManage");
  const canApprove = canAccess(session, "givingApprove");

  let query = db
    .from("payments")
    .select(
      "id, receipt_number, household_id, received_on, method, amount_cents, status, provider, check_number, envelope_number, memo, recorded_by, refunded_cents, refund_approved_by, refund_second_approver, deposit_bank_transaction_id",
      { count: "exact" },
    )
    .eq("center_id", center.id);
  if (method) query = query.eq("method", method);
  if (provider) query = query.eq("provider", provider);
  if (fromDate && /^\d{4}-\d{2}-\d{2}$/.test(fromDate)) query = query.gte("received_on", fromDate);
  if (toDate && /^\d{4}-\d{2}-\d{2}$/.test(toDate)) query = query.lte("received_on", toDate);
  const from = (page - 1) * PAGE_SIZE;
  const res = await query.order("received_on", { ascending: false }).order("created_at", { ascending: false }).range(from, from + PAGE_SIZE - 1);
  const rows = res.data ?? [];

  const allocated = new Map<string, number>();
  let allocError: unknown = null;
  for (const part of chunk(rows.map((r) => r.id))) {
    const a = await db.from("payment_allocations").select("payment_id, amount_cents").in("payment_id", part);
    if (a.error) {
      allocError = a.error;
      break;
    }
    for (const x of a.data ?? []) allocated.set(x.payment_id, (allocated.get(x.payment_id) ?? 0) + x.amount_cents);
  }
  const [households, people] = await Promise.all([
    householdsById(db, rows.map((r) => r.household_id)),
    userNames(db, center.id, [...rows.map((r) => r.recorded_by), ...rows.map((r) => r.refund_approved_by)]),
  ]);

  const labels = { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel };
  const seesBank = canAccess(session, "bank");
  const seesCounting = canAccess(session, "counting");
  const canCount = canAccess(session, "countingRecord");
  const seesAll = canAccess(session, "paymentsAll");

  // DAF grants and matching gifts (bank lines flagged by known_originators), newest first.
  const daf = seesBank
    ? await db
        .from("bank_transactions")
        .select("id, posted_on, amount_cents, description, payer_name, reference, check_or_slip, originator_kind, status, matched_household_id")
        .eq("center_id", center.id)
        .in("originator_kind", ["daf", "matching_gift", "payroll_giving"])
        .gt("amount_cents", 0)
        .in("status", ["unmatched", "suggested", "matched"])
        .order("status", { ascending: false })
        .order("posted_on", { ascending: false })
        .limit(12)
    : null;
  const dafRows = daf?.data ?? [];
  const dafSuggestions = new Map<string, { rows: Suggestion[]; error: string | null }>();
  await Promise.all(
    dafRows
      .filter((l) => l.status !== "matched")
      .map(async (l) => {
        const r = await db.rpc("suggest_bank_matches", { p_txn: l.id });
        if (r.error) console.error("[payments] suggest_bank_matches failed:", r.error);
        dafSuggestions.set(l.id, {
          error: r.error ? `Could not load suggestions — ${explainError(r.error)}.` : null,
          rows: (r.data ?? []).map((x) => ({ ...toCard(x), score: Number(x.score), reason: x.reason ?? "", ambiguous: Boolean(x.ambiguous) })),
        });
      }),
  );

  // Bhandar counting sessions and the people who can count.
  const counting = seesCounting
    ? await db
        .from("counting_sessions")
        .select("id, counted_on, counters, total_cents, bag_numbers, deposit_ref, payment_id, notes, kind")
        .eq("center_id", center.id)
        .order("counted_on", { ascending: false })
        .limit(8)
    : null;
  const countingRows = counting?.data ?? [];
  let counterOptions: CounterOption[] = [];
  let counterError: string | null = null;
  if (canCount) {
    const cu = await db.from("center_users").select("user_id, person_id").eq("center_id", center.id).not("person_id", "is", null).limit(1000);
    if (cu.error) {
      console.error("[payments] counters: center_users failed:", cu.error);
      counterError = `Could not list people to choose counters from — ${explainError(cu.error)}.`;
    } else {
      const personIds = (cu.data ?? []).map((x) => x.person_id).filter((x): x is string => !!x);
      const [pp, hm] = await Promise.all([
        personIds.length ? db.from("people").select("id, first_name, last_name, preferred_name").in("id", personIds.slice(0, 1000)) : null,
        personIds.length
          ? db.from("household_members").select("person_id, household_id, is_primary").in("person_id", personIds.slice(0, 1000)).is("left_at", null)
          : null,
      ]);
      if (pp?.error || hm?.error) {
        console.error("[payments] counters: people/household lookup failed:", pp?.error ?? hm?.error);
        counterError = `Could not list people to choose counters from — ${explainError(pp?.error ?? hm?.error)}.`;
      }
      const hhOf = new Map<string, string>();
      for (const m of [...(hm?.data ?? [])].sort((a, b) => Number(b.is_primary) - Number(a.is_primary))) {
        if (!hhOf.has(m.person_id)) hhOf.set(m.person_id, m.household_id);
      }
      const hhNames = await householdsById(db, [...hhOf.values()]);
      const personBy = new Map((pp?.data ?? []).map((x) => [x.id, x]));
      counterOptions = (cu.data ?? [])
        .flatMap((x) => {
          const person = x.person_id ? personBy.get(x.person_id) : undefined;
          if (!person) return [];
          const householdId = hhOf.get(person.id) ?? null;
          const h = householdId ? hhNames.map.get(householdId) : undefined;
          return [
            {
              userId: x.user_id,
              name: personName(person),
              householdId,
              household: h ? `${h.display_name}${h.household_number ? ` (${h.household_number})` : ""}` : null,
            },
          ];
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    }
  }
  const counterNames = await userNames(db, center.id, countingRows.flatMap((c) => c.counters));

  // Refund requests (two-person rule), newest first.
  const refunds = seesAll
    ? await db
        .from("payments")
        .select(
          "id, receipt_number, household_id, amount_cents, refunded_cents, provider, status, refund_approved_by, refund_second_approver, refund_reason, refund_requested_cents, updated_at",
        )
        .eq("center_id", center.id)
        .not("refund_approved_by", "is", null)
        .order("updated_at", { ascending: false })
        .limit(10)
    : null;
  const refundRows = refunds?.data ?? [];
  const [refundHouseholds, refundPeople, dafHouseholds] = await Promise.all([
    householdsById(db, refundRows.map((r) => r.household_id)),
    userNames(db, center.id, refundRows.map((r) => r.refund_approved_by)),
    householdsById(db, dafRows.map((r) => r.matched_household_id)),
  ]);

  return (
    <HouseholdDrawerProvider labels={labels} timeZone={tz} currency={center.currency}>
      {header}
      <ChipLinks
        label="Payments and deposits views"
        active="overview"
        items={[
          { key: "overview", label: "Payments & deposits", href: "/giving/payments" },
          ...(seesBank ? [{ key: "bank", label: "Bank reconciliation", href: "/giving/payments/bank" }] : []),
        ]}
      />
      <BlockGrid className="mb-4">
        {canRecord ? (
          <RecordPaymentForm labels={labels} timeZone={tz} currency={center.currency} today={today} canAllocate={canAccess(session, "allocatePayment")} />
        ) : null}

        {seesBank ? (
          <Card
            span={12}
            title="DAF grants and matching gifts to match"
            description="Arrive without full donor details; treasury applies them to a household"
            padded={false}
            actions={
              <Link href="/giving/payments/bank" className={buttonClass("ghost", "sm")}>
                Bank reconciliation
              </Link>
            }
          >
            {daf?.error ? (
              <div className="p-2.5">
                <QueryError what="DAF grants and matching gifts" error={daf.error} retryHref="/giving/payments" />
              </div>
            ) : dafRows.length === 0 ? (
              <EmptyState title="No DAF grants or matching gifts waiting">Import the bank statement to see new ones here.</EmptyState>
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Deposit</th>
                      <th>Source</th>
                      <th className="num">Amount</th>
                      <th>Date</th>
                      <th>Memo</th>
                      <th>Status</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {dafRows.map((l) => {
                      const sug = dafSuggestions.get(l.id);
                      const ref = l.reference ?? l.check_or_slip ?? `DEP-${l.id.slice(0, 6).toUpperCase()}`;
                      const matchedTo = l.matched_household_id ? dafHouseholds.map.get(l.matched_household_id) : undefined;
                      return (
                        <tr key={l.id}>
                          <td className="font-mono text-[0.8125rem]">{ref}</td>
                          <td className="font-bold">
                            {l.payer_name ?? "Unknown sender"}
                            <div className="text-xs font-normal text-muted">{ORIGINATOR_LABEL[l.originator_kind ?? ""] ?? ""}</div>
                          </td>
                          <td className="num">{formatCents(l.amount_cents, center.currency)}</td>
                          <td className="whitespace-nowrap">{monthDay(l.posted_on)}</td>
                          <td className="max-w-xs text-[13px]">{l.description}</td>
                          <td>
                            {l.status === "matched" ? (
                              <StatusText tone="ok">Matched{matchedTo ? ` · ${matchedTo.display_name}` : ""}</StatusText>
                            ) : (
                              <StatusText tone="warn">Unmatched</StatusText>
                            )}
                          </td>
                          <td>
                            {l.status !== "matched" && canAccess(session, "bankConfirm") ? (
                              <DafMatchButton
                                line={{
                                  id: l.id,
                                  ref,
                                  source: l.payer_name ?? "Unknown sender",
                                  amountCents: l.amount_cents,
                                  postedOn: l.posted_on,
                                  memo: l.description,
                                  kind: l.originator_kind,
                                }}
                                suggestions={sug?.rows ?? []}
                                suggestionError={sug?.error ?? null}
                                labels={labels}
                                timeZone={tz}
                                currency={center.currency}
                              />
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        ) : null}

        {seesCounting ? (
          <Card span={7} title="Bhandar counting sessions" description="Two counters from different households · sealed, numbered bags" padded={false}>
            {counting?.error ? (
              <div className="p-2.5">
                <QueryError what="counting sessions" error={counting.error} retryHref="/giving/payments" />
              </div>
            ) : countingRows.length === 0 ? (
              <EmptyState title="No counting sessions yet" />
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Session</th>
                      <th>Date</th>
                      <th>Counters</th>
                      <th className="num">Total</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {countingRows.map((c) => {
                      const st = countingStatusText(c, today);
                      return (
                        <tr key={c.id}>
                          <td className="font-mono text-[0.8125rem]">
                            {c.bag_numbers.length ? `Bags ${c.bag_numbers.join(", ")}` : `BH-${c.id.slice(0, 4).toUpperCase()}`}
                          </td>
                          <td className="whitespace-nowrap">{monthDay(c.counted_on)}</td>
                          <td className="text-[13px]">{c.counters.map((u) => counterNames.get(u)?.name ?? "Counter").join(" · ")}</td>
                          <td className="num">{c.total_cents > 0 ? formatCents(c.total_cents, center.currency) : "—"}</td>
                          <td>
                            <StatusText tone={st.tone === "muted" ? "warn" : st.tone}>{st.label}</StatusText>
                            {c.deposit_ref ? <div className="text-xs text-muted">Deposit {c.deposit_ref}</div> : null}
                            {canCount && !c.deposit_ref ? (
                              <details className="mt-1">
                                <summary className="cursor-pointer text-xs font-semibold text-navy">Record total / deposit…</summary>
                                <ActionForm action={recordCountingDepositAction} submitLabel="Save" pendingLabel="Saving…" size="xs" className="mt-1 w-52">
                                  <input type="hidden" name="id" value={c.id} />
                                  <label htmlFor={`ct-${c.id}`} className="crm-label">
                                    Counted total ($)
                                  </label>
                                  <input id={`ct-${c.id}`} name="total" inputMode="decimal" className="crm-input mb-1" />
                                  <label htmlFor={`cd-${c.id}`} className="crm-label">
                                    Deposit slip / reference
                                  </label>
                                  <input id={`cd-${c.id}`} name="deposit_ref" className="crm-input mb-1" />
                                </ActionForm>
                              </details>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
            {canCount ? (
              <details className="px-2.5 pb-2 pt-1">
                <summary className={`${buttonClass("ghost", "sm")} cursor-pointer`}>New counting session</summary>
                <div className="mt-3">
                  {counterError ? (
                    <Alert tone="warning">{counterError} Choosing counters needs people.view (a treasurer can do it).</Alert>
                  ) : (
                    <CountingForm counters={counterOptions} today={today} />
                  )}
                </div>
              </details>
            ) : null}
          </Card>
        ) : null}

        {seesAll ? (
          <Card span={seesCounting ? 5 : 12} title="Refund requests" description="Two-person rule: the requester cannot approve" padded={false}>
            {refunds?.error ? (
              <div className="p-2.5">
                <QueryError what="refund requests" error={refunds.error} retryHref="/giving/payments" />
              </div>
            ) : refundRows.length === 0 ? (
              <EmptyState title="No refund requests">Request a refund from a payment in the list below.</EmptyState>
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>ID</th>
                      <th>Household</th>
                      <th className="num">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {refundRows.map((r) => {
                      const st = refundStatusText(r);
                      const h = refundHouseholds.map.get(r.household_id);
                      return (
                        <tr key={r.id}>
                          <td className="font-mono text-[0.8125rem]">{r.receipt_number ?? "—"}</td>
                          <td>
                            {h?.display_name ?? "Household"}
                            {r.refund_reason ? <div className="text-xs text-muted">“{r.refund_reason}”</div> : null}
                          </td>
                          <td className="num">{formatCents(r.refund_requested_cents ?? r.amount_cents - r.refunded_cents, center.currency)}</td>
                          <td>
                            <StatusText tone={st.tone === "muted" ? "warn" : st.tone}>{st.label}</StatusText>
                            {r.refunded_cents === 0 ? (
                              <div className="mt-1">
                                <RefundControls
                                  paymentId={r.id}
                                  provider={r.provider}
                                  refundable
                                  requestedBy={r.refund_approved_by}
                                  secondApprover={r.refund_second_approver}
                                  requesterName={refundPeople.get(r.refund_approved_by ?? "")?.name ?? null}
                                  me={session.userId}
                                  canManage={canManage}
                                  canApprove={canApprove}
                                  requestedCents={r.refund_requested_cents}
                                  currency={center.currency}
                                />
                              </div>
                            ) : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
        ) : null}
      </BlockGrid>

      <h2 className="cc-card-title mb-2 mt-2">All payments</h2>
      {!can(session, ["giving.view", "giving.manage"]) ? (
        <div className="mb-4">
          <Alert tone="info">With the finance volunteer role the list shows only payments you recorded yourself.</Alert>
        </div>
      ) : null}

      <form method="get" action="/giving/payments" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="method" className="crm-label">
            Method
          </label>
          <select id="method" name="method" defaultValue={method ?? ""} className="crm-input min-w-44">
            <option value="">All methods</option>
            {METHODS.map((m) => (
              <option key={m} value={m}>
                {PAYMENT_METHOD_LABEL[m]}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="provider" className="crm-label">
            Source
          </label>
          <select id="provider" name="provider" defaultValue={provider ?? ""} className="crm-input min-w-44">
            <option value="">All sources</option>
            <option value="offline">Recorded offline</option>
            <option value="bank">Matched from the bank</option>
            <option value="stripe">Online (Stripe)</option>
          </select>
        </div>
        <div>
          <label htmlFor="from" className="crm-label">
            Received from
          </label>
          <input id="from" name="from" type="date" defaultValue={fromDate ?? ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor="to" className="crm-label">
            to
          </label>
          <input id="to" name="to" type="date" defaultValue={toDate ?? ""} className="crm-input" />
        </div>
        <button type="submit" className={buttonClass("primary")}>
          Apply
        </button>
        {method || provider || fromDate || toDate ? (
          <Link href="/giving/payments" className={buttonClass("ghost")}>
            Clear
          </Link>
        ) : null}
      </form>

      {res.error ? (
        <QueryError what="payments" error={res.error} retryHref={retry} />
      ) : (
        <Card padded={false}>
          {allocError || households.error ? (
            <div className="p-4">
              <QueryError what="allocations or household names" error={allocError ?? households.error} retryHref={retry} />
            </div>
          ) : null}
          {rows.length === 0 ? (
            <EmptyState title="No payments match" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Receipt</th>
                    <th>Received</th>
                    <th>Household</th>
                    <th>Method</th>
                    <th className="num">Amount</th>
                    <th>Applied</th>
                    <th>Status</th>
                    <th>Recorded by</th>
                    {canManage || canApprove ? <th>Refund</th> : null}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((p) => {
                    const h = households.map.get(p.household_id);
                    const applied = allocated.get(p.id) ?? 0;
                    return (
                      <HouseholdRow key={p.id} householdId={p.household_id} label={`Open ${h?.display_name ?? "the household"}`}>
                        <td className="font-mono text-[0.8125rem]">{p.receipt_number ?? "—"}</td>
                        <td className="whitespace-nowrap">{formatDate(p.received_on, tz)}</td>
                        <td>
                          <span className="font-semibold">{h?.display_name ?? "Household"}</span>
                          <div className="font-mono text-xs text-muted">{h?.household_number ?? ""}</div>
                        </td>
                        <td>
                          {PAYMENT_METHOD_LABEL[p.method] ?? p.method}
                          {p.check_number ? <div className="text-xs text-muted">Check #{p.check_number}</div> : null}
                          {p.envelope_number ? <div className="text-xs text-muted">Envelope {p.envelope_number}</div> : null}
                          <div className="text-xs text-muted">{p.provider === "bank" ? "from bank" : (p.provider ?? "")}</div>
                        </td>
                        <td className="num">
                          {formatCents(p.amount_cents, center.currency)}
                          {p.refunded_cents > 0 ? <div className="text-xs text-danger">−{formatCents(p.refunded_cents, center.currency)}</div> : null}
                        </td>
                        <td className="text-[0.8125rem]">
                          {applied >= p.amount_cents ? (
                            <Badge tone="success">Fully applied</Badge>
                          ) : applied > 0 ? (
                            <span>
                              {formatCents(applied, center.currency)}
                              <span className="block text-muted">{formatCents(p.amount_cents - applied, center.currency)} unapplied</span>
                            </span>
                          ) : (
                            <span className="text-muted">Unapplied</span>
                          )}
                        </td>
                        <td>
                          <Badge tone={p.status === "failed" || p.status === "voided" ? "danger" : p.status.includes("refund") ? "warning" : "success"}>
                            {p.status.replace(/_/g, " ")}
                          </Badge>
                          {p.provider === "offline" && (p.method === "check" || p.method === "cash") ? (
                            <div className="mt-1 text-xs text-muted">{p.deposit_bank_transaction_id ? "Deposited" : "Awaiting deposit"}</div>
                          ) : null}
                        </td>
                        <td className="text-[0.8125rem]">{p.recorded_by ? (people.get(p.recorded_by)?.name ?? "Staff") : "System"}</td>
                        {canManage || canApprove ? (
                          <td>
                            <RefundControls
                              paymentId={p.id}
                              provider={p.provider}
                              refundable={p.refunded_cents < p.amount_cents && !["failed", "voided", "authorized"].includes(p.status)}
                              requestedBy={p.refund_approved_by}
                              secondApprover={p.refund_second_approver}
                              requesterName={p.refund_approved_by ? (people.get(p.refund_approved_by)?.name ?? null) : null}
                              me={session.userId}
                              canManage={canManage}
                              canApprove={canApprove}
                              refundableCents={p.amount_cents - p.refunded_cents}
                              currency={center.currency}
                            />
                          </td>
                        ) : null}
                      </HouseholdRow>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/giving/payments", sp, { page: n })} />
        </Card>
      )}
    </HouseholdDrawerProvider>
  );
}
