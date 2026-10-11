// The Events workspace in the new look (board docs/handoff/prototypes/admin-v2/Events.dc.html, "Event Weaver with Niva beside it"):
// the event's header and sections, its four numbers, RSVPs, checklist and what blocks it going live, with Niva's column for this
// event beside it. Server-rendered from what the page loaded; the interactive parts (language tabs, the audience at another time,
// change one thing, copy to a new date, the ask box) are client components. Nothing here changes, saves or sends anything.

import Link from "next/link";
import type { ReactNode } from "react";

import { AskNiva } from "@/components/niva/ask-niva";
import { ComingNext, NivaMark, Pill, btn } from "@/components/onboarding-front/parts";
import type { DraftReminderData } from "@/lib/commands/catalog/messages-draft-reminder";
import type { AudiencePreviewData } from "@/lib/commands/catalog/events/audience";
import type { Readiness } from "@/lib/events/readiness";
import type { EventStatusTone } from "@/lib/events/status";
import type { EventSummary } from "@/lib/events/summary";
import {
  checklistPreview,
  languageTabs,
  nivaOpening,
  readinessTitle,
  rsvpBars,
  rsvpLine,
  workspaceTiles,
  type ChecklistRow,
  type Piece,
  type TileTone,
  type WorkspaceHouseholds,
  type WorkspaceTab,
} from "@/lib/events/workspace";

import { AskAboutEvent } from "./ask-event";
import { AudienceCard } from "./audience-card";
import { ChangeCard } from "./change-card";
import { CloneCard } from "./clone-card";
import { ReminderDrafts } from "./reminder-drafts";
import { WorkspaceColumns } from "./workspace-columns";

const STATUS_PILL: Record<EventStatusTone, string> = {
  ok: "bg-[#e3f5ea] text-[#0f4f33]",
  warn: "bg-[#fff1e6] text-[#7c2d06]",
  navy: "bg-[#e8f1fc] text-[#164690]",
  muted: "bg-[#eaf0f7] text-ink-2",
  bad: "bg-[#fbe3e1] text-[#7a1a14]",
};

const TILE_INK: Record<TileTone, string> = { indigo: "text-[#3d3bb8]", blue: "text-[#1c56b0]", sun: "text-[#a8400d]", green: "text-[#17724a]" };

const card = "rounded-[16px] border border-line bg-white px-[18px] py-4";

// ---------------------------------------------------------------------------
// The frame: breadcrumb, title, status, when and where, the sections
// ---------------------------------------------------------------------------
export type FrameProps = {
  name: string;
  status: { label: string; tone: EventStatusTone };
  /** "Saturday, November 7, 2026 · 6:00 PM · Main hall · capacity 450" */
  facts: string;
  tabs: WorkspaceTab[];
  /** The classic page's other views (Details, Checklist, Report), reached from here. */
  more: { label: string; href: string; current: boolean }[];
  /** Buttons for the person's own hands: edit in the builder, change the status, history. */
  actions?: ReactNode;
  children: ReactNode;
};

export function EventWorkspaceHeader({ name, status, facts, tabs, more, actions }: Omit<FrameProps, "children">) {
  return (
    <>
      <header className="flex flex-col gap-2">
        <nav aria-label="Breadcrumb" className="text-[13px] text-muted">
          <Link href="/events" className="text-muted no-underline hover:underline">
            Events
          </Link>{" "}
          <span aria-hidden="true">›</span>{" "}
          <span aria-current="page" className="font-bold text-ink">
            {name}
          </span>
        </nav>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-3">
            <h1 className="m-0 font-display text-[28px] font-semibold leading-tight text-ink sm:text-[32px]">{name}</h1>
            <span className={`rounded-[10px] px-[9px] py-1 text-[12px] font-extrabold uppercase tracking-[0.04em] ${STATUS_PILL[status.tone]}`}>{status.label}</span>
          </div>
          {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
        </div>
        <p className="m-0 text-[14px] text-muted">{facts}</p>
      </header>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <nav aria-label="Event sections" className="max-w-full overflow-x-auto">
          <ul className="m-0 flex w-max list-none gap-1 rounded-[24px] bg-[#e9eff7] p-1">
            {tabs.map((t) => (
              <li key={t.key}>
                <Link
                  href={t.href}
                  aria-current={t.current ? "page" : undefined}
                  className={`inline-flex min-h-[40px] items-center rounded-[20px] px-4 text-[14px] no-underline ${t.current ? "bg-white font-bold text-[#3d3bb8]" : "font-semibold text-ink-2 hover:bg-white/60"}`}
                >
                  {t.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <ul className="m-0 flex list-none flex-wrap items-center gap-x-3 gap-y-1 p-0 text-[13px]">
          {more.map((m) => (
            <li key={m.href}>
              <Link href={m.href} aria-current={m.current ? "page" : undefined} className={`no-underline hover:underline ${m.current ? "font-bold text-[#3d3bb8]" : "font-semibold text-navy"}`}>
                {m.label}
              </Link>
            </li>
          ))}
          <li className="inline-flex items-center gap-1.5 text-muted">
            Month calendar <ComingNext />
          </li>
        </ul>
      </div>
    </>
  );
}

/** Any view of the event other than the overview: the header and sections, then the classic tab's content. */
export function EventWorkspaceFrame({ children, ...header }: FrameProps) {
  return (
    <div className="flex flex-col gap-[18px]">
      <EventWorkspaceHeader {...header} />
      <div>{children}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The overview
// ---------------------------------------------------------------------------
export type OverviewProps = Omit<FrameProps, "children"> & {
  event: { id: string; name: string };
  community: { name: string };
  summary: Piece<EventSummary>;
  readiness: Piece<Readiness>;
  checklist: Piece<ChecklistRow[]>;
  audience: Piece<AudiencePreviewData>;
  drafts: Piece<DraftReminderData>;
  households: Piece<WorkspaceHouseholds>;
  cannot: { change: string | null; clone: string | null };
  switches: { setField: boolean; createFromClone: boolean };
  today: string;
  links: { rsvps: string; checklist: string; builder: string | null; newEvent: string; newsletters: string };
  /** The copy's first suggested date: the same day a year on. */
  cloneDate: string;
  /** Which language tab starts selected (the dev preview shows a language that needs translating). */
  initialLanguage?: string;
};

export function EventOverview(p: OverviewProps) {
  return (
    <WorkspaceColumns
      main={
        <>
          <EventWorkspaceHeader name={p.name} status={p.status} facts={p.facts} tabs={p.tabs} more={p.more} actions={p.actions} />
          <Tiles summary={p.summary} />
          <section aria-label="RSVPs and checklist" className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
            <RsvpCard summary={p.summary} />
            <ChecklistCard checklist={p.checklist} summary={p.summary} today={p.today} href={p.links.checklist} />
          </section>
          <ReadinessCard readiness={p.readiness} />
        </>
      }
      side={<NivaColumn {...p} />}
    />
  );
}

function LoadError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="m-0 text-[13px] text-danger">
      {children}
    </p>
  );
}

function Tiles({ summary }: { summary: Piece<EventSummary> }) {
  if (!summary.ok) {
    return (
      <section aria-label="The event in numbers" className={card}>
        <LoadError>{summary.error}</LoadError>
      </section>
    );
  }
  return (
    <section aria-label="The event in numbers" className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {workspaceTiles(summary.data).map((t) => (
        <div key={t.key} className="rounded-[12px] border border-line bg-white px-3.5 py-3">
          <div className="text-[12px] font-semibold text-muted">{t.label}</div>
          <div className={`mt-1 text-[26px] font-extrabold leading-tight ${TILE_INK[t.tone]}`}>{t.value}</div>
          <div className="mt-0.5 text-[11px] text-muted">{t.sub}</div>
        </div>
      ))}
    </section>
  );
}

function RsvpCard({ summary }: { summary: Piece<EventSummary> }) {
  return (
    <section aria-labelledby="ev-rsvps" className={`${card} flex flex-col gap-3.5`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ev-rsvps" className="m-0 text-[16px] font-bold text-ink">
          RSVPs by status
        </h2>
        <span className="inline-flex items-center gap-1.5 text-[12px] text-muted">
          By area, against last year <ComingNext />
        </span>
      </div>
      {summary.ok ? (
        <>
          <ul className="m-0 flex list-none flex-col gap-3.5 p-0" aria-label="Households by RSVP status">
            {rsvpBars(summary.data).map((b) => (
              <li key={b.key} className="grid grid-cols-[96px_minmax(0,1fr)_48px] items-center gap-2.5 text-[13px] sm:grid-cols-[110px_minmax(0,1fr)_48px]">
                <span className="font-semibold text-ink">{b.label}</span>
                <span className="relative block h-3.5 rounded-[7px] bg-[#eaf0f7]" aria-hidden="true">
                  <span className="block h-3.5 rounded-[7px] bg-[#3d3bb8]" style={{ width: `${Math.max(b.households > 0 ? 3 : 0, b.pct)}%` }} />
                </span>
                <span className="text-right font-bold text-ink">
                  {b.households.toLocaleString("en-US")}
                  <span className="sr-only"> households</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="m-0 mt-auto rounded-[10px] bg-ground px-3 py-2.5 text-[13px] leading-[1.5] text-ink-2">{rsvpLine(summary.data)}</p>
          <div>
            <AskNiva prompt="How is this event doing: RSVPs, lunch and volunteers?" />
          </div>
        </>
      ) : (
        <LoadError>{summary.error}</LoadError>
      )}
    </section>
  );
}

const DUE_INK = { bad: "font-bold text-danger", warn: "text-[#7c2d06]", ok: "text-success", muted: "text-muted" } as const;

function ChecklistCard({ checklist, summary, today, href }: { checklist: Piece<ChecklistRow[]>; summary: Piece<EventSummary>; today: string; href: string }) {
  const items = checklist.ok ? checklistPreview(checklist.data, today) : [];
  const total = summary.ok ? summary.data.checklist.total : checklist.ok ? checklist.data.length : 0;
  const done = summary.ok ? summary.data.checklist.done : checklist.ok ? checklist.data.filter((r) => r.state === "completed").length : 0;
  return (
    <section aria-labelledby="ev-checklist" className={`${card} flex flex-col gap-3`}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="ev-checklist" className="m-0 text-[16px] font-bold text-ink">
          Checklist
        </h2>
        {checklist.ok && total > 0 ? (
          <span className="text-[13px] text-muted">
            {done} of {total} done
          </span>
        ) : null}
      </div>
      {!checklist.ok ? (
        <LoadError>{checklist.error}</LoadError>
      ) : items.length === 0 ? (
        <p className="m-0 text-[14px] text-muted">No checklist for this event yet.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0 text-[14px] text-ink">
          {items.map((i) => (
            <li key={i.id} className="flex items-center gap-2.5">
              {i.done ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#17724A" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" className="shrink-0">
                  <path d="M5 13l4 4 10-10" />
                </svg>
              ) : (
                <span aria-hidden="true" className="h-[18px] w-[18px] shrink-0 rounded-full border-2 border-[#6b778c]" />
              )}
              <span className="min-w-0 flex-1">
                {i.name}
                <span className="sr-only">{i.done ? ", done" : ", not done"}</span>
              </span>
              {i.due ? <span className={`shrink-0 text-[12px] ${DUE_INK[i.due.tone]}`}>{i.due.label}</span> : null}
            </li>
          ))}
        </ul>
      )}
      <Link href={href} className="mt-auto text-[13px] font-bold text-navy no-underline hover:underline">
        Open the checklist
      </Link>
    </section>
  );
}

function ReadinessCard({ readiness }: { readiness: Piece<Readiness> }) {
  if (!readiness.ok) {
    return (
      <section aria-labelledby="ev-ready" className={card}>
        <h2 id="ev-ready" className="m-0 text-[16px] font-bold text-ink">
          What is blocking this going live
        </h2>
        <div className="mt-2">
          <LoadError>{readiness.error}</LoadError>
        </div>
      </section>
    );
  }
  const r = readiness.data;
  return (
    <section aria-labelledby="ev-ready" className={`${card} flex flex-col gap-3`}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="ev-ready" className="m-0 text-[16px] font-bold text-ink">
          {readinessTitle(r.goal)}
        </h2>
        {r.ready ? <Pill tone="green">Nothing blocking</Pill> : <Pill tone="danger">{r.blockers.length} to fix first</Pill>}
      </div>
      <p className="m-0 text-[14px] text-ink-2">{r.summary}</p>
      {r.blockers.length + r.checks.length > 0 ? (
        <ul className="m-0 grid list-none grid-cols-1 gap-2 p-0 md:grid-cols-2">
          {[...r.blockers.map((i) => ({ ...i, kind: "block" as const })), ...r.checks.map((i) => ({ ...i, kind: "check" as const }))].map((i) => (
            <li key={`${i.kind}-${i.code}`} className={`rounded-[10px] px-3 py-2 text-[13px] ${i.kind === "block" ? "bg-[#fbe3e1] text-[#7a1a14]" : "bg-ground text-ink"}`}>
              <span className="font-bold">{i.kind === "block" ? "Fix first: " : "Worth a look: "}</span>
              {i.text}
              <span className={`mt-0.5 block text-[12px] ${i.kind === "block" ? "text-[#7a1a14]" : "text-muted"}`}>{i.fix}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div>
        <AskNiva prompt={r.goal === "publish" ? "What is blocking this event from going live, and what should I fix first?" : "What is left to do before this event's day?"} />
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Niva's column for this event
// ---------------------------------------------------------------------------
function Bubble({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-[14px] bg-[#f3f7fb] px-3.5 py-3 text-[14px] leading-[1.55] text-ink">
      <span className="sr-only">Niva: </span>
      {children}
    </div>
  );
}

function NivaColumn(p: OverviewProps) {
  const languages = p.drafts.ok ? p.drafts.data.drafts.map((d) => d.language) : [];
  const blockers = p.readiness.ok ? p.readiness.data.blockers.length : null;
  const tabs = p.drafts.ok ? languageTabs(p.drafts.data.drafts) : [];
  const draftNotes = p.drafts.ok ? p.drafts.data.notes.filter((n) => !/built into Weaver|has no .* wording/.test(n)) : [];
  return (
    <aside
      aria-label="Niva, for this event"
      className="flex h-full flex-col rounded-[16px] border border-line bg-white xl:group-data-[docked=false]/ws:rounded-none xl:group-data-[docked=false]/ws:border-y-0 xl:group-data-[docked=false]/ws:border-r-0"
    >
      <div className="flex items-center gap-2.5 border-b border-line-soft px-5 py-3.5">
        <NivaMark />
        <div className="flex min-w-0 flex-col">
          <span className="text-[15px] font-bold text-ink">Niva</span>
          <span className="truncate text-[12px] text-muted">Looking at: {p.event.name}</span>
        </div>
      </div>

      {/* Each part keeps its own height (shrink-0): in the scrolling column a part with overflow hidden would otherwise shrink to nothing. */}
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 px-5 py-[18px] xl:overflow-y-auto [&>*]:shrink-0">
        <Bubble>{nivaOpening(p.summary.ok ? p.summary.data : null, blockers, languages)}</Bubble>
        {p.drafts.ok ? (
          <>
            <Bubble>Here is the reminder for everyone who RSVP&apos;d. Check the message and the audience before it goes.</Bubble>
            <ReminderDrafts tabs={tabs} initial={p.initialLanguage} />
            {draftNotes.map((n) => (
              <p key={n} className="m-0 text-[12px] text-muted">
                {n}
              </p>
            ))}
          </>
        ) : (
          <div className="rounded-[16px] border border-line px-4 py-3">
            <h3 className="m-0 text-[15px] font-bold text-ink">The reminder</h3>
            <p role="alert" className="m-0 mt-1 text-[13px] text-danger">
              {p.drafts.error}
            </p>
          </div>
        )}

        <AudienceCard eventId={p.event.id} initial={p.audience} households={p.households} allHref={p.links.rsvps} />

        <div className="flex flex-col gap-2">
          <p className="m-0 text-[12px] leading-[1.5] text-muted">
            Messages to all members need a second approver. A message says <b>Scheduled</b> until it has really gone out. Scheduling it from here is coming next;
            for now, write it in{" "}
            <Link href={p.links.newsletters} className="font-bold text-navy">
              Newsletters
            </Link>
            .
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" disabled className={btn.off}>
              Schedule the reminder
            </button>
            <button type="button" disabled className={btn.off}>
              Send me a test
            </button>
            <ComingNext />
          </div>
        </div>

        <ChangeCard eventId={p.event.id} eventName={p.event.name} communityName={p.community.name} cannot={p.cannot.change} setFieldOn={p.switches.setField} builderHref={p.links.builder} />
        <CloneCard eventId={p.event.id} communityName={p.community.name} defaultDate={p.cloneDate} cannot={p.cannot.clone} createOn={p.switches.createFromClone} newEventHref={p.links.newEvent} />
      </div>

      <div className="border-t border-line-soft px-5 pb-4 pt-3">
        <AskAboutEvent />
      </div>
    </aside>
  );
}
