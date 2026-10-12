"use client";

import { useEffect, useMemo } from "react";

import type { InlineSave } from "@/app/(app)/households/[id]/inline-actions";
import type { FamilyActions } from "@/components/people-v2/family/actions";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { FamilyView, type FamilySlots } from "@/components/people-v2/family/family-view";
import type { FamilyModel, HeaderChip } from "@/lib/people-v2/family-model";
import { conflictSentence } from "@/lib/people-v2/inline-edit";

// DEV ONLY. The Family page with fake writes, so each state can be drawn and checked without a database:
//   scenario  ok (default) | conflict | error | access        what the next save answers
//   do        a short script that opens an editor and types, so a screenshot can catch the state:
//             phone-edit, phone-save, name, dob-child, address, child, conflict, error, access

export type Scenario = "ok" | "conflict" | "error" | "access";
export type Step = "phone-edit" | "phone-save" | "name" | "dob-child" | "address" | "child" | "none";

function fakeActions(scenario: Scenario): FamilyActions {
  return {
    async save(_target, input): Promise<InlineSave> {
      await new Promise((r) => setTimeout(r, 120));
      const keys = Object.keys(input.fields);
      if (scenario === "conflict") {
        return {
          ok: false,
          kind: "conflict",
          error: conflictSentence(keys),
          conflict: {
            theirs: Object.fromEntries(keys.map((k) => [k, k === "phone_e164" ? "+17135550100" : (input.expect[k] ?? "")])),
            who: "Ravi",
            at: new Date(Date.now() - 70_000).toISOString(),
          },
        };
      }
      if (scenario === "error")
        return { ok: false, kind: "other", error: `Could not save ${input.label} — the number needs an area code, like (713) 555-0142. Try again.` };
      if (scenario === "access")
        return {
          ok: false,
          kind: "access",
          error: `You don't have access to this area. ${input.label[0].toUpperCase()}${input.label.slice(1)} was not changed.`,
        };
      return { ok: true, message: "Saved", changed: true };
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
  if (step === "phone-edit" || step === "phone-save") {
    click(card, 'button[aria-label^="Edit mobile"]');
    later(80, () => {
      const input = card?.querySelector<HTMLInputElement>('input[aria-label="Mobile"]');
      if (!input) return;
      setValue(input, "(832) 555-0199");
      if (step === "phone-save") later(80, () => enter(input));
    });
  }
  if (step === "name") click(card, 'button[aria-label^="Edit name"]');
  if (step === "dob-child") {
    click(card, 'button[aria-controls^="more-"]');
    later(80, () => {
      click(card, 'button[aria-label^="Edit birth date"]');
      later(80, () => {
        const input = card?.querySelector<HTMLInputElement>('input[aria-label="Birth date"]');
        if (input) setValue(input, "03/14/2014");
      });
    });
  }
  if (step === "address") click(document, 'button[aria-label^="Edit the address"]');
  if (step === "child") click(document, '[data-testid="child-row"] button[aria-expanded]');
}

export function PreviewFamily(props: {
  model: FamilyModel;
  chips: HeaderChip[];
  links: FamilyLinks;
  slots: FamilySlots;
  scenario: Scenario;
  step: Step;
  who: string;
}) {
  const { scenario, step, who, ...rest } = props;
  const actions = useMemo(() => fakeActions(scenario), [scenario]);
  useEffect(() => {
    if (step === "none") return;
    const t = window.setTimeout(() => run(step, who), 400);
    return () => window.clearTimeout(t);
  }, [step, who]);
  return <FamilyView {...rest} detailsTemplate="/dev/people-family?person=__ID__" actions={actions} />;
}
