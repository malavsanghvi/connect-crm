"use client";

import { useState } from "react";

import { ActionForm } from "@/components/action-form";
import { buttonClass } from "@/components/ui";
import { CUSTOM_ENTITY_LABELS, SENSITIVITY_LABELS, type CustomFieldDef } from "@/lib/custom-fields";
import { CUSTOM_TYPES } from "@/lib/import/mapping";

import { defineCustomFieldAction, updateCustomFieldAction } from "./actions";

export function AddCustomFieldForm({ entities }: { entities: string[] }) {
  const [type, setType] = useState("text");
  return (
    <ActionForm action={defineCustomFieldAction} submitLabel="Add the field" pendingLabel="Adding…" resetOnSuccess className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div>
          <label htmlFor="cf-entity" className="crm-label">
            On
          </label>
          <select id="cf-entity" name="entity" className="crm-input" defaultValue="people">
            {entities.map((e) => (
              <option key={e} value={e}>
                {CUSTOM_ENTITY_LABELS[e] ?? e}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cf-label" className="crm-label">
            Name
          </label>
          <input id="cf-label" name="label" className="crm-input" maxLength={120} required placeholder="Senior status" />
        </div>
        <div>
          <label htmlFor="cf-type" className="crm-label">
            Type
          </label>
          <select id="cf-type" name="type" className="crm-input" value={type} onChange={(e) => setType(e.target.value)}>
            {CUSTOM_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        {type === "choice" ? (
          <div className="md:col-span-3">
            <label htmlFor="cf-choices" className="crm-label">
              Choices (separated by commas)
            </label>
            <input id="cf-choices" name="choices" className="crm-input" placeholder="Gold, Silver, Bronze" />
          </div>
        ) : null}
        <div>
          <label htmlFor="cf-sens" className="crm-label">
            Who sees it
          </label>
          <select id="cf-sens" name="sensitivity" className="crm-input" defaultValue="staff">
            {Object.entries(SENSITIVITY_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </div>
        <label className="flex min-h-11 items-center gap-2 self-end text-[13px]">
          <input type="checkbox" name="searchable" className="h-5 w-5" /> Searchable and usable as a filter
        </label>
      </div>
    </ActionForm>
  );
}

export function EditCustomFieldForm({ def }: { def: CustomFieldDef }) {
  const [open, setOpen] = useState(false);
  if (!open) {
    return (
      <button type="button" className={buttonClass("ghost", "xs")} onClick={() => setOpen(true)} aria-label={`Edit ${def.label}`}>
        Edit
      </button>
    );
  }
  return (
    <ActionForm
      action={updateCustomFieldAction}
      submitLabel="Save"
      pendingLabel="Saving…"
      size="xs"
      className="min-w-[300px] space-y-2"
      extraButtons={
        <button type="button" className={buttonClass("ghost", "xs")} onClick={() => setOpen(false)}>
          Close
        </button>
      }
    >
      <input type="hidden" name="id" value={def.id} />
      <label className="crm-label" htmlFor={`l-${def.id}`}>
        Name
      </label>
      <input id={`l-${def.id}`} name="label" className="crm-input" defaultValue={def.label} maxLength={120} />
      {def.type === "choice" ? (
        <>
          <label className="crm-label" htmlFor={`c-${def.id}`}>
            Choices
          </label>
          <input id={`c-${def.id}`} name="choices" className="crm-input" defaultValue={def.choices.join(", ")} />
        </>
      ) : null}
      <label className="crm-label" htmlFor={`s-${def.id}`}>
        Who sees it
      </label>
      <select id={`s-${def.id}`} name="sensitivity" className="crm-input" defaultValue={def.sensitivity}>
        {Object.entries(SENSITIVITY_LABELS).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <label className="crm-label" htmlFor={`st-${def.id}`}>
        Status
      </label>
      <select id={`st-${def.id}`} name="status" className="crm-input" defaultValue={def.status}>
        <option value="active">Active</option>
        <option value="archived">Archived (keeps values, takes no new ones)</option>
      </select>
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" name="searchable" className="h-5 w-5" defaultChecked={def.searchable} /> Searchable and usable as a filter
      </label>
    </ActionForm>
  );
}
