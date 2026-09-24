import type { Metadata } from "next";

import { Card, KpiGrid, PageHeader, Stat, capitalize, type StatTone } from "@/components/ui";
import { fetchAll } from "@/lib/data/fetch-all";
import { explainError, type DbErrorLike } from "@/lib/errors";
import { formatCents, sumCents } from "@/lib/money";
import { ACCESS, canAccess, type AccessKey } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { ApprovalsQueue } from "./approvals-queue";
import { GivingHomeTasks } from "./giving-home-tasks";

export const metadata: Metadata = { title: "Dashboard" };

type Tile =
  | { state: "no_access"; need: string }
  | { state: "error"; message: string }
  | { state: "ok"; value: string; hint?: string };

function noAccess(key: AccessKey): Tile {
  return { state: "no_access", need: ACCESS[key].join(" or ") };
}
function errorTile(error: DbErrorLike): Tile {
  console.error("[dashboard] tile query failed:", error);
  return { state: "error", message: capitalize(explainError(error)) };
}

export default async function DashboardPage() {
  const session = await getSession();
  const { db, center } = session;
  const cid = center.id;

  const [households, pledges, bank, qbo, applications] = await Promise.all([
    (async (): Promise<Tile> => {
      if (!canAccess(session, "memberships")) return noAccess("memberships");
      // Households with an active yearly or life membership (same definition as public_kpis).
      const { count, error } = await db
        .from("households")
        .select("id, memberships!inner(id)", { count: "exact", head: true })
        .eq("center_id", cid)
        .is("merged_into_id", null)
        .eq("memberships.status", "active")
        .neq("memberships.tier", "community");
      if (error) return errorTile(error);
      return { state: "ok", value: (count ?? 0).toLocaleString(), hint: "Yearly and life members" };
    })(),
    (async (): Promise<Tile> => {
      if (!canAccess(session, "pledges")) return noAccess("pledges");
      const { data, error, truncated } = await fetchAll((from, to) =>
        db
          .from("pledges")
          .select("id, amount_cents, paid_cents")
          .eq("center_id", cid)
          .in("status", ["open", "partially_paid"])
          .order("id")
          .range(from, to),
      );
      if (error) return errorTile(error);
      const open = sumCents(data.map((p) => p.amount_cents - p.paid_cents));
      return {
        state: "ok",
        value: formatCents(open, center.currency),
        hint: `${data.length.toLocaleString()} open pledge${data.length === 1 ? "" : "s"}${truncated ? " (first 50,000 only)" : ""}`,
      };
    })(),
    (async (): Promise<Tile> => {
      if (!canAccess(session, "bank")) return noAccess("bank");
      const [lines, deposits] = await Promise.all([
        db
          .from("bank_transactions")
          .select("id", { count: "exact", head: true })
          .eq("center_id", cid)
          .in("status", ["unmatched", "suggested"])
          .gt("amount_cents", 0),
        db
          .from("bank_transactions")
          .select("id", { count: "exact", head: true })
          .eq("center_id", cid)
          .in("status", ["unmatched", "suggested"])
          .gt("amount_cents", 0)
          .eq("is_batch_deposit", true),
      ]);
      if (lines.error) return errorTile(lines.error);
      if (deposits.error) return errorTile(deposits.error);
      return {
        state: "ok",
        value: (lines.count ?? 0).toLocaleString(),
        hint: `Money in, not yet matched · ${(deposits.count ?? 0).toLocaleString()} are check/cash deposits`,
      };
    })(),
    (async (): Promise<Tile> => {
      if (!canAccess(session, "qboLedger")) return noAccess("qboLedger");
      const { count, error } = await db
        .from("ledger_postings")
        .select("id", { count: "exact", head: true })
        .eq("center_id", cid)
        .eq("status", "failed");
      if (error) return errorTile(error);
      return { state: "ok", value: (count ?? 0).toLocaleString(), hint: "Postings that failed and need attention" };
    })(),
    (async (): Promise<Tile> => {
      if (!canAccess(session, "applications")) return noAccess("applications");
      const [all, decide] = await Promise.all([
        db
          .from("membership_applications")
          .select("id", { count: "exact", head: true })
          .eq("center_id", cid)
          .in("status", ["awaiting_reference", "awaiting_center", "awaiting_ec"]),
        db
          .from("membership_applications")
          .select("id", { count: "exact", head: true })
          .eq("center_id", cid)
          .in("status", ["awaiting_center", "awaiting_ec"]),
      ]);
      if (all.error) return errorTile(all.error);
      if (decide.error) return errorTile(decide.error);
      return {
        state: "ok",
        value: (all.count ?? 0).toLocaleString(),
        hint: `${(decide.count ?? 0).toLocaleString()} ready for a center or EC decision`,
      };
    })(),
  ]);

  const tiles: { label: string; href: string; tile: Tile; tone: StatTone }[] = [
    { label: "Active member households", href: "/households", tile: households, tone: "navy" },
    { label: "Open pledges", href: "/giving/pledges", tile: pledges, tone: "brown" },
    { label: "Unmatched bank lines", href: "/giving/payments/bank", tile: bank, tone: "success" },
    { label: "QuickBooks exceptions", href: "/accounting/qbo?status=failed", tile: qbo, tone: "danger" },
    { label: "Pending membership applications", href: "/memberships/applications", tile: applications, tone: "purple" },
  ];

  const greeting = session.person?.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={greeting ? `Welcome, ${greeting}` : "Home"}
        description={`What needs attention at ${center.name} today.`}
      />
      <Card title="At a glance" description="Each figure opens the page behind it">
      <KpiGrid cols={5}>
        {tiles.map(({ label, href, tile, tone }) =>
          tile.state === "ok" ? (
            <Stat key={label} label={label} value={tile.value} hint={tile.hint} href={href} tone={tone} />
          ) : tile.state === "error" ? (
            <Stat
              key={label}
              label={label}
              value={<span className="text-xl text-danger">Could not load</span>}
              hint={<span className="text-danger">{tile.message}. Reload to try again.</span>}
              tone="danger"
            />
          ) : (
            <Stat
              key={label}
              label={label}
              value={<span className="text-xl text-muted">No access</span>}
              hint={`Needs ${tile.need}`}
              tone={tone}
            />
          ),
        )}
      </KpiGrid>
      </Card>
      <ApprovalsQueue session={session} />
      <GivingHomeTasks session={session} />
    </>
  );
}
