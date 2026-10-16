// The "Test Bank Statement": GET /giving/payments/bank/test-statement
//
// A CSV for trying the bank import in a sandbox or a demo community, built from that community's own test data so the Reconcile view
// has something to say about every line (src/lib/test-statement.ts). Only for people who may import a statement, and only where the
// community is a sandbox or a demo: a live community gets a plain sentence and 403, because lines made up from its own families would
// be mistaken for the bank's. Nothing is saved and nothing is imported: the person downloads it and chooses it in "Import a statement".

import { todayInTz } from "@/lib/dates";
import { GIVING_ADDONS } from "@/lib/giving-today/tabs";
import { isModuleEnabled, moduleOffMessage } from "@/lib/modules";
import { canAccess } from "@/lib/permissions";
import { loadSession } from "@/lib/session";
import { buildTestStatement, isTestCommunity, type SampleSource, type StatementFormat } from "@/lib/test-statement";

export const runtime = "nodejs";

function problem(message: string, status: number) {
  return new Response(`${message}\n`, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "private, no-store", "x-content-type-options": "nosniff" },
  });
}

type Named = { household_id: string; is_primary: boolean; people: { first_name: string; last_name: string } | { first_name: string; last_name: string }[] | null };

export async function GET() {
  const state = await loadSession();
  if (state.status === "signed_out") return problem("Could not make the test statement — your session has expired. Sign in again.", 401);
  if (state.status !== "ok") return problem("Could not make the test statement — the app could not load your session. Try again.", 500);
  const session = state.session;
  const { db, center } = session;
  if (!canAccess(session, "bankImport")) return problem("Could not make the test statement — you don't have access to this area.", 403);
  if (!isModuleEnabled(session, GIVING_ADDONS.bank)) {
    return problem(`Could not make the test statement — ${moduleOffMessage(GIVING_ADDONS.bank, center.name)}`, 403);
  }
  if (!isTestCommunity(center, session.demo === true)) {
    return problem("The test statement is only for sandbox and demo communities. Download the real statement from the bank instead.", 403);
  }

  const failed = (what: string, error: unknown) => {
    console.error(`[test statement] could not read ${what}:`, error);
    return problem(`Could not make the test statement — could not read ${what}. Try again.`, 500);
  };

  const accounts = await db.from("bank_accounts").select("statement_format").eq("center_id", center.id).eq("active", true).limit(1);
  if (accounts.error) return failed("the bank account", accounts.error);
  const format: StatementFormat = accounts.data?.[0]?.statement_format === "generic_csv" ? "generic_csv" : "chase_csv";

  const pledgeRes = await db
    .from("pledges")
    .select("household_id, amount_cents, paid_cents, soft_credit_cents")
    .eq("center_id", center.id)
    .in("status", ["open", "partially_paid"])
    .order("pledged_at", { ascending: true })
    .limit(60);
  if (pledgeRes.error) return failed("the open pledges", pledgeRes.error);
  const payRes = await db
    .from("payments")
    .select("household_id, method, amount_cents, check_number")
    .eq("center_id", center.id)
    .eq("provider", "offline")
    .in("status", ["captured", "pending_clearing"])
    .is("deposit_bank_transaction_id", null)
    .is("reconciled_at", null)
    .order("received_on", { ascending: false })
    .limit(20);
  if (payRes.error) return failed("the recorded payments", payRes.error);
  const proofRes = await db
    .from("payment_proofs")
    .select("household_id, method, amount_cents, reference")
    .eq("center_id", center.id)
    .eq("status", "submitted")
    .order("created_at", { ascending: true })
    .limit(10);
  if (proofRes.error) return failed("the waiting payment confirmations", proofRes.error);

  // One open pledge per family, and only what is still uncovered (amount − paid − soft credit), as the engine itself reckons it.
  const seen = new Set<string>();
  const pledges = (pledgeRes.data ?? []).flatMap((p) => {
    const open = p.amount_cents - p.paid_cents - (p.soft_credit_cents ?? 0);
    if (open <= 0 || seen.has(p.household_id)) return [];
    seen.add(p.household_id);
    return [{ household_id: p.household_id, cents: open }];
  });
  const payments = (payRes.data ?? []).filter((p) => p.amount_cents > 0).slice(0, 2);
  const proofs = (proofRes.data ?? []).filter((p) => p.amount_cents > 0).slice(0, 2);

  const ids = [...new Set([...pledges.slice(0, 3).map((p) => p.household_id), ...payments.map((p) => p.household_id), ...proofs.map((p) => p.household_id)])];
  const names = new Map<string, string>();
  if (ids.length > 0) {
    const mem = await db
      .from("household_members")
      .select("household_id, is_primary, people(first_name, last_name)")
      .eq("center_id", center.id)
      .in("household_id", ids)
      .is("left_at", null);
    if (mem.error) return failed("the families' names", mem.error);
    const rows = ((mem.data ?? []) as unknown as Named[]).sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
    for (const m of rows) {
      const person = Array.isArray(m.people) ? m.people[0] : m.people;
      if (person && !names.has(m.household_id)) names.set(m.household_id, `${person.first_name} ${person.last_name}`.trim());
    }
  }
  const payer = (h: string) => names.get(h) ?? null;

  const source: SampleSource = {
    today: todayInTz(center.time_zone),
    format,
    pledges: pledges.map((p) => ({ payer: payer(p.household_id), cents: p.cents })),
    payments: payments.map((p) => ({ payer: payer(p.household_id), method: p.method, cents: p.amount_cents, checkNumber: p.check_number })),
    proofs: proofs.map((p) => ({ payer: payer(p.household_id), method: p.method, cents: p.amount_cents, reference: p.reference })),
  };
  const { csv } = buildTestStatement(source);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="test-bank-statement-${source.today}.csv"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
