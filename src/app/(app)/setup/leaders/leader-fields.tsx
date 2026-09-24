"use client";

import { PersonPicker } from "@/components/person-picker";
import { LEADER_BODIES, LEADER_TITLES } from "@/lib/setup";

import { searchLeaderPeopleAction } from "../actions";

export type LeaderView = {
  id: string;
  person_id: string | null;
  person_name: string | null;
  full_name: string;
  title: string;
  body: string;
  term_start: string | null;
  term_end: string | null;
  show_publicly: boolean;
  sort: number;
};

/** The fields of the add / edit leader drawer. */
export function LeaderFields({ leader }: { leader: LeaderView | null }) {
  const key = leader?.id ?? "new";
  return (
    <>
      {leader ? <input type="hidden" name="id" value={leader.id} /> : null}
      <div>
        <label className="crm-label" htmlFor={`l-name-${key}`}>
          Full name
        </label>
        <input id={`l-name-${key}`} name="full_name" className="crm-input" defaultValue={leader?.full_name ?? ""} required maxLength={120} />
      </div>
      <div>
        <label className="crm-label" htmlFor={`l-title-${key}`}>
          Title
        </label>
        <input id={`l-title-${key}`} name="title" list={`l-titles-${key}`} className="crm-input" defaultValue={leader?.title ?? ""} required maxLength={80} placeholder="President" />
        <datalist id={`l-titles-${key}`}>
          {LEADER_TITLES.map((t) => (
            <option key={t} value={t} />
          ))}
        </datalist>
      </div>
      <div>
        <label className="crm-label" htmlFor={`l-body-${key}`}>
          Group
        </label>
        <select id={`l-body-${key}`} name="body" className="crm-input" defaultValue={leader?.body ?? "executive_committee"}>
          {LEADER_BODIES.map((b) => (
            <option key={b.value} value={b.value}>
              {b.label}
            </option>
          ))}
        </select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="crm-label" htmlFor={`l-start-${key}`}>
            Term starts
          </label>
          <input id={`l-start-${key}`} type="date" name="term_start" className="crm-input" defaultValue={leader?.term_start ?? ""} />
        </div>
        <div>
          <label className="crm-label" htmlFor={`l-end-${key}`}>
            Term ends
          </label>
          <input id={`l-end-${key}`} type="date" name="term_end" className="crm-input" defaultValue={leader?.term_end ?? ""} />
        </div>
      </div>
      <PersonPicker
        name="person_id"
        label="Person record (optional)"
        search={searchLeaderPeopleAction}
        initial={leader?.person_id ? [{ id: leader.person_id, name: leader.person_name ?? "Linked person", detail: null }] : []}
        hint="Link once people are imported, so the roster follows their record."
      />
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="crm-label" htmlFor={`l-sort-${key}`}>
            Order
          </label>
          <input id={`l-sort-${key}`} type="number" name="sort" min={0} max={999} className="crm-input" defaultValue={leader?.sort ?? 0} />
        </div>
        <label className="mt-6 flex items-center gap-2 text-[13px]">
          <input type="checkbox" name="show_publicly" defaultChecked={leader?.show_publicly ?? true} />
          Show publicly
        </label>
      </div>
    </>
  );
}
