import type { CustomFieldDef } from "@/lib/custom-fields";
import type { RawSearchParams } from "@/lib/search-params";

/**
 * "Add a column" for a list: pick one custom field to show as a column. A GET
 * form, so the choice lives in the URL (?cf=<key>) and other filters are kept.
 */
export function CustomColumnPicker({ action, sp, defs, current }: { action: string; sp: RawSearchParams; defs: CustomFieldDef[]; current: string | null }) {
  if (defs.length === 0) return null;
  const keep = Object.entries(sp).filter(([k, v]) => k !== "cf" && k !== "page" && typeof v === "string") as [string, string][];
  return (
    <form method="get" action={action} className="flex items-center gap-2 text-[13px]">
      {keep.map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label htmlFor={`cf-${action}`} className="text-muted">
        Extra column
      </label>
      <select id={`cf-${action}`} name="cf" defaultValue={current ?? ""} className="crm-input min-h-[34px] w-auto py-1">
        <option value="">None</option>
        {defs.map((d) => (
          <option key={d.key} value={d.key}>
            {d.label}
          </option>
        ))}
      </select>
      <button type="submit" className="cc-btn cc-btn-ghost cc-btn-xs">
        Show
      </button>
    </form>
  );
}
