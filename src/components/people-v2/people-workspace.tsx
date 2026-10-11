import Link from "next/link";
import type { ReactNode } from "react";

import { dismissDuplicateAction } from "@/app/(app)/households/actions";
import { ActionForm } from "@/components/action-form";
import { AskNiva } from "@/components/niva/ask-niva";
import { NivaHouseholdCard } from "@/components/niva/niva-household-card";
import type { DuplicateItem, HouseholdPanel, HouseholdsSection, PanelState, PeopleSection, PeopleWorkspaceModel, Problem, QuickChip, ReviewItem, Section } from "@/lib/people-v2/model";

import { PeopleAskBox } from "./ask-box";
import { ComingNext, DraftForThese, MergeByCard, NoticedLabel } from "./niva-bits";

// The People workspace in the new look, as drawn on the prototype board "Ask your data, then the household card": the list with
// the ask box on the left, the household card on the right (a full-screen sheet on a phone). It only draws the model.

const CHIP = "inline-flex min-h-10 items-center gap-1.5 rounded-[20px] border px-3.5 text-[13px] no-underline";
const BTN = "inline-flex min-h-11 items-center rounded-[22px] px-[18px] text-[14px] font-bold no-underline";
const COLS = "md:grid md:grid-cols-[minmax(0,2.3fr)_minmax(0,1.5fr)_110px_110px_120px_150px] md:gap-2.5";

export function PeopleWorkspace({ model }: { model: PeopleWorkspaceModel }) {
  const m = model;
  return (
    <div className="xl:-mb-10 xl:-mr-7 xl:-mt-[22px] xl:flex xl:min-h-[calc(100vh-4rem)]">
      <div className="flex min-w-0 flex-1 flex-col gap-4 xl:pb-10 xl:pr-9 xl:pt-[26px]">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h1 className="m-0 font-display text-[30px] font-semibold leading-tight text-ink">People</h1>
          <nav aria-label="Show" className="flex max-w-full gap-1 overflow-x-auto rounded-3xl bg-[#E9EFF7] p-1">
            {m.tabs.map((t) => (
              <Link
                key={t.key}
                href={t.href}
                aria-current={t.current ? "page" : undefined}
                className={`inline-flex min-h-10 shrink-0 items-center rounded-[20px] px-4 text-[14px] no-underline ${t.current ? "bg-white font-bold text-navy" : "font-semibold text-ink-2 hover:bg-white/60"}`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
        </div>

        <QuickChips chips={m.quick} />
        <PeopleAskBox ask={m.ask} />

        {m.problems.map((p) => (
          <ProblemLine key={p.what} problem={p} />
        ))}
        {m.notes.map((n) => (
          <p key={n} className="m-0 rounded-xl border border-line bg-ground px-4 py-2.5 text-[13px] text-ink-2">
            {n}
          </p>
        ))}

        {m.households ? (
          <>
            <SummaryRow model={m} />
            <HouseholdsList section={m.households} />
          </>
        ) : null}
        {m.people ? <PeopleList section={m.people} /> : null}
        {m.reviews ? <ReviewsList section={m.reviews} /> : null}
        {m.duplicates ? <DuplicatesList section={m.duplicates} /> : null}
      </div>
      <PanelAside panel={m.panel} />
    </div>
  );
}

function QuickChips({ chips }: { chips: QuickChip[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {chips.map((c) =>
        c.comingNext ? (
          <span key={c.key} className="inline-flex items-center gap-2">
            <button type="button" disabled title={c.title} className={`${CHIP} cursor-not-allowed border-dashed border-[#9FB0C6] bg-transparent font-semibold text-muted`}>
              {c.label}
            </button>
            <ComingNext />
          </span>
        ) : c.href ? (
          <Link
            key={c.key}
            href={c.href}
            scroll={false}
            aria-current={c.current ? "true" : undefined}
            title={c.title}
            className={`${CHIP} ${c.current ? "border-navy-300 bg-navy-50 font-bold text-[#164690]" : "border-line-input bg-white font-semibold text-ink hover:border-navy"}`}
          >
            {c.label}
          </Link>
        ) : (
          <span key={c.key} title={c.title} className={`${CHIP} border-line-input bg-white font-semibold text-muted`}>
            {c.label}
          </span>
        ),
      )}
    </div>
  );
}

function ProblemLine({ problem }: { problem: Problem }) {
  return (
    <p role="alert" className="m-0 rounded-xl border border-danger/30 bg-danger-50 px-4 py-2.5 text-[13px] text-ink">
      <strong className="text-danger">Could not load {problem.what}</strong> — {problem.message} Reload the page to try again.
    </p>
  );
}

function SummaryRow({ model }: { model: PeopleWorkspaceModel }) {
  if (!model.summary) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <span className="text-[15px] text-ink">
        <b>{model.summary.count}</b>
        {model.summary.open ? (
          <>
            {" "}
            · <b className="text-[var(--v2-sun-ink)]">{model.summary.open}</b> open in total
          </>
        ) : null}
      </span>
      <div className="flex flex-wrap items-center gap-2">
        <DraftForThese prompt={model.draftPrompt} />
        <span className="inline-flex items-center gap-2">
          <button type="button" disabled className={`${BTN} cursor-not-allowed border border-line-input bg-white text-muted`} title="Exports are not available yet: they need a data.export permission and a watermarked, audited export on the server.">
            Export
          </button>
          <button type="button" disabled className={`${BTN} cursor-not-allowed border border-line-input bg-white text-muted`} title="Saved lists are not built yet.">
            Save as a list
          </button>
          <ComingNext />
        </span>
      </div>
    </div>
  );
}

function SortHead({ label, sortKey, section, align }: { label: string; sortKey: "name" | "open" | "area"; section: HouseholdsSection; align?: "right" }) {
  const active = section.sort === sortKey;
  if (sortKey === "open" && !section.canSortByOpen) return <span className={align === "right" ? "text-right" : undefined}>{label}</span>;
  return (
    <Link href={section.sortHrefs[sortKey]} scroll={false} aria-label={`Sort by ${label.toLowerCase()}${active ? " (sorted)" : ""}`} className={`no-underline hover:text-ink ${align === "right" ? "text-right" : ""} ${active ? "text-ink" : ""}`}>
      {label}
      {active ? <span aria-hidden="true"> ↓</span> : null}
    </Link>
  );
}

function HouseholdsList({ section }: { section: HouseholdsSection }) {
  return (
    <section aria-label="Households" className="flex min-h-0 flex-col gap-0.5 rounded-2xl border border-line bg-white px-3 pb-3 pt-2.5">
      <div className={`hidden rounded-[10px] bg-canvas px-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted ${COLS}`}>
        <SortHead label="Household" sortKey="name" section={section} />
        <span>Primary member</span>
        <SortHead label="Area" sortKey="area" section={section} />
        <SortHead label="Open balance" sortKey="open" section={section} align="right" />
        <span>Last gift</span>
        <span>Last RSVP</span>
      </div>
      {section.rows.length === 0 ? (
        <div className="px-2.5 py-8 text-center">
          <p className="m-0 font-display text-[18px] font-semibold text-ink">{section.emptyTitle}</p>
          {section.emptyHint ? <p className="m-0 mt-1 text-[13px] text-muted">{section.emptyHint}</p> : null}
        </div>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {section.rows.map((r) => (
            <li key={r.id}>
              <Link
                href={r.href}
                scroll={false}
                aria-current={r.selected ? "true" : undefined}
                aria-label={`${r.name}, ${r.ids}. Primary member ${r.primary}. Area ${r.area}. Open balance ${r.open ?? "not visible to your role"}. Last gift ${r.lastGift}. Last RSVP ${r.lastRsvp}.`}
                className={`grid min-h-[52px] grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-0.5 rounded-[10px] px-2.5 py-1.5 text-[13px] font-medium text-ink no-underline ${COLS} ${r.selected ? "bg-[#FFF6DD]" : "hover:bg-canvas"}`}
              >
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className="truncate font-bold">{r.name}</span>
                  <span className="truncate font-mono text-[11px] text-muted">{r.ids}</span>
                </span>
                <span className="col-start-1 truncate text-[12px] text-ink-2 md:col-start-auto md:text-[13px] md:text-ink">
                  <span className="md:hidden">Primary: </span>
                  {r.primary}
                  <span className="md:hidden"> · {r.area}</span>
                </span>
                <span className="hidden truncate md:block">{r.area}</span>
                <span className="col-start-2 row-span-2 row-start-1 text-right font-extrabold text-[var(--v2-sun-ink)] md:col-start-auto md:row-span-1 md:row-start-auto">
                  {r.open ?? <span className="font-normal text-faint" title="Needs a giving permission">—</span>}
                </span>
                <span className="hidden truncate md:block">{r.lastGift}</span>
                <span className="hidden truncate text-muted md:block">{r.lastRsvp}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Paging paging={section.paging} hint="Ask Niva to “show the next 10”, or sort by household, area or open balance." />
    </section>
  );
}

function Paging({ paging, hint }: { paging: { showing: string; prevHref: string | null; nextHref: string | null }; hint?: string }) {
  if (!paging.showing) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-2.5 pb-0.5 pt-2.5 text-[13px] text-muted">
      <span>
        {paging.showing}.{hint ? ` ${hint}` : ""}
      </span>
      {paging.prevHref || paging.nextHref ? (
        <span className="flex gap-2">
          {paging.prevHref ? (
            <Link href={paging.prevHref} scroll={false} className="font-semibold text-navy no-underline hover:underline">
              Previous
            </Link>
          ) : null}
          {paging.nextHref ? (
            <Link href={paging.nextHref} scroll={false} className="font-semibold text-navy no-underline hover:underline">
              Next
            </Link>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}

function PeopleList({ section }: { section: PeopleSection }) {
  const cols = "md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1.6fr)_60px_minmax(0,1.6fr)] md:gap-2.5";
  return (
    <>
      <QuickChips chips={section.bands} />
      <section aria-label="People" className="flex flex-col gap-0.5 rounded-2xl border border-line bg-white px-3 pb-3 pt-2.5">
        <div className={`hidden rounded-[10px] bg-canvas px-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.04em] text-muted ${cols}`} aria-hidden="true">
          <span>Person</span>
          <span>Relationship</span>
          <span>Household</span>
          <span className="text-right">Age</span>
          <span>Contact</span>
        </div>
        {section.rows.length === 0 ? (
          <p className="m-0 px-2.5 py-8 text-center font-display text-[18px] font-semibold text-ink">{section.emptyTitle}</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {section.rows.map((r) => (
              <li key={r.id}>
                <Link
                  href={r.href}
                  scroll={false}
                  aria-current={r.selected ? "true" : undefined}
                  aria-label={`${r.name}, ${r.ids}. ${r.relationship} in ${r.household}. Age ${r.age}. Contact ${r.contact}.`}
                  className={`flex min-h-[52px] flex-col justify-center gap-0.5 rounded-[10px] px-2.5 py-1.5 text-[13px] text-ink no-underline md:items-center ${cols} ${r.selected ? "bg-[#FFF6DD]" : "hover:bg-canvas"}`}
                >
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-bold">{r.name}</span>
                    <span className="truncate font-mono text-[11px] text-muted">{r.ids}</span>
                  </span>
                  <span className="truncate text-ink-2">{r.relationship}</span>
                  <span className="truncate">{r.household}</span>
                  <span className="hidden text-right md:block">{r.age}</span>
                  <span className="truncate text-muted">{r.contact}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <Paging paging={section.paging} />
      </section>
    </>
  );
}

function SectionShell({ title, intro, children, aside }: { title: string; intro?: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-3 rounded-2xl border border-line bg-white px-4 py-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 font-display text-[20px] font-semibold text-ink">{title}</h2>
        {aside}
      </div>
      {intro ? <p className="m-0 text-[13px] text-muted">{intro}</p> : null}
      {children}
    </section>
  );
}

function SectionState<T>({ section, title, render }: { section: Section<T>; title: string; render: (data: T) => ReactNode }) {
  if (section.state === "hidden") {
    return (
      <SectionShell title={title}>
        <div className="px-2 py-6 text-center">
          <p className="m-0 font-display text-[20px] font-semibold text-ink">You don&apos;t have access to this area</p>
          <p className="m-0 mt-1 text-[13px] text-muted">{section.reason}</p>
        </div>
      </SectionShell>
    );
  }
  if (section.state === "error") return <ProblemLine problem={{ what: title.toLowerCase(), message: section.message }} />;
  return <>{render(section.data)}</>;
}

function ReviewRow({ item, action }: { item: ReviewItem; action: string }) {
  return (
    <li className="flex flex-col gap-2 rounded-xl border border-line bg-ground px-3 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-[14px] font-bold text-ink">{item.title}</span>
        <Link href={item.href} className="text-[13px] font-bold text-navy no-underline hover:underline">
          {action}
        </Link>
      </div>
      <span className="text-[13px] text-ink-2">{item.detail}</span>
      {item.household ? <NivaHouseholdCard card={item.household} /> : <span className="text-[12px] text-muted">No household card: your role cannot see this household.</span>}
    </li>
  );
}

function ReviewsList({ section }: { section: NonNullable<PeopleWorkspaceModel["reviews"]> }) {
  return (
    <SectionState
      section={section}
      title="Waiting for a decision"
      render={(d) => (
        <SectionShell
          title="Waiting for a decision"
          intro="Applications and family change requests, oldest first. Each shows its household card, so two families with the same name are never confused. Decide on the review screens."
          aside={<AskNiva prompt="Which applications and family requests are waiting?" />}
        >
          {d.note ? <p className="m-0 text-[13px] text-muted">{d.note}</p> : null}
          <h3 className="m-0 text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted">
            Membership applications{d.applicationsTotal !== null ? ` · ${d.applicationsTotal}` : ""}
          </h3>
          {d.applications.length ? (
            <ul className="m-0 grid list-none gap-2 p-0 lg:grid-cols-2">
              {d.applications.map((a) => (
                <ReviewRow key={a.id} item={a} action="Review" />
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-muted">{d.applicationsTotal === null ? "Your role cannot see membership applications." : "No applications are waiting."}</p>
          )}
          <h3 className="m-0 text-[13px] font-extrabold uppercase tracking-[0.04em] text-muted">Family change requests · {d.requestsTotal}</h3>
          {d.requests.length ? (
            <ul className="m-0 grid list-none gap-2 p-0 lg:grid-cols-2">
              {d.requests.map((r) => (
                <ReviewRow key={r.id} item={r} action="Decide" />
              ))}
            </ul>
          ) : d.forScreen === 0 ? (
            <p className="m-0 text-[13px] text-muted">No family requests are waiting.</p>
          ) : null}
          {d.forScreen > 0 ? (
            <p className="m-0 text-[13px] text-ink-2">
              {d.forScreen === 1 ? "1 more request is" : `${d.forScreen} more requests are`} decided on the{" "}
              <Link href={d.requestsHref} className="font-semibold text-navy">
                family requests screen
              </Link>
              .
            </p>
          ) : null}
        </SectionShell>
      )}
    />
  );
}

function DuplicateRow({ item }: { item: DuplicateItem }) {
  const [a, b] = item.sides;
  return (
    <li className="flex flex-col gap-3 rounded-xl border border-line bg-ground px-3 py-3">
      <div className="grid gap-2 md:grid-cols-2">
        {item.sides.map((s) => (
          <div key={s.id} className="flex flex-col gap-1">
            {s.card ? (
              <NivaHouseholdCard card={s.card} />
            ) : (
              <div className="rounded-lg border border-line bg-white px-3 py-2.5 text-[13px] text-ink">
                <p className="m-0 font-semibold">{s.title}</p>
                {s.lines.map((l) => (
                  <p key={l} className="m-0 text-[12px] text-muted">
                    {l}
                  </p>
                ))}
              </div>
            )}
            {item.suggestedKeepId === s.id ? <span className="text-[12px] font-semibold text-[var(--v2-green)]">Suggested to keep (signs in, or has more details)</span> : null}
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href={item.compareHref} className="inline-flex min-h-10 items-center rounded-[20px] border border-line-input bg-white px-4 text-[13px] font-bold text-ink no-underline hover:border-navy">
          Compare side by side
        </Link>
        <ActionForm
          action={dismissDuplicateAction}
          submitLabel="Not the same"
          variant="ghost"
          size="sm"
          confirmKicker="Not a duplicate"
          confirmMessage={item.kind === "person" ? "Mark these two records as different people? The suggestion is closed." : "Mark these as two different households? The suggestion is closed."}
        >
          <input type="hidden" name="candidate" value={item.candidateId} />
        </ActionForm>
      </div>
      {item.blocked ? (
        <p className="m-0 text-[12px] text-ink-2">{item.blocked}</p>
      ) : (
        <MergeByCard
          kind={item.kind}
          compareHref={item.compareHref}
          options={
            item.kind === "person"
              ? [item.suggestedKeepId === b.id ? { keepId: b.id, dropId: a.id, keepLabel: b.title } : { keepId: a.id, dropId: b.id, keepLabel: a.title }]
              : [
                  { keepId: a.id, dropId: b.id, keepLabel: a.title },
                  { keepId: b.id, dropId: a.id, keepLabel: b.title },
                ]
          }
        />
      )}
    </li>
  );
}

function DuplicatesList({ section }: { section: NonNullable<PeopleWorkspaceModel["duplicates"]> }) {
  return (
    <SectionState
      section={section}
      title="Possible duplicates"
      render={(d) => (
        <SectionShell
          title="Possible duplicates"
          intro="The system matched these pairs. Niva only suggests: a person compares the two cards and confirms before anything is merged."
          aside={<AskNiva prompt="Show me the suggested duplicates" />}
        >
          {d.items.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {d.items.map((i) => (
                <DuplicateRow key={i.candidateId} item={i} />
              ))}
            </ul>
          ) : d.forScreen === 0 ? (
            <p className="m-0 text-[13px] text-muted">There are no suggested duplicates.</p>
          ) : null}
          {d.forScreen > 0 ? (
            <p className="m-0 text-[13px] text-ink-2">
              {d.forScreen === 1 ? "1 more pair involves" : `${d.forScreen} more pairs involve`} a child or a record your role cannot see; compare{" "}
              {d.forScreen === 1 ? "it" : "them"} on the{" "}
              <Link href={d.mergeScreenHref} className="font-semibold text-navy">
                merge screen
              </Link>
              .
            </p>
          ) : null}
        </SectionShell>
      )}
    />
  );
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The household card
// ---------------------------------------------------------------------------------------------------------------------------------

function PanelAside({ panel }: { panel: PanelState }) {
  if (panel.state === "none") return null;
  const place = panel.explicit
    ? "fixed inset-0 z-50 flex overflow-y-auto px-4 pb-10 pt-5 xl:inset-auto xl:z-auto"
    : "hidden xl:flex";
  return (
    <aside
      aria-label="Household card"
      className={`${place} flex-col gap-[18px] bg-white xl:sticky xl:top-16 xl:h-[calc(100vh-4rem)] xl:w-[440px] xl:shrink-0 xl:overflow-y-auto xl:border-l xl:border-line xl:px-7 xl:py-[26px]`}
    >
      {panel.explicit ? (
        <Link href={panel.closeHref} scroll={false} className="self-start text-[14px] font-bold text-navy no-underline xl:hidden">
          ← Back to the list
        </Link>
      ) : null}
      {panel.state === "error" ? (
        <>
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--v2-indigo)]">Household card</span>
          <p role="alert" className="m-0 text-[14px] text-ink">
            <strong className="text-danger">Could not load this household</strong> — {panel.message}
          </p>
        </>
      ) : (
        <CardBody card={panel.card} />
      )}
    </aside>
  );
}

function CardSection<T>({ title, section, render }: { title: string; section: Section<T>; render: (data: T) => ReactNode }) {
  return (
    <div className="flex flex-col gap-2 border-t border-line pt-3.5">
      <h3 className="m-0 text-[12px] font-extrabold uppercase tracking-[0.04em] text-muted">{title}</h3>
      {section.state === "hidden" ? (
        <p className="m-0 text-[13px] text-muted">{section.reason}</p>
      ) : section.state === "error" ? (
        <p role="alert" className="m-0 text-[13px] text-danger">
          Could not load {title.toLowerCase()} — {section.message}
        </p>
      ) : (
        render(section.data)
      )}
    </div>
  );
}

function CardBody({ card }: { card: HouseholdPanel }) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[var(--v2-indigo)]">Household card</span>
        <h2 className="m-0 font-display text-[24px] font-semibold leading-tight text-ink">{card.name}</h2>
        <span className="font-mono text-[13px] text-ink-2">{card.ids}</span>
      </div>
      <dl className="m-0 grid grid-cols-[120px_minmax(0,1fr)] gap-x-3 gap-y-2.5 text-[14px] leading-[1.45]">
        {card.facts.map((f) => (
          <div key={f.label} className="contents">
            <dt className="font-semibold text-muted">{f.label}</dt>
            <dd className={`m-0 ${f.tone === "strong" ? "font-bold" : ""} ${f.tone === "money" ? "font-extrabold text-[var(--v2-sun-ink)]" : ""} ${f.tone === "mono" ? "break-words font-mono text-[12px] leading-[1.6]" : ""}`}>{f.value}</dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap items-center gap-2">
        {card.recordPaymentHref ? (
          <Link href={card.recordPaymentHref} className={`${BTN} bg-navy text-white hover:bg-navy-hover`}>
            Record a payment
          </Link>
        ) : null}
        <button type="button" disabled title="Messaging one household from its card is not built yet." className={`${BTN} cursor-not-allowed border border-line-input bg-white text-muted`}>
          Message the household
        </button>
        <Link href={card.fullPageHref} className={`${BTN} border border-line-input bg-white text-ink hover:border-navy`}>
          Open the full page
        </Link>
      </div>
      <div className="-mt-2 flex items-center gap-2">
        <ComingNext />
        <span className="text-[12px] text-muted">Message the household</span>
      </div>
      {card.noticed ? (
        <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-ground px-4 py-3.5">
          <NoticedLabel />
          <p className="m-0 text-[14px] leading-normal text-ink">
            Another household, <b>{card.noticed.name}</b>
            {card.noticed.ids || card.noticed.place ? (
              <>
                {" "}
                (<span className="font-mono text-[12px]">{card.noticed.ids}</span>
                {card.noticed.place ? `${card.noticed.ids ? ", " : ""}${card.noticed.place}` : ""})
              </>
            ) : null}
            , may be the same family.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link href={card.noticed.compareHref} className="inline-flex min-h-10 items-center rounded-[20px] border border-line-input bg-white px-4 text-[13px] font-bold text-ink no-underline hover:border-navy">
              Compare side by side
            </Link>
            <ActionForm action={dismissDuplicateAction} submitLabel="Not the same" variant="ghost" size="sm" confirmKicker="Not a duplicate" confirmMessage="Mark these as two different households? The suggestion is closed.">
              <input type="hidden" name="candidate" value={card.noticed.candidateId} />
            </ActionForm>
          </div>
          <p className="m-0 text-[12px] leading-normal text-muted">Niva only suggests. Merging needs you to compare the two cards and confirm.</p>
        </div>
      ) : null}
      <div>
        <AskNiva prompt={card.nivaPrompt} label="Ask Niva about this household" />
      </div>
      {card.problems.map((p) => (
        <p key={p.what} role="alert" className="m-0 text-[13px] text-danger">
          Could not load {p.what} — {p.message}
        </p>
      ))}
      <CardSection
        title="Adults"
        section={{ state: "ok", data: card.adults }}
        render={(adults) =>
          adults.length ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {adults.map((a) => (
                <li key={`${a.name}-${a.role}`} className="text-[14px] leading-snug">
                  <span className="font-bold text-ink">{a.name}</span> <span className="text-muted">· {a.role}{a.onApp ? " · on the app" : ""}</span>
                  <span className="block text-[13px] text-ink-2">{a.contact}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-muted">No adults recorded.</p>
          )
        }
      />
      {card.children.length ? (
        <CardSection
          title="Children (shown to you only)"
          section={{ state: "ok", data: card.children }}
          render={(kids) => (
            <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
              {kids.map((c) => (
                <li key={`${c.name}-${c.age}`}>
                  {c.name} <span className="text-muted">· {c.age}</span>
                </li>
              ))}
            </ul>
          )}
        />
      ) : null}
      <CardSection
        title="Membership"
        section={card.membership}
        render={(rows) =>
          rows.length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rows.map((r) => (
                <li key={`${r.label}-${r.detail}`} className="text-[14px]">
                  <span className="font-semibold text-ink">{r.label}</span> <span className="block text-[13px] text-muted">{r.detail}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-muted">No membership on record.</p>
          )
        }
      />
      <CardSection
        title="Giving"
        section={card.giving}
        render={(g) => (
          <div className="flex flex-col gap-1.5 text-[14px]">
            <span>
              Open balance <b className="text-[var(--v2-sun-ink)]">{g.open}</b> · last gift {g.lastGift}
            </span>
            {g.pledges.map((p) => (
              <span key={p.label} className="flex justify-between gap-3 text-[13px]">
                <span className="truncate text-ink-2">{p.label}</span>
                <span className={p.closed ? "text-[var(--v2-green)]" : "font-semibold text-ink"}>{p.progress}</span>
              </span>
            ))}
          </div>
        )}
      />
      <CardSection
        title="Open requests"
        section={card.requests}
        render={(rows) =>
          rows.length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rows.map((r) => (
                <li key={`${r.what}-${r.when}`} className="text-[14px]">
                  <Link href={r.href} className="font-semibold text-navy no-underline hover:underline">
                    {r.what}
                  </Link>{" "}
                  <span className="text-[13px] text-muted">· {r.when}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-muted">Nothing open.</p>
          )
        }
      />
      <CardSection
        title="Recent activity"
        section={card.activity}
        render={(rows) =>
          rows.length ? (
            <ul className="m-0 flex list-none flex-col gap-1.5 p-0">
              {rows.map((r, i) => (
                <li key={i} className="text-[13px] text-ink-2">
                  <span className="font-semibold text-ink">{r.when}</span> · {r.what}
                  {r.detail ? <span className="text-muted"> · {r.detail}</span> : null}
                </li>
              ))}
            </ul>
          ) : (
            <p className="m-0 text-[13px] text-muted">No recorded changes yet.</p>
          )
        }
      />
    </>
  );
}
