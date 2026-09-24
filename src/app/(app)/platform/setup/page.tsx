import type { Metadata } from "next";
import { headers } from "next/headers";
import Link from "next/link";
import type { ReactNode } from "react";

import { CopyButton } from "@/components/copy-button";
import { Alert, Card, PageHeader, StatusText, TableWrap, Tag } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { readPublicEnv } from "@/lib/env";
import { callbackUrls, setupProgress, STEPS, type StepKey } from "@/lib/platform-setup/catalog";
import { loadSetupView, type FieldView, type SetupView, type StepView } from "@/lib/platform-setup/view";
import { getSession } from "@/lib/session";

import { PlatformNoAccess } from "../platform-no-access";

import { AutoRefresh, FieldButton, HookTestButton, LaterButton, StepActions, TestButton } from "./setup-client";

export const metadata: Metadata = { title: "Platform setup" };
export const dynamic = "force-dynamic";

// The Community Connect super admin's first-sign-in wizard (onboarding Wave D):
// every platform provider and piece of infrastructure, each with what it is,
// why, its live status, its fields, a Test, Save, and Park for later (optional
// steps only). Values saved here are read by the background service and the
// portal server from the database first, the environment second.

export default async function PlatformSetupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const session = await getSession();
  const header = <PageHeader title="Platform setup" description="Community Connect's own providers and infrastructure · keys live in the vault, only their last 4 characters show" />;
  if (!session.isPlatformAdmin) {
    return (
      <>
        {header}
        <PlatformNoAccess />
      </>
    );
  }
  const sp = await searchParams;
  const loaded = await loadSetupView(session);
  if (!loaded.ok) {
    return (
      <>
        {header}
        <Alert tone="danger" title="Could not load the platform setup">
          {loaded.error}. <Link href="/platform/setup" className="font-bold underline">Try again</Link>
        </Alert>
      </>
    );
  }
  const view = loaded.view;
  const wanted = typeof sp.step === "string" ? sp.step : null;
  const current = view.steps.find((s) => s.key === wanted) ?? view.steps.find((s) => s.required && s.status !== "done") ?? view.steps.find((s) => s.status === "not_started") ?? view.steps[0]!;
  const progress = setupProgress(view.steps);
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  const portalUrl = view.portalDomain ? `https://${view.portalDomain}` : `${proto}://${host}`;
  const tz = session.center.time_zone;

  return (
    <>
      {header}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {view.complete ? (
          <StatusText tone="ok">Setup complete · parked steps stay on the Platform home as reminders</StatusText>
        ) : (
          <StatusText tone="warn">
            {progress.requiredOpen > 0 ? `${progress.requiredOpen} required step${progress.requiredOpen === 1 ? "" : "s"} to go` : "Required steps done"} · {progress.done} done ·{" "}
            {progress.parked} parked · {progress.open} open
          </StatusText>
        )}
        <span className="flex-1" />
        {!view.complete ? <LaterButton /> : null}
      </div>
      {!view.portalDbConfigured ? (
        <div className="mb-4">
          <Alert tone="warning" title="This portal server cannot read the keys saved here yet">
            The portal reaches the database for them as the background service&apos;s role (connect_worker), and its connection string is not set on this server.
            Until it is, the portal keeps using its environment variables; the background service still uses what you save. See step 1.
          </Alert>
        </div>
      ) : view.portalConfigError ? (
        <div className="mb-4">
          <Alert tone="danger" title="The portal could not read the saved keys">
            {view.portalConfigError}. It keeps using the last values it read and its environment variables.
          </Alert>
        </div>
      ) : null}

      <div className="grid grid-cols-12 gap-4">
        <nav aria-label="Setup steps" className="col-span-12 lg:col-span-4">
          <ol className="cc-card flex flex-col gap-0.5 p-2">
            {view.steps.map((s, i) => (
              <li key={s.key}>
                <Link
                  href={`/platform/setup?step=${s.key}`}
                  aria-current={s.key === current.key ? "step" : undefined}
                  className={`flex items-center gap-3 rounded-[10px] px-3 py-2 text-[14px] ${s.key === current.key ? "bg-subtle font-bold" : "hover:bg-subtle"}`}
                  data-step={s.key}
                >
                  <span className="w-5 text-right text-[12px] text-muted">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    {s.title}
                    {s.required ? <span className="ml-1 text-saffron" title="Required">★</span> : null}
                  </span>
                  <StepStatus step={s} />
                </Link>
              </li>
            ))}
          </ol>
          <p className="mt-2 px-1 text-[12px] text-muted">★ required. Optional steps can be parked and done later.</p>
        </nav>

        <div className="col-span-12 flex flex-col gap-4 lg:col-span-8">
          <StepDetail step={current} view={view} portalUrl={portalUrl} host={host} tz={tz} />
        </div>
      </div>
    </>
  );
}

function StepStatus({ step }: { step: StepView }) {
  if (step.status === "done") return <StatusText tone="ok">Done</StatusText>;
  if (step.status === "parked") return <StatusText tone="warn">Parked</StatusText>;
  if (step.live.ok) return <StatusText tone="ok">Ready</StatusText>;
  return <StatusText tone={step.required ? "bad" : "warn"}>To do</StatusText>;
}

function StepDetail({ step, view, portalUrl, host, tz }: { step: StepView; view: SetupView; portalUrl: string; host: string; tz: string }) {
  const busy = step.test?.status === "queued" || step.test?.status === "running";
  return (
    <>
      <Card
        title={
          <>
            {step.title} {step.required ? <Tag color="maroon">Required</Tag> : <Tag color="muted">Optional</Tag>}
          </>
        }
        description={step.what}
        actions={
          <>
            {step.workerTest ? <TestButton step={step.key} busy={busy} /> : null}
            {step.key === "hooks" ? <HookTestButton /> : null}
          </>
        }
      >
        <p className="text-[14px]">
          <span className="font-bold">Why: </span>
          {step.why}
        </p>
        <div className="mt-3" data-live={step.live.ok ? "ok" : "not-ok"}>
          <span className="font-bold">Status now: </span>
          <StatusText tone={step.live.ok ? "ok" : step.required ? "bad" : "warn"}>{step.live.ok ? "Working" : "Not working yet"}</StatusText>{" "}
          <span className="text-[14px]">{step.live.summary}</span>
        </div>
        {step.status === "parked" ? (
          <p className="mt-2 text-[13px] text-muted" data-parked>
            Parked by {step.parkedBy ?? "a platform admin"} on {formatDateTime(step.parkedAt, tz)}
            {step.note ? ` — “${step.note}”` : ""}.
          </p>
        ) : step.status === "done" ? (
          <p className="mt-2 text-[13px] text-muted">Marked done by {step.completedBy ?? "a platform admin"} on {formatDateTime(step.completedAt, tz)}.</p>
        ) : null}
        <div className="mt-3">
          <StepActions step={step.key} title={step.title} required={step.required} status={step.status} canComplete={step.canComplete} why={step.live.summary} />
        </div>
      </Card>

      {step.fields.length > 0 ? <FieldsCard step={step} tz={tz} /> : null}
      {step.test ? <TestCard step={step} tz={tz} /> : null}
      <Instructions step={step.key} view={view} portalUrl={portalUrl} host={host} />
      {step.key === "hooks" ? <HookCard view={view} tz={tz} /> : null}
      {step.key === "portal" && view.portalCheck ? <CheckLines title="Portal address checks" lines={view.portalCheck.lines} /> : null}
      {step.key === "wildcard" && view.wildcardCheck ? <CheckLines title="Organization address checks" lines={view.wildcardCheck.lines} /> : null}
      <AutoRefresh active={busy} />
    </>
  );
}

function sourceText(s: FieldView["portal"] | FieldView["worker"]): { text: string; tone: "ok" | "warn" | "bad" } {
  if (s === "saved") return { text: "uses the saved value", tone: "ok" };
  if (s === "env") return { text: "uses its environment variable", tone: "ok" };
  if (s === "unknown") return { text: "not running, cannot tell", tone: "warn" };
  return { text: "not set", tone: "warn" };
}

function FieldsCard({ step, tz }: { step: StepView; tz: string }) {
  return (
    <Card title="Keys and settings" description="Saved values win over the servers' environment variables and are picked up within a minute, without a redeploy. Keys are never shown again." padded={false}>
      <TableWrap>
        <table className="crm-table">
          <thead>
            <tr>
              <th>Setting</th>
              <th>Saved here</th>
              <th>Portal server</th>
              <th>Background service</th>
              <th className="w-[1%]">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {step.fields.map((f) => {
              const saved = f.kind === "secret" ? f.fingerprint !== null : f.value !== null;
              const portal = sourceText(f.portal);
              const worker = sourceText(f.worker);
              const envOnly = f.name === f.name.toLowerCase(); // portal_domain / wildcard_domain: not environment variables
              return (
                <tr key={f.name} data-field-row={f.name}>
                  <td>
                    <div className="font-bold">{f.label}</div>
                    <div className="font-mono text-[11px] text-muted">{f.name}</div>
                    <div className="max-w-md text-[12px] text-muted">{f.hint}</div>
                  </td>
                  <td className="text-[13px]">
                    {saved ? (
                      <>
                        {f.kind === "secret" ? <span className="font-mono">•••• {f.fingerprint}</span> : <span className="font-mono">{f.value}</span>}
                        <div className="text-[12px] text-muted">
                          {f.setBy ? `by ${f.setBy}, ` : ""}
                          {formatDateTime(f.rotatedAt ?? f.setAt, tz)}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">Not saved</span>
                    )}
                  </td>
                  <td className="text-[13px]">{envOnly ? <span className="text-muted">—</span> : <StatusText tone={portal.tone}>{portal.text}</StatusText>}</td>
                  <td className="text-[13px]">{envOnly ? <span className="text-muted">—</span> : <StatusText tone={worker.tone}>{worker.text}</StatusText>}</td>
                  <td>
                    <div className="flex flex-col gap-1">
                      <FieldButton
                        field={{ name: f.name, label: f.label, kind: f.kind, hint: f.hint, placeholder: f.placeholder, options: f.options, current: f.kind === "setting" ? f.value : f.fingerprint }}
                        mode={f.generate ? "generate" : saved ? "replace" : "save"}
                        label={f.generate ? (saved ? "Generate new" : "Generate") : saved ? "Replace" : "Save"}
                        kind={saved ? "ghost" : "primary"}
                      />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </TableWrap>
    </Card>
  );
}

function TestCard({ step, tz }: { step: StepView; tz: string }) {
  const t = step.test!;
  const result = t.result;
  return (
    <Card title="Last test" description={`Run by the background service with the values it uses · ${formatDateTime(t.createdAt, tz)}${t.stale ? " · a value changed since" : ""}`} padded={false}>
      {t.status === "queued" || t.status === "running" ? (
        <p className="px-3 pb-3 text-[14px]">Testing… the background service picks the test up within a few seconds.</p>
      ) : t.status === "failed" ? (
        <p className="px-3 pb-3 text-[14px] text-danger" role="alert">
          The test could not run: {t.error ?? "no detail"}.
        </p>
      ) : result ? (
        <>
          <ul className="flex flex-col gap-1 px-3 pb-2" data-test-lines>
            {result.lines.map((l, i) => (
              <li key={i} className="text-[14px]">
                <StatusText tone={l.ok ? "ok" : "bad"}>{l.ok ? "OK" : "Problem"}</StatusText> <span className="font-bold">{l.label}</span> — {l.detail}
              </li>
            ))}
          </ul>
          {result.records && result.records.length > 0 ? (
            <div className="px-1 pb-2">
              <p className="px-2 pb-1 text-[13px] font-bold">
                DNS records for {result.domain} ({result.domainStatus === "verified" ? "verified" : "add these at its DNS provider"})
              </p>
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Type</th>
                      <th>Name</th>
                      <th>Value</th>
                      <th>For</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.records.map((r, i) => (
                      <tr key={i}>
                        <td>{r.type}</td>
                        <td className="font-mono text-[12px]">
                          {r.name} <CopyButton value={r.name} />
                        </td>
                        <td className="max-w-xs break-all font-mono text-[12px]">
                          {r.value} <CopyButton value={r.value} />
                        </td>
                        <td className="text-[12px]">{r.purpose}</td>
                        <td>
                          <StatusText tone={r.status === "verified" ? "ok" : "warn"}>{r.status}</StatusText>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            </div>
          ) : null}
        </>
      ) : (
        <p className="px-3 pb-3 text-[14px]">The test finished without a readable result. Test again.</p>
      )}
    </Card>
  );
}

function CheckLines({ title, lines }: { title: string; lines: { label: string; ok: boolean; detail: string }[] }) {
  return (
    <Card title={title} description="Checked from this server just now.">
      <ul className="flex flex-col gap-1">
        {lines.map((l, i) => (
          <li key={i} className="text-[14px]">
            <StatusText tone={l.ok ? "ok" : "bad"}>{l.ok ? "OK" : "Not yet"}</StatusText> <span className="font-bold">{l.label}</span> — {l.detail}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function HookCard({ view, tz }: { view: SetupView; tz: string }) {
  const rows = (["email", "sms"] as const).map((ch) => ({ ch, a: view.hookActivity[ch] }));
  return (
    <Card title="Sign-in codes sent through the hooks (last 30 days)" padded={false}>
      <TableWrap>
        <table className="crm-table">
          <thead>
            <tr>
              <th>Hook</th>
              <th>Last code</th>
              <th>Sent</th>
              <th>Failed</th>
              <th>Last result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ ch, a }) => (
              <tr key={ch} data-hook={ch}>
                <td className="font-bold">{ch === "email" ? "Send Email" : "Send SMS"}</td>
                <td>{a?.last_at ? formatDateTime(a.last_at, tz) : <span className="text-muted">None yet</span>}</td>
                <td>{a?.sent ?? 0}</td>
                <td>{a?.failed ?? 0}</td>
                <td className="text-[13px]">{a?.last_status ? `${a.last_status}${a.last_error ? ` — ${a.last_error}` : ""}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableWrap>
      <p className="px-3 pb-3 text-[13px] text-muted">
        A code sent while the hook is off goes out through Supabase&apos;s own email and does not appear here — that is how the test tells the two apart.
      </p>
    </Card>
  );
}

function Code({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <code className="break-all rounded bg-subtle px-1 font-mono text-[12px]">{children}</code>
      <CopyButton value={children} />
    </span>
  );
}

function Instructions({ step, view, portalUrl, host }: { step: StepKey; view: SetupView; portalUrl: string; host: string }) {
  const env = readPublicEnv();
  const projectRef = env.ok ? (new URL(env.env.supabaseUrl).hostname.match(/^([a-z0-9]{20})\.supabase\.co$/)?.[1] ?? null) : null;
  const ipHost = /^\d{1,3}(\.\d{1,3}){3}(:\d+)?$/.test(host) ? host.replace(/:\d+$/, "") : null;
  const dropletIp = ipHost ?? "<the droplet's IP address>";
  const steps: Record<StepKey, ReactNode> = {
    background: (
      <>
        <p>
          The background service connects to the database with its own connection string, <b>WORKER_DATABASE_URL</b>. It cannot be entered here: the app itself
          needs it to reach the database. The owner sets it once:
        </p>
        <ol className="ml-5 mt-2 list-decimal space-y-2">
          <li>
            Make a password of letters and digits only, for example in a terminal: <Code>openssl rand -hex 32</Code>. Do not reuse the database password.
          </li>
          <li>
            Supabase › SQL Editor, run once (put your password between the quotes): <Code>{"alter role connect_worker with password '<the password>';"}</Code>
          </li>
          <li>
            Build the connection string from the Session pooler string (Supabase › Connect › Session pooler), with the user changed to{" "}
            <b>connect_worker.{projectRef ?? "<project-ref>"}</b>:{" "}
            <Code>{`postgresql://connect_worker.${projectRef ?? "<project-ref>"}:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`}</Code>
          </li>
          <li>
            GitHub › connect-crm › Settings › Secrets and variables › Actions › New repository secret: <b>WORKER_DATABASE_URL</b> = that string.
          </li>
          <li>Actions › Deploy › Run workflow. The deploy starts the background service and gives the same connection to the portal server (so it can read the keys saved here).</li>
        </ol>
        <p className="mt-2">
          This portal server {view.portalDbConfigured ? <StatusText tone="ok">has</StatusText> : <StatusText tone="bad">does not have</StatusText>} that connection.
          {view.worker.configError ? <> The background service reports: {view.worker.configError}.</> : null}
        </p>
      </>
    ),
    portal: (
      <>
        <ol className="ml-5 list-decimal space-y-2">
          <li>Save the address above (for example crm.communityconnect.app).</li>
          <li>
            At your DNS provider add an <b>A record</b>: <Code>{view.portalDomain ?? "crm.communityconnect.app"}</Code> → <Code>{dropletIp}</Code>
          </li>
          <li>
            The server then gets its HTTPS certificate on the first visit to the address (Caddy asks this portal before issuing one, and it says yes for the saved
            address). No redeploy is needed; this page checks it every time it opens.
          </li>
          <li>
            Supabase › Authentication › URL Configuration: set the Site URL to <Code>{`https://${view.portalDomain ?? "crm.communityconnect.app"}`}</Code> and add it to the
            redirect URLs.
          </li>
        </ol>
      </>
    ),
    email: (
      <ol className="ml-5 list-decimal space-y-2">
        <li>Create the account (Resend is the default) and an API key with full access; save it above with the sender address and a generated link secret.</li>
        <li>Press Test: the background service checks the key and adds the sender&apos;s domain to the provider. Put the DNS records it shows at the domain&apos;s DNS provider, then test again until it says verified.</li>
        <li>
          Resend › Webhooks › add <Code>{`${portalUrl}/api/webhooks/resend`}</Code> for delivered, bounced, complained and opened; save its signing secret above. (Postmark:{" "}
          <Code>{`${portalUrl}/api/webhooks/postmark`}</Code> with HTTP Basic credentials whose password you save as the webhook password.)
        </li>
        <li>Supabase › Authentication › Emails › SMTP Settings is no longer needed once the sign-in hook (next step) is on.</li>
      </ol>
    ),
    hooks: (
      <ol className="ml-5 list-decimal space-y-2">
        <li>
          Supabase › Authentication › Hooks › <b>Send Email hook</b> › HTTPS › URL <Code>{`${portalUrl}/api/auth-hooks/send-email`}</Code> › Generate secret. Copy the secret
          (v1,whsec_…) and save it above <b>before</b> enabling the hook.
        </li>
        <li>
          If people sign in by text: <b>Send SMS hook</b> › <Code>{`${portalUrl}/api/auth-hooks/send-sms`}</Code>, and save its secret too.
        </li>
        <li>
          Wait a minute after saving (the portal picks the secret up within 60 seconds), then turn the hook <b>on</b> in Supabase. While a hook is on and the
          portal cannot answer it, nobody can sign in.
        </li>
        <li>Press “Send me a test sign-in code”. The table below shows the code once the hook carried it.</li>
      </ol>
    ),
    payments: (
      <ol className="ml-5 list-decimal space-y-2">
        <li>Stripe: use Community Connect&apos;s platform account with Connect enabled; save the test key (and the live key when ready) and the Connect client id.</li>
        <li>
          Stripe › Connect › Settings › Redirects: add <Code>{`${portalUrl}/api/oauth/stripe/callback`}</Code>
          {view.wildcardDomain ? <> and every organization address&apos;s <Code>/api/oauth/stripe/callback</Code></> : null}.
        </li>
        <li>
          Stripe › Developers › Webhooks › add an endpoint listening to connected accounts: <Code>{`${portalUrl}/api/webhooks/stripe`}</Code> (checkout.session.completed,
          charge.refunded, payout.paid, account.updated); save its signing secret.
        </li>
        <li>
          PayPal: the partner app&apos;s sandbox and live credentials; webhooks to <Code>{`${portalUrl}/api/webhooks/paypal`}</Code>, and save each webhook id.
        </li>
        <li>Generate the connect-link signing secret, then press Test.</li>
      </ol>
    ),
    texting: (
      <ol className="ml-5 list-decimal space-y-2">
        <li>Save the account SID, the auth token and Community Connect&apos;s number (or messaging service).</li>
        <li>
          Twilio › the number › Messaging › “A message comes in”: webhook <Code>{`${portalUrl}/api/webhooks/twilio`}</Code> (HTTP POST).
        </li>
        <li>Organizations&apos; 10DLC / toll-free registrations are filed in Twilio by the Community Connect team, then recorded in the portal.</li>
      </ol>
    ),
    quickbooks: (
      <>
        <ol className="ml-5 list-decimal space-y-2">
          <li>Intuit Developer: create the app with the Accounting scope; save the production and development keys and generate the connect-link secret.</li>
          <li>Intuit › your app › Settings › Redirect URIs: register every address below (production and development tabs).</li>
        </ol>
        <ul className="ml-5 mt-2 list-disc space-y-1">
          {callbackUrls("/api/oauth/intuit/callback", view.portalDomain ?? host, view.wildcardDomain).map((u) => (
            <li key={u}>{u.startsWith("https://<") ? u : <Code>{u}</Code>}</li>
          ))}
        </ul>
      </>
    ),
    ai: <p>console.anthropic.com › API Keys › Create key; save it and press Test. Niva, import mapping and donor-matching suggestions switch on by themselves.</p>,
    push: <p>Nothing is required. Add a token only if “enhanced push security” is on for the Expo project, then press Test.</p>,
    wildcard: (
      <ol className="ml-5 list-decimal space-y-2">
        <li>Save the base domain (for example communityconnect.app).</li>
        <li>
          At its DNS provider add a wildcard <b>A record</b>: <Code>{`*.${view.wildcardDomain ?? "communityconnect.app"}`}</Code> → <Code>{dropletIp}</Code> (and optionally
          the bare domain).
        </li>
        <li>Each organization&apos;s address gets its certificate on its first visit; nothing else to deploy.</li>
        <li>
          Supabase › Authentication › URL Configuration: add <Code>{`https://*.${view.wildcardDomain ?? "communityconnect.app"}`}</Code> to the redirect URLs.
        </li>
      </ol>
    ),
  };
  return (
    <Card title="What to do" description={STEPS.find((s) => s.key === step)?.required ? "Required before organizations can use Community Connect." : "Optional: park it if you are not ready."}>
      <div className="text-[14px] leading-relaxed">{steps[step]}</div>
    </Card>
  );
}
