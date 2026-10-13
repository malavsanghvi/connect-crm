// A receipt drawn line by line (the template preview's look): the copy of one receipt on the Statements tab and the printable
// page. No hooks, so the server draws it.

import type { ReceiptPreviewLine } from "@/lib/giving";

const TONE = { navy: "text-navy", ink: "text-ink", muted: "text-muted" } as const;

export function ReceiptPreview({ lines, className = "" }: { lines: readonly ReceiptPreviewLine[]; className?: string }) {
  return (
    <div className={`rounded-[14px] border border-line bg-white px-4 py-3 ${className}`} data-testid="receipt-copy-preview">
      {lines.map((l, i) => (
        <p key={i} className={`m-0 py-0.5 text-[14px] leading-[1.5] ${TONE[l.tone]} ${l.strong ? "font-bold" : ""}`}>
          {l.text}
        </p>
      ))}
    </div>
  );
}
