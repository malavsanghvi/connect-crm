import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Card, EmptyState } from "@/components/ui";
import { daysLeft, lifecycle } from "@/lib/logic/resolutions";
import { formatDate, todayIso } from "@/lib/pathshala/format";
import { load, rows, viewerOf } from "@/lib/pathshala/server";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { LoadProblem, PBadge, PField, PNoAccess, SectionHeading, ViewChips } from "../../ui";
import { saveResolution } from "../actions";
import { LIFECYCLE_TONE } from "../lifecycle-tone";

export const metadata: Metadata = { title: "Resolutions" };

export default async function ResolutionsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const v = viewerOf(await getSession());
  if (!can(v, ["governance.view", "governance.manage"])) return <PNoAccess area="committee resolutions" />;
  const sp = await searchParams;
  const showWithdrawn = sp.view === "withdrawn";
  const supabase = v.db;
  const today = todayIso(v.center.time_zone);

  const res = await load(async () => {
    const list = rows(await supabase.from("resolutions").select("*").eq("center_id", v.center.id).order("created_at", { ascending: false }), "resolutions");
    const votes = list.length
      ? rows(await supabase.from("resolution_votes").select("resolution_id, vote").in("resolution_id", list.map((r) => r.id)), "votes")
      : [];
    return { list, votes };
  });
  if (!res.ok) return <LoadProblem message={res.error} />;
  const { list, votes } = res.data;
  const shown = list.filter((r) => (showWithdrawn ? r.withdrawn_at : !r.withdrawn_at));

  return (
    <>
      <SectionHeading title="Resolutions" description="Comment period, then a vote. Quorum is 4 ballots (abstentions count); a resolution passes only when Yes outnumbers No." />
      <ViewChips
        active={showWithdrawn ? "withdrawn" : "active"}
        tabs={[
          { key: "active", label: "Resolutions", href: "/pathshala/committee/resolutions" },
          { key: "withdrawn", label: "Withdrawn", href: "/pathshala/committee/resolutions?view=withdrawn" },
        ]}
      />
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="lg:col-span-3">
          {shown.length === 0 ? (
            <EmptyState title="Nothing here yet" />
          ) : (
            <ul className="space-y-3">
              {shown.map((r) => {
                const lc = lifecycle(r, votes.filter((x) => x.resolution_id === r.id));
                const open = r.voting_status === "started" ? r.voting_period : r.comment_status === "started" ? r.comment_period : null;
                const left = open ? daysLeft(open, today) : null;
                return (
                  <li key={r.id}>
                    <Card>
                      <div className="flex flex-wrap items-center gap-2">
                        <PBadge tone={LIFECYCLE_TONE[lc]}>{lc}</PBadge>
                        {left !== null && (
                          <PBadge tone={left < 0 ? "danger" : left <= 2 ? "danger" : left <= 5 ? "warning" : left <= 10 ? "caution" : "ok"}>
                            {left < 0 ? `Closed ${-left} days ago` : left === 0 ? "Closes today" : `${left} days left`}
                          </PBadge>
                        )}
                      </div>
                      <Link href={`/pathshala/committee/resolutions/${r.id}`} className="mt-2 block font-display text-lg font-semibold text-navy hover:underline">
                        {r.title}
                      </Link>
                      <p className="text-xs text-muted">Proposed {formatDate(r.created_at)}</p>
                    </Card>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <div className="lg:col-span-2">
          {can(v, "governance.manage") ? (
            <Card title="Propose a resolution">
              <ActionForm buttonsClassName="mt-3" action={saveResolution.bind(null, null)} submitLabel="Create" variant="primary">
                <div className="space-y-3">
                  <PField label="Title">
                    <input name="title" required className="crm-input" />
                  </PField>
                  <PField label="Resolution text">
                    <textarea name="description" rows={5} className="crm-input" />
                  </PField>
                  <PField label="Why">
                    <textarea name="rationale" rows={3} className="crm-input" />
                  </PField>
                  <PField label="Quorum (ballots needed)">
                    <input name="quorum" type="number" min={1} defaultValue={4} className="crm-input" />
                  </PField>
                </div>
              </ActionForm>
            </Card>
          ) : (
            <p className="text-sm text-muted">Committee chairs propose resolutions; members comment and vote.</p>
          )}
        </div>
      </div>
    </>
  );
}
