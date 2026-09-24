"use client";

import { ActionForm, type FormAction } from "@/components/action-form";
import type { ButtonSize, ButtonVariant } from "@/components/ui";

/** One pill button bound to a Server Action, with hidden fields and an optional confirmation. */
export function ActionButton({
  action,
  label,
  fields,
  variant = "ghost",
  size = "xs",
  confirm,
  confirmKicker,
  pendingLabel,
}: {
  action: FormAction;
  label: string;
  fields?: Record<string, string>;
  variant?: ButtonVariant;
  size?: ButtonSize;
  confirm?: string;
  confirmKicker?: string;
  pendingLabel?: string;
}) {
  return (
    <ActionForm
      action={action}
      submitLabel={label}
      pendingLabel={pendingLabel ?? "Working…"}
      variant={variant}
      size={size}
      confirmMessage={confirm}
      confirmKicker={confirmKicker}
      className="inline-block max-w-full align-middle"
    >
      {fields ? Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />) : null}
    </ActionForm>
  );
}
