import { Alert, Card, StatusText, Tag } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { DEMO_EMAIL_DOMAIN } from "@/lib/demo-signin/rules";
import { nextStep, parseStatus } from "@/lib/demo-signin/status";
import { explainError } from "@/lib/errors";
import type { CrmSession } from "@/lib/session";

import { DemoSigninControls } from "./demo-signin-controls";

/**
 * Platform › Setup › Demo sign-in: the kill switch and what "Try the demo" needs. Off until a platform admin turns it on; turning it
 * off stops new demos at once and ends running ones (the database deletes their sign-in sessions, so they cannot be refreshed).
 */
export async function DemoSigninPanel({ session, tz }: { session: CrmSession; tz: string }) {
  const { data, error } = await session.db.rpc("demo_signin_status");
  const status = error ? null : parseStatus(data);
  if (error || !status) {
    if (error) console.error("[platform/setup] demo_signin_status failed:", error);
    return (
      <Card title="Demo sign-in" description="“Try the demo” on the website and the sign-in page">
        <Alert tone="danger" title="Could not load the demo sign-in">
          {error ? explainError(error) : "The server gave an answer we could not read"}. <a href="/platform/setup" className="font-bold underline">Try again</a>
        </Alert>
      </Card>
    );
  }
  const kinds = new Set(status.communities.map((c) => c.kind));
  const kindsMissing = (["faith", "neutral"] as const).filter((k) => !kinds.has(k));
  const allReady = status.peopleTotal > 0 && status.peopleReady >= status.peopleTotal;
  return (
    <Card
      title={
        <>
          Demo sign-in {status.enabled ? <Tag color="success">On</Tag> : <Tag color="muted">Off</Tag>}
        </>
      }
      description="“Try the demo” on the website and the sign-in page: anyone can explore a demo community as one of its demo people, with no code and no real email"
    >
      <div className="flex flex-col gap-3" data-testid="demo-signin-panel">
        <p className="text-[14px]" data-demo-state={status.enabled ? "on" : "off"}>
          <span className="font-bold">Status now: </span>
          <StatusText tone={status.enabled ? "ok" : "warn"}>{status.enabled ? "On — visitors can start a demo" : "Off — nobody can start a demo"}</StatusText>
          {status.changedAt ? (
            <span className="text-muted">
              {" "}
              · changed {formatDateTime(status.changedAt, tz)}
              {status.changedBy ? ` by ${status.changedBy}` : ""}
              {status.reason ? ` — “${status.reason}”` : ""}
            </span>
          ) : null}
        </p>
        <ul className="grid grid-cols-1 gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          <li>
            Demo communities: <b>{status.communities.length}</b>
            {status.communities.length ? ` (${status.communities.map((c) => c.name).join(", ")})` : ""}
          </li>
          <li>
            Sign-ins ready: <b>{status.peopleReady}</b> of <b>{status.peopleTotal}</b> demo people
          </li>
          <li>
            Running now: <b>{status.liveSessions}</b>
          </li>
          <li>
            Started in the last 24 hours: <b>{status.started24h}</b>
          </li>
        </ul>
        <p className="text-[13px]">
          <span className="font-bold">Next: </span>
          {nextStep(status)}
        </p>
        <DemoSigninControls
          enabled={status.enabled}
          allReady={allReady}
          anyReady={status.peopleReady > 0}
          kindsMissing={kindsMissing}
          communities={status.communities.map((c) => ({ id: c.id, name: c.name }))}
        />
        <p className="crm-hint">
          Each demo session lasts {status.hours} hours and is limited per visitor and for the whole platform. Demo people use addresses on {DEMO_EMAIL_DOMAIN} that nobody
          receives mail on; their passwords live in the vault and are never shown. A demo person sees only their own demo community, can never be a platform admin,
          and no text, email or push message is ever sent to them. Payments in the demo are always in test mode.
        </p>
      </div>
    </Card>
  );
}
