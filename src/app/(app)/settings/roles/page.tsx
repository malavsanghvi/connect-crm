import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { Alert, Badge, BlockGrid, Card, EmptyState, NoAccess, PageHeader, QueryError, TableWrap, Tabs, buttonClass } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { ENTITLEMENT_GROUPS, rightsCount, rolePermissions, unknownPermissions } from "@/lib/entitlements";
import { userNames } from "@/lib/data/lookups";
import { formatDate, todayInTz } from "@/lib/dates";
import { canAccess, isGrantActive } from "@/lib/permissions";
import { hrefWith, param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { revokeGrantAction } from "./actions";
import { GrantForm } from "./grant-form";

export const metadata: Metadata = { title: "Roles & entitlements · Settings" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader title="Settings" description="Granular entitlements for every module · default roles out of the box · custom roles for limited access" />
  );
  if (!canAccess(session, "roles")) {
    return (
      <>
        {header}
        <NoAccess area="Roles and entitlements" access="roles" />
      </>
    );
  }
  const sp = await searchParams;
  const show = param(sp, "show") === "ended" ? "ended" : param(sp, "show") === "all" ? "all" : "active";
  const { db, center } = session;
  const tz = center.time_zone;
  const rules = identifierRules(center.rules);

  const [rolesRes, grantsRes, zones, events, classes] = await Promise.all([
    db.from("roles").select("key, tier, name, description, default_scope, permissions").order("tier").order("name"),
    db
      .from("role_grants")
      .select("id, user_id, role_key, scope_kind, scope_id, starts_at, ends_at, granted_by, reason, created_at")
      .eq("center_id", center.id)
      .order("created_at", { ascending: false })
      .limit(1000),
    db.from("zones").select("id, name").eq("center_id", center.id).order("name"),
    db.from("events").select("id, name, starts_at").eq("center_id", center.id).order("starts_at", { ascending: false }).limit(200),
    db.from("pathshala_classes").select("id, name").eq("center_id", center.id).order("name").limit(300),
  ]);
  if (rolesRes.error) {
    return (
      <>
        {header}
        <QueryError what="roles" error={rolesRes.error} retryHref="/settings/roles" />
      </>
    );
  }
  const roles = rolesRes.data ?? [];
  const roleName = new Map(roles.map((r) => [r.key, r.name]));
  const now = new Date();
  const grants = (grantsRes.data ?? []).filter((g) =>
    show === "all" ? true : show === "active" ? isGrantActive(g, now) : !isGrantActive(g, now),
  );
  const people = await userNames(db, center.id, [...grants.map((g) => g.user_id), ...grants.map((g) => g.granted_by)]);
  const scopeName = new Map<string, string>([
    ...(zones.data ?? []).map((z) => [z.id, `${z.name} zone`] as [string, string]),
    ...(events.data ?? []).map((e) => [e.id, `${e.name}${e.starts_at ? ` (${formatDate(e.starts_at, tz)})` : ""}`] as [string, string]),
    ...(classes.data ?? []).map((c) => [c.id, c.name] as [string, string]),
  ]);
  const grantable = roles
    .filter((r) => r.tier !== "family" && (r.tier !== "platform" || session.isPlatformAdmin))
    .map((r) => ({ key: r.key, name: r.name, tier: r.tier, default_scope: r.default_scope }));

  // Roles table + entitlement grid (prototype Settings › Roles & entitlements).
  const staffRoles = roles.filter((r) => r.tier !== "family" && (r.tier !== "platform" || session.isPlatformAdmin));
  const selectedKey = param(sp, "role");
  const selected = staffRoles.find((r) => r.key === selectedKey) ?? staffRoles[0];
  const selectedPerms = selected ? rolePermissions(selected.permissions) : [];
  const wildcard = selectedPerms.includes("*");
  const other = unknownPermissions(selectedPerms).filter((p) => p !== "*");
  const roleHref = (key: string) => hrefWith("/settings/roles", sp, { role: key });

  return (
    <>
      {header}
      <BlockGrid className="mb-4">
        <Card span={4} title="Roles" padded={false}>
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th>Role</th>
                  <th className="w-[70px]">Rights</th>
                </tr>
              </thead>
              <tbody>
                {staffRoles.map((r) => {
                  const on = r.key === selected?.key;
                  return (
                    <tr key={r.key} className={on ? "bg-highlight" : undefined}>
                      <td>
                        <Link href={roleHref(r.key)} aria-current={on ? "true" : undefined} className={`font-bold no-underline ${on ? "text-navy" : "text-ink"}`}>
                          {r.name}
                        </Link>
                      </td>
                      <td>{rightsCount(rolePermissions(r.permissions))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
          <p className="px-2.5 pb-1 pt-2.5 text-[12px] text-muted">
            Default roles are read-only. Family roles (primary adult, adult, child) come from household relationships and are not listed.
          </p>
        </Card>

        <Card
          span={8}
          title={selected?.name ?? "No role selected"}
          description={
            selected
              ? `${selected.description ? `${selected.description} · ` : ""}Default role · ${wildcard ? "every entitlement" : `${selectedPerms.length} entitlements`}`
              : undefined
          }
          actions={
            <button
              type="button"
              disabled
              className={buttonClass("off", "sm")}
              title="Custom roles are not available yet: roles are shared by every center today, so a per-center copy needs a database change the owner has to approve."
            >
              Clone as custom
            </button>
          }
        >
          {selected ? (
            <>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {ENTITLEMENT_GROUPS.filter((g) => g.name !== "Platform" || wildcard).map((g) => (
                  <section key={g.name} className="rounded-[12px] bg-ground px-3 py-2.5" aria-label={g.name}>
                    <p className="cc-section">{g.name.toUpperCase()}</p>
                    <ul className="mt-1.5 flex flex-col gap-1.5">
                      {g.items.map((e) => {
                        const held = !e.planned && (wildcard || selectedPerms.includes(e.key));
                        return (
                          <li key={e.key} className={`flex items-start gap-2.5 text-[13px] ${e.planned ? "text-muted" : "text-ink-2"}`}>
                            <span
                              aria-hidden
                              className={`mt-px inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] border text-[12px] font-bold ${
                                held ? "border-navy bg-navy text-white" : "border-line-strong bg-white"
                              }`}
                            >
                              {held ? "✓" : ""}
                            </span>
                            <span>
                              <span className="sr-only">{held ? "Granted: " : "Not granted: "}</span>
                              {e.label}
                              {e.planned ? <span className="block text-[11px]">Not in the app yet</span> : null}
                            </span>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                ))}
                {other.length > 0 ? (
                  <section className="rounded-[12px] bg-ground px-3 py-2.5" aria-label="Other">
                    <p className="cc-section">OTHER</p>
                    <ul className="mt-1.5 flex flex-col gap-1 font-mono text-[12px]">
                      {other.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </div>
              {selectedPerms.length === 0 ? (
                <p className="mt-3 text-[13px] text-muted">
                  This role carries no center-wide entitlements. It works through its scope (one event, class, zone or the store).
                </p>
              ) : null}
            </>
          ) : (
            <EmptyState title="No roles could be shown" />
          )}
        </Card>

        <div className="col-span-12">
          <Alert tone="info" title="Custom roles need an owner decision">
            The prototype lets an admin clone a default role and tick entitlements on and off. Today every center shares one set of
            roles, so a center&apos;s own copy needs a database change (a center on each role, with its own access rules). Until then,
            give people the default role closest to what they need, limited to one event, class or zone where possible.
          </Alert>
        </div>
      </BlockGrid>

      <BlockGrid>
        <Card span={5} title="Grant a role" description="Center-wide grants carry the role's entitlements; a grant for one event, class or zone works only there.">
          <GrantForm
            roles={grantable}
            orgMemberLabel={rules.orgMemberLabel}
            today={todayInTz(tz)}
            scopes={{
              zone: (zones.data ?? []).map((z) => ({ id: z.id, label: z.name })),
              event: (events.data ?? []).map((e) => ({ id: e.id, label: `${e.name}${e.starts_at ? ` — ${formatDate(e.starts_at, tz)}` : ""}` })),
              class: (classes.data ?? []).map((c) => ({ id: c.id, label: c.name })),
            }}
          />
          {zones.error || events.error || classes.error ? (
            <p className="mt-3 text-sm text-danger">
              Some scope lists could not be loaded ({[zones.error && "zones", events.error && "events", classes.error && "classes"].filter(Boolean).join(", ")}).
              Reload to try again.
            </p>
          ) : null}
        </Card>

        <div className="col-span-12 lg:col-span-7">
          <Tabs
            active={show}
            tabs={[
              { key: "active", label: "Active grants", href: hrefWith("/settings/roles", sp, { show: undefined }) },
              { key: "ended", label: "Ended", href: hrefWith("/settings/roles", sp, { show: "ended" }) },
              { key: "all", label: "All", href: hrefWith("/settings/roles", sp, { show: "all" }) },
            ]}
          />
          {grantsRes.error ? (
            <QueryError what="role grants" error={grantsRes.error} retryHref="/settings/roles" />
          ) : (
            <Card padded={false}>
              {grants.length === 0 ? (
                <EmptyState title="No grants here" />
              ) : (
                <TableWrap>
                  <table className="crm-table">
                    <thead>
                      <tr>
                        <th>Person</th>
                        <th>Role</th>
                        <th>Scope</th>
                        <th>From</th>
                        <th>Until</th>
                        <th>Granted by</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {grants.map((g) => {
                        const active = isGrantActive(g, now);
                        const who = people.get(g.user_id);
                        return (
                          <tr key={g.id} className={active ? undefined : "opacity-60"}>
                            <td>
                              {who?.name ?? <span className="font-mono text-xs">{g.user_id.slice(0, 8)}</span>}
                              {who?.member_number ? <div className="font-mono text-xs text-muted">{who.member_number}</div> : null}
                            </td>
                            <td>{roleName.get(g.role_key) ?? g.role_key}</td>
                            <td>
                              {g.scope_kind === "center" ? "Whole center" : `${g.scope_kind}: ${g.scope_id ? (scopeName.get(g.scope_id) ?? "—") : "—"}`}
                            </td>
                            <td className="whitespace-nowrap">{formatDate(g.starts_at, tz)}</td>
                            <td className="whitespace-nowrap">{g.ends_at ? formatDate(g.ends_at, tz) : "No end"}</td>
                            <td className="text-[0.8125rem]">
                              {g.granted_by ? (people.get(g.granted_by)?.name ?? "—") : "—"}
                              {g.reason ? <div className="text-xs text-muted">{g.reason}</div> : null}
                            </td>
                            <td>
                              {active ? (
                                <ActionForm
                                  action={revokeGrantAction}
                                  submitLabel="Revoke"
                                  pendingLabel="Revoking…"
                                  variant="danger"
                                  size="sm"
                                  confirmMessage={
                                    g.user_id === session.userId
                                      ? "This is YOUR grant. Revoking it may remove your own access to this page. Continue?"
                                      : `Revoke ${roleName.get(g.role_key) ?? "this role"} from ${who?.name ?? "this person"} now?`
                                  }
                                >
                                  <input type="hidden" name="id" value={g.id} />
                                </ActionForm>
                              ) : (
                                <Badge>Ended</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </TableWrap>
              )}
            </Card>
          )}
        </div>
      </BlockGrid>
    </>
  );
}
