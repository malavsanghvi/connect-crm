"use client";

import { useId, useMemo, useState } from "react";

import { ChipGroup } from "@/components/controls";
import { Badge } from "@/components/ui";
import {
  buildKindPicker,
  chooseFamily,
  chooseKind,
  chooseTop,
  chosenKind,
  EMPTY_SELECTION,
  familyChoices,
  FAITH_TOP,
  kindChoices,
  selectionFor,
  topChoices,
  type Experience,
  type KindSelection,
} from "@/lib/experiences";

/**
 * "Kind of organization": the two-step picker of Platform › New sandbox, Requests and a center's page.
 *
 *   step 1  Faith-based, or one of the other kinds (Chamber of commerce, Club, Non-profit, Neutral …)
 *   step 2  (faith-based only) the tradition family
 *   step 3  (faith-based only) the specific kind
 *
 * The choices are the catalog's rows (app.list_experiences), so a new kind appears here with no code change.
 * The chosen kind's key is submitted as `name`. `includeInactive` lets a sandbox preview a kind that is not
 * switched on for live organizations yet.
 */
export function KindPicker({
  experiences,
  includeInactive,
  name,
  defaultKey,
  initial,
  label = "Kind of organization",
  disabled = false,
  onChange,
}: {
  experiences: Experience[];
  includeInactive: boolean;
  name: string;
  /** The kind that starts chosen (a center's current kind). */
  defaultKey?: string | null;
  /** Where the picker starts when only part of the choice is known (an applicant who said "temple"). */
  initial?: KindSelection;
  label?: string;
  disabled?: boolean;
  onChange?: (kind: Experience | null) => void;
}) {
  const id = useId();
  const model = useMemo(() => buildKindPicker(experiences, { includeInactive }), [experiences, includeInactive]);
  const [sel, setSel] = useState<KindSelection>(() => initial ?? selectionFor(model, defaultKey) ?? EMPTY_SELECTION);
  const kind = chosenKind(model, sel);

  function update(next: KindSelection) {
    setSel(next);
    onChange?.(chosenKind(model, next));
  }

  const top = topChoices(model);
  if (top.length === 0) {
    return (
      <div role="alert" className="rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
        No kinds of organization are available to choose. Reload the page; if this stays, the kind catalog in the database is empty.
      </div>
    );
  }
  const inFaith = sel.top === FAITH_TOP;
  const families = familyChoices(model);
  const specific = inFaith ? kindChoices(model, sel.family) : [];
  const preview = (e: Experience) => (e.active ? e.label : `${e.label} (preview)`);

  return (
    <fieldset className="flex flex-col gap-2" disabled={disabled} data-testid="kind-picker">
      <legend className="crm-label" id={`${id}-legend`}>
        {label}
      </legend>
      <div>
        <p className="crm-hint !mt-0 mb-1">Type</p>
        <ChipGroup label={`${label}: type`} options={top} value={sel.top ?? ""} onChange={(v) => update(chooseTop(model, v))} />
      </div>
      {inFaith && families.length > 1 ? (
        <div>
          <p className="crm-hint !mt-0 mb-1">Tradition</p>
          <ChipGroup label={`${label}: tradition`} options={families} value={sel.family ?? ""} onChange={(v) => update(chooseFamily(model, v))} />
        </div>
      ) : null}
      {inFaith && sel.family && specific.length > 1 ? (
        <div>
          <p className="crm-hint !mt-0 mb-1">Which one</p>
          <ChipGroup
            label={`${label}: which one`}
            options={specific.map((e) => ({ value: e.key, label: preview(e) }))}
            value={sel.key ?? ""}
            onChange={(v) => update(chooseKind(model, v))}
          />
        </div>
      ) : null}
      <input type="hidden" name={name} value={kind?.key ?? ""} />
      <p className="crm-hint !mt-0" data-testid="kind-summary" aria-live="polite">
        {kind ? (
          <>
            <span className="font-semibold text-ink">{kind.label}</span>
            {kind.description ? ` · ${kind.description}` : ""}{" "}
            {!kind.active ? (
              <Badge tone="warning" title="Only a sandbox can use this kind until it is switched on for live organizations">
                Preview only
              </Badge>
            ) : null}
          </>
        ) : inFaith ? (
          "Choose the tradition and the kind of faith community."
        ) : (
          "Choose the kind of organization."
        )}
      </p>
    </fieldset>
  );
}
