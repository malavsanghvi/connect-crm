"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ChipGroup } from "@/components/controls";
import { buttonClass } from "@/components/ui";
import {
  FLYER_ART_PROMPT_MAX,
  FLYER_PATTERNS,
  FLYER_PATTERN_LABEL,
  findBlockedArtTerm,
  type FlyerArtState,
  type FlyerBackground,
  type FlyerPattern,
} from "@/lib/events/flyer";
import type { FlyerBrand } from "@/lib/events/flyer-brand";
import { patternDataUri } from "@/lib/events/flyer-patterns";

import { flyerGenerationResultAction, listFlyerPhotosAction, requestEventFlyerAction, type FlyerPhotoList } from "./flyer-actions";

type Source = FlyerBackground["source"];

const SOURCES: { value: Source; label: string }[] = [
  { value: "pattern", label: "Pattern" },
  { value: "photo", label: "Photo from an album" },
  { value: "ai", label: "AI art (free)" },
  { value: "plain", label: "Plain colour" },
];

function ErrorLine({ children, onRetry, retryLabel = "Try again" }: { children: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry ? (
        <button type="button" className={buttonClass("ghost", "xs")} onClick={onRetry}>
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Flyer maker › Background: a pattern drawn in code, a photo from the
 * community's own albums, free AI background art, or a plain colour. Changes
 * reach the flyer through onChange; nothing is saved until "Use this flyer".
 */
export function FlyerBackgroundPicker({
  eventId,
  value,
  onChange,
  brand,
  isGuestVisible,
  artPromptSeed,
  initialArtUrl,
  initialArtError,
  disabled,
}: {
  eventId: string;
  value: FlyerBackground;
  onChange: (bg: FlyerBackground) => void;
  brand: FlyerBrand;
  isGuestVisible: boolean;
  artPromptSeed: string;
  initialArtUrl: string | null;
  initialArtError: string | null;
  disabled: boolean;
}) {
  const [tab, setTab] = useState<Source>(value.source);
  const [lastPattern, setLastPattern] = useState<FlyerPattern>(value.source === "pattern" ? value.pattern : "mandala");
  const [lastPhoto, setLastPhoto] = useState<string | null>(value.source === "photo" ? value.photo_id : null);
  const [lastArt, setLastArt] = useState<{ path: string; prompt: string; url: string | null } | null>(
    value.source === "ai" ? { path: value.path, prompt: value.prompt, url: initialArtUrl } : null,
  );

  // ── Patterns ──
  const thumbs = useMemo(
    () => Object.fromEntries(FLYER_PATTERNS.map((p) => [p, patternDataUri(p, { w: 120, h: 150, primary: brand.primary, accent: brand.accent, background: brand.background })])) as Record<FlyerPattern, string>,
    [brand.primary, brand.accent, brand.background],
  );

  // ── Photos ──
  const [photos, setPhotos] = useState<FlyerPhotoList | null>(null);
  const [photosError, setPhotosError] = useState<string | null>(null);
  const [photosLoading, setPhotosLoading] = useState(false);
  const loadedOnce = useRef(false);

  async function loadPhotos(albumId: string | null) {
    setPhotosLoading(true);
    setPhotosError(null);
    try {
      const res = await listFlyerPhotosAction(eventId, albumId);
      if (!res.ok) setPhotosError(res.error);
      else setPhotos(res.data ?? { albums: [], albumId: null, photos: [] });
    } catch (err) {
      console.error("[events/flyer] loading the photo albums failed:", err);
      setPhotosError("Could not load the photo albums — the server did not respond.");
    } finally {
      setPhotosLoading(false);
    }
  }

  useEffect(() => {
    if (tab === "photo" && !loadedOnce.current) {
      loadedOnce.current = true;
      void loadPhotos(null);
    }
    // loadPhotos only reads eventId, which never changes for this panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  // ── AI art ──
  const [prompt, setPrompt] = useState(value.source === "ai" && value.prompt ? value.prompt : artPromptSeed);
  const [art, setArt] = useState<FlyerArtState | null>(null);
  const [artError, setArtError] = useState<string | null>(initialArtError);
  const [artBusy, setArtBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  async function generate() {
    const text = prompt.replace(/\s+/g, " ").trim();
    if (!text) {
      setArtError("Describe the background art you want, in a sentence or two.");
      return;
    }
    const blocked = findBlockedArtTerm(text);
    if (blocked) {
      setArtError(`AI backgrounds are abstract or decorative only. Please take out "${blocked}" — no people, deities or murtis, and no lettering (the flyer adds the words itself).`);
      return;
    }
    setArtError(null);
    setArtBusy(true);
    try {
      const res = await requestEventFlyerAction(eventId, text);
      if (!res.ok) {
        setArtError(res.error);
        return;
      }
      let state = res.data!;
      setArt(state);
      // Poll for up to two minutes: the free image service can be slow.
      for (let i = 0; i < 60 && alive.current && (state.status === "queued" || state.status === "running"); i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const next = await flyerGenerationResultAction(eventId);
        if (!next.ok) {
          setArtError(next.error);
          return;
        }
        state = next.data!;
        setArt(state);
      }
      if (!alive.current) return;
      if (state.status === "queued" || state.status === "running") {
        setArtError("The background service has not answered within two minutes. Try again shortly, or choose a pattern or photo instead.");
      } else if (state.status === "failed" || state.status === "unavailable") {
        setArtError(state.reason);
      } else if (state.status === "ready") {
        const chosen = { path: state.artPath, prompt: text, url: state.artUrl };
        setLastArt(chosen);
        onChange({ source: "ai", path: chosen.path, prompt: chosen.prompt });
      } else {
        setArtError("The background service has no record of this request. Generate the art again.");
      }
    } catch (err) {
      console.error("[events/flyer] generating AI art failed:", err);
      setArtError("Could not make the AI art — the server did not respond.");
    } finally {
      if (alive.current) setArtBusy(false);
    }
  }

  function chooseTab(next: Source) {
    setTab(next);
    if (next === "pattern") onChange({ source: "pattern", pattern: lastPattern });
    else if (next === "plain") onChange({ source: "plain" });
    else if (next === "photo" && lastPhoto) onChange({ source: "photo", photo_id: lastPhoto });
    else if (next === "ai" && lastArt) onChange({ source: "ai", path: lastArt.path, prompt: lastArt.prompt });
  }

  const waiting = art?.status === "queued" || art?.status === "running";

  return (
    <div>
      <ChipGroup label="Background" options={SOURCES.map((s) => ({ value: s.value, label: s.label }))} value={tab} onChange={(v) => chooseTab(v as Source)} disabled={disabled} />

      {tab === "pattern" ? (
        <div className="mt-3 grid grid-cols-4 gap-2" role="radiogroup" aria-label="Pattern">
          {FLYER_PATTERNS.map((p) => {
            const on = value.source === "pattern" && value.pattern === p;
            return (
              <button
                key={p}
                type="button"
                role="radio"
                aria-checked={on}
                disabled={disabled}
                onClick={() => {
                  setLastPattern(p);
                  onChange({ source: "pattern", pattern: p });
                }}
                className={`flex flex-col items-center gap-1 rounded-[10px] border p-1.5 text-[12px] font-bold ${on ? "border-navy ring-2 ring-navy/30" : "border-line"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={thumbs[p]} alt="" width={120} height={150} className="h-auto w-full rounded-[6px]" />
                {FLYER_PATTERN_LABEL[p]}
              </button>
            );
          })}
        </div>
      ) : null}

      {tab === "photo" ? (
        <div className="mt-3">
          {isGuestVisible ? (
            <p className="mb-2 rounded-[10px] border border-saffron/40 bg-saffron-50 px-3 py-2 text-[13px] text-brown-900">
              Anyone who sees this flyer will see this photo, including guests.
            </p>
          ) : null}
          {photosError ? <ErrorLine onRetry={() => void loadPhotos(photos?.albumId ?? null)}>{photosError}</ErrorLine> : null}
          {photos && photos.albums.length ? (
            <>
              <label htmlFor="flyer-album" className="crm-label">
                Album
              </label>
              <select
                id="flyer-album"
                className="crm-input"
                value={photos.albumId ?? ""}
                disabled={disabled || photosLoading}
                onChange={(e) => void loadPhotos(e.target.value)}
              >
                {photos.albums.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.title}
                    {a.isEventAlbum ? " (this event)" : ""}
                    {a.visibility === "members" ? " · members" : ""}
                  </option>
                ))}
              </select>
              {photos.photos.length ? (
                <div className="mt-2 grid max-h-[280px] grid-cols-4 gap-2 overflow-y-auto sm:grid-cols-5" role="radiogroup" aria-label="Photo">
                  {photos.photos.map((p, i) => {
                    const on = value.source === "photo" && value.photo_id === p.id;
                    const albumTitle = photos.albums.find((a) => a.id === photos.albumId)?.title ?? "Album";
                    // A name a screen reader can tell apart: the caption when there is one, else the album and position.
                    const name = `${p.caption ? `${p.caption} — ` : ""}${albumTitle}, photo ${i + 1} of ${photos.photos.length}${p.problem ? ` (${p.problem})` : ""}`;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        aria-label={name}
                        title={p.problem ?? undefined}
                        disabled={disabled || !p.thumbUrl}
                        onClick={() => {
                          setLastPhoto(p.id);
                          onChange({ source: "photo", photo_id: p.id });
                        }}
                        className={`aspect-square overflow-hidden rounded-[8px] border bg-ground ${on ? "border-navy ring-2 ring-navy/40" : "border-line"}`}
                      >
                        {p.thumbUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.thumbUrl} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <span className="block p-1 text-[10px] leading-tight text-danger">{p.problem ?? "No preview"}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="crm-hint mt-2">{photosLoading ? "Loading photos…" : "This album has no approved photos the flyer maker can use (photos showing children, videos, WebP and HEIC are left out)."}</p>
              )}
              {value.source !== "photo" && !photosLoading && photos.photos.length ? <p className="crm-hint mt-1">Pick a photo to use it as the background.</p> : null}
            </>
          ) : photos && !photosError ? (
            <p className="crm-hint">No photo albums yet. Add one in Content › Photos, or choose a pattern or AI art.</p>
          ) : photosLoading ? (
            <p className="crm-hint">Loading the albums…</p>
          ) : null}
        </div>
      ) : null}

      {tab === "ai" ? (
        <div className="mt-3">
          <label htmlFor="flyer-art-prompt" className="crm-label">
            Describe the background art
          </label>
          <textarea
            id="flyer-art-prompt"
            rows={3}
            maxLength={FLYER_ART_PROMPT_MAX}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            className="crm-input"
            disabled={disabled || artBusy}
          />
          <p className="crm-hint">Always added: no text, letters, people, deities or murtis — abstract or decorative only.</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass("primary", "sm")} onClick={() => void generate()} disabled={disabled || artBusy}>
              {artBusy ? (waiting ? "Making the art…" : "Working…") : lastArt ? "Generate again" : "Generate"}
            </button>
            <span className="crm-hint">Free AI art may carry a small mark in a corner.</span>
          </div>
          {artError ? <ErrorLine onRetry={artBusy ? undefined : () => void generate()}>{artError}</ErrorLine> : null}
          {lastArt?.url ? (
            <div className="mt-2 flex items-start gap-3">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={lastArt.url} alt="The AI background art" className="h-[120px] w-[80px] rounded-[8px] border border-line object-cover" />
              <p className="crm-hint">
                {value.source === "ai" && value.path === lastArt.path ? "This art is the flyer's background. Look at the preview: free AI art can still include shapes you don't want." : "Art from earlier."}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {tab === "plain" ? <p className="crm-hint mt-2">A plain background in your brand colours.</p> : null}
    </div>
  );
}
