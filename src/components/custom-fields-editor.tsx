"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { setCustomValueAction } from "@/app/custom-field-actions";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { customInputValue, formatCustomValue, type CustomFieldDef } from "@/lib/custom-fields";

type Row = { def: CustomFieldDef; value: unknown };

/** One custom value, shown as a key/value row and editable in place. */
function EditableRow({ row, entity, recordId, editable, currency, path }: { row: Row; entity: string; recordId: string; editable: boolean; currency: string; path?: string }) {
  const router = useRouter();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(customInputValue(row.def, row.value));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const shown = formatCustomValue(row.def, row.value, currency);
  const id = `cf-${entity}-${recordId}-${row.def.key}`;

  function save() {
    setError(null);
    start(async () => {
      try {
        const res = await setCustomValueAction({ entity, recordId, key: row.def.key, value: draft, path });
        if (!res.ok) {
          setError(res.error);
          return;
        }
        toast?.show(res.message ?? "Saved.", "ok");
        setEditing(false);
        router.refresh();
      } catch (err) {
        console.error("[custom fields] save failed:", err);
        setError(`Could not save ${row.def.label} — the server did not respond. Try again.`);
      }
    });
  }

  if (!editing) {
    return (
      <div className="cc-kv">
        <span className="min-w-0">
          {row.def.label}
          {row.def.status === "archived" ? <span className="text-muted"> (archived)</span> : null}
        </span>
        <span className="flex items-center gap-2">
          <span className="whitespace-nowrap font-bold text-ink">{shown || "—"}</span>
          {editable && row.def.status === "active" ? (
            <button
              type="button"
              className={buttonClass("ghost", "xs")}
              aria-label={`Edit ${row.def.label}`}
              onClick={() => {
                setDraft(customInputValue(row.def, row.value));
                setEditing(true);
              }}
            >
              Edit
            </button>
          ) : null}
        </span>
      </div>
    );
  }
  return (
    <div className="rounded-[10px] border border-line p-2.5">
      <label htmlFor={id} className="crm-label">
        {row.def.label}
      </label>
      {row.def.type === "boolean" ? (
        <select id={id} className="crm-input" value={draft} onChange={(e) => setDraft(e.target.value)}>
          <option value="">—</option>
          <option value="Yes">Yes</option>
          <option value="No">No</option>
        </select>
      ) : row.def.type === "choice" ? (
        <select id={id} className="crm-input" value={draft} onChange={(e) => setDraft(e.target.value)}>
          <option value="">—</option>
          {row.def.choices.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          className="crm-input"
          type={row.def.type === "date" ? "date" : row.def.type === "number" || row.def.type === "money" ? "text" : "text"}
          inputMode={row.def.type === "number" || row.def.type === "money" ? "decimal" : undefined}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
        />
      )}
      {error ? (
        <p role="alert" className="mt-1 text-[12px] text-danger">
          {error}
        </p>
      ) : null}
      <div className="mt-2 flex gap-2">
        <button type="button" className={buttonClass("primary", "xs")} disabled={pending} onClick={save}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className={buttonClass("ghost", "xs")} disabled={pending} onClick={() => setEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function CustomFieldsEditor({
  rows,
  entity,
  recordId,
  editable,
  currency,
  path,
}: {
  rows: Row[];
  entity: string;
  recordId: string;
  editable: boolean;
  currency: string;
  path?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((r) => (
        <EditableRow key={r.def.key} row={r} entity={entity} recordId={recordId} editable={editable} currency={currency} path={path} />
      ))}
    </div>
  );
}
