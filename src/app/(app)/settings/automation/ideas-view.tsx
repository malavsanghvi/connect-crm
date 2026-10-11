import { ActionForm } from "@/components/action-form";
import { Badge, Card, EmptyState, buttonClass } from "@/components/ui";
import { allowedDecisions, type IdeaCard, type IdeaDecision, type UsageSummary } from "@/lib/activity/ideas";

import { decideIdeaAction } from "./actions";

// What the buttons of an idea say, by where it stands now.
const BUTTON: Record<IdeaCard["status"], Partial<Record<IdeaDecision, { label: string; variant: "primary" | "secondary" }>>> = {
  new: { accept: { label: "Accept", variant: "primary" }, dismiss: { label: "Not useful", variant: "secondary" } },
  accepted: { dismiss: { label: "Not useful after all", variant: "secondary" }, restore: { label: "Put back in the list", variant: "secondary" } },
  dismissed: { restore: { label: "Bring back", variant: "secondary" } },
  built: {},
};

function Decision({ card }: { card: IdeaCard }) {
  const decisions = allowedDecisions(card.status);
  if (decisions.length === 0) return null;
  const asks = decisions.some((d) => d === "accept" || d === "dismiss");
  return (
    <ActionForm action={decideIdeaAction} submitLabel="Save" hideSubmit size="sm" className="mt-3 space-y-2" buttonsClassName="mt-2"
      extraButtons={decisions.map((d) => {
        const b = BUTTON[card.status][d];
        return b ? (
          <button key={d} type="submit" name="decision" value={d} className={buttonClass(b.variant, "sm")}>
            {b.label}
          </button>
        ) : null;
      })}
    >
      <input type="hidden" name="id" value={card.id} />
      <input type="hidden" name="from" value={card.status} />
      {asks ? (
        <label className="block max-w-xl">
          <span className="crm-label">Why? (optional, kept in the audit log)</span>
          <input name="reason" className="crm-input" maxLength={500} autoComplete="off" placeholder="For example: we already do this another way" />
        </label>
      ) : null}
    </ActionForm>
  );
}

function Idea({ card, canAnswer }: { card: IdeaCard; canAnswer: boolean }) {
  return (
    <li className="rounded-[12px] border border-line p-3" data-testid="automation-idea">
      <p className="text-[14px] font-semibold text-ink">{card.title}</p>
      <p className={`mt-1 text-[13px] ${card.quiet ? "text-muted" : ""}`}>{card.facts}</p>
      <p className="mt-1 text-[12px] text-muted">
        Done by: {card.who} · Weaver could make this <strong className="text-ink">{card.kindLabel.charAt(0).toLowerCase() + card.kindLabel.slice(1)}</strong>. {card.kindHint}
      </p>
      {card.status === "built" ? (
        <p className="mt-2 text-[13px]">
          <Badge tone="success">Built</Badge>
        </p>
      ) : null}
      {canAnswer ? <Decision card={card} /> : null}
    </li>
  );
}

export function IdeaList({
  title,
  description,
  cards,
  empty,
  span,
  canAnswer = true,
}: {
  title: string;
  description?: string;
  cards: IdeaCard[];
  empty: string;
  span?: 12;
  /** False for Weaver staff looking at a community that shares: they see the ideas but only the community answers them. */
  canAnswer?: boolean;
}) {
  return (
    <Card span={span} title={title} description={description}>
      {cards.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="space-y-3">
          {cards.map((card) => (
            <Idea key={card.id} card={card} canAnswer={canAnswer} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function UsageLines({ title, lines }: { title: string; lines: UsageSummary["screens"] }) {
  return (
    <div>
      <h3 className="crm-label mb-1">{title}</h3>
      {lines.length === 0 ? (
        <p className="text-[13px] text-muted">Nothing yet.</p>
      ) : (
        <ul className="space-y-1 text-[13px]">
          {lines.map((l) => (
            <li key={`${l.where}|${l.label}`} className="flex flex-wrap items-baseline justify-between gap-2">
              <span>
                {l.label}
                {l.where === "app" ? <span className="text-muted"> · in the member app</span> : null}
              </span>
              <span className="text-muted">
                {l.times.toLocaleString("en-US")} {l.times === 1 ? "time" : "times"}
                {l.failed > 0 ? ` · ${l.failed.toLocaleString("en-US")} did not work` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** How the community uses Weaver: counts only, over the last 30 days. */
export function UsagePanel({ usage }: { usage: UsageSummary }) {
  return (
    <Card
      span={12}
      title="How the community uses Weaver"
      description="The last 30 days · counts only: no names, no amounts, nothing anyone typed · a screen or action used by fewer than 3 people is left out"
    >
      {usage.total === 0 ? (
        <EmptyState title="Nothing to show yet">Counts appear here once at least 3 people have used the same screen or action.</EmptyState>
      ) : (
        <div className="space-y-4">
          <p className="text-[13px]">
            <strong>{usage.total.toLocaleString("en-US")}</strong> screen visits and actions counted: {usage.inPortal.toLocaleString("en-US")} in the portal,{" "}
            {usage.inApp.toLocaleString("en-US")} in the member app.
          </p>
          <div className="grid gap-6 md:grid-cols-2">
            <UsageLines title="Busiest screens" lines={usage.screens} />
            <UsageLines title="Busiest actions" lines={usage.actions} />
          </div>
        </div>
      )}
    </Card>
  );
}
