import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, NoAccess, PageHeader, Pagination, QueryError, TableWrap, Tabs, buttonClass } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { householdsById, toCard, userNames } from "@/lib/data/lookups";
import { explainError } from "@/lib/errors";
import { formatDate, formatDateTime } from "@/lib/dates";
import { BANK_CHANNEL_LABEL, ORIGINATOR_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";
import { canAccess } from "@/lib/permissions";
import { hrefWith, pageParam, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { createBankAccountAction, ignoreBankLineAction, restoreBankLineAction } from "./actions";
import { BankImport } from "./bank-import";
import { BankResultsProvider } from "./bank-results";
import { DepositMatcher, type DepositCandidate } from "./deposit-matcher";
import { GiftLineMatcher, type Suggestion } from "./gift-line-matcher";

export const metadata: Metadata = { title: "Bank reconciliation" };

const PAGE_SIZE = 20;
const VIEWS = ["gifts", "deposits", "payouts", "debits", "matched", "ignored"] as const;
type View = (typeof VIEWS)[number];
const VIEW_LABEL: Record<View, string> = {
  gifts: "Gifts to match",
  deposits: "Check & cash deposits",
  payouts: "Card payouts",
  debits: "Money out",
  matched: "Matched",
  ignored: "Ignored",
};

export default async function BankPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Bank reconciliation"
      description="Import the bank statement, then match each line: Zelle, ACH and fund grants to a household; check and cash deposits to the payments recorded for them. Card payouts are listed separately and are never gifts."
    />
  );
  if (!canAccess(session, "bank")) {
    return (
      <>
        {header}
        <NoAccess area="Bank reconciliation" access="bank" />
      </>
    );
  }
  const sp = await searchParams;
  const { db, center } = session;
  const tz = center.time_zone;
  const rules = identifierRules(center.rules);
  const labels = { orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel };
  const viewParam = param(sp, "view");
  const view: View = VIEWS.find((v) => v === viewParam) ?? "gifts";
  const page = pageParam(sp);
  const retry = hrefWith("/giving/bank", sp, {});
  const canConfirm = canAccess(session, "bankConfirm");
  const canIgnore = canAccess(session, "bankIgnore");

  const accountsRes = await db
    .from("bank_accounts")
    .select("id, name, institution, last4, statement_format, active")
    .eq("center_id", center.id)
    .order("name");
  if (accountsRes.error) {
    return (
      <>
        {header}
        <QueryError what="bank accounts" error={accountsRes.error} retryHref={retry} />
      </>
    );
  }
  const accounts = accountsRes.data ?? [];
  const accountParam = param(sp, "account");
  const account = accounts.find((a) => a.id === accountParam) ?? accounts.find((a) => a.active) ?? accounts[0] ?? null;

  if (!account) {
    return (
      <>
        {header}
        <Card title="No bank accounts yet">
          <p className="text-sm text-muted">Add the bank account statements come from before importing.</p>
          {canAccess(session, "qboManage") ? (
            <NewBankAccountForm />
          ) : (
            <p className="mt-2 text-sm">A treasurer with accounting.manage can add one.</p>
          )}
        </Card>
      </>
    );
  }

  // Lines of this account in one view.
  const scoped = (v: View) => {
    let q = db
      .from("bank_transactions")
      .select(
        "id, posted_on, amount_cents, description, channel, payer_name, reference, bank_type, bank_details, check_or_slip, is_batch_deposit, originator_kind, status, matched_household_id, payment_id, matched_by, matched_at, notes",
        { count: "exact" },
      )
      .eq("center_id", center.id)
      .eq("bank_account_id", account.id);
    if (v === "gifts") q = q.in("status", ["unmatched", "suggested"]).gt("amount_cents", 0).eq("is_batch_deposit", false);
    if (v === "deposits") q = q.in("status", ["unmatched", "suggested"]).gt("amount_cents", 0).eq("is_batch_deposit", true);
    if (v === "payouts") q = q.eq("status", "payout");
    if (v === "debits") q = q.in("status", ["unmatched", "suggested"]).lte("amount_cents", 0);
    if (v === "matched") q = q.eq("status", "matched");
    if (v === "ignored") q = q.eq("status", "ignored");
    return q;
  };

  const counts = await Promise.all(
    VIEWS.map(async (v) => {
      const r = await scoped(v).range(0, 0);
      return [v, r.error ? null : (r.count ?? 0)] as const;
    }),
  );
  const countOf = new Map(counts);

  const from = (page - 1) * PAGE_SIZE;
  const ascending = view === "gifts" || view === "deposits";
  const res = await scoped(view).order("posted_on", { ascending }).order("id").range(from, from + PAGE_SIZE - 1);
  const lines = res.data ?? [];

  // Suggestions for the lines on this page.
  const suggestions = new Map<string, { rows: Suggestion[]; error: string | null }>();
  const deposits = new Map<string, { rows: DepositCandidate[]; exact: boolean; error: string | null }>();
  if (view === "gifts") {
    await Promise.all(
      lines.map(async (l) => {
        const r = await db.rpc("suggest_bank_matches", { p_txn: l.id });
        if (r.error) console.error("[bank] suggest_bank_matches failed:", r.error);
        suggestions.set(l.id, {
          error: r.error ? `Could not load suggestions — ${explainError(r.error)}.` : null,
          rows: (r.data ?? []).map((s) => ({
            ...toCard(s),
            score: Number(s.score),
            reason: s.reason ?? "",
            ambiguous: Boolean(s.ambiguous),
          })),
        });
      }),
    );
  }
  if (view === "deposits") {
    await Promise.all(
      lines.map(async (l) => {
        const r = await db.rpc("suggest_deposit_payments", { p_txn: l.id });
        if (r.error) console.error("[bank] suggest_deposit_payments failed:", r.error);
        const rows = (r.data ?? []).map((c) => ({
          payment_id: c.payment_id,
          household_name: c.household_name ?? null,
          receipt_number: c.receipt_number ?? null,
          method: c.method,
          amount_cents: c.amount_cents,
          received_on: c.received_on,
          check_number: c.check_number ?? null,
          envelope_number: c.envelope_number ?? null,
        }));
        deposits.set(l.id, {
          rows,
          exact: Boolean(r.data?.[0]?.exact_total),
          error: r.error ? `Could not load the recorded payments — ${explainError(r.error)}.` : null,
        });
      }),
    );
  }

  const [matchedHouseholds, matchers, receipts, learned] = await Promise.all([
    view === "matched" ? householdsById(db, lines.map((l) => l.matched_household_id)) : Promise.resolve({ map: new Map(), error: null }),
    view === "matched" || view === "ignored" ? userNames(db, center.id, lines.map((l) => l.matched_by)) : Promise.resolve(new Map()),
    view === "matched" && lines.some((l) => l.payment_id)
      ? db.from("payments").select("id, receipt_number").in("id", lines.map((l) => l.payment_id).filter((x): x is string => !!x))
      : Promise.resolve({ data: [] as { id: string; receipt_number: string | null }[], error: null }),
    db
      .from("external_ids")
      .select("id, value, household_id, times_matched, last_matched_at")
      .eq("center_id", center.id)
      .eq("kind", "bank_payer")
      .eq("source", "learned")
      .order("last_matched_at", { ascending: false, nullsFirst: false })
      .limit(8),
  ]);
  const receiptBy = new Map((receipts.data ?? []).map((p) => [p.id, p.receipt_number]));
  const learnedHouseholds = await householdsById(db, (learned.data ?? []).map((l) => l.household_id));

  return (
    <>
      {header}
      <form method="get" action="/giving/bank" className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="account" className="crm-label">
            Bank account
          </label>
          <select id="account" name="account" defaultValue={account.id} className="crm-input min-w-72">
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.last4 ? ` ··${a.last4}` : ""}
                {a.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>
        <input type="hidden" name="view" value={view} />
        <button type="submit" className={buttonClass("secondary")}>
          Switch
        </button>
        <p className="pb-3 text-sm text-muted">
          {account.institution ?? "Bank"} · statement format {account.statement_format === "chase_csv" ? "Chase CSV" : account.statement_format}
        </p>
      </form>

      <BankResultsProvider>
        {canAccess(session, "bankImport") ? (
          <Card title="Import a statement" description="Download the CSV from the bank (Chase: Account activity → Download → CSV). Lines already imported are skipped automatically." className="mb-6">
            <BankImport bankAccountId={account.id} accountName={account.name} expectedFormat={account.statement_format} currency={center.currency} />
          </Card>
        ) : null}

        <Tabs
          active={view}
          tabs={VIEWS.map((v) => ({
            key: v,
            label: (
              <>
                {VIEW_LABEL[v]}
                {countOf.get(v) !== null && countOf.get(v) !== undefined ? (
                  <span className="ml-1.5 rounded-full bg-subtle px-2 text-xs text-muted">{countOf.get(v)}</span>
                ) : null}
              </>
            ),
            href: hrefWith("/giving/bank", { account: account.id }, { view: v }),
          }))}
        />

        {res.error ? (
          <QueryError what="bank lines" error={res.error} retryHref={retry} />
        ) : lines.length === 0 ? (
          <Card padded={false}>
            <EmptyState title={view === "gifts" || view === "deposits" ? "Nothing waiting to be matched" : "No lines here"} />
          </Card>
        ) : (
          <div className="space-y-3">
            {view === "payouts" ? (
              <p className="text-sm text-muted">
                Card-processor payouts (Stripe, Square, PayPal) move money the platform already recorded; they are reconciled against
                provider payouts, never matched to a household.
              </p>
            ) : null}
            {lines.map((l) => (
              <Card key={l.id} padded>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-baseline gap-x-3">
                      <span className={`font-display text-2xl font-semibold tabular-nums ${l.amount_cents < 0 ? "text-maroon" : "text-ink"}`}>
                        {formatCents(l.amount_cents, center.currency)}
                      </span>
                      <span className="text-sm text-muted">{formatDate(l.posted_on, tz)}</span>
                    </p>
                    <p className="mt-1 break-words font-mono text-[0.8125rem] text-ink">{l.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {l.channel ? <Badge tone="navy">{BANK_CHANNEL_LABEL[l.channel] ?? l.channel}</Badge> : null}
                      {l.bank_type ? <Badge>{l.bank_type}</Badge> : null}
                      {l.is_batch_deposit ? <Badge tone="warning">Batch deposit</Badge> : null}
                      {l.originator_kind ? (
                        <Badge tone="purple">{ORIGINATOR_LABEL[l.originator_kind] ?? l.originator_kind}</Badge>
                      ) : null}
                    </div>
                    <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                      {l.payer_name ? (
                        <>
                          <dt className="text-muted">Payer</dt>
                          <dd className="font-semibold">{l.payer_name}</dd>
                        </>
                      ) : null}
                      {l.reference ? (
                        <>
                          <dt className="text-muted">Reference</dt>
                          <dd className="font-mono">{l.reference}</dd>
                        </>
                      ) : null}
                      {l.check_or_slip ? (
                        <>
                          <dt className="text-muted">Check / slip</dt>
                          <dd className="font-mono">{l.check_or_slip}</dd>
                        </>
                      ) : null}
                    </dl>
                    {l.originator_kind === "daf" || l.originator_kind === "matching_gift" || l.originator_kind === "payroll_giving" ? (
                      <p className="mt-2 text-xs text-muted">
                        Sent by a {ORIGINATOR_LABEL[l.originator_kind]?.toLowerCase()} on a donor&apos;s behalf — match it by hand to the donor&apos;s household.
                      </p>
                    ) : null}
                    {canIgnore && (view === "gifts" || view === "deposits" || view === "debits") ? (
                      <details className="mt-3">
                        <summary className="inline-flex min-h-9 cursor-pointer items-center text-[0.8125rem] font-semibold text-muted">Ignore this line…</summary>
                        <ActionForm action={ignoreBankLineAction} submitLabel="Ignore" pendingLabel="Ignoring…" variant="danger" size="sm" className="mt-2">
                          <input type="hidden" name="id" value={l.id} />
                          <label htmlFor={`note-${l.id}`} className="crm-label">
                            Why (optional)
                          </label>
                          <input id={`note-${l.id}`} name="note" maxLength={500} className="crm-input mb-2" placeholder="e.g. transfer between our own accounts" />
                        </ActionForm>
                      </details>
                    ) : null}
                  </div>

                  <div className="min-w-0">
                    {view === "gifts" ? (
                      <GiftLineMatcher
                        txnId={l.id}
                        amountCents={l.amount_cents}
                        payerName={l.payer_name}
                        originatorKind={l.originator_kind}
                        suggestions={suggestions.get(l.id)?.rows ?? []}
                        suggestionError={suggestions.get(l.id)?.error ?? null}
                        labels={labels}
                        timeZone={tz}
                        currency={center.currency}
                        canConfirm={canConfirm}
                      />
                    ) : view === "deposits" ? (
                      <DepositMatcher
                        txnId={l.id}
                        amountCents={l.amount_cents}
                        candidates={deposits.get(l.id)?.rows ?? []}
                        exactTotal={deposits.get(l.id)?.exact ?? false}
                        candidateError={deposits.get(l.id)?.error ?? null}
                        currency={center.currency}
                        timeZone={tz}
                        canConfirm={canConfirm}
                      />
                    ) : view === "matched" ? (
                      <div className="text-sm">
                        {l.matched_household_id ? (
                          <p>
                            Matched to{" "}
                            <Link href={`/households/${l.matched_household_id}?tab=payments`} className="crm-link font-semibold">
                              {matchedHouseholds.map.get(l.matched_household_id)?.display_name ?? "household"}
                            </Link>
                            {l.payment_id ? (
                              <>
                                {" "}
                                — receipt <span className="font-mono">{receiptBy.get(l.payment_id) ?? "…"}</span>
                              </>
                            ) : null}
                          </p>
                        ) : (
                          <p>Matched to recorded check / cash payments as one deposit.</p>
                        )}
                        <p className="text-muted">
                          by {l.matched_by ? (matchers.get(l.matched_by)?.name ?? "staff") : "—"}, {formatDateTime(l.matched_at, tz)}
                        </p>
                      </div>
                    ) : view === "ignored" ? (
                      <div className="text-sm">
                        <p>
                          Ignored by {l.matched_by ? (matchers.get(l.matched_by)?.name ?? "staff") : "—"}
                          {l.matched_at ? `, ${formatDateTime(l.matched_at, tz)}` : ""}
                        </p>
                        {l.notes ? <p className="text-muted">“{l.notes}”</p> : null}
                        {canIgnore ? (
                          <ActionForm action={restoreBankLineAction} submitLabel="Restore to unmatched" pendingLabel="Restoring…" variant="secondary" size="sm" className="mt-2">
                            <input type="hidden" name="id" value={l.id} />
                          </ActionForm>
                        ) : null}
                      </div>
                    ) : view === "payouts" ? (
                      <p className="text-sm text-muted">Payout — no household matching.</p>
                    ) : (
                      <p className="text-sm text-muted">Money out is not matched to households. Ignore it once you have checked it.</p>
                    )}
                  </div>
                </div>
              </Card>
            ))}
            <Card padded={false}>
              <Pagination page={page} pageSize={PAGE_SIZE} total={res.count ?? null} hrefFor={(n) => hrefWith("/giving/bank", sp, { page: n })} />
            </Card>
          </div>
        )}
      </BankResultsProvider>

      <div className="mt-8 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Card title="Recently learned payer names" description="Names confirmed matches taught the system. They are hints — two families can share a name." padded={false}>
          {learned.error ? (
            <div className="p-4">
              <QueryError what="learned payer names" error={learned.error} retryHref={retry} />
            </div>
          ) : (learned.data ?? []).length === 0 ? (
            <EmptyState title="None learned yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Payer name</th>
                    <th>Household</th>
                    <th className="num">Matches</th>
                    <th>Last</th>
                  </tr>
                </thead>
                <tbody>
                  {(learned.data ?? []).map((l) => (
                    <tr key={l.id}>
                      <td className="font-mono">{l.value}</td>
                      <td>
                        {l.household_id ? (
                          <Link href={`/households/${l.household_id}?tab=identifiers`} className="crm-link">
                            {learnedHouseholds.map.get(l.household_id)?.display_name ?? "household"}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="num">{l.times_matched}</td>
                      <td>{formatDate(l.last_matched_at, tz)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
        {canAccess(session, "qboManage") ? (
          <Card title="Add a bank account">
            <NewBankAccountForm />
          </Card>
        ) : null}
      </div>
    </>
  );
}

function NewBankAccountForm() {
  return (
    <ActionForm action={createBankAccountAction} submitLabel="Add bank account" pendingLabel="Adding…" resetOnSuccess>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="ba-name" className="crm-label">
            Name
          </label>
          <input id="ba-name" name="name" required placeholder="Chase operating" className="crm-input" />
        </div>
        <div>
          <label htmlFor="ba-inst" className="crm-label">
            Bank
          </label>
          <input id="ba-inst" name="institution" placeholder="Chase" className="crm-input" />
        </div>
        <div>
          <label htmlFor="ba-last4" className="crm-label">
            Last 4 digits
          </label>
          <input id="ba-last4" name="last4" inputMode="numeric" maxLength={4} className="crm-input" />
        </div>
        <div>
          <label htmlFor="ba-format" className="crm-label">
            Statement format
          </label>
          <select id="ba-format" name="statement_format" defaultValue="chase_csv" className="crm-input">
            <option value="chase_csv">Chase CSV</option>
            <option value="generic_csv">Generic CSV (date, amount, description)</option>
          </select>
        </div>
      </div>
    </ActionForm>
  );
}
