import Link from "next/link";

import { Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { daysSince } from "@/lib/platform-onboarding";
import { reportReads } from "@/lib/reports/load";
import { recordingWords, waitingKind } from "@/lib/reports/platform-words";
import type { AppSupabase } from "@/lib/supabase/server";

/**
 * The Weaver team's inbox on the Platform home: who is waiting for the team, and what is missing, across every community
 * (migration 0673: one read, security invoker, platform admins only). The same answer is what Niva reads for the team
 * (platform.waiting). A community's consent states sit under it: has its administrator agreed to record how the portal is
 * used, and is support access open.
 */
export async function WaitingCard({ db, timeZone }: { db: AppSupabase; timeZone: string }) {
  const res = await reportReads.platformWaiting(db, 12);
  if (!res.ok) {
    console.error("[platform] could not read who is waiting:", res.error);
    return (
      <div className="mb-4">
        <QueryError what="who is waiting for the team" error={res.error} retryHref="/platform" />
      </div>
    );
  }
  const w = res.value;
  const total = w.counts.golive + w.counts.promote + w.counts.verification + w.counts.accessRequests + w.counts.readiness;
  const notAgreed = w.consent.filter((k) => k.activityRecording === "not_agreed").length;
  return (
    <div className="mb-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card
        title="Waiting for the team"
        description={
          total === 0
            ? "Nobody is waiting for the team right now."
            : `${w.counts.golive} go-live ${w.counts.golive === 1 ? "request" : "requests"} · ${w.counts.promote} approved · ${w.counts.verification} nonprofit ${w.counts.verification === 1 ? "paper" : "papers"} · ${w.counts.accessRequests} new ${w.counts.accessRequests === 1 ? "request" : "requests"} · ${w.counts.readiness} with checks failing`
        }
        padded={false}
      >
        {w.items.length === 0 ? (
          <div className="p-4">
            <EmptyState title="All clear" />
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Waiting for the team">
              <thead>
                <tr>
                  <th>Community</th>
                  <th>What is waiting</th>
                  <th>Since</th>
                  <th>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {w.items.map((i, n) => {
                  const kind = waitingKind(i.kind);
                  const days = daysSince(i.since);
                  return (
                    <tr key={`${i.kind}-${i.centerId ?? i.community}-${n}`} data-waiting={i.kind}>
                      <td className="font-bold">
                        {i.community}
                        {i.slug ? <p className="font-mono text-[11px] font-normal text-muted">{i.slug}</p> : null}
                      </td>
                      <td className="text-[13px]">
                        <StatusText tone="warn">{kind.label}</StatusText>
                        <p className="text-muted">{i.detail}</p>
                        {i.more.length > 0 ? (
                          <ul className="mt-1 list-disc pl-4 text-[12px] text-muted">
                            {i.more.map((m) => (
                              <li key={m}>{m}</li>
                            ))}
                          </ul>
                        ) : null}
                      </td>
                      <td className="whitespace-nowrap text-[13px]">
                        {i.since ? formatDate(i.since, timeZone) : "—"}
                        {days !== null && days > 0 ? <p className="text-[11px] text-muted">{days} {days === 1 ? "day" : "days"}</p> : null}
                      </td>
                      <td className="text-right">
                        <Link href={kind.where.href} className="crm-link text-[13px] font-semibold">
                          Open
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
      <Card
        title="Consent states"
        description={notAgreed === 0 ? "Every community has agreed to record how the portal is used." : `${notAgreed} ${notAgreed === 1 ? "community has" : "communities have"} not agreed yet to record how the portal is used.`}
        padded={false}
      >
        {w.consent.length === 0 ? (
          <div className="p-4">
            <EmptyState title="No communities yet" />
          </div>
        ) : (
          <TableWrap>
            <table className="crm-table" aria-label="Consent states">
              <thead>
                <tr>
                  <th>Community</th>
                  <th>Recording</th>
                  <th>Shared with Weaver</th>
                  <th>Support access</th>
                </tr>
              </thead>
              <tbody>
                {w.consent.map((k) => (
                  <tr key={k.centerId}>
                    <td className="font-bold">{k.community}</td>
                    <td className="text-[13px]">{recordingWords(k.activityRecording)}</td>
                    <td className="text-[13px]">{k.sharesWithWeaver ? "Yes" : "No"}</td>
                    <td className="text-[13px]">{k.supportAccessUntil ? `Open until ${formatDate(k.supportAccessUntil, timeZone)}` : "None open"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        )}
      </Card>
    </div>
  );
}
