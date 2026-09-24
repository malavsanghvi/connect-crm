import Link from "next/link";
import type { ReactNode } from "react";

import { makePrimaryAction } from "@/app/(app)/people/actions";
import { ActionForm } from "@/components/action-form";
import { DrawerSection, KeyValueRow, QueryError, buttonClass, capitalize } from "@/components/ui";
import { identifierRules } from "@/lib/center-rules";
import { loadHouseholdRecord, loadPersonRecord, type Activity, type Section } from "@/lib/data/people-records";
import { formatDate } from "@/lib/dates";
import { explainError } from "@/lib/errors";
import { formatCents } from "@/lib/money";
import { can, canAccess } from "@/lib/permissions";
import { formatPhone, householdSubline, relationshipLabel, toUsDate } from "@/lib/people";
import { hrefWith, isUuid, param, type RawSearchParams } from "@/lib/search-params";
import type { CrmSession } from "@/lib/session";

import { UrlDrawer } from "./client";
import { AddPersonDrawer, HouseholdEditDrawer, MovePersonDrawer, PersonDrawer } from "./forms";

// The People module's record drawers. Which one is open lives in the URL:
//   ?hh=<id>            household      ?hh=<id>&mode=edit   household edit
//   ?hh=<id>&mode=add   add a person   ?person=<id>         person
//   ?person=<id>&mode=move             move household
// Any People page renders <PeopleDrawers> with its own path, so a drawer opens
// over the list you came from and closes back to it.

export type DrawerTarget = { hh?: string; person?: string; mode?: string };

/** URL of `base` with a drawer open (or, with no target, closed). Other params are kept. */
export function drawerHref(base: string, sp: RawSearchParams, target: DrawerTarget = {}): string {
  return hrefWith(base, sp, { hh: target.hh ?? null, person: target.person ?? null, app: null, mode: target.mode ?? null });
}

function monthYear(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", year: "numeric" }).format(new Date(iso));
}
function shortDate(iso: string, tz: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: tz, month: "short", day: "numeric" }).format(new Date(iso));
}

function SectionError({ what, error }: { what: string; error: unknown }) {
  return <KeyValueRow label={`Could not load ${what}`} value={capitalize(explainError(error))} tone="bad" />;
}

function ActivitySection({ activity, tz }: { activity: Section<Activity[]> | null; tz: string }) {
  return (
    <DrawerSection title="Recent activity (audit)">
      {activity === null ? (
        <KeyValueRow label="Audit history" value="Needs the audit.view permission" tone="ink" />
      ) : !activity.ok ? (
        <SectionError what="recent activity" error={activity.error} />
      ) : activity.data.length === 0 ? (
        <KeyValueRow label="No recorded changes yet" />
      ) : (
        activity.data.map((a, i) => <KeyValueRow key={i} label={`${shortDate(a.at, tz)} · ${a.what}`} value={a.detail || undefined} />)
      )}
    </DrawerSection>
  );
}

function NotFoundDrawer({ closeHref, kind, error }: { closeHref: string; kind: string; error?: unknown }) {
  return (
    <UrlDrawer closeHref={closeHref} kicker={kind} title={error ? `Could not load this ${kind.toLowerCase()}` : `${capitalize(kind.toLowerCase())} not found`}>
      {error ? (
        <QueryError what={`this ${kind.toLowerCase()}`} error={error} />
      ) : (
        <p className="text-[13px] text-muted">It may have been merged into another record, or your role cannot see it.</p>
      )}
    </UrlDrawer>
  );
}

export async function PeopleDrawers({ session, sp, base }: { session: CrmSession; sp: RawSearchParams; base: string }) {
  const hh = param(sp, "hh");
  const person = param(sp, "person");
  const mode = param(sp, "mode");
  if (isUuid(person)) return <PersonDrawerView session={session} id={person} sp={sp} base={base} mode={mode} />;
  if (isUuid(hh)) return <HouseholdDrawerView session={session} id={hh} sp={sp} base={base} mode={mode} />;
  return null;
}

// ---------------------------------------------------------------------------
// Household
// ---------------------------------------------------------------------------
async function HouseholdDrawerView({ session, id, sp, base, mode }: { session: CrmSession; id: string; sp: RawSearchParams; base: string; mode?: string }) {
  const closeHref = drawerHref(base, sp);
  const { record: h, error } = await loadHouseholdRecord(session, id);
  if (error || !h) return <NotFoundDrawer closeHref={closeHref} kind="Household" error={error ?? undefined} />;
  const tz = session.center.time_zone;
  const canEdit = canAccess(session, "householdsEdit") && !h.mergedIntoId;
  const self = drawerHref(base, sp, { hh: id });

  if (mode === "edit" && canEdit) {
    return (
      <HouseholdEditDrawer
        closeHref={closeHref}
        backHref={self}
        zones={h.zones}
        canChangeTier={can(session, "people.approve")}
        data={{
          id: h.id,
          number: h.number,
          name: h.name,
          line1: h.address.line1 ?? "",
          line2: h.address.line2 ?? "",
          city: h.address.city ?? "",
          state: h.address.state ?? "",
          postal: h.address.postal ?? "",
          zoneId: h.zoneId ?? "",
          directory: h.directoryOptIn,
          mail: h.physicalMailOptIn,
          tier: h.tier ?? "",
          since: h.since,
          phone: formatPhone(h.phone),
        }}
        notes={
          <DrawerSection title="Notes">
            <KeyValueRow label="Tier changes" value="Normally through an application with a reference" />
            <KeyValueRow label="Address changes" value="Pick the zone here; it is not set from the ZIP yet" />
          </DrawerSection>
        }
      />
    );
  }
  if (mode === "add" && canEdit) {
    const primary = h.members.ok ? h.members.data.find((m) => m.isPrimary) : undefined;
    return (
      <AddPersonDrawer
        householdId={h.id}
        householdName={h.name}
        householdNumber={h.number}
        lastName={primary?.name.split(" ").slice(-1)[0] ?? ""}
        closeHref={closeHref}
        backHref={self}
        personHref={drawerHref(base, sp, { person: "{id}" }).replace("%7Bid%7D", "{id}")}
      />
    );
  }

  const members = h.members;
  const onApp = members.ok && members.data.some((m) => m.onApp);
  const photos = members.ok ? members.data.filter((m) => m.photoOptIn).length : 0;
  const memberCount = members.ok ? members.data.length : 0;

  return (
    <UrlDrawer
      closeHref={closeHref}
      kicker={`Household · ${h.number ?? "no number yet"}`}
      title={h.name}
      subtitle={householdSubline({ tier: h.tier, since: h.since, zone: h.zoneName, phone: h.phone })}
      footer={
        <>
          {canAccess(session, "recordPayment") && !h.mergedIntoId ? (
            <Link href={`/giving/payments?household=${h.id}`} className={buttonClass("primary")}>
              Record payment
            </Link>
          ) : null}
          {canEdit ? (
            <Link href={`/people/merge?household=${h.id}`} className={buttonClass("ghost")}>
              Merge duplicate
            </Link>
          ) : null}
          {canEdit ? (
            <Link href={drawerHref(base, sp, { hh: id, mode: "edit" })} scroll={false} className={buttonClass("primary")}>
              Edit household
            </Link>
          ) : null}
          <Link href={`/households/${h.id}`} className={buttonClass("ghost")}>
            Full record
          </Link>
        </>
      }
    >
      {h.mergedIntoId ? (
        <KeyValueRow label="This household was merged into another household" value="Open it" href={drawerHref(base, sp, { hh: h.mergedIntoId })} tone="warn" />
      ) : null}
      <DrawerSection title="Members · tap to open">
        {!members.ok ? (
          <SectionError what="members" error={members.error} />
        ) : members.data.length === 0 ? (
          <KeyValueRow label="No current members" />
        ) : (
          members.data.map((m) => {
            const minor = m.age !== null && m.age < 18;
            return (
              <KeyValueRow
                key={m.personId}
                href={drawerHref(base, sp, { person: m.personId })}
                label={`${m.name} · ${relationshipLabel(m.isPrimary ? "primary" : m.role, m.gender)}${m.alsoPrimaryOf ? ` · also primary of ${m.alsoPrimaryOf.number ?? m.alsoPrimaryOf.name}` : ""}`}
                value={
                  minor
                    ? `Age ${m.age}${m.dateOfBirth ? ` · DOB ${toUsDate(m.dateOfBirth)}` : ""}`
                    : `${m.age === null ? "Age not recorded" : "Adult"} · ${m.onApp ? "on app" : "not on app"}`
                }
                tone="navy"
              />
            );
          })
        )}
        {canEdit ? (
          <Link href={drawerHref(base, sp, { hh: id, mode: "add" })} scroll={false} className="cc-kv !border-navy text-navy">
            <span>+ Add a person to this household</span>
            <span className="font-bold">Add</span>
          </Link>
        ) : null}
      </DrawerSection>

      <DrawerSection title="Giving · household level">
        {h.giving === null ? (
          <KeyValueRow label="Open balance" value="Needs a giving permission" />
        ) : !h.giving.ok ? (
          <SectionError what="giving" error={h.giving.error} />
        ) : (
          <>
            <KeyValueRow label="Open balance" value={formatCents(h.giving.data.openCents, session.center.currency)} tone="warn" />
            {h.giving.data.pledges.map((p) => (
              <KeyValueRow
                key={p.id}
                label={`${p.label} · ${monthYear(p.date, tz)}`}
                value={`${formatCents(p.paid, session.center.currency)} / ${formatCents(p.amount, session.center.currency)}`}
                tone={p.closed ? "ok" : "warn"}
              />
            ))}
          </>
        )}
      </DrawerSection>

      <DrawerSection title="Preferences and consent">
        <KeyValueRow label="Directory" value={h.directoryOptIn ? "Opted in" : "Opted out"} />
        <KeyValueRow
          label="Photos"
          value={!members.ok || memberCount === 0 ? "—" : photos === memberCount ? "Opted in" : photos === 0 ? "Opted out" : `${photos} of ${memberCount} opted in`}
        />
        <KeyValueRow label="Physical mail" value={h.physicalMailOptIn ? "Opted in" : "Opted out"} />
        <KeyValueRow label="Signed in on app" value={members.ok ? (onApp ? "Yes" : "No") : "—"} />
      </DrawerSection>

      {h.duplicates && (!h.duplicates.ok || h.duplicates.data.length > 0) ? (
        <DrawerSection title="Possible duplicates">
          {!h.duplicates.ok ? (
            <SectionError what="possible duplicates" error={h.duplicates.error} />
          ) : (
            h.duplicates.data.map((d) => (
              <KeyValueRow key={d.candidateId} label={d.otherName} value="Compare" href={`/people/merge?household=${h.id}&other=${d.otherId}`} tone="navy" />
            ))
          )}
        </DrawerSection>
      ) : null}

      <ActivitySection activity={h.activity} tz={tz} />
    </UrlDrawer>
  );
}

// ---------------------------------------------------------------------------
// Person
// ---------------------------------------------------------------------------
async function PersonDrawerView({ session, id, sp, base, mode }: { session: CrmSession; id: string; sp: RawSearchParams; base: string; mode?: string }) {
  const closeHref = drawerHref(base, sp);
  const { record: p, error } = await loadPersonRecord(session, id);
  if (error || !p) return <NotFoundDrawer closeHref={closeHref} kind="Person" error={error ?? undefined} />;
  const center = session.center;
  const tz = center.time_zone;
  const canEdit = canAccess(session, "householdsEdit") && !p.mergedIntoId;
  const self = drawerHref(base, sp, { person: id });
  const households = p.households.ok ? p.households.data : [];
  // The household this view is about: the family household (not their own), else the first.
  const home = households.find((h) => !h.isPrimary) ?? households[0] ?? null;

  if (mode === "move" && canEdit) {
    const rules = identifierRules(center.rules);
    return (
      <MovePersonDrawer
        personId={p.id}
        firstName={p.firstName}
        name={p.name}
        from={home ? { id: home.id, name: home.name, number: home.number } : null}
        labels={{ orgMemberLabel: rules.orgMemberLabel, orgHouseholdLabel: rules.orgHouseholdLabel }}
        timeZone={tz}
        currency={center.currency}
        closeHref={closeHref}
        backHref={self}
      />
    );
  }

  const primaryAnywhere = households.some((h) => h.isPrimary);
  const underLogin = p.age !== null && p.age < p.childLoginAge;
  const signIn = [p.email ? "email" : null, p.phone ? "mobile" : null].filter(Boolean).join(" and ");
  const account = p.account.ok ? p.account.data : null;

  const sections: ReactNode = (
    <>
      <DrawerSection title="Households">
        {!p.households.ok ? (
          <SectionError what="households" error={p.households.error} />
        ) : households.length === 0 ? (
          <KeyValueRow label="Not in a household" />
        ) : (
          households.map((h) => (
            <KeyValueRow
              key={h.id}
              label={`${h.isPrimary && h.id !== home?.id ? "Own household " : ""}${h.name}${h.number ? ` · ${h.number}` : ""} · ${h.isPrimary ? "primary" : relationshipLabel(h.role, p.gender).toLowerCase()}`}
              value="Open"
              href={drawerHref(base, sp, { hh: h.id })}
              tone="navy"
            />
          ))
        )}
      </DrawerSection>
      <DrawerSection title="Roles, teams and waivers">
        <KeyValueRow
          label="Roles"
          value={p.roles === null ? "Visible to role managers" : !p.roles.ok ? "Could not load" : p.roles.data.length ? p.roles.data.join(", ") : "None"}
          tone={p.roles && !p.roles.ok ? "bad" : "ink"}
        />
        <KeyValueRow
          label="Volunteer waiver"
          value={p.isMinor ? "Parent signs" : p.waiver === null ? "Needs a volunteers permission" : !p.waiver.ok ? "Could not load" : p.waiver.data}
          tone={p.waiver?.ok && p.waiver.data === "Signed" ? "ok" : p.waiver?.ok && p.waiver.data === "Not signed" ? "warn" : "ink"}
        />
        <KeyValueRow
          label="Background check"
          value={p.isMinor ? "Not applicable" : p.backgroundCheck === null ? "Needs a safety permission" : !p.backgroundCheck.ok ? "Could not load" : p.backgroundCheck.data}
        />
      </DrawerSection>
      <DrawerSection title="Account">
        {p.isMinor && underLogin ? (
          <KeyValueRow label="App account" value="Managed by parents" />
        ) : (
          <>
            <KeyValueRow
              label="App account"
              value={!p.account.ok ? "Could not load" : account?.linkedAt ? `Active · linked ${formatDate(account.linkedAt, tz)}` : "Not signed in yet"}
              tone={account?.linkedAt ? "ok" : "warn"}
            />
            <KeyValueRow label="Member card" value={p.memberNumber ? `Rotating QR · ${p.memberNumber}` : "No member number yet"} />
            <KeyValueRow label="Sign-in methods" value={account?.linkedAt && signIn ? `Code by ${signIn}` : "—"} />
          </>
        )}
      </DrawerSection>
      {p.duplicates && (!p.duplicates.ok || p.duplicates.data.length > 0) ? (
        <DrawerSection title="Possible duplicates">
          {!p.duplicates.ok ? (
            <SectionError what="possible duplicates" error={p.duplicates.error} />
          ) : (
            p.duplicates.data.map((d) => (
              <KeyValueRow key={d.candidateId} label={d.otherName} value="Compare" href={`/people/merge?person=${p.id}&other=${d.otherId}`} tone="navy" />
            ))
          )}
        </DrawerSection>
      ) : null}
      <ActivitySection activity={p.activity} tz={tz} />
    </>
  );

  const actions: ReactNode = (
    <>
      {canEdit && !p.isMinor && !primaryAnywhere && households.length > 0 ? (
        <ActionForm
          action={makePrimaryAction}
          submitLabel="Make primary of own household"
          pendingLabel="Creating…"
          variant="ghost"
          confirmKicker="New household"
          confirmMessage={`Make ${p.firstName} primary of their own household? A community-member household is created in the same zone. ${p.firstName} stays in the family household, and nothing moves.`}
        >
          <input type="hidden" name="id" value={p.id} />
          <input type="hidden" name="first_name" value={p.firstName} />
        </ActionForm>
      ) : null}
      {canEdit && home ? (
        <Link href={drawerHref(base, sp, { person: id, mode: "move" })} scroll={false} className={buttonClass("ghost")}>
          Move household
        </Link>
      ) : null}
      {canEdit && !p.isMinor ? (
        <button
          type="button"
          disabled
          className={buttonClass("off")}
          title="Printed sign-in codes are not set up yet: they need a step-up check and a one-time sign-in code on the server."
        >
          Printed sign-in code
        </button>
      ) : null}
      <Link href={`/people/${p.id}`} className={buttonClass("ghost")}>
        Full record
      </Link>
    </>
  );

  const subtitleParts = [
    home ? (home.isPrimary ? "Primary" : relationshipLabel(home.role, p.gender)) : null,
    home?.name ?? null,
    p.age !== null ? `age ${p.age}` : null,
  ].filter(Boolean);

  return (
    <PersonDrawer
      closeHref={closeHref}
      kicker={`Person · ${p.memberNumber ?? "no member number yet"}`}
      title={p.name}
      subtitle={p.mergedIntoId ? "This record was merged into another person" : subtitleParts.join(" · ")}
      editable={canEdit}
      sections={sections}
      actions={actions}
      data={{
        id: p.id,
        first: p.firstName,
        last: p.lastName,
        dob: p.dateOfBirth,
        gender: p.gender,
        profession: p.profession ?? "",
        employer: p.employer ?? "",
        phone: p.phone ?? "",
        email: p.email ?? "",
        language: p.language,
        photos: p.photoOptIn,
        newMember: p.newMemberContact,
        expertiseOptIn: p.expertiseOptIn,
        expertise: p.expertiseHeadline ?? "",
        isMinor: p.isMinor,
        household: home ? { id: home.id, role: home.role, isPrimary: home.isPrimary } : null,
        directoryText: home ? (home.directoryOptIn ? `Listed with the household` : "Not listed") : "—",
        mailText: home ? (home.physicalMail ? "Opted in (household)" : "Opted out (household)") : "—",
        appAccessText: underLogin ? `No own login yet (from age ${p.childLoginAge})` : "Own login allowed (age rule) · no RSVP, bolis or payments",
      }}
    />
  );
}

