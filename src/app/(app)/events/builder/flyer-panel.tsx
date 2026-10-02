"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";

import { ActionForm } from "@/components/action-form";
import { ChipGroup, Toggle } from "@/components/controls";
import { Modal } from "@/components/modal";
import { useToast } from "@/components/toast";
import { Alert, Card, buttonClass } from "@/components/ui";
import {
  FLYER_LIMITS,
  FLYER_SIZES,
  FLYER_SIZE_KEYS,
  FLYER_SOURCE_LABEL,
  FLYER_TEMPLATES,
  FLYER_TEMPLATE_LABEL,
  flyerFileName,
  flyerTextLength,
  outOfDateWhat,
  parseFlyerDesign,
  type FlyerBackground,
  type FlyerDesign,
  type FlyerSource,
} from "@/lib/events/flyer";
import { flyerBrandSummary, type FlyerBrand } from "@/lib/events/flyer-brand";

import { saveDesignedFlyerAction, removeEventFlyerAction, uploadEventFlyerAction } from "./flyer-actions";
import { FlyerBackgroundPicker } from "./flyer-background-picker";

const SESSION_EXPIRED = "Your session has expired. Sign in again, then retry.";
const NO_MEMBER_APP = "The member web app's address (repository variable MEMBER_APP_URL) is not set, so there is no link to put in a QR code.";

type FlyerAnswer = { ok: true; blob: Blob; notes: string[] } | { ok: false; error: string };

/** Read the render route's answer: an image or PDF with notes, a JSON { error }, or (a sign-in page) an expired session. */
async function readFlyerAnswer(res: Response): Promise<FlyerAnswer> {
  const type = (res.headers.get("content-type") ?? "").toLowerCase();
  if (res.ok && (type.startsWith("image/png") || type.startsWith("application/pdf"))) {
    let notes: string[] = [];
    const raw = res.headers.get("x-flyer-notes");
    if (raw) {
      try {
        const v: unknown = JSON.parse(decodeURIComponent(raw));
        if (Array.isArray(v)) notes = v.filter((s): s is string => typeof s === "string");
      } catch (err) {
        console.error("[events/flyer] the flyer notes could not be read:", err);
        notes = ["Some notes about this flyer could not be read — check the preview carefully."];
      }
    }
    return { ok: true, blob: await res.blob(), notes };
  }
  if (type.includes("application/json")) {
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === "string" && body.error) return { ok: false, error: body.error };
    } catch (err) {
      console.error("[events/flyer] the flyer error could not be read:", err);
    }
    return { ok: false, error: `Could not make the flyer — the server answered ${res.status}. Try again.` };
  }
  return { ok: false, error: SESSION_EXPIRED };
}

function postFlyer(eventId: string, design: FlyerDesign, format: "png" | "pdf", scale: "preview" | "full", signal?: AbortSignal) {
  return fetch(`/api/events/${eventId}/flyer`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ design, format, scale }),
    signal,
    credentials: "same-origin",
  });
}

function InlineError({ children, onRetry }: { children: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="mt-2 flex flex-wrap items-center gap-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
      <span className="min-w-0 flex-1">{children}</span>
      {onRetry ? (
        <button type="button" className={buttonClass("ghost", "xs")} onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

function TextField({
  id,
  label,
  value,
  max,
  onChange,
  multiline = false,
  disabled,
  hint,
}: {
  id: string;
  label: string;
  value: string;
  max: number;
  onChange: (v: string) => void;
  multiline?: boolean;
  disabled: boolean;
  hint?: string;
}) {
  const used = flyerTextLength(value);
  const over = used > max;
  // The counter is read with the field (aria-describedby), not after every keystroke; going over the limit is announced once.
  const counterId = `${id}-count`;
  const describedBy = hint ? `${counterId} ${id}-hint` : counterId;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="crm-label">
          {label}
        </label>
        <span id={counterId} className={`text-[11px] font-bold ${over ? "text-danger" : "text-muted"}`}>
          <span className="sr-only">{`${used} of ${max} characters used`}</span>
          <span aria-hidden="true">
            {used}/{max}
          </span>
        </span>
      </div>
      {multiline ? (
        <textarea id={id} rows={2} value={value} onChange={(e) => onChange(e.target.value)} className="crm-input" disabled={disabled} aria-invalid={over} aria-describedby={describedBy} />
      ) : (
        <input id={id} value={value} onChange={(e) => onChange(e.target.value)} className="crm-input" disabled={disabled} aria-invalid={over} aria-describedby={describedBy} />
      )}
      {hint ? (
        <p id={`${id}-hint`} className="crm-hint">
          {hint}
        </p>
      ) : null}
      <span role="status" className="sr-only">
        {over ? `The ${label.toLowerCase()} is longer than ${max} characters.` : ""}
      </span>
    </div>
  );
}

/**
 * Event builder › Flyer maker (owner decisions 2026-10-01): design a flyer
 * from the brand kit — background, template, size, words, RSVP QR code — with
 * a live preview rendered by the server (POST /api/events/<id>/flyer), then
 * "Use this flyer" (Post or Story) or download a PNG, or a PDF at Print size.
 * Uploading your own flyer stays. The admin console links here as
 * /events/builder?event=<id>#flyer.
 */
export function FlyerPanel({
  eventId,
  eventName,
  flyerPath,
  flyerSource,
  previewUrl,
  previewError,
  editable,
  initialDesign,
  brand,
  memberAppLink,
  isGuestVisible,
  defaultTagline,
  eventLines,
  outOfDate,
  artPromptSeed,
  artPreview,
}: {
  eventId: string;
  eventName: string;
  flyerPath: string;
  flyerSource: FlyerSource | null;
  previewUrl: string | null;
  previewError: string | null;
  editable: boolean;
  initialDesign: FlyerDesign;
  brand: FlyerBrand;
  memberAppLink: string | null;
  isGuestVisible: boolean;
  defaultTagline: string;
  /** The event's own date and venue lines now (what "Use the event's date / venue" puts back). */
  eventLines: { date_line: string; venue_line: string };
  /** The event's date or venue changed after the saved flyer was made (flyerOutOfDate). */
  outOfDate: { date: boolean; venue: boolean };
  artPromptSeed: string;
  artPreview: { url: string | null; error: string | null };
}) {
  const router = useRouter();
  const toast = useToast();
  const [design, setDesign] = useState<FlyerDesign>(() => ({ ...initialDesign, show_qr: initialDesign.show_qr && Boolean(memberAppLink) }));
  const patch = (p: Partial<FlyerDesign>) => setDesign((d) => ({ ...d, ...p }));

  // ── Preview ──
  const [preview, setPreview] = useState<{ url: string | null; notes: string[]; error: string | null; loading: boolean }>({ url: null, notes: [], error: null, loading: false });
  const [tick, setTick] = useState(0);
  const urlRef = useRef<string | null>(null);
  const designKey = JSON.stringify(design);
  // A design the server would refuse is explained here, without asking it.
  const check = useMemo(() => parseFlyerDesign(design), [design]);
  const designError = check.ok ? null : check.error;

  useEffect(() => {
    if (!check.ok) return;
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      setPreview((p) => ({ ...p, loading: true }));
      try {
        const answer = await readFlyerAnswer(await postFlyer(eventId, check.design, "png", "preview", ctrl.signal));
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
        console.error("[events/flyer] the preview request failed:", err);
        setPreview((p) => ({ ...p, error: "Could not make the preview — the server did not respond. Check the connection and try again.", loading: false }));
      }
    }, 700);
    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
    // designKey stands for design (a new object on every change); tick is "Refresh preview".
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [designKey, tick, eventId]);

  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  // ── Downloads ──
  const [downloading, setDownloading] = useState<"png" | "pdf" | null>(null);
  const [downloadError, setDownloadError] = useState<{ format: "png" | "pdf"; message: string } | null>(null);

  async function download(format: "png" | "pdf") {
    const check = parseFlyerDesign(design);
    if (!check.ok) {
      setDownloadError({ format, message: check.error });
      return;
    }
    setDownloading(format);
    setDownloadError(null);
    try {
      const answer = await readFlyerAnswer(await postFlyer(eventId, check.design, format, "full"));
      if (!answer.ok) {
        setDownloadError({ format, message: answer.error });
        return;
      }
      const href = URL.createObjectURL(answer.blob);
      const a = document.createElement("a");
      a.href = href;
      a.download = flyerFileName(eventName, check.design.size, format);
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(href), 60_000);
      toast?.show(format === "pdf" ? "PDF downloaded." : "PNG downloaded.", "ok");
    } catch (err) {
      console.error("[events/flyer] the download failed:", err);
      setDownloadError({ format, message: "Could not download the flyer — the server did not respond. Check the connection and try again." });
    } finally {
      setDownloading(null);
    }
  }

  // ── Use this flyer ──
  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const hasFlyer = Boolean(flyerPath);
  const canUse = design.size !== "print";

  function save() {
    setSaveError(null);
    startSave(async () => {
      try {
        const res = await saveDesignedFlyerAction(eventId, design);
        if (!res.ok) {
          setSaveError(res.error);
          toast?.show(res.error, "bad");
          return;
        }
        toast?.show(res.message ?? "Flyer saved.", "ok");
        router.refresh();
      } catch (err) {
        console.error("[events/flyer] saving the flyer failed:", err);
        setSaveError("Could not save the flyer — the server did not respond. Check the connection and try again.");
      }
    });
  }

  function onBackground(bg: FlyerBackground) {
    setDesign((d) => ({ ...d, background: bg, template: d.template === "photo" && bg.source !== "photo" && bg.source !== "ai" ? "classic" : d.template }));
  }

  if (!editable) return null;

  const photoOk = design.background.source === "photo" || design.background.source === "ai";
  const designOk = check.ok;
  const label = flyerSource ? FLYER_SOURCE_LABEL[flyerSource] : null;
  const busy = saving || downloading !== null;
  const stale = hasFlyer && flyerSource === "designed" ? outOfDateWhat(outOfDate) : null;

  return (
    <div id="flyer" className="col-span-12 scroll-mt-24">
      <Card title="Flyer maker" description="Design a flyer from your brand kit, or upload your own">
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
          {/* ── Left: what goes on the flyer ── */}
          <div className="flex flex-col gap-4 lg:col-span-7">
            <section aria-labelledby="flyer-current">
              <h3 id="flyer-current" className="text-[13px] font-bold">
                Current flyer
              </h3>
              {hasFlyer ? (
                <div className="mt-1 flex flex-wrap items-start gap-3">
                  {previewUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={previewUrl} alt="Current event flyer" className="w-[140px] rounded-[10px] border border-line" />
                  ) : previewError ? (
                    <Alert tone="danger">{previewError}</Alert>
                  ) : (
                    <p className="crm-hint">Loading the current flyer…</p>
                  )}
                  <div className="flex flex-col gap-1">
                    {label ? <p className="crm-hint">{label}</p> : null}
                    <ActionForm
                      action={removeEventFlyerAction.bind(null, eventId)}
                      submitLabel="Remove"
                      variant="ghost"
                      size="xs"
                      confirmMessage={"Remove this event's flyer?\nThe flyer file is deleted; members and guests stop seeing it."}
                    />
                  </div>
                </div>
              ) : (
                <p className="crm-hint mt-1">No flyer yet. Design one below, or upload your own.</p>
              )}
            </section>

            <section aria-labelledby="flyer-bg">
              <h3 id="flyer-bg" className="mb-1 text-[13px] font-bold">
                Background
              </h3>
              <FlyerBackgroundPicker
                eventId={eventId}
                value={design.background}
                onChange={onBackground}
                brand={brand}
                isGuestVisible={isGuestVisible}
                artPromptSeed={artPromptSeed}
                initialArtUrl={artPreview.url}
                initialArtError={artPreview.error}
                disabled={busy}
              />
            </section>

            <section aria-labelledby="flyer-template">
              <h3 id="flyer-template" className="mb-1 text-[13px] font-bold">
                Template
              </h3>
              <ChipGroup
                label="Template"
                options={FLYER_TEMPLATES.map((t) => ({ value: t, label: FLYER_TEMPLATE_LABEL[t], disabled: t === "photo" && !photoOk }))}
                value={design.template}
                onChange={(v) => patch({ template: v as FlyerDesign["template"] })}
                disabled={busy}
              />
              {!photoOk ? <p className="crm-hint">The Photo template needs a photo or AI art background.</p> : null}
            </section>

            <section aria-labelledby="flyer-size">
              <h3 id="flyer-size" className="mb-1 text-[13px] font-bold">
                Size
              </h3>
              <ChipGroup
                label="Size"
                options={FLYER_SIZE_KEYS.map((s) => ({ value: s, label: FLYER_SIZES[s].label }))}
                value={design.size}
                onChange={(v) => patch({ size: v as FlyerDesign["size"] })}
                disabled={busy}
              />
            </section>

            <section aria-labelledby="flyer-words" className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <h3 id="flyer-words" className="text-[13px] font-bold sm:col-span-2">
                Words
              </h3>
              {stale ? (
                <div className="sm:col-span-2">
                  <Alert tone="warning" title={`The event's ${stale} changed after this flyer was made`}>
                    The saved flyer still shows the old {stale}. Update the {outOfDate.date && outOfDate.venue ? "date and venue lines" : `${stale} line`} below, then
                    choose Use this flyer.
                  </Alert>
                </div>
              ) : null}
              <div className="sm:col-span-2">
                <TextField id="flyer-headline" label="Headline" value={design.headline} max={FLYER_LIMITS.headline} onChange={(v) => patch({ headline: v })} disabled={busy} />
              </div>
              <div className="sm:col-span-2">
                <TextField
                  id="flyer-tagline"
                  label="Tagline"
                  value={design.tagline}
                  max={FLYER_LIMITS.tagline}
                  onChange={(v) => patch({ tagline: v })}
                  multiline
                  disabled={busy}
                  hint="Starts as the first sentence of the event's description."
                />
                {defaultTagline && design.tagline !== defaultTagline ? (
                  <button type="button" className={`${buttonClass("ghost", "xs")} mt-1`} onClick={() => patch({ tagline: defaultTagline })} disabled={busy}>
                    Use the description&apos;s first sentence
                  </button>
                ) : null}
              </div>
              <div>
                <TextField id="flyer-date" label="Date line" value={design.date_line} max={FLYER_LIMITS.date_line} onChange={(v) => patch({ date_line: v })} disabled={busy} />
                {eventLines.date_line && design.date_line !== eventLines.date_line ? (
                  <button type="button" className={`${buttonClass("ghost", "xs")} mt-1`} onClick={() => patch({ date_line: eventLines.date_line })} disabled={busy}>
                    Use the event&apos;s date
                  </button>
                ) : null}
              </div>
              <div>
                <TextField id="flyer-venue" label="Venue line" value={design.venue_line} max={FLYER_LIMITS.venue_line} onChange={(v) => patch({ venue_line: v })} disabled={busy} />
                {eventLines.venue_line && design.venue_line !== eventLines.venue_line ? (
                  <button type="button" className={`${buttonClass("ghost", "xs")} mt-1`} onClick={() => patch({ venue_line: eventLines.venue_line })} disabled={busy}>
                    Use the event&apos;s venue
                  </button>
                ) : null}
              </div>
            </section>

            <section aria-labelledby="flyer-qr">
              <h3 id="flyer-qr" className="mb-1 text-[13px] font-bold">
                RSVP QR code
              </h3>
              <Toggle
                label="RSVP QR code"
                checked={design.show_qr && Boolean(memberAppLink)}
                onChange={(on) => patch({ show_qr: on })}
                onNote={memberAppLink ? `Opens ${memberAppLink}` : "On"}
                offNote="No QR code"
                disabled={busy || !memberAppLink}
              />
              {!memberAppLink ? <p className="crm-hint">{NO_MEMBER_APP}</p> : null}
            </section>

            <p className="text-[12px] text-muted">
              {flyerBrandSummary(brand)} ·{" "}
              <Link href="/setup/profile" className="font-bold text-navy underline">
                Setup › Profile &amp; brand
              </Link>
            </p>

            <div className="rounded-[10px] border border-line-soft bg-ground p-3">
              <p className="text-[13px] font-bold">Upload your own</p>
              <ActionForm
                action={uploadEventFlyerAction}
                submitLabel={hasFlyer ? "Replace with this file" : "Upload"}
                pendingLabel="Uploading…"
                size="sm"
                resetOnSuccess
                buttonsClassName="mt-2"
                confirmMessage={hasFlyer ? "Replace the current flyer with this file? The old flyer file is deleted." : undefined}
              >
                <input type="hidden" name="event_id" value={eventId} />
                <input name="file" type="file" accept="image/png,image/jpeg,image/webp" aria-label="Flyer file" className="crm-input text-[12px]" required />
              </ActionForm>
            </div>
          </div>

          {/* ── Right: the preview and what to do with it ── */}
          <div className="lg:col-span-5">
            <div className="lg:sticky lg:top-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-bold">Preview</h3>
                <button type="button" className={buttonClass("ghost", "xs")} onClick={() => setTick((t) => t + 1)} disabled={preview.loading || Boolean(designError)}>
                  {preview.loading ? "Updating…" : "Refresh preview"}
                </button>
              </div>
              <div className="mt-2 flex min-h-[240px] items-center justify-center rounded-[12px] border border-line bg-ground p-2">
                {preview.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={preview.url}
                    alt="Flyer preview"
                    className={`max-h-[560px] w-auto max-w-full rounded-[6px] shadow-sm ${preview.loading || designError ? "opacity-60" : ""}`}
                  />
                ) : (
                  <p className="crm-hint">{designError ? "Fix the problem below to see the preview." : preview.loading ? "Making the preview…" : "The preview appears here in a moment."}</p>
                )}
              </div>
              {designError ? (
                <InlineError>{designError}</InlineError>
              ) : preview.error ? (
                <InlineError onRetry={() => setTick((t) => t + 1)}>{preview.error}</InlineError>
              ) : null}
              {preview.notes.length ? (
                <ul className="mt-2 flex flex-col gap-1 rounded-[10px] border border-saffron/40 bg-saffron-50 px-3 py-2 text-[12px] text-brown-900" role="status">
                  {preview.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className={buttonClass("ok", "sm")}
                  onClick={() => (hasFlyer ? setConfirm(true) : save())}
                  disabled={busy || !canUse || !designOk}
                >
                  {saving ? "Saving…" : "Use this flyer"}
                </button>
                <button type="button" className={buttonClass("ghost", "sm")} onClick={() => void download("png")} disabled={busy}>
                  {downloading === "png" ? "Preparing…" : "Download PNG"}
                </button>
                {design.size === "print" ? (
                  <button type="button" className={buttonClass("ghost", "sm")} onClick={() => void download("pdf")} disabled={busy}>
                    {downloading === "pdf" ? "Preparing…" : "Download PDF"}
                  </button>
                ) : null}
              </div>
              {!canUse ? <p className="crm-hint mt-1">Print is for downloading. Switch to Post or Story to use the design as the event&apos;s flyer.</p> : null}
              {saveError ? <InlineError onRetry={save}>{saveError}</InlineError> : null}
              {downloadError ? <InlineError onRetry={() => void download(downloadError.format)}>{downloadError.message}</InlineError> : null}
              <p className="crm-hint mt-2">
                {isGuestVisible
                  ? "Members and guests see the flyer in the member app once the event is published."
                  : "Members see the flyer in the member app once the event is published; guests don't, because this event is not open to guests."}
              </p>
            </div>
          </div>
        </div>
      </Card>

      <Modal
        open={confirm}
        kicker="Please confirm"
        title="Use this flyer?"
        confirmLabel="Use this flyer"
        tone="warn"
        pending={saving}
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          save();
        }}
      >
        This event already has a flyer. Using this one replaces it, and the old flyer file is deleted.
      </Modal>
    </div>
  );
}
