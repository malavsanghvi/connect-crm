"use client";

import { useState } from "react";

import { buttonClass } from "@/components/ui";
import type { CustomSegment } from "@/lib/comms";

export type CustomFieldOption = { entity: "people" | "households"; key: string; label: string; type: string; choices: string[] };

/**
 * Segments from custom fields marked searchable (Settings › Custom fields):
 * "households where someone has Senior status = yes". Combines with the
 * other segments like any chip.
 */
export function CustomSegmentPicker({
  fields,
  value,
  onChange,
}: {
  fields: CustomFieldOption[];
  value: CustomSegment[];
  onChange: (next: CustomSegment[]) => void;
}) {
  const [field, setField] = useState(fields[0] ? `${fields[0].entity}:${fields[0].key}` : "");
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  if (fields.length === 0) return null;
  const def = fields.find((f) => `${f.entity}:${f.key}` === field) ?? fields[0];

  function add() {
    let v: string | number | boolean;
    if (def.type === "boolean") v = raw !== "No";
    else if (def.type === "number" || def.type === "money") {
      const n = Number(raw.replace(/[$,]/g, ""));
      if (!raw.trim() || Number.isNaN(n)) {
        setError(`Type a number for ${def.label}.`);
        return;
      }
      v = def.type === "money" ? Math.round(n * 100) : n;
    } else if (!raw.trim()) {
      setError(`Choose a value for ${def.label}.`);
      return;
    } else v = raw.trim();
    setError(null);
    onChange([...value.filter((c) => !(c.entity === def.entity && c.key === def.key && c.value === v)), { entity: def.entity, key: def.key, value: v, label: def.label }]);
    setRaw("");
  }

  return (
    <div className="mt-2 rounded-[10px] border border-line p-2.5">
      <p className="text-[12px] font-bold text-muted">Custom field segment</p>
      <div className="mt-1 flex flex-wrap items-center gap-2">
        <select aria-label="Custom field" className="crm-input w-auto" value={field} onChange={(e) => setField(e.target.value)}>
          {fields.map((f) => (
            <option key={`${f.entity}:${f.key}`} value={`${f.entity}:${f.key}`}>
              {f.label} ({f.entity === "people" ? "a member" : "the household"})
            </option>
          ))}
        </select>
        {def.type === "boolean" ? (
          <select aria-label="Value" className="crm-input w-auto" value={raw || "Yes"} onChange={(e) => setRaw(e.target.value)}>
            <option value="Yes">Yes</option>
            <option value="No">No</option>
          </select>
        ) : def.type === "choice" ? (
          <select aria-label="Value" className="crm-input w-auto" value={raw} onChange={(e) => setRaw(e.target.value)}>
            <option value="">Choose…</option>
            {def.choices.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        ) : (
          <input aria-label="Value" className="crm-input w-auto" value={raw} onChange={(e) => setRaw(e.target.value)} />
        )}
        <button type="button" className={buttonClass("ghost", "xs")} onClick={add}>
          Add segment
        </button>
      </div>
      {error ? <p className="crm-hint text-danger">{error}</p> : null}
      {value.length ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((c) => (
            <button
              key={`${c.entity}:${c.key}:${String(c.value)}`}
              type="button"
              aria-pressed
              className="cc-chip min-h-[34px]"
              title="Remove this segment"
              onClick={() => onChange(value.filter((x) => x !== c))}
            >
              {c.label ?? c.key}: {c.value === true ? "Yes" : c.value === false ? "No" : String(c.value)} ×
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
