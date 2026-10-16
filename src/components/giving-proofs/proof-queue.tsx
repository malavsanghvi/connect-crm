"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";

import { signProofFilesAction } from "@/app/(app)/giving/proofs/actions";
import { HouseholdCard, type CardLabels } from "@/components/household-card";
import { ProofFiles } from "@/components/giving-proofs/proof-files";
import { FileViewer } from "@/components/giving-proofs/file-viewer";
import { ProofDecision } from "@/components/giving-proofs/proof-decision";
import type { CommunityFormat } from "@/lib/community-format";
import { formatDate } from "@/lib/dates";
import { formatCents } from "@/lib/money";
import {
  ageChip,
  cardChips,
  entryLabel,
  filesLabel,
  householdLine,
  methodLabel,
  proofFlags,
  type CardCan,
  type FlagTone,
  type ProofCard,
  type ProofFile,
} from "@/lib/payment-proofs/queue";

// Giving > Payment proofs (docs/PAYMENT_PROOFS_AND_RECONCILIATION_PLAN.md section 4.3): the cards waiting for the treasury team on
// the left, the proof being reviewed on the right (below the list on a phone). A household is never shown by name alone.

const CHIP: Record<FlagTone, string> = {
  bad: "bg-danger-50 text-danger",
  warn: "bg-warning-50 text-warning-ink",
  ok: "bg-success-50 text-success-900",
  info: "bg-navy-50 text-navy",
};
const AGE: Record<string, string> = { plain: "bg-canvas text-ink-2", soft: "bg-navy-50 text-navy", warn: "bg-warning-50 text-warning-ink", bad: "bg-danger-50 text-danger" };
const FLAG_TEXT: Record<FlagTone, string> = { bad: "text-danger", warn: "text-warning-ink", ok: "text-success", info: "text-navy" };

export type QueueProps = {
  cards: ProofCard[];
  can: CardCan;
  fmt: CommunityFormat;
  timeZone: string;
  labels: CardLabels;
};

export function ProofQueue({ cards, can, fmt, timeZone, labels }: QueueProps) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(cards[0]?.id ?? null);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [viewer, setViewer] = useState<{ proofId: string; start: number } | null>(null);
  const [relinking, setRelinking] = useState<string | null>(null);
  const [relinkError, setRelinkError] = useState<string | null>(null);
  const panel = useRef<HTMLElement>(null);

  const withLinks = useCallback(
    (c: ProofCard): ProofCard => ({ ...c, files: c.files.map((f): ProofFile => (links[f.path] ? { ...f, url: links[f.path] } : f)) }),
    [links],
  );
  const base = cards.find((c) => c.id === selectedId) ?? cards[0];
  if (!base) return null;
  const selected = withLinks(base);
  const money = (cents: number) => formatCents(cents, fmt.currency, fmt.locale);
  const date = (v: string) => formatDate(v, timeZone);

  async function relink(proofId: string): Promise<string | null> {
    setRelinking(proofId);
    setRelinkError(null);
    try {
      const res = await signProofFilesAction(proofId);
      if (!res.ok) {
        setRelinkError(res.error);
        return res.error;
      }
      setLinks((prev) => ({ ...prev, ...res.urls }));
      if (res.partial) {
        setRelinkError(res.partial);
        return res.partial;
      }
      return null;
    } catch (err) {
      console.error("[giving/proofs] making new links failed:", err);
      const msg = "Could not make new links — the server could not be reached. Try again.";
      setRelinkError(msg);
      return msg;
    } finally {
      setRelinking(null);
    }
  }

  function pick(id: string) {
    setSelectedId(id);
    setRelinkError(null);
    // On a phone the review sits below the list: bring it into view.
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 1023px)").matches) {
      requestAnimationFrame(() => panel.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    }
    // The first cards had their links made with the page; later ones (and old links) are made when opened.
    const c = cards.find((x) => x.id === id);
    if (c && c.files.some((f) => !f.removed && !f.url && !links[f.path])) void relink(id);
  }

  function decided(state: string) {
    // A first of two approvals leaves the proof in the queue; every other decision takes it out, so move to the next one.
    if (state !== "first_approved") {
      const i = cards.findIndex((c) => c.id === selected.id);
      const next = cards[i + 1] ?? cards[i - 1] ?? null;
      setSelectedId(next ? next.id : null);
    }
    router.refresh();
  }

  const viewCard = viewer ? withLinks(cards.find((c) => c.id === viewer.proofId) ?? selected) : null;

  return (
    <div className="flex flex-wrap items-start gap-5">
      <section aria-labelledby="proofs-list" className="flex min-w-0 flex-[1_1_520px] flex-col gap-3">
        <div>
          <h2 id="proofs-list" className="m-0 text-[18px] font-bold text-ink">
            Proofs to verify <span className="font-semibold text-muted">({cards.length})</span>
          </h2>
          <p className="m-0 mt-1 text-[13.5px] text-ink-2">Members paid another way and sent a photo. Their pledges show Soft credit until you decide. Oldest first.</p>
        </div>
        <ul className="m-0 flex list-none flex-col gap-2.5 p-0">
          {cards.map((raw) => {
            const c = withLinks(raw);
            const on = c.id === selected.id;
            const age = ageChip(c.ageDays);
            return (
              <li key={c.id}>
                <div className={`rounded-card border bg-white ${on ? "border-2 border-navy" : "border-line"}`}>
                  <button
                    type="button"
                    onClick={() => pick(c.id)}
                    aria-pressed={on}
                    className="flex w-full flex-col gap-1.5 rounded-card px-3.5 py-3 text-left text-ink hover:bg-canvas focus-visible:outline focus-visible:outline-2 focus-visible:outline-navy"
                  >
                    <span className="flex flex-wrap justify-between gap-x-3 gap-y-1">
                      <span className="flex min-w-0 flex-col">
                        <strong className="text-[16px]">{c.household?.household_name ?? "Unnamed household"}</strong>
                        <span className="text-[12.5px] text-muted">{householdLine(c.household, labels.orgHouseholdLabel)}</span>
                        <span className="text-[12.5px] text-muted">
                          {[c.household?.members, [c.household?.zone, c.household?.city].filter(Boolean).join(", ")].filter(Boolean).join(" · ") || "No members listed"}
                        </span>
                      </span>
                      <span className="flex flex-col items-end">
                        <strong className="text-[17px] tabular-nums">{money(c.amountCents)}</strong>
                        <span className="text-[12.5px] text-muted">
                          {methodLabel(c.method)}
                          {c.reference ? ` ${c.reference}` : ""} · paid {date(c.paidOn)}
                        </span>
                      </span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className={`rounded-full px-2.5 py-px text-[12px] font-bold ${AGE[age.tone]}`}>{age.label}</span>
                      <span className="text-[12.5px] text-muted">{filesLabel(c.files)}</span>
                      {cardChips(c).map((chip) => (
                        <span key={chip.label} className={`rounded-full px-2.5 py-px text-[12px] font-bold ${CHIP[chip.tone]}`}>
                          {chip.label}
                        </span>
                      ))}
                    </span>
                  </button>
                  {c.files.length > 0 ? (
                    <div className="px-3.5 pb-3">
                      <ProofFiles
                        files={c.files}
                        onOpen={(i) => {
                          setSelectedId(c.id);
                          setViewer({ proofId: c.id, start: i });
                        }}
                        onRelink={() => void relink(c.id)}
                        relinking={relinking === c.id}
                        relinkError={on ? relinkError : null}
                      />
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <aside ref={panel} aria-labelledby="proof-review" className="flex min-w-0 flex-[1_1_480px] flex-col gap-3.5 rounded-xl border-2 border-navy bg-white p-4 sm:p-[18px]">
        <ProofReview
          key={selected.id}
          card={selected}
          can={can}
          fmt={fmt}
          labels={labels}
          timeZone={timeZone}
          money={money}
          date={date}
          relinking={relinking === selected.id}
          relinkError={relinkError}
          onRelink={() => void relink(selected.id)}
          onOpenFile={(i) => setViewer({ proofId: selected.id, start: i })}
          onDecided={decided}
        />
      </aside>

      {viewer && viewCard ? <FileViewer files={viewCard.files} start={viewer.start} onClose={() => setViewer(null)} onRelink={() => relink(viewCard.id)} /> : null}
    </div>
  );
}

function ProofReview({
  card,
  can,
  fmt,
  labels,
  timeZone,
  money,
  date,
  relinking,
  relinkError,
  onRelink,
  onOpenFile,
  onDecided,
}: {
  card: ProofCard;
  can: CardCan;
  fmt: CommunityFormat;
  labels: CardLabels;
  timeZone: string;
  money: (cents: number) => string;
  date: (value: string) => string;
  relinking: boolean;
  relinkError: string | null;
  onRelink: () => void;
  onOpenFile: (index: number) => void;
  onDecided: (state: string) => void;
}) {
  const flags = proofFlags(card, { money, date });
  const covered = card.covered;
  const stillOpen = card.files.filter((f) => !f.removed).length;
  return (
    <>
      <div className="flex flex-wrap items-start justify-between gap-2.5">
        <h2 id="proof-review" className="m-0 font-display text-[24px] font-semibold text-navy">
          Review proof
        </h2>
        <span className="rounded-full bg-navy-50 px-3 py-[3px] text-[13px] font-bold text-navy">
          {card.status === "needs_info" ? "Waiting for the family's answer" : "Soft credit until you decide"}
        </span>
      </div>

      {card.household ? (
        <HouseholdCard card={card.household} labels={labels} timeZone={timeZone} currency={fmt.currency} />
      ) : (
        <p role="alert" className="m-0 rounded-field border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] text-danger">
          This household could not be shown. Do not decide this proof until you can see who it is from. Reload the page to try again.
        </p>
      )}
      <p className="m-0 -mt-2 text-[12.5px] text-muted">Shown with its household card, never by name alone.</p>

      <div className="flex flex-wrap gap-3">
        <div className="min-w-[200px] flex-[1_1_240px]">
          <ProofFiles files={card.files} size="lg" onOpen={onOpenFile} onRelink={onRelink} relinking={relinking} relinkError={relinkError} />
        </div>
        <dl className="m-0 grid flex-[1_1_200px] grid-cols-[auto_1fr] content-start gap-x-3.5 gap-y-1.5 text-[14.5px]">
          <dt className="text-muted">Amount</dt>
          <dd className="m-0 font-bold tabular-nums">{money(card.amountCents)}</dd>
          <dt className="text-muted">Method</dt>
          <dd className="m-0">{methodLabel(card.method)}</dd>
          <dt className="text-muted">Paid on</dt>
          <dd className="m-0">{date(card.paidOn)}</dd>
          {card.reference ? (
            <>
              <dt className="text-muted">Reference</dt>
              <dd className="m-0 break-words">{card.reference}</dd>
            </>
          ) : null}
          <dt className="text-muted">Sent</dt>
          <dd className="m-0">
            {date(card.createdAt)} from {entryLabel(card.entry)}
          </dd>
          <dt className="text-muted">Files</dt>
          <dd className="m-0">{stillOpen}</dd>
          {card.note ? (
            <>
              <dt className="text-muted">Note</dt>
              <dd className="m-0 break-words">{card.note}</dd>
            </>
          ) : null}
        </dl>
      </div>

      {card.question ? (
        <p className="m-0 rounded-field bg-canvas px-3 py-2 text-[13.5px] text-ink">
          <strong>You asked:</strong> {card.question}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <p className="m-0 text-[14px] font-bold">If you approve, the payment goes to these pledges, oldest first</p>
        {covered.length === 0 ? (
          <p className="m-0 text-[13.5px] text-ink-2">No pledge is reserved by this proof now. It will be applied to the oldest open pledges.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[360px] border-collapse text-[14px]">
              <caption className="sr-only">Pledges this proof would pay</caption>
              <tbody>
                {covered.map((p) => (
                  <tr key={p.pledgeId} className="border-t border-line">
                    <td className="px-1 py-1.5">
                      {p.number ? <strong>{p.number} </strong> : null}
                      {p.title}
                    </td>
                    <td className="px-1 py-1.5 text-right tabular-nums">
                      {money(p.coverCents)} of {money(p.pledgeCents)}
                    </td>
                    <td className={`px-1 py-1.5 text-right font-bold ${p.coverCents >= p.pledgeCents ? "text-success" : "text-warning-ink"}`}>{p.coverCents >= p.pledgeCents ? "Paid in full" : "Part paid"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div role="group" aria-label="Checks the system ran" className="flex flex-col gap-1 rounded-field border border-saffron/60 bg-canvas px-3.5 py-2.5">
        <span className="text-[12.5px] font-bold tracking-[0.04em] text-brown">WHAT THE SYSTEM CHECKED</span>
        {flags.map((f) => (
          <span key={f.key} className="text-[14px] text-ink">
            <strong className={FLAG_TEXT[f.tone]}>{f.tag}</strong> {f.text}
          </span>
        ))}
      </div>

      <ProofDecision card={card} can={can} onDecided={onDecided} />

      {card.events.length > 0 ? (
        <details className="text-[13px] text-ink-2">
          <summary className="cursor-pointer font-bold text-navy">History of this proof</summary>
          <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 p-0">
            {card.events.map((e, i) => (
              <li key={`${e.createdAt}-${i}`}>
                <span className="text-muted">{date(e.createdAt)}:</span> {e.body}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </>
  );
}
