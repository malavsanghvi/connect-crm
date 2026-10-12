"use client";

import type { ReactNode } from "react";

import type { FamilyModel, HeaderChip } from "@/lib/people-v2/family-model";
import { suggestedLastName } from "@/lib/people-v2/slideover";

import { FamilyActionsProvider, type FamilyActions } from "./actions";
import { AddPersonCard, AddPersonProvider } from "./add-person-card";
import { FamilyHeader, type FamilyLinks } from "./family-header";
import { AddressCard, IdsCard, NotesCard, PreferencesCard } from "./household-edit";
import { ChildRow, PersonCard, type PersonCtx } from "./person-card";
import { UndoProvider } from "./undo";

// The Family page's body in the New look: the household and every person on one page, each value editable where it stands.
// Left (two thirds): the people (adults as cards, children compact below), then IDs and Notes. Right: Address, Giving at a glance
// (the panel as it is), Preferences. On a phone everything is one column in the order: people, children, address, giving,
// preferences, IDs, notes. The server hands in the parts that are read on the server (the glance, the tabs) as `slots`.

export type FamilySlots = {
  /** The household's "Giving at a glance" panel; null when Giving is off. */
  glance: ReactNode;
  /** Pledges and payments, memberships, events, history. */
  tabs: ReactNode;
  /** A notice to choose a new primary member, when one is needed. */
  prompt?: ReactNode;
  /** Anything that must be rendered at the end (the classic drawers that "Add person" and "Open details" use until the slide-over). */
  after?: ReactNode;
};

export function FamilyView({
  model,
  chips,
  links,
  detailsTemplate,
  moveTemplate,
  mergeTemplate = "/people/merge?person=__ID__",
  problems = [],
  slots,
  actions,
  undoWindowMs,
}: {
  model: FamilyModel;
  chips: HeaderChip[];
  links: FamilyLinks;
  /** Where "Open details" goes (the person's slide-over); the person's id replaces __ID__. */
  detailsTemplate: string;
  /** Where "Move to another family" goes (the existing move flow), and "Merge with another person"; the id replaces __ID__. */
  moveTemplate?: string;
  mergeTemplate?: string;
  problems?: string[];
  slots: FamilySlots;
  /** The writes (the dev previews pass fakes for some of them). */
  actions?: Partial<FamilyActions>;
  undoWindowMs?: number;
}) {
  const canEdit = model.canEdit;
  const ctx: PersonCtx = {
    householdId: model.id,
    canEdit,
    check: model.check,
    detailsHref: (id) => detailsTemplate.replace("__ID__", id),
    moveHref: (id) => (moveTemplate ?? detailsTemplate).replace("__ID__", id),
    mergeHref: (id) => mergeTemplate.replace("__ID__", id),
  };
  return (
    <FamilyActionsProvider actions={actions}>
      <UndoProvider windowMs={undoWindowMs}>
        <AddPersonProvider>
          <div className="pb-24 md:pb-0">
            <FamilyHeader model={model} chips={chips} links={links} canEdit={canEdit} />

            {problems.length > 0 ? (
              <div
                role="status"
                className="mt-3 rounded-xl border border-[var(--v2-sun-from)]/60 bg-[var(--v2-sun-tint)] px-4 py-2.5 text-[13.5px] text-[var(--v2-sun-ink)]"
              >
                {problems.map((p) => (
                  <p key={p} className="m-0">
                    {p}
                  </p>
                ))}
              </div>
            ) : null}
            {slots.prompt}

            <div className="mt-4 flex flex-col gap-4">
              <div className="order-4 contents xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] xl:items-start xl:gap-4">
                <div className="contents xl:flex xl:flex-col xl:gap-4">
                  <section aria-label="People" className="order-1 grid gap-4 md:grid-cols-2">
                    {model.adults.map((p) => (
                      <PersonCard key={p.id} person={p} ctx={ctx} orgMemberLabel={model.orgMemberLabel} />
                    ))}
                    {model.adults.length === 0 ? (
                      <p className="m-0 rounded-2xl border border-line bg-white p-5 text-[14.5px] text-muted md:col-span-2">
                        No adults are in this household yet.
                      </p>
                    ) : null}
                  </section>

                  {links.addPerson ? (
                    <AddPersonCard
                      householdId={model.id}
                      householdName={model.name}
                    householdNumber={model.number}
                      lastName={suggestedLastName(model.adults)}
                      check={model.check}
                      detailsHref={detailsTemplate}
                    />
                  ) : null}

                  {model.children.length > 0 || model.hiddenPeople > 0 ? (
                    <section aria-label="Children" className="order-3 overflow-hidden rounded-2xl border border-line bg-white">
                      <h2 className="m-0 flex items-center gap-2 px-4 pb-1 pt-3.5 text-[11.5px] font-extrabold uppercase tracking-[0.06em] text-muted">
                        <svg
                          viewBox="0 0 24 24"
                          width="14"
                          height="14"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          <rect x="5" y="11" width="14" height="9" rx="2" />
                          <path d="M8 11V8a4 4 0 018 0v3" />
                        </svg>
                        Children ({model.children.length}) · Staff only · Never shown to Niva
                      </h2>
                      <ul className="m-0 list-none divide-y divide-line p-0">
                        {model.children.map((p) => (
                          <ChildRow key={p.id} person={p} ctx={ctx} />
                        ))}
                      </ul>
                      {model.hiddenPeople > 0 ? (
                        <p className="m-0 border-t border-line px-4 py-3 text-[13px] text-muted">
                          {model.hiddenPeople === 1 ? "1 more person is" : `${model.hiddenPeople} more people are`} in this household, but your role cannot see{" "}
                          {model.hiddenPeople === 1 ? "them" : "them"}.
                        </p>
                      ) : null}
                    </section>
                  ) : null}

                  <div className="order-7 contents md:grid md:grid-cols-2 md:gap-4">
                    <div className="order-7">
                      <IdsCard model={model} manageHref={links.manageIds} />
                    </div>
                    <div className="order-8">
                      <NotesCard model={model} />
                    </div>
                  </div>
                </div>

                <div className="contents xl:flex xl:flex-col xl:gap-4">
                  <div className="order-4">
                    <AddressCard model={model} canEdit={canEdit} />
                  </div>
                  <div className="order-6">
                    <PreferencesCard model={model} canEdit={canEdit} />
                  </div>
                </div>
              </div>
              {slots.glance ? <div className="order-5">{slots.glance}</div> : null}
            </div>

            <div className="mt-6">{slots.tabs}</div>
            {slots.after}
          </div>
        </AddPersonProvider>
      </UndoProvider>
    </FamilyActionsProvider>
  );
}
