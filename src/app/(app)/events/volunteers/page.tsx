import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm } from "@/components/action-form";
import { ActionButton } from "@/components/events/action-button";
import { LoadProblem } from "@/components/events/load-problem";
import { PersonPicker } from "@/components/events/person-picker";
import { BlockGrid, Card, ChipLinks, EmptyState, NoAccess, PageHeader, TableWrap } from "@/components/ui";
import type { Tables } from "@/lib/database.types";
import { load, resolvePeopleNames, rows } from "@/lib/data/events";
import { addDays, formatDate, todayInTz } from "@/lib/dates";
import { humanize } from "@/lib/events/format";
import { can, canAccess } from "@/lib/permissions";
import { param, type RawSearchParams } from "@/lib/search-params";
import { getSession } from "@/lib/session";

import { addInterest, recordBackgroundCheck, saveGroup, setInterestStatus } from "./actions";

export const metadata: Metadata = { title: "Volunteers" };

type Payload =
  | { kind: "groups"; groups: Tables<"volunteer_groups">[]; interests: { group_id: string; status: string }[]; names: Map<string, string> }
  | { kind: "interests"; groups: Tables<"volunteer_groups">[]; interests: Tables<"volunteer_interests">[]; names: Map<string, string> }
  | { kind: "checks"; checks: Tables<"background_checks">[]; names: Map<string, string> };

function GroupFields({ g, coordinator }: { g: Tables<"volunteer_groups"> | null; coordinator: { id: string; name: string; detail: null } | null }) {
  const p = g ? g.id.slice(0, 6) : "new";
  return (
    <div className="mb-3 flex flex-col gap-3">
      <div>
        <label htmlFor={`vg-name-${p}`} className="crm-label">
          Name
        </label>
        <input id={`vg-name-${p}`} name="name" required defaultValue={g?.name ?? ""} className="crm-input" />
      </div>
      <PersonPicker name="coordinator_person_id" label="Coordinator" initial={coordinator ? [coordinator] : []} />
      <div>
        <label htmlFor={`vg-waiver-${p}`} className="crm-label">
          Waiver required
        </label>
        <input id={`vg-waiver-${p}`} name="requires_waiver_kind" defaultValue={g?.requires_waiver_kind ?? ""} className="crm-input" />
        <p className="crm-hint">Legal document kind, e.g. volunteer_waiver</p>
      </div>
      <label className="flex min-h-9 items-center gap-2 text-[13px]">
        <input type="checkbox" name="requires_background_check" defaultChecked={g?.requires_background_check ?? false} className="h-4 w-4 accent-navy" />
        Background check required
      </label>
    </div>
  );
}

function statusClass(s: string) {
  return s === "active" || s === "clear" ? "cc-status-ok" : s === "interested" || s === "requested" ? "cc-status-warn" : s === "flagged" ? "cc-status-bad" : "font-semibold text-muted";
}

export default async function VolunteersPage({ searchParams }: { searchParams: Promise<RawSearchParams> }) {
  const session = await getSession();
  const sp = await searchParams;
  const header = (
    <PageHeader
      eyebrow={
        <Link href="/events" className="crm-link">
          ← Events
        </Link>
      }
      title="Volunteers"
      description="Seva groups and coordinators, who has signed up, and background checks with expiry warnings"
    />
  );
  if (!canAccess(session, "volunteers")) {
    return (
      <>
        {header}
        <NoAccess area="Volunteers" access="volunteers" />
      </>
    );
  }
  const staff = can(session, ["volunteers.view", "volunteers.manage"]);
  const safety = can(session, ["safety.view", "safety.manage"]);
  const tabs = [...(staff ? [{ key: "groups", label: "Groups" }, { key: "interests", label: "Volunteers" }] : []), ...(safety ? [{ key: "checks", label: "Background checks" }] : [])];
  const tab = tabs.find((t) => t.key === param(sp, "tab"))?.key ?? tabs[0].key;
  const groupFilter = param(sp, "group") ?? null;
  const { db, center } = session;
  const today = todayInTz(center.time_zone);

  const res = await load(async (): Promise<Payload> => {
    if (tab === "checks") {
      const checks = rows(
        await db.from("background_checks").select("*").eq("center_id", center.id).order("expires_on", { ascending: true, nullsFirst: false }),
        "background checks",
      );
      return { kind: "checks", checks, names: await resolvePeopleNames(db, checks.map((c) => c.person_id)) };
    }
    const groups = rows(await db.from("volunteer_groups").select("*").eq("center_id", center.id).order("name"), "volunteer groups");
    if (tab === "groups") {
      const interests = rows(await db.from("volunteer_interests").select("group_id, status").eq("center_id", center.id), "volunteer sign-ups");
      return { kind: "groups", groups, interests, names: await resolvePeopleNames(db, groups.map((g) => g.coordinator_person_id)) };
    }
    let q = db.from("volunteer_interests").select("*").eq("center_id", center.id).order("created_at", { ascending: false }).limit(300);
    if (groupFilter) q = q.eq("group_id", groupFilter);
    const interests = rows(await q, "volunteers");
    return { kind: "interests", groups, interests, names: await resolvePeopleNames(db, interests.map((i) => i.person_id)) };
  });
  if (!res.ok) {
    return (
      <>
        {header}
        <LoadProblem message={res.error} retryHref={`/events/volunteers?tab=${tab}`} />
      </>
    );
  }
  const d = res.data;
  const manage = can(session, "volunteers.manage");

  return (
    <>
      {header}
      <ChipLinks label="Volunteer views" active={tab} items={tabs.map((t) => ({ ...t, href: `/events/volunteers?tab=${t.key}` }))} />

      {d.kind === "groups" ? (
        <BlockGrid>
          <div className={`col-span-12 flex flex-col gap-3 ${manage ? "lg:col-span-8" : ""}`}>
            {d.groups.length === 0 ? (
              <Card>
                <EmptyState title="No groups yet" />
              </Card>
            ) : null}
            {d.groups.map((g) => {
              const mine = d.interests.filter((i) => i.group_id === g.id);
              return (
                <Card
                  key={g.id}
                  title={
                    <Link href={`/events/volunteers?tab=interests&group=${g.id}`} className="hover:underline">
                      {g.name}
                    </Link>
                  }
                  description={`Coordinator: ${g.coordinator_person_id ? (d.names.get(g.coordinator_person_id) ?? "assigned") : "not set"} · ${mine.filter((i) => i.status === "active").length} active · ${mine.filter((i) => i.status === "interested").length} interested`}
                  actions={
                    <span className="flex gap-2 text-[13px]">
                      {g.requires_background_check ? <span className="cc-status-warn">Background check</span> : null}
                      {g.requires_waiver_kind ? <span className="font-bold text-navy">Waiver required</span> : null}
                    </span>
                  }
                >
                  {manage ? (
                    <details>
                      <summary className="cursor-pointer text-[13px] font-bold text-navy">Edit group</summary>
                      <div className="mt-2">
                        <ActionForm action={saveGroup.bind(null, g.id)} submitLabel="Save group" size="sm">
                          <GroupFields
                            g={g}
                            coordinator={g.coordinator_person_id ? { id: g.coordinator_person_id, name: d.names.get(g.coordinator_person_id) ?? "Coordinator", detail: null } : null}
                          />
                        </ActionForm>
                      </div>
                    </details>
                  ) : null}
                </Card>
              );
            })}
          </div>
          {manage ? (
            <Card span={4} title="New group">
              <ActionForm action={saveGroup.bind(null, null)} submitLabel="Add group" resetOnSuccess>
                <GroupFields g={null} coordinator={null} />
              </ActionForm>
            </Card>
          ) : null}
        </BlockGrid>
      ) : null}

      {d.kind === "interests" ? (
        <BlockGrid>
          <Card span={manage ? 8 : 12} padded={false} title={groupFilter ? (d.groups.find((g) => g.id === groupFilter)?.name ?? "Group") : "All volunteers"}>
            <div className="px-2.5">
              <ChipLinks
                label="Group"
                active={groupFilter ?? ""}
                items={[{ key: "", label: "All groups", href: "/events/volunteers?tab=interests" }, ...d.groups.map((g) => ({ key: g.id, label: g.name, href: `/events/volunteers?tab=interests&group=${g.id}` }))]}
              />
            </div>
            {d.interests.length === 0 ? (
              <EmptyState title="Nobody here yet" />
            ) : (
              <TableWrap>
                <table className="crm-table">
                  <thead>
                    <tr>
                      <th>Volunteer</th>
                      <th>Group</th>
                      <th>Status</th>
                      {manage ? <th className="row-actions" /> : null}
                    </tr>
                  </thead>
                  <tbody>
                    {d.interests.map((i) => (
                      <tr key={i.id}>
                        <td className="font-bold">{d.names.get(i.person_id) ?? "Volunteer"}</td>
                        <td>{d.groups.find((g) => g.id === i.group_id)?.name ?? "—"}</td>
                        <td>
                          <span className={statusClass(i.status)}>{humanize(i.status)}</span>
                        </td>
                        {manage ? (
                          <td className="row-actions">
                            {i.status !== "active" ? (
                              <ActionButton action={setInterestStatus.bind(null, i.id)} fields={{ status: "active" }} label="Make active" variant="ok" />
                            ) : (
                              <ActionButton action={setInterestStatus.bind(null, i.id)} fields={{ status: "inactive" }} label="Inactive" />
                            )}
                          </td>
                        ) : null}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          {manage ? (
            <Card span={4} title="Add a volunteer">
              <ActionForm action={addInterest} submitLabel="Add" resetOnSuccess>
                <div className="mb-3 flex flex-col gap-3">
                  <PersonPicker name="person_id" label="Person" required />
                  <div>
                    <label htmlFor="vi-group" className="crm-label">
                      Group
                    </label>
                    <select id="vi-group" name="group_id" required defaultValue={groupFilter ?? ""} className="crm-input">
                      <option value="">Choose</option>
                      {d.groups.map((g) => (
                        <option key={g.id} value={g.id}>
                          {g.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="vi-status" className="crm-label">
                      Status
                    </label>
                    <select id="vi-status" name="status" defaultValue="active" className="crm-input">
                      <option value="active">Active</option>
                      <option value="interested">Interested</option>
                    </select>
                  </div>
                </div>
              </ActionForm>
            </Card>
          ) : null}
        </BlockGrid>
      ) : null}

      {d.kind === "checks" ? (
        <BlockGrid>
          <Card span={can(session, "safety.manage") ? 8 : 12} padded={false} title="Background checks">
            {d.checks.length === 0 ? (
              <EmptyState title="No checks recorded" />
            ) : (
              <TableWrap>
                <table className="crm-table min-w-[560px]">
                  <thead>
                    <tr>
                      <th>Person</th>
                      <th>Result</th>
                      <th>Cleared</th>
                      <th>Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.checks.map((c) => {
                      const expired = c.expires_on !== null && c.expires_on < today;
                      const soon = !expired && c.expires_on !== null && c.expires_on <= addDays(today, 30);
                      return (
                        <tr key={c.id}>
                          <td className="font-bold">{d.names.get(c.person_id) ?? "Volunteer"}</td>
                          <td>
                            <span className={statusClass(c.status)}>{humanize(c.status)}</span>
                          </td>
                          <td>{formatDate(c.cleared_on, center.time_zone)}</td>
                          <td>
                            {formatDate(c.expires_on, center.time_zone)}
                            {expired ? <span className="cc-status-bad ml-2">Expired</span> : null}
                            {soon ? <span className="cc-status-warn ml-2">Expires within 30 days</span> : null}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </Card>
          {can(session, "safety.manage") ? (
            <Card span={4} title="Record a check">
              <ActionForm action={recordBackgroundCheck} submitLabel="Record" resetOnSuccess>
                <div className="mb-3 flex flex-col gap-3">
                  <PersonPicker name="person_id" label="Person" required />
                  <div>
                    <label htmlFor="bc-status" className="crm-label">
                      Result
                    </label>
                    <select id="bc-status" name="status" defaultValue="clear" className="crm-input">
                      <option value="requested">Requested</option>
                      <option value="clear">Clear</option>
                      <option value="flagged">Flagged</option>
                      <option value="expired">Expired</option>
                    </select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="bc-cleared" className="crm-label">
                        Cleared on
                      </label>
                      <input id="bc-cleared" type="date" name="cleared_on" className="crm-input" />
                    </div>
                    <div>
                      <label htmlFor="bc-expires" className="crm-label">
                        Expires on
                      </label>
                      <input id="bc-expires" type="date" name="expires_on" className="crm-input" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label htmlFor="bc-provider" className="crm-label">
                        Provider
                      </label>
                      <input id="bc-provider" name="provider" className="crm-input" />
                    </div>
                    <div>
                      <label htmlFor="bc-ref" className="crm-label">
                        Reference
                      </label>
                      <input id="bc-ref" name="provider_ref" className="crm-input" />
                    </div>
                  </div>
                </div>
              </ActionForm>
            </Card>
          ) : null}
        </BlockGrid>
      ) : null}
    </>
  );
}
