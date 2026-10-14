"use client";

import Link from "next/link";
import { useState } from "react";

import { RELATIONSHIP_OPTIONS, relationshipLabel } from "@/lib/people";
import { avatarTone, initialsOf, toCheckContext, type AvatarTone, type FamilyCheck, type FamilyPerson } from "@/lib/people-v2/family-model";
import { PERSON_UNITS, ageCrossing, checkDraft, type EditUnit } from "@/lib/people-v2/inline-edit";

import { ConflictPanel, FieldRow, INPUT, NameEditor, ValueButton, editorKeys, leftEditor, useFocusBack, SaveError } from "./inline-ui";
import { useInlineEdit } from "./use-inline-edit";
import { PersonCustomGroup } from "../custom/custom-group";
import { PersonMenu, type MenuPerson } from "../slideover/person-menu";

// A person on the Family page. Adults are cards with their contact details; children are compact rows (D2: staff only, no contact
// fields, never offered to Niva). Every value is click-to-edit when the viewer may edit people (people.manage): without it a value
// is plain text, no pencil.

export type PersonCtx = {
  /** The household the page is about; null on the person's own page when they are in none. */
  householdId: string | null;
  canEdit: boolean;
  check: FamilyCheck;
  detailsHref: (personId: string) => string;
  /** Where "Move to another family" and "Merge with another person" go (the existing screens); the card says nothing when left out. */
  moveHref?: (personId: string) => string;
  mergeHref?: (personId: string) => string;
};

/** What the ⋯ menu needs to know about a person. */
export function menuPerson(p: FamilyPerson, ctx: PersonCtx): MenuPerson {
  return { id: p.id, name: p.name, firstName: p.firstName, dateOfBirth: p.values.date_of_birth || null, householdIds: ctx.householdId ? [ctx.householdId] : [], isChild: p.isChild, deceased: p.deceased };
}

export function menuHrefs(p: FamilyPerson, ctx: PersonCtx) {
  return { details: ctx.detailsHref(p.id), move: ctx.moveHref?.(p.id) ?? ctx.detailsHref(p.id), merge: ctx.mergeHref?.(p.id) ?? `/people/merge?person=${p.id}` };
}

const TONE: Record<AvatarTone, string> = {
  teal: "bg-[var(--v2-teal-tint)] text-[var(--v2-teal-ink)]",
  sun: "bg-[var(--v2-sun-tint)] text-[var(--v2-sun-ink)]",
  indigo: "bg-[var(--v2-indigo-tint)] text-[var(--v2-indigo-dark)]",
  green: "bg-[var(--v2-green-tint)] text-[var(--v2-green-ink)]",
  lavender: "bg-[var(--v2-lavender-tint)] text-[var(--v2-lavender)]",
  blue: "bg-[var(--v2-blue-tint)] text-[var(--v2-blue)]",
};

export function Avatar({ id, name, size = 44 }: { id: string; name: string; size?: number }) {
  return (
    <span
      aria-hidden="true"
      className={`grid shrink-0 place-items-center rounded-full text-[14px] font-bold ${TONE[avatarTone(id)]}`}
      style={{ width: size, height: size }}
    >
      {initialsOf(name)}
    </span>
  );
}

export function Chip({ tone, children }: { tone: "blue" | "green" | "grey" | "sun"; children: React.ReactNode }) {
  const c = {
    blue: "bg-[var(--v2-blue-tint)] text-[var(--v2-blue)]",
    green: "bg-[var(--v2-green-tint)] text-[var(--v2-green-ink)]",
    grey: "bg-white text-ink-2 ring-1 ring-inset ring-[var(--v2-line-input)]",
    sun: "bg-[var(--v2-sun-tint)] text-[var(--v2-sun-ink)]",
  }[tone];
  return <span className={`inline-flex min-h-6 items-center whitespace-nowrap rounded-full px-2.5 text-[12px] font-bold ${c}`}>{children}</span>;
}

export const GENDER_CHOICES = [
  { value: "", label: "Not recorded" },
  { value: "female", label: "Female" },
  { value: "male", label: "Male" },
  { value: "prefer_not_to_say", label: "Prefer not to say" },
];

function target(p: FamilyPerson, ctx: PersonCtx) {
  return { kind: "person", personId: p.id, householdId: ctx.householdId } as const;
}

/** One value of one person: its own edit state, drawn as a row. */
export function PersonRow(props: {
  person: FamilyPerson;
  ctx: PersonCtx;
  unit: EditUnit;
  fieldKey: string;
  label: string;
  kind?: "text" | "tel" | "email" | "select" | "date";
  placeholder: string;
  options?: { value: string; label: string }[];
  wide?: boolean;
}) {
  const { person: p, ctx, unit, fieldKey } = props;
  const edit = useInlineEdit({ unit, values: p.values, check: toCheckContext(ctx.check), owner: p.firstName, target: target(p, ctx) });
  const ageNote =
    fieldKey === "date_of_birth"
      ? (draft: string) => {
          const c = checkDraft(unit, { date_of_birth: draft }, toCheckContext(ctx.check));
          return c.ok
            ? ageCrossing({
                firstName: p.firstName,
                before: p.values.date_of_birth,
                after: c.stored.date_of_birth,
                today: ctx.check.today,
                majority: ctx.check.majority,
              })
            : null;
        }
      : undefined;
  return (
    <FieldRow
      label={props.label}
      fieldKey={fieldKey}
      unit={unit}
      edit={edit}
      editable={ctx.canEdit}
      kind={props.kind}
      placeholder={props.placeholder}
      options={props.options}
      ageNote={ageNote}
      wide={props.wide}
    />
  );
}

/** The person's name: a heading that edits in place (first and last name, with a reason). */
export function NameLine({ person: p, ctx, compact = false, large = false }: { person: FamilyPerson; ctx: PersonCtx; compact?: boolean; large?: boolean }) {
  const edit = useInlineEdit({ unit: PERSON_UNITS.name, values: p.values, check: toCheckContext(ctx.check), owner: p.firstName, target: target(p, ctx) });
  const open = edit.editing || edit.busy;
  const { button, restore } = useFocusBack(open);
  const shown = edit.shown;
  const unchanged =
    edit.state.committed.first_name === p.values.first_name && edit.state.committed.last_name === p.values.last_name && edit.state.phase === "idle";
  const display = unchanged ? p.name : `${p.values.preferred_name || (shown.first_name ?? "")} ${shown.last_name ?? ""}`.trim() || p.name;
  if (edit.state.phase === "conflict") return <ConflictPanel edit={edit} unit={PERSON_UNITS.name} />;
  if (edit.editing) return <NameEditor edit={edit} restore={restore} />;
  return (
    <h3 className={`m-0 font-semibold text-ink ${large ? "font-display text-[22px] leading-tight" : compact ? "text-[15.5px]" : "text-[17px]"}`}>
      <ValueButton
        text={display}
        placeholder="Add a name"
        editable={ctx.canEdit}
        label={`Name of ${p.name}`}
        onStart={edit.start}
        busy={edit.busy}
        buttonRef={button}
        className={large ? "font-display text-[22px] font-semibold" : compact ? "font-semibold" : "text-[17px] font-semibold"}
      />
    </h3>
  );
}

/** Spouse, Parent, Sibling… next to the age. The primary member is a chip: that is changed under More. */
export function Relationship({ person: p, ctx }: { person: FamilyPerson; ctx: PersonCtx }) {
  const edit = useInlineEdit({
    unit: PERSON_UNITS.relationship,
    values: p.values,
    check: toCheckContext(ctx.check),
    owner: p.firstName,
    target: target(p, ctx),
  });
  const { button, restore } = useFocusBack(edit.editing || edit.busy);
  const onKeys = editorKeys(edit, restore);
  if (p.isPrimary) return <Chip tone="blue">Primary</Chip>;
  const label = relationshipLabel(edit.shown.role ?? p.role, p.values.gender);
  if (edit.state.phase === "conflict") return <ConflictPanel edit={edit} unit={PERSON_UNITS.relationship} />;
  if (edit.editing) {
    return (
      <span onBlur={(e) => leftEditor(e) && edit.leave()} onKeyDown={onKeys} className="inline-flex flex-col">
        <select
          autoFocus
          aria-label={`Relationship of ${p.name}`}
          value={edit.state.draft.role ?? ""}
          onChange={(e) => edit.commit({ role: e.target.value })}
          className={`${INPUT} !min-h-9 !w-auto`}
        >
          {RELATIONSHIP_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {edit.state.problem ? <span className="text-[12.5px] font-semibold text-danger">{edit.state.problem}</span> : null}
        <SaveError edit={edit} />
      </span>
    );
  }
  return (
    <ValueButton
      text={label}
      placeholder="Relationship"
      editable={ctx.canEdit}
      label={`Relationship of ${p.name}`}
      onStart={edit.start}
      busy={edit.busy}
      buttonRef={button}
      className="text-[13.5px] text-ink-2 md:!min-h-6"
    />
  );
}

/** The name a person goes by, when it is not simply their first name. */
export function goesBy(p: Pick<FamilyPerson, "values">): string {
  const preferred = (p.values.preferred_name ?? "").trim();
  return preferred && preferred.toLowerCase() !== (p.values.first_name ?? "").trim().toLowerCase() ? preferred : "";
}

export function PersonCard({ person: p, ctx, orgMemberLabel }: { person: FamilyPerson; ctx: PersonCtx; orgMemberLabel: string }) {
  const [more, setMore] = useState(false);
  const ids = [p.memberNumber, ...p.orgIds].filter(Boolean).join(" · ");
  return (
    <article aria-label={p.name} data-testid="person-card" className="rounded-2xl border border-line bg-white p-[18px]">
      <div className="flex items-start gap-3">
        <Avatar id={p.id} name={p.name} />
        <div className="min-w-0 flex-1">
          <NameLine person={p} ctx={ctx} />
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Relationship person={p} ctx={ctx} />
            {p.age !== null ? <span className="text-[13px] text-muted">age {p.age}</span> : null}
            {p.onApp ? <Chip tone="green">On the app</Chip> : null}
            {p.deceased ? <Chip tone="grey">In memory</Chip> : null}
          </div>
          {goesBy(p) ? (
            <p data-testid="goes-by" dir="auto" className="m-0 mt-0.5 text-[13px] text-muted">
              Goes by {goesBy(p)}
            </p>
          ) : null}
        </div>
        <PersonMenu surface="card" person={menuPerson(p, ctx)} canEdit={ctx.canEdit} hasHousehold={ctx.householdId !== null} hrefs={menuHrefs(p, ctx)} today={ctx.check.today} />
      </div>

      <div className="mt-3">
        <PersonRow person={p} ctx={ctx} unit={PERSON_UNITS.mobile} fieldKey="phone_e164" label="Mobile" kind="tel" placeholder="Add a mobile number" />
        <PersonRow person={p} ctx={ctx} unit={PERSON_UNITS.email} fieldKey="email" label="Email" kind="email" placeholder="Add an email address" />
        <PersonRow
          person={p}
          ctx={ctx}
          unit={PERSON_UNITS.language}
          fieldKey="language"
          label="Language"
          kind="select"
          placeholder="Choose a language"
          options={ctx.check.languages}
        />
        {more ? (
          <div id={`more-${p.id}`}>
            <PersonRow person={p} ctx={ctx} unit={PERSON_UNITS.dob} fieldKey="date_of_birth" label="Birth date" kind="date" placeholder="Add a birth date" />
            <PersonRow
              person={p}
              ctx={ctx}
              unit={PERSON_UNITS.gender}
              fieldKey="gender"
              label="Gender"
              kind="select"
              placeholder="Add gender"
              options={GENDER_CHOICES}
            />
            <PersonRow person={p} ctx={ctx} unit={PERSON_UNITS.profession} fieldKey="profession" label="Profession" placeholder="Add a profession" />
          </div>
        ) : null}
      </div>

      <PersonCustomGroup personId={p.id} firstName={p.firstName} path={ctx.householdId ? `/households/${ctx.householdId}` : `/people/${p.id}`} />

      <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3">
        <Link
          href={ctx.detailsHref(p.id)}
          scroll={false}
          className="inline-flex min-h-10 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-4 text-[13.5px] font-bold text-ink no-underline hover:border-[var(--v2-blue)]"
        >
          Open details
        </Link>
        <button
          type="button"
          onClick={() => setMore((v) => !v)}
          aria-expanded={more}
          aria-controls={`more-${p.id}`}
          className="min-h-10 rounded-full px-2 text-[13px] font-semibold text-[var(--v2-blue)] hover:underline"
        >
          {more ? "Fewer details" : "Birth date, gender, profession"}
        </button>
        {ids ? (
          <span className="ml-auto text-[12.5px] text-muted" title={`${orgMemberLabel} and member number`}>
            {ids}
          </span>
        ) : null}
        {p.alsoPrimaryOf ? (
          <span className="basis-full text-[12.5px] text-muted">Also the primary member of household {p.alsoPrimaryOf.number ?? "another household"}</span>
        ) : null}
      </div>
    </article>
  );
}

/** A child, compact: name, relationship, age. No contact fields ("contact via parents"). Open it to see or correct the rest: the birth date is in the slide-over. */
export function ChildRow({ person: p, ctx }: { person: FamilyPerson; ctx: PersonCtx }) {
  return (
    <li data-testid="child-row" className="px-4 py-3">
      <div className="flex items-center gap-3">
        <Avatar id={p.id} name={p.name} size={40} />
        <div className="min-w-0 flex-1">
          <p className="m-0 text-[15.5px] font-semibold text-ink" dir="auto">
            {p.name}
          </p>
          <p className="m-0 text-[13px] text-muted">
            {[relationshipLabel(p.role, p.values.gender), p.age !== null ? `age ${p.age}` : "age not recorded", "contact via parents"].join(" · ")}
            {p.deceased ? " · in memory" : ""}
          </p>
        </div>
        <Link
          href={ctx.detailsHref(p.id)}
          scroll={false}
          aria-label={`Open details for ${p.name}`}
          className="inline-flex min-h-10 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-4 text-[13px] font-bold text-ink-2 no-underline hover:border-[var(--v2-blue)]"
        >
          Open
        </Link>
        <PersonMenu surface="card" person={menuPerson(p, ctx)} canEdit={ctx.canEdit} hasHousehold={ctx.householdId !== null} hrefs={menuHrefs(p, ctx)} today={ctx.check.today} />
      </div>
    </li>
  );
}
