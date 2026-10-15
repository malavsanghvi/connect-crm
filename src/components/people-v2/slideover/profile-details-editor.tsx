"use client";

import { useId, type ReactNode } from "react";

import {
  GROUP_LABEL,
  GROUP_PLACEHOLDER,
  PRIVATE_NOTE,
  describeGroup,
  dietaryChips,
  profileConflictLine,
  profileGroups,
  profileUnits,
  profileValues,
  toggleChoice,
  type CheckInput,
  type DietaryOption,
  type ProfileEditFacts,
  type ProfileGroup,
} from "@/lib/people-v2/profile-details";
import type { CheckContext, EditUnit, Values } from "@/lib/people-v2/inline-edit";
import { profileDetailLines, type PersonDetailModel, type ProfileDetails } from "@/lib/people-v2/slideover";

import { INPUT, Problem, SaveError, ValueButton, editorKeys, leftEditor, useFocusBack, EditActions } from "../family/inline-ui";
import type { PersonCtx } from "../family/person-card";
import { useInlineEdit, type InlineEdit } from "../family/use-inline-edit";

import { Lines, PartNote } from "./section";

// The three things a member gave about themselves in the app (the wedding anniversary, dietary needs, the emergency contact) as the
// slide-over's Profile section shows them. With people.manage each is click-to-edit like every other value on the page: the same
// state machine (Enter saves, Esc cancels, a failed save keeps what was typed and says why with a retry, a conflict offers Use theirs
// or Keep mine, an Undo for 30 seconds), checked first by the same words the database uses. The save is the staff function of
// migration 0723 (src/app/(app)/households/[id]/profile-details-actions.ts). Without people.manage the values are plain text.
//
// The dietary needs and the emergency contact are several controls saved together, so they save on Enter or on the Save button, never
// on leaving a control (a click on a choice must not save half of them). A child has no anniversary.

/** These units are not columns of the person, so the column checks have nothing to say; the units bring their own. */
const NO_COLUMN_CHECKS: CheckContext = { today: "" };

const BTN =
  "inline-flex min-h-11 items-center justify-center rounded-full border px-5 text-[13.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)] md:min-h-10";

const ROW = "grid grid-cols-[6.75rem_minmax(0,1fr)] items-start gap-x-3 py-0.5 sm:grid-cols-[7.5rem_minmax(0,1fr)]";

/** Everything under "Given by the member in the app": editable rows for people.manage, plain lines for everyone else. */
export function ProfileDetailsEditor({ detail, ctx }: { detail: PersonDetailModel; ctx: PersonCtx }) {
  const part = detail.profileDetails;
  if (part.state === "ok" && part.data.edit && ctx.canEdit) return <EditableDetails detail={detail} ctx={ctx} data={part.data} facts={part.data.edit} />;
  return <ReadOnlyDetails detail={detail} />;
}

function ReadOnlyDetails({ detail }: { detail: PersonDetailModel }) {
  const p = detail.person;
  const lines = profileDetailLines({ isChild: p.isChild, firstName: p.firstName, details: detail.profileDetails });
  return (
    <>
      <Lines lines={lines} />
      {detail.profileDetails.state === "error" ? <PartNote part={detail.profileDetails} what="what this member gave in the app" /> : null}
      <p className="m-0 mt-1 text-[12px] text-muted">{PRIVATE_NOTE} Members change them in the app.</p>
    </>
  );
}

function EditableDetails({ detail, ctx, data, facts }: { detail: PersonDetailModel; ctx: PersonCtx; data: ProfileDetails; facts: ProfileEditFacts }) {
  const p = detail.person;
  const values = profileValues({ anniversary: data.anniversary, emergency: data.emergency, edit: facts });
  const input: CheckInput = {
    today: ctx.check.today,
    birthDate: p.values.date_of_birth || null,
    isChild: p.isChild,
    options: facts.options,
    currentKeys: facts.dietaryKeys,
  };
  const units = profileUnits(input);
  return (
    <>
      {profileGroups(p.isChild).map((g) => (
        <GroupRow key={g} group={g} unit={units[g]} values={values} owner={p.firstName} personId={p.id} options={facts.options} currentKeys={facts.dietaryKeys} note={g === "dietary" ? data.labelsNote : null} />
      ))}
      <p className="m-0 mt-1 text-[12px] text-muted">{PRIVATE_NOTE} Members can also change them in the app.</p>
    </>
  );
}

function GroupRow({
  group,
  unit,
  values,
  owner,
  personId,
  options,
  currentKeys,
  note,
}: {
  group: ProfileGroup;
  unit: EditUnit;
  values: Values;
  owner: string;
  personId: string;
  options: DietaryOption[];
  currentKeys: string[];
  /** Said under the row (the dietary list could not be read in full). */
  note: string | null;
}) {
  const label = GROUP_LABEL[group];
  const edit = useInlineEdit({ unit, values, check: NO_COLUMN_CHECKS, owner, target: { kind: "profile", personId } });
  const open = edit.editing || edit.busy;
  const { button, restore } = useFocusBack(open);
  const onKeys = editorKeys(edit, restore);
  const labelId = useId();

  let body: ReactNode;
  if (edit.state.phase === "conflict") {
    body = <Conflict edit={edit} group={group} options={options} />;
  } else if (edit.editing) {
    body = (
      <div onKeyDown={onKeys} {...(group === "anniversary" ? { onBlur: (e: React.FocusEvent<HTMLElement>) => leftEditor(e) && edit.leave() } : {})}>
        {group === "anniversary" ? <AnniversaryInput edit={edit} label={label} /> : null}
        {group === "dietary" ? <DietaryEditor edit={edit} labelId={labelId} options={options} currentKeys={currentKeys} /> : null}
        {group === "emergency" ? <EmergencyEditor edit={edit} /> : null}
        {edit.state.problem && group !== "anniversary" ? <Problem>{edit.state.problem}</Problem> : null}
        <SaveError edit={edit} />
        {group === "anniversary" ? <EditActions edit={edit} /> : <SaveCancel edit={edit} />}
      </div>
    );
  } else {
    body = (
      <ValueButton
        text={describeGroup(group, edit.shown, options)}
        placeholder={GROUP_PLACEHOLDER[group]}
        editable
        label={label}
        onStart={edit.start}
        busy={edit.busy}
        buttonRef={button}
      />
    );
  }
  return (
    <div data-testid="profile-row" data-group={group}>
      <div className={ROW}>
        <span id={labelId} className="pt-[11px] text-[13px] text-muted md:pt-[7px]">
          {label}
        </span>
        <div className="min-w-0">{body}</div>
      </div>
      {note && !open ? <p className="m-0 mb-1 ml-0 text-[12px] text-muted sm:ml-[8.25rem]">{note}</p> : null}
    </div>
  );
}

function SaveCancel({ edit }: { edit: InlineEdit }) {
  return (
    <div className="mt-2.5 flex flex-wrap items-center gap-2">
      <button type="button" onClick={edit.submit} className={`${BTN} border-transparent bg-navy text-white hover:bg-navy-hover`}>
        Save
      </button>
      <button type="button" onClick={edit.cancel} className={`${BTN} border-[var(--v2-line-input)] bg-white text-ink`}>
        Cancel
      </button>
      <span className="hidden text-[12px] text-muted md:inline">Enter saves · Esc cancels</span>
    </div>
  );
}

function AnniversaryInput({ edit, label }: { edit: InlineEdit; label: string }) {
  const id = useId();
  const problem = edit.state.problem;
  return (
    <>
      <input
        id={id}
        autoFocus
        type="text"
        inputMode="numeric"
        dir="auto"
        autoComplete="off"
        spellCheck={false}
        value={edit.state.draft.anniversary ?? ""}
        onChange={(e) => edit.change("anniversary", e.target.value)}
        placeholder="MM/DD/YYYY"
        aria-label={label}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        className={INPUT}
      />
      {problem ? <Problem id={`${id}-problem`}>{problem}</Problem> : null}
    </>
  );
}

function DietaryEditor({ edit, labelId, options, currentKeys }: { edit: InlineEdit; labelId: string; options: DietaryOption[]; currentKeys: string[] }) {
  const id = useId();
  const draft = edit.state.draft;
  const csv = draft.dietary ?? "";
  const chips = dietaryChips(options, currentKeys, csv);
  const otherOn = chips.some((c) => c.key === "other" && c.selected);
  const toggle = (key: string) => {
    const next = toggleChoice({ dietary: csv, dietary_other: draft.dietary_other ?? "" }, key);
    edit.change("dietary", next.dietary);
    if (next.dietary_other !== (draft.dietary_other ?? "")) edit.change("dietary_other", next.dietary_other);
  };
  return (
    <>
      {chips.length === 0 ? <p className="m-0 py-1 text-[13px] text-muted">The community has no dietary choices to pick from yet. An administrator adds them in Setup › Lists.</p> : null}
      <div role="group" aria-labelledby={labelId} className="flex flex-wrap gap-2">
        {chips.map((c, i) => (
          <button
            key={c.key}
            type="button"
            autoFocus={i === 0}
            aria-pressed={c.selected}
            onClick={() => toggle(c.key)}
            dir="auto"
            className={`min-h-11 rounded-full border px-3.5 text-[13.5px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)] md:min-h-9 ${
              c.selected
                ? "border-[var(--v2-blue)] bg-[var(--v2-blue-tint)] font-bold text-[var(--v2-blue)]"
                : "border-[var(--v2-line-input)] bg-white text-ink-2 hover:border-[var(--v2-blue)]"
            }`}
          >
            {c.label}
            {c.retired ? " (no longer offered)" : ""}
          </button>
        ))}
      </div>
      {otherOn ? (
        <div className="mt-2">
          <label htmlFor={`${id}-other`} className="block text-[12px] font-bold text-muted">
            Their own words under Other
          </label>
          <input
            id={`${id}-other`}
            dir="auto"
            autoComplete="off"
            value={draft.dietary_other ?? ""}
            onChange={(e) => edit.change("dietary_other", e.target.value)}
            placeholder="For example: no shellfish"
            aria-invalid={edit.state.problem ? true : undefined}
            className={INPUT}
          />
        </div>
      ) : null}
    </>
  );
}

function EmergencyEditor({ edit }: { edit: InlineEdit }) {
  const id = useId();
  const d = edit.state.draft;
  const invalid = edit.state.problem ? true : undefined;
  const field = (key: string, suffix: string, labelText: string, props: { autoFocus?: boolean; placeholder?: string; type?: string; inputMode?: "tel" | "text"; autoComplete?: string }) => (
    <div>
      <label htmlFor={`${id}-${suffix}`} className="block text-[12px] font-bold text-muted">
        {labelText}
      </label>
      <input
        id={`${id}-${suffix}`}
        dir="auto"
        spellCheck={false}
        autoComplete={props.autoComplete ?? "off"}
        type={props.type ?? "text"}
        inputMode={props.inputMode}
        autoFocus={props.autoFocus}
        placeholder={props.placeholder}
        value={d[key] ?? ""}
        onChange={(e) => edit.change(key, e.target.value)}
        aria-invalid={invalid}
        className={INPUT}
      />
    </div>
  );
  return (
    <div className="grid gap-2">
      {field("emergency_contact_name", "name", "Name", { autoFocus: true })}
      {field("emergency_contact_relationship", "relationship", "How they are related", { placeholder: "For example: sister" })}
      {field("emergency_contact_phone", "phone", "Mobile number", { type: "tel", inputMode: "tel", placeholder: "(713) 555-0142 or +44 7700 900123" })}
    </div>
  );
}

/** Someone else changed it first: say who and when, show their value, and let the person choose. */
function Conflict({ edit, group, options }: { edit: InlineEdit; group: ProfileGroup; options: DietaryOption[] }) {
  const c = edit.state.conflict;
  if (edit.state.phase !== "conflict" || !c) return null;
  const theirs = describeGroup(group, { ...edit.state.committed, ...c.theirs }, options);
  const mine = edit.state.pending ? describeGroup(group, { ...edit.state.committed, ...edit.state.pending.fields }, options) : "";
  return (
    <div role="alert" data-testid="conflict" className="rounded-field border border-warning-200 bg-warning-50 px-3 py-2.5 text-[13.5px] text-warning-ink">
      <p className="m-0" dir="auto">
        {profileConflictLine({ who: c.who, at: c.at, theirs }, new Date())}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={edit.useTheirs} className={`${BTN} border-[var(--v2-line-input)] bg-white text-ink hover:border-[var(--v2-blue)]`}>
          Use theirs
        </button>
        <button type="button" onClick={edit.keepMine} className={`${BTN} border-transparent bg-navy text-white hover:bg-navy-hover`}>
          Keep mine · {mine || "empty"}
        </button>
      </div>
    </div>
  );
}
