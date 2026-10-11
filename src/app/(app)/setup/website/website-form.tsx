"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { Card, StatusText, buttonClass } from "@/components/ui";
import {
  GIVE_UP_AFTER_MS,
  MAX_REFERENCES,
  SLOTS,
  addressOfSlot,
  isBusy,
  jobLine,
  nextPollDelay,
  readIsCurrent,
  savedSlots,
  slotLabel,
  type Slot,
} from "@/lib/site-found";

import { lookAtWebsiteAction, saveSiteAddressesAction, siteStatusAction } from "./actions";
import type { DraftSummary } from "@/lib/site-draft/types";

import { DraftPanel } from "./draft-panel";
import { FoundReport } from "./found-report";
import type { Snapshot } from "./load";

type Note = { tone: "ok" | "bad"; text: string };

/** The outcome next to what the person did (errors stay until the next try), with Try again where there is one. */
function NoteLine({ note, onRetry }: { note: Note | null; onRetry?: () => void }) {
  if (!note) return null;
  const cls =
    note.tone === "bad"
      ? "mt-2 rounded-[10px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger"
      : "mt-2 rounded-[10px] border border-success/30 bg-success-50 px-3 py-2 text-[13px] text-success-900";
  return (
    <p role={note.tone === "bad" ? "alert" : "status"} className={cls}>
      {note.text}
      {onRetry && note.tone === "bad" ? (
        <>
          {" "}
          <button type="button" onClick={onRetry} className="font-semibold underline">
            Try again
          </button>
        </>
      ) : null}
    </p>
  );
}

const pad = (refs: readonly string[]): string[] => Array.from({ length: MAX_REFERENCES }, (_, i) => refs[i] ?? "");

/**
 * Setup › Your website. Give the organization's own website and up to three it likes, press "Look at my website", watch the
 * reads (the screen asks politely, slower as time goes on, and not at all while the tab is hidden), then read "What we found".
 */
export function WebsiteForm({ initial, draft = { summary: null, error: null } }: { initial: Snapshot; draft?: { summary: DraftSummary | null; error: string | null } }) {
  const [snap, setSnap] = useState<Snapshot>(initial);
  const [readAt, setReadAt] = useState(() => Date.now());
  const fromProfile = initial.status.ownUrl === null && initial.status.profileWebsite !== null;
  const [own, setOwn] = useState(initial.status.ownUrl ?? initial.status.profileWebsite ?? "");
  const [refs, setRefs] = useState<string[]>(pad(initial.status.referenceUrls));
  const [saving, setSaving] = useState(false);
  const [looking, setLooking] = useState<Slot | "all" | null>(null);
  const [saveNote, setSaveNote] = useState<Note | null>(null);
  const [lookNote, setLookNote] = useState<Note | null>(null);
  const [checkNote, setCheckNote] = useState<Note | null>(null);
  const [gaveUp, setGaveUp] = useState(false);
  const [restart, setRestart] = useState(0);
  const viewsRef = useRef(snap.views);
  const lastSlot = useRef<Slot | undefined>(undefined);
  useEffect(() => {
    viewsRef.current = snap.views;
  }, [snap.views]);

  const status = snap.status;
  const now = new Date(readAt);
  const saved = savedSlots(status);
  const lines = saved.map((slot) => ({ slot, job: status.jobs.find((j) => j.slot === slot) ?? null }));
  const working = lines.some((l) => l.job !== null && isBusy(jobLine(l.job, now)));
  const busy = saving || looking !== null;
  const dirty = own.trim() !== (status.ownUrl ?? "") || refs.map((r) => r.trim()).filter(Boolean).join("\n") !== status.referenceUrls.join("\n");
  const anyAddress = own.trim() !== "" || refs.some((r) => r.trim() !== "");

  const apply = useCallback((data: Snapshot) => {
    setSnap((prev) => ({ status: data.status, views: { ...prev.views, ...data.views } }));
    setReadAt(Date.now());
  }, []);

  // Ask again while a read is on its way: quick at first, then slower; not while the tab is hidden; and stop after ten minutes.
  useEffect(() => {
    if (!working) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let asked = 0;
    const began = Date.now();
    const step = async () => {
      if (cancelled) return;
      if (Date.now() - began > GIVE_UP_AFTER_MS) {
        setGaveUp(true);
        return;
      }
      if (typeof document === "undefined" || document.visibilityState !== "hidden") {
        try {
          const have = Object.keys(viewsRef.current).map(Number);
          const res = await siteStatusAction(have);
          if (cancelled) return;
          if (!res.ok) {
            setCheckNote({ tone: "bad", text: res.error });
            return; // do not keep asking a server that is failing; the person decides
          }
          setCheckNote(null);
          if (res.data) apply(res.data);
          asked++;
        } catch (err) {
          console.error("[setup/website] checking on the websites failed:", err);
          if (!cancelled) setCheckNote({ tone: "bad", text: "Could not check on the websites — the server did not respond." });
          return;
        }
      }
      if (!cancelled) timer = setTimeout(step, nextPollDelay(asked));
    };
    timer = setTimeout(step, nextPollDelay(0));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [working, restart, apply]);

  const refresh = useCallback(async () => {
    setGaveUp(false);
    setCheckNote(null);
    try {
      const res = await siteStatusAction([]);
      if (!res.ok) {
        setCheckNote({ tone: "bad", text: res.error });
        return;
      }
      if (res.data) apply(res.data);
      setRestart((n) => n + 1);
    } catch (err) {
      console.error("[setup/website] loading the websites failed:", err);
      setCheckNote({ tone: "bad", text: "Could not load the websites — the server did not respond." });
    }
  }, [apply]);

  /** Save the addresses. True when they are saved (the form then shows the addresses as they were kept). */
  async function save(): Promise<boolean> {
    setSaveNote(null);
    setSaving(true);
    try {
      const res = await saveSiteAddressesAction(own, refs);
      if (!res.ok) {
        setSaveNote({ tone: "bad", text: res.error });
        return false;
      }
      if (res.data) {
        apply(res.data);
        setOwn(res.data.status.ownUrl ?? "");
        setRefs(pad(res.data.status.referenceUrls));
        setSaveNote({ tone: "ok", text: res.message ?? "Website addresses saved." });
      } else {
        setSaveNote({ tone: "ok", text: `${res.message ?? "Website addresses saved."} The page could not show them back just now; reload it to see them.` });
      }
      return true;
    } catch (err) {
      console.error("[setup/website] saving the addresses failed:", err);
      setSaveNote({ tone: "bad", text: "Could not save the website addresses — the server did not respond. Nothing was saved." });
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function onSave(e: FormEvent) {
    e.preventDefault();
    await save();
  }

  /** Read every saved website (slot omitted) or just one (Try again). Unsaved changes are saved first. */
  async function look(slot?: Slot) {
    lastSlot.current = slot;
    setLookNote(null);
    setCheckNote(null);
    if (!slot && dirty) {
      const ok = await save();
      if (!ok) return;
    }
    setLooking(slot ?? "all");
    try {
      const res = await lookAtWebsiteAction(slot);
      if (!res.ok) {
        setLookNote({ tone: "bad", text: res.error });
        return;
      }
      setGaveUp(false);
      setRestart((n) => n + 1);
      if (res.data) apply(res.data);
      else void refresh();
      setLookNote({ tone: "ok", text: res.message ?? "Looking at the website." });
    } catch (err) {
      console.error("[setup/website] starting the read failed:", err);
      setLookNote({ tone: "bad", text: "Could not start looking at the website — the server did not respond. Nothing was started." });
    } finally {
      setLooking(null);
    }
  }

  const reportSlots = SLOTS.filter((slot) => {
    const j = status.jobs.find((x) => x.slot === slot);
    return j !== undefined && j.status === "done" && addressOfSlot(status, slot) !== null;
  });

  // The first draft can be built once Weaver has finished looking: at the website saved as the organization's own, and at a
  // website it likes when there is no website of its own.
  const finishedNow = status.jobs.filter((j) => j.status === "done" && readIsCurrent(j, status));
  const ownFinished = finishedNow.some((j) => j.slot === "own");
  const canBuild = finishedNow.length > 0 && (status.ownUrl === null || ownFinished);
  const waitingReason = canBuild
    ? null
    : status.ownUrl !== null && !ownFinished && finishedNow.length > 0
      ? "Weaver has not finished looking at your website yet. When it has, you can build your draft."
      : "Press Look at my website first. When Weaver has finished looking, you can build your draft.";

  return (
    <div className="flex flex-col gap-4">
      <Card
        title="Your website and the ones you like"
        description="Weaver reads these to see what you already have. This is only a look: nothing is changed on any website, and nothing is published."
      >
        <form onSubmit={onSave} className="flex flex-col gap-4">
          <div>
            <label htmlFor="site-own" className="crm-label">
              Your website&apos;s address
            </label>
            <input
              id="site-own"
              type="text"
              inputMode="url"
              autoComplete="off"
              spellCheck={false}
              value={own}
              onChange={(e) => setOwn(e.target.value)}
              placeholder="https://www.example.org"
              className="crm-input font-mono text-[13px]"
            />
            <p className="crm-hint">
              {fromProfile && own === initial.status.profileWebsite
                ? "This is the website on your profile. Save to use it here."
                : "Its words and pictures are yours, so Weaver keeps them to help draft your new website."}
            </p>
          </div>
          <fieldset className="flex flex-col gap-2">
            <legend className="crm-label">Websites you like (up to {MAX_REFERENCES}, optional)</legend>
            {refs.map((value, i) => (
              <input
                key={i}
                id={`site-ref-${i + 1}`}
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck={false}
                aria-label={`Website you like, number ${i + 1}`}
                value={value}
                onChange={(e) => setRefs((prev) => prev.map((x, j) => (j === i ? e.target.value : x)))}
                placeholder="https://www.another-example.org"
                className="crm-input font-mono text-[13px]"
              />
            ))}
            <p className="crm-hint">
              Weaver looks only at how these are laid out: the order of their sections, menus, colours and fonts. Text and pictures from other websites are never copied.
            </p>
          </fieldset>
          <div className="flex flex-wrap items-center gap-2">
            <button type="submit" className={buttonClass("ghost")} disabled={busy || !dirty}>
              {saving ? "Saving…" : "Save addresses"}
            </button>
            <button type="button" className={buttonClass("primary")} disabled={busy || working || !anyAddress} onClick={() => void look()}>
              {looking === "all" ? "Starting…" : working ? "Looking…" : "Look at my website"}
            </button>
            {status.readsLastHour > 0 ? (
              <span className="text-[12px] text-muted">
                {status.readsLastHour} of {status.maxReadsPerHour} reads used in the last hour
              </span>
            ) : null}
          </div>
        </form>
        <NoteLine note={saveNote} onRetry={() => void save()} />
        <NoteLine note={lookNote} onRetry={() => void look(lastSlot.current)} />
      </Card>

      {lines.length > 0 ? (
        <Card title="How it is going" description="Each website is read by itself, one page at a time and politely. It usually takes one to three minutes.">
          <ul className="flex flex-col gap-3" aria-live="polite">
            {lines.map(({ slot, job }) => {
              const address = addressOfSlot(status, slot)!;
              const line = job ? jobLine(job, now) : null;
              const stale = job !== null && !readIsCurrent(job, status);
              const canRetry = line !== null && (line.phase === "failed" || line.phase === "stale" || line.phase === "cancelled");
              return (
                <li key={slot} className="flex flex-col gap-0.5 text-[13px]" data-slot={slot}>
                  <p>
                    <span className="font-semibold text-ink">{slotLabel(slot)}</span> <span className="break-all font-mono text-[12px] text-muted">{address}</span>
                  </p>
                  {line ? (
                    <p>
                      <StatusText tone={line.tone === "muted" ? "warn" : line.tone}>{line.label}</StatusText>
                      {line.detail ? <span className="text-muted"> · {line.detail}</span> : null}
                      {canRetry ? (
                        <>
                          {" "}
                          <button type="button" className="font-semibold underline" disabled={busy} onClick={() => void look(slot)}>
                            Try again
                          </button>
                        </>
                      ) : null}
                    </p>
                  ) : (
                    <p className="text-muted">Not looked at yet. Press Look at my website.</p>
                  )}
                  {stale && line?.phase === "done" ? <p className="text-muted">You changed this address after it was read. Press Look at my website to read the new one.</p> : null}
                </li>
              );
            })}
          </ul>
          <NoteLine note={checkNote} onRetry={() => void refresh()} />
          {working && gaveUp ? (
            <p className="mt-2 text-[13px] text-muted">
              This is taking longer than usual.{" "}
              <button type="button" className="font-semibold underline" onClick={() => void refresh()}>
                Check again
              </button>
            </p>
          ) : null}
        </Card>
      ) : null}

      {reportSlots.length > 0 ? (
        <section aria-label="What we found" className="flex flex-col gap-4">
          <h2 className="font-display text-[20px] font-semibold text-ink">What we found</h2>
          {reportSlots.map((slot) => {
            const job = status.jobs.find((j) => j.slot === slot)!;
            const slotView = snap.views[String(job.id)];
            return (
              <div key={slot} data-report-slot={slot} className="flex flex-col gap-2">
                {!readIsCurrent(job, status) ? (
                  <p className="text-[13px] text-muted">This was read before you changed the address. Press Look at my website to read the new one.</p>
                ) : null}
                {slotView?.ok ? (
                  <FoundReport view={slotView.view} />
                ) : slotView ? (
                  <NoteLine note={{ tone: "bad", text: slotView.error }} onRetry={() => void refresh()} />
                ) : (
                  <p className="text-[13px] text-muted">Loading what was found…</p>
                )}
              </div>
            );
          })}
          <p className="text-[13px] text-muted">That is everything Weaver found. Nothing on your website has changed. Next, build your first draft below.</p>
        </section>
      ) : null}

      <DraftPanel initial={draft.summary} canBuild={canBuild} waitingReason={waitingReason} loadError={draft.error} />
    </div>
  );
}
