"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useKind } from "@/components/kind-context";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import type { PosterContent } from "@/lib/events/flyer";
import {
  FLYER_LAYER_KINDS,
  FLYER_LAYER_LABEL,
  flyerOccasionsFor,
  FLYER_OCCASION_LABEL,
  artCostSentence,
  formatArtCost,
  isNewPicture,
  type FlyerArtEntry,
  type FlyerArtSetup,
  type FlyerLayer,
  type FlyerLayerKind,
  type FlyerOccasion,
} from "@/lib/events/flyer-art";
import { artPack, packLayerThumbnailSvg, packThumbnailSvg, svgDataUri } from "@/lib/events/flyer-art-packs";
import type { FlyerBrand } from "@/lib/events/flyer-brand";

import { collectFlyerArtAction, discardFlyerArtAction, loadFlyerArtAction, requestFlyerArtAction } from "./flyer-art-actions";
import { InlineError } from "./flyer-fields";

const POLL_MS = 2000;
/** Three minutes: Gemini usually answers in well under one. */
const POLL_TRIES = 90;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const LAYER_HELP: Record<FlyerLayerKind, string> = {
  frame: "The border and corner ornaments around the poster.",
  scene: "The picture along the bottom, above the footer.",
};

/** `retry`: "ask" asks Gemini again for the same layer (a new picture is paid for again), "check" looks for a picture still being made, "load" lists the library again. */
type Problem = { text: string; retry: "check" | "load" | "ask" | null };

/**
 * Flyer maker › Poster › Art (Flyers v2, approach C). Pick an occasion's art
 * pack — drawn in code, free, always available — then, for the frame and the
 * bottom scene separately, keep the drawn art, use a picture Gemini made
 * earlier for this occasion (free to reuse), or ask for a new one (the price is
 * on the button; it is made once and kept for everyone). Nothing here is
 * saved until "Use this flyer".
 */
export function FlyerArtPicker({
  eventId,
  brand,
  poster,
  onPoster,
  art,
  disabled,
}: {
  eventId: string;
  brand: FlyerBrand;
  poster: PosterContent;
  onPoster: (patch: Partial<PosterContent>) => void;
  art: FlyerArtSetup;
  disabled: boolean;
}) {
  const toast = useToast();
  const [setup, setSetup] = useState<FlyerArtSetup>(art);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<FlyerLayerKind | "waiting" | null>(null);
  const [progress, setProgress] = useState("");
  const [problem, setProblem] = useState<(Problem & { layer: FlyerLayerKind | null }) | null>(null);
  const [discard, setDiscard] = useState<FlyerArtEntry | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const alive = useRef(true);
  const occasionRef = useRef(poster.occasion);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    occasionRef.current = poster.occasion;
  }, [poster.occasion]);
  // What the picture list and the poster hold now, for the checks that run after a wait (a state value in a closure would be stale).
  const setupRef = useRef(setup);
  const posterRef = useRef(poster);
  useEffect(() => {
    setupRef.current = setup;
  }, [setup]);
  useEffect(() => {
    posterRef.current = poster;
  }, [poster]);
  // After a picture is discarded (its button and the dialog are gone) focus goes to the layer's first picture, once the dialog has closed.
  const focusAfterDiscard = useRef<string | null>(null);
  useEffect(() => {
    if (discard !== null || !focusAfterDiscard.current) return;
    document.getElementById(focusAfterDiscard.current)?.focus();
    focusAfterDiscard.current = null;
  }, [discard]);

  const brandKey = `${brand.primary}${brand.accent}${brand.background}`;
  // A kind without a tradition pack is offered the general and convention packs (and the one this poster already has).
  const kind = useKind();
  const occasions = useMemo(() => flyerOccasionsFor(kind, poster.occasion), [kind, poster.occasion]);
  const packs = useMemo(() => occasions.map((o) => ({ occasion: o, pack: artPack(o, brand) })), [brandKey, occasions]); // eslint-disable-line react-hooks/exhaustive-deps
  const pack = packs.find((p) => p.occasion === poster.occasion)?.pack ?? packs[0]!.pack;
  const thumbs = useMemo(
    () => Object.fromEntries(packs.map(({ occasion, pack: p }) => [occasion, svgDataUri(packThumbnailSvg(p, { frame: true, scene: true }))])) as Record<FlyerOccasion, string>,
    [packs],
  );
  const layerThumbs = useMemo(() => {
    const one = (kind: FlyerLayerKind | "none") => {
      const t = packLayerThumbnailSvg(pack, kind);
      return { src: svgDataUri(t.svg), w: t.w, h: t.h };
    };
    return { frame: one("frame"), scene: one("scene"), none: one("none") };
  }, [pack]);

  const ready = setup.readiness.state === "ready" ? setup.readiness : null;
  const notReady = setup.readiness.state === "ready" ? null : setup.readiness;
  const setLayer = (kind: FlyerLayerKind, value: FlyerLayer) => onPoster(kind === "frame" ? { frame: value } : { scene: value });

  async function reload(occasion: FlyerOccasion) {
    setLoading(true);
    try {
      const res = await loadFlyerArtAction(eventId, occasion);
      if (!alive.current || occasionRef.current !== occasion) return;
      if (!res.ok) {
        setProblem({ text: res.error, retry: "load", layer: null });
        return;
      }
      setSetup(res.data!);
    } catch (err) {
      console.error("[events/flyer] loading the AI art failed:", err);
      if (alive.current) setProblem({ text: "Could not load the AI art — the server did not respond. Check the connection and try again.", retry: "load", layer: null });
    } finally {
      if (alive.current) setLoading(false);
    }
  }

  /**
   * Show a picture that was made (it is kept either way). It joins the pictures of the occasion on screen, or, when it was made for
   * another occasion (asked for, then the occasion was changed), it is left for that occasion and the person is told which.
   */
  function addEntry(entry: FlyerArtEntry): boolean {
    if (entry.occasion !== occasionRef.current) {
      setProgress(`A ${FLYER_LAYER_LABEL[entry.layer].toLowerCase()} for ${FLYER_OCCASION_LABEL[entry.occasion]} is ready and kept. Choose that occasion to use it.`);
      return false;
    }
    setSetup((s) => (s.entries.some((e) => e.path === entry.path) ? s : { ...s, entries: [entry, ...s.entries] }));
    return true;
  }

  /** Wait for the picture being made (`layer`: the one just asked for, so a failure is shown beside it). */
  async function waitForPicture(onReady: (e: FlyerArtEntry) => void, layer: FlyerLayerKind | null = null): Promise<void> {
    for (let i = 0; i < POLL_TRIES && alive.current; i++) {
      await sleep(POLL_MS);
      const next = await collectFlyerArtAction(eventId);
      if (!alive.current) return;
      if (!next.ok) {
        setProblem({ text: next.error, retry: "check", layer: null });
        return;
      }
      const s = next.data!;
      if (s.status === "queued" || s.status === "running") continue;
      if (s.status === "ready") {
        if (addEntry(s.entry)) onReady(s.entry);
        return;
      }
      if (s.status === "failed" || s.status === "unavailable") {
        setProblem({ text: s.reason, retry: layer && s.status === "failed" ? "ask" : null, layer });
        return;
      }
      setProblem({ text: "The background service has no record of this request. Ask again.", retry: layer ? "ask" : null, layer });
      return;
    }
    if (alive.current) {
      setProblem({
        text: "Gemini has not answered within three minutes. The picture is kept if it finishes — check again in a moment, or use the drawn art.",
        retry: "check",
        layer: null,
      });
    }
  }

  async function ask(layer: FlyerLayerKind) {
    setProblem(null);
    setBusy(layer);
    setProgress(`Asking Gemini for a ${FLYER_LAYER_LABEL[layer].toLowerCase()}… this usually takes under a minute.`);
    try {
      const res = await requestFlyerArtAction(eventId, poster.occasion, layer);
      if (!res.ok) {
        setProblem({ text: res.error, retry: null, layer });
        setProgress("");
        return;
      }
      const st = res.data!;
      if (st.status === "unavailable" || st.status === "failed") {
        setProblem({ text: st.reason, retry: st.status === "failed" ? "ask" : null, layer });
        setProgress("");
        void reload(poster.occasion);
        return;
      }
      await waitForPicture((entry) => {
        setLayer(entry.layer, { source: "ai", path: entry.path });
        setProgress(`A new ${FLYER_LAYER_LABEL[entry.layer].toLowerCase()} is ready and is now on the poster. Pick another picture to change it.`);
      }, layer);
      if (alive.current) setProgress((p) => (p.startsWith("Asking") ? "" : p));
    } catch (err) {
      console.error("[events/flyer] asking for AI art failed:", err);
      if (alive.current) {
        setProblem({ text: "Could not ask for the picture — the server did not respond. Check the connection and try again.", retry: "ask", layer });
        setProgress("");
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  /**
   * A picture may have finished while this page was closed (it was paid for): keep it, or keep waiting for it.
   * `quiet` (when the panel opens) says nothing unless there is something to report.
   */
  async function resume(quiet = false) {
    if (!quiet) {
      setProblem(null);
      setBusy("waiting");
      setProgress("Checking on a picture that was being made…");
    }
    try {
      const res = await collectFlyerArtAction(eventId);
      if (!alive.current) return;
      if (!res.ok) {
        setProblem({ text: res.error, retry: "check", layer: null });
        setProgress("");
        return;
      }
      const s = res.data!;
      if (s.status === "queued" || s.status === "running") {
        setBusy("waiting");
        setProgress("A picture is still being made. It will be added to the pictures here when it is done.");
        await waitForPicture(() => setProgress("A new picture is ready. It is with the other pictures: choose it to use it."));
      } else if (s.status === "ready") {
        // Opening the panel again finds the last picture asked for every time (the job keeps its stored file): one that is already
        // listed, already on the poster or kept for another occasion is nothing new, so say nothing (a screen reader would announce
        // it on every visit). Asked to check ("Try again"), the person gets an answer either way.
        const news = isNewPicture(s.entry, { occasion: occasionRef.current, listed: setupRef.current.entries, poster: posterRef.current });
        if ((news || !quiet) && addEntry(s.entry)) setProgress("A picture you asked for earlier is ready. It is with the other pictures: choose it to use it.");
      } else {
        setProgress("");
      }
    } catch (err) {
      console.error("[events/flyer] checking on the AI art failed:", err);
      if (alive.current) {
        setProblem({ text: "Could not check on the picture — the server did not respond.", retry: "check", layer: null });
        setProgress("");
      }
    } finally {
      if (alive.current) setBusy(null);
    }
  }

  useEffect(() => {
    // Once, when the panel opens: resume() only reads eventId, which never changes for this panel.
    const timer = setTimeout(() => {
      if (art.readiness.state === "ready") void resume(true);
    }, 0);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function chooseOccasion(o: FlyerOccasion) {
    if (o === poster.occasion) return;
    setProblem(null);
    setProgress("");
    onPoster({ occasion: o, frame: { source: "code" }, scene: { source: "code" } });
    occasionRef.current = o;
    setSetup((s) => ({ ...s, entries: [], problem: null }));
    void reload(o);
  }

  async function confirmDiscard() {
    const entry = discard;
    if (!entry) return;
    setDiscarding(true);
    try {
      const res = await discardFlyerArtAction(eventId, entry.path);
      if (!res.ok) {
        setProblem({ text: res.error, retry: null, layer: entry.layer });
        toast?.show(res.error, "bad");
        return;
      }
      setSetup((s) => ({ ...s, entries: s.entries.filter((e) => e.path !== entry.path) }));
      const current = poster[entry.layer];
      if (current.source === "ai" && current.path === entry.path) setLayer(entry.layer, { source: "code" });
      // The Discard button is gone now: keep the keyboard focus on this layer's pictures, not on nothing.
      focusAfterDiscard.current = `poster-art-${entry.layer}-drawn`;
      toast?.show("Picture discarded.", "ok");
      setProgress("Picture discarded. The drawn art is back on the poster.");
    } catch (err) {
      console.error("[events/flyer] discarding the AI art failed:", err);
      setProblem({ text: "Could not discard the picture — the server did not respond. Try again.", retry: null, layer: entry.layer });
    } finally {
      setDiscarding(false);
      setDiscard(null);
    }
  }

  const waiting = busy !== null;
  /** Whether a problem offers a "Try again" (not while something else is going on), and what it does. */
  const canRetry = (p: Problem, kind: FlyerLayerKind | null) => !waiting && (p.retry === "check" || p.retry === "load" || (p.retry === "ask" && kind !== null));
  function runRetry(p: Problem, kind: FlyerLayerKind | null) {
    if (p.retry === "check") void resume();
    else if (p.retry === "load") void reload(poster.occasion);
    else if (p.retry === "ask" && kind) void ask(kind);
  }
  const tile = (selected: boolean, label: string, onSelect: () => void, children: ReactNode, wide: boolean, id?: string) => (
    <button
      id={id}
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={label}
      disabled={disabled || waiting}
      onClick={onSelect}
      className={`flex flex-col items-center gap-1 rounded-[10px] border p-1.5 text-[12px] font-bold ${wide ? "w-[150px]" : "w-[84px]"} ${selected ? "border-navy ring-2 ring-navy/30" : "border-line"} disabled:opacity-60`}
    >
      {children}
      <span aria-hidden="true">{label}</span>
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div>
        <p className="crm-label" id="poster-occasion-label">
          Occasion
        </p>
        <div role="radiogroup" aria-labelledby="poster-occasion-label" className="mt-1 grid grid-cols-4 gap-2 sm:grid-cols-4">
          {packs.map(({ occasion }) => {
            const on = occasion === poster.occasion;
            return (
              <button
                key={occasion}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled || waiting}
                onClick={() => chooseOccasion(occasion)}
                className={`flex flex-col items-center gap-1 rounded-[10px] border p-1.5 text-center text-[11px] font-bold leading-tight ${on ? "border-navy ring-2 ring-navy/30" : "border-line"} disabled:opacity-60`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbs[occasion]} alt="" width={120} height={180} loading="lazy" className="h-auto w-full rounded-[6px] border border-line-soft" />
                {FLYER_OCCASION_LABEL[occasion]}
              </button>
            );
          })}
        </div>
        <p className="crm-hint">{pack.blurb}. Drawn in code: free, and it always works.</p>
      </div>

      {setup.problem ? <InlineError onRetry={() => void reload(poster.occasion)}>{setup.problem}</InlineError> : null}

      {FLYER_LAYER_KINDS.map((kind) => {
        const layer = poster[kind];
        const entries = setup.entries.filter((e) => e.layer === kind);
        const t = layerThumbs[kind];
        const wide = kind === "scene";
        const label = FLYER_LAYER_LABEL[kind];
        const here = problem && problem.layer === kind ? problem : null;
        return (
          <fieldset key={kind} className="rounded-[10px] border border-line-soft p-2" disabled={disabled}>
            <legend className="px-1 text-[13px] font-bold">{label}</legend>
            <p className="crm-hint">{LAYER_HELP[kind]}</p>
            <div role="radiogroup" aria-label={`${label} art`} className="mt-1 flex flex-wrap gap-2">
              {tile(
                layer.source === "code",
                "Drawn",
                () => setLayer(kind, { source: "code" }),
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.src} alt="" width={wide ? 138 : 72} height={wide ? Math.round((138 * t.h) / t.w) : Math.round((72 * t.h) / t.w)} className="rounded-[6px]" style={{ backgroundColor: pack.palette.paper }} />,
                wide,
                `poster-art-${kind}-drawn`,
              )}
              {entries.map((e, i) =>
                tile(
                  layer.source === "ai" && layer.path === e.path,
                  `AI picture ${i + 1}`,
                  () => setLayer(kind, { source: "ai", path: e.path }),
                  e.url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={e.url} alt="" loading="lazy" className={`rounded-[6px] object-cover ${wide ? "h-[60px] w-[138px]" : "h-[108px] w-[72px]"}`} />
                  ) : (
                    <span className={`flex items-center justify-center rounded-[6px] bg-ground p-1 text-[10px] font-normal text-danger ${wide ? "h-[60px] w-[138px]" : "h-[108px] w-[72px]"}`}>Preview not available</span>
                  ),
                  wide,
                ),
              )}
              {tile(
                layer.source === "none",
                "None",
                () => setLayer(kind, { source: "none" }),
                // eslint-disable-next-line @next/next/no-img-element
                <img src={layerThumbs.none.src} alt="" width={wide ? 138 : 72} height={wide ? 60 : 108} className="rounded-[6px] object-cover" style={{ height: wide ? 60 : 108 }} />,
                wide,
              )}
            </div>
            {layer.source === "ai" ? (
              <button
                type="button"
                className={`${buttonClass("ghost", "xs")} mt-2`}
                disabled={disabled || waiting}
                onClick={() => {
                  const e = setup.entries.find((x) => x.path === layer.path);
                  setDiscard(e ?? { path: layer.path, layer: kind, occasion: poster.occasion, seed: 0, url: null });
                }}
              >
                Discard this {label.toLowerCase()} picture…
              </button>
            ) : null}
            {ready ? (
              <div className="mt-2">
                <button type="button" className={buttonClass("primary", "sm")} disabled={disabled || waiting || loading} onClick={() => void ask(kind)}>
                  {busy === kind ? "Asking Gemini…" : `Ask Gemini for ${entries.length ? "another" : "a"} ${label.toLowerCase()} (${formatArtCost(ready.cents)})`}
                </button>
              </div>
            ) : null}
            {here ? <InlineError onRetry={canRetry(here, kind) ? () => runRetry(here, kind) : undefined}>{here.text}</InlineError> : null}
          </fieldset>
        );
      })}

      {ready ? (
        <p className="crm-hint">
          {artCostSentence(ready.model)} Look at the preview: AI art can still include shapes you don&apos;t want — Discard it if so.
        </p>
      ) : notReady ? (
        <div className="rounded-[10px] border border-navy/20 bg-navy-50 px-3 py-2 text-[13px] text-navy">
          <p>{notReady.message}</p>
          {notReady.state === "unknown" ? (
            <button type="button" className={`${buttonClass("ghost", "xs")} mt-2`} onClick={() => void reload(poster.occasion)} disabled={loading}>
              {loading ? "Checking…" : "Check again"}
            </button>
          ) : null}
        </div>
      ) : null}

      {problem && problem.layer === null ? <InlineError onRetry={canRetry(problem, null) ? () => runRetry(problem, null) : undefined}>{problem.text}</InlineError> : null}
      <p role="status" aria-live="polite" className="text-[12px] text-muted">
        {progress}
      </p>

      <Modal
        open={discard !== null}
        kicker="Please confirm"
        title="Discard this picture?"
        confirmLabel="Discard picture"
        tone="warn"
        pending={discarding}
        onCancel={() => setDiscard(null)}
        onConfirm={() => void confirmDiscard()}
      >
        The picture is removed for your whole community and can&apos;t be brought back (making another costs again). Flyers already saved with it keep looking the same; if you open one
        later, the drawn art is used until you choose another.
      </Modal>
    </div>
  );
}
