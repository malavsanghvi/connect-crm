"use client";

import { useId } from "react";

import { BEST_CALL_TIMES, DAILY_MINUTES } from "@/lib/people";
import { toCheckContext } from "@/lib/people-v2/family-model";
import { PERSON_UNITS, type EditUnit } from "@/lib/people-v2/inline-edit";
import {
  NO_ACCESS_TEXT,
  accountLines,
  allNoAccess,
  reachedByLine,
  rolesLines,
  type PersonDetailModel,
  type PreferenceFacts,
} from "@/lib/people-v2/slideover";

import { ConflictPanel, FieldRow, SaveError } from "../family/inline-ui";
import { InterestsRow, ListRow } from "../family/list-row";
import { GENDER_CHOICES, PersonRow, Relationship, type PersonCtx } from "../family/person-card";
import { useInlineEdit } from "../family/use-inline-edit";

import { ProfileDetailsEditor } from "./profile-details-editor";
import { Lines, PartNote } from "./section";

// The slide-over's Profile, Account, Roles and Privacy sections. Every editable value is the Family page's own click-to-edit
// (PersonRow, useInlineEdit): the same commands, `expect`, reason, Undo and conflict panel. Without people.manage a value is plain
// text. A child has no mobile, email, profession or employer ("contact via parents"), and no anniversary.

export function ProfileSection({ detail, ctx }: { detail: PersonDetailModel; ctx: PersonCtx }) {
  const p = detail.person;
  const child = p.isChild;
  const row = (unit: EditUnit, fieldKey: string, label: string, placeholder: string, kind?: "text" | "tel" | "email" | "select" | "date", options?: { value: string; label: string }[]) => (
    <PersonRow person={p} ctx={ctx} unit={unit} fieldKey={fieldKey} label={label} placeholder={placeholder} kind={kind} options={options} wide />
  );
  return (
    <div>
      {row(PERSON_UNITS.preferredName, "preferred_name", "Goes by", "Add a name they go by")}
      {row(PERSON_UNITS.dob, "date_of_birth", "Birth date", "Add a birth date", "date")}
      {row(PERSON_UNITS.gender, "gender", "Gender", "Add gender", "select", GENDER_CHOICES)}
      {child ? null : row(PERSON_UNITS.profession, "profession", "Profession", "Add a profession")}
      {child ? null : row(PERSON_UNITS.employer, "employer", "Employer", "Add an employer")}
      {row(PERSON_UNITS.language, "language", "Language", "Choose a language", "select", ctx.check.languages)}
      {child ? null : row(PERSON_UNITS.mobile, "phone_e164", "Mobile", "Add a mobile number", "tel")}
      {child ? null : row(PERSON_UNITS.email, "email", "Email", "Add an email address", "email")}
      {child ? (
        <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-3 py-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
          <span className="pt-0.5 text-[13px] text-muted">Contact</span>
          <span className="text-[14.5px] text-ink">Via parents</span>
        </div>
      ) : null}
      {detail.household ? <RelationshipRow detail={detail} ctx={ctx} /> : null}
      {detail.preferences && !child ? <PreferencesBlock detail={detail} prefs={detail.preferences} ctx={ctx} /> : null}
      <div className="mt-3 border-t border-line pt-3">
        <p className="m-0 mb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted">Given by the member in the app</p>
        <ProfileDetailsEditor detail={detail} ctx={ctx} />
      </div>
    </div>
  );
}

const CALL_TIME_CHOICES = [{ value: "", label: "Not recorded" }, ...BEST_CALL_TIMES.map((o) => ({ value: o.value, label: o.label }))];
const DAILY_GOAL_CHOICES = [{ value: "", label: "Not recorded" }, ...DAILY_MINUTES.map((m) => ({ value: String(m), label: `${m} minutes a day` }))];

function usePreferenceEdit(detail: PersonDetailModel, prefs: PreferenceFacts, ctx: PersonCtx, unit: EditUnit) {
  return useInlineEdit({
    unit,
    values: prefs.values,
    check: toCheckContext(ctx.check),
    owner: detail.person.firstName,
    target: { kind: "person", personId: detail.person.id, householdId: ctx.householdId },
  });
}

function PreferenceList({
  detail,
  prefs,
  ctx,
  unit,
  fieldKey,
  label,
  placeholder,
}: {
  detail: PersonDetailModel;
  prefs: PreferenceFacts;
  ctx: PersonCtx;
  unit: EditUnit;
  fieldKey: string;
  label: string;
  placeholder: string;
}) {
  const edit = usePreferenceEdit(detail, prefs, ctx, unit);
  return <ListRow label={label} fieldKey={fieldKey} unit={unit} edit={edit} editable={ctx.canEdit} placeholder={placeholder} wide />;
}

function PreferenceInterests({ detail, prefs, ctx }: { detail: PersonDetailModel; prefs: PreferenceFacts; ctx: PersonCtx }) {
  const edit = usePreferenceEdit(detail, prefs, ctx, PERSON_UNITS.interests);
  return <InterestsRow label="Interests" fieldKey="interests" unit={PERSON_UNITS.interests} edit={edit} editable={ctx.canEdit} placeholder="Add interests" wide />;
}

function PreferenceChoice({
  detail,
  prefs,
  ctx,
  unit,
  fieldKey,
  label,
  placeholder,
  options,
}: {
  detail: PersonDetailModel;
  prefs: PreferenceFacts;
  ctx: PersonCtx;
  unit: EditUnit;
  fieldKey: string;
  label: string;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  const edit = usePreferenceEdit(detail, prefs, ctx, unit);
  return <FieldRow label={label} fieldKey={fieldKey} unit={unit} edit={edit} editable={ctx.canEdit} kind="select" placeholder={placeholder} options={options} wide />;
}

const NOTE = "m-0 mb-1 pl-[7.5rem] text-[12px] text-muted sm:pl-[8.25rem]";

/**
 * What else is on an adult's record: interests and expertise areas (lists), when to call, how the member likes to be reached (read
 * only: the member chooses it, with their consent, in the app) and the daily learning goal when the community uses learning. Never
 * drawn for a child (D2).
 */
function PreferencesBlock({ detail, prefs, ctx }: { detail: PersonDetailModel; prefs: PreferenceFacts; ctx: PersonCtx }) {
  const callsOk = prefs.channels.includes("phone_call");
  const showGoal = prefs.learningOn || prefs.values.gyan_daily_minutes !== "";
  return (
    <div className="mt-3 border-t border-line pt-3" data-testid="profile-preferences">
      <p className="m-0 mb-1 text-[12px] font-bold uppercase tracking-[0.04em] text-muted">Interests and contact preferences</p>
      <PreferenceInterests detail={detail} prefs={prefs} ctx={ctx} />
      <PreferenceList
        detail={detail}
        prefs={prefs}
        ctx={ctx}
        unit={PERSON_UNITS.expertiseAreas}
        fieldKey="expertise_tags"
        label="Expertise areas"
        placeholder="Add expertise areas"
      />
      <p className={NOTE}>Shown in the directory only while their expertise listing is on.</p>
      <PreferenceChoice detail={detail} prefs={prefs} ctx={ctx} unit={PERSON_UNITS.callTime} fieldKey="best_call_time" label="Best call time" placeholder="Add a call time" options={CALL_TIME_CHOICES} />
      {!callsOk && prefs.values.best_call_time !== "" ? (
        <p className={NOTE}>They have not chosen phone calls in the app, so the app may clear this when they next save their profile.</p>
      ) : null}
      <Lines lines={[reachedByLine(prefs.channels)]} />
      <p className={NOTE}>The member chooses how they are reached in the app, and their opt-ins with it. It is not changed here.</p>
      {showGoal ? (
        <PreferenceChoice detail={detail} prefs={prefs} ctx={ctx} unit={PERSON_UNITS.dailyGoal} fieldKey="gyan_daily_minutes" label="Daily goal" placeholder="Set a daily goal" options={DAILY_GOAL_CHOICES} />
      ) : null}
    </div>
  );
}

function RelationshipRow({ detail, ctx }: { detail: PersonDetailModel; ctx: PersonCtx }) {
  const p = detail.person;
  return (
    <div className="grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-3 py-1.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <span className="pt-[11px] text-[13px] text-muted md:pt-[7px]">Relationship</span>
      <div className="min-w-0 pt-1 md:pt-0.5">
        {p.isPrimary ? <span className="inline-flex min-h-8 items-center text-[14.5px] text-ink">Primary member</span> : <Relationship person={p} ctx={ctx} />}
        {p.alsoPrimaryOf ? (
          <p className="m-0 text-[12.5px] text-muted">Also the primary member of household {p.alsoPrimaryOf.number ?? "another household"}</p>
        ) : null}
      </div>
    </div>
  );
}

export function AccountSection({ detail }: { detail: PersonDetailModel }) {
  const p = detail.person;
  const lines = accountLines({ isChild: p.isChild, age: p.age, account: detail.account, memberNumber: p.memberNumber, timeZone: detail.timeZone });
  return (
    <div>
      <Lines lines={lines} />
      {detail.account.state === "error" ? <PartNote part={detail.account} what="the app account" /> : null}
    </div>
  );
}

export function RolesSection({ detail }: { detail: PersonDetailModel }) {
  const lines = rolesLines({ isChild: detail.person.isChild, facts: detail.roles });
  if (allNoAccess(lines)) return <p className="m-0 py-1 text-[14px] text-muted">{NO_ACCESS_TEXT}</p>;
  return (
    <div>
      <Lines lines={lines} />
      {detail.ownerLinks.roles ? (
        <p className="m-0 mt-2 text-[13px]">
          <a href={detail.ownerLinks.roles} className="font-bold text-[var(--v2-blue)] hover:underline">
            Manage roles and teams
          </a>
        </p>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Privacy and directory
// ---------------------------------------------------------------------------
function PrivacySwitch({
  detail,
  ctx,
  unit,
  fieldKey,
  label,
  hint,
}: {
  detail: PersonDetailModel;
  ctx: PersonCtx;
  unit: EditUnit;
  fieldKey: string;
  label: string;
  hint: string;
}) {
  const edit = useInlineEdit({
    unit,
    values: detail.privacy.values,
    check: toCheckContext(ctx.check),
    owner: detail.person.firstName,
    target: { kind: "person", personId: detail.person.id, householdId: ctx.householdId },
  });
  const id = useId();
  const on = (edit.state.phase === "error" ? edit.state.committed : edit.shown)[fieldKey] === "on";
  if (edit.state.phase === "conflict") {
    return (
      <div className="py-2">
        <p className="m-0 mb-1.5 text-[14.5px] text-ink">{label}</p>
        <ConflictPanel edit={edit} unit={unit} />
      </div>
    );
  }
  return (
    <div className="border-t border-line first:border-t-0">
      <div className="flex min-h-12 items-center justify-between gap-3 py-1.5">
        <span id={id} className="text-[14.5px] text-ink">
          {label}
          <span className="block text-[12px] text-muted">{hint}</span>
        </span>
        {ctx.canEdit ? (
          <button
            type="button"
            role="switch"
            aria-checked={on}
            aria-labelledby={id}
            aria-busy={edit.busy || undefined}
            disabled={edit.busy}
            onClick={() => edit.commit({ [fieldKey]: on ? "off" : "on" })}
            className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)] ${on ? "bg-navy" : "bg-[#b8c4d6]"}`}
          >
            <span aria-hidden="true" className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
            <span className="sr-only">{on ? "On" : "Off"}</span>
          </button>
        ) : (
          <span className="text-[14.5px] text-ink">{on ? "Yes" : "No"}</span>
        )}
      </div>
      <SaveError edit={edit} />
    </div>
  );
}

function ExpertiseHeadline({ detail, ctx }: { detail: PersonDetailModel; ctx: PersonCtx }) {
  const edit = useInlineEdit({
    unit: PERSON_UNITS.expertiseHeadline,
    values: detail.privacy.values,
    check: toCheckContext(ctx.check),
    owner: detail.person.firstName,
    target: { kind: "person", personId: detail.person.id, householdId: ctx.householdId },
  });
  return (
    <FieldRow
      label="Expertise"
      fieldKey="expertise_headline"
      unit={PERSON_UNITS.expertiseHeadline}
      edit={edit}
      editable={ctx.canEdit}
      placeholder="Add a headline"
      wide
    />
  );
}

/**
 * The person's own privacy choices (adults: switches that save at once, and an expertise headline) and what the household decides
 * (the directory and physical mail: changed on the family page). A child's photo consent is shown, not edited here: a parent gives it.
 */
export function PrivacySection({ detail, ctx }: { detail: PersonDetailModel; ctx: PersonCtx }) {
  const p = detail.person;
  const pr = detail.privacy;
  const household = [
    ...(pr.directory ? [{ label: "Directory", value: pr.directory }] : []),
    ...(pr.mail ? [{ label: "Physical mail", value: pr.mail }] : []),
  ];
  if (p.isChild) {
    return (
      <div>
        <Lines
          lines={[
            { label: "Photo consent", value: pr.values.photo_opt_in === "on" ? "Opted in" : "Opted out" },
            ...household,
          ]}
        />
        <p className="m-0 mt-1 text-[12px] text-muted">A parent gives or withdraws consent for a child.</p>
      </div>
    );
  }
  return (
    <div>
      <PrivacySwitch detail={detail} ctx={ctx} unit={PERSON_UNITS.photo} fieldKey="photo_opt_in" label="Photo consent" hint="May appear in photos the community shares." />
      <PrivacySwitch
        detail={detail}
        ctx={ctx}
        unit={PERSON_UNITS.newMember}
        fieldKey="new_member_contact_opt_in"
        label="Open to new members"
        hint="New members may be put in touch with them."
      />
      <PrivacySwitch
        detail={detail}
        ctx={ctx}
        unit={PERSON_UNITS.expertise}
        fieldKey="expertise_opt_in"
        label="Expertise listing"
        hint="Listed in the directory with their headline."
      />
      <ExpertiseHeadline detail={detail} ctx={ctx} />
      {household.length > 0 ? (
        <div className="mt-2 border-t border-line pt-2">
          <Lines lines={household} />
          <p className="m-0 mt-1 text-[12px] text-muted">The directory and physical mail are the family&apos;s choices, changed on the family page.</p>
        </div>
      ) : null}
    </div>
  );
}
