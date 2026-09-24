import Link from "next/link";

import { approveCampaignAction } from "@/app/(app)/comms/actions";
import { RowActions } from "@/components/row-actions";
import { Card, QueryError, Tag, buttonClass, type TagColor } from "@/components/ui";
import { describeAudience } from "@/lib/comms";
import { userNames } from "@/lib/data/lookups";
import type { DbErrorLike } from "@/lib/errors";
import { can } from "@/lib/permissions";
import type { CrmSession } from "@/lib/session";

type Task = { key: string; tag: string; color: TagColor; title: string; meta: string; actions: React.ReactNode };

function ageInDays(iso: string, now: Date): number {
  return Math.floor((now.getTime() - new Date(iso).getTime()) / 86_400_000);
}

/**
 * Home tasks for Communications and Content (prototype Home, AdminPortal
 * L497–499): newsletters to approve, unassigned member questions, WhatsApp
 * join requests, content awaiting approval. Rendered only when there is
 * something to do or a read failed.
 */
export async function CommsContentTasks({ session }: { session: CrmSession }) {
  const { db, center } = session;
  const approver = can(session, "comms.approve");
  const inbox = can(session, "comms.inbox");
  const whatsapp = can(session, ["comms.view", "comms.send"]);
  const contentApprover = can(session, "content.approve");
  if (!approver && !inbox && !whatsapp && !contentApprover) return null;

  const [campaigns, threads, joins, items, photos] = await Promise.all([
    approver
      ? db.from("comms_campaigns").select("id, name, title, audience, approved_by, status, created_by").eq("center_id", center.id).in("status", ["draft", "pending_approval"]).order("created_at").limit(10)
      : null,
    inbox ? db.from("threads").select("id, created_at").eq("center_id", center.id).is("assignee_user", null).neq("status", "closed").order("created_at").limit(500) : null,
    whatsapp ? db.from("whatsapp_join_requests").select("id", { count: "exact", head: true }).eq("center_id", center.id).in("status", ["pending", "approved"]) : null,
    contentApprover ? db.from("content_items").select("id", { count: "exact", head: true }).eq("center_id", center.id).eq("status", "in_review") : null,
    contentApprover && can(session, "content.manage") ? db.from("photos").select("id, contains_children", { count: "exact" }).eq("center_id", center.id).eq("status", "pending").limit(500) : null,
  ]);
  const error: DbErrorLike | null = campaigns?.error ?? threads?.error ?? joins?.error ?? items?.error ?? photos?.error ?? null;
  const [drafters, zones] = await Promise.all([
    userNames(db, center.id, (campaigns?.data ?? []).map((c) => c.created_by)),
    (campaigns?.data ?? []).length ? db.from("zones").select("id, name").eq("center_id", center.id) : null,
  ]);
  const zoneNames = new Map((zones?.data ?? []).map((z) => [z.id, z.name]));
  const now = new Date();
  const tasks: Task[] = [];

  for (const c of campaigns?.data ?? []) {
    if (c.status === "pending_approval" && c.approved_by === session.userId) continue;
    const label = c.name || c.title;
    tasks.push({
      key: `nl-${c.id}`,
      tag: "Newsletter",
      color: "purple",
      title: `Approve “${label}”`,
      meta: `${describeAudience(c.audience, { zones: zoneNames })} · drafted by ${c.created_by === session.userId ? "you" : (drafters.get(c.created_by ?? "")?.name ?? "a colleague")}${c.status === "pending_approval" ? " · needs a second approver" : ""}`,
      actions: (
        <div className="flex flex-wrap items-center justify-end gap-2">
          <RowActions action={approveCampaignAction} fields={{ id: c.id }} buttons={[{ label: "Approve", value: "approve", variant: "ok", confirm: `Approve “${label}”?` }]} />
          <Link href={`/comms/campaigns/${c.id}`} className={buttonClass("ghost", "xs")}>
            Open
          </Link>
        </div>
      ),
    });
  }
  const q = threads?.data ?? [];
  if (q.length > 0) {
    const oldest = ageInDays(q[0].created_at, now);
    tasks.push({
      key: "inbox",
      tag: "Inbox",
      color: "success",
      title: `${q.length}${q.length === 500 ? "+" : ""} unassigned member question${q.length === 1 ? "" : "s"}`,
      meta: `Oldest ${oldest <= 0 ? "today" : `${oldest} day${oldest === 1 ? "" : "s"}`} · reply target 3–5 business days`,
      actions: (
        <Link href="/comms/inbox" className={buttonClass("ghost", "xs")}>
          Open
        </Link>
      ),
    });
  }
  if (joins?.count) {
    tasks.push({
      key: "wa",
      tag: "WhatsApp",
      color: "success",
      title: `${joins.count} WhatsApp join request${joins.count === 1 ? "" : "s"}`,
      meta: "Add members to groups by phone number",
      actions: (
        <Link href="/comms/whatsapp" className={buttonClass("ghost", "xs")}>
          Open
        </Link>
      ),
    });
  }
  const waitingItems = items?.count ?? 0;
  const waitingPhotos = photos?.count ?? 0;
  if (waitingItems + waitingPhotos > 0) {
    const children = (photos?.data ?? []).some((p) => p.contains_children);
    tasks.push({
      key: "content",
      tag: "Content",
      color: "purple",
      title: `${waitingItems + waitingPhotos} item${waitingItems + waitingPhotos === 1 ? "" : "s"} awaiting approval`,
      meta: [waitingItems ? `${waitingItems} content item${waitingItems === 1 ? "" : "s"} (religious text needs an approver)` : null, waitingPhotos ? `${waitingPhotos} member photo${waitingPhotos === 1 ? "" : "s"}${children ? ", some with children" : ""}` : null]
        .filter(Boolean)
        .join(" · "),
      actions: (
        <Link href="/content/queue" className={buttonClass("ghost", "xs")}>
          Open
        </Link>
      ),
    });
  }
  if (tasks.length === 0 && !error) return null;

  return (
    <Card title="Communications and content" description="Tasks waiting on you" className="mt-4">
      {error ? <QueryError what="communications and content tasks" error={error} retryHref="/" /> : null}
      <div className="flex flex-col gap-1.5">
        {tasks.map((t) => (
          <div key={t.key} className="cc-kv flex-wrap">
            <span className="flex min-w-0 flex-1 items-start gap-2.5">
              <Tag color={t.color}>{t.tag}</Tag>
              <span className="min-w-0">
                <span className="block font-bold text-ink">{t.title}</span>
                <span className="block text-xs text-muted">{t.meta}</span>
              </span>
            </span>
            {t.actions}
          </div>
        ))}
      </div>
    </Card>
  );
}
