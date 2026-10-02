"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";

import { useToast } from "@/components/toast";
import { Card, StatusText, TableWrap, buttonClass } from "@/components/ui";
import { formatDate } from "@/lib/dates";
import {
  discoveryBusy,
  discoveryJobLine,
  importBatches,
  junkReason,
  shortAddress,
  sitePageLine,
  type DiscoveryStatus,
  type SitePage,
} from "@/lib/niva-site";

import { discoverNivaSiteAction, importNivaSitePagesAction, nivaSitePagesAction } from "./discover-actions";

const POLL_MS = 3000;
const MAX_POLLS = 40; // two minutes, then staff are told to reload later

type Note = { tone: "ok" | "bad"; text: string };

/** The outcome next to what staff did (errors stay until the next try), with Try again where there is one. */
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

/** Pages ticked when a list first arrives: not imported yet, not on their way, and not junk. */
function initialTicks(pages: SitePage[]): Set<string> {
  return new Set(pages.filter((p) => p.sections === 0 && !p.importStatus && junkReason(p.url) === null).map((p) => p.url));
}

/**
 * content.draft: Content › Niva › Find a website's pages (B20, migration 0576). The background service reads
 * the site's sitemap (niva.discover_site); the list comes back here with checkboxes, and the ticked pages are
 * queued for import 50 at a time (app.niva_import_pages). Copies, old versions, members-only and legal pages
 * start unticked. Every page still arrives as draft sources that a content manager approves.
 */
export function DiscoverSitePages({ timeZone, defaultUrl = "" }: { timeZone: string; defaultUrl?: string | null }) {
  const toast = useToast();
  const [status, setStatus] = useState<DiscoveryStatus | null>(null);
  const [url, setUrl] = useState(defaultUrl ?? "");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [loadNote, setLoadNote] = useState<Note | null>(null);
  const [findNote, setFindNote] = useState<Note | null>(null);
  const [importNote, setImportNote] = useState<Note | null>(null);
  const [finding, setFinding] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [polls, setPolls] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // When the status was last read: a search queued 15 minutes before that and never finished is stale (the
  // background service did not run it), and the screen stops waiting for it.
  const [readAt, setReadAt] = useState(0);
  const listFor = useRef<string | null>(null);
  const urlTouched = useRef(false);

  const apply = useCallback((s: DiscoveryStatus) => {
    setStatus(s);
    setReadAt(Date.now());
    // A new list (a search that finished) resets the ticks; a refresh of the same list keeps what staff ticked.
    const key = s.job ? `${s.job.id}:${s.job.status}:${s.pages.length}` : `none:${s.pages.length}`;
    if (key !== listFor.current && !discoveryBusy(s.job)) {
      listFor.current = key;
      setTicked(initialTicks(s.pages));
    }
    if (!urlTouched.current && s.job?.url) setUrl(s.job.url);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await nivaSitePagesAction();
      if (!res.ok) {
        setLoadNote({ tone: "bad", text: res.error });
        return false;
      }
      setLoadNote(null);
      if (res.data) apply(res.data);
      return true;
    } catch (err) {
      console.error("[content/niva] loading the website's pages failed:", err);
      setLoadNote({ tone: "bad", text: "Could not load the website's pages — the server did not respond." });
      return false;
    }
  }, [apply]);

  // Load the list once, then keep checking while a search, or an import of a listed page, is on its way.
  const pages = status?.pages ?? [];
  const now = new Date(readAt);
  const working = discoveryBusy(status?.job ?? null, now) || pages.some((p) => p.importStatus === "queued" || p.importStatus === "running");
  useEffect(() => {
    const first = !loaded;
    if (!first && (!working || polls >= MAX_POLLS)) return;
    const t = setTimeout(
      () => {
        void load().then((ok) => {
          if (first) setLoaded(true);
          else setPolls((n) => (ok ? n + 1 : MAX_POLLS));
        });
      },
      first ? 0 : POLL_MS,
    );
    return () => clearTimeout(t);
  }, [loaded, working, polls, load]);

  async function find(e: FormEvent) {
    e.preventDefault();
    setFindNote(null);
    setImportNote(null);
    setFinding(true);
    try {
      const res = await discoverNivaSiteAction(url);
      if (!res.ok) {
        setFindNote({ tone: "bad", text: res.error });
        return;
      }
      setPolls(0);
      if (res.data) apply(res.data);
      else void load();
      setFindNote({ tone: "ok", text: res.message ?? "Looking for the website's pages." });
    } catch (err) {
      console.error("[content/niva] asking for the website's pages failed:", err);
      setFindNote({ tone: "bad", text: "Could not look for the website's pages — the server did not respond. Try again." });
    } finally {
      setFinding(false);
    }
  }

  async function importTicked() {
    const chosen = pages.filter((p) => ticked.has(p.url)).map((p) => p.url);
    if (chosen.length === 0) return;
    setImportNote(null);
    const done: string[] = [];
    let queued = 0;
    try {
      for (const group of importBatches(chosen)) {
        setImporting(`Queuing ${done.length + 1}–${done.length + group.length} of ${chosen.length}…`);
        const res = await importNivaSitePagesAction(group);
        if (!res.ok) {
          const rest = chosen.length - done.length;
          setImportNote({
            tone: "bad",
            text:
              done.length > 0
                ? `${done.length} of ${chosen.length} pages were queued; the other ${rest} were not. ${res.error} They are still ticked: press Import again to queue them.`
                : `${res.error} Nothing was queued; the pages are still ticked.`,
          });
          break;
        }
        queued += res.data?.queued ?? group.length;
        done.push(...group);
      }
    } catch (err) {
      console.error("[content/niva] queuing the chosen pages failed:", err);
      setImportNote({
        tone: "bad",
        text: `Could not import the chosen pages — the server did not respond.${done.length > 0 ? ` ${done.length} of ${chosen.length} were queued before that; the rest are still ticked.` : " Nothing was queued."} Press Import again.`,
      });
    } finally {
      setImporting(null);
    }
    if (done.length > 0) {
      setTicked((prev) => {
        const next = new Set(prev);
        for (const u of done) next.delete(u);
        return next;
      });
      setPolls(0);
      void load();
    }
    if (done.length === chosen.length) {
      const minutes = Math.max(1, Math.ceil((queued * 4) / 60));
      const text = `${queued} page${queued === 1 ? "" : "s"} queued. They are read a few seconds apart (about ${minutes} minute${minutes === 1 ? "" : "s"}); each one's sections arrive under Sources as drafts for you to read and send for approval.`;
      setImportNote({ tone: "ok", text });
      toast?.show(`${queued} page${queued === 1 ? "" : "s"} queued for import.`, "ok");
    }
  }

  const job = status?.job ?? null;
  const jobLine = discoveryJobLine(job, now);
  const searching = discoveryBusy(job, now);
  const busy = finding || searching;
  const tickedCount = pages.filter((p) => ticked.has(p.url)).length;
  const allTicked = pages.length > 0 && tickedCount === pages.length;
  const toggle = (u: string) =>
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(u)) next.delete(u);
      else next.add(u);
      return next;
    });

  return (
    <Card
      title="Find a website's pages"
      span={12}
      description="Niva reads the website's sitemap and lists its pages. Tick the ones Niva should learn from: each is imported as draft sources, and nothing reaches members until it is approved."
    >
      <form onSubmit={find} className="flex flex-col gap-1.5">
        <label htmlFor="niva-site-url" className="crm-label">
          Website address
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id="niva-site-url"
            type="url"
            inputMode="url"
            required
            value={url}
            onChange={(e) => {
              urlTouched.current = true;
              setUrl(e.target.value);
            }}
            placeholder="https://www.example.org"
            className="crm-input min-w-0 flex-1 font-mono text-[13px]"
          />
          <button type="submit" className={buttonClass("primary")} disabled={busy}>
            {finding ? "Asking…" : searching ? "Looking…" : "Find pages"}
          </button>
        </div>
      </form>
      <NoteLine note={findNote} />
      <NoteLine
        note={loadNote}
        onRetry={() => {
          setPolls(0);
          void load();
        }}
      />
      {jobLine ? (
        <p className="mt-3 text-[13px]">
          <StatusText tone={jobLine.tone}>{jobLine.label}</StatusText>
          {jobLine.detail ? <span className="text-muted"> · {jobLine.detail}</span> : null}
        </p>
      ) : null}
      {working && polls >= MAX_POLLS ? (
        <p className="mt-2 text-[13px] text-muted">
          Still working. Reload this page in a few minutes to see the rest.{" "}
          <button type="button" className="font-semibold underline" onClick={() => setPolls(0)}>
            Check again
          </button>
        </p>
      ) : null}

      {pages.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="min-w-0 flex-1 text-[13px] text-muted">
              {pages.length} page{pages.length === 1 ? "" : "s"} · {tickedCount} ticked. Copies, old versions, members-only, legal and event pages start unticked; pages Niva already has start unticked too. Importing one again refreshes its drafts and removes drafts the page no longer has; a section in review or published keeps its text and is flagged here when the page changed it or dropped it.
            </p>
            <button type="button" className={buttonClass("primary", "sm")} disabled={tickedCount === 0 || importing !== null} onClick={() => void importTicked()}>
              {importing ?? `Import ${tickedCount} ticked page${tickedCount === 1 ? "" : "s"}`}
            </button>
          </div>
          <NoteLine note={importNote} />
          <TableWrap>
            <table className="crm-table">
              <thead>
                <tr>
                  <th className="w-8">
                    <input
                      type="checkbox"
                      aria-label={allTicked ? "Untick every page" : "Tick every page"}
                      checked={allTicked}
                      onChange={() => setTicked(allTicked ? new Set() : new Set(pages.map((p) => p.url)))}
                    />
                  </th>
                  <th>Page</th>
                  <th>Sitemap says changed</th>
                  <th>In Niva</th>
                </tr>
              </thead>
              <tbody>
                {pages.map((p) => {
                  const junk = junkReason(p.url);
                  const line = sitePageLine(p);
                  const id = `niva-site-${p.url}`;
                  return (
                    <tr key={p.url}>
                      <td>
                        <input id={id} type="checkbox" checked={ticked.has(p.url)} onChange={() => toggle(p.url)} aria-label={`Import ${shortAddress(p.url)}`} />
                      </td>
                      <td className="max-w-[420px] break-all">
                        <label htmlFor={id} className="cursor-pointer">
                          {shortAddress(p.url)}
                        </label>{" "}
                        <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-[12px] text-muted underline">
                          open
                        </a>
                        {junk ? <div className="text-[12px] text-muted">{junk}</div> : null}
                      </td>
                      <td className="whitespace-nowrap">{p.lastmod ? formatDate(p.lastmod, timeZone) : "—"}</td>
                      <td>
                        {line.tone === "muted" ? <span className="text-muted">{line.label}</span> : <StatusText tone={line.tone}>{line.label}</StatusText>}
                        {line.detail ? <div className="text-[12px] text-muted">{line.detail}</div> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableWrap>
        </div>
      ) : status && !busy && job?.status === "done" ? (
        <p className="mt-3 text-[13px] text-muted">The sitemap listed no pages Niva can read. Paste addresses into Import from a web page instead.</p>
      ) : null}
    </Card>
  );
}
