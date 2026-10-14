// The Giving workspace page in the New look, drawn from docs/handoff/prototypes/admin-v2/Giving.dc.html: "Ask, review, confirm."
// On the left the conversation that prepares a payment (household picker, confirmation card) and the box that takes a sentence;
// on the right what is going on in Giving. The tables and reports stay one tap away, on the existing screens.
//
// The two columns sit side by side only when the page itself is wide enough (a container query), so opening Niva's panel
// beside the work stacks them instead of squeezing the card.

import Link from "next/link";

import type { GivingWorkspaceModel } from "@/lib/data/giving-workspace";

import { AskFlow, type AskDemo, type FlowState } from "./ask-flow";
import { GivingSidePanel } from "./side-panel";

export function GivingPage({ model, initial, demo }: { model: GivingWorkspaceModel; initial?: FlowState; demo?: AskDemo }) {
  return (
    <div data-v2-tokens className="@container">
      <div className="flex flex-col @[1080px]:-mb-10 @[1080px]:-mr-7 @[1080px]:-mt-[22px] @[1080px]:grid @[1080px]:min-h-[calc(100vh-64px)] @[1080px]:grid-cols-[minmax(0,1fr)_400px] @[1280px]:grid-cols-[minmax(0,1fr)_420px]">
        <div className="flex min-w-0 flex-col gap-[18px] pb-6 @[1080px]:pr-10 @[1080px]:pt-7 @[1280px]:pl-3">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-col gap-1.5">
              <h1 className="m-0 font-display text-[30px] font-semibold leading-[1.15] text-ink">{model.title}</h1>
              <p className="m-0 text-[14px] text-muted">Ask, review, confirm. The tables and reports are one tap away.</p>
            </div>
            <nav aria-label={`${model.title} views`} className="max-w-full overflow-x-auto">
              <ul className="m-0 flex list-none gap-1 rounded-card bg-navy-50 p-1">
                {model.views.map((v) => {
                  const current = v.key === "conversation";
                  return (
                    <li key={v.key}>
                      <Link
                        href={v.href}
                        aria-current={current ? "page" : undefined}
                        className={`inline-flex min-h-[40px] items-center whitespace-nowrap rounded-window px-4 text-[14px] no-underline ${current ? "bg-white font-bold text-navy" : "font-semibold text-ink-2 hover:bg-white/60"}`}
                      >
                        {v.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          </div>
          <AskFlow
            communityName={model.communityName}
            personName={model.personName}
            today={model.today}
            timeZone={model.timeZone}
            currency={model.currency}
            locale={model.locale}
            labels={model.labels}
            canRecord={model.canRecord}
            recordByCard={model.recordByCard}
            examples={model.examples}
            initial={initial}
            demo={demo}
          />
        </div>
        <aside
          aria-label={`${model.title} context`}
          className="mt-2 flex flex-col gap-[22px] rounded-tile border border-line bg-ground p-5 @[1080px]:mt-0 @[1080px]:rounded-none @[1080px]:border-0 @[1080px]:border-l @[1080px]:p-7"
        >
          <GivingSidePanel model={model} />
        </aside>
      </div>
    </div>
  );
}
