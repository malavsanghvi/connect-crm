"use client";

import type { ReactNode } from "react";

import { ActionForm, type FormAction } from "@/components/action-form";

/** "No changes" / "Save · 2 changes" (P2: dirty-state save buttons). */
export function saveLabel(base: string, dirty: number): string {
  if (dirty === 0) return "No changes";
  return `${base} · ${dirty} change${dirty === 1 ? "" : "s"}`;
}

/** Number of keys whose value differs between two flat records. */
export function countChanges(a: Record<string, unknown>, b: Record<string, unknown>): number {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  let n = 0;
  for (const k of keys) if (a[k] !== b[k]) n += 1;
  return n;
}

/**
 * A Settings form block's form: posts one rules section with the version it
 * was opened on, a right-aligned pill Save that reads "No changes" until
 * something changes, and errors in plain English beside it.
 */
export function SettingsForm({
  action,
  section,
  version,
  dirty,
  submitLabel = "Save",
  readOnly = false,
  readOnlyNote,
  children,
}: {
  action: FormAction;
  section?: string;
  version: number | null;
  dirty: number;
  submitLabel?: string;
  /** The viewer cannot save: controls stay visible, the button is replaced by `readOnlyNote`. */
  readOnly?: boolean;
  readOnlyNote?: ReactNode;
  children: ReactNode;
}) {
  if (readOnly) {
    return (
      <div>
        {children}
        {readOnlyNote ? <p className="mt-3 text-right text-[12px] text-muted">{readOnlyNote}</p> : null}
      </div>
    );
  }
  return (
    <ActionForm
      action={action}
      submitLabel={saveLabel(submitLabel, dirty)}
      pendingLabel="Saving…"
      submitDisabled={dirty === 0}
      buttonsClassName="mt-4 justify-end"
    >
      {section ? <input type="hidden" name="section" value={section} /> : null}
      <input type="hidden" name="version" value={version === null ? "" : String(version)} />
      {children}
    </ActionForm>
  );
}

/** The prototype's form field grid (fcols 2 by default, 1 on narrow screens). */
export function FieldGrid({ cols = 2, children }: { cols?: 1 | 2; children: ReactNode }) {
  return <div className={`grid grid-cols-1 gap-x-4 gap-y-3 ${cols === 2 ? "sm:grid-cols-2" : ""}`}>{children}</div>;
}

/** One labelled field (12/700 muted label over its control). `wide` spans both columns. */
export function SettingField({ label, hint, wide = false, children }: { label: string; hint?: ReactNode; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? "sm:col-span-2" : ""}>
      <p className="crm-label">{label}</p>
      {children}
      {hint ? <p className="crm-hint">{hint}</p> : null}
    </div>
  );
}
