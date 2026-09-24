"use client";

import { useRouter } from "next/navigation";
import type { ReactNode } from "react";

/**
 * A table row that opens `href` when clicked anywhere (the prototype's row
 * click). Keep a real link inside the row for keyboard and screen-reader
 * users; clicks on links, buttons and form controls inside are left alone.
 */
export function ClickableRow({ href, children, highlight = false }: { href: string; children: ReactNode; highlight?: boolean }) {
  const router = useRouter();
  return (
    <tr
      className="cursor-pointer"
      data-highlight={highlight ? "" : undefined}
      onClick={(e) => {
        if ((e.target as HTMLElement).closest("a, button, input, select, textarea, label")) return;
        router.push(href);
      }}
    >
      {children}
    </tr>
  );
}
