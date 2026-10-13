import { ActionForm } from "@/components/action-form";
import { Card, InfoBox, QueryError, StatusText } from "@/components/ui";
import { adultHouseholdCards } from "@/lib/commands/catalog/household";
import { communityMajority } from "@/lib/commands/child-filter";
import type { HouseholdCard } from "@/lib/commands/types";
import { formatDateTime, todayInTz } from "@/lib/dates";
import { scheduleValues, type ScheduleFacts } from "@/lib/merge/build";
import { AUDIENCE_INFO, isScheduleAudience } from "@/lib/merge/catalogue";
import { isFrequency, scheduleSentence } from "@/lib/merge/schedule";
import type { CrmSession } from "@/lib/session";

import { approveScheduleAction, pauseScheduleAction } from "./actions";
import { EmailLog, type LogRow } from "./email-log";
import { ScheduleEditor, suggestedWording, type ScheduleFormData } from "./schedule-editor";

// Settings › Automatic emails › Scheduled emails (0771): the community's own email to an audience it chooses, at a set
// frequency, with each household's pledges or gifts merged in. Written with comms.send, switched on with comms.approve (both
// with giving.view or giving.manage); a change to one that is on makes it a draft again. The dry run and three households
// (shown as household cards, never by name alone) say who it would go to now.

type Preview = {
  households?: number;
  adults?: number;
  would_send?: number;
  skipped?: { no_email?: number; switched_off?: number; unsubscribed?: number };
  sample_households?: string[];
  sample?: ScheduleFacts | null;
  error?: string;
};

type ScheduleRow = {
  id: string;
  name: string;
  audience: string;
  params: { days?: number; since?: string | null; include_imported?: boolean } | null;
  frequency: string;
  day_of_week: number | null;
  day_of_month: number | null;
  month: number | null;
  hour: number;
  status: "draft" | "active" | "paused";
  approved_at: string | null;
  approved_by_name: string | null;
  next_run_at: string | null;
  run_period: string | null;
  last_run_at: string | null;
  last_run: { period?: string; queued?: number; skipped?: number; not_run?: string; at?: string } | null;
  wording: { language: string; subject: string | null; body: string; version: number }[];
  preview: Preview | null;
  week: { queued?: number; skipped?: number } | null;
};

type State = {
  can_view: boolean;
  modules_on: boolean;
  modules_message?: string;
  can_edit?: boolean;
  can_approve?: boolean;
  time_zone?: string;
  schedules: ScheduleRow[];
};

const STATUS: Record<ScheduleRow["status"], { label: string; tone: "ok" | "warn" | "bad" }> = {
  active: { label: "On", tone: "ok" },
  draft: { label: "Draft · not switched on", tone: "warn" },
  paused: { label: "Paused", tone: "warn" },
};

function n(v: unknown): number {
  return Number(v) || 0;
}

function dryRunSentence(p: Preview | null): string {
  if (!p) return "";
  if (p.error) return `Could not check who it would go to — ${p.error}`;
  const parts = [
    n(p.skipped?.no_email) ? `${n(p.skipped?.no_email)} household${n(p.skipped?.no_email) === 1 ? "" : "s"} with no email address` : null,
    n(p.skipped?.switched_off) ? `${n(p.skipped?.switched_off)} switched giving emails off` : null,
    n(p.skipped?.unsubscribed) ? `${n(p.skipped?.unsubscribed)} unsubscribed or opted out` : null,
  ].filter(Boolean);
  return `Now it would go to ${n(p.would_send)} adult${n(p.would_send) === 1 ? "" : "s"} in ${n(p.households)} household${n(p.households) === 1 ? "" : "s"}${parts.length ? ` (not sent: ${parts.join(", ")})` : ""}`;
}

function Cards({ cards }: { cards: HouseholdCard[] }) {
  if (cards.length === 0) return null;
  return (
    <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
      {cards.map((c) => (
        <div key={c.household_id} className="rounded-lg border border-line bg-white px-3 py-2 text-[13px]">
          <p className="font-semibold text-ink">{c.household_name ?? "Unnamed household"}</p>
          <p className="text-muted">
            {[c.household_number, c.org_household_id, c.city].filter(Boolean).join(" · ") || "No number or city on file"}
          </p>
          <p className="text-muted">{c.adults.length ? `Adults: ${c.adults.join(", ")}` : "No adults on file"}</p>
        </div>
      ))}
    </div>
  );
}

export async function ScheduledEmails({ session, languages, locale }: { session: CrmSession; languages: { code: string; label: string }[]; locale: string }) {
  const { db, center } = session;
  const majority = communityMajority(center);
  const res = await db.rpc("email_schedules_state", { p_center: center.id, p_majority: majority });
  if (res.error) {
    return (
      <Card span={12} title="Scheduled emails">
        <QueryError what="the scheduled emails" error={res.error} retryHref="/settings/automatic-emails" />
      </Card>
    );
  }
  const st = (res.data ?? { can_view: false, modules_on: false, schedules: [] }) as State;
  if (!st.can_view) {
    return (
      <Card span={12} title="Scheduled emails">
        <p className="text-[13px] text-muted">
          You don&apos;t have access to scheduled emails: they need a Communications permission (comms.view, comms.send or comms.approve) and giving.view
          or giving.manage, because they say what households pledged or gave.
        </p>
      </Card>
    );
  }
  if (!st.modules_on) {
    return (
      <Card span={12} title="Scheduled emails">
        <p className="text-[13px] text-muted">{st.modules_message ?? "Scheduled emails need the Communications and Giving modules."}</p>
      </Card>
    );
  }

  const tz = st.time_zone ?? center.time_zone;
  const ids = [...new Set(st.schedules.flatMap((s) => s.preview?.sample_households ?? []))];
  let cards = new Map<string, HouseholdCard>();
  let cardsError: unknown = null;
  if (ids.length > 0) {
    try {
      const out = await adultHouseholdCards(db, ids, { today: todayInTz(tz), currency: center.currency, majority });
      cards = new Map(out.cards.map((c) => [c.household_id, c]));
    } catch (error) {
      console.error("[settings/automatic-emails] could not read the household cards:", error);
      cardsError = error;
    }
  }
  const logs = await Promise.all(st.schedules.map((s) => db.rpc("email_schedule_log", { p_center: center.id, p_id: s.id, p_limit: 10 })));
  const main = languages[0]?.code ?? "en";
  const blank = suggestedWording("pledges_due_soon");
  const fresh: ScheduleFormData = {
    id: null,
    name: "Pledge reminder",
    audience: "pledges_due_soon",
    days: 7,
    since: "",
    includeImported: false,
    frequency: "weekly",
    dayOfWeek: 1,
    dayOfMonth: 1,
    month: 1,
    hour: 9,
    language: main,
    subject: blank.subject,
    body: blank.body,
  };

  return (
    <>
      <Card span={12} title="Scheduled emails" description={`Your own email to the households you choose, on a schedule (times are ${tz})`}>
        <InfoBox>
          Write it (comms.send), check who it would go to, then someone with comms.approve switches it on. Each run writes to every adult of each
          household once, with that household&apos;s pledges or gifts filled in, and at most 500 emails every 5 minutes; changing a scheduled email
          that is on makes it a draft again. Members who switched giving emails off, unsubscribed or opted out get nothing, and every email carries
          the unsubscribe link.
        </InfoBox>
      </Card>
      {st.schedules.map((s, i) => {
        const audience = isScheduleAudience(s.audience) ? s.audience : "pledges_due_soon";
        const frequency = isFrequency(s.frequency) ? s.frequency : "monthly";
        const sentence = scheduleSentence({ frequency, day_of_week: s.day_of_week, day_of_month: s.day_of_month, month: s.month, hour: s.hour }, locale);
        const params = s.params ?? {};
        const w = s.wording.find((x) => x.language === main) ?? s.wording[0];
        const status = STATUS[s.status] ?? STATUS.draft;
        const sample = s.preview?.sample ?? null;
        const shown = (s.preview?.sample_households ?? []).map((id) => cards.get(id)).filter((c): c is HouseholdCard => !!c);
        const initial: ScheduleFormData = {
          id: s.id,
          name: s.name,
          audience,
          days: params.days ?? 7,
          since: params.since ?? "",
          includeImported: !!params.include_imported,
          frequency,
          dayOfWeek: s.day_of_week ?? 1,
          dayOfMonth: s.day_of_month ?? 1,
          month: s.month ?? 1,
          hour: s.hour,
          language: w?.language ?? main,
          subject: w?.subject ?? "",
          body: w?.body ?? "",
        };
        const log = logs[i];
        return (
          <Card key={s.id} span={12} title={<span className="flex flex-wrap items-center gap-2">{s.name} <StatusText tone={status.tone}>{status.label}</StatusText></span>} description={`${AUDIENCE_INFO[audience].title} · ${sentence}`}>
            <p className="text-[13px] text-muted">{AUDIENCE_INFO[audience].describe(params)}.</p>
            <p className="mt-1 text-[13px]">
              {s.status === "active" && s.next_run_at ? `Next run ${formatDateTime(s.next_run_at, tz)}. ` : ""}
              {s.run_period ? `A run is going now (${s.run_period}). ` : ""}
              {s.last_run_at && s.last_run?.period
                ? `Last run ${formatDateTime(s.last_run_at, tz)}: ${n(s.last_run.queued)} sent, ${n(s.last_run.skipped)} not sent. `
                : ""}
              {s.last_run?.not_run ? `A run did not go${s.last_run.at ? ` (${formatDateTime(s.last_run.at, tz)})` : ""}: ${s.last_run.not_run} ` : ""}
              {s.approved_at && s.status === "active" ? `Switched on by ${s.approved_by_name ?? "a staff member"}, ${formatDateTime(s.approved_at, tz)}. ` : ""}
              This week: {n(s.week?.queued)} sent{n(s.week?.skipped) ? `, ${n(s.week?.skipped)} not sent` : ""}.
            </p>
            <p className="mt-1 text-[13px]">{dryRunSentence(s.preview)}</p>
            {cardsError ? <QueryError what="the household cards" error={cardsError} /> : <Cards cards={shown} />}
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {st.can_approve && s.status !== "active" ? (
                <ActionForm
                  action={approveScheduleAction}
                  submitLabel={s.status === "paused" ? "Switch on again" : "Switch on"}
                  pendingLabel="Switching on…"
                  size="sm"
                  confirmMessage={`Switch “${s.name}” on?\n${dryRunSentence(s.preview)}. Then: ${sentence.toLowerCase()} (${tz}).`}
                >
                  <input type="hidden" name="id" value={s.id} />
                </ActionForm>
              ) : null}
              {(st.can_edit || st.can_approve) && s.status === "active" ? (
                <ActionForm action={pauseScheduleAction} submitLabel="Pause" pendingLabel="Pausing…" variant="ghost" size="sm" confirmMessage={`Pause “${s.name}”?\nNothing more goes until someone with comms.approve switches it on again.`}>
                  <input type="hidden" name="id" value={s.id} />
                </ActionForm>
              ) : null}
              {!st.can_approve && s.status !== "active" ? (
                <span className="text-[13px] text-muted">Someone with comms.approve switches it on.</span>
              ) : null}
            </div>
            <details className="mt-4 rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-[13px] font-semibold text-ink">{st.can_edit ? "Change it" : "Its settings and wording"}</summary>
              <div className="p-3">
                <ScheduleEditor
                  initial={initial}
                  languages={languages}
                  locale={locale}
                  canEdit={!!st.can_edit}
                  realValues={sample ? scheduleValues(audience, sample, null) : null}
                  submitLabel={s.status === "active" ? "Save (it becomes a draft again)" : "Save"}
                />
              </div>
            </details>
            <div className="mt-4">
              <EmailLog rows={(log?.data ?? []) as LogRow[]} error={log?.error ?? null} timeZone={tz} />
            </div>
          </Card>
        );
      })}
      {st.can_edit ? (
        <Card span={12} title="New scheduled email" description="Saved as a draft: it sends nothing until it is switched on">
          <ScheduleEditor initial={fresh} languages={languages} locale={locale} canEdit realValues={null} submitLabel="Save as a draft" />
        </Card>
      ) : null}
    </>
  );
}
