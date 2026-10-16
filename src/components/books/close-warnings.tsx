import Link from "next/link";

import type { CloseWarning } from "@/lib/books/close";

/** The warning lines beside the month-end checklist: reminders, never checks. They do not stop the month from being locked. */
export function CloseWarningLines({ warnings }: { warnings: readonly CloseWarning[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="mt-3">
      <ul aria-label="Warnings" className="m-0 flex list-none flex-col gap-1.5 p-0">
        {warnings.map((w) => (
          <li key={w.key} className="flex flex-wrap items-baseline gap-x-2 rounded-field bg-warning-50 px-3 py-2 text-[13px] text-warning-ink">
            <span className="font-bold">Warning</span>
            <span>{w.label}</span>
            <Link href={w.href} className="crm-link font-semibold">
              Review
            </Link>
          </li>
        ))}
      </ul>
      <p className="m-0 mt-1 text-[12px] text-muted">Warnings do not stop you locking the month.</p>
    </div>
  );
}
