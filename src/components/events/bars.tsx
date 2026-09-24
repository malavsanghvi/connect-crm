import type { ReactNode } from "react";

export type BarItem = { label: string; value: ReactNode; ratio: number; tone?: "navy" | "purple" | "danger" | "success" };

const FILL = { navy: "bg-navy", purple: "bg-purple", danger: "bg-danger", success: "bg-success" } as const;

/**
 * Horizontal bars, as the prototype's "bars" block: label, a 12px rounded
 * track (#F1E8D8) with a coloured fill, and the value on the right.
 */
export function BarList({ items, labelWidth = "11rem" }: { items: BarItem[]; labelWidth?: string }) {
  return (
    <ul className="flex flex-col gap-2.5">
      {items.map((b) => (
        <li key={b.label} className="grid items-center gap-3" style={{ gridTemplateColumns: `minmax(0, ${labelWidth}) 1fr auto` }}>
          <span className="truncate text-[13px] font-bold text-ink" title={b.label}>
            {b.label}
          </span>
          <span className="h-3 overflow-hidden rounded-full bg-track" aria-hidden>
            <span className={`block h-full rounded-full ${FILL[b.tone ?? "navy"]}`} style={{ width: `${Math.max(0, Math.min(1, b.ratio)) * 100}%` }} />
          </span>
          <span className="min-w-[3rem] text-right text-[13px] font-bold tabular-nums text-ink">{b.value}</span>
        </li>
      ))}
    </ul>
  );
}
