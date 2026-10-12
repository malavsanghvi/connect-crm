"use client";

// The event creator's flyer-first panel (owner, 2026-10-11: "need the flyer draft immediately. There, give the option to
// publish / schedule to publish on all channels"). Beside the creator's question cards: the flyer draft, drawn by the
// existing flyer maker on the server the moment the draft event has a name and a date, then the publish panel
// (publish-box.tsx). The approved interaction is the prototype's "flyer and publish panel"
// (docs/EVENT_CREATION.md section 3): the poster is three layers, a frame and a bottom scene drawn in code (free, or a
// picture Google Gemini made, through the flyer maker's own flow and price) and the words, which code always sets, so they
// are always right.
//
// Nothing here is published or sent: approving saves the flyer as the event's flyer (the flyer maker's "Use this flyer")
// with the approval recorded in the design, and the publish box runs the existing status change. FlyerPanel loads what
// it needs by itself (loadFlyerPanelAction), so the creator only passes the event's id and words.

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { readFlyerAnswer, postFlyer, type FlyerAnswer } from "@/app/(app)/events/builder/flyer-panel";
import { FlyerArtPicker } from "@/app/(app)/events/builder/flyer-art-picker";
import { LayoutBlockEditors, LayoutChooser, LayoutPosterWords } from "@/app/(app)/events/builder/flyer-layout-editor";
import { saveDesignedFlyerAction } from "@/app/(app)/events/builder/flyer-actions";
import {
  cancelScheduledPublishAction,
  loadFlyerPanelAction,
  publishEventNowAction,
  scheduleEventPublishAction,
  withdrawFlyerApprovalAction,
  type FlyerPanelSetup,
} from "@/app/(app)/events/flyer-publish-actions";
import { ChipGroup } from "@/components/controls";
import { useKind } from "@/components/kind-context";
import { btn, card } from "@/components/onboarding-front/parts";
import type { ActionResult } from "@/lib/errors";
import {
  FLYER_SIZES,
  FLYER_SIZE_KEYS,
  FLYER_TEMPLATES,
  FLYER_TEMPLATE_LABEL,
  defaultFlyerDesign,
  parseFlyerDesign,
  type FlyerDesign,
} from "@/lib/events/flyer";
import { FLYER_LAYER_LABEL, NO_GEMINI_KEY, formatArtCost } from "@/lib/events/flyer-art";
import { greetingFor } from "@/lib/events/flyer-layout";
import { fromDateTimeLocal } from "@/lib/events/format";
import { approvalState, drawnTakes, nextDrawnTake } from "@/lib/events/publish-schedule";

import type { FlyerSlotProps } from "../flyer-slot";
import { PublishBox } from "./publish-box";

export type { FlyerSlotProps };

/**
 * The event's start as an instant. The creator passes its wall-clock answer ("2026-11-08T18:00", in the community's zone);
 * an ISO instant (with Z or an offset) is taken as it is.
 */
export function startInstant(startsAt: string | null, tz: string): string | null {
  if (!startsAt) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(startsAt)) return fromDateTimeLocal(startsAt, tz);
  return Number.isNaN(Date.parse(startsAt)) ? null : startsAt;
}

/** What the panel does on the server: the real ones call the flyer maker and the Server Actions; the dev preview fakes them. */
export type FlyerPanelServices = {
  load: (eventId: string) => Promise<ActionResult<FlyerPanelSetup>>;
  render: (eventId: string, design: FlyerDesign, signal: AbortSignal) => Promise<FlyerAnswer>;
  approve: (eventId: string, design: FlyerDesign) => Promise<ActionResult>;
  withdraw: (eventId: string) => Promise<ActionResult>;
  publishNow: (eventId: string) => Promise<ActionResult>;
  schedule: (eventId: string, local: string) => Promise<ActionResult<{ publishAt: string }>>;
  cancelSchedule: (eventId: string) => Promise<ActionResult>;
};

/** The styles in the order the panel offers them: the Poster (the default, with drawn art) first. */
const PANEL_TEMPLATES = ["poster", ...FLYER_TEMPLATES.filter((t) => t !== "poster")] as const;

const NO_ANSWER = "the server did not respond. Check the connection and try again.";

/** Turn a thrown error (the server not answering) into a plain result, logged. */
async function safely<T>(doing: string, fn: () => Promise<ActionResult<T>>): Promise<ActionResult<T>> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[event-creator/flyer] ${doing} failed:`, err);
    return { ok: false, error: `Could not ${doing} — ${NO_ANSWER}` };
  }
}

/** The services a page gives every flyer panel under it (the dev previews give stand-ins); none means the real ones. */
const ServicesContext = createContext<FlyerPanelServices | null>(null);
export function FlyerServicesProvider({ services, children }: { services: FlyerPanelServices; children: ReactNode }) {
  return <ServicesContext.Provider value={services}>{children}</ServicesContext.Provider>;
}

export const realFlyerServices: FlyerPanelServices = {
  load: (id) => safely("load the flyer", () => loadFlyerPanelAction(id)),
  render: async (id, design, signal) => readFlyerAnswer(await postFlyer(id, design, "png", "preview", signal)),
  approve: (id, design) => safely("approve the flyer", () => saveDesignedFlyerAction(id, design, { approve: true })),
  withdraw: (id) => safely("withdraw the approval", () => withdrawFlyerApprovalAction(id)),
  publishNow: (id) => safely("publish the event", () => publishEventNowAction(id)),
  schedule: (id, local) => safely("schedule the publish", () => scheduleEventPublishAction(id, local)),
  cancelSchedule: (id) => safely("cancel the schedule", () => cancelScheduledPublishAction(id)),
};

/** The words code sets on the flyer from the event (headline, date line, venue line, the poster's ribbon). */
function eventWords(setup: FlyerPanelSetup, name: string, startsAt: string | null, venue: string | null) {
  const d = defaultFlyerDesign({
    name: name || setup.event.name,
    description: setup.event.description,
    venue: venue ?? setup.event.venue,
    startsAt: startsAt ?? setup.event.starts_at,
    endsAt: setup.event.ends_at,
    tz: setup.tz,
    qrAvailable: setup.memberAppLink !== null,
  });
  return { headline: d.headline, date_line: d.date_line, venue_line: d.venue_line, ribbon: d.poster?.ribbon ?? null };
}
type Words = ReturnType<typeof eventWords>;

/** Put the event's new words on the design wherever the design still shows the event's previous words (a hand edit stays). */
function applyWords(design: FlyerDesign, before: Words, after: Words): FlyerDesign {
  const next: FlyerDesign = { ...design };
  if (design.headline === before.headline) next.headline = after.headline;
  if (design.date_line === before.date_line) next.date_line = after.date_line;
  if (design.venue_line === before.venue_line) next.venue_line = after.venue_line;
  if (design.poster && after.ribbon && before.ribbon) {
    const r = design.poster.ribbon;
    next.poster = {
      ...design.poster,
      ribbon: { ...r, date: r.date === before.ribbon.date ? after.ribbon.date : r.date, time: r.time === before.ribbon.time ? after.ribbon.time : r.time },
    };
  }
  return next;
}

/**
 * The flyer slot's panel. Before the draft event exists (no id yet, or no name or date) it says the flyer appears as soon as
 * they are given. Then it loads its setup and shows the flyer and the publish box.
 */
export function FlyerPanel({ eventId, name, startsAt, venue, onFlyerChange, services: given }: FlyerSlotProps & { services?: FlyerPanelServices }) {
  const fromPage = useContext(ServicesContext);
  const services = given ?? fromPage ?? realFlyerServices;
  const [setup, setSetup] = useState<FlyerPanelSetup | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const ready = Boolean(eventId && name.trim() && startsAt);
  // The creator saves the event as the cards are answered: after the event's words change, look again (shortly after).
  const wordsKey = `${name}|${startsAt ?? ""}|${venue ?? ""}`;
  const firstWords = useRef(wordsKey);
  useEffect(() => {
    if (firstWords.current === wordsKey) return;
    firstWords.current = wordsKey;
    const t = setTimeout(() => setTick((n) => n + 1), 1200);
    return () => clearTimeout(t);
  }, [wordsKey]);
  // Tell the creator when the event's flyer changes (approving saves it), so its readiness list is right at once.
  const flyerPath = setup?.event.flyer_path ?? null;
  const loaded = setup !== null;
  useEffect(() => {
    if (loaded) onFlyerChange?.(flyerPath);
  }, [loaded, flyerPath, onFlyerChange]);

  useEffect(() => {
    if (!ready || !eventId) return;
    let alive = true;
    void services.load(eventId).then((res) => {
      if (!alive) return;
      if (res.ok && res.data) {
        setSetup(res.data);
        setProblem(null);
      } else setProblem(res.ok ? "Could not load the flyer — the server sent nothing back. Try again." : res.error);
    });
    return () => {
      alive = false;
    };
  }, [ready, eventId, tick, services]);

  if (!ready || !eventId) {
    return (
      <section aria-labelledby="flyer-draft-title" className={card}>
        <h2 id="flyer-draft-title" className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
          Your flyer draft
        </h2>
        <p className="mt-2 text-[14px] leading-[1.55] text-ink-2">
          The flyer is drawn as soon as the event has a name and a date. It uses your brand kit and the event&apos;s words, and you can publish or schedule it from here.
        </p>
      </section>
    );
  }
  if (!setup) {
    return (
      <section aria-labelledby="flyer-draft-title" className={card} aria-busy={!problem}>
        <h2 id="flyer-draft-title" className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
          Your flyer draft
        </h2>
        {problem ? (
          <div role="alert" className="mt-3 flex flex-wrap items-center gap-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            <span className="min-w-0 flex-1">{problem}</span>
            <button type="button" className={btn.outline} onClick={() => setTick((t) => t + 1)}>
              Try again
            </button>
          </div>
        ) : (
          <p className="mt-2 text-[14px] text-muted">Drawing your flyer…</p>
        )}
      </section>
    );
  }
  return <FlyerPanelView key={eventId} eventId={eventId} name={name} startsAt={startsAt} venue={venue} setup={setup} services={services} onReload={() => setTick((t) => t + 1)} />;
}

export function FlyerPanelView({
  eventId,
  name,
  startsAt,
  venue,
  setup,
  services,
  onReload,
}: {
  eventId: string;
  name: string;
  startsAt: string | null;
  venue: string | null;
  setup: FlyerPanelSetup;
  services: FlyerPanelServices;
  onReload: () => void;
}) {
  const [design, setDesign] = useState<FlyerDesign>(() => {
    const start = setup.saved ?? setup.defaults;
    return { ...start, show_qr: start.show_qr && Boolean(setup.memberAppLink) };
  });
  const patch = (p: Partial<FlyerDesign>) => setDesign((d) => ({ ...d, ...p }));
  // Flyers v3: the layout of the poster's words, and the greeting of the community's tradition offered with it ("" when it has none).
  const greeting = greetingFor({ kind: useKind() });
  const onPoster = (fn: (p: NonNullable<FlyerDesign["poster"]>) => NonNullable<FlyerDesign["poster"]>) => setDesign((d) => (d.poster ? { ...d, poster: fn(d.poster) } : d));

  // The event's words follow the answers: what the design still shows from the event's previous words is replaced.
  const startsIso = useMemo(() => startInstant(startsAt, setup.tz), [startsAt, setup.tz]);
  const words = useMemo(() => eventWords(setup, name, startsIso, venue), [setup, name, startsIso, venue]);
  const wordsRef = useRef(words);
  useEffect(() => {
    const before = wordsRef.current;
    wordsRef.current = words;
    if (before !== words) setDesign((d) => applyWords(d, before, words));
  }, [words]);

  // The poster's occasion follows the event's name (the suggestion the setup brings back after each answer) until the
  // person chooses one, or chooses any of the art, themselves: their choice is kept from then on.
  const pickedArt = useRef(Boolean(setup.saved));
  const suggested = setup.defaults.poster?.occasion ?? null;
  const suggestedRef = useRef(suggested);
  useEffect(() => {
    const before = suggestedRef.current;
    suggestedRef.current = suggested;
    if (!suggested || before === suggested || pickedArt.current) return;
    setDesign((d) => (d.poster && d.poster.occasion === before ? { ...d, poster: { ...d.poster, occasion: suggested, frame: { source: "code" }, scene: d.poster.scene.source === "none" ? d.poster.scene : { source: "code" } } } : d));
  }, [suggested]);

  // ── The preview, rendered by the server ──
  const check = useMemo(() => parseFlyerDesign(design), [design]);
  const designKey = JSON.stringify(design);
  const [preview, setPreview] = useState<{ url: string | null; notes: string[]; error: string | null; loading: boolean }>({ url: null, notes: [], error: null, loading: true });
  const [renderTick, setRenderTick] = useState(0);
  const urlRef = useRef<string | null>(null);
  useEffect(() => {
    if (!check.ok) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setPreview((p) => ({ ...p, loading: true }));
      try {
        const answer = await services.render(eventId, check.design, ctrl.signal);
        if (ctrl.signal.aborted) return;
        if (!answer.ok) {
          setPreview((p) => ({ ...p, error: answer.error, loading: false }));
          return;
        }
        const url = URL.createObjectURL(answer.blob);
        if (urlRef.current) URL.revokeObjectURL(urlRef.current);
        urlRef.current = url;
        setPreview({ url, notes: answer.notes, error: null, loading: false });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        console.error("[event-creator/flyer] the preview request failed:", err);
        setPreview((p) => ({ ...p, error: `Could not draw the flyer — ${NO_ANSWER}`, loading: false }));
      }
    }, 450);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // designKey stands for the design (a new object on every change); renderTick is Try again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designKey, renderTick, eventId, services]);
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  // ── Art: drawn takes, Gemini through the flyer maker's own picker ──
  const isPoster = design.template === "poster" && Boolean(design.poster);
  const takes = useMemo(() => drawnTakes(setup.occasions), [setup.occasions]);
  const [showLayers, setShowLayers] = useState(false);
  const layersRef = useRef<HTMLDetailsElement | null>(null);
  function anotherTake() {
    pickedArt.current = true;
    if (isPoster && design.poster) {
      const p = design.poster;
      const take = nextDrawnTake(takes, { occasion: p.occasion, frame: p.frame.source === "code", scene: p.scene.source === "code" });
      if (!take) return;
      patch({ poster: { ...p, occasion: take.occasion, frame: { source: take.frame ? "code" : "none" }, scene: { source: take.scene ? "code" : "none" } } });
      return;
    }
    // The other templates draw a pattern behind the words, or none.
    const bg = design.background;
    patch({ background: bg.source === "pattern" ? { source: "plain" } : { source: "pattern", pattern: "mandala" } });
  }
  const artReady = setup.art.readiness.state === "ready" ? setup.art.readiness : null;
  const artNote = setup.art.readiness.state === "ready" ? null : setup.art.readiness.state === "no_key" ? NO_GEMINI_KEY : setup.art.readiness.message;

  // ── Approval ──
  const eventNow = { name: name || setup.event.name, starts_at: startsIso ?? setup.event.starts_at, ends_at: setup.event.ends_at, venue: venue ?? setup.event.venue };
  const approval = approvalState(setup.event, eventNow, check.ok ? check.design : null);

  const busyRef = useRef(false);
  const run = useCallback(
    async (fn: () => Promise<ActionResult<unknown>>): Promise<ActionResult<unknown>> => {
      if (busyRef.current) return { ok: false, error: "Still working on the last step. Wait a moment." };
      busyRef.current = true;
      try {
        const res = await fn();
        if (res.ok) onReload();
        return res;
      } finally {
        busyRef.current = false;
      }
    },
    [onReload],
  );

  const photoOk = design.background.source === "photo" || design.background.source === "ai";
  const layerWord = (kind: "frame" | "scene") => {
    const l = design.poster?.[kind];
    return !l ? "" : l.source === "code" ? "Drawn" : l.source === "ai" ? "AI picture" : "None";
  };

  return (
    <div className="flex flex-col gap-4" data-testid="flyer-panel">
      <section aria-labelledby="flyer-draft-title" className={card}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="flyer-draft-title" className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">
            Your flyer draft, ready now
          </h2>
          {preview.loading ? (
            <span className="text-[12px] text-muted" role="status">
              Updating…
            </span>
          ) : null}
        </div>

        <div className="mt-3 flex min-h-[260px] items-center justify-center rounded-[12px] border border-line bg-ground p-2">
          {preview.url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={preview.url}
              alt={`Flyer draft for ${design.headline}: ${FLYER_TEMPLATE_LABEL[design.template]} template, ${FLYER_SIZES[design.size].label}`}
              className={`max-h-[520px] w-auto max-w-full rounded-[6px] shadow-sm ${preview.loading ? "opacity-70" : ""}`}
            />
          ) : (
            <p className="text-[13px] text-muted">{check.ok ? "Drawing your flyer…" : "Fix the problem below to see the flyer."}</p>
          )}
        </div>
        {!check.ok ? (
          <p role="alert" className="mt-2 text-[13px] text-danger">
            {check.error}
          </p>
        ) : preview.error ? (
          <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
            <span className="min-w-0 flex-1">{preview.error}</span>
            <button type="button" className={btn.outline} onClick={() => setRenderTick((t) => t + 1)}>
              Try again
            </button>
          </div>
        ) : null}
        {preview.notes.length ? (
          <ul className="mt-2 flex list-none flex-col gap-1 rounded-[10px] border border-saffron-200 bg-saffron-50 px-3 py-2 text-[12px] text-brown-900" role="status">
            {preview.notes.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        ) : null}

        <div className="mt-3 flex flex-col gap-2">
          <span className="text-[12px] font-bold text-ink-2" id="flyer-template-label">
            Style
          </span>
          <ChipGroup
            label="Flyer style"
            options={PANEL_TEMPLATES.map((t) => ({ value: t, label: FLYER_TEMPLATE_LABEL[t], disabled: t === "photo" && !photoOk }))}
            value={design.template}
            onChange={(v) => setDesign((d) => ({ ...d, template: v as FlyerDesign["template"], ...(v === "poster" && !d.poster ? { poster: setup.defaults.poster } : {}) }))}
          />
          {!photoOk ? <p className="m-0 text-[12px] text-muted">Photo needs a photo or an AI picture behind the words: choose one in the full flyer maker.</p> : null}
          <span className="mt-1 text-[12px] font-bold text-ink-2">Size</span>
          <ChipGroup label="Flyer size" options={FLYER_SIZE_KEYS.map((s) => ({ value: s, label: FLYER_SIZES[s].label }))} value={design.size} onChange={(v) => patch({ size: v as FlyerDesign["size"] })} />
          {design.size === "print" ? <p className="m-0 text-[12px] text-muted">Print is for downloading from the full flyer maker. Choose Post, Square, Tall or Story to approve and publish.</p> : null}
          {isPoster && design.poster ? (
            <>
              <span className="mt-1 text-[12px] font-bold text-ink-2">Layout</span>
              <LayoutChooser poster={design.poster} brand={setup.brand} headline={design.headline} greeting={greeting} onPoster={onPoster} disabled={false} />
            </>
          ) : null}
        </div>

        {isPoster && design.poster?.layout ? (
          <details className="mt-3 rounded-[12px] border border-line px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-bold text-ink">Edit the words on the layout</summary>
            <div className="mt-2 flex flex-col gap-3">
              <LayoutPosterWords poster={design.poster} onPoster={onPoster} disabled={false} />
              <LayoutBlockEditors poster={design.poster} headline={design.headline} greeting={greeting} onPoster={onPoster} disabled={false} />
            </div>
          </details>
        ) : null}

        <div className="mt-3 flex flex-wrap gap-2">
          <button type="button" className={btn.outline} onClick={anotherTake}>
            Another drawn take
          </button>
          {isPoster ? (
            artReady ? (
              <button
                type="button"
                className={btn.outline}
                onClick={() => {
                  setShowLayers(true);
                  requestAnimationFrame(() => layersRef.current?.scrollIntoView({ block: "nearest" }));
                }}
              >
                Ask Gemini for new art ({formatArtCost(artReady.cents)} each)
              </button>
            ) : (
              <button type="button" className={btn.off} disabled aria-describedby="flyer-art-note">
                Ask Gemini for new art
              </button>
            )
          ) : null}
        </div>
        {isPoster && artNote ? (
          <p id="flyer-art-note" className="mt-1 text-[12px] text-muted">
            {artNote}
          </p>
        ) : null}

        {isPoster ? (
          <dl className="mt-3 grid grid-cols-3 gap-2 text-[12px]">
            <div className="rounded-[10px] bg-ground px-3 py-2">
              <dt className="font-bold text-ink-2">{FLYER_LAYER_LABEL.frame}</dt>
              <dd className="m-0 text-muted">{layerWord("frame")}</dd>
            </div>
            <div className="rounded-[10px] bg-ground px-3 py-2">
              <dt className="font-bold text-ink-2">{FLYER_LAYER_LABEL.scene}</dt>
              <dd className="m-0 text-muted">{layerWord("scene")}</dd>
            </div>
            <div className="rounded-[10px] bg-ground px-3 py-2">
              <dt className="font-bold text-ink-2">Words</dt>
              <dd className="m-0 text-muted">Always set by Weaver</dd>
            </div>
          </dl>
        ) : null}

        {isPoster && design.poster ? (
          <details ref={layersRef} open={showLayers} onToggle={(e) => setShowLayers((e.currentTarget as HTMLDetailsElement).open)} className="mt-3 rounded-[12px] border border-line px-3 py-2">
            <summary className="cursor-pointer text-[13px] font-bold text-ink">Choose the art layers</summary>
            {showLayers ? (
              <div className="mt-2">
                <FlyerArtPicker
                  eventId={eventId}
                  brand={setup.brand}
                  poster={design.poster}
                  onPoster={(p) => {
                    pickedArt.current = true;
                    setDesign((d) => (d.poster ? { ...d, poster: { ...d.poster, ...p } } : d));
                  }}
                  art={setup.art}
                  suggestions={setup.suggestions}
                  disabled={false}
                />
              </div>
            ) : null}
          </details>
        ) : null}

        <p className="mt-3 text-[12px] leading-[1.5] text-muted">
          Made from your brand kit and the event&apos;s words; it updates as you answer. {setup.brandSummary}.{" "}
          <Link href={`/events/builder?event=${eventId}#flyer`} className="font-bold text-navy underline">
            Open the full flyer maker
          </Link>{" "}
          to change the words, use a photo or upload your own file.
        </p>
      </section>

      <PublishBox
        eventId={eventId}
        setup={setup}
        design={check.ok ? check.design : null}
        approval={approval}
        eventNow={eventNow}
        canApprove={setup.canEdit && check.ok && design.size !== "print"}
        run={run}
        services={services}
        onReload={onReload}
      />
    </div>
  );
}

