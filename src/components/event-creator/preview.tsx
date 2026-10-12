"use client";

// The event page as members will see it, drawn from the draft as it is answered (web or phone), and the readiness list under it.

import { audienceLabel } from "@/lib/events/report";
import type { CardId, CreatorCtx, CreatorExisting, EventDraft } from "@/lib/event-creator/types";
import type { CreatorReadiness } from "@/lib/event-creator/plan";
import { STATION_LABEL } from "@/lib/event-creator/smart";
import { priceText, whenText } from "@/lib/event-creator/summary";

function Page({ draft, ctx, existing, phone }: { draft: EventDraft; ctx: CreatorCtx; existing: CreatorExisting; phone: boolean }) {
  const roles = existing.shifts.map((s) => `${s.notes?.trim() || STATION_LABEL[s.station] || s.station} · ${s.capacity ?? 1}`);
  const cap = draft.capacity.trim();
  return (
    <div className="bg-white">
      <div className={`bg-[#16306b] text-white ${phone ? "px-3.5 py-4" : "px-5 py-5"}`}>
        <span className="inline-block rounded-full bg-white/20 px-2.5 py-0.5 text-[11px] font-bold tracking-[0.06em]">{draft.id ? "DRAFT · NOT VISIBLE TO MEMBERS" : "DRAFT · NOT SAVED YET"}</span>
        <h3 className={`m-0 mt-2 font-display font-semibold leading-[1.15] ${phone ? "text-[21px]" : "text-[25px]"}`}>{draft.name.trim() || "Untitled event"}</h3>
        <p className="m-0 mt-2 text-[14px] text-white/95">{whenText(draft, ctx)}</p>
        <p className="m-0 text-[14px] text-white/95">
          {draft.venue.trim() ? `${draft.venue.trim()} · ` : ""}
          {ctx.community.name}
        </p>
      </div>
      <div className={phone ? "px-3.5 pb-4 pt-3" : "px-5 pb-5 pt-4"}>
        <div className="flex flex-wrap gap-1.5">
          <span className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2">{audienceLabel(draft.audience)}</span>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2">{priceText(draft, ctx)}</span>
          {draft.lunch_enabled ? <span className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2">Meal times at check-in</span> : null}
          {draft.confidential ? <span className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2">Committee only</span> : null}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="inline-block rounded-[10px] bg-navy px-4 py-2 text-[14px] font-semibold text-white" aria-hidden="true">
            RSVP
          </span>
          <span className="text-[13px] text-ink-2">
            {cap ? `${cap} places` : "No limit"}
            {draft.waitlist_enabled && cap ? " · waitlist on" : ""}
            {draft.commitments_enabled ? " · donation commitment asked" : ""}
          </span>
        </div>
        <p className="m-0 mt-3 whitespace-pre-line text-[14px] leading-relaxed text-ink">{draft.description.trim() || <span className="text-muted">The description appears here.</span>}</p>
        {roles.length ? (
          <>
            <p className="m-0 mt-3 font-display text-[15px] font-semibold text-ink">Help needed</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {roles.map((r) => (
                <span key={r} className="rounded-full border border-line px-2.5 py-0.5 text-[12px] text-ink-2">
                  {r}
                </span>
              ))}
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

export function EventPreview({ draft, ctx, existing, mode, onMode }: { draft: EventDraft; ctx: CreatorCtx; existing: CreatorExisting; mode: "web" | "phone"; onMode: (m: "web" | "phone") => void }) {
  return (
    <section aria-label="The event page, as members will see it" className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">The event page, building as you answer</p>
        <div role="group" aria-label="Preview" className="inline-flex rounded-full border border-line bg-white p-0.5">
          {(["web", "phone"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => onMode(m)}
              className={`min-h-[32px] rounded-full px-3 text-[13px] font-semibold ${mode === m ? "bg-navy text-white" : "text-ink-2 hover:bg-navy-50"}`}
            >
              {m === "web" ? "Web page" : "Phone app"}
            </button>
          ))}
        </div>
      </div>
      {mode === "phone" ? (
        <div className="mx-auto w-[300px] max-w-full overflow-hidden rounded-[28px] border-[8px] border-ink">
          <Page draft={draft} ctx={ctx} existing={existing} phone />
        </div>
      ) : (
        <div className="overflow-hidden rounded-[16px] border border-line">
          <Page draft={draft} ctx={ctx} existing={existing} phone={false} />
        </div>
      )}
    </section>
  );
}

export function ReadinessList({ readiness, onGo }: { readiness: CreatorReadiness; onGo: (card: CardId) => void }) {
  const { items, percent, blocking } = readiness;
  return (
    <section aria-label="Ready to publish" className="rounded-[14px] border border-line bg-white px-4 py-3">
      <p className="m-0 text-[12px] font-bold uppercase tracking-[0.06em] text-muted">Ready to publish</p>
      <p className="m-0 mt-0.5 text-[14px] text-ink">
        <b>{percent}%</b> <span className="text-ink-2">· {blocking ? `${blocking} thing${blocking === 1 ? " still blocks" : "s still block"} publishing` : "nothing blocks publishing"}</span>
      </p>
      <div className="my-2 h-2 overflow-hidden rounded-full bg-line" role="progressbar" aria-label="Ready to publish" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <i className="block h-full bg-success" style={{ width: `${percent}%` }} />
      </div>
      <ul className="m-0 flex list-none flex-col p-0">
        {items.map((i) => (
          <li key={i.key} className="flex items-baseline gap-2 py-0.5 text-[14px]">
            <span aria-hidden="true" className={`w-4 flex-none font-bold ${i.ok ? "text-success" : "text-saffron"}`}>
              {i.ok ? "✓" : "–"}
            </span>
            <span className="min-w-0 flex-1">
              <span className="sr-only">{i.ok ? "Done: " : i.blocks ? "Needed to publish: " : "Not yet: "}</span>
              {i.ok ? (
                <span className="text-ink">{i.label}</span>
              ) : (
                <button type="button" onClick={() => onGo(i.card)} className="text-left text-ink hover:underline">
                  {i.label}
                </button>
              )}
              {!i.ok && i.hint ? <small className={`ml-1 text-[12px] ${i.blocks ? "font-semibold text-saffron" : "text-muted"}`}>({i.hint})</small> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
