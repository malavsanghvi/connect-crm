import type { Metadata } from "next";

import { NoAccess, PageHeader } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { NOTIFICATION_TRIGGERS, readNotificationSettings, readRuleSettings, rulesVersion } from "@/lib/settings-rules";

import { BlockGrid, Card, QueryError, StatusText } from "@/components/ui";
import { formatDateTime } from "@/lib/dates";

import { RecentMessages, TestSendCard } from "../_components/messaging-ui";
import { NotificationsForm } from "./notifications-form";

export const metadata: Metadata = { title: "Notifications · Settings" };

const LANGUAGE: Record<string, string> = { en: "English", gu: "Gujarati", hi: "Hindi" };

export default async function NotificationsPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Settings"
      description="Every automatic message, when it goes, and on which channel · members control topics and quiet hours"
    />
  );
  if (!canAccess(session, "centerSettings")) {
    return (
      <>
        {header}
        <NoAccess area="Notification rules" access="centerSettings" />
      </>
    );
  }
  const { db, center } = session;
  const rules = readRuleSettings(center.rules);

  // Languages come from the message templates on file (this center's and the platform defaults).
  const templates = await db.from("message_templates").select("language, center_id").or(`center_id.is.null,center_id.eq.${center.id}`);
  let languages: string;
  if (templates.error) {
    console.error("[settings/notifications] could not load message templates:", templates.error);
    languages = "Could not load the message templates — reload to try again";
  } else {
    const langs = [...new Set((templates.data ?? []).map((t) => LANGUAGE[t.language] ?? t.language))];
    languages = langs.length > 0 ? `${langs.join(", ")} templates` : "No message templates on file yet";
  }

  return (
    <>
      {header}
      <NotificationsForm
        triggers={NOTIFICATION_TRIGGERS.map((t) => ({ key: t.key, label: t.label, when: t.when(rules), channel: t.channel }))}
        initial={readNotificationSettings(center.rules)}
        version={rulesVersion(center.rules)}
        languages={languages}
        canEdit
      />
      <PushSection session={session} />
    </>
  );
}

/**
 * Push (ONBOARDING_PLAN §4 Step 1.6, o-messaging): the shared app holds the
 * Apple and Google credentials, so there is nothing technical to set up — a
 * test push to your own phone proves it (Setup › Push notifications).
 */
async function PushSection({ session }: { session: Awaited<ReturnType<typeof getSession>> }) {
  const devices = await session.db
    .from("push_devices")
    .select("id, platform, last_seen_at, invalid_at")
    .eq("user_id", session.userId)
    .order("last_seen_at", { ascending: false });
  const live = (devices.data ?? []).filter((d) => !d.invalid_at);
  return (
    <BlockGrid className="mt-4">
      <Card span={7} title="Push notifications" description="Members get pushes in the Community Connect app; they choose topics and quiet hours there">
        {devices.error ? (
          <QueryError what="your phones" error={devices.error} retryHref="/settings/notifications" />
        ) : live.length === 0 ? (
          <p className="text-[13px] text-muted">
            None of your phones is registered yet. Sign in to the Community Connect app on your phone and allow notifications, then send a test.
          </p>
        ) : (
          <ul className="text-[13px]">
            {live.map((d) => (
              <li key={d.id}>
                <StatusText tone="ok">{d.platform === "ios" ? "iPhone" : d.platform === "android" ? "Android phone" : "Web"}</StatusText>
                <span className="text-muted"> · last seen {formatDateTime(d.last_seen_at, session.center.time_zone)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <TestSendCard channel="push" title="Send a test push" hint="To your own phones" canSend={canAccess(session, "messagingTest")} />
      <RecentMessages session={session} channels={["push"]} title="Recent pushes" />
    </BlockGrid>
  );
}
