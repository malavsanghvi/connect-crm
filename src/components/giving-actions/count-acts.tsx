"use client";

// The counts' sheets (docs/GIVING_REDESIGN.md slice 5, B93), on Today, on the counts tab and wherever a count row shows:
//   Start a count       date, two or three adult counters (the last count's filled in), the total in big figures, the notes and
//                       coins if the person counts by them, bags, the event. The existing createCountingSessionAction saves it.
//   Match its deposit   the bank lines of EXACTLY the counted amount near the counting day; one line is chosen for the person
//                       only when it is the only one. app.link_count_to_bank_deposit (0744) checks everything again.
//   Undo the match      a treasurer, with a reason that is kept in the audit trail (app.unlink_count_from_bank_deposit).
// No <form>: Enter never saves a sheet. "Done: …" shows only after the server said so.

import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";

import { countSheetAction, depositChoicesAction, matchCountDepositAction, unmatchCountDepositAction } from "@/app/(app)/giving/counts/actions";
import { createCountingSessionAction } from "@/app/(app)/giving/payments/counting-actions";
import type { CardLabels } from "@/components/household-card";
import { useStepUp } from "@/components/step-up";
import { buttonClass } from "@/components/ui";
import type { CountSheetData, DepositChoices } from "@/lib/data/giving-counts";
import { formatDate } from "@/lib/dates";
import { denominationLabel, readDenominations, reconcileTotal } from "@/lib/giving-counts/denominations";
import { counterCheck, MATCH_UNDO, matchButton, type CounterChoice } from "@/lib/giving-counts/model";
import { familyLine, type Act, type QueueRow } from "@/lib/giving-today/queue";
import { formatCents, parseAmountToCents } from "@/lib/money";

import { GivingSheet } from "./sheet";

type Result = { ok: boolean; error?: string; message?: string; stepUp?: boolean };
type RowLike = Pick<QueueRow, "family" | "title" | "lines">;

/** The parts of a row's context these sheets use (row-actions' ActContext fits). */
export type CountActContext = {
  currency: string;
  locale: string;
  timeZone: string;
  labels: CardLabels;
  onDone: (text: string) => void;
  trigger?: "button" | "menu";
};

const MENU_ITEM = "flex min-h-[44px] w-full items-center rounded-[10px] px-3 py-2 text-left text-[14px] font-semibold hover:bg-canvas";
const SMALL = "min-h-[40px] max-w-full whitespace-normal py-1.5 text-center";

function triggerClass(ctx: CountActContext, primary: boolean, tone?: "danger"): string {
  if (ctx.trigger === "menu") return `${MENU_ITEM} ${tone === "danger" ? "text-danger" : "text-ink"}`;
  return `${buttonClass(primary ? "primary" : "ghost", "sm")} ${SMALL}`;
}

function doneFrom(message: string | undefined, fallback: string): string {
  const m = (message ?? "").trim();
  return m ? `Done: ${m}` : fallback;
}

/** Run a server action: a fresh 2FA check when the database asks for one, the error in plain English otherwise. */
function useRun() {
  const stepUp = useStepUp();
  const [pending, start] = useTransition();
  const [error, setError] = useState<ReactNode>(null);
  function run<R extends Result>(doing: string, fn: () => Promise<R>, onOk: (r: R) => void) {
    setError(null);
    start(async () => {
      try {
        const res = stepUp ? await stepUp.run(fn, doing) : await fn();
        if (!res.ok) {
          setError(res.error ?? `Could not ${doing.toLowerCase()}.`);
          return;
        }
        onOk(res);
      } catch (err) {
        console.error(`[giving-counts] ${doing} failed:`, err);
        setError(`Could not ${doing.toLowerCase()}: the server did not respond. Reload the page to see whether it went through before trying again.`);
      }
    });
  }
  return { pending, error, setError, run };
}

function Evidence({ row, children }: { row: RowLike; children?: ReactNode }) {
  return (
    <>
      <p className="m-0 font-bold text-ink">{row.title}</p>
      {row.lines.map((l) => (
        <p key={l} className="m-0">
          {l}
        </p>
      ))}
      {children}
    </>
  );
}

// ---------------------------------------------------------------------------- Match its deposit

export function MatchCountAct({ act, row, ctx }: { act: Extract<Act, { kind: "count_match" }>; row: RowLike; ctx: CountActContext }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DepositChoices | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const { pending, error, setError, run } = useRun();
  const choice = data?.choices.find((c) => c.id === picked) ?? null;
  const fmt = { currency: data?.currency ?? ctx.currency, locale: data?.locale ?? ctx.locale, timeZone: data?.timeZone ?? ctx.timeZone };

  function openSheet() {
    setError(null);
    setLoadError(null);
    setData(null);
    setPicked(null);
    setOpen(true);
    startLoading(async () => {
      try {
        const res = await depositChoicesAction(act.id);
        if (!res.ok || !res.data) {
          setLoadError(res.error ?? "Could not load the bank deposits.");
          return;
        }
        setData(res.data);
        setPicked(res.data.preselect);
      } catch (err) {
        console.error("[giving-counts] loading the bank deposits failed:", err);
        setLoadError("Could not load the bank deposits: the server did not respond. Close this and try again.");
      }
    });
  }

  return (
    <>
      <button type="button" className={triggerClass(ctx, true)} onClick={openSheet}>
        Match its deposit
      </button>
      {open ? (
        <GivingSheet
          title={act.label}
          family={null}
          labels={ctx.labels}
          what={
            <Evidence row={row}>
              <p className="m-0 mt-1">{act.what}</p>
            </Evidence>
          }
          error={error}
          confirmLabel={matchButton(choice, fmt)}
          pending={pending}
          confirmDisabled={!choice || loading}
          onClose={() => setOpen(false)}
          onConfirm={() =>
            choice &&
            run("Match the count to its deposit", () => matchCountDepositAction(act.id, choice.id), (r) => {
              setOpen(false);
              ctx.onDone(doneFrom(r.message, "Done: the count is matched to its deposit."));
            })
          }
        >
          {loading ? (
            <p role="status" className="m-0 text-[14px] text-muted">
              Looking for the deposit of exactly {formatCents(act.totalCents, ctx.currency, ctx.locale)}…
            </p>
          ) : loadError ? (
            <p role="alert" className="m-0 rounded-[12px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
              {loadError}
            </p>
          ) : data && data.choices.length === 0 ? (
            <p className="m-0 rounded-[12px] bg-saffron-50 px-3 py-2 text-[14px] leading-[1.5] text-ink-2">{data.none}</p>
          ) : data ? (
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="mb-1 text-[13px] font-bold text-ink">
                {data.choices.length === 1 ? "The bank deposit of exactly this amount" : "Pick the bank deposit of this count"}
              </legend>
              {data.choices.map((c) => (
                <label
                  key={c.id}
                  className={`flex min-h-[52px] cursor-pointer items-start gap-3 rounded-[12px] border-[1.5px] px-3 py-2.5 ${picked === c.id ? "border-navy bg-navy-50" : "border-line bg-white"}`}
                >
                  <input type="radio" name={`deposit-${act.id}`} value={c.id} checked={picked === c.id} onChange={() => setPicked(c.id)} className="mt-1 h-5 w-5" />
                  <span className="min-w-0">
                    <span className="block text-[15px] font-bold text-ink">{c.label}</span>
                    <span className="block break-words text-[13px] text-muted">{c.description}</span>
                  </span>
                </label>
              ))}
            </fieldset>
          ) : null}
          <p className="m-0 text-[13px] leading-[1.45] text-muted">{MATCH_UNDO}</p>
        </GivingSheet>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------- Undo the match

export function UnmatchCountAct({ act, row, ctx }: { act: Extract<Act, { kind: "count_unmatch" }>; row: RowLike; ctx: CountActContext }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const { pending, error, setError, run } = useRun();
  return (
    <>
      <button
        type="button"
        className={triggerClass(ctx, false, "danger")}
        onClick={() => {
          setError(null);
          setReason("");
          setOpen(true);
        }}
      >
        Undo the deposit match
      </button>
      {open ? (
        <GivingSheet
          title={act.label}
          family={null}
          labels={ctx.labels}
          what={
            <Evidence row={row}>
              <p className="m-0 mt-1">{act.what} The bank line opens again only if this match had closed it. A locked month cannot be changed.</p>
            </Evidence>
          }
          error={error}
          tone="danger"
          confirmLabel={`Undo the match of ${formatCents(act.totalCents, ctx.currency, ctx.locale)}`}
          pending={pending}
          confirmDisabled={reason.trim().length === 0}
          onClose={() => setOpen(false)}
          onConfirm={() =>
            run("Undo the deposit match", () => unmatchCountDepositAction(act.id, reason), (r) => {
              setOpen(false);
              ctx.onDone(doneFrom(r.message, "Done: the match is undone."));
            })
          }
        >
          <div>
            <label htmlFor={`unmatch-${act.id}`} className="mb-1 block text-[13px] font-bold text-ink">
              Why is the match being undone? (kept in the audit trail)
            </label>
            <textarea id={`unmatch-${act.id}`} value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} className="crm-input min-h-20 w-full" />
          </div>
        </GivingSheet>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------- Start a count

const BIG = "crm-input w-full text-[26px] font-semibold tabular-nums leading-tight";

function fd(fields: [string, string][]): FormData {
  const f = new FormData();
  for (const [k, v] of fields) f.append(k, v);
  return f;
}

/** The counters picked, each with their household card, and whether they come from different households. */
function CounterCards({ picked, labels }: { picked: CounterChoice[]; labels: CardLabels }) {
  const check = counterCheck(picked);
  if (picked.length === 0) return null;
  return (
    <div className="flex flex-col gap-1.5">
      {picked.map((p) => (
        <div key={p.userId} className="rounded-[12px] border border-line bg-white px-3 py-2">
          <p className="m-0 text-[14px] font-bold text-ink">{p.name}</p>
          <p className="m-0 text-[12.5px] leading-[1.4] text-muted">{p.family ? `${p.family.name} · ${familyLine(p.family, labels)}` : "No household on file (counts as their own)"}</p>
        </div>
      ))}
      <p role="status" className={`m-0 text-[13px] font-bold ${check.differentHouseholds ? "text-success" : "text-danger"}`}>
        {check.differentHouseholds ? "Different households: yes" : check.differentHouseholds === false ? `Different households: no. ${check.problem}` : check.problem}
      </p>
    </div>
  );
}

function StartCountSheet({ data, labels, onClose, onSaved }: { data: CountSheetData; labels: CardLabels; onClose: () => void; onSaved: (text: string) => void }) {
  const money = (c: number) => formatCents(c, data.currency, data.locale);
  const [date, setDate] = useState(data.today);
  const [counters, setCounters] = useState<string[]>(() => [data.last[0] ?? "", data.last[1] ?? "", data.last[2] ?? ""]);
  const [total, setTotal] = useState("");
  const [byPieces, setByPieces] = useState(false);
  const [pieces, setPieces] = useState<Record<string, string>>({});
  const [bags, setBags] = useState("");
  const [eventId, setEventId] = useState("");
  const [notes, setNotes] = useState("");
  const { pending, error, run } = useRun();

  const picked = counters.map((id) => data.counters.find((c) => c.userId === id)).filter((c): c is CounterChoice => !!c);
  const distinct = [...new Map(picked.map((p) => [p.userId, p])).values()];
  const check = counterCheck(distinct);
  const typed = total.trim() ? parseAmountToCents(total) : null;
  const typedBad = total.trim() !== "" && (typed === null || typed < 0);
  const read = byPieces ? readDenominations(pieces, data.currency) : ({ ok: true, counts: {}, totalCents: null } as const);
  const reconciled = read.ok && !typedBad ? reconcileTotal(typed, read.totalCents, money) : null;
  const problem = !read.ok
    ? `The notes and coins: ${read.error}.`
    : typedBad
      ? "The total must be an amount like 3412.00."
      : reconciled && !reconciled.ok
        ? `${reconciled.error[0].toUpperCase()}${reconciled.error.slice(1)}.`
        : null;
  const cents = reconciled && reconciled.ok ? reconciled.cents : null;
  const ready = check.problem === null && problem === null && /^\d{4}-\d{2}-\d{2}$/.test(date) && !pending;

  function save() {
    if (!ready) return;
    const fields: [string, string][] = [
      ["counted_on", date],
      ...distinct.map((p): [string, string] => ["counter", p.userId]),
      ["total", total.trim()],
      ["bags", bags],
      ["event_id", eventId],
      ["notes", notes],
    ];
    if (byPieces) fields.push(["denominations", JSON.stringify(pieces)]);
    run("Save the count", () => createCountingSessionAction(null, fd(fields)), () => {
      onSaved(`Done: count of ${cents ? money(cents) : "an amount to come"} saved for ${formatDate(date, "UTC")}.`);
    });
  }

  const select = (i: number) => (
    <select
      key={i}
      aria-label={`Counter ${i + 1}${i === 2 ? " (optional)" : ""}`}
      value={counters[i]}
      onChange={(e) => setCounters((cs) => cs.map((c, j) => (j === i ? e.target.value : c)))}
      className="crm-input min-h-[44px] w-full"
    >
      <option value="">{i === 2 ? "A third counter (optional)" : `Counter ${i + 1}`}</option>
      {data.counters.map((c) => (
        <option key={c.userId} value={c.userId}>
          {c.name}
        </option>
      ))}
    </select>
  );

  return (
    <GivingSheet
      title={`Start a count · ${data.countsWord}`}
      family={null}
      labels={labels}
      what="Two adults from different households count together and seal the bags. A count has no donor: the people it names are its counters."
      error={error ?? (data.problem ? <span>{data.problem}</span> : null)}
      confirmLabel={cents && cents > 0 ? `Save the count of ${money(cents)}` : "Save the count without a total"}
      pending={pending}
      confirmDisabled={!ready}
      onClose={onClose}
      onConfirm={save}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="count-date" className="mb-1 block text-[13px] font-bold text-ink">
            Counting date
          </label>
          <input id="count-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="crm-input min-h-[44px] w-full" />
        </div>
        <div>
          <label htmlFor="count-bags" className="mb-1 block text-[13px] font-bold text-ink">
            Sealed bag numbers
          </label>
          <input id="count-bags" value={bags} onChange={(e) => setBags(e.target.value)} placeholder="e.g. 118, 119" autoComplete="off" className="crm-input min-h-[44px] w-full" />
        </div>
      </div>
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="mb-1 text-[13px] font-bold text-ink">Counters: two adults from different households{data.last.length > 0 ? " (last time's are filled in)" : ""}</legend>
        {data.counters.length === 0 ? (
          <p className="m-0 text-[13px] text-muted">No adult with a login can be chosen yet. Invite the counters as staff or volunteers first.</p>
        ) : (
          <>
            {select(0)}
            {select(1)}
            {select(2)}
          </>
        )}
        <CounterCards picked={distinct} labels={labels} />
      </fieldset>
      <div>
        <label htmlFor="count-total" className="mb-1 block text-[13px] font-bold text-ink">
          Counted total
        </label>
        <input
          id="count-total"
          value={byPieces && read.ok && read.totalCents !== null && !total ? (read.totalCents / 100).toFixed(2) : total}
          onChange={(e) => setTotal(e.target.value)}
          inputMode="decimal"
          autoComplete="off"
          placeholder={byPieces ? "From the notes and coins" : "0.00"}
          className={BIG}
        />
        {problem ? (
          <p role="alert" className="m-0 mt-1 text-[13px] font-semibold text-danger">
            {problem}
          </p>
        ) : null}
      </div>
      {data.denominations ? (
        <div>
          <button type="button" aria-expanded={byPieces} onClick={() => setByPieces((v) => !v)} className={`${buttonClass("ghost", "sm")} min-h-[40px]`}>
            {byPieces ? "Enter the total only" : "Count by notes and coins"}
          </button>
          {byPieces ? (
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              {data.denominations.map((v) => (
                <label key={v} className="flex items-center gap-2 rounded-[10px] border border-line px-2.5 py-1.5">
                  <span className="w-16 shrink-0 text-[14px] font-bold text-ink">{denominationLabel(v, data.currency, data.locale)}</span>
                  <span className="sr-only">how many</span>
                  <input
                    value={pieces[String(v)] ?? ""}
                    onChange={(e) => setPieces((p) => ({ ...p, [String(v)]: e.target.value }))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder="0"
                    className="crm-input min-h-[40px] w-full text-right tabular-nums"
                  />
                </label>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="grid gap-3 sm:grid-cols-2">
        {data.events.length > 0 ? (
          <div>
            <label htmlFor="count-event" className="mb-1 block text-[13px] font-bold text-ink">
              Event (optional)
            </label>
            <select id="count-event" value={eventId} onChange={(e) => setEventId(e.target.value)} className="crm-input min-h-[44px] w-full">
              <option value="">No event</option>
              {data.events.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label htmlFor="count-notes" className="mb-1 block text-[13px] font-bold text-ink">
            Notes (optional)
          </label>
          <input id="count-notes" value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} autoComplete="off" className="crm-input min-h-[44px] w-full" />
        </div>
      </div>
    </GivingSheet>
  );
}

/** "Start a count": loads what the sheet needs when it opens, then the sheet; "Done: …" next to the button once saved. */
export function StartCountButton({
  labels,
  className,
  full = false,
  children = "Start a count",
}: {
  labels: CardLabels;
  className?: string;
  /** The whole width (a phone's bottom bar). */
  full?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<CountSheetData | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [loading, start] = useTransition();

  function openSheet() {
    setProblem(null);
    setDone(null);
    start(async () => {
      try {
        const res = await countSheetAction();
        if (!res.ok || !res.data) {
          setProblem(res.error ?? "Could not open Start a count.");
          return;
        }
        setData(res.data);
        setOpen(true);
      } catch (err) {
        console.error("[giving-counts] opening Start a count failed:", err);
        setProblem("Could not open Start a count: the server did not respond. Try again.");
      }
    });
  }

  return (
    <span className={full ? "flex w-full flex-col gap-1" : "inline-flex flex-col gap-1"}>
      <button type="button" onClick={openSheet} disabled={loading} className={className ?? `${buttonClass("primary", "sm")} min-h-[44px]`}>
        {loading ? "Opening…" : children}
      </button>
      {problem ? (
        <span role="alert" className="max-w-xs text-[13px] font-semibold text-danger">
          {problem}
        </span>
      ) : null}
      {done ? (
        <span role="status" className="max-w-xs text-[13px] font-bold text-success">
          {done}
        </span>
      ) : null}
      {open && data ? (
        <StartCountSheet
          data={data}
          labels={labels}
          onClose={() => setOpen(false)}
          onSaved={(text) => {
            setOpen(false);
            setDone(text);
            router.refresh();
          }}
        />
      ) : null}
    </span>
  );
}
