import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionForm } from "@/components/action-form";
import { BlockGrid, Card, DefinitionList, EmptyState, PageHeader, QueryError, StatusText, TableWrap } from "@/components/ui";
import { confirmToolChoices } from "@/lib/assistant/choices";
import { assistantApiKey } from "@/lib/assistant/key";
import { consentFromRules } from "@/lib/activity/consent";
import { assistantEnabled } from "@/lib/assistant/settings";
import { portalBaseDomain } from "@/lib/center-resolve";
import { formatDateTime } from "@/lib/dates";
import { loadExperiences } from "@/lib/experiences-db";
import { buildModuleRowsFromStates } from "@/lib/modules";
import { isUuid } from "@/lib/search-params";
import { getSession } from "@/lib/session";
import { rulesVersion } from "@/lib/settings-rules";
import { ENTITLEMENT_INFO, entitlementLabel, formatEntitlement, formatJoinCode, sortEntitlements } from "@/lib/tenancy";

import { PlatformNoAccess } from "../../platform-no-access";
import { addDomainAction, removeDomainAction, saveAssistantAction, setEntitlementAction } from "./actions";
import { KindPanel } from "./kind-panel";
import { ModulesPanel } from "./modules-panel";
import { RecordingCard } from "./recording-card";

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
  const centerRes = await db.from("centers").select("id, slug, name, status, environment, sandbox_for, category_key, rules").eq("id", id).maybeSingle();
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
  const [entRes, domainRes, codeRes, promotedRes, kinds, statesRes] = await Promise.all([
    db.rpc("center_entitlement_list", { p_center: id }),
    db.from("center_domains").select("domain, created_at").eq("center_id", id).order("domain"),
    db.from("member_join_codes").select("code, expires_at, created_at").eq("center_id", id).eq("active", true).order("created_at", { ascending: false }),
    center.sandbox_for ? db.from("centers").select("name, slug").eq("id", center.sandbox_for).maybeSingle() : Promise.resolve(null),
    loadExperiences(db),
    db.rpc("module_states", { p_center: id }),
  ]);
  const moduleRows = statesRes.error ? [] : buildModuleRowsFromStates(statesRes.data ?? []);
  const kindLabel = (kinds.status === "ok" ? kinds.experiences.find((k) => k.key === center.category_key)?.label : null) ?? null;
  // Niva for admins (0755): its commands follow the switch here; its chat needs iWeaver (`ai`) as well, except on the onboarding
  // pages while the community is onboarding. Unknown (null) when the modules could not be read: the card says so instead of
  // guessing. No `ai` row (before the catalog has it) reads as on, as everywhere.
  const aiRow = moduleRows.find((r) => r.key === "ai");
  const chatAiOn: boolean | null = statesRes.error ? null : aiRow ? aiRow.enabled : true;
  const sandbox = center.environment === "sandbox";
  const assistantSwitch = assistantEnabled(center.rules);
  const assistantOn = assistantSwitch;
  const assistantTools = confirmToolChoices(center.rules);
  let aiKeySet = false;
  try {
    aiKeySet = !!(await assistantApiKey());
  } catch (error) {
    console.error("[platform] could not look for the AI key:", error);
  }
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

        <Card
          span={12}
          title="Kind of organization"
          description="Which modules, words and Setup checklist this organization has · changing it needs a reason and a fresh 2FA check"
        >
          {kinds.status !== "ok" ? (
            <QueryError what="the kinds of organization" error={kinds.error} retryHref={`/platform/centers/${id}`} />
          ) : (
            <KindPanel centerId={id} centerName={center.name} currentKey={center.category_key} experiences={kinds.experiences} sandbox={sandbox} />
          )}
        </Card>

        <Card
          span={12}
          title="Modules"
          description="Which modules this community has · the community can pause and switch back on only what is enabled here · every change needs a reason and a fresh 2FA check"
        >
          {statesRes.error ? (
            <QueryError what="the modules" error={statesRes.error} retryHref={`/platform/centers/${id}`} />
          ) : (
            <ModulesPanel centerId={id} rows={moduleRows} kindLabel={kindLabel} tz={tz} />
          )}
        </Card>

        <Card
          span={12}
          title="Niva for admins"
          description="Lets this community's staff ask Niva to look things up and prepare drafts · every change needs a reason and is audited"
        >
          <p className="mb-3 text-[13px]">
            Now: <StatusText tone={assistantOn ? "ok" : "warn"}>{assistantOn ? "On" : "Off"}</StatusText>
            {assistantSwitch && chatAiOn === null ? (
              <span className="text-muted"> (the modules could not be read, so whether the chat can answer is not known; reload to try again)</span>
            ) : null}
            {assistantSwitch && chatAiOn === false ? (
              <span className="text-muted">
                {" "}
                (the commands work; the chat is part of {aiRow?.label ?? "iWeaver"}, which is not on for this community
                {center.status === "onboarding" ? ", so it answers only on the onboarding pages while the community is onboarding" : ""})
              </span>
            ) : null}{" "}
            · AI key:{" "}
            {aiKeySet ? (
              <StatusText tone="ok">set</StatusText>
            ) : (
              <>
                <StatusText tone="warn">not set</StatusText> <span className="text-muted">(Platform › Setup › AI; the search box and commands list work without it)</span>
              </>
            )}
          </p>
          <ActionForm action={saveAssistantAction} submitLabel="Save" size="sm" className="space-y-3">
            <input type="hidden" name="center" value={id} />
            <input type="hidden" name="version" value={rulesVersion(center.rules) ?? ""} />
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" name="enabled" defaultChecked={assistantSwitch} className="mt-1" />
              <span>
                <span className="font-bold">Switch Niva for admins on for this community</span>
                <span className="block text-muted">
                  Staff get the search box for actions and the Niva panel. Looking things up and drafting work as soon as this is on. Nothing is changed by Niva unless you also allow it below.
                </span>
              </span>
            </label>
            {assistantTools.length > 0 ? (
              <fieldset className="space-y-2">
                <legend className="crm-label">Changes Niva may prepare (a person always presses a button to confirm)</legend>
                {assistantTools.map((t) => (
                  <label key={t.key} className="flex items-start gap-2 text-[13px]">
                    <input type="checkbox" name="tool" value={t.key} defaultChecked={t.on} className="mt-1" />
                    <span>
                      <span className="font-bold">{t.title}</span>
                      <span className="block text-muted">{t.description}</span>
                      {t.moneyNote ? <span className="block font-semibold text-danger">{t.moneyNote}</span> : null}
                    </span>
                  </label>
                ))}
              </fieldset>
            ) : null}
            <label className="block max-w-xl">
              <span className="crm-label">Reason</span>
              <input name="reason" className="crm-input" placeholder="Reason (required)" autoComplete="off" />
            </label>
          </ActionForm>
        </Card>

        <RecordingCard
          centerId={id}
          centerName={center.name}
          consent={consentFromRules(center.rules)}
          tz={tz}
        />

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

        <Card span={12} title="Limits" description={sandbox ? "Sandbox limits apply until Weaver changes them" : "Production limits (per plan)"} padded={false}>
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
                  {sortEntitlements(entRes.data ?? []).map((e) => {
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
