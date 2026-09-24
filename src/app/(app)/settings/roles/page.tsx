import type { Metadata } from "next";

import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, NoAccess, PageHeader, QueryError, TableWrap, Tabs } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { userNames } from "@/lib/data/lookups";
import { formatDate, todayInTz } from "@/lib/dates";
import { canAccess, isGrantActive } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { revokeGrantAction } from "./actions";
import { GrantForm } from "./grant-form";

export const metadata: Metadata = { title: "Roles and access" };

export default async function RolesPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Roles and access"
      description="Access is role + scope. Center-wide grants carry the role's permissions; a grant for one event, class or zone works only there. The database enforces every permission — this page only manages who holds what."
    />
  );
  if (!canAccess(session, "roles")) {
    return (
      <>
        {header}
        <NoAccess area="Roles and access" access="roles" />
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

  return (
    <>
      {header}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-5">
        <Card title="Grant a role" className="xl:col-span-2">
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

        <div className="xl:col-span-3">
          <Tabs
            active={show}
            tabs={[
              { key: "active", label: "Active grants", href: "/settings/roles" },
              { key: "ended", label: "Ended", href: "/settings/roles?show=ended" },
              { key: "all", label: "All", href: "/settings/roles?show=all" },
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
      </div>

      <Card title="Role catalog" description="Default roles and the permissions each one carries." padded={false} className="mt-6">
        <TableWrap>
          <table className="crm-table">
            <thead>
              <tr>
                <th>Role</th>
                <th>Tier</th>
                <th>Default scope</th>
                <th>Permissions</th>
              </tr>
            </thead>
            <tbody>
              {roles.map((r) => {
                const perms = Array.isArray(r.permissions) ? r.permissions.filter((p): p is string => typeof p === "string") : [];
                return (
                  <tr key={r.key}>
                    <td className="min-w-[14rem]">
                      <span className="font-semibold">{r.name}</span>
                      <div className="font-mono text-xs text-muted">{r.key}</div>
                      {r.description ? <div className="text-xs text-muted">{r.description}</div> : null}
                    </td>
                    <td className="capitalize">{r.tier}</td>
                    <td>{r.default_scope}</td>
                    <td>
                      {perms.length === 0 ? (
                        <span className="text-sm text-muted">{r.tier === "family" ? "From household relationships" : "Scoped duties only"}</span>
                      ) : (
                        <span className="flex flex-wrap gap-1">
                          {perms.map((p) => (
                            <Badge key={p} tone="neutral">
                              {p}
                            </Badge>
                          ))}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableWrap>
      </Card>
    </>
  );
}
