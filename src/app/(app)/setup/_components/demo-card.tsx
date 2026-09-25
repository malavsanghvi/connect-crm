import Link from "next/link";

import { Card, StatusText, buttonClass } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";
import { DEMO_STATUS_LABEL, demoStatus, isDemoBusy } from "@/lib/demo";
import type { CrmSession } from "@/lib/session";

/**
 * The Setup home's Demo data card (o-demo): sandboxes only. It reads its own
 * state so the checklist page needs a single line to show it.
 */
export async function DemoDataCard({ session }: { session: CrmSession }) {
  if (session.center.environment !== "sandbox") return null;
  const { db, center } = session;
  const { data, error } = await db.from("center_demo_state").select("status, loaded_at, cleared_at, last_error").eq("center_id", center.id).maybeSingle();
  if (error) console.error("[setup] could not load the demo data state:", error);
  const status = demoStatus(data?.status);
  return (
    <div className="mb-4" data-testid="setup-demo-card">
      <Card
        title="Demo data"
        description="Fill this sandbox with a demo community to try every module; reset it or clear it at any time. Not available once you are live."
        actions={
          <Link href="/setup/demo" className={buttonClass("ghost", "sm")}>
            Open Demo data
          </Link>
        }
      >
        <p className="text-[13px]">
          {error ? (
            <StatusText tone="warn">Could not load the demo data status — open Demo data to see it.</StatusText>
          ) : (
            <StatusText tone={status === "loaded" ? "ok" : status === "failed" ? "bad" : "warn"}>{DEMO_STATUS_LABEL[status]}</StatusText>
          )}
          {data?.loaded_at && status === "loaded" ? <span className="text-muted"> · loaded {formatDateTime(data.loaded_at, center.time_zone)}</span> : null}
          {isDemoBusy(status) ? <span className="text-muted"> · running in the background</span> : null}
        </p>
      </Card>
    </div>
  );
}
