import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { DrawerForm } from "@/components/drawer-form";
import { BlockGrid, Card, EmptyState, QueryError, StatusText, TableWrap } from "@/components/ui";
import { isModuleEnabled } from "@/lib/modules";
import { can } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { centsLabel, MEMBERSHIP_TIERS, type SetupList } from "@/lib/setup-lists";

import { SetupHeader, setupGate } from "../_components/setup-ui";
import { saveListItemAction } from "./actions";

export const metadata: Metadata = { title: "Lists · Setup" };

const SUB = "the lists the modules use that no other screen creates · membership types, funds, inboxes, zones and Pathshala tracks";

type Row = Record<string, unknown> & { id: string };

function Hidden({ list, id }: { list: SetupList; id?: string }) {
  return (
    <>
      <input type="hidden" name="list" value={list} />
      {id ? <input type="hidden" name="id" value={id} /> : null}
    </>
  );
}

function Field({ label, htmlFor, hint, children }: { label: string; htmlFor: string; hint?: string; children: ReactNode }) {
  return (
    <div>
      <label className="crm-label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint ? <p className="crm-hint">{hint}</p> : null}
    </div>
  );
}

function Check({ name, label, defaultChecked }: { name: string; label: string; defaultChecked?: boolean }) {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" name={name} defaultChecked={defaultChecked} /> {label}
    </label>
  );
}

function Reason({ id }: { id: string }) {
  return (
    <Field label="Reason (optional, goes in the audit log)" htmlFor={id}>
      <input id={id} name="reason" className="crm-input" maxLength={500} />
    </Field>
  );
}

function MembershipTypeFields({ r }: { r?: Row }) {
  const k = r?.id ?? "new";
  return (
    <>
      <Field label="Name" htmlFor={`mt-name-${k}`}>
        <input id={`mt-name-${k}`} name="name" className="crm-input" defaultValue={String(r?.name ?? "")} maxLength={80} required />
      </Field>
      <Field label="Tier" htmlFor={`mt-tier-${k}`} hint="Community is free and has no dues; yearly renews; life never ends.">
        <select id={`mt-tier-${k}`} name="tier" className="crm-input" defaultValue={String(r?.tier ?? "yearly")}>
          {MEMBERSHIP_TIERS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Fee (dollars)" htmlFor={`mt-fee-${k}`} hint="0 when there is no fee. A decision with no safe default: confirm it with the treasurer.">
        <input id={`mt-fee-${k}`} name="fee" className="crm-input" inputMode="decimal" defaultValue={r ? String(Number(r.fee_cents ?? 0) / 100) : "0"} />
      </Field>
      <Field label="Period (months)" htmlFor={`mt-period-${k}`} hint="Empty for no end (community, life).">
        <input id={`mt-period-${k}`} name="period_months" className="crm-input" inputMode="numeric" defaultValue={r?.period_months == null ? "" : String(r.period_months)} />
      </Field>
      <Field label="Voting wait (days)" htmlFor={`mt-wait-${k}`} hint="Days after joining before a member may vote.">
        <input id={`mt-wait-${k}`} name="voting_wait_days" className="crm-input" inputMode="numeric" defaultValue={String(r?.voting_wait_days ?? 180)} />
      </Field>
      <Check name="includes_spouse" label="Includes the spouse" defaultChecked={r ? Boolean(r.includes_spouse) : true} />
      <Check name="reference_required" label="A reference from an existing member is required" defaultChecked={r ? Boolean(r.reference_required) : true} />
      <Check name="ec_approval_required" label="The Executive Committee approves each application" defaultChecked={r ? Boolean(r.ec_approval_required) : false} />
      {r ? <Check name="active" label="Offered (switch off to stop new applications; existing memberships stay)" defaultChecked={Boolean(r.active)} /> : null}
      {/* After the checkbox: FormData.get returns the first value, so an unticked box reads "false". */}
      {r ? <input type="hidden" name="active" value="false" /> : null}
      <Reason id={`mt-reason-${k}`} />
    </>
  );
}

export default async function SetupListsPage() {
  const session = await getSession();
  const gate = setupGate(session, SUB, "Setup lists");
  if (gate) return gate;
  const { db, center } = session;
  const [types, funds, inboxes, zones, tracks] = await Promise.all([
    db.from("membership_types").select("id, key, name, tier, fee_cents, period_months, includes_spouse, reference_required, ec_approval_required, voting_wait_days, active").eq("center_id", center.id).order("name"),
    db.from("funds").select("id, key, name, restricted, active").eq("center_id", center.id).order("name"),
    db.from("inboxes").select("id, key, name, response_target_hours").eq("center_id", center.id).order("name"),
    db.from("zones").select("id, name, zip_codes").eq("center_id", center.id).order("name"),
    db.from("pathshala_tracks").select("id, key, name").eq("center_id", center.id).order("name"),
  ]);
  const off = (m: string) => !isModuleEnabled(session, m);
  const canGiving = can(session, ["giving.manage"]);
  const canPathshala = can(session, ["pathshala.manage"]);
  // A switched-off module's rows are hidden by the database; say so instead of an empty list.
  const offNote = (m: string, label: string) => (
    <p className="text-[13px] text-muted">
      The {label} module is switched off, so this list is not needed. <Link href="/settings/modules" className="crm-link">Settings › Modules</Link>
    </p>
  );

  return (
    <>
      <SetupHeader session={session} sub={SUB} />
      <BlockGrid>
        <Card
          span={12}
          title="Membership types"
          description="Setup step: membership types · the tiers members join, their fees and rules"
          actions={
            off("membership") ? null : (
              <DrawerForm label="Add membership type" size="sm" title="New membership type" action={saveListItemAction} submitLabel="Add membership type" resetOnSuccess>
                <Hidden list="membership_types" />
                <MembershipTypeFields />
              </DrawerForm>
            )
          }
        >
          <div id="membership" data-list="membership_types">
            {off("membership") ? (
              offNote("membership", "Membership")
            ) : types.error ? (
              <QueryError what="the membership types" error={types.error} retryHref="/setup/lists" />
            ) : (types.data ?? []).length === 0 ? (
              <EmptyState title="No membership types yet">Add the tiers your members join (for example Yearly and Life).</EmptyState>
            ) : (
              <TableWrap>
                <table className="crm-table" aria-label="Membership types">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Tier</th>
                      <th className="num">Fee</th>
                      <th>Period</th>
                      <th>Rules</th>
                      <th>Status</th>
                      <th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {(types.data ?? []).map((t) => (
                      <tr key={t.id} data-row={t.key}>
                        <td className="font-bold">{t.name}</td>
                        <td>{t.tier}</td>
                        <td className="num">{centsLabel(t.fee_cents, center.currency)}</td>
                        <td>{t.period_months ? `${t.period_months} months` : "No end"}</td>
                        <td className="text-[12px] text-muted">
                          {[t.reference_required ? "reference" : null, t.ec_approval_required ? "EC approval" : null, `vote after ${t.voting_wait_days} days`].filter(Boolean).join(" · ")}
                        </td>
                        <td>{t.active ? <StatusText tone="ok">Offered</StatusText> : <span className="font-semibold text-muted">Switched off</span>}</td>
                        <td className="text-right">
                          <DrawerForm label="Edit" variant="ghost" size="xs" title={t.name} action={saveListItemAction} submitLabel="Save">
                            <Hidden list="membership_types" id={t.id} />
                            <MembershipTypeFields r={t as unknown as Row} />
                          </DrawerForm>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableWrap>
            )}
          </div>
        </Card>

        <Card
          span={6}
          title="Funds"
          description="Setup step: funds and campaigns · then add campaigns in Giving › Campaigns"
          actions={
            off("giving") || !canGiving ? null : (
              <DrawerForm label="Add fund" size="sm" title="New fund" action={saveListItemAction} submitLabel="Add fund" resetOnSuccess>
                <Hidden list="funds" />
                <Field label="Name" htmlFor="fund-name">
                  <input id="fund-name" name="name" className="crm-input" maxLength={80} required />
                </Field>
                <Check name="restricted" label="Restricted (gifts may be used only for this purpose)" />
                <Reason id="fund-reason" />
              </DrawerForm>
            )
          }
        >
          <div id="funds" data-list="funds" className="flex flex-col gap-2">
            {off("giving") ? (
              offNote("giving", "Pledges & donations")
            ) : funds.error ? (
              <QueryError what="the funds" error={funds.error} retryHref="/setup/lists" />
            ) : (funds.data ?? []).length === 0 ? (
              <EmptyState title="No funds yet">Every gift goes to a fund: add the general fund first, then restricted ones (construction, …).</EmptyState>
            ) : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {(funds.data ?? []).map((f) => (
                  <li key={f.id} data-row={f.key} className="flex items-center justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                    <span>
                      <strong>{f.name}</strong>
                      {f.restricted ? <span className="text-muted"> · restricted</span> : null}
                      {!f.active ? <span className="text-muted"> · switched off</span> : null}
                    </span>
                    {canGiving ? (
                      <DrawerForm label="Edit" variant="ghost" size="xs" title={f.name} action={saveListItemAction} submitLabel="Save">
                        <Hidden list="funds" id={f.id} />
                        <Field label="Name" htmlFor={`fund-name-${f.id}`}>
                          <input id={`fund-name-${f.id}`} name="name" className="crm-input" defaultValue={f.name} maxLength={80} />
                        </Field>
                        <Check name="restricted" label="Restricted" defaultChecked={f.restricted} />
                        <Check name="active" label="In use (switch off to stop new gifts to it)" defaultChecked={f.active} />
                        <input type="hidden" name="active" value="false" />
                        <Reason id={`fund-reason-${f.id}`} />
                      </DrawerForm>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {!off("giving") && !canGiving ? <p className="text-[12px] text-muted">Funds are added by the treasurer (giving.manage).</p> : null}
            {!off("giving") ? (
              <Link href="/giving/campaigns" className="crm-link text-[13px]">
                Campaigns (Giving › Opportunities › Campaigns)
              </Link>
            ) : null}
          </div>
        </Card>

        <Card
          span={6}
          title="Inboxes"
          description="Setup step: inboxes · where members' messages to the office land"
          actions={
            off("comms") ? null : (
              <DrawerForm label="Add inbox" size="sm" title="New inbox" action={saveListItemAction} submitLabel="Add inbox" resetOnSuccess>
                <Hidden list="inboxes" />
                <Field label="Name" htmlFor="inbox-name" hint="For example Office, Membership, Finance.">
                  <input id="inbox-name" name="name" className="crm-input" maxLength={80} required />
                </Field>
                <Field label="Response target (hours)" htmlFor="inbox-hours">
                  <input id="inbox-hours" name="response_target_hours" className="crm-input" inputMode="numeric" defaultValue="48" />
                </Field>
                <Reason id="inbox-reason" />
              </DrawerForm>
            )
          }
        >
          <div id="inboxes" data-list="inboxes">
            {off("comms") ? (
              offNote("comms", "Communications")
            ) : inboxes.error ? (
              <QueryError what="the inboxes" error={inboxes.error} retryHref="/setup/lists" />
            ) : (inboxes.data ?? []).length === 0 ? (
              <EmptyState title="No inboxes yet" />
            ) : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {(inboxes.data ?? []).map((i) => (
                  <li key={i.id} data-row={i.key} className="flex items-center justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                    <span>
                      <strong>{i.name}</strong> <span className="text-muted">· answer within {i.response_target_hours} h</span>
                    </span>
                    <DrawerForm label="Edit" variant="ghost" size="xs" title={i.name} action={saveListItemAction} submitLabel="Save">
                      <Hidden list="inboxes" id={i.id} />
                      <Field label="Name" htmlFor={`inbox-name-${i.id}`}>
                        <input id={`inbox-name-${i.id}`} name="name" className="crm-input" defaultValue={i.name} maxLength={80} />
                      </Field>
                      <Field label="Response target (hours)" htmlFor={`inbox-hours-${i.id}`}>
                        <input id={`inbox-hours-${i.id}`} name="response_target_hours" className="crm-input" inputMode="numeric" defaultValue={String(i.response_target_hours)} />
                      </Field>
                      <Reason id={`inbox-reason-${i.id}`} />
                    </DrawerForm>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card
          span={6}
          title="Zones"
          description="Setup step: zones (optional) · areas by ZIP code, for zone leads and WhatsApp groups"
          actions={
            <DrawerForm label="Add zone" size="sm" title="New zone" action={saveListItemAction} submitLabel="Add zone" resetOnSuccess>
              <Hidden list="zones" />
              <Field label="Name" htmlFor="zone-name">
                <input id="zone-name" name="name" className="crm-input" maxLength={80} required />
              </Field>
              <Field label="ZIP codes" htmlFor="zone-zips" hint="Separated by spaces or commas.">
                <textarea id="zone-zips" name="zip_codes" className="crm-input min-h-[70px]" />
              </Field>
              <Reason id="zone-reason" />
            </DrawerForm>
          }
        >
          <div id="zones" data-list="zones">
            {zones.error ? (
              <QueryError what="the zones" error={zones.error} retryHref="/setup/lists" />
            ) : (zones.data ?? []).length === 0 ? (
              <EmptyState title="No zones yet">Optional.</EmptyState>
            ) : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {(zones.data ?? []).map((z) => (
                  <li key={z.id} className="flex items-center justify-between gap-2 border-b border-line pb-1.5 last:border-0">
                    <span>
                      <strong>{z.name}</strong> <span className="text-muted">· {z.zip_codes.length} ZIP code{z.zip_codes.length === 1 ? "" : "s"}</span>
                    </span>
                    <DrawerForm label="Edit" variant="ghost" size="xs" title={z.name} action={saveListItemAction} submitLabel="Save">
                      <Hidden list="zones" id={z.id} />
                      <Field label="Name" htmlFor={`zone-name-${z.id}`}>
                        <input id={`zone-name-${z.id}`} name="name" className="crm-input" defaultValue={z.name} maxLength={80} />
                      </Field>
                      <Field label="ZIP codes" htmlFor={`zone-zips-${z.id}`}>
                        <textarea id={`zone-zips-${z.id}`} name="zip_codes" className="crm-input min-h-[70px]" defaultValue={z.zip_codes.join(" ")} />
                      </Field>
                      <Reason id={`zone-reason-${z.id}`} />
                    </DrawerForm>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Card>

        <Card
          span={6}
          title="Pathshala tracks"
          description="Setup step: Pathshala tracks and terms · then add terms in Pathshala › Terms"
          actions={
            off("pathshala") || !canPathshala ? null : (
              <DrawerForm label="Add track" size="sm" title="New Pathshala track" action={saveListItemAction} submitLabel="Add track" resetOnSuccess>
                <Hidden list="pathshala_tracks" />
                <Field label="Name" htmlFor="track-name" hint="For example Weekend Pathshala, Gujarati classes.">
                  <input id="track-name" name="name" className="crm-input" maxLength={80} required />
                </Field>
                <Reason id="track-reason" />
              </DrawerForm>
            )
          }
        >
          <div id="pathshala" data-list="pathshala_tracks">
            {off("pathshala") ? (
              offNote("pathshala", "Pathshala")
            ) : tracks.error ? (
              <QueryError what="the Pathshala tracks" error={tracks.error} retryHref="/setup/lists" />
            ) : (tracks.data ?? []).length === 0 ? (
              <EmptyState title="No tracks yet" />
            ) : (
              <ul className="flex flex-col gap-1.5 text-[13px]">
                {(tracks.data ?? []).map((t) => (
                  <li key={t.id} data-row={t.key}>
                    <strong>{t.name}</strong>
                  </li>
                ))}
              </ul>
            )}
            {!off("pathshala") && !canPathshala ? <p className="text-[12px] text-muted">Tracks are added by the Pathshala principal (pathshala.manage).</p> : null}
            {!off("pathshala") ? (
              <Link href="/pathshala/terms" className="crm-link mt-2 block text-[13px]">
                Terms (Pathshala › Terms)
              </Link>
            ) : null}
          </div>
        </Card>
      </BlockGrid>
    </>
  );
}
