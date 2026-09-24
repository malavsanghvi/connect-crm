import { ActionForm, type FormAction } from "@/components/action-form";
import { buttonClass, type ButtonVariant } from "@/components/ui";

export type RowButton = { label: string; value: string; variant: ButtonVariant; confirm?: string };

/**
 * Right-aligned pill buttons for one table row (Return / Approve, Mark added,
 * Take it). Each button submits `<fieldName>=<value>` with the hidden fields.
 */
export function RowActions({
  action,
  fields,
  buttons,
  fieldName = "decision",
}: {
  action: FormAction;
  fields: Record<string, string>;
  buttons: RowButton[];
  /** Name of the field each button submits (default "decision"). */
  fieldName?: string;
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={buttons[0]?.label ?? "Save"}
      hideSubmit
      className="flex flex-col items-end"
      buttonsClassName="justify-end flex-nowrap"
      extraButtons={buttons.map((b) => (
        <button
          key={b.value}
          type="submit"
          name={fieldName}
          value={b.value}
          data-variant={b.variant}
          data-confirm={b.confirm}
          className={buttonClass(b.variant, "xs")}
        >
          {b.label}
        </button>
      ))}
    >
      {Object.entries(fields).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
    </ActionForm>
  );
}
