import { Card, KeyValueRow } from "@/components/ui";
import { explainError } from "@/lib/errors";
import { canAccess } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

type Task = { label: string; href: string; value: string; tone: "warn" | "bad" | "navy" };

/**
 * Home tasks from Giving, Accounting and Reports (prototype Home, L506):
 * DAF / matching gifts to match, QuickBooks exceptions blocking the month-end
 * close, and community-dashboard KPIs kept members-only. Only tasks with
 * something to do are shown; a failed count is shown as a failure.
 */
export async function GivingHomeTasks({ session }: { session: CrmSession }) {
  const { db, center } = session;
  const tasks: Task[] = [];
  const problems: string[] = [];

  const [daf, exceptions, kpis] = await Promise.all([
    canAccess(session, "bank")
      ? db
          .from("bank_transactions")
          .select("id", { count: "exact", head: true })
          .eq("center_id", center.id)
          .in("originator_kind", ["daf", "matching_gift", "payroll_giving"])
          .in("status", ["unmatched", "suggested"])
          .gt("amount_cents", 0)
      : null,
    canAccess(session, "qboLedger")
      ? db.from("ledger_postings").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "failed")
      : null,
    canAccess(session, "publicKpisManage") ? db.rpc("public_kpi_catalog", { p_center: center.id }) : null,
  ]);

  if (daf?.error) problems.push(`DAF and matching gifts — ${explainError(daf.error)}`);
  else if (daf && (daf.count ?? 0) > 0) {
    const n = daf.count ?? 0;
    tasks.push({ label: `${n} DAF or matching-gift deposit${n === 1 ? "" : "s"} to match`, href: "/giving/payments", value: "Match", tone: "warn" });
  }
  if (exceptions?.error) problems.push(`QuickBooks exceptions — ${explainError(exceptions.error)}`);
  else if (exceptions && (exceptions.count ?? 0) > 0) {
    const n = exceptions.count ?? 0;
    tasks.push({
      label: `${n} QuickBooks exception${n === 1 ? "" : "s"} · Month-end close is blocked`,
      href: "/accounting/qbo",
      value: "Fix",
      tone: "bad",
    });
  }
  if (kpis?.error) problems.push(`Community dashboard — ${explainError(kpis.error)}`);
  else if (kpis) {
    const n = (kpis.data ?? []).filter((k) => k.visibility !== "public").length;
    if (n > 0) tasks.push({ label: `${n} community dashboard KPIs kept members-only`, href: "/reports/community", value: "Review", tone: "navy" });
  }
  for (const p of problems) console.error("[home] giving task count failed:", p);
  if (tasks.length === 0 && problems.length === 0) return null;

  return (
    <Card title="Giving and accounting tasks" className="mt-4">
      <div className="flex flex-col gap-1.5">
        {tasks.map((t) => (
          <KeyValueRow key={t.label} label={t.label} value={t.value} href={t.href} tone={t.tone} />
        ))}
        {problems.map((p) => (
          <p key={p} role="alert" className="text-[13px] text-danger">
            Could not count: {p}. Reload to try again.
          </p>
        ))}
      </div>
    </Card>
  );
}
