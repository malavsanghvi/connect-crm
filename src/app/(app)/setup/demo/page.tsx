import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { AutoRefresh } from "@/components/events/auto-refresh";
import { Alert, Card, KpiGrid, QueryError, Stat, StatusText, TableWrap } from "@/components/ui";
import type { Json } from "@/lib/database.types";
import { formatDateTime } from "@/lib/dates";
import {
  countsOf,
  DEMO_ONLY_SANDBOX,
  DEMO_STATUS_LABEL,
  demoConfirmWord,
  demoProgress,
  demoStatus,
  isDemoBusy,
  moduleCount,
  moduleSummary,
  packModules,
} from "@/lib/demo";
import { getSession } from "@/lib/session";
import { backgroundServiceView } from "@/lib/vault";

import { ProgressBar, SetupHeader, setupGate } from "../_components/setup-ui";
import { activateDemoAction, clearSandboxAction, resetSandboxAction } from "./actions";

export const metadata: Metadata = { title: "Demo data · Setup" };

const SUB = "try every module with a realistic demo community · sandbox only";

const KEPT = [
  "the organization itself, its owner and every staff login with a role (and their own records)",
  "role grants, agreements, the profile, brand kit and leaders",
  "connections and credentials (payments, email, texting, QuickBooks)",
  "module switches, numbering, templates, legal documents and saved import mappings",
  "the Setup checklist, go-live records and the audit log (never deleted)",
];

export default async function DemoDataPage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "Demo data");
  if (gate) return gate;
  const { db, center } = session;
  const tz = center.time_zone;

  const problem = await db.rpc("demo_center_problem", { p_center: center.id });
  if (problem.error) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <QueryError what="whether this organization can hold demo data" error={problem.error} retryHref="/setup/demo" />
      </>
    );
  }
  // Production (or a live or promoted sandbox): nothing to offer, and the database refuses anyway.
  if (center.environment !== "sandbox" || problem.data) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <div data-testid="demo-refused">
          <Alert tone="info" title={DEMO_ONLY_SANDBOX}>
            {problem.data ?? `${center.name} is a production organization, so its data can never be cleared or replaced with demo data.`}
          </Alert>
        </div>
      </>
    );
  }

  const [packs, state, counts, service] = await Promise.all([
    db.from("demo_packs").select("key, version, title, description, contents").eq("active", true).order("key"),
    db.from("center_demo_state").select("*").eq("center_id", center.id).maybeSingle(),
    db.rpc("demo_data_counts", { p_center: center.id }),
    db.rpc("background_service_status", { p_center: center.id }),
  ]);
  const firstError = packs.error ?? state.error ?? counts.error;
  if (firstError) {
    return (
      <>
        <SetupHeader session={session} sub={SUB} />
        <QueryError what="the demo data" error={firstError} retryHref="/setup/demo" />
      </>
    );
  }
  if (service.error) console.error("[setup/demo] could not read the background service status:", service.error);
  const pack = packs.data?.find((p) => p.key === (state.data?.pack_key ?? "community")) ?? packs.data?.[0] ?? null;
  const s = state.data;
  const status = demoStatus(s?.status);
  const busy = isDemoBusy(status);
  const progress = demoProgress(s ? { status: s.status, steps_done: s.steps_done, steps_total: s.steps_total } : null);
  const modules = packModules(pack?.contents);
  const now = countsOf(counts.data);
  const detail: { [key: string]: Json | undefined } = s?.detail && typeof s.detail === "object" && !Array.isArray(s.detail) ? s.detail : {};
  const loaded = countsOf(detail.loaded);
  const cleared = detail.cleared && typeof detail.cleared === "object" && !Array.isArray(detail.cleared) ? detail.cleared : null;
  const word = demoConfirmWord(center);
  const svc = service.error ? null : backgroundServiceView(service.data);
  const off = new Set(session.modulesOff);
  const lastRun = s?.loaded_at && (!s.cleared_at || s.loaded_at > s.cleared_at) ? `Loaded ${formatDateTime(s.loaded_at, tz)}` : s?.cleared_at ? `Cleared ${formatDateTime(s.cleared_at, tz)}` : "Never";

  return (
    <>
      <SetupHeader session={session} sub={SUB} />
      <div className="mb-4">
        <KpiGrid cols={4}>
          <Stat label="Demo data" value={DEMO_STATUS_LABEL[status]} tone={status === "loaded" ? "success" : status === "failed" ? "danger" : busy ? "saffron" : "ink"} hint={pack ? `${pack.title} · version ${pack.version}` : "No pack available"} />
          <Stat label="Last run" value={lastRun} tone="ink" hint={s?.reason ? `Reason: ${s.reason}` : "Every run is in the audit log"} />
          <Stat label="People in this sandbox" value={(now.people ?? 0).toLocaleString("en-US")} tone="navy" hint={`${(now.households ?? 0).toLocaleString("en-US")} households`} />
          <Stat
            label="Background service"
            value={svc ? svc.label : "Unknown"}
            tone={svc?.tone === "ok" ? "success" : svc?.tone === "bad" ? "danger" : "saffron"}
            hint={svc ? svc.detail : "Could not read its status; loading still waits in the queue until it runs."}
          />
        </KpiGrid>
      </div>

      <div className="flex flex-col gap-4">
        {busy ? (
          <Card title={status === "clearing" ? "Clearing the sandbox" : "Loading the demo pack"} description={s?.step_label ?? undefined}>
            <div data-testid="demo-progress" data-status={status} className="flex flex-col gap-2 text-[13px]">
              {status === "loading" ? <ProgressBar done={s?.steps_done ?? 0} total={s?.steps_total ?? 0} label="Demo pack" /> : null}
              <p className="text-muted">
                {progress.text}
                {s?.requested_at ? ` · asked ${formatDateTime(s.requested_at, tz)}` : ""}
                {s?.operation === "reset" ? " · reset: clear, then load again" : ""}
              </p>
              {s?.last_error ? (
                <p>
                  <StatusText tone="warn">The last try failed and will be retried: {s.last_error}</StatusText>
                </p>
              ) : null}
              {svc && svc.state !== "running" ? (
                <Alert tone="warning" title={svc.label}>
                  {svc.detail}
                </Alert>
              ) : null}
              <AutoRefresh seconds={3} timeZone={tz} />
            </div>
          </Card>
        ) : null}

        {status === "failed" ? (
          <Alert tone="danger" title="The last demo data run failed">
            <span data-testid="demo-failed">{s?.last_error ?? "No reason was recorded."}</span> Reset the sandbox to start again from a clean slate.
          </Alert>
        ) : null}

        <Card
          title={pack ? `What the ${pack.title.toLowerCase()} pack contains` : "Demo pack"}
          description={pack?.description ?? "No demo pack is available."}
          padded={false}
        >
          <TableWrap>
            <table className="crm-table" aria-label="What the demo pack contains">
              <thead>
                <tr>
                  <th>Module</th>
                  <th>What the pack loads</th>
                  <th className="text-right">Rows in the pack</th>
                  <th className="text-right">In this sandbox now</th>
                </tr>
              </thead>
              <tbody>
                {modules.map((m) => (
                  <tr key={m.module} data-module={m.module}>
                    <td className="whitespace-nowrap font-bold">
                      {m.label}
                      {off.has(m.module) ? <p className="text-[11px] font-semibold text-faint">switched off · skipped or hidden</p> : null}
                    </td>
                    <td className="text-[13px] text-muted">{moduleSummary(m, 5)}</td>
                    <td className="text-right tabular-nums">{m.total.toLocaleString("en-US")}</td>
                    <td className="text-right tabular-nums" data-testid={`now-${m.module}`}>
                      {moduleCount(m, now).toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
          <p className="px-2.5 pb-2 pt-2 text-[12px] text-muted">
            Names are made up and every e-mail address ends in @demo.communityconnect.test. Dates are set from the day the pack is loaded, so upcoming events stay upcoming. Payments are recorded
            as history (never sent to QuickBooks) and allocated by the usual rules; nothing is charged or sent.
          </p>
        </Card>

        <Card title="Load, reset or clear" description="Everything runs in the background; this page shows the progress. Each run is in the audit log with your reason.">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-2" data-testid="demo-activate">
              <h3 className="font-bold">Load the demo pack</h3>
              <p className="text-[13px] text-muted">Adds the demo community next to anything you have entered. Loading takes about a minute.</p>
              {status === "loaded" ? (
                <p className="text-[13px]">
                  <StatusText tone="ok">Loaded.</StatusText> To start over, reset the sandbox.
                </p>
              ) : (
                <ActionForm action={activateDemoAction} submitLabel="Load demo data" variant="ok" submitDisabled={busy || !pack}>
                  <input type="hidden" name="pack" value={pack?.key ?? ""} />
                  <label className="crm-label" htmlFor="demo-activate-reason">
                    Reason
                  </label>
                  <input id="demo-activate-reason" name="reason" className="crm-input mb-2" maxLength={500} defaultValue="Try every module with demo data" />
                </ActionForm>
              )}
            </div>
            <div className="flex flex-col gap-2" data-testid="demo-reset">
              <h3 className="font-bold">Reset the sandbox</h3>
              <p className="text-[13px] text-muted">Clears the sandbox (see what clearing keeps), then loads the demo pack again, so every count returns to the pack&apos;s. Needs a fresh 2FA check.</p>
              <ActionForm
                action={resetSandboxAction}
                submitLabel="Reset sandbox"
                variant="bad"
                submitDisabled={busy || !pack}
                confirmMessage={`Reset ${center.short_name || center.name}?\nEvery person, household, payment and setting typed into this sandbox is removed, then the demo pack is loaded again. This cannot be undone.`}
              >
                <input type="hidden" name="pack" value={pack?.key ?? ""} />
                <label className="crm-label" htmlFor="demo-reset-confirm">
                  Type <span className="font-mono">{word}</span> to confirm
                </label>
                <input id="demo-reset-confirm" name="confirm" className="crm-input mb-2 font-mono" autoComplete="off" />
                <label className="crm-label" htmlFor="demo-reset-reason">
                  Reason
                </label>
                <input id="demo-reset-reason" name="reason" className="crm-input mb-2" maxLength={500} defaultValue="Start the training again" />
              </ActionForm>
            </div>
            <div className="flex flex-col gap-2" data-testid="demo-clear">
              <h3 className="font-bold">Clear the sandbox</h3>
              <p className="text-[13px] text-muted">Removes the demo data and everything else entered here, and loads nothing, ready for your own data. Needs a fresh 2FA check.</p>
              <ActionForm
                action={clearSandboxAction}
                submitLabel="Clear sandbox"
                variant="bad"
                submitDisabled={busy}
                confirmMessage={`Clear ${center.short_name || center.name}?\nEvery person, household, payment and setting typed into this sandbox is removed. This cannot be undone.`}
              >
                <label className="crm-label" htmlFor="demo-clear-confirm">
                  Type <span className="font-mono">{word}</span> to confirm
                </label>
                <input id="demo-clear-confirm" name="confirm" className="crm-input mb-2 font-mono" autoComplete="off" />
                <label className="crm-label" htmlFor="demo-clear-reason">
                  Reason
                </label>
                <input id="demo-clear-reason" name="reason" className="crm-input mb-2" maxLength={500} defaultValue="Make room for our own data" />
              </ActionForm>
            </div>
          </div>
          <div className="mt-4 rounded-[10px] bg-ground px-4 py-3 text-[13px]">
            <p className="font-bold">What clearing keeps</p>
            <ul className="mt-1 list-disc pl-5 text-muted">
              {KEPT.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <p className="mt-2 text-muted">
              Everything else is removed: setup data (zones, funds, membership types, store, Pathshala …), people and households, and all history and transactions. Only sandboxes can be cleared — the
              database refuses it for a production organization.
            </p>
          </div>
          {cleared && typeof cleared.removed_total === "number" ? (
            <p className="mt-3 text-[12px] text-muted">
              Last clear removed {cleared.removed_total.toLocaleString("en-US")} records
              {typeof cleared.kept_logins === "number" ? ` and kept ${cleared.kept_logins} staff login${cleared.kept_logins === 1 ? "" : "s"}` : ""}.
            </p>
          ) : null}
          {status === "loaded" && Object.keys(loaded).length > 0 ? (
            <p className="mt-1 text-[12px] text-muted" data-testid="demo-loaded-total">
              Last load added {Object.values(loaded).reduce((a, b) => a + b, 0).toLocaleString("en-US")} records.
            </p>
          ) : null}
        </Card>

        <Card title="See it as a member" description="The member app shows the demo community to demo members">
          <div className="text-[13px]">
            <p>
              Demo members include <span className="font-mono">priya.shah@demo.communityconnect.test</span> (a parent with two children in Pathshala),{" "}
              <span className="font-mono">kiran.mehta@demo.communityconnect.test</span> and <span className="font-mono">neha.mehta@demo.communityconnect.test</span> (a teacher).
            </p>
            <p className="mt-2 text-muted">
              These are not real inboxes, so their sign-in codes can only be read on a local test stack. To try the member app yourself, open the sandbox with its join code (
              <Link href="/settings/member-app" className="crm-link">
                Settings › Member app
              </Link>
              ) and give one demo person your own e-mail address in People — a reset puts the demo address back.
            </p>
          </div>
        </Card>
      </div>
    </>
  );
}
