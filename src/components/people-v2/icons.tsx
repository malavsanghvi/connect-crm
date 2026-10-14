import { useId } from "react";

/** The board's two-star sparkle in Niva's sun gradient (decorative). */
export function SparkIcon({ size = 22 }: { size?: number }) {
  const gid = `pv2-spark-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#FFB82A" />
          <stop offset="1" stopColor="#FF7640" />
        </linearGradient>
      </defs>
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" fill={`url(#${gid})`} />
    </svg>
  );
}

export function SendIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 11l18-8-8 18-2-8z" />
    </svg>
  );
}

/** The outline sparkle the board puts before "Niva noticed". */
export function SparkOutline() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z" />
    </svg>
  );
}
