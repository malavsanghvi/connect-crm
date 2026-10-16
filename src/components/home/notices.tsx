import { Alert } from "@/components/ui";
import type { HomeNotice } from "@/lib/home/notices";

/**
 * Things the Weaver team did that the organization's owner should know, at the top of Home and Today (src/lib/home/notices.ts).
 * Each is a plain title and a few sentences; the tone says whether it is news or a notice that could not be checked.
 */
export function HomeNotices({ notices }: { notices: readonly HomeNotice[] }) {
  if (notices.length === 0) return null;
  return (
    <div className="col-span-12 flex flex-col gap-3" data-testid="home-notices">
      {notices.map((n) => (
        <div key={n.key} data-notice={n.key}>
          <Alert tone={n.tone} title={n.title}>
            {n.lines.map((line) => (
              <p key={line} className="mt-1 first:mt-0">
                {line}
              </p>
            ))}
          </Alert>
        </div>
      ))}
    </div>
  );
}
