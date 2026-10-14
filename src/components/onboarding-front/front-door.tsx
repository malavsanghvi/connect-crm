// "Bring your data in": board 1 ("One front door") of docs/handoff/prototypes/onboarding-data/Main.dc.html, as one screen.
// The steps on the left; on the right Niva's plan, the drop zone with recognition, the connectors, templates and helpers,
// and what Niva sees. Everything not built yet is shown, switched off, with a "Coming next" pill: never a fake success.
//
// The container sets data-v2-tokens, which points the theme's color tokens at the logo palette (src/app/globals.css), so
// the page looks like the board in the classic shell and in the New look alike.

import Link from "next/link";
import { useId } from "react";

import type { FrontModel, FrontStep } from "@/lib/onboarding-front/front-door";
import type { RecogniseContext } from "@/lib/onboarding-front/recognise";

import { AskMe, AskNivaBar } from "./ask";
import { DropZone, type DropLinks, type DroppedFile } from "./drop-zone";
import { btn, card, ComingNext, h2, NivaRow, Pill, UserBubble, type PillTone } from "./parts";

export type FrontLinks = DropLinks & {
  /** This page, to try again after a failed read. */
  self: string;
  setup: string;
  /** Accounting › QuickBooks setup, when this person can open it; null otherwise. */
  qboSetup: string | null;
  peopleTemplate: string;
  /** The past-donations template; null when the community has no giving. */
  donationsTemplate: string | null;
};

export type FrontDoorProps = {
  model: FrontModel;
  recognise: RecogniseContext;
  links: FrontLinks;
  /** The kind's name for its people, lower case ("members & families"). */
  peopleWord: string;
  /** Files already looked at (the dev preview's samples). */
  initialFiles?: readonly DroppedFile[];
};

// ---------------------------------------------------------------------------- The steps (left column)

function StepMark({ step }: { step: FrontStep }) {
  if (step.state === "done") {
    return (
      <span aria-hidden="true" className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-success">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ffffff" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round">
          <path d="M5 13l4 4 10-10" />
        </svg>
      </span>
    );
  }
  if (step.state === "now") {
    return (
      <span aria-hidden="true" className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full bg-navy text-[13px] font-bold text-white">
        {step.n}
      </span>
    );
  }
  return (
    <span aria-hidden="true" className="box-border flex h-[26px] w-[26px] flex-none items-center justify-center rounded-full border-2 border-navy-300 text-[12px] font-bold text-muted">
      {step.n}
    </span>
  );
}

const STATE_WORD = { done: "done", now: "current step", todo: "not started" } as const;

export function StepsNav({ steps, setupHref, guidedHref }: { steps: readonly FrontStep[]; setupHref: string; guidedHref: string }) {
  const current = steps.find((s) => s.state === "now")?.n ?? 1;
  const pct = `${Math.round((current / Math.max(1, steps.length)) * 100)}%`;
  return (
    <nav
      aria-label="Steps to bring your data in"
      className="box-border flex w-full flex-none flex-col gap-[18px] border-b border-line bg-white px-4 py-6 sm:px-[22px] @4xl:w-[320px] @4xl:border-b-0 @4xl:border-r @4xl:py-7"
    >
      <div className="flex flex-col gap-1.5">
        <span className="text-[13px] text-muted">
          <Link href={setupHref} className="text-muted no-underline hover:underline">
            Setup
          </Link>{" "}
          ›{" "}
          <Link href={guidedHref} className="text-muted no-underline hover:underline">
            Guided onboarding
          </Link>
        </span>
        <h1 className="m-0 font-display text-[26px] font-semibold leading-[1.2] text-ink">Bring your data in</h1>
        <span className="text-[13px] text-muted">
          Step {current} of {steps.length}
        </span>
        <div aria-hidden="true" className="h-2 overflow-hidden rounded-[4px] bg-navy-50">
          <div className="h-2 bg-navy" style={{ width: pct }} />
        </div>
      </div>
      <ol className="m-0 flex list-none flex-col gap-1.5 p-0">
        {steps.map((s) => (
          <li
            key={s.n}
            aria-current={s.state === "now" ? "step" : undefined}
            className={`flex gap-3 rounded-[14px] border p-3 ${s.state === "now" ? "border-navy-300 bg-navy-50" : "border-transparent bg-transparent"}`}
          >
            <StepMark step={s} />
            <span className="flex flex-col gap-0.5">
              <span className={`text-[14px] ${s.state === "now" ? "font-bold text-navy-hover" : s.state === "todo" ? "font-bold text-muted" : "font-bold text-ink"}`}>
                {s.title}
                <span className="sr-only"> ({STATE_WORD[s.state]})</span>
              </span>
              <span className="text-[12px] leading-[1.4] text-muted">{s.sub}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-col gap-2.5 @4xl:mt-auto">
        <div className="rounded-[14px] border border-line bg-ground px-[14px] py-3 text-[12px] leading-[1.55] text-ink-2">
          Nothing is saved until you confirm, and every load can be undone in Settings › Data import.
        </div>
        <div className="rounded-[14px] bg-saffron-50 px-[14px] py-3 text-[12px] leading-[1.55] text-brown-900">
          <b>Children.</b> Nothing about anyone under 18 is ever sent to an AI service.
        </div>
      </div>
    </nav>
  );
}

// ---------------------------------------------------------------------------- The plan

export function PlanCard({ model, retryHref }: { model: FrontModel; retryHref: string }) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={`${card} flex flex-col gap-[14px]`}>
      <div className="flex flex-wrap items-center justify-between gap-[10px]">
        <div className="flex flex-wrap items-center gap-[10px]">
          <h2 id={id} className="m-0 font-display text-[21px] font-semibold leading-[1.25] text-ink">
            Your plan
          </h2>
          <Pill tone="sun">Suggested for you</Pill>
        </div>
        <span className="inline-flex flex-wrap items-center gap-2">
          <button type="button" disabled className={btn.off}>
            Edit my answers
          </button>
          <ComingNext />
        </span>
      </div>
      <ul aria-label="What Weaver knows so far" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {model.facts.map((f) => (
          <li key={f} className="rounded-[14px] border border-line bg-ground px-3 py-[5px] text-[14px] text-ink-2">
            {f}
          </li>
        ))}
      </ul>
      {model.importsError ? (
        <p role="alert" className="m-0 rounded-[12px] bg-danger-50 px-3 py-2 text-[14px] leading-[1.5] text-danger">
          {model.importsError}{" "}
          <a href={retryHref} className="font-semibold text-danger underline">
            Try again
          </a>
        </p>
      ) : null}
      <p className="m-0 text-[15px] leading-[1.6] text-ink-2">
        <strong>Suggested route:</strong> {model.route}
      </p>
    </section>
  );
}

// ---------------------------------------------------------------------------- Connectors

type Tile = { mono: string; name: string; what: string; how: string };

const OTHER_TILES: readonly Tile[] = [
  { mono: "N", name: "Neon CRM", what: "People, households, donations, memberships and events with their history.", how: "Organization ID and API key" },
  { mono: "Z", name: "Zeffy", what: "Contacts, payments and campaigns, read only.", how: "API key from a Zeffy admin" },
  { mono: "G", name: "Google Sheets", what: "Pick a spreadsheet you already keep. Read, never edited.", how: "Sign in with Google" },
  { mono: "+", name: "Something else", what: "Bloomerang, DonorPerfect, Wild Apricot, Mailchimp. Tell me and I show the fastest way.", how: "Usually a CSV export" },
];

const QBO_TONE: Record<FrontModel["qbo"]["tone"], PillTone> = { ok: "green", warn: "sun", bad: "danger", muted: "grey" };

function TileHead({ mono, name }: { mono: string; name: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span aria-hidden="true" className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-navy-50 text-[13px] font-bold text-navy">
        {mono}
      </span>
      <span className="text-[15px] font-bold text-ink">{name}</span>
    </div>
  );
}

const tileClass = "box-border flex min-h-[44px] w-full flex-col gap-2 rounded-[14px] border border-line bg-white p-4 text-ink no-underline";

export function Connectors({ model, qboSetup }: { model: FrontModel; qboSetup: string | null }) {
  const q = model.qbo;
  const qboBody = (
    <>
      <TileHead mono="QB" name="QuickBooks" />
      <span className="text-[13px] leading-[1.5] text-ink-2">Chart of accounts and classes (your funds), plus customer history to match to households.</span>
      <span className="mt-auto flex flex-col items-start gap-1.5">
        <Pill tone={QBO_TONE[q.tone]}>{q.status}</Pill>
        <span className="text-[12px] leading-[1.45] text-muted">{q.detail}</span>
        <span className="text-[12px] leading-[1.45] text-muted">Bringing its history in is coming next.</span>
      </span>
    </>
  );
  return (
    <ul aria-label="Systems you can connect" className="m-0 grid list-none grid-cols-1 gap-3 p-0 @md:grid-cols-2 @2xl:grid-cols-3 @4xl:grid-cols-5">
      <li className="flex">
        {qboSetup && q.canOpen ? (
          <Link href={qboSetup} className={`${tileClass} hover:border-navy-300`}>
            {qboBody}
            <span className="sr-only"> (opens QuickBooks setup)</span>
          </Link>
        ) : (
          <div className={tileClass}>{qboBody}</div>
        )}
      </li>
      {OTHER_TILES.map((t) => (
        <li key={t.name} className="flex">
          <div className={tileClass}>
            <TileHead mono={t.mono} name={t.name} />
            <span className="text-[13px] leading-[1.5] text-ink-2">{t.what}</span>
            <span className="mt-auto flex flex-col items-start gap-1.5">
              <span className="text-[12px] text-muted">{t.how}</span>
              <ComingNext />
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------- Templates and helpers

export function TwoWays({ links, peopleWord }: { links: FrontLinks; peopleWord: string }) {
  const tId = useId();
  const hId = useId();
  return (
    <div className="flex flex-col gap-[14px] @3xl:flex-row">
      <section aria-labelledby={tId} className={`${card} flex min-w-0 flex-1 flex-col gap-2.5`}>
        <h2 id={tId} className={h2}>
          Start from Weaver&apos;s templates
        </h2>
        <p className="m-0 text-[14px] leading-[1.6] text-ink-2">
          A template for each thing you load, with a second sheet that explains every column. One workbook with a tab for each, part-filled with what Weaver already knows, is coming next.
        </p>
        <div className="flex flex-wrap items-center gap-2.5">
          <a href={links.peopleTemplate} className={btn.primary}>
            Get the {peopleWord} template
          </a>
          {links.donationsTemplate ? (
            <a href={links.donationsTemplate} className={btn.outlineLarge}>
              Get the past donations template
            </a>
          ) : null}
        </div>
      </section>
      <section aria-labelledby={hId} className={`${card} flex min-w-0 flex-1 flex-col gap-2.5`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 id={hId} className={h2}>
            Hand a part to someone
          </h2>
          <ComingNext />
        </div>
        <p className="m-0 text-[14px] leading-[1.6] text-ink-2">
          Send your treasurer a link for the giving data and your membership coordinator a link for the member list. Each sees only their part. Or send us your files and the Weaver team prepares them with you; you approve.
        </p>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" disabled className={btn.off}>
            Invite a helper
          </button>
          <button type="button" disabled className={btn.off}>
            Send us the files
          </button>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------- What Niva sees

export function NivaSees({ model }: { model: FrontModel }) {
  const id = useId();
  const nowId = useId();
  return (
    <section aria-labelledby={id} className={`${card} flex gap-[14px] @md:ml-[46px]`}>
      <svg aria-hidden="true" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mt-0.5 flex-none text-success">
        <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" />
      </svg>
      <div className="flex min-w-0 flex-col gap-2">
        <h2 id={id} className={h2}>
          What Niva sees, and what it never does
        </h2>
        <ul className="m-0 list-disc pl-[18px] text-[14px] leading-[1.65] text-ink-2">
          <li>To suggest where a column goes, I see the column headings and a few sample values with names, digits and dates masked. Your full file stays in Weaver.</li>
          <li>
            <strong>Nothing about children.</strong> Nothing about anyone under 18 is sent to an AI service, and photos and PDFs are never sent to one.
          </li>
          <li>I never save anything on my own, and I never merge two households because their names look alike.</li>
          <li>Keys for connected systems are stored encrypted, and I never see them.</li>
        </ul>
        <div className="mt-1 flex flex-col gap-1">
          <h3 id={nowId} className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
            What I could be shown right now
          </h3>
          <ul aria-labelledby={nowId} className="m-0 list-none p-0 text-[14px] leading-[1.6] text-ink-2">
            {model.sees.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          <p className="m-0 text-[12px] leading-[1.5] text-muted">Counts and shapes only: never a name, a contact detail or an amount for a person.</p>
        </div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------- The screen

export function FrontDoor({ model, recognise, links, peopleWord, initialFiles }: FrontDoorProps) {
  return (
    <div data-v2-tokens="" className="@container min-h-[calc(100dvh-64px)] bg-canvas font-sans text-ink">
      <div className="flex min-h-[inherit] flex-col @4xl:flex-row">
        <StepsNav steps={model.steps} setupHref={links.setup} guidedHref={links.guided} />
        <div className="@container flex min-w-0 flex-1 flex-col gap-[18px] px-4 pb-[22px] pt-[26px] sm:px-9">
          <UserBubble>I want to bring our data into Weaver.</UserBubble>

          <NivaRow says={model.greeting}>
            <PlanCard model={model} retryHref={links.self} />
          </NivaRow>

          <NivaRow says="Drop whatever you have in one place. I will say what each file is and where it can go, so you do not have to choose first.">
            <DropZone context={recognise} links={links} initial={initialFiles} />
          </NivaRow>

          <NivaRow says="Or connect a system and I will pull it. I will only read: I never change anything in it. Pulling from these is coming next; QuickBooks shows how its connection stands today.">
            <Connectors model={model} qboSetup={links.qboSetup} />
          </NivaRow>

          <NivaRow says="Two more ways, if they suit you better.">
            <TwoWays links={links} peopleWord={peopleWord} />
          </NivaRow>

          <NivaSees model={model} />
          <AskMe />
          <AskNivaBar />
        </div>
      </div>
    </div>
  );
}
