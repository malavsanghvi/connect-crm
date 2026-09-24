import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { buttonClass, Card } from "@/components/ui";
import { canStartVoting, lifecycle, parseDateRange, periodOpen, tallyVotes, type VoteHistoryEntry } from "@/lib/logic/resolutions";
import { formatDate, formatDateTime, todayIso } from "@/lib/pathshala/format";
import { load, resolveUserNames, row, rows, viewerOf } from "@/lib/pathshala/server";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { ActionButton, Details, FormGrid, LoadProblem, Notice, PBadge, PField, PNoAccess, PStat, SectionHeading } from "../../../ui";
import { addComment, castVote, editComment, saveOutcome, saveResolution, setPeriod, setWithdrawn } from "../../actions";
import { LIFECYCLE_TONE } from "../../lifecycle-tone";

export const metadata: Metadata = { title: "Resolution" };

function PeriodControls({ id, kind, status, allowStart }: { id: string; kind: "comment" | "voting"; status: string; allowStart: boolean }) {
  const act = setPeriod.bind(null, id, kind);
  if (status === "not_started") {
    if (!allowStart) return <p className="text-sm text-muted">Voting can open once the comment period is closed.</p>;
    return (
      <ActionForm buttonsClassName="mt-3" action={act} submitLabel={kind === "comment" ? "Open comments" : "Open voting"} variant="primary">
        <input type="hidden" name="to" value="started" />
        <FormGrid>
          <PField label="Opens on">
            <input type="date" name="start" defaultValue={new Date().toISOString().slice(0, 10)} className="crm-input" />
          </PField>
          <PField label="Closes on">
            <input type="date" name="end" required className="crm-input" />
          </PField>
        </FormGrid>
      </ActionForm>
    );
  }
  if (status === "completed") return null;
  return (
    <div className="flex flex-wrap gap-2">
      {status === "started" && <ActionButton action={act} fields={{ to: "paused" }} label="Pause" />}
      {status === "paused" && <ActionButton action={act} fields={{ to: "started" }} label="Resume" />}
      <ActionButton action={act} fields={{ to: "completed" }} label="Close now" variant="bad" confirm={`Close the ${kind === "comment" ? "comment" : "voting"} period now?`} />
    </div>
  );
}

export default async function ResolutionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const v = viewerOf(await getSession());
  if (!can(v, ["governance.view", "governance.manage"])) return <PNoAccess area="committee resolutions" />;
  const supabase = v.db;
  const tz = v.center.time_zone;
  const today = todayIso(tz);

  const res = await load(async () => {
    const r = row(await supabase.from("resolutions").select("*").eq("id", id).maybeSingle(), "the resolution");
    if (!r) return null;
    const [comments, votes] = await Promise.all([
      supabase.from("resolution_comments").select("*").eq("resolution_id", id).order("created_at"),
      supabase.from("resolution_votes").select("*").eq("resolution_id", id).order("voted_at"),
    ]);
    const c = rows(comments, "comments");
    const vt = rows(votes, "votes");
    const names = await resolveUserNames(supabase, v.center.id, [...c.map((x) => x.author_user), ...vt.map((x) => x.voter_user), r.created_by]);
    return { r, comments: c, votes: vt, names };
  });
  if (!res.ok) return <LoadProblem message={res.error} />;
  if (!res.data) notFound();
  const { r, comments, votes, names } = res.data;
  const who = (uid: string | null) => (uid === v.userId ? "You" : uid ? (names.get(uid) ?? "Committee member") : "—");
  const lc = lifecycle(r, votes);
  const tally = tallyVotes(votes);
  const quorum = r.quorum || 4;
  const manage = can(v, "governance.manage");
  const commentsOpen = !r.withdrawn_at && periodOpen(r.comment_status, r.comment_period, today);
  const votingOpen = !r.withdrawn_at && periodOpen(r.voting_status, r.voting_period, today);
  const myVote = votes.find((x) => x.voter_user === v.userId);
  const cp = parseDateRange(r.comment_period);
  const vp = parseDateRange(r.voting_period);

  return (
    <>
      <SectionHeading
        title={r.title}
        back={{ href: "/pathshala/committee/resolutions", label: "Resolutions" }}
        description={
          <span className="flex flex-wrap items-center gap-2">
            <PBadge tone={LIFECYCLE_TONE[lc]}>{lc}</PBadge> Proposed by {who(r.created_by)} on {formatDate(r.created_at)}
          </span>
        }
      />
      {r.withdrawn_at && (
        <div className="mb-4">
          <Notice tone="warning">Withdrawn {formatDateTime(r.withdrawn_at, tz)}. Comments and votes are kept for the record.</Notice>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          <Card title="Resolution">
            <p className="whitespace-pre-line text-sm">{r.description ?? "—"}</p>
            {r.rationale && (
              <>
                <h3 className="mt-4 text-sm font-semibold">Why</h3>
                <p className="whitespace-pre-line text-sm">{r.rationale}</p>
              </>
            )}
            {manage && r.voting_status !== "completed" && !r.withdrawn_at && (
              <div className="mt-4">
                <Details summary="Edit text">
                  <ActionForm buttonsClassName="mt-3" action={saveResolution.bind(null, r.id)} submitLabel="Save">
                    <div className="space-y-3">
                      <PField label="Title">
                        <input name="title" required defaultValue={r.title} className="crm-input" />
                      </PField>
                      <PField label="Resolution text">
                        <textarea name="description" rows={5} defaultValue={r.description ?? ""} className="crm-input" />
                      </PField>
                      <PField label="Why">
                        <textarea name="rationale" rows={3} defaultValue={r.rationale ?? ""} className="crm-input" />
                      </PField>
                      <PField label="Quorum">
                        <input name="quorum" type="number" min={1} defaultValue={quorum} className="crm-input" />
                      </PField>
                    </div>
                  </ActionForm>
                </Details>
              </div>
            )}
          </Card>

          <Card
            title="Comments"
            description={
              r.comment_status === "not_started"
                ? "Comment period not opened yet."
                : `${cp.start ? formatDate(cp.start) : "?"} – ${cp.end ? formatDate(cp.end) : "?"} · ${r.comment_status.replace("_", " ")}`
            }
          >
            {comments.length === 0 ? (
              <p className="text-sm text-muted">No comments.</p>
            ) : (
              <ul className="space-y-3">
                {comments.map((c) => (
                  <li key={c.id} className="rounded-lg bg-ground p-3 text-sm">
                    <p className="whitespace-pre-line">{c.body}</p>
                    <p className="mt-1 text-xs text-muted">
                      {who(c.author_user)} · {formatDateTime(c.created_at, tz)}
                      {c.edited_at ? " · edited" : ""}
                    </p>
                    {commentsOpen && c.author_user === v.userId && (
                      <div className="mt-2">
                        <Details summary="Edit or delete">
                          <ActionForm buttonsClassName="mt-3"
                            action={editComment.bind(null, c.id)}
                            submitLabel="Save"
                            extraButtons={
                              <button type="submit" name="intent" value="delete" className={buttonClass("bad")}>
                                Delete
                              </button>
                            }
                          >
                            <textarea name="body" rows={3} defaultValue={c.body} className="crm-input" aria-label="Your comment" />
                          </ActionForm>
                        </Details>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {commentsOpen && (
              <div className="mt-4">
                <ActionForm buttonsClassName="mt-3" action={addComment.bind(null, r.id)} submitLabel="Add comment" resetOnSuccess>
                  <textarea name="body" rows={3} required className="crm-input" aria-label="Your comment" />
                </ActionForm>
              </div>
            )}
            {manage && !r.withdrawn_at && (
              <div className="mt-4 border-t border-line pt-4">
                <PeriodControls id={r.id} kind="comment" status={r.comment_status} allowStart={r.voting_status === "not_started"} />
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4 lg:col-span-2">
          <Card
            title="Vote"
            description={
              r.voting_status === "not_started"
                ? "Voting not opened yet."
                : `${vp.start ? formatDate(vp.start) : "?"} – ${vp.end ? formatDate(vp.end) : "?"} · ${r.voting_status.replace("_", " ")}`
            }
          >
            <div className="grid grid-cols-3 gap-2">
              <PStat label="Yes" value={tally.yes} tone="success" />
              <PStat label="No" value={tally.no} tone="danger" />
              <PStat label="Abstain" value={tally.abstain} tone="navy" />
            </div>
            <p className="mt-3 text-sm" aria-live="polite">
              <strong>{tally.total}</strong> of {quorum} ballots needed for quorum{" "}
              {tally.total >= quorum ? <PBadge tone="success">Quorum met</PBadge> : <PBadge tone="warning">{quorum - tally.total} more needed</PBadge>}
            </p>
            {r.voting_status === "completed" && (
              <div className="mt-3">
                <Notice tone={lc === "Closed – passed" ? "success" : lc === "Closed – failed" ? "danger" : "warning"}>
                  {lc === "Closed – passed"
                    ? `Passed: ${tally.yes} yes, ${tally.no} no.`
                    : lc === "Closed – failed"
                      ? `Failed: ${tally.yes} yes, ${tally.no} no (Yes must outnumber No).`
                      : `No quorum: only ${tally.total} of ${quorum} ballots were cast.`}
                </Notice>
              </div>
            )}
            {votingOpen && can(v, "governance.vote") && (
              <div className="mt-4">
                <ActionForm buttonsClassName="mt-3" action={castVote.bind(null, r.id)} submitLabel={myVote ? "Change my vote" : "Cast my vote"} >
                  <fieldset>
                    <legend className="mb-2 text-sm font-semibold">{myVote ? `Your vote: ${myVote.vote}` : "Your vote"}</legend>
                    <div className="grid grid-cols-3 gap-2">
                      {(["yes", "no", "abstain"] as const).map((opt) => (
                        <label key={opt} className="flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-line bg-white font-semibold has-[:checked]:border-navy has-[:checked]:bg-navy-50">
                          <input type="radio" name="vote" value={opt} required defaultChecked={myVote?.vote === opt} className="h-5 w-5 accent-navy" />
                          {opt[0].toUpperCase() + opt.slice(1)}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <PField label="Reason (optional)" className="mt-3">
                    <input name="reason" defaultValue={myVote?.reason ?? ""} className="crm-input" />
                  </PField>
                </ActionForm>
              </div>
            )}
            {votingOpen && !can(v, "governance.vote") && <p className="mt-3 text-sm text-muted">Only current committee members can vote.</p>}
            {manage && !r.withdrawn_at && (
              <div className="mt-4 border-t border-line pt-4">
                <PeriodControls id={r.id} kind="voting" status={r.voting_status} allowStart={canStartVoting(r, today)} />
              </div>
            )}
            {votes.length > 0 && (
              <div className="mt-4">
                <Details summary={`Vote log (${votes.length})`}>
                  <ul className="space-y-2 text-sm">
                    {votes.map((x) => {
                      const history = Array.isArray(x.vote_history) ? (x.vote_history as VoteHistoryEntry[]) : [];
                      return (
                        <li key={x.id}>
                          <strong>{who(x.voter_user)}</strong>: {x.vote} · {formatDateTime(x.voted_at, tz)}
                          {x.reason ? ` — ${x.reason}` : ""}
                          {history.length > 0 && (
                            <ul className="ml-4 text-xs text-muted">
                              {history.map((h, i) => (
                                <li key={i}>
                                  earlier: {h.vote} · {formatDateTime(h.voted_at, tz)}
                                  {h.reason ? ` — ${h.reason}` : ""}
                                </li>
                              ))}
                            </ul>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Details>
              </div>
            )}
          </Card>

          {r.voting_status === "completed" && (
            <Card title="Outcome note">
              {manage ? (
                <ActionForm buttonsClassName="mt-3" action={saveOutcome.bind(null, r.id)} submitLabel="Save outcome note">
                  <textarea name="outcome_note" rows={4} defaultValue={r.outcome_note ?? ""} className="crm-input" aria-label="Outcome note" />
                </ActionForm>
              ) : (
                <p className="whitespace-pre-line text-sm">{r.outcome_note ?? "—"}</p>
              )}
            </Card>
          )}

          {manage && (
            <Card title={r.withdrawn_at ? "Restore" : "Withdraw"}>
              {r.withdrawn_at ? (
                <ActionButton action={setWithdrawn.bind(null, r.id)} fields={{ withdraw: "0" }} label="Restore resolution" />
              ) : r.voting_status !== "completed" ? (
                <ActionButton
                  action={setWithdrawn.bind(null, r.id)}
                  fields={{ withdraw: "1" }}
                  label="Withdraw resolution"
                  variant="bad"
                  confirm="Withdraw this resolution? Its comments and votes stay on record."
                />
              ) : (
                <p className="text-sm text-muted">Voting has closed; it can no longer be withdrawn.</p>
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
