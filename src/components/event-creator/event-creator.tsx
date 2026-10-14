"use client";

// The guided event creator (New look, /events/new): one question card at a time on the left (stepper, Back / Skip / Continue,
// the answered cards above with Change), and on the right the flyer draft, the event page as members will see it (web or
// phone) and the readiness list. The draft row is created when card 1 is answered and saved again after each card, through
// the builder's own actions; every failure is said in plain English next to the card, with Try again. Nothing is published or
// sent from here.

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { fromDateTimeLocal } from "@/lib/events/format";
import { toEntries, toFormData } from "@/lib/event-creator/mapping";
import { after, askedCards, before, creatorReadiness, nextCard } from "@/lib/event-creator/plan";
import { cardDef } from "@/lib/event-creator/questions";
import { summaryOf } from "@/lib/event-creator/summary";
import type { CardId, CreatorCtx, CreatorExisting, EventDraft } from "@/lib/event-creator/types";
import { cardProblem } from "@/lib/event-creator/validate";

import type { CreatorApi } from "./api";
import { HelpCard } from "./cards/help-card";
import { MoneyCard } from "./cards/money-card";
import { MoreCard } from "./cards/more-card";
import { ReviewCard } from "./cards/review-card";
import { SendingCard } from "./cards/sending-card";
import { WhatCard } from "./cards/what-card";
import { WhereCard } from "./cards/where-card";
import { WhoCard } from "./cards/who-card";
import { WordsCard } from "./cards/words-card";
import { FlyerSlot } from "./flyer-slot";
import { ErrorNote, Note, primaryButton, softButton, type CardProps } from "./parts";
import { EventPreview, ReadinessList } from "./preview";

const draftKey = (d: EventDraft) => JSON.stringify(toEntries(d));
const passedKey = (id: string) => `weaver.eventCreator.passed.${id}`;

function readStored(key: string | null): string {
  if (!key) return "[]";
  try {
    return window.localStorage.getItem(key) ?? "[]";
  } catch {
    return "[]";
  }
}

function parsePassed(raw: string): CardId[] {
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? (v.filter((x) => typeof x === "string") as CardId[]) : [];
  } catch {
    return [];
  }
}

function subscribeStorage(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

function writePassed(id: string, list: CardId[]) {
  try {
    window.localStorage.setItem(passedKey(id), JSON.stringify(list));
  } catch {
    // A private window or blocked storage: the creator still works, it just cannot remember the place in this browser.
  }
}

export type EventCreatorProps = {
  ctx: CreatorCtx;
  initialDraft: EventDraft;
  existing: CreatorExisting;
  api: CreatorApi;
  /** The page's address keeps this so a reload reopens the same draft (the `s` it was opened with). */
  sessionParam?: string | null;
  /** Open on this card (the dev preview); otherwise the next unanswered card. */
  initialStep?: CardId;
  /** The dev preview: stand-in actions, no address changes, no refresh. */
  demo?: boolean;
  /** On a phone, which pane opens first (the dev preview shows the flyer panel with "preview"). */
  initialPane?: "questions" | "preview";
};

export function EventCreator({ ctx, initialDraft, existing, api, sessionParam = null, initialStep, demo = false, initialPane = "questions" }: EventCreatorProps) {
  const router = useRouter();
  const [draft, setDraft] = useState(initialDraft);
  // The flyer panel saves the flyer itself (approving it): keep the draft's copy in step, so the readiness list follows.
  const onFlyerChange = useCallback((path: string | null) => setDraft((d) => (d.flyer_path === (path ?? "") ? d : { ...d, flyer_path: path ?? "" })), []);
  const [savedKey, setSavedKey] = useState<string | null>(() => (initialDraft.id ? draftKey(initialDraft) : null));
  // This browser's memory of the cards already passed for this draft (a convenience; the draft itself is in the database).
  const storeKey = initialDraft.id ? passedKey(initialDraft.id) : null;
  const storedRaw = useSyncExternalStore(subscribeStorage, () => readStored(storeKey), () => "[]");
  const stored = useMemo(() => parsePassed(storedRaw), [storedRaw]);
  const [passedNow, setPassedNow] = useState<CardId[]>([]);
  const passed = [...new Set([...stored, ...passedNow])];
  // Until the person moves, the creator opens at the next unanswered card.
  const [chosen, setChosen] = useState<CardId | null>(initialStep ?? null);
  const step: CardId = chosen ?? nextCard(initialDraft, ctx, stored);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cardError, setCardError] = useState<string | null>(null);
  const [pane, setPane] = useState<"questions" | "preview">(initialPane);
  const [previewMode, setPreviewMode] = useState<"web" | "phone">("web");
  const headingRef = useRef<HTMLHeadingElement>(null);
  const moved = useRef(false);

  const dirty = savedKey !== draftKey(draft);
  const asked = askedCards(ctx);
  const total = asked.length;
  const index = asked.indexOf(step);

  // After a step change made by the person, move focus to the new card's question (keyboard and screen-reader users).
  useEffect(() => {
    if (!moved.current) return;
    headingRef.current?.focus();
  }, [step]);

  function set(patch: Partial<EventDraft>) {
    setDraft((d) => ({ ...d, ...patch }));
    setCardError(null);
  }

  function go(card: CardId) {
    if (card !== "what" && !draft.id) return;
    moved.current = true;
    setCardError(null);
    setSaveError(null);
    setChosen(card);
    setPane("questions");
  }

  function markPassed(card: CardId, id: string | null) {
    const next = passed.includes(card) ? passed : [...passed, card];
    setPassedNow(next);
    if (id) writePassed(id, next);
  }

  async function save(): Promise<string | null | false> {
    setSaving(true);
    setSaveError(null);
    let res: Awaited<ReturnType<CreatorApi["save"]>>;
    try {
      res = await api.save(draft.id, toFormData(draft));
    } catch {
      res = { ok: false, error: "Could not save the draft — the connection was lost. Your answers are kept here; try again." };
    }
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.error);
      return false;
    }
    const id = draft.id ?? res.data?.id ?? null;
    const saved = { ...draft, id };
    setDraft(saved);
    setSavedKey(draftKey(saved));
    if (!draft.id && id && !demo) window.history.replaceState(null, "", `/events/new?event=${id}${sessionParam ? `&s=${sessionParam}` : ""}`);
    return id;
  }

  async function saveNow(): Promise<boolean> {
    return (await save()) !== false;
  }

  async function onContinue() {
    const problem = cardProblem(step, draft, ctx);
    setCardError(problem);
    if (problem) return;
    let id = draft.id;
    if (dirty || !id) {
      const r = await save();
      if (r === false) return;
      id = r;
    }
    markPassed(step, id);
    go(after(step, ctx));
  }

  function onSkip() {
    markPassed(step, draft.id);
    go(after(step, ctx));
  }

  const refresh = () => {
    if (!demo) router.refresh();
  };

  const counts = {
    lunch_slots: existing.lunchSlots,
    shifts: existing.shifts.length,
    shifts_empty: null,
    checklist_open: existing.checklist.filter((a) => a.state !== "completed").length,
    checklist_overdue: 0,
  };
  const readiness = creatorReadiness(draft, ctx, counts);
  const cardProps: CardProps = { draft, set, ctx, existing, api, saveNow, refresh, demo, goTo: go };
  const prev = before(step, ctx);
  const canSkip = step !== "what" && step !== "review";

  let body: React.ReactNode;
  switch (step) {
    case "what":
      body = <WhatCard {...cardProps} onTemplateCreated={(id) => router.push(`/events/new?event=${id}`)} />;
      break;
    case "where":
      body = <WhereCard {...cardProps} />;
      break;
    case "who":
      body = <WhoCard {...cardProps} />;
      break;
    case "money":
      body = <MoneyCard {...cardProps} />;
      break;
    case "help":
      body = <HelpCard {...cardProps} dirty={dirty} />;
      break;
    case "words":
      body = <WordsCard {...cardProps} />;
      break;
    case "sending":
      body = <SendingCard {...cardProps} />;
      break;
    case "more":
      body = <MoreCard {...cardProps} dirty={dirty} />;
      break;
    case "review":
      body = <ReviewCard {...cardProps} readiness={readiness} dirty={dirty} saving={saving} onSave={saveNow} />;
      break;
  }

  const status = saving ? "Saving…" : saveError ? "Not saved" : !draft.id ? "Not saved yet" : dirty ? "Changes not saved yet" : "Draft saved";
  const statusTone = saving || (!saveError && draft.id && !dirty) ? "text-success-900 bg-success-50" : saveError ? "text-danger bg-danger-50" : "text-ink-2 bg-[#eaf0f7]";

  return (
    <div data-v2-tokens className="@container">
      <div className="flex flex-col gap-4">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <p className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">{draft.id ? "Draft event · members cannot see it" : "New event"}</p>
            <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">{draft.id ? draft.name.trim() || "Untitled event" : "Create an event"}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className={`rounded-[12px] px-2.5 py-1 text-[13px] font-semibold ${statusTone}`}>
              {status}
            </span>
            <Link href={draft.id ? `/events/builder?event=${draft.id}` : "/events/builder"} className={softButton}>
              Advanced form
            </Link>
          </div>
        </header>

        {draft.status !== "draft" ? (
          <Note tone="warn">
            This event is already {draft.status === "published" ? "published" : draft.status.replace("_", " ")}: changes saved here reach members at once. To publish, close RSVPs or cancel, use the{" "}
            <Link className="font-semibold text-navy underline" href={`/events/${draft.id}`}>
              event page
            </Link>
            .
          </Note>
        ) : null}
        {ctx.history.problems.map((p) => (
          <Note key={p} tone="warn">
            {p}
          </Note>
        ))}

        <div role="group" aria-label="Show" className="flex rounded-full border border-line bg-white p-0.5 @[1000px]:hidden">
          {(["questions", "preview"] as const).map((p) => (
            <button key={p} type="button" aria-pressed={pane === p} onClick={() => setPane(p)} className={`min-h-[40px] flex-1 rounded-full text-[14px] font-semibold ${pane === p ? "bg-navy text-white" : "text-ink-2"}`}>
              {p === "questions" ? "Questions" : `Preview · ${readiness.percent}% ready`}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 items-start gap-5 @[1000px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
          <div className={`min-w-0 flex-col gap-3 ${pane === "preview" ? "hidden @[1000px]:flex" : "flex"}`}>
            <nav aria-label="Steps">
              <ol className="m-0 flex list-none gap-1.5 overflow-x-auto p-0 pb-1 @[1000px]:flex-wrap @[1000px]:overflow-visible @[1000px]:pb-0">
                {asked.map((c, i) => {
                  const current = c === step;
                  const locked = c !== "what" && !draft.id;
                  return (
                    <li key={c}>
                      <button
                        type="button"
                        aria-current={current ? "step" : undefined}
                        disabled={locked}
                        onClick={() => go(c)}
                        className={`min-h-[32px] whitespace-nowrap rounded-full border px-3 text-[12px] font-semibold disabled:cursor-not-allowed disabled:opacity-50 ${current ? "border-navy bg-navy text-white" : passed.includes(c) || i < index ? "border-line bg-white text-ink" : "border-line bg-white text-muted"}`}
                      >
                        {i + 1} {cardDef(c).label}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </nav>

            {step !== "review"
              ? asked.slice(0, Math.max(0, index)).map((c) => (
                  <div key={c} className="flex items-baseline justify-between gap-3 rounded-[12px] border border-line bg-white px-3 py-2 text-[14px]">
                    <span className="min-w-0">
                      <span className="block text-[11px] font-bold uppercase tracking-[0.06em] text-muted">{cardDef(c).label}</span>
                      <span className="text-ink">{summaryOf(c, draft, ctx, existing)}</span>
                    </span>
                    <button type="button" onClick={() => go(c)} className="min-h-[32px] shrink-0 text-[13px] font-semibold text-navy hover:underline">
                      Change<span className="sr-only"> {cardDef(c).label.toLowerCase()}</span>
                    </button>
                  </div>
                ))
              : null}

            <section aria-labelledby="creator-question" className="rounded-[16px] border border-line bg-white p-4 sm:p-5">
              <p className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
                Step {index + 1} of {total}
              </p>
              <h2 id="creator-question" ref={headingRef} tabIndex={-1} className="m-0 mb-4 mt-1 font-display text-[21px] font-semibold leading-[1.25] text-ink outline-none">
                {cardDef(step).question}
              </h2>
              {body}
              <div className="mt-4 flex flex-col gap-2">
                {cardError ? <ErrorNote>{cardError}</ErrorNote> : null}
                {saveError ? <ErrorNote onRetry={step === "review" ? saveNow : onContinue}>{saveError}</ErrorNote> : null}
              </div>
              {step !== "review" ? (
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                  <button type="button" className={softButton} disabled={!prev || saving} onClick={() => prev && go(prev)}>
                    Back
                  </button>
                  <div className="flex flex-wrap items-center gap-2">
                    {canSkip ? (
                      <button type="button" className="min-h-[40px] px-3 text-[14px] font-semibold text-navy hover:underline disabled:opacity-60" disabled={saving} onClick={onSkip}>
                        Skip
                      </button>
                    ) : null}
                    <button type="button" className={primaryButton} disabled={saving} onClick={onContinue}>
                      {saving ? "Saving…" : step === "what" && !draft.id ? "Save the draft and continue" : after(step, ctx) === "review" ? "Review" : "Continue"}
                    </button>
                  </div>
                </div>
              ) : prev ? (
                <div className="mt-4">
                  <button type="button" className={softButton} onClick={() => go(prev)}>
                    Back
                  </button>
                </div>
              ) : null}
            </section>
          </div>

          <aside aria-label="Preview" className={`min-w-0 flex-col gap-4 ${pane === "questions" ? "hidden @[1000px]:flex" : "flex"}`}>
            <FlyerSlot eventId={draft.id} name={draft.name} startsAt={fromDateTimeLocal(draft.starts_at, ctx.tz) ? draft.starts_at : null} venue={draft.venue.trim() || null} kindKey={ctx.community.kindKey} onFlyerChange={onFlyerChange} />
            <EventPreview draft={draft} ctx={ctx} existing={existing} mode={previewMode} onMode={setPreviewMode} />
            <ReadinessList readiness={readiness} onGo={go} />
          </aside>
        </div>
      </div>
    </div>
  );
}
