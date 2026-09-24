import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, DefinitionList, EmptyState, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { portalBaseDomain } from "@/lib/center-resolve";
import { formatDateTime } from "@/lib/dates";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import { ENTITLEMENT_INFO, entitlementLabel, formatEntitlement, formatJoinCode } from "@/lib/tenancy";

import { PlatformNoAccess } from "../../platform-no-access";
import { addDomainAction, removeDomainAction, setEntitlementAction } from "./actions";

export const metadata: Metadata = { title: "Center · Platform" };

/** Platform › Centers › one center: environment, limits (entitlement overrides), web addresses, member-app join code. */
export default async function PlatformCenterPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const session = await getSession();
  if (!session.isPlatformAdmin) {
    return (
      <>
        <PageHeader title="Platform" />
        <PlatformNoAccess />
      </>
    );
  }
  const { db } = session;
  const centerRes = await db.from("centers").select("id, slug, name, status, environment, sandbox_for").eq("id", id).maybeSingle();
  if (centerRes.error) {
    return (
      <>
        <PageHeader title="Platform" />
        <QueryError what="the center" error={centerRes.error} retryHref={`/platform/centers/${id}`} />
      </>
    );
  }
  if (!centerRes.data) notFound();
  const center = centerRes.data;
  const [entRes, domainRes, codeRes, promotedRes] = await Promise.all([
    db.rpc("center_entitlement_list", { p_center: id }),
    db.from("center_domains").select("domain, created_at").eq("center_id", id).order("domain"),
    db.from("member_join_codes").select("code, expires_at, created_at").eq("center_id", id).eq("active", true).order("created_at", { ascending: false }),
    center.sandbox_for ? db.from("centers").select("name, slug").eq("id", center.sandbox_for).maybeSingle() : Promise.resolve(null),
  ]);
  const sandbox = center.environment === "sandbox";
  const base = portalBaseDomain();
  const tz = session.center.time_zone;

  return (
    <>
      <PageHeader
        title={center.name}
        eyebrow={
          <Link href="/platform" className="crm-link">
            Platform › Centers
          </Link>
        }
        description="Environment, limits and addresses · every change needs a reason and is audited"
      />
      <BlockGrid>
        <Card span={5} title="Environment">
          <DefinitionList
            items={[
              {
                label: "Environment",
                value: sandbox ? <StatusText tone="warn">Sandbox · test data</StatusText> : <StatusText tone="ok">Production</StatusText>,
              },
              { label: "Slug", value: <span className="font-mono text-[12px]">{String(center.slug)}</span> },
              { label: "Status", value: center.status },
              ...(sandbox
                ? [
                    {
                      label: "Promoted to",
                      value: promotedRes?.data ? `${promotedRes.data.name} (${String(promotedRes.data.slug)})` : "Not promoted yet",
                    },
                  ]
                : []),
            ]}
          />
        </Card>

        <Card span={7} title="Portal web addresses" description="Where this community's staff open the portal">
          <ul className="mb-3 space-y-1.5 text-[13px]">
            {base ? (
              <li>
                <span className="font-mono">
                  {String(center.slug)}.{base}
                </span>{" "}
                <span className="text-muted">· automatic</span>
              </li>
            ) : (
              <li className="text-muted">
                No base domain is set (PORTAL_BASE_DOMAIN), so there is no automatic &lt;slug&gt;.&lt;domain&gt; address on this server.
              </li>
            )}
            {domainRes.error ? (
              <li>
                <QueryError what="the community's own addresses" error={domainRes.error} retryHref={`/platform/centers/${id}`} />
              </li>
            ) : (
              (domainRes.data ?? []).map((d) => (
                <li key={String(d.domain)} className="flex items-center gap-2">
                  <span className="font-mono">{String(d.domain)}</span>
                  <ActionForm action={removeDomainAction} submitLabel="Remove" variant="bad" size="xs" confirmMessage={`Remove ${String(d.domain)}? Staff using it will land on the default community.`}>
                    <input type="hidden" name="center" value={id} />
                    <input type="hidden" name="domain" value={String(d.domain)} />
                  </ActionForm>
                </li>
              ))
            )}
          </ul>
          <ActionForm action={addDomainAction} submitLabel="Add address" size="sm" resetOnSuccess className="flex flex-wrap items-end gap-2" buttonsClassName="">
            <input type="hidden" name="center" value={id} />
            <label className="min-w-[14rem] flex-1">
              <span className="crm-label">The community&apos;s own address</span>
              <input name="domain" className="crm-input" placeholder="portal.example.org" autoComplete="off" />
            </label>
          </ActionForm>
          <p className="crm-hint mt-2">The community points a DNS record (CNAME to this server&apos;s name, or an A record to its IP) at the server; HTTPS is issued automatically on first visit.</p>
        </Card>

        <Card span={12} title="Limits" description={sandbox ? "Sandbox limits apply until Community Connect changes them" : "Production limits (per plan)"} padded={false}>
          {entRes.error ? (
            <div className="p-3">
              <QueryError what="the limits" error={entRes.error} retryHref={`/platform/centers/${id}`} />
            </div>
          ) : (entRes.data ?? []).length === 0 ? (
            <EmptyState title="No limits are defined" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Limit</th>
                    <th>Default ({sandbox ? "sandbox" : "production"})</th>
                    <th>In effect</th>
                    <th>Override</th>
                    <th>Change it</th>
                  </tr>
                </thead>
                <tbody>
                  {(entRes.data ?? []).map((e) => {
                    const info = ENTITLEMENT_INFO[e.key];
                    const hint =
                      info?.kind === "flag"
                        ? "On or Off"
                        : info?.kind === "mode"
                          ? Object.values(info.modes ?? {}).join(" / ")
                          : info?.kind === "bytes"
                            ? 'e.g. "5 GB", or "No limit"'
                            : 'a number, or "No limit"';
                    return (
                      <tr key={e.key} data-key={e.key}>
                        <td className="font-bold">{entitlementLabel(e.key)}</td>
                        <td>{formatEntitlement(e.key, e.default_value)}</td>
                        <td className="font-semibold">{formatEntitlement(e.key, e.effective)}</td>
                        <td className="text-[12px]">
                          {e.override_value === null ? (
                            <span className="text-muted">None</span>
                          ) : (
                            <>
                              {formatEntitlement(e.key, e.override_value)}
                              <span className="block text-muted">
                                {e.set_by_name ?? "Platform team"} · {e.set_at ? formatDateTime(e.set_at, tz) : ""}
                              </span>
                              <span className="block text-muted">“{e.reason}”</span>
                            </>
                          )}
                        </td>
                        <td>
                          <ActionForm action={setEntitlementAction} submitLabel="Save" size="xs" className="flex flex-wrap items-center gap-1.5" resetOnSuccess>
                            <input type="hidden" name="center" value={id} />
                            <input type="hidden" name="key" value={e.key} />
                            <input name="value" aria-label={`New value for ${entitlementLabel(e.key)}`} className="crm-input w-36" placeholder={hint} />
                            <input name="reason" aria-label="Reason" className="crm-input w-44" placeholder="Reason (required)" />
                          </ActionForm>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="crm-hint px-3 pb-2">Leave the value blank and save to remove an override (the default applies again).</p>
        </Card>

        <Card span={12} title="Member app join code" description={sandbox ? "A sandbox is reached in the member app only with this code" : "Members can also find this community by searching its name"}>
          {codeRes.error ? (
            <QueryError what="the join code" error={codeRes.error} retryHref={`/platform/centers/${id}`} />
          ) : (codeRes.data ?? []).length === 0 ? (
            <p className="text-[13px] text-muted">No active code. The community&apos;s admin can make one in Settings › Member app.</p>
          ) : (
            <p className="text-[13px]">
              {(codeRes.data ?? []).map((c) => (
                <span key={c.code} className="mr-3 font-mono text-[16px] font-bold" data-testid="platform-join-code">
                  {formatJoinCode(c.code)}
                </span>
              ))}
              <span className="text-muted">The community&apos;s admin rotates it in Settings › Member app.</span>
            </p>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
