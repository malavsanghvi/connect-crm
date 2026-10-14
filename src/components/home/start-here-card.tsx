import Link from "next/link";

import { Card, buttonClass, capitalize, type BlockSpan } from "@/components/ui";
import type { StartHere } from "@/lib/home/start-here";

/**
 * Home "Start here": for a person who holds a screen but no staff queue and no other card. One plain sentence naming the screen, a button to it,
 * and what waits there where a count is cheap. A count that could not be read is a line that says so, with a retry, never a silent zero.
 * Shared by the classic Home and by Today.
 */
export function StartHereCard({ start, span = 12 }: { start: StartHere; span?: BlockSpan }) {
  const hasBody = start.lines.length > 0 || start.problems.length > 0;
  return (
    <Card
      span={span}
      title="Start here"
      description={start.sentence}
      padded={hasBody}
      actions={
        <Link href={start.href} className={buttonClass("primary", "sm")}>
          Open {start.screen}
        </Link>
      }
    >
      {hasBody ? (
        <>
          {start.problems.map((p) => (
            <div key={p} role="alert" className="mb-2 flex flex-wrap items-center gap-3 rounded-[10px] border border-danger/30 bg-danger-50 px-4 py-2.5 text-[13px] text-danger">
              <p className="min-w-0 flex-1 font-bold">{capitalize(p)}</p>
              <Link href="/" className={buttonClass("ghost", "sm")}>
                Try again
              </Link>
            </div>
          ))}
          {start.lines.length > 0 ? (
            <ul className="m-0 list-none p-0">
              {start.lines.map((l) => (
                <li key={l} className="border-b border-line-soft py-2.5 text-[15px] leading-snug text-ink last:border-b-0">
                  {l}
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}
