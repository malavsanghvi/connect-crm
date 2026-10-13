"use client";

import { useEffect, useMemo } from "react";

import type { InlineSave } from "@/app/(app)/households/[id]/inline-actions";
import type { FamilyActions } from "@/components/people-v2/family/actions";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { CustomFieldsSection } from "@/components/people-v2/custom/custom-group";
import { FamilyView, type FamilySlots } from "@/components/people-v2/family/family-view";
import { PersonSlideOver } from "@/components/people-v2/slideover/person-slideover";
import type { CustomFieldsPayload } from "@/lib/people-v2/custom-fields";
import type { FamilyModel, HeaderChip } from "@/lib/people-v2/family-model";
import type { MenuHrefs, PersonDetailModel, SectionPlan } from "@/lib/people-v2/slideover";

// DEV ONLY. The Family page with custom fields and fake writes, so each state can be drawn and checked without a database:
//   scenario  ok (default) | conflict | error | access        what the next save of a value answers
//   do        a short script that opens an editor, a sheet or a menu and types, so a screenshot can catch the state

export type Scenario = "ok" | "conflict" | "error" | "access";
export type Step =
  | "none"
  | "edit"
  | "save"
  | "date-error"
  | "choice"
  | "household-edit"
  | "household-save"
  | "add"
  | "add-suggest"
  | "add-choice"
  | "add-bad"
  | "add-save"
  | "add-household"
  | "ask-copy"
  | "manage";

function fakeActions(scenario: Scenario): Partial<FamilyActions> {
  const wait = () => new Promise((r) => setTimeout(r, 140));
  return {
    async save(target, input): Promise<InlineSave> {
      await wait();
      if (target.kind !== "custom") return { ok: true, message: "Saved", changed: true };
      const key = Object.keys(input.fields)[0] ?? "";
      if (scenario === "conflict") {
        return {
          ok: false,
          kind: "conflict",
          error: "Could not save — someone else changed this first. Nothing was saved: look at the new value and choose which to keep.",
          conflict: { theirs: { [key]: "First aid, driving" }, who: "Ravi", at: new Date(Date.now() - 70_000).toISOString() },
        };
      }
      if (scenario === "error") return { ok: false, kind: "other", error: `Could not save ${input.label} — the server did not accept it. Nothing was changed. Try again.` };
      if (scenario === "access") return { ok: false, kind: "access", error: `You don't have access to this area. ${input.label[0].toUpperCase()}${input.label.slice(1)} was not changed.` };
      return { ok: true, message: "Saved", changed: true };
    },
    custom: {
      async add(input) {
        await wait();
        if (scenario === "error") return { ok: false, error: "Could not add the custom field — the server did not accept it. Nothing was added. Try again." };
        return { ok: true, message: `${input.label} added.`, id: "new-field" };
      },
      async setStatus() {
        await wait();
        return { ok: true };
      },
    },
  };
}

function setValue(el: HTMLInputElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  set?.call(el, text);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}
function enter(el: HTMLElement) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
}

function run(step: Step, who: string) {
  const card = document.querySelector<HTMLElement>(`article[aria-label="${who}"]`);
  const click = (root: ParentNode | null, sel: string) => root?.querySelector<HTMLElement>(sel)?.click();
  const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
  const typeInto = (root: ParentNode | null, sel: string, text: string, then?: (el: HTMLInputElement) => void) =>
    later(90, () => {
      const el = root?.querySelector<HTMLInputElement>(sel);
      if (!el) return;
      setValue(el, text);
      if (then) later(90, () => then(el));
    });
  const sheet = () => document.querySelector<HTMLElement>('[data-testid="add-field-sheet"]');
  const row = (field: string) => `[data-testid="custom-row"][data-field="${field}"]`;

  if (step === "edit") click(card, `${row("volunteer_skills")} button`);
  if (step === "save") {
    click(card, `${row("volunteer_skills")} button`);
    typeInto(card, `${row("volunteer_skills")} input`, "Catering, first aid, driving", enter);
  }
  if (step === "date-error") {
    click(card, `${row("anniversary")} button`);
    typeInto(card, `${row("anniversary")} input`, "someday", enter);
  }
  if (step === "choice") click(card, `${row("shirt_size")} button`);
  if (step === "household-edit" || step === "household-save") {
    const box = document.querySelector<HTMLElement>('[data-testid="custom-details"]');
    click(box, `${row("hometown")} button`);
    if (step === "household-save") typeInto(box, `${row("hometown")} input`, "Beirut, Lebanon", enter);
  }
  if (step.startsWith("add") || step === "ask-copy") {
    if (step === "add-household") click(document.querySelector('[data-testid="custom-details"]'), '[data-testid="add-field-link"]');
    else click(card, '[data-testid="add-field-link"]');
    later(220, () => {
      if (step === "add-suggest" || step === "add-save") {
        document.querySelector<HTMLElement>('[data-testid="field-suggestions"] button')?.click();
        if (step === "add-save") later(160, () => sheet()?.querySelector<HTMLFormElement>("form")?.requestSubmit());
      }
      if (step === "add-choice") {
        const type = sheet()?.querySelector<HTMLSelectElement>("select");
        if (type) {
          const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set;
          set?.call(type, "choice");
          type.dispatchEvent(new Event("change", { bubbles: true }));
        }
        later(90, () => {
          const name = sheet()?.querySelector<HTMLInputElement>('input[placeholder^="For example"]');
          if (name) setValue(name, "Best way to reach you");
        });
      }
      if (step === "add-bad") sheet()?.querySelector<HTMLFormElement>("form")?.requestSubmit();
      if (step === "ask-copy") {
        const name = sheet()?.querySelector<HTMLInputElement>('input[placeholder^="For example"]');
        if (name) setValue(name, "Accessibility needs");
        later(120, () => sheet()?.querySelector<HTMLFormElement>("form")?.requestSubmit());
      }
    });
  }
  if (step === "manage") click(card, '[data-testid="manage-fields-link"]');
}

export function PreviewFields(props: {
  model: FamilyModel;
  chips: HeaderChip[];
  links: FamilyLinks;
  slots: FamilySlots;
  custom: CustomFieldsPayload;
  scenario: Scenario;
  step: Step;
  who: string;
  detailsTemplate: string;
  /** The person's slide-over, when it is open: its content, with the custom fields section filled in here. */
  panel: { detail: PersonDetailModel; plan: SectionPlan[]; personId: string; firstName: string; isChild: boolean; closeHref: string; hrefs: MenuHrefs } | null;
}) {
  const { scenario, step, who, detailsTemplate, panel, ...rest } = props;
  const actions = useMemo(() => fakeActions(scenario), [scenario]);
  useEffect(() => {
    if (step === "none") return;
    const t = window.setTimeout(() => run(step, who), 500);
    return () => window.clearTimeout(t);
  }, [step, who]);
  const after = panel ? (
    <PersonSlideOver
      mode="panel"
      detail={panel.detail}
      plan={panel.plan}
      slots={{ customFields: <CustomFieldsSection payload={rest.custom} personId={panel.personId} firstName={panel.firstName} isChild={panel.isChild} path="/dev/people-fields" /> }}
      closeHref={panel.closeHref}
      closeLabel={rest.model.name}
      hrefs={panel.hrefs}
    />
  ) : null;
  return <FamilyView {...rest} slots={{ ...rest.slots, after }} detailsTemplate={detailsTemplate} actions={actions} />;
}
