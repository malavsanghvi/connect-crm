import type { Metadata } from "next";

import { NoAccess, PageHeader } from "@/components/ui";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";
import { NOTIFICATION_TRIGGERS, readNotificationSettings, readRuleSettings, rulesVersion } from "@/lib/settings-rules";

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
    </>
  );
}
