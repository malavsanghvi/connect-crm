"use client";

import Link from "next/link";
import { useId, type ReactNode } from "react";

import { addressLines, toCheckContext, type FamilyModel } from "@/lib/people-v2/family-model";
import { HOUSEHOLD_UNITS } from "@/lib/people-v2/inline-edit";

import { ConflictPanel, EditActions, INPUT, Pencil, Problem, SaveError, editorKeys, leftEditor, useFocusBack } from "./inline-ui";
import { useInlineEdit } from "./use-inline-edit";

// The household's own things on the Family page, edited in place: its name (the heading), the address block, the two preferences
// (switches that save at once) and the note (shown, never edited here). The same rules as a person's fields: Enter saves, leaving saves, Esc cancels, a
// failed save keeps what was typed and says why, and every save has an Undo for 30 seconds.

type Common = { model: FamilyModel; canEdit: boolean };

const owner = (m: FamilyModel) => m.name;
const target = (m: FamilyModel) => ({ kind: "household", householdId: m.id }) as const;

/** The household's name as the page heading: click it to rename the household. */
export function HouseholdTitle({ model, canEdit }: Common) {
  const edit = useInlineEdit({
    unit: HOUSEHOLD_UNITS.name,
    values: model.values,
    check: toCheckContext(model.check),
    owner: owner(model),
    target: target(model),
  });
  const open = edit.editing || edit.busy;
  const { button, restore } = useFocusBack(open);
  const onKeys = editorKeys(edit, restore);
  const id = useId();
  const heading = "m-0 font-display text-[28px] font-semibold leading-tight text-ink sm:text-[34px]";
  if (edit.state.phase === "conflict") {
    return (
      <div className="max-w-xl">
        <ConflictPanel edit={edit} unit={HOUSEHOLD_UNITS.name} />
      </div>
    );
  }
  if (edit.editing) {
    return (
      <div className="max-w-xl" onBlur={(e) => leftEditor(e) && edit.leave()} onKeyDown={onKeys}>
        <input
          id={id}
          autoFocus
          dir="auto"
          aria-label="Household name"
          value={edit.state.draft.display_name ?? ""}
          onChange={(e) => edit.change("display_name", e.target.value)}
          aria-invalid={edit.state.problem ? true : undefined}
          className={`${INPUT} !min-h-12 font-display !text-[26px] font-semibold`}
        />
        {edit.state.problem ? <Problem>{edit.state.problem}</Problem> : null}
        <SaveError edit={edit} />
        <EditActions edit={edit} />
      </div>
    );
  }
  const name = edit.shown.display_name || model.name;
  return (
    <h1 className={heading}>
      {canEdit ? (
        <button
          ref={button}
          type="button"
          onClick={edit.start}
          aria-label={`Rename the household: ${name}`}
          className="group -mx-2 inline-flex max-w-full items-center gap-2 rounded-xl px-2 text-left font-display hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
        >
          <span dir="auto" className="break-words">
            {name}
          </span>
          {edit.busy ? (
            <span aria-hidden="true" className="size-2.5 animate-pulse rounded-full bg-[var(--v2-sun-from)]" />
          ) : (
            <Pencil className="size-4 shrink-0 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
          )}
        </button>
      ) : (
        <span dir="auto">{name}</span>
      )}
    </h1>
  );
}

function CardBox({ title, aside, children, id }: { title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section aria-labelledby={id} className="rounded-2xl border border-line bg-white p-[18px]">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 id={id} className="m-0 font-display text-[18px] font-semibold text-ink">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

const LABEL = "block text-[12px] font-bold text-muted";

/** The address as one block: click it, change any line, Enter or leave to save. The zone is chosen from the community's own. */
export function AddressCard({ model, canEdit }: Common) {
  const edit = useInlineEdit({
    unit: HOUSEHOLD_UNITS.address,
    values: model.values,
    check: toCheckContext(model.check),
    owner: owner(model),
    target: target(model),
  });
  const open = edit.editing || edit.busy;
  const { button, restore } = useFocusBack(open);
  const onKeys = editorKeys(edit, restore);
  const id = useId();
  const lines = addressLines(edit.shown);
  const zone = model.zones.find((z) => z.id === edit.shown.zone_id)?.name ?? (edit.shown.zone_id === model.values.zone_id ? model.zoneName : null);
  const d = edit.state.draft;
  const input = (key: string, label: string, extra: { autoFocus?: boolean; className?: string; auto?: string } = {}) => (
    <div className={extra.className}>
      <label htmlFor={`${id}-${key}`} className={LABEL}>
        {label}
      </label>
      <input
        id={`${id}-${key}`}
        autoFocus={extra.autoFocus}
        dir="auto"
        autoComplete={extra.auto ?? "off"}
        value={d[key] ?? ""}
        onChange={(e) => edit.change(key, e.target.value)}
        aria-invalid={edit.state.problem ? true : undefined}
        className={INPUT}
      />
    </div>
  );

  let body: ReactNode;
  if (edit.state.phase === "conflict") body = <ConflictPanel edit={edit} unit={HOUSEHOLD_UNITS.address} />;
  else if (edit.editing) {
    body = (
      <div onBlur={(e) => leftEditor(e) && edit.leave()} onKeyDown={onKeys} className="flex flex-col gap-2.5">
        {input("address_line1", "Street address", { autoFocus: true, auto: "address-line1" })}
        {input("address_line2", "Apartment, suite (optional)", { auto: "address-line2" })}
        <div className="grid grid-cols-6 gap-2">
          {input("city", "City", { className: "col-span-6 sm:col-span-3", auto: "address-level2" })}
          {input("state_region", "State", { className: "col-span-3 sm:col-span-1", auto: "address-level1" })}
          {input("postal_code", "ZIP code", { className: "col-span-3 sm:col-span-2", auto: "postal-code" })}
        </div>
        <div>
          <label htmlFor={`${id}-zone`} className={LABEL}>
            Zone
          </label>
          <select id={`${id}-zone`} value={d.zone_id ?? ""} onChange={(e) => edit.change("zone_id", e.target.value)} className={INPUT}>
            <option value="">No zone</option>
            {model.zones.map((z) => (
              <option key={z.id} value={z.id}>
                {z.name}
              </option>
            ))}
          </select>
        </div>
        {edit.state.problem ? <Problem>{edit.state.problem}</Problem> : null}
        <SaveError edit={edit} />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={edit.submit}
            className="inline-flex min-h-11 items-center rounded-full bg-navy px-5 text-[14px] font-bold text-white hover:bg-navy-hover"
          >
            Save address
          </button>
          <button
            type="button"
            onClick={edit.cancel}
            className="inline-flex min-h-11 items-center rounded-full border border-[var(--v2-line-input)] bg-white px-5 text-[14px] font-bold text-ink"
          >
            Cancel
          </button>
          <span className="hidden text-[12px] text-muted md:inline">Enter saves · Esc cancels</span>
        </div>
      </div>
    );
  } else {
    const text = lines.length ? (
      <span className="flex flex-col text-left">
        {lines.map((l) => (
          <span key={l} dir="auto">
            {l}
          </span>
        ))}
      </span>
    ) : null;
    body = canEdit ? (
      <button
        ref={button}
        type="button"
        onClick={edit.start}
        aria-label={`Edit the address: ${lines.join(", ") || "none on file"}`}
        aria-busy={edit.busy || undefined}
        className="group -mx-2 flex w-[calc(100%+1rem)] items-start justify-between gap-2 rounded-xl px-2 py-1.5 text-[15.5px] leading-snug text-ink hover:bg-[var(--v2-blue-tint)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--v2-blue)]"
      >
        {text ?? <span className="text-[var(--v2-blue)]">Add an address</span>}
        {edit.busy ? (
          <span aria-hidden="true" className="mt-1.5 size-2 shrink-0 animate-pulse rounded-full bg-[var(--v2-sun-from)]" />
        ) : (
          <Pencil className="mt-1 shrink-0 text-faint opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
        )}
      </button>
    ) : (
      <div className="text-[15.5px] leading-snug text-ink">{text ?? <span className="text-muted">No address on file.</span>}</div>
    );
  }

  return (
    <CardBox
      title="Address"
      id={`${id}-h`}
      aside={
        zone && !edit.editing ? (
          <span className="rounded-full border border-[var(--v2-line-input)] px-2.5 py-0.5 text-[12px] font-semibold text-ink-2">{zone}</span>
        ) : null
      }
    >
      {body}
    </CardBox>
  );
}

/** One switch: saves the moment it is flipped. A failed save puts it back and says why. */
function Switch({
  model,
  canEdit,
  unit,
  fieldKey,
  label,
  hint,
}: Common & {
  unit: typeof HOUSEHOLD_UNITS.directory | typeof HOUSEHOLD_UNITS.mail;
  fieldKey: "directory_opt_in" | "physical_mail_opt_in";
  label: string;
  hint: string;
}) {
  const edit = useInlineEdit({ unit, values: model.values, check: toCheckContext(model.check), owner: owner(model), target: target(model) });
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
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-labelledby={id}
          aria-busy={edit.busy || undefined}
          disabled={!canEdit || edit.busy}
          onClick={() => edit.commit({ [fieldKey]: on ? "off" : "on" })}
          className={`relative h-8 w-14 shrink-0 rounded-full transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--v2-blue)] disabled:cursor-default ${on ? "bg-navy" : "bg-toggle-off"} ${canEdit ? "" : "opacity-60"}`}
        >
          <span aria-hidden="true" className={`absolute top-1 size-6 rounded-full bg-white shadow transition-all ${on ? "left-7" : "left-1"}`} />
          <span className="sr-only">{on ? "On" : "Off"}</span>
        </button>
      </div>
      <SaveError edit={edit} />
    </div>
  );
}

export function PreferencesCard({ model, canEdit }: Common) {
  const id = useId();
  return (
    <CardBox
      title="Preferences"
      id={id}
      aside={canEdit ? null : <span className="rounded-full bg-[var(--v2-ground)] px-2.5 py-0.5 text-[12px] font-semibold text-muted">View only</span>}
    >
      <Switch
        model={model}
        canEdit={canEdit}
        unit={HOUSEHOLD_UNITS.directory}
        fieldKey="directory_opt_in"
        label="Listed in the member directory"
        hint="Members can find this family in the directory."
      />
      <Switch
        model={model}
        canEdit={canEdit}
        unit={HOUSEHOLD_UNITS.mail}
        fieldKey="physical_mail_opt_in"
        label="Send physical mail"
        hint="Letters and printed statements to the address above."
      />
    </CardBox>
  );
}

/**
 * The household's note, read-only. It is the one free-text column that members can read today, so this screen does not offer to
 * write it; the protected notes (plan slice 10) replace it.
 */
export function NotesCard({ model }: { model: FamilyModel }) {
  const id = useId();
  const text = model.values.notes ?? "";
  return (
    <CardBox title="Notes" id={id}>
      <p dir="auto" className="m-0 whitespace-pre-wrap text-[14.5px] text-ink">
        {text || <span className="text-muted">No notes.</span>}
      </p>
    </CardBox>
  );
}

/** Household IDs as chips: every one finds this family in the box. Adding or retiring an ID is done in the person's details. */
export function IdsCard({ model, manageHref }: { model: FamilyModel; manageHref: string | null }) {
  const id = useId();
  return (
    <CardBox
      title="IDs"
      id={id}
      aside={
        manageHref ? (
          <Link href={manageHref} className="text-[13px] font-bold text-[var(--v2-blue)] hover:underline">
            Manage IDs
          </Link>
        ) : null
      }
    >
      {model.ids.length === 0 ? (
        <p className="m-0 text-[14px] text-muted">No IDs recorded for this household.</p>
      ) : (
        <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
          {model.ids.map((i) => (
            <li
              key={i.id}
              className="inline-flex min-h-9 items-center gap-2 rounded-full border border-[var(--v2-line-input)] bg-white px-3 text-[13px] text-ink-2"
            >
              <span>{i.label}</span>
              <span className="font-mono text-[13px] font-semibold text-ink" dir="auto">
                {i.value}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="m-0 mt-2 text-[12px] text-muted">Every one of these finds this family in the search box.</p>
    </CardBox>
  );
}
