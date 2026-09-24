import type { ReactNode } from "react";

/** Bar colours from the prototype (design tokens in docs/ARCHITECTURE.md). */
export const BAR_COLOR = {
  saffron: "#C9731C",
  navy: "#1B2C5C",
  purple: "#5B4B8A",
  green: "#1F7A4D",
  stone: "#8A8478",
  brown: "#8A4608",
  maroon: "#7A2E1F",
  store: "#2F5D50",
} as const;
export type BarColor = keyof typeof BAR_COLOR;

export type BarItem = {
  label: string;
  /** Bar width, 0–100. */
  percent: number;
  /** Text at the right end of the row (amount, count, "41%"). */
  value: ReactNode;
  color?: BarColor;
};

/**
 * The prototype's "bars" block (AdminPortal L169): a 170px label, a 14px
 * rounded track (#F1E8D8) with a coloured fill, and a bold value on the right.
 * The value is always text, so nothing is shown by colour alone.
 */
export function BarList({ items, labelWidth = 170, empty }: { items: BarItem[]; labelWidth?: number; empty?: ReactNode }) {
  if (items.length === 0) return <p className="cc-empty">{empty ?? "Nothing to show yet."}</p>;
  return (
    <ul className="flex flex-col gap-2">
      {items.map((b, i) => (
        <li key={`${b.label}-${i}`} className="flex items-center gap-2.5 text-[13px]">
          <span className="truncate font-semibold text-ink" style={{ width: labelWidth, flex: "none" }} title={b.label}>
            {b.label}
          </span>
          <span
            className="h-3.5 min-w-0 flex-1 rounded-[7px] bg-[#F1E8D8]"
            role="img"
            aria-label={`${b.label}: ${Math.round(b.percent)}%`}
          >
            <span
              className="block h-3.5 rounded-[7px]"
              style={{ width: `${Math.max(0, Math.min(100, b.percent))}%`, background: BAR_COLOR[b.color ?? "navy"] }}
            />
          </span>
          <span className="w-[90px] flex-none text-right font-bold tabular-nums text-ink">{b.value}</span>
        </li>
      ))}
    </ul>
  );
}
