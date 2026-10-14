// The Giving page's right-hand column (the board's "Giving context"): the open pledges, the month-end close checklist, what is
// waiting (bank lines, Zelle reports, requests for a second approver, with the evidence that approver needs), other things to
// ask, and why this is safe. Each part comes from an existing read command; one that failed or that the person may not see says so.

import Link from "next/link";
import type { ReactNode } from "react";

import type { GivingWorkspaceModel } from "@/lib/data/giving-workspace";
import { moneyIn } from "@/lib/community-format";
import { householdLine, paidPercent, type Part, type WaitingRow } from "@/lib/giving-workspace/view";

import { SidePrompts } from "./side-prompts";

const LABEL = "m-0 text-[12px] font-bold uppercase tracking-[0.04em] text-muted";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2.5" aria-label={title}>
      <h2 className={LABEL}>{title}</h2>
      {children}
    </section>
  );
}

function NoAccessLine() {
  return <p className="m-0 text-[13px] text-muted">You don&apos;t have access to this area.</p>;
}

function ErrorLine({ error }: { error: string }) {
  return (
    <p role="alert" className="m-0 rounded-[12px] border border-danger/30 bg-danger-50 px-3 py-2 text-[13px] leading-[1.45] text-danger">
      {error}{" "}
      <a href="/giving" className="font-bold text-danger underline">
        Reload to try again
      </a>
    </p>
  );
}

function PartView<T>({ part, children }: { part: Part<T>; children: (data: T) => ReactNode }) {
  if (part.state === "no_access") return <NoAccessLine />;
  if (part.state === "error") return <ErrorLine error={part.error} />;
  if (part.state === "off") return null;
  return <>{children(part.data)}</>;
}

function Tick({ done }: { done: boolean }) {
  return done ? (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--v2-green)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none">
      <path d="M5 13l4 4 10-10" />
    </svg>
  ) : (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--v2-sun-ink)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="mt-px flex-none">
      <path d="M12 7v6 M12 17h.01" />
    </svg>
  );
}

function WaitingLink({ row }: { row: WaitingRow }) {
  return (
    <Link href={row.href} className="flex min-h-[44px] items-center gap-3 rounded-[14px] border border-line bg-white px-3.5 py-2.5 text-ink no-underline hover:bg-navy-50">
      <span
        aria-hidden="true"
        className={`flex h-7 min-w-7 flex-none items-center justify-center rounded-full px-2 text-[13px] font-bold ${row.count > 0 ? "bg-saffron-50 text-brown" : "bg-success-50 text-success-900"}`}
      >
        {row.count > 0 ? row.count : "✓"}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-[14px] font-semibold">{row.text}</span>
        {row.detail ? <span className="text-[12px] text-muted">{row.detail}</span> : null}
      </span>
    </Link>
  );
}

export function GivingSidePanel({ model }: { model: GivingWorkspaceModel }) {
  const fmt = { currency: model.currency, locale: model.locale };
  const { bank, zelle, approvals } = model.waiting;
  return (
    <>
      <Section title="Open pledges">
        <PartView part={model.pledges}>
          {(t) =>
            t.pledges === 0 ? (
              <p className="m-0 rounded-[14px] border border-line bg-white p-3.5 text-[14px] text-ink-2">No pledge is open.</p>
            ) : (
              <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-white p-3.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <span className="text-[24px] font-bold text-brown">{moneyIn(t.paid_cents, fmt)}</span>
                  <span className="text-[13px] text-muted">paid of {moneyIn(t.pledged_cents, fmt)} pledged</span>
                </div>
                <div
                  role="progressbar"
                  aria-label="Paid so far on open pledges"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={paidPercent(t)}
                  className="h-2.5 overflow-hidden rounded-[5px] bg-navy-50"
                >
                  <div className="h-2.5 bg-navy" style={{ width: `${paidPercent(t)}%` }} />
                </div>
                <span className="text-[13px] text-muted">
                  {moneyIn(t.open_cents, fmt)} still open across {t.households} {t.households === 1 ? "household" : "households"}
                  {t.truncated ? " (the first 50,000 pledges only)" : ""}
                </span>
              </div>
            )
          }
        </PartView>
      </Section>

      {model.close.state === "off" ? null : (
        <Section title={model.close.state === "ok" ? model.close.data.title : "Month-end close"}>
          <PartView part={model.close}>
            {(c) => (
              <div className="flex flex-col gap-2 text-[14px]">
                {c.items.length === 0 ? <p className="m-0 text-ink-2">Nothing to check this month.</p> : null}
                <ul className="m-0 flex list-none flex-col gap-2 p-0">
                  {c.items.map((i) => (
                    <li key={i.text} className={`flex gap-2.5 ${i.done ? "text-ink" : "font-bold text-brown"}`}>
                      <Tick done={i.done} />
                      <span>
                        {i.text}
                        <span className="sr-only">{i.done ? " (done)" : " (still to do)"}</span>
                        {!i.done && i.why ? <span className="block text-[12px] font-normal text-muted">{i.why}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link href="/accounting/close" className="self-start text-[13px] font-bold text-navy">
                  Open month-end close
                </Link>
              </div>
            )}
          </PartView>
        </Section>
      )}

      <Section title="What is waiting">
        <div className="flex flex-col gap-2">
          <PartView part={bank}>{(row) => <WaitingLink row={row} />}</PartView>
          {zelle ? <PartView part={zelle}>{(row) => <WaitingLink row={row} />}</PartView> : null}
          <PartView part={approvals}>
            {({ row, items }) => (
              <>
                <WaitingLink row={row} />
                {items.map((a) => (
                  <details key={`${a.kind}-${a.id}`} className="rounded-[14px] border border-line bg-white px-3.5 py-2.5 text-[13px]">
                    <summary className="cursor-pointer">
                      <span className="font-semibold text-ink">{a.title}</span>
                      <span className="text-muted">
                        {" · "}
                        {a.amount}
                        {a.household ? ` · ${householdLine(a.household)}` : ""}
                      </span>
                    </summary>
                    <div className="mt-2 flex flex-col gap-1.5 text-ink-2">
                      <p className="m-0">
                        Asked by {a.asked_by ?? "someone"}
                        {a.asked_by_you ? " (you, so someone else must approve)" : ""}
                        {a.reason ? `: “${a.reason}”` : ""}. Waiting for {a.waiting_for}.
                      </p>
                      {a.evidence.length > 0 ? (
                        <ul className="m-0 list-disc pl-5">
                          {a.evidence.map((e) => (
                            <li key={e}>{e}</li>
                          ))}
                        </ul>
                      ) : null}
                      {a.look_at.length > 0 ? (
                        <>
                          <p className="m-0 font-semibold text-ink">Check before approving</p>
                          <ul className="m-0 list-disc pl-5">
                            {a.look_at.map((e) => (
                              <li key={e}>{e}</li>
                            ))}
                          </ul>
                        </>
                      ) : null}
                      <Link href={a.where_to_approve} className="self-start font-bold text-navy">
                        {a.you_can_approve ? "Open Approvals to decide" : "Open Approvals"}
                      </Link>
                    </div>
                  </details>
                ))}
              </>
            )}
          </PartView>
        </div>
      </Section>

      <Section title="Other things you can ask here">
        <SidePrompts prompts={model.prompts} />
      </Section>

      <p className="m-0 rounded-[14px] border border-navy-300 bg-navy-50 p-3.5 text-[13px] leading-[1.55] text-navy">
        <span className="font-bold">Why this is safe.</span>{" "}
        {model.recordByCard
          ? "Recording from the card uses the Record payment screen's own checks and your permissions, and saves the payment and its pledges together or not at all. A refund still needs a second person to approve it."
          : "Niva prepares the payment with your permissions and saves nothing. You record it on the Record payment screen, the same way as always. A refund still needs a second person to approve it."}
      </p>
    </>
  );
}
