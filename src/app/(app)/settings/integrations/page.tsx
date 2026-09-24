import type { Metadata } from "next";
import Link from "next/link";

import { Card, NoAccess, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { readPublicEnv } from "@/lib/env";
import { explainError } from "@/lib/errors";
import { connectionStatus, integrationRows } from "@/lib/integrations";
import { can, canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { backgroundServiceView, jobKindLabel, jobStatusView, providerLabel } from "@/lib/vault";

import { TestJobButton } from "./background-service";
import { VaultPanel, type ConnectionView } from "./vault-panel";

export const metadata: Metadata = { title: "Integrations · Settings" };

type NameRow = { user_id: string; person_id: string | null };
type PersonRow = { id: string; first_name: string; last_name: string; preferred_name: string | null };

export default async function IntegrationsPage() {
  const session = await getSession();
  const header = <PageHeader title="Settings" description="Connected services for this center" />;
  if (!canAccess(session, "integrations")) {
    return (
      <>
        {header}
        <NoAccess area="Integrations" access="integrations" />
      </>
    );
  }
  const { db, center } = session;
  const tz = center.time_zone;
  const canSeeJobs = can(session, ["settings.manage", "integrations.manage"]);
  const [res, secretsRes, logRes, statusRes, jobsRes, ownerRes] = await Promise.all([
    db
      .from("integration_connections")
      .select("id, provider, status, display_name, settings, connected_at, token_expires_at, last_error")
      .eq("center_id", center.id),
    db.from("integration_secrets").select("connection_id, name, fingerprint, set_by, set_at, rotated_at").eq("center_id", center.id).order("name"),
    db
      .from("secret_access_log")
      .select("id, connection_id, name, reader, purpose, outcome, job_id, read_at")
      .eq("center_id", center.id)
      .order("read_at", { ascending: false })
      .limit(25),
    db.rpc("background_service_status", { p_center: center.id }),
    canSeeJobs
      ? db
          .from("jobs")
          .select("id, kind, status, attempts, max_attempts, last_error, created_at, finished_at")
          .eq("center_id", center.id)
          .order("id", { ascending: false })
          .limit(10)
      : Promise.resolve({ data: [], error: null }),
    db.rpc("is_center_owner", { p_center: center.id }),
  ]);
  if (res.error) {
    return (
      <>
        {header}
        <QueryError what="the integrations" error={res.error} retryHref="/settings/integrations" />
      </>
    );
  }
  const rows = integrationRows(res.data ?? []);
  const env = readPublicEnv();

  // Who set each secret: the linked person's name ("Background service" when the worker stored it).
  const setters = [...new Set((secretsRes.data ?? []).map((s) => s.set_by).filter((v): v is string => Boolean(v)))];
  const names = new Map<string, string>();
  if (setters.length > 0) {
    const links = await db.from("center_users").select("user_id, person_id").eq("center_id", center.id).in("user_id", setters);
    if (links.error) console.error("[integrations] could not load who set the secrets:", links.error);
    const personIds = ((links.data ?? []) as NameRow[]).map((l) => l.person_id).filter((v): v is string => Boolean(v));
    const people = personIds.length > 0 ? await db.from("people").select("id, first_name, last_name, preferred_name").in("id", personIds) : null;
    if (people?.error) console.error("[integrations] could not load the names of who set the secrets:", people.error);
    const byPerson = new Map(((people?.data ?? []) as PersonRow[]).map((p) => [p.id, `${p.preferred_name || p.first_name} ${p.last_name}`]));
    for (const l of (links.data ?? []) as NameRow[]) if (l.person_id && byPerson.has(l.person_id)) names.set(l.user_id, byPerson.get(l.person_id)!);
  }

  const connections: ConnectionView[] = (res.data ?? []).map((c) => ({
    id: c.id,
    provider: c.provider,
    label: c.display_name ? `${providerLabel(c.provider)} · ${c.display_name}` : providerLabel(c.provider),
    status: connectionStatus(c.status),
    secrets: (secretsRes.data ?? [])
      .filter((s) => s.connection_id === c.id)
      .map((s) => ({
        name: s.name,
        fingerprint: s.fingerprint,
        setBy: s.set_by ? (names.get(s.set_by) ?? "A staff member") : "Background service",
        setAt: formatDateTime(s.set_at, tz),
        rotatedAt: s.rotated_at ? formatDateTime(s.rotated_at, tz) : null,
      })),
  }));
  const connectionLabel = new Map(connections.map((c) => [c.id, c.label]));
  if (ownerRes.error) console.error("[integrations] could not check the owner:", ownerRes.error);
  const isOwner = ownerRes.error ? false : Boolean(ownerRes.data);
  const canManage = can(session, "integrations.manage") || isOwner;
  const service = statusRes.error ? null : backgroundServiceView(statusRes.data);
  if (statusRes.error) console.error("[integrations] could not load the background service status:", statusRes.error);
  if (logRes.error) console.error("[integrations] could not load the secret access log:", logRes.error);
  if (jobsRes.error) console.error("[integrations] could not load the recent jobs:", jobsRes.error);

  return (
    <>
      {header}
      <div className="flex flex-col gap-4">
        <Card
          title="Background service"
          description="Runs background work: vault reads for connected services, removing expired files, and scheduled jobs."
          actions={can(session, "settings.manage") && service?.state !== "not_configured" ? <TestJobButton /> : null}
        >
          {statusRes.error ? (
            <p role="alert" className="text-sm text-danger">
              Could not check the background service — {explainError(statusRes.error)}.
            </p>
          ) : service ? (
            <div className="flex flex-col gap-3">
              <div>
                <StatusText tone={service.tone}>{service.label}</StatusText>
                <p className="mt-0.5 text-[13px] text-muted">
                  {service.detail}
                  {service.lastBeatAt ? ` (${formatDateTime(service.lastBeatAt, tz)})` : ""}
                </p>
              </div>
              <p className="text-[13px]">
                Jobs for {center.short_name ?? center.name}: {service.jobs.queued} waiting · {service.jobs.running} running · {service.jobs.done24h} done
                and {service.jobs.failed24h} failed in the last 24 hours.
              </p>
              {service.handlers.length > 0 ? (
                <ul className="flex flex-col gap-1 text-[13px]">
                  {service.handlers.map((h) => (
                    <li key={h.kind}>
                      <span className="font-semibold">{jobKindLabel(h.kind)}</span>{" "}
                      {h.configured ? <StatusText tone="ok">Ready</StatusText> : <StatusText tone="warn">Not configured</StatusText>}
                      {h.reason ? <span className="text-muted"> · {h.reason}</span> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
              <p className="text-[13px]">
                <span className="font-semibold">Malware scanning of uploads:</span> no scanning service has been chosen yet, so uploads are not
                scanned.{service.jobs.scanPending > 0 ? ` ${service.jobs.scanPending} upload(s) are waiting to be scanned once one is.` : ""}
              </p>
              {canSeeJobs && !jobsRes.error && (jobsRes.data ?? []).length > 0 ? (
                <TableWrap>
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Job</th>
                        <th>Kind</th>
                        <th>Status</th>
                        <th>Queued</th>
                        <th>Last error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(jobsRes.data ?? []).map((j) => {
                        const st = jobStatusView(j.status, j.attempts, j.max_attempts);
                        return (
                          <tr key={j.id}>
                            <td className="font-mono text-[13px]">#{j.id}</td>
                            <td>{jobKindLabel(j.kind)}</td>
                            <td>
                              <StatusText tone={st.tone}>{st.label}</StatusText>
                            </td>
                            <td className="whitespace-nowrap text-[13px]">{formatDateTime(j.created_at, tz)}</td>
                            <td className="text-[13px] text-muted">{j.last_error ?? "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              ) : null}
              {canSeeJobs && jobsRes.error ? (
                <p role="alert" className="text-sm text-danger">
                  Could not load the recent jobs — {explainError(jobsRes.error)}.
                </p>
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card title="Services" padded={false}>
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Service</th>
                  <th>Status</th>
                  <th>Detail</th>
                  <th>Owner</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key}>
                    <td className="font-bold">
                      {r.href ? (
                        <Link href={r.href} className="crm-link">
                          {r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                    </td>
                    <td>
                      <StatusText tone={r.status.tone}>{r.status.label}</StatusText>
                    </td>
                    <td>{r.detail}</td>
                    <td>{r.owner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableWrap>
        </Card>

        {secretsRes.error ? (
          <QueryError what="the stored secrets" error={secretsRes.error} retryHref="/settings/integrations" />
        ) : env.ok ? (
          <VaultPanel
            connections={connections}
            canManage={canManage}
            manageHint={canManage ? null : "You can see the fingerprints. Changing a secret needs the organization owner or the integrations.manage permission."}
            env={{ supabaseUrl: env.env.supabaseUrl, supabaseAnonKey: env.env.supabaseAnonKey }}
          />
        ) : (
          <p role="alert" className="text-sm text-danger">
            The vault cannot be managed here: the app is not configured (NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY).
          </p>
        )}

        <Card
          title="Secret access log"
          description="Every time the background service reads a secret: which one, which job, and why. Nobody else can read them."
          padded={false}
        >
          {logRes.error ? (
            <p role="alert" className="px-3 pb-3 text-sm text-danger">
              Could not load the access log — {explainError(logRes.error)}.
            </p>
          ) : (logRes.data ?? []).length === 0 ? (
            <p className="px-3 pb-3 text-[13px] text-muted">No secret has been read yet.</p>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Connection</th>
                    <th>Secret</th>
                    <th>Read by</th>
                    <th>Why</th>
                    <th>Result</th>
                  </tr>
                </thead>
                <tbody>
                  {(logRes.data ?? []).map((l) => (
                    <tr key={l.id}>
                      <td className="whitespace-nowrap text-[13px]">{formatDateTime(l.read_at, tz)}</td>
                      <td>{connectionLabel.get(l.connection_id) ?? "Removed connection"}</td>
                      <td className="font-mono text-[13px]">{l.name}</td>
                      <td className="text-[13px]">{l.reader}</td>
                      <td className="text-[13px]">{l.purpose}</td>
                      <td>{l.outcome === "read" ? <StatusText tone="ok">Read</StatusText> : <StatusText tone="warn">Not stored</StatusText>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>
      </div>
    </>
  );
}
