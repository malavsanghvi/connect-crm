import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Alert, Card, KpiGrid, QueryError, Stat, StatusText } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { ATTESTATIONS, GOLIVE_STATUS_LABEL, goliveProgress } from "@/lib/platform-onboarding";
import { getSession } from "@/lib/session";
import { mergeReadiness } from "@/lib/setup";

import { SetupHeader, setupGate } from "../_components/setup-ui";
import { attestAction, promoteAction, requestGoliveAction } from "./actions";

export const metadata: Metadata = { title: "Go-live · Setup" };

const SUB = "Steps 7–8 · confirm training and the pilot, request go-live, then promote the sandbox to production";

export default async function GoLiveSetupPage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "Go-live");
  if (gate) return gate;
  const { db, center, userId } = session;
  const [ready, att, owner, golive, promos, notices, expiry, inPlace] = await Promise.all([
    db.rpc("readiness", { p_center: center.id }),
    db.from("center_attestations").select("key, attested_at, note").eq("center_id", center.id),
    db.from("center_owners").select("user_id").eq("center_id", center.id).maybeSingle(),
    db.from("golive_requests").select("*").eq("center_id", center.id).order("requested_at", { ascending: false }).limit(1),
    db.from("sandbox_promotions").select("*").eq("sandbox_id", center.id).order("requested_at", { ascending: false }).limit(1),
    db.from("sandbox_expiry_notices").select("threshold_days, notified_at").eq("center_id", center.id).order("notified_at", { ascending: false }).limit(1),
    db.rpc("entitlement", { p_center: center.id, p_key: "expiry_days_inactive" }),
    db.rpc("promotes_in_place", { p_center: center.id }),
  ]);
  const firstError = ready.error ?? att.error ?? owner.error ?? golive.error ?? promos.error;
  if (firstError) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <QueryError what="the go-live status" error={firstError} retryHref="/setup/go-live" />
      </>
    );
  }
  if (notices.error) console.error("[setup/go-live] could not load the expiry notices:", notices.error);
  if (expiry.error) console.error("[setup/go-live] could not read the sandbox expiry (the inactivity warning is shown if one was sent):", expiry.error);
  if (inPlace.error) return (
    <>
      <SetupHeader session={session} sub={SUB} />
      <QueryError what="how this sandbox goes live" error={inPlace.error} retryHref="/setup/go-live" />
    </>
  );
  // expiry_days_inactive: a number of days, or JSON null = never expires (Community Connect's exemption, e.g. JSH).
  const expiryDays = expiry.error ? null : typeof expiry.data === "number" ? expiry.data : null;
  const neverExpires = !expiry.error && expiry.data === null;
  const promotesInPlace = inPlace.data === true;
  const rows = mergeReadiness(ready.data ?? []);
  const failing = rows.filter((r) => r.state === "fail");
  const isOwner = owner.data?.user_id === userId;
  const done = new Map((att.data ?? []).map((a) => [a.key, a]));
  const g = golive.data?.[0] ?? null;
  const promo = promos.data?.[0] ?? null;
  const sandbox = center.environment === "sandbox";
  const tz = center.time_zone;
  const lastNotice = notices.data?.[0] ?? null;

  return (
    <>
      <SetupHeader session={session} sub={SUB} />
      {lastNotice && !neverExpires ? (
        <div className="mb-4">
          <Alert tone="warning" title="This sandbox has been inactive">
            Warned on {formatDateTime(lastNotice.notified_at, tz)} ({lastNotice.threshold_days} days without activity). Sandboxes inactive for {expiryDays ?? 90} days may be removed after the warnings.
          </Alert>
        </div>
      ) : null}
      {sandbox && neverExpires ? (
        <p className="mb-4 text-[13px] text-muted" data-testid="sandbox-never-expires">
          Community Connect has exempted this sandbox from inactivity expiry: it gets no inactivity warnings and is never removed for being quiet.
        </p>
      ) : null}
      <div className="mb-4">
        <KpiGrid cols={3}>
          <Stat label="Readiness checks passing" value={`${rows.filter((r) => r.state === "pass").length} of ${rows.length}`} tone="success" hint="Setup › Go-live readiness" href="/setup/readiness" />
          <Stat label="Go-live request" value={g ? (GOLIVE_STATUS_LABEL[g.status] ?? g.status) : "Not requested"} tone={g?.status === "approved" || g?.status === "live" ? "success" : "ink"} hint={g ? goliveProgress(g) : "Every check must pass first"} />
          <Stat
            label="Production"
            value={promo?.status === "done" ? promo.slug : promo && promo.status !== "failed" ? "Promotion running" : "Not promoted"}
            tone="ink"
            hint={sandbox ? (promotesInPlace ? "Goes live in place; every record is kept" : "Configuration only; data is loaded fresh") : "This is a production organization"}
          />
        </KpiGrid>
      </div>

      <div className="flex flex-col gap-4">
        <Card title="Test, train and pilot" description="Readiness check 13 · the owner confirms each one">
          {!isOwner ? <p className="mb-3 text-[13px] text-muted">Only the organization&apos;s owner confirms these.</p> : null}
          <ul className="flex flex-col gap-3">
            {ATTESTATIONS.map((a) => {
              const d = done.get(a.key);
              return (
                <li key={a.key} data-attestation={a.key} className="flex flex-wrap items-start justify-between gap-3 border-b border-line pb-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="font-bold">{a.label}</p>
                    <p className="text-[13px] text-muted">{a.help}</p>
                    {d ? (
                      <p className="mt-1 text-[12px]">
                        <StatusText tone="ok">Confirmed {formatDateTime(d.attested_at, tz)}</StatusText>
                        {d.note ? <span className="text-muted"> · {d.note}</span> : null}
                      </p>
                    ) : null}
                  </div>
                  {isOwner && !d ? (
                    <ActionForm action={attestAction} submitLabel="Confirm" size="sm" variant="ok" className="flex items-end gap-2">
                      <input type="hidden" name="key" value={a.key} />
                      <input name="note" className="crm-input w-[240px]" maxLength={1000} placeholder="Note (optional)" aria-label={`Note for ${a.label}`} />
                    </ActionForm>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Card>

        <Card title="Request go-live" description="Community Connect reviews the readiness evidence; two different people approve">
          {g && g.status !== "rejected" ? (
            <div className="text-[13px]" data-testid="golive-status">
              <p>
                Requested {formatDateTime(g.requested_at, tz)} · <strong>{GOLIVE_STATUS_LABEL[g.status] ?? g.status}</strong> · {goliveProgress(g)}
              </p>
              {g.note ? <p className="mt-1 text-muted">Note from Community Connect: {g.note}</p> : null}
            </div>
          ) : (
            <>
              {g?.status === "rejected" ? (
                <div className="mb-3">
                  <Alert tone="warning" title="Community Connect sent the last request back">
                    {g.note}
                  </Alert>
                </div>
              ) : null}
              {failing.length > 0 ? (
                <div className="mb-3">
                  <Alert tone="info" title={`${failing.length} readiness check${failing.length === 1 ? "" : "s"} do not pass yet`}>
                    <ul className="list-disc pl-4">
                      {failing.map((r) => (
                        <li key={r.key}>
                          {r.title}: {r.detail}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                </div>
              ) : null}
              {isOwner ? (
                <ActionForm action={requestGoliveAction} submitLabel="Request go-live" confirmMessage="Ask Community Connect to approve going live?\nThey see every readiness check with its evidence.">
                  <span />
                </ActionForm>
              ) : (
                <p className="text-[13px] text-muted">Only the organization&apos;s owner requests go-live.</p>
              )}
            </>
          )}
        </Card>

        {sandbox && promotesInPlace ? (
          <Card
            title="Go live in place"
            description={`${center.name} holds its own records, so going live switches this organization itself to production: same web name, every person, household, payment and setting kept, and the same staff. Nothing is copied or removed.`}
          >
            <div data-testid="promote-in-place" className="text-[13px]">
              {promo && promo.status !== "failed" ? (
                promo.status === "done" ? (
                  <StatusText tone="ok">Went live on {formatDateTime(promo.finished_at, tz)}</StatusText>
                ) : (
                  <StatusText tone="warn">
                    Going live is running in the background{promo.last_error ? ` (last try failed: ${promo.last_error}; it will retry)` : ""}. Reload to see progress.
                  </StatusText>
                )
              ) : g?.status === "approved" && isOwner ? (
                <>
                  {promo?.status === "failed" ? (
                    <p className="mb-2">
                      <StatusText tone="bad">The last try failed: {promo.last_error ?? "no reason recorded"}</StatusText>
                    </p>
                  ) : null}
                  <p className="mb-2 text-muted">
                    After going live: messages reach every member who opted in, payments and QuickBooks can be switched to live mode (Settings › Payments, Accounting › QuickBooks), the public dashboard opens and the
                    sandbox watermark disappears. Demo data must not be loaded.
                  </p>
                  <ActionForm action={promoteAction} submitLabel="Go live in place" variant="ok" confirmMessage={`Switch ${center.name} to production?\nEvery record is kept. Sandbox limits end and messages reach real members.`}>
                    <input type="hidden" name="slug" value={center.slug} />
                    <label className="crm-label" htmlFor="promote-reason">
                      Reason
                    </label>
                    <input id="promote-reason" name="reason" className="crm-input mb-3" maxLength={500} defaultValue="Go-live approved by Community Connect" />
                  </ActionForm>
                </>
              ) : (
                <p className="text-muted">Available to the owner once Community Connect has approved go-live.</p>
              )}
            </div>
          </Card>
        ) : sandbox ? (
          <Card title="Promote to production" description="Copies the configuration — profile, brand, rules, modules, setup data, templates, legal documents, custom fields and saved import mappings. Never test people, transactions or credentials. Staff are invited again.">
            {promo ? (
              <div className="text-[13px]" data-testid="promotion-status">
                {promo.status === "done" ? (
                  <StatusText tone="ok">Promoted to {promo.slug} on {formatDateTime(promo.finished_at, tz)}</StatusText>
                ) : promo.status === "failed" ? (
                  <StatusText tone="bad">The promotion failed: {promo.last_error ?? "no reason recorded"}</StatusText>
                ) : (
                  <StatusText tone="warn">
                    Promotion to {promo.slug} is running in the background{promo.last_error ? ` (last try failed: ${promo.last_error}; it will retry)` : ""}. Reload to see progress.
                  </StatusText>
                )}
                {promo.status === "done" ? (
                  <p className="mt-2 text-muted">
                    Next: reconnect every service in live mode in the production organization, load the final data with the saved mappings, and re-send the staff invitations from Settings › Team.
                  </p>
                ) : null}
              </div>
            ) : g?.status === "approved" && isOwner ? (
              <ActionForm action={promoteAction} submitLabel="Promote to production" variant="ok" confirmMessage="Create the production organization from this sandbox's configuration?\nTest people, transactions and credentials are not copied.">
                <label className="crm-label" htmlFor="promote-slug">
                  Production web name
                </label>
                <input id="promote-slug" name="slug" className="crm-input mb-2 font-mono" defaultValue={center.slug.replace(/-sandbox$/, "")} />
                <label className="crm-label" htmlFor="promote-reason">
                  Reason
                </label>
                <input id="promote-reason" name="reason" className="crm-input mb-3" maxLength={500} defaultValue="Go-live approved by Community Connect" />
              </ActionForm>
            ) : (
              <p className="text-[13px] text-muted">Available to the owner once Community Connect has approved go-live.</p>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
