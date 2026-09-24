import { CustomFieldsEditor } from "@/components/custom-fields-editor";
import { customRows, formatCustomValue, type CustomFieldDef } from "@/lib/custom-fields";

/**
 * "More details" for one row of a record table (a membership, pledge or
 * payment): a disclosure with the row's custom fields, editable in place.
 */
export function CustomDetailsCell({
  defs,
  entity,
  recordId,
  custom,
  editable,
  currency,
}: {
  defs: readonly CustomFieldDef[];
  entity: string;
  recordId: string;
  custom: unknown;
  editable: boolean;
  currency: string;
}) {
  const rows = customRows(defs, custom);
  if (rows.length === 0) return <span className="text-muted">—</span>;
  const filled = rows.filter((r) => r.value !== undefined && r.value !== null && r.value !== "");
  const summary = filled.length
    ? filled
        .slice(0, 2)
        .map((r) => `${r.def.label}: ${formatCustomValue(r.def, r.value, currency)}`)
        .join(" · ")
    : "More details";
  return (
    <details className="min-w-[220px] text-[0.8125rem]">
      <summary className="cursor-pointer text-navy">{summary}</summary>
      <div className="mt-2">
        <CustomFieldsEditor rows={rows} entity={entity} recordId={recordId} editable={editable} currency={currency} />
      </div>
    </details>
  );
}
