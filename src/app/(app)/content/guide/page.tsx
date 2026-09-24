import type { Metadata } from "next";

import { Toggle } from "@/components/controls";
import { DrawerForm } from "@/components/drawer-form";
import { BlockGrid, Card, EmptyState, QueryError, TableWrap } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { personNames } from "@/lib/data/content-comms";
import { fetchAll } from "@/lib/data/fetch-all";
import { userNames } from "@/lib/data/lookups";
import { formatMonth, todayInTz } from "@/lib/dates";
import { can, canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { saveGuideSectionAction } from "../actions";
import { ContentHeader, contentGate } from "../shared";
import { ZoneLeadButton } from "./zone-lead-button";

export const metadata: Metadata = { title: "Content · Guide & directory" };

const AUDIENCE_LABEL: Record<string, string> = { members: "All members", pathshala: "Pathshala parents", volunteers: "Volunteers", zone: "Zone families" };

type Section = { id: string; slug: string; title: string; body_md: string; sort_order: number; public: boolean; is_checklist: boolean };

function GuideFields({ s }: { s?: Section }) {
  const p = s ? `gs-${s.id.slice(0, 6)}` : "gs-new";
  return (
    <>
      {s ? <input type="hidden" name="id" value={s.id} /> : null}
      <div>
        <label htmlFor={`${p}-title`} className="crm-label">
          Title
        </label>
        <input id={`${p}-title`} name="title" required defaultValue={s?.title ?? ""} className="crm-input" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor={`${p}-slug`} className="crm-label">
            Web address
          </label>
          <input id={`${p}-slug`} name="slug" required pattern="[a-z0-9-]+" defaultValue={s?.slug ?? ""} className="crm-input" />
        </div>
        <div>
          <label htmlFor={`${p}-ord`} className="crm-label">
            Order
          </label>
          <input id={`${p}-ord`} name="sort_order" inputMode="numeric" defaultValue={s?.sort_order ?? 0} className="crm-input" />
        </div>
      </div>
      <div>
        <label htmlFor={`${p}-body`} className="crm-label">
          Text (Markdown)
        </label>
        <textarea id={`${p}-body`} name="body_md" required rows={10} defaultValue={s?.body_md ?? ""} className="crm-input font-mono text-[13px]" />
      </div>
      <Toggle name="public" label="Visible to guests" defaultChecked={s?.public ?? true} onNote="Guests can read it" offNote="Members only" />
      <Toggle name="is_checklist" label="Checklist" defaultChecked={s?.is_checklist ?? false} onNote="Shown as a checklist" offNote="Shown as text" />
    </>
  );
}

export default async function GuidePage() {
  const session = await getSession();
  const { db, center } = session;
  const short = center.short_name || center.name;
  const sub = `New to ${short} guide, zones and zone leads, administration roster, WhatsApp and volunteer groups`;
  const gate = contentGate(session, sub);
  if (gate) return gate;
  const canManage = canAccess(session, "contentManage");
  const canGrant = canAccess(session, "roles");
  const seesFamilies = can(session, ["people.view", "people.manage"]);

  const [zones, leads, households, roster, groups, joined, volunteers, guide, leadRole] = await Promise.all([
    db.from("zones").select("id, name, zip_codes").eq("center_id", center.id).order("name"),
    canGrant
      ? db.from("role_grants").select("user_id, scope_id, ends_at").eq("center_id", center.id).eq("role_key", "zone_lead").eq("scope_kind", "zone")
      : null,
    seesFamilies
      ? fetchAll((f, t) => db.from("households").select("id, zone_id").eq("center_id", center.id).is("merged_into_id", null).not("zone_id", "is", null).order("id").range(f, t))
      : null,
    db.from("role_roster").select("*").eq("center_id", center.id).order("body").order("sort_order"),
    db.from("whatsapp_groups").select("id, name, audience, zone_id, active").eq("center_id", center.id).order("name"),
    db.from("whatsapp_join_requests").select("group_id").eq("center_id", center.id).eq("status", "added").limit(10000),
    db.from("volunteer_groups").select("id, name, coordinator_person_id").eq("center_id", center.id).order("name"),
    db.from("guide_sections").select("id, slug, title, body_md, sort_order, public, is_checklist").eq("center_id", center.id).order("sort_order"),
    canGrant ? db.from("roles").select("key, name, tier, default_scope").eq("key", "zone_lead").maybeSingle() : null,
  ]);
  const now = new Date().toISOString();
  const activeLeads = (leads?.data ?? []).filter((g) => !g.ends_at || g.ends_at > now);
  const [leadNames, people] = await Promise.all([
    userNames(db, center.id, activeLeads.map((g) => g.user_id)),
    personNames(db, [...(roster.data ?? []).map((r) => r.person_id), ...(volunteers.data ?? []).map((v) => v.coordinator_person_id)]),
  ]);
  const families = new Map<string, number>();
  for (const h of households?.data ?? []) if (h.zone_id) families.set(h.zone_id, (families.get(h.zone_id) ?? 0) + 1);
  const addedCount = new Map<string, number>();
  for (const j of joined.data ?? []) addedCount.set(j.group_id, (addedCount.get(j.group_id) ?? 0) + 1);
  const orgMemberLabel = identifierRules(center.rules).orgMemberLabel;
  const today = todayInTz(center.time_zone);

  return (
    <>
      <ContentHeader sub={sub} />
      <BlockGrid>
        <Card title="Zones" span={7} padded={false}>
          {zones.error ? (
            <div className="p-4">
              <QueryError what="the zones" error={zones.error} retryHref="/content/guide" />
            </div>
          ) : (zones.data ?? []).length === 0 ? (
            <EmptyState title="No zones yet">Zones are set up in Settings › Center.</EmptyState>
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Zone</th>
                    <th>Areas (ZIP codes)</th>
                    <th className="num">ZIPs</th>
                    <th>Zone lead</th>
                    <th className="num">Families</th>
                  </tr>
                </thead>
                <tbody>
                  {(zones.data ?? []).map((z) => {
                    const lead = activeLeads.filter((g) => g.scope_id === z.id);
                    return (
                      <tr key={z.id}>
                        <td className="font-bold">{z.name}</td>
                        <td className="text-xs text-ink-2">{z.zip_codes.join(", ") || "—"}</td>
                        <td className="num">{z.zip_codes.length}</td>
                        <td>
                          {!canGrant ? (
                            <span className="text-xs text-muted" title="Seeing and assigning zone leads needs roles.manage">
                              —
                            </span>
                          ) : lead.length > 0 ? (
                            <span className="font-semibold">
                              {lead.map((g) => (g.user_id === session.userId ? "You" : (leadNames.get(g.user_id)?.name ?? "Assigned"))).join(", ")}
                            </span>
                          ) : leadRole?.data ? (
                            <ZoneLeadButton zone={z} role={leadRole.data} orgMemberLabel={orgMemberLabel} today={today} />
                          ) : (
                            <span className="cc-status-warn">No lead</span>
                          )}
                        </td>
                        <td className="num">{seesFamilies ? (families.get(z.id) ?? 0).toLocaleString() : "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableWrap>
          )}
          {leads?.error || households?.error ? (
            <p className="px-4 pb-3 text-[13px] text-danger">Zone leads or family counts could not be loaded. Reload to try again.</p>
          ) : null}
          {!canGrant || !seesFamilies ? (
            <p className="px-4 pb-3 pt-1 text-xs text-muted">
              {!canGrant ? "Zone leads show for roles.manage holders. " : ""}
              {!seesFamilies ? "Family counts need people.view." : ""}
            </p>
          ) : null}
        </Card>

        <Card title="Administration roster" description="Messages go to the role, so contact follows the person holding it" span={5} padded={false}>
          {roster.error ? (
            <div className="p-4">
              <QueryError what="the roster" error={roster.error} retryHref="/content/guide" />
            </div>
          ) : (roster.data ?? []).length === 0 ? (
            <EmptyState title="No roster roles yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Role</th>
                    <th>Person</th>
                    <th>Term ends</th>
                  </tr>
                </thead>
                <tbody>
                  {(roster.data ?? []).map((r) => (
                    <tr key={r.id}>
                      <td className="font-bold">{r.title}</td>
                      <td>{r.person_id ? (people.get(r.person_id) ?? "Assigned") : <span className="cc-status-warn">Vacant</span>}</td>
                      <td>{r.term_ends_on ? formatMonth(r.term_ends_on.slice(0, 7) + "-01") : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card title="WhatsApp groups" span={6} padded={false}>
          {groups.error ? (
            <div className="p-4">
              <QueryError what="the WhatsApp groups" error={groups.error} retryHref="/content/guide" />
            </div>
          ) : (groups.data ?? []).length === 0 ? (
            <EmptyState title="No WhatsApp groups yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>For</th>
                    <th className="num">Added from the app</th>
                  </tr>
                </thead>
                <tbody>
                  {(groups.data ?? []).map((g) => (
                    <tr key={g.id}>
                      <td className="font-bold">
                        {g.name}
                        {!g.active ? <div className="text-xs font-normal text-muted">Inactive</div> : null}
                      </td>
                      <td>{AUDIENCE_LABEL[g.audience] ?? g.audience}</td>
                      <td className="num">{joined.error ? "—" : (addedCount.get(g.id) ?? 0).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
          <p className="px-4 pb-3 pt-1 text-xs text-muted">WhatsApp does not share group sizes; the count is people added from the join queue.</p>
        </Card>

        <Card title="Volunteer groups" description="Interest forms flow to the volunteer platform" span={6} padded={false}>
          {volunteers.error ? (
            <div className="p-4">
              <QueryError what="the volunteer groups" error={volunteers.error} retryHref="/content/guide" />
            </div>
          ) : (volunteers.data ?? []).length === 0 ? (
            <EmptyState title="No volunteer groups yet" />
          ) : (
            <TableWrap>
              <table className="crm-table">
                <thead>
                  <tr>
                    <th>Group</th>
                    <th>Coordinator</th>
                  </tr>
                </thead>
                <tbody>
                  {(volunteers.data ?? []).map((v) => (
                    <tr key={v.id}>
                      <td className="font-bold">{v.name}</td>
                      <td>{v.coordinator_person_id ? (people.get(v.coordinator_person_id) ?? "Assigned") : <span className="text-muted">Not set</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableWrap>
          )}
        </Card>

        <Card
          title={`New to ${short} guide`}
          description="Sections members and guests read in the app"
          span={12}
          actions={
            canManage ? (
              <DrawerForm label="New section" size="sm" kicker="Guide" title="New section" action={saveGuideSectionAction} submitLabel="Add section">
                <GuideFields />
              </DrawerForm>
            ) : null
          }
        >
          {guide.error ? (
            <QueryError what="the guide" error={guide.error} retryHref="/content/guide" />
          ) : (guide.data ?? []).length === 0 ? (
            <EmptyState title="No guide sections yet" />
          ) : (
            <div className="flex flex-col gap-1.5">
              {(guide.data ?? []).map((s) => (
                <div key={s.id} className="cc-kv">
                  <span className="min-w-0">
                    <span className="font-bold">{s.title}</span>
                    <span className="text-xs text-muted">
                      {" "}
                      · /{s.slug} · {s.public ? "public" : "members only"}
                      {s.is_checklist ? " · checklist" : ""}
                    </span>
                    <span className="mt-0.5 line-clamp-2 block whitespace-pre-line text-xs text-ink-2">{s.body_md}</span>
                  </span>
                  {canManage ? (
                    <DrawerForm label="Edit" variant="ghost" size="xs" kicker="Guide" title={s.title} action={saveGuideSectionAction} submitLabel="Save section" resetOnSuccess={false}>
                      <GuideFields s={s} />
                    </DrawerForm>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </Card>
      </BlockGrid>
    </>
  );
}
