import Link from "next/link";

import { Alert, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import { STEP_BY_KEY, isStepKey, setupComplete } from "@/lib/platform-setup/catalog";
import { loadStepRows } from "@/lib/platform-setup/view";
import type { CrmSession } from "@/lib/session";

/** Platform home: what is left of the platform setup, and every parked step as a reminder. */
export async function SetupReminder({ session }: { session: CrmSession }) {
  const { rows, error } = await loadStepRows(session);
  if (error) {
    return (
      <div className="mb-4">
        <Alert tone="danger" title="Could not load the platform setup status">
          {error}. <Link href="/platform/setup" className="font-bold underline">Open Platform setup</Link>
        </Alert>
      </div>
    );
  }
  const complete = setupComplete(rows);
  const parked = rows.filter((r) => r.status === "parked");
  const requiredOpen = rows.filter((r) => r.required && r.status !== "done");
  if (complete && parked.length === 0) return null;
  const title = (k: string) => (isStepKey(k) ? STEP_BY_KEY[k].title : k);
  return (
    <div className="mb-4" data-setup-reminder>
      <Alert
        tone={requiredOpen.length > 0 ? "warning" : "info"}
        title={requiredOpen.length > 0 ? "Platform setup is not finished" : `${parked.length} platform setup step${parked.length === 1 ? " is" : "s are"} parked`}
        action={
          <Link href="/platform/setup" className={buttonClass("ghost", "xs")}>
            Open Platform setup
          </Link>
        }
      >
        {requiredOpen.length > 0 ? <p>Still required: {requiredOpen.map((r) => title(r.key)).join(", ")}.</p> : null}
        {parked.length > 0 ? (
          <ul className="mt-1 list-disc pl-5">
            {parked.map((r) => (
              <li key={r.key}>
                <Link href={`/platform/setup?step=${r.key}`} className="font-bold underline">
                  {title(r.key)}
                </Link>{" "}
                — parked {formatDate(r.parked_at, session.center.time_zone)}
                {r.note ? ` (“${r.note}”)` : ""}
              </li>
            ))}
          </ul>
        ) : null}
      </Alert>
    </div>
  );
}
