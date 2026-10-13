import type { Metadata } from "next";

import { BlockGrid, Card, InfoBox, NoAccess, PageHeader, QueryError } from "@/components/ui";
import { communityMajority } from "@/lib/commands/child-filter";
import { loadCommunityLocale } from "@/lib/community-locale";
import { languageLabel } from "@/lib/languages";
import { factValues, sampleValues, type EmailFacts } from "@/lib/merge/build";
import { TRIGGER_INFO, isEmailTrigger, type EmailTrigger } from "@/lib/merge/catalogue";
import { canAccess } from "@/lib/permissions";
import { getSession } from "@/lib/session";

import { AutomaticEmailCard, type EmailCardData } from "./email-card";
import { EmailLog, type LogRow } from "./email-log";
import { ScheduledEmails } from "./schedules-section";

export const metadata: Metadata = { title: "Automatic emails · Settings" };

// Settings › Automatic emails. 0770: a receipt for a payment, a pledge confirmation and a registration confirmation. Each is
// off until someone who manages it switches it on; each has the community's own wording with placeholders filled from the
// record, a preview from the most recent real record, a test to yourself and a log of what was sent. 0771: scheduled emails to
// an audience the community chooses (Communications and Giving). Rows follow their module and the reader's permissions; the
// database enforces both.

type StateRow = {
  key: string;
  title: string;
  module: string;
  module_on: boolean;
  can_view: boolean;
  can_edit?: boolean;
  enabled?: boolean;
  options?: { uploaded?: boolean } | null;
  wording?: { language: string; subject: string | null; body: string; version: number }[];
  standard?: { subject: string | null; body: string } | null;
  week?: { queued?: number; skipped?: number } | null;
  approval?: { ok?: boolean; detail?: string } | null;
  sample?: EmailFacts | null;
};

const MODULE_LABEL: Record<string, string> = { giving: "Giving", events: "Events & RSVP" };

export default async function AutomaticEmailsPage() {
  const session = await getSession();
  const header = (
    <PageHeader
      title="Settings"
      description="Receipts, pledge confirmations, registration confirmations and scheduled emails · when each goes, in your own words, with the record's details filled in"
    />
  );
  if (!canAccess(session, "automaticEmails")) {
    return (
      <>
        {header}
        <NoAccess area="Automatic emails" access="automaticEmails" />
      </>
    );
  }
  const { db, center } = session;
  const [state, locale] = await Promise.all([
    db.rpc("email_automations_state", { p_center: center.id, p_majority: communityMajority(center) }),
    loadCommunityLocale(db, center),
  ]);
  // Someone who may only write scheduled emails reads none of the three automatic emails: that is not an error.
  const noTriggerAccess = state.error?.code === "42501";
  if (state.error && !noTriggerAccess) {
    return (
      <>
        {header}
        <QueryError what="the automatic emails" error={state.error} retryHref="/settings/automatic-emails" />
      </>
    );
  }
  const rows = noTriggerAccess ? [] : (((state.data ?? {}) as { emails?: StateRow[] }).emails ?? []).filter((r) => isEmailTrigger(r.key) && r.can_view);
  const logs = await Promise.all(
    rows.map((r) => (r.module_on ? db.rpc("email_automation_log", { p_center: center.id, p_key: r.key, p_limit: 10 }) : Promise.resolve({ data: [], error: null }))),
  );
  const languageCodes = (extra: string[]) => [...new Set([...locale.languages, ...extra])].map((c) => ({ code: c, label: languageLabel(c) }));

  return (
    <>
      {header}
      <BlockGrid>
        <Card span={12} title="How automatic emails work">
          <InfoBox>
            Each email is <strong>off</strong> until someone who manages it switches it on, and then goes for each new record only. It goes to adults:
            the person who paid, pledged or registered, else the household&apos;s adults with an email address; a child&apos;s name is never in it.
            Placeholders such as {"{{payment_amount}}"} are filled from the record, in {center.currency} and your community&apos;s way of writing dates.
            Receipts and pledge confirmations go only while the treasurer&apos;s approval of the receipt templates is current. Members who unsubscribed
            from newsletters still get receipts; a member who switched off event or giving emails in the app gets no registration or scheduled email.
          </InfoBox>
        </Card>
        {rows.map((r, i) => {
          const key = r.key as EmailTrigger;
          if (!r.module_on) {
            return (
              <Card key={key} span={12} title={r.title}>
                <p className="text-[13px] text-muted">The {MODULE_LABEL[r.module] ?? r.module} module is switched off for this community, so this email is not sent.</p>
              </Card>
            );
          }
          const email: EmailCardData = {
            key,
            title: r.title,
            when: TRIGGER_INFO[key].when,
            enabled: !!r.enabled,
            uploaded: key === "payment_receipt" ? !!r.options?.uploaded : null,
            canEdit: !!r.can_edit,
            approval: r.approval ? { ok: !!r.approval.ok, detail: r.approval.detail ?? "" } : null,
            wordings: (r.wording ?? []).map((w) => ({ language: w.language, subject: w.subject ?? "", body: w.body, version: w.version })),
            standard: r.standard ? { subject: r.standard.subject ?? "", body: r.standard.body } : null,
            languages: languageCodes((r.wording ?? []).map((w) => w.language)),
            values: r.sample ? factValues(key, r.sample, null) : sampleValues(key),
            realSample: !!r.sample,
            week: { queued: Number(r.week?.queued) || 0, skipped: Number(r.week?.skipped) || 0 },
          };
          const log = logs[i];
          return (
            <AutomaticEmailCard
              key={key}
              email={email}
              log={<EmailLog rows={(log?.data ?? []) as LogRow[]} error={log?.error ?? null} timeZone={center.time_zone} />}
            />
          );
        })}
        <ScheduledEmails session={session} languages={languageCodes([])} locale={locale.locale} />
      </BlockGrid>
    </>
  );
}
