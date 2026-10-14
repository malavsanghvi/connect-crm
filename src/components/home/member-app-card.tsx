import Link from "next/link";

import { Card, EmptyState, buttonClass, capitalize, type BlockSpan } from "@/components/ui";
import { NO_MEMBER_APP_LINK, memberWorkIntro, type MemberWork } from "@/lib/home/member-work";

/**
 * Home "Your work is in the member app": for a person whose work is not in a staff queue (a family member, a membership reference, a
 * child). It says where the work is, links to the member app when its address is known (never a dead link when it is not), and
 * counts what waits there. Shared by the classic Home and by Today. A count that could not be read is a line that says so, with a
 * retry, never a silent zero.
 */
export function MemberAppCard({ work, span = 12 }: { work: MemberWork; span?: BlockSpan }) {
  const open = work.link ? (
    <a href={work.link} target="_blank" rel="noreferrer" className={buttonClass("primary", "sm")}>
      Open the member app
    </a>
  ) : null;

  return (
    <Card
      span={span}
      title="Your work is in the member app"
      description={work.state === "unlinked" ? "Your sign-in is not linked to a person in this community yet." : memberWorkIntro(work.adult)}
      actions={open}
    >
      {work.state === "unlinked" ? (
        <p className="text-[14px] text-ink">There is nothing to count here until your sign-in is linked. Open the member app to find your family and link your sign-in.</p>
      ) : (
        <>
          {work.problems.map((p) => (
            <div key={p.key} role="alert" className="mb-2 flex flex-wrap items-center gap-3 rounded-[10px] border border-danger/30 bg-danger-50 px-4 py-2.5 text-[13px] text-danger">
              <p className="min-w-0 flex-1 font-bold">{capitalize(p.text)}</p>
              <Link href="/" className={buttonClass("ghost", "sm")}>
                Try again
              </Link>
            </div>
          ))}
          {work.lines.length > 0 ? (
            <ul className="m-0 list-none p-0">
              {work.lines.map((l) => (
                <li key={l.key} className="border-b border-line-soft py-2.5 text-[15px] leading-snug text-ink last:border-b-0">
                  {l.text}
                </li>
              ))}
            </ul>
          ) : work.problems.length === 0 ? (
            <EmptyState title="Nothing is waiting for you right now." />
          ) : null}
        </>
      )}
      {work.link ? null : <p className="mt-3 text-[13px] text-muted">{NO_MEMBER_APP_LINK}</p>}
    </Card>
  );
}
