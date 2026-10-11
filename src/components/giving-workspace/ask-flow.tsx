"use client";

// "Record a payment by asking" (docs/handoff/prototypes/admin-v2/Giving.dc.html): the person says the payment in a sentence,
// Niva finds the households that match and asks which one (by its household card, never by name), then shows the payment as a
// confirmation card: what will happen, which pledges close, partial payments and overpayments as questions, and the checks a
// second person would go through.
//
// MONEY RULE: this page writes no money. The card comes from giving.draft_payment (nothing saved). Its main button opens the
// EXISTING Record payment screen with everything filled in, and that screen's own button records it. Only where the community
// has switched on the confirm-level giving.record_payment command does the card offer Niva's normal confirmation card instead.

import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";

import { findHouseholdsAction } from "@/app/(app)/giving/actions";
import { draftPaymentAction } from "@/app/(app)/giving/ask-actions";
import type { CardLabels, HouseholdCardData } from "@/components/household-card";
import { useNiva } from "@/components/niva/niva-context";
import { ProposalCard } from "@/components/niva/proposal-card";
import { NivaMark, UserBubble } from "@/components/onboarding-front/parts";
import { browserFetch, runCommand } from "@/lib/assistant/client";
import type { ProposalCard as ProposalCardData } from "@/lib/assistant/protocol";
import type { PaymentDraftData } from "@/lib/commands/catalog/giving-draft-payment";
import { formatDate } from "@/lib/dates";
import type { ActionResult } from "@/lib/errors";
import { changedFields, EMPTY_ASK, listWords, mergeAsk, missingQuestion, parsePaymentAsk, type OfflineMethodKey, type PaymentAsk } from "@/lib/giving-workspace/ask";
import { draftCard, draftRequest, recordPaymentHref, recordSwitchOffNote, type DraftRequest } from "@/lib/giving-workspace/view";
import { referenceFieldLabel } from "@/lib/giving";
import { OFFLINE_METHODS, PAYMENT_METHOD_LABEL } from "@/lib/labels";
import { formatCents } from "@/lib/money";

// ---------------------------------------------------------------------------- State

export type FlowSearch = { query: string; status: "loading" | "done" | "error"; cards: HouseholdCardData[]; more: boolean; error?: string };
export type FlowDraft = { status: "loading" | "done" | "error"; request: DraftRequest; data?: PaymentDraftData; error?: string };
export type FlowTurn = { said: string; reply: string };

export type FlowState = {
  asked: string | null;
  ask: PaymentAsk;
  allocation: "auto" | "none";
  search: FlowSearch | null;
  picked: string | null;
  draft: FlowDraft | null;
  later: FlowTurn[];
  editing: boolean;
  evidenceOpen: boolean;
  proposal: ProposalCardData | null;
  proposing: boolean;
  proposeError: string | null;
  /** Said after Cancel. */
  closed: string | null;
};

export const START: FlowState = {
  asked: null,
  ask: EMPTY_ASK,
  allocation: "auto",
  search: null,
  picked: null,
  draft: null,
  later: [],
  editing: false,
  evidenceOpen: false,
  proposal: null,
  proposing: false,
  proposeError: null,
  closed: null,
};

type Finder = (query: string) => Promise<ActionResult<{ cards: HouseholdCardData[]; more: boolean }>>;
type Drafter = (req: DraftRequest) => Promise<ActionResult<PaymentDraftData>>;

/** The dev preview's stand-ins for the two Server Actions (invented data, nothing called). */
export type AskDemo = { cards: HouseholdCardData[]; drafts: Record<string, PaymentDraftData> };

export type AskFlowProps = {
  communityName: string;
  personName: string | null;
  today: string;
  timeZone: string;
  currency: string;
  locale: string;
  labels: CardLabels;
  canRecord: boolean;
  recordByCard: boolean;
  examples: { ask: string; change: string };
  initial?: FlowState;
  demo?: AskDemo;
};

const NO_ANSWER = "the server did not respond. Check your connection and try again.";

// ---------------------------------------------------------------------------- Small parts

function NivaSays({ children, status = false }: { children: ReactNode; status?: boolean }) {
  return (
    <div role={status ? "status" : undefined} className="min-w-0 max-w-[640px] flex-1 text-[15px] leading-[1.5] text-ink">
      <span className="sr-only">Niva: </span>
      {children}
    </div>
  );
}

function NivaTurn({ says, status, children }: { says: ReactNode; status?: boolean; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <NivaMark />
        <NivaSays status={status}>{says}</NivaSays>
      </div>
      {/* Under the words on a desktop; the full width on a phone, so a household card or the payment card is not squeezed. */}
      {children ? <div className="flex min-w-0 flex-col gap-3 sm:pl-[46px]">{children}</div> : null}
    </div>
  );
}

/** A problem, the way the board shows one: what went wrong, that nothing was saved, and a retry. */
function Problem({ children, onRetry, extra }: { children: ReactNode; onRetry?: () => void; extra?: ReactNode }) {
  return (
    <div role="alert" className="flex max-w-[760px] flex-wrap items-center gap-3 rounded-[14px] border border-[#f0b9b4] bg-danger-50 px-4 py-3 text-[14px] leading-[1.45] text-[#7a1a14]">
      <span className="min-w-[240px] flex-1">{children}</span>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="inline-flex min-h-[40px] items-center rounded-[20px] bg-danger px-4 text-[13px] font-bold text-white">
          Try again
        </button>
      ) : null}
      {extra}
    </div>
  );
}

function memberCount(members: string | null): number {
  return members ? members.split(",").filter((m) => m.trim() !== "").length : 0;
}

function HouseholdChoice({
  card,
  name,
  checked,
  onPick,
  labels,
  timeZone,
  currency,
}: {
  card: HouseholdCardData;
  name: string;
  checked: boolean;
  onPick: () => void;
  labels: CardLabels;
  timeZone: string;
  currency: string;
}) {
  const id = useId();
  const count = memberCount(card.members);
  const open = card.open_pledge_cents !== null && card.open_pledge_cents > 0;
  const where = [card.city, card.zone ? `${card.zone} zone` : null].filter(Boolean).join(" · ");
  return (
    <label
      htmlFor={id}
      className={`flex cursor-pointer gap-3 rounded-[16px] border-2 px-4 py-[14px] text-left text-ink focus-within:outline focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-navy ${checked ? "border-navy bg-navy-50" : "border-line bg-white hover:border-line-input"}`}
    >
      <input id={id} type="radio" name={name} checked={checked} onChange={onPick} className="sr-only" />
      <span aria-hidden="true" className={`mt-0.5 flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border-2 bg-white ${checked ? "border-navy" : "border-line-input"}`}>
        <span className={`h-[10px] w-[10px] rounded-full ${checked ? "bg-navy" : "bg-transparent"}`} />
      </span>
      <span className="flex min-w-0 flex-col gap-[3px]">
        <span className="text-[16px] font-bold">{card.household_name ?? "Unnamed household"}</span>
        <span className="font-mono text-[12px] text-ink-2">
          Household {card.household_number ?? "with no number"}
          {card.org_household_id ? (
            <>
              {" · "}
              <span className="sr-only">{labels.orgHouseholdLabel} </span>
              {card.org_household_id}
            </>
          ) : null}
        </span>
        <span className="text-[13px] text-ink-2">
          Primary: {card.primary_member ?? "not set"}
          {card.primary_member && card.primary_org_member_id ? ` (${labels.orgMemberLabel} ${card.primary_org_member_id})` : ""}
          {count > 0 ? ` · ${count} ${count === 1 ? "member" : "members"}` : ""}
        </span>
        <span className="text-[13px] text-muted">
          {where || "No city on file"} · {card.last_gift_on ? `last gift ${formatDate(card.last_gift_on, timeZone)}` : "no gift yet"}
        </span>
        <span className={`text-[13px] font-bold ${open ? "text-saffron" : "text-muted"}`}>{open ? `Open pledges: ${formatCents(card.open_pledge_cents, currency)} left` : "No open pledge"}</span>
      </span>
    </label>
  );
}

function CheckMark({ status }: { status: "ok" | "look" | "unknown" }) {
  if (status === "ok") {
    return (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--v2-green)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none">
        <path d="M5 13l4 4 10-10" />
      </svg>
    );
  }
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke={status === "look" ? "var(--v2-sun-ink)" : "var(--v2-muted)"} strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none">
      {status === "look" ? <path d="M12 7v6 M12 17h.01" /> : <path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.7 M12 17h.01" />}
    </svg>
  );
}

const STATUS_WORD = { ok: "Fine", look: "Look at this", unknown: "Could not check" } as const;

// ---------------------------------------------------------------------------- The flow

export function AskFlow(props: AskFlowProps) {
  const { communityName, personName, today, timeZone, currency, locale, labels, canRecord, recordByCard, examples, demo } = props;
  const niva = useNiva();
  const [flow, setFlow] = useState<FlowState>(props.initial ?? START);
  const [text, setText] = useState("");
  const seq = useRef(0);
  const inputId = useId();
  const noteId = useId();
  const groupName = useId();

  const finder: Finder = demo ? async () => ({ ok: true, data: { cards: demo.cards, more: false } }) : findHouseholdsAction;
  const drafter: Drafter = demo
    ? async (req) => {
        const data = demo.drafts[req.household_id];
        return data ? { ok: true, data } : { ok: false, error: "Could not prepare the payment — there is no sample for that household." };
      }
    : draftPaymentAction;

  // A newer search or draft makes an older answer stale: only the latest one is shown.
  const update = (fn: (f: FlowState) => FlowState) => setFlow(fn);

  async function runSearch(query: string) {
    const mine = ++seq.current;
    update((f) => ({ ...f, search: { query, status: "loading", cards: [], more: false }, picked: null, draft: null, proposal: null, proposeError: null }));
    let res: ActionResult<{ cards: HouseholdCardData[]; more: boolean }>;
    try {
      res = await finder(query);
    } catch (error) {
      console.error("[giving] household search failed:", error);
      res = { ok: false, error: `Could not search households — ${NO_ANSWER}` };
    }
    if (mine !== seq.current) return;
    update((f) => ({
      ...f,
      search: res.ok ? { query, status: "done", cards: res.data?.cards ?? [], more: res.data?.more ?? false } : { query, status: "error", cards: [], more: false, error: res.error },
    }));
  }

  async function runDraft(request: DraftRequest) {
    const mine = ++seq.current;
    update((f) => ({ ...f, draft: { status: "loading", request }, editing: false, proposal: null, proposeError: null }));
    let res: ActionResult<PaymentDraftData>;
    try {
      res = await drafter(request);
    } catch (error) {
      console.error("[giving] preparing the payment failed:", error);
      res = { ok: false, error: `Could not prepare the payment — ${NO_ANSWER}` };
    }
    if (mine !== seq.current) return;
    update((f) => ({ ...f, draft: res.ok && res.data ? { status: "done", request, data: res.data } : { status: "error", request, error: res.ok ? "Could not prepare the payment — nothing came back." : res.error } }));
  }

  function pick(householdId: string) {
    const req = draftRequest(flow.ask, householdId, flow.allocation);
    update((f) => ({ ...f, picked: householdId }));
    if (req) void runDraft(req);
  }

  function start(sentence: string) {
    const ask = parsePaymentAsk(sentence, today);
    seq.current++;
    setFlow({ ...START, asked: sentence, ask });
    if (!missingQuestion(ask) && ask.who) void runSearch(ask.who);
  }

  function change(sentence: string) {
    const said = parsePaymentAsk(sentence, today);
    const fields = changedFields(said);
    if (fields.length === 0) {
      update((f) => ({
        ...f,
        later: [...f.later, { said: sentence, reply: `I did not catch a change. You can say ${examples.change}, or press Change something. To record another payment, finish or cancel this one first.` }],
      }));
      return;
    }
    const ask = mergeAsk(flow.ask, said);
    const missing = missingQuestion(ask);
    let reply: string;
    if (said.who) reply = `Looking for households that match “${said.who}” instead.`;
    else if (missing) reply = `Changed ${listWords(fields)}. ${missing}`;
    else if (flow.picked) reply = `Changed ${listWords(fields)}. The card below is updated; check it again.`;
    else reply = `Changed ${listWords(fields)}.`;
    update((f) => ({ ...f, ask, later: [...f.later, { said: sentence, reply }] }));
    if (missing) return;
    if (said.who || !flow.search) {
      if (ask.who) void runSearch(ask.who);
      return;
    }
    if (flow.picked) {
      const req = draftRequest(ask, flow.picked, flow.allocation);
      if (req) void runDraft(req);
    }
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const sentence = text.trim();
    if (!sentence || !canRecord) return;
    setText("");
    if (!flow.asked || flow.closed) start(sentence);
    else change(sentence);
  }

  function cancel() {
    seq.current++;
    setFlow({ ...START, closed: "Cancelled. Nothing was saved." });
  }

  async function proposeRecord(request: DraftRequest) {
    update((f) => ({ ...f, proposing: true, proposeError: null }));
    const res = await runCommand(browserFetch, { key: "giving.record_payment", input: { ...request } });
    if (res.ok && res.kind === "proposal") update((f) => ({ ...f, proposing: false, proposal: res.proposal }));
    else update((f) => ({ ...f, proposing: false, proposeError: res.ok ? "Could not prepare the confirmation — the answer was not understood. Open it in Record payment instead." : res.error }));
  }

  // The composer is the first thing a keyboard user reaches after an answer arrives only when they ask for it: focus is not moved.
  const conversation = flow.asked !== null;
  const missing = conversation ? missingQuestion(flow.ask) : null;
  const nivaCanConfirm = Boolean(niva?.enabled);
  const placeholder = conversation && !flow.closed ? `Say what to change: ${examples.change}` : `Say the payment: “${examples.ask}”`;

  // The example in the empty state fills the box, so the person sees exactly what will be read.
  const [exampleUsed, setExampleUsed] = useState(false);
  useEffect(() => {
    if (exampleUsed) document.getElementById(inputId)?.focus();
  }, [exampleUsed, inputId]);

  return (
    <>
      <section aria-label="Conversation" aria-live="polite" className="flex min-h-0 flex-1 flex-col gap-4">
        {!conversation ? (
          <NivaTurn
            says={
              <>
                {flow.closed ? <span className="font-semibold">{flow.closed} </span> : null}
                Tell me about a payment you received: who gave it, how much, and how. I will find the household and prepare the payment for you to check. Nothing is saved until you confirm.
              </>
            }
          >
            {canRecord ? (
              <div>
                <button
                  type="button"
                  onClick={() => {
                    setText(examples.ask);
                    setExampleUsed(true);
                  }}
                  className="inline-flex min-h-[44px] items-center rounded-[22px] border border-navy bg-white px-4 text-left text-[14px] font-semibold text-navy hover:bg-navy-50"
                >
                  Try: “{examples.ask}”
                </button>
              </div>
            ) : (
              <p className="m-0 max-w-[640px] rounded-[12px] border border-line bg-white px-4 py-3 text-[14px] text-ink-2">
                You can look at Giving, but recording payments needs the permission to record them (giving.record_offline or giving.manage). Ask an owner if you need it.
              </p>
            )}
          </NivaTurn>
        ) : (
          <UserBubble>{flow.asked}</UserBubble>
        )}

        {conversation && missing && !flow.search ? <NivaTurn says={missing} /> : null}

        {flow.search ? (
          flow.search.status === "loading" ? (
            <NivaTurn status says={`Looking for households that match “${flow.search.query}”…`} />
          ) : flow.search.status === "error" ? (
            <NivaTurn says="I could not look for the household.">
              <Problem onRetry={() => flow.search && void runSearch(flow.search.query)}>{flow.search.error} Nothing was saved.</Problem>
            </NivaTurn>
          ) : flow.search.cards.length === 0 ? (
            <NivaTurn says={`No household matches “${flow.search.query}”. Say its household number, a member ID or another spelling, for example “it was from household 1042”.`} />
          ) : (
            <NivaTurn
              says={
                flow.search.cards.length === 1
                  ? `One household matches “${flow.search.query}”. Check it is the right one before I prepare the payment.`
                  : `${flow.search.cards.length} households match “${flow.search.query}”. I will not guess which one gave this. Which household is it?`
              }
            >
              <fieldset className="m-0 min-w-0 border-0 p-0">
                <legend className="sr-only">Choose the household</legend>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {flow.search.cards.map((c) => (
                    <HouseholdChoice
                      key={c.household_id}
                      card={c}
                      name={groupName}
                      checked={flow.picked === c.household_id}
                      onPick={() => pick(c.household_id)}
                      labels={labels}
                      timeZone={timeZone}
                      currency={currency}
                    />
                  ))}
                </div>
              </fieldset>
              {flow.search.more ? <p className="m-0 text-[13px] text-muted">More households match. Say a household number or member ID to narrow it down.</p> : null}
            </NivaTurn>
          )
        ) : null}

        {flow.draft ? (
          flow.draft.status === "loading" ? (
            <NivaTurn status says="Preparing the payment…" />
          ) : flow.draft.status === "error" ? (
            <NivaTurn says="I could not prepare the payment.">
              <Problem onRetry={() => flow.draft && void runDraft(flow.draft.request)}>{flow.draft.error} Nothing was saved.</Problem>
            </NivaTurn>
          ) : flow.draft.data ? (
            <NivaTurn says="Here is the payment. Change anything you like, then confirm. Nothing is saved until you do.">
              <DraftCard
                data={flow.draft.data}
                request={flow.draft.request}
                about={flow.ask.about}
                locale={locale}
                communityName={communityName}
                personName={personName}
                recordByCard={recordByCard}
                nivaCanConfirm={nivaCanConfirm}
                flow={flow}
                today={today}
                onEdit={() => update((f) => ({ ...f, editing: !f.editing }))}
                onCancel={cancel}
                onEvidence={(open) => update((f) => ({ ...f, evidenceOpen: open }))}
                onPropose={() => flow.draft && void proposeRecord(flow.draft.request)}
                onSave={(ask, allocation) => {
                  update((f) => ({ ...f, ask, allocation }));
                  if (flow.picked) {
                    const req = draftRequest(ask, flow.picked, allocation);
                    if (req) void runDraft(req);
                  }
                }}
              />
            </NivaTurn>
          ) : null
        ) : null}

        {flow.later.map((t, i) => (
          <div key={i} className="flex flex-col gap-4">
            <UserBubble>{t.said}</UserBubble>
            <NivaTurn says={t.reply} />
          </div>
        ))}
      </section>

      <form onSubmit={submit} aria-label="Tell Niva about the payment" className="sticky bottom-[84px] z-10 md:bottom-4">
        <div className="flex min-h-[56px] items-center gap-3 rounded-[28px] border border-line-input bg-white py-1.5 pl-[18px] pr-2.5 shadow-[0_6px_20px_rgba(18,32,58,0.06)]">
          <span aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24">
              <defs>
                <linearGradient id="gv-spark" x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0" stopColor="#FFB82A" />
                  <stop offset="1" stopColor="#FF7640" />
                </linearGradient>
              </defs>
              <path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z" fill="url(#gv-spark)" />
            </svg>
          </span>
          <label htmlFor={inputId} className="sr-only">
            {conversation && !flow.closed ? "Say what to change" : "Say the payment"}
          </label>
          <input
            id={inputId}
            type="text"
            autoComplete="off"
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={!canRecord}
            aria-describedby={noteId}
            placeholder={placeholder}
            className="min-w-0 flex-1 border-0 bg-transparent text-[16px] text-ink placeholder:text-muted focus:outline-none disabled:cursor-not-allowed"
          />
          <button
            type="submit"
            disabled={!canRecord || text.trim() === ""}
            aria-label="Send"
            className="flex h-11 w-11 flex-none items-center justify-center rounded-full text-ink disabled:opacity-60"
            style={{ background: "var(--v2-sun)" }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 11l18-8-8 18-2-8z" />
            </svg>
          </button>
        </div>
        <p id={noteId} className="sr-only">
          Read on this page, without sending it anywhere else. Nothing is saved until you confirm.
        </p>
      </form>
    </>
  );
}

// ---------------------------------------------------------------------------- The confirmation card

function DraftCard({
  data,
  request,
  about,
  locale,
  communityName,
  personName,
  recordByCard,
  nivaCanConfirm,
  flow,
  today,
  onEdit,
  onCancel,
  onEvidence,
  onPropose,
  onSave,
}: {
  data: PaymentDraftData;
  request: DraftRequest;
  about: string | null;
  locale: string;
  communityName: string;
  personName: string | null;
  recordByCard: boolean;
  nivaCanConfirm: boolean;
  flow: FlowState;
  today: string;
  onEdit: () => void;
  onCancel: () => void;
  onEvidence: (open: boolean) => void;
  onPropose: () => void;
  onSave: (ask: PaymentAsk, allocation: "auto" | "none") => void;
}) {
  const view = draftCard(data, { locale, about });
  const byCard = recordByCard && nivaCanConfirm;
  const titleId = useId();
  const tone = { plain: "", strong: "font-bold", money: "text-[18px] font-extrabold text-saffron", danger: "font-bold text-danger" } as const;

  return (
    <div className="flex max-w-[760px] flex-col gap-3">
      <section aria-labelledby={titleId} className="overflow-hidden rounded-[16px] border border-line bg-white">
        <h2 id={titleId} className="m-0 flex items-center gap-2.5 border-b border-[#ffd3b3] bg-saffron-50 px-[18px] py-2.5 text-[12px] font-extrabold uppercase tracking-[0.04em] text-[#7a2e08]">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l8 3v6c0 5-3.4 8.4-8 9-4.6-.6-8-4-8-9V6z" />
          </svg>
          Money action · needs your confirmation
        </h2>
        <dl className="m-0 grid grid-cols-[110px_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-[18px] py-4 text-[14px] leading-[1.45] sm:grid-cols-[150px_minmax(0,1fr)]">
          {view.rows.map((r) => (
            <div key={r.label} className="contents">
              <dt className="font-semibold text-muted">{r.label}</dt>
              <dd className={`m-0 ${tone[r.tone]}`}>{r.value}</dd>
            </div>
          ))}
        </dl>
        {view.notes.map((n, i) => (
          <p
            key={i}
            className={`mx-[18px] mb-3.5 mt-0 rounded-[12px] border px-3.5 py-2.5 text-[13px] leading-[1.5] ${n.tone === "danger" ? "border-[#f0b9b4] bg-danger-50 text-[#7a1a14]" : "border-[#ffd3b3] bg-saffron-50 text-[#7a2e08]"}`}
          >
            {n.text}
          </p>
        ))}

        <div className="flex flex-col gap-1.5 px-[18px] pb-3.5 text-[13px] leading-[1.45] text-ink-2">
          <span className="font-bold text-muted">What happens when you confirm</span>
          {byCard ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              <li>• The payment and its pledges are saved together, or not at all, exactly as this card shows.</li>
              <li>• One confirmation can never record it twice.</li>
              <li>• The history shows: recorded by Niva, for {personName ?? "you"}.</li>
            </ul>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              <li>• Record payment opens with these details filled in, for this household.</li>
              <li>• You check it there and press Record. Nothing is saved before that.</li>
              <li>• It is applied to pledges the way the Record payment screen always does it.</li>
            </ul>
          )}
        </div>

        <details
          open={flow.evidenceOpen}
          onToggle={(e) => onEvidence((e.currentTarget as HTMLDetailsElement).open)}
          className="mx-[18px] mb-3.5 rounded-[12px] border border-line bg-ground px-3.5 py-2.5 text-[13px]"
        >
          <summary className="cursor-pointer font-bold text-ink-2">
            What a second person would check ({view.checks.length}){view.needsALook > 0 ? ` · ${view.needsALook} to look at` : ""}
          </summary>
          <ul className="m-0 mt-2 flex list-none flex-col gap-2 p-0">
            {view.checks.map((c) => (
              <li key={c.label} className="flex gap-2.5 leading-[1.45]">
                <CheckMark status={c.status} />
                <span>
                  <span className="font-semibold text-ink">{c.label}</span>
                  <span className="sr-only"> ({STATUS_WORD[c.status]})</span>: <span className="text-ink-2">{c.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        </details>

        {flow.editing ? <ChangeForm request={request} ask={flow.ask} allocation={flow.allocation} today={today} onSave={onSave} onClose={onEdit} /> : null}

        {flow.proposal ? null : (
          <div className="flex flex-wrap gap-2.5 border-t border-[#eaf0f7] bg-ground px-[18px] py-3.5">
            {byCard ? (
              <button
                type="button"
                onClick={onPropose}
                disabled={flow.proposing}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-[22px] bg-navy px-5 text-[14px] font-bold text-white hover:bg-navy-hover disabled:opacity-70"
              >
                {flow.proposing ? "Preparing…" : view.recordLabel}
              </button>
            ) : (
              <Link href={recordPaymentHref(request)} className="inline-flex min-h-[44px] items-center gap-2 rounded-[22px] bg-navy px-5 text-[14px] font-bold text-white no-underline hover:bg-navy-hover">
                Open in Record payment · {view.amount}
              </Link>
            )}
            <button
              type="button"
              onClick={onEdit}
              aria-expanded={flow.editing}
              className="min-h-[44px] rounded-[22px] border border-line-input bg-white px-[18px] text-[14px] font-bold text-ink hover:bg-navy-50"
            >
              Change something
            </button>
            <button type="button" onClick={onCancel} className="min-h-[44px] rounded-[22px] bg-transparent px-[18px] text-[14px] font-bold text-muted hover:text-ink">
              Cancel
            </button>
            {!byCard ? (
              <p className="m-0 basis-full text-[13px] leading-[1.45] text-muted">
                {recordByCard && !nivaCanConfirm
                  ? `Recording from this card needs Niva for admins switched on for ${communityName}. Until then, Record payment opens with everything filled in.`
                  : recordSwitchOffNote(communityName)}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {flow.proposeError ? (
        <Problem
          onRetry={onPropose}
          extra={
            <Link href={recordPaymentHref(request)} className="inline-flex min-h-[40px] items-center rounded-[20px] border border-danger px-4 text-[13px] font-bold text-[#7a1a14] no-underline">
              Open in Record payment
            </Link>
          }
        >
          {flow.proposeError} Nothing was saved.
        </Problem>
      ) : null}
      {flow.proposal ? <ProposalCard proposal={flow.proposal} /> : null}
    </div>
  );
}

// ---------------------------------------------------------------------------- "Change something"

function ChangeForm({
  request,
  ask,
  allocation,
  today,
  onSave,
  onClose,
}: {
  request: DraftRequest;
  ask: PaymentAsk;
  allocation: "auto" | "none";
  today: string;
  onSave: (ask: PaymentAsk, allocation: "auto" | "none") => void;
  onClose: () => void;
}) {
  const id = useId();
  const [amount, setAmount] = useState(request.amount);
  const [method, setMethod] = useState<OfflineMethodKey>(request.method);
  const [received, setReceived] = useState(request.received_on ?? today);
  const [reference, setReference] = useState(request.reference ?? "");
  const [apply, setApply] = useState<"auto" | "none">(allocation);
  const field = "mt-1 block min-h-[44px] w-full rounded-[12px] border border-line-input bg-white px-3 text-[15px] text-ink";
  const label = "text-[13px] font-semibold text-ink-2";
  return (
    <form
      className="mx-[18px] mb-3.5 grid grid-cols-1 gap-3 rounded-[12px] border border-line bg-white p-3.5 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        onSave({ ...ask, amount: amount.trim() || null, method, receivedOn: received || null, reference: reference.trim() || null }, apply);
      }}
      aria-label="Change the payment"
    >
      <div>
        <label htmlFor={`${id}-amount`} className={label}>
          Amount
        </label>
        <input id={`${id}-amount`} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={`${id}-method`} className={label}>
          How it was paid
        </label>
        <select id={`${id}-method`} value={method} onChange={(e) => setMethod(e.target.value as OfflineMethodKey)} className={field}>
          {OFFLINE_METHODS.map((m) => (
            <option key={m} value={m}>
              {PAYMENT_METHOD_LABEL[m] ?? m}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${id}-received`} className={label}>
          Received on
        </label>
        <input id={`${id}-received`} type="date" max={today} value={received} onChange={(e) => setReceived(e.target.value)} className={field} />
      </div>
      <div>
        <label htmlFor={`${id}-ref`} className={label}>
          {referenceFieldLabel(method)}
        </label>
        <input id={`${id}-ref`} value={reference} onChange={(e) => setReference(e.target.value)} className={field} />
      </div>
      <fieldset className="m-0 border-0 p-0 sm:col-span-2">
        <legend className={label}>Apply it to</legend>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-2 text-[14px] text-ink">
          <label className="inline-flex min-h-[32px] items-center gap-2">
            <input type="radio" name={`${id}-apply`} checked={apply === "auto"} onChange={() => setApply("auto")} />
            The earliest open pledge first
          </label>
          <label className="inline-flex min-h-[32px] items-center gap-2">
            <input type="radio" name={`${id}-apply`} checked={apply === "none"} onChange={() => setApply("none")} />
            No pledge: a general gift
          </label>
        </div>
      </fieldset>
      <div className="flex flex-wrap gap-2.5 sm:col-span-2">
        <button type="submit" className="inline-flex min-h-[44px] items-center rounded-[22px] bg-navy px-5 text-[14px] font-bold text-white hover:bg-navy-hover">
          Update the payment
        </button>
        <button type="button" onClick={onClose} className="min-h-[44px] rounded-[22px] px-[18px] text-[14px] font-bold text-muted hover:text-ink">
          Keep it as it was
        </button>
      </div>
    </form>
  );
}

