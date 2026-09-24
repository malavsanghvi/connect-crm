"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A table row that opens `href` when clicked anywhere, as the prototype's
 * rows do. Keep a real link or button in the row for keyboard users; clicks
 * on links, buttons and inputs inside the row are left alone.
 */
export function ClickableRow({ href, children, highlight = false }: { href: string; children: ReactNode; highlight?: boolean }) {
  const router = useRouter();
  return (
    <tr
      className="cursor-pointer"
      data-highlight={highlight ? "" : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
        router.push(href, { scroll: false });
      }}
    >
      {children}
    </tr>
  );
}
