"use client";

import { useState, type ReactNode } from "react";

import { ActionForm, type FormAction } from "@/components/action-form";
import { Drawer } from "@/components/drawer";
import { buttonClass, type ButtonSize, type ButtonVariant } from "@/components/ui";

/**
 * A pill button that opens the right-hand drawer with one form in it
 * (New goal, New album, New version…). The form's fields are the children;
 * errors show beside the form, success as a toast.
 */
export function DrawerForm({
  label,
  variant = "primary",
  size = "md",
  kicker,
  title,
  subtitle,
  action,
  submitLabel,
  resetOnSuccess = true,
  confirmMessage,
  intro,
  children,
}: {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  kicker?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  action: FormAction;
  submitLabel: string;
  resetOnSuccess?: boolean;
  confirmMessage?: string;
  /** Shown above the form (may hold its own forms, e.g. per-row remove buttons). */
  intro?: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={buttonClass(variant, size)}>
        {label}
      </button>
      <Drawer open={open} onClose={() => setOpen(false)} kicker={kicker} title={title} subtitle={subtitle}>
        {intro ? <div className="mb-4">{intro}</div> : null}
        <ActionForm action={action} submitLabel={submitLabel} resetOnSuccess={resetOnSuccess} confirmMessage={confirmMessage}>
          <div className="mb-3 flex flex-col gap-3">{children}</div>
        </ActionForm>
      </Drawer>
    </>
  );
}
