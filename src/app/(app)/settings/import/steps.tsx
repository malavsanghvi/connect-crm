/** The import tool's six steps (ONBOARDING_PLAN Steps 3–5), as a numbered strip. */
export const IMPORT_STEPS = ["Upload", "Map", "Check", "Preview", "Import", "Reconcile"] as const;
export type ImportStep = (typeof IMPORT_STEPS)[number];

export function ImportSteps({ current, done = [] }: { current: ImportStep; done?: readonly ImportStep[] }) {
  return (
    <ol aria-label="Import steps" className="mb-4 flex flex-wrap gap-1.5">
      {IMPORT_STEPS.map((s, i) => {
        const isCurrent = s === current;
        const isDone = done.includes(s) || IMPORT_STEPS.indexOf(current) > i;
        return (
          <li
            key={s}
            aria-current={isCurrent ? "step" : undefined}
            className={`inline-flex min-h-[34px] items-center gap-2 rounded-full border px-3 text-[13px] ${
              isCurrent ? "border-navy bg-navy font-bold text-white" : isDone ? "border-success/40 bg-success-50 text-success-900" : "border-line bg-white text-muted"
            }`}
          >
            <span aria-hidden className="font-mono text-[11px]">
              {isDone && !isCurrent ? "✓" : i + 1}
            </span>
            {s}
            {isDone && !isCurrent ? <span className="sr-only"> (done)</span> : null}
          </li>
        );
      })}
    </ol>
  );
}
