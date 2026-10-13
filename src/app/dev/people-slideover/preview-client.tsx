"use client";

import { useEffect, useMemo, type ReactNode } from "react";

import type { InlineSave } from "@/app/(app)/households/[id]/inline-actions";
import type { FamilyActions } from "@/components/people-v2/family/actions";
import type { FamilyLinks } from "@/components/people-v2/family/family-header";
import { FamilyView } from "@/components/people-v2/family/family-view";
import { PersonSlideOver, type SlideOverSlots } from "@/components/people-v2/slideover/person-slideover";
import type { FamilyModel, HeaderChip } from "@/lib/people-v2/family-model";
import { conflictSentence } from "@/lib/people-v2/inline-edit";
import type { MenuHrefs, PersonDetailModel, SectionPlan } from "@/lib/people-v2/slideover";

// DEV ONLY. The Family page with the person slide-over open, and fake writes, so each state can be drawn and checked without a
// database:
//   scenario  ok (default) | conflict | error | access        what the next write answers
//   do        a short script that opens an editor or a menu and types, so a screenshot can catch the state

export type Scenario = "ok" | "conflict" | "error" | "access";
export type Step =
  | "none"
  | "phone-edit"
  | "phone-save"
  | "name"
  | "dob"
  | "gender"
  | "goes-by"
  | "interests-edit"
  | "interests-save"
  | "interests-long"
  | "areas-edit"
  | "call-time"
  | "daily-goal"
  | "switch"
  | "ids-add"
  | "ids-add-save"
  | "ids-retire"
  | "ids-retire-save"
  | "menu"
  | "card-menu"
  | "deceased"
  | "deceased-save"
  | "add-person"
  | "add-person-save"
  | "add-person-child"
  | "add-person-bad";

/** What "someone else" changed it to, for the conflict scenario. */
const THEIRS: Record<string, string> = {
  phone_e164: "+17135550100",
  preferred_name: "Sami",
  interests: '["Hiking","Board games"]',
  expertise_tags: '["Accounting"]',
  best_call_time: "morning",
  gyan_daily_minutes: "15",
};

function fakeActions(scenario: Scenario): Partial<FamilyActions> {
  const wait = () => new Promise((r) => setTimeout(r, 140));
  return {
    async save(_target, input): Promise<InlineSave> {
      await wait();
      const keys = Object.keys(input.fields);
      if (scenario === "conflict") {
        return {
          ok: false,
          kind: "conflict",
          error: conflictSentence(keys),
          conflict: {
            theirs: Object.fromEntries(keys.map((k) => [k, THEIRS[k] ?? (input.expect[k] ?? "")])),
            who: "Ravi",
            at: new Date(Date.now() - 70_000).toISOString(),
          },
        };
      }
      if (scenario === "error")
        return {
          ok: false,
          kind: "other",
          error: keys.includes("phone_e164")
            ? `Could not save ${input.label} — the number needs an area code, like (713) 555-0142. Try again.`
            : `Could not save ${input.label} — the server did not accept it. Nothing was changed. Try again.`,
        };
      if (scenario === "access") return { ok: false, kind: "access", error: `You don't have access to this area. ${input.label[0].toUpperCase()}${input.label.slice(1)} was not changed.` };
      return { ok: true, message: "Saved", changed: true };
    },
    async addPerson(input) {
      await wait();
      if (scenario === "error") return { ok: false, error: `Could not add ${input.first_name} ${input.last_name} — the server did not accept it. Nothing was added. Try again.` };
      if (scenario === "access") return { ok: false, error: "Could not add the person — you don't have permission (needs people.manage)." };
      return { ok: true, message: "Added", personId: "p-new" };
    },
    ids: {
      async add() {
        await wait();
        if (scenario === "error")
          return { ok: false, error: 'Could not add the Community member ID — "0482" (org_register) is already assigned to Karim Hassan. Retire it there first if it moved.' };
        return { ok: true, message: 'Added Community member ID "0484".' };
      },
      async retire() {
        await wait();
        if (scenario === "error") return { ok: false, error: "Could not retire the Legacy CRM id — no change was saved (you may not have permission)." };
        return { ok: true, message: 'Retired "20417". It stays in the history.' };
      },
    },
    deceased: {
      async mark() {
        await wait();
        return { ok: true, message: "Layla Hassan is recorded as deceased · audit logged." };
      },
      async undo() {
        await wait();
        return { ok: true, message: "Recorded as no longer deceased · audit logged." };
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

function run(step: Step) {
  const panel = document.querySelector<HTMLElement>('[data-testid="person-slideover"]') ?? document;
  const page = document.querySelector<HTMLElement>('[data-testid="person-details-page"]');
  const root: ParentNode = page ?? panel;
  const click = (r: ParentNode | null, sel: string) => r?.querySelector<HTMLElement>(sel)?.click();
  const later = (ms: number, fn: () => void) => window.setTimeout(fn, ms);
  const typeInto = (sel: string, text: string, then?: (el: HTMLInputElement) => void) =>
    later(90, () => {
      const el = (root as ParentNode).querySelector<HTMLInputElement>(sel) ?? document.querySelector<HTMLInputElement>(sel);
      if (!el) return;
      setValue(el, text);
      if (then) later(90, () => then(el));
    });
  if (step === "phone-edit" || step === "phone-save") {
    click(root, 'button[aria-label^="Edit mobile"]');
    typeInto('input[aria-label="Mobile"]', "(832) 555-0199", step === "phone-save" ? enter : undefined);
  }
  if (step === "name") click(root, 'button[aria-label^="Edit name"]');
  if (step === "dob") {
    click(root, 'button[aria-label^="Edit birth date"]');
    typeInto('input[aria-label="Birth date"]', "03/14/2014");
  }
  if (step === "gender") click(root, 'button[aria-label^="Edit gender"]');
  if (step === "goes-by") {
    click(root, 'button[aria-label^="Edit goes by"]');
    typeInto('input[aria-label="Goes by"]', "Sami");
  }
  if (step === "interests-edit" || step === "interests-save") {
    click(root, 'button[aria-label^="Edit interests"]');
    typeInto('input[aria-label="Interests"]', "Chess, कविता, Origami, ", step === "interests-save" ? enter : undefined);
  }
  if (step === "interests-long") {
    click(root, 'button[aria-label^="Edit interests"]');
    typeInto('input[aria-label="Interests"]', `${"A very long interest that goes on and on and on forever and ever"}, `, enter);
  }
  if (step === "areas-edit") {
    click(root, 'button[aria-label^="Edit expertise areas"]');
    typeInto('input[aria-label="Expertise areas"]', "Law, Tax, ");
  }
  if (step === "call-time") click(root, 'button[aria-label^="Edit best call time"]');
  if (step === "daily-goal") click(root, 'button[aria-label^="Edit daily goal"]');
  if (step === "switch") click(root, '[data-section="privacy"] button[role="switch"]');
  if (step === "ids-add" || step === "ids-add-save") {
    click(root, '[data-testid="ids-section"] > button');
    typeInto('form[aria-label="Add an ID"] input[class*="font-mono"]', "0484", step === "ids-add-save" ? enter : undefined);
  }
  if (step === "ids-retire" || step === "ids-retire-save") {
    click(root, '[data-testid="ids-section"] button[aria-label^="Retire"]');
    if (step === "ids-retire-save") later(120, () => document.querySelector<HTMLElement>('[data-testid="ids-section"] [role="group"] button')?.click());
  }
  if (step === "menu") click(root, "footer button[aria-haspopup='menu']");
  if (step === "card-menu") click(document, 'article button[aria-label^="More about"]');
  if (step === "deceased" || step === "deceased-save") {
    click(root, "footer button[aria-haspopup='menu']");
    later(120, () => {
      [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((e) => /deceased/i.test(e.textContent ?? ""))?.click();
      if (step === "deceased-save")
        later(150, () => {
          const d = document.querySelector<HTMLInputElement>('[data-testid="deceased-sheet"] input[type="date"]');
          if (d) setValue(d, "2026-10-01");
          const why = document.querySelector<HTMLTextAreaElement>('[data-testid="deceased-sheet"] textarea[placeholder^="For example: their"]');
          if (why) {
            const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
            set?.call(why, "Their mother called the office.");
            why.dispatchEvent(new Event("input", { bubbles: true }));
          }
        });
    });
  }
  if (step.startsWith("add-person")) {
    click(document, '#add-person button[class*="border-dashed"]');
    later(160, () => {
      const first = document.querySelector<HTMLInputElement>('#add-person form input[id$="-first"]');
      if (first) setValue(first, step === "add-person-bad" ? "" : "Zara");
      if (step === "add-person-child" || step === "add-person-bad") {
        const more = [...document.querySelectorAll<HTMLElement>("#add-person form button")].find((b) => /More details/.test(b.textContent ?? ""));
        more?.click();
      }
      // A pressed Enter submits the form in a real browser; a script has to ask the form to submit.
      if (step === "add-person-save" || step === "add-person-bad") later(120, () => document.querySelector<HTMLFormElement>("#add-person form")?.requestSubmit());
    });
  }
}

export function PreviewSlideOver(props: {
  model: FamilyModel;
  chips: HeaderChip[];
  links: FamilyLinks;
  tabs: ReactNode;
  detail: PersonDetailModel | null;
  plan: SectionPlan[];
  slots: SlideOverSlots;
  hrefs: MenuHrefs;
  closeHref: string;
  /** The preview's own address with the family chosen: `?family=hassan`. */
  base: string;
  standalone: boolean;
  scenario: Scenario;
  step: Step;
}) {
  const { scenario, step, detail, standalone } = props;
  const actions = useMemo(() => fakeActions(scenario), [scenario]);
  useEffect(() => {
    if (step === "none") return;
    const t = window.setTimeout(() => run(step), 700);
    return () => window.clearTimeout(t);
  }, [step]);

  if (standalone && detail) {
    return (
      <PersonSlideOver mode="page" detail={detail} plan={props.plan} slots={props.slots} closeHref="/dev/admin-people" closeLabel="People" hrefs={props.hrefs} actions={actions} />
    );
  }
  const panel = detail ? (
    <PersonSlideOver mode="panel" detail={detail} plan={props.plan} slots={props.slots} closeHref={props.closeHref} closeLabel={props.model.name} hrefs={props.hrefs} />
  ) : null;
  return (
    <FamilyView
      model={props.model}
      chips={props.chips}
      links={props.links}
      detailsTemplate={`/dev/people-slideover${props.base}&person=__ID__`}
      moveTemplate={`/dev/people-slideover${props.base}&person=__ID__&mode=move`}
      slots={{ glance: null, tabs: props.tabs, after: panel }}
      actions={actions}
    />
  );
}
